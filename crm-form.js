(function () {
  var DE_FORM_SELECTOR = 'form[action*="digitalestates.dk"]';
  var recaptchaApiPromise = null;

  // ===========================================
  // 0. BOT PROTECTION (Google reCAPTCHA v3)
  // Activated per-form by the CRM "Require CAPTCHA" toggle. The server tells us
  // via the /config endpoint whether to render the widget; nothing below runs
  // for forms that have the toggle off.
  // ===========================================
  // Returns the config URL for a standard leads form, or null if the form's
  // action isn't a leads endpoint (in which case we never pre-flight it).
  function configUrlFor(form) {
    var action = form.getAttribute('action') || '';
    if (!/\/leads(\?.*)?$/.test(action)) return null;
    return action.replace(/\/leads(\?.*)?$/, '/config');
  }

  function loadRecaptchaApi(sitekey) {
    if (window.grecaptcha && window.grecaptcha.execute) return Promise.resolve();
    if (recaptchaApiPromise) return recaptchaApiPromise;
    recaptchaApiPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://www.google.com/recaptcha/api.js?render=' + encodeURIComponent(sitekey);
      s.async = true;
      s.defer = true;
      s.onload = function () {
        resolve();
      };
      s.onerror = function () {
        reject(new Error('reCAPTCHA failed to load'));
      };
      document.head.appendChild(s);
    });
    return recaptchaApiPromise;
  }

  // Honeypot field — feeds the server-side honeypot check; only added to forms
  // that opt in via the CRM toggle. A real visitor never fills it.
  // (No page-load timestamp: reCAPTCHA already covers timing-based bot detection,
  // and a fixed "too fast" gate risks rejecting a quick real lead.)
  function addBotProtectionFields(form) {
    if (!form.querySelector('input[name="website"]')) {
      var hp = document.createElement('input');
      hp.type = 'text';
      hp.name = 'website';
      hp.tabIndex = -1;
      hp.autocomplete = 'off';
      hp.setAttribute('aria-hidden', 'true');
      hp.style.position = 'absolute';
      hp.style.left = '-9999px';
      hp.style.opacity = '0';
      hp.style.height = '0';
      hp.style.width = '0';
      form.appendChild(hp);
    }
  }

  // We hide reCAPTCHA's floating badge (it collides with other fixed elements
  // such as cookie banners) and instead show Google's required disclosure text
  // under each protected form. Both run once and only for protected forms.
  function hideRecaptchaBadge() {
    if (document.getElementById('de-recaptcha-badge-style')) return;
    var style = document.createElement('style');
    style.id = 'de-recaptcha-badge-style';
    style.textContent = '.grecaptcha-badge { visibility: hidden !important; }';
    document.head.appendChild(style);
  }

  // Google requires a short "protected by reCAPTCHA" notice when the badge is
  // hidden (no Privacy/Terms links needed). The notice is injected in JS, so the
  // site's translation tooling never sees it — we localise here. Unmapped
  // locales fall back to Danish.
  var RECAPTCHA_DISCLOSURE = {
    da: 'Dette websted er beskyttet af reCAPTCHA.',
    en: 'This site is protected by reCAPTCHA.'
  };

  function recaptchaDisclosureText() {
    // This site has no <html lang>; English pages live under /en/, Danish at the
    // root. Honour <html lang> first in case another site sets it, then fall back
    // to the URL path.
    var lang = (document.documentElement.lang || '').toLowerCase().split('-')[0];
    if (!RECAPTCHA_DISCLOSURE[lang]) {
      lang = /^\/en(\/|$)/.test(location.pathname) ? 'en' : 'da';
    }
    return RECAPTCHA_DISCLOSURE[lang] || RECAPTCHA_DISCLOSURE.da;
  }

  function addRecaptchaDisclosure(form) {
    if (form.querySelector('.de-recaptcha-disclosure')) return;
    var note = document.createElement('div');
    note.className = 'de-recaptcha-disclosure';
    note.style.cssText = 'font-size:11px;line-height:1.4;opacity:0.7;margin-top:8px;';
    note.textContent = recaptchaDisclosureText();
    form.appendChild(note);
  }

  // reCAPTCHA v3 has no widget or challenge — we just load the script (with the
  // sitekey) and request a token on demand at submit time. The floating badge is
  // hidden in favour of the disclosure line added below.
  function setupCaptcha(form, sitekey, action) {
    addBotProtectionFields(form);
    hideRecaptchaBadge();
    addRecaptchaDisclosure(form);

    var state = { sitekey: sitekey, action: action || 'lead_form', ready: false };
    form._deCaptcha = state;

    state.readyPromise = loadRecaptchaApi(sitekey)
      .then(function () {
        state.ready = true;
      })
      .catch(function (err) {
        console.warn('DE Form: reCAPTCHA setup failed', err);
      });

    return state;
  }

  // Resolves to a fresh reCAPTCHA token, or null if the script genuinely failed
  // to load (e.g. blocked by an extension) — in which case the server rejects
  // and the user sees a retry-able error. Waits for the script to finish loading
  // first (capped), so a fast submit doesn't fail just because reCAPTCHA hadn't
  // loaded yet.
  function getCaptchaToken(state) {
    if (!state) {
      return Promise.resolve(null);
    }

    var ready = Promise.race([
      Promise.resolve(state.readyPromise),
      new Promise(function (resolve) {
        setTimeout(resolve, 8000);
      }),
    ]);

    return ready.then(function () {
      return new Promise(function (resolve) {
        if (!state.ready || !window.grecaptcha || !window.grecaptcha.execute) {
          resolve(null);
          return;
        }
        try {
          window.grecaptcha.ready(function () {
            window.grecaptcha
              .execute(state.sitekey, { action: state.action })
              .then(function (token) {
                resolve(token || null);
              })
              .catch(function () {
                resolve(null);
              });
          });
        } catch (e) {
          resolve(null);
        }
      });
    });
  }

  // ===========================================
  // 1. ADD HIDDEN TRACKING FIELDS TO ALL FORMS
  // ===========================================
  function addTrackingFields(form) {
    var trackingFields = [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'referrer_url',
      'landing_page',
      'lead_form',
      'unit_id',
      'user_id',
    ];

    trackingFields.forEach(function (fieldName) {
      if (!form.querySelector('input[name="' + fieldName + '"]')) {
        var input = document.createElement('input');
        input.type = 'hidden';
        input.name = fieldName;
        form.appendChild(input);
      }
    });
  }

  // ===========================================
  // 2. POPULATE TRACKING FIELD VALUES
  // ===========================================
  function populateTrackingFields(form) {
    var urlParams = new URLSearchParams(window.location.search);

    // UTM parameters (from URL or sessionStorage)
    var utmParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
    utmParams.forEach(function (param) {
      var value = urlParams.get(param) || sessionStorage.getItem('de_' + param) || '';
      var field = form.querySelector('input[name="' + param + '"]');
      if (field && value) field.value = value;
    });

    // Referrer URL
    var referrerField = form.querySelector('input[name="referrer_url"]');
    if (referrerField && !referrerField.value) {
      referrerField.value = document.referrer || '';
    }

    // Landing page
    var landingField = form.querySelector('input[name="landing_page"]');
    if (landingField && !landingField.value) {
      landingField.value = window.location.href;
    }

    // Lead form (from form ID)
    var leadFormField = form.querySelector('input[name="lead_form"]');
    if (leadFormField && !leadFormField.value && form.id) {
      leadFormField.value = form.id;
    }

    // Unit ID / Bolig ID (from URL param)
    var unitField = form.querySelector('input[name="unit_id"]');
    if (unitField) {
      unitField.value = urlParams.get('bolig-id') || '';
    }

    // User ID (from cookie)
    var userIdField = form.querySelector('input[name="user_id"]');
    if (userIdField) {
      var match = document.cookie.match(/(?:^|;\s*)user_id=([^;]+)/);
      if (match) userIdField.value = decodeURIComponent(match[1]);
    }
  }

  // ===========================================
  // 3. STORE UTM PARAMS IN SESSION STORAGE
  // ===========================================
  function storeUtmParams() {
    var urlParams = new URLSearchParams(window.location.search);
    var utmParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];

    utmParams.forEach(function (param) {
      var value = urlParams.get(param);
      if (value) {
        sessionStorage.setItem('de_' + param, value);
      }
    });
  }

  // ===========================================
  // 4. CHECK FOR FALLBACK REDIRECT RESULT
  // ===========================================
  function checkFallbackResult() {
    var urlParams = new URLSearchParams(window.location.search);
    var result = urlParams.get('de_form');

    if (!result) return;

    // Remove the query param from the URL without reloading
    var url = new URL(window.location.href);
    url.searchParams.delete('de_form');
    history.replaceState(null, '', url.toString());

    // Find the form and show the appropriate message
    var forms = document.querySelectorAll(DE_FORM_SELECTOR);
    forms.forEach(function (form) {
      var wrapper = form.closest('.w-form');
      var doneBox = wrapper ? wrapper.querySelector('.w-form-done') : null;
      var failBox = wrapper ? wrapper.querySelector('.w-form-fail') : null;

      if (result === 'success') {
        form.style.display = 'none';
        if (failBox) failBox.style.display = 'none';
        if (doneBox) doneBox.style.display = 'block';
      } else if (result === 'error') {
        // Don't hide the form on error - let the user retry
        if (doneBox) doneBox.style.display = 'none';
        if (failBox) failBox.style.display = 'block';
      }
    });
  }

  // ===========================================
  // 5. FORM SUBMIT HANDLER
  // ===========================================
  function enhanceForm(form) {
    if (form.dataset.deEnhanced === 'true') return;
    form.dataset.deEnhanced = 'true';

    // Add and populate hidden fields
    addTrackingFields(form);
    populateTrackingFields(form);

    // Ask the server whether this form is bot-protected (CRM "Require CAPTCHA"
    // toggle). Nothing is injected unless the toggle is on AND reCAPTCHA keys
    // are configured server-side. The request is time-bounded and failure-safe,
    // so for unprotected forms it can never delay or block submission.
    var configUrl = configUrlFor(form);
    if (!configUrl) {
      form._deConfigReady = Promise.resolve(false);
    } else {
      var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = controller
        ? setTimeout(function () {
            controller.abort();
          }, 8000)
        : null;

      form._deConfigReady = fetch(configUrl, {
        headers: { Accept: 'application/json' },
        signal: controller ? controller.signal : undefined,
      })
        .then(function (res) {
          return res.ok ? res.json() : null;
        })
        .then(function (cfg) {
          if (cfg && cfg.require_captcha && cfg.recaptcha_sitekey) {
            setupCaptcha(form, cfg.recaptcha_sitekey, cfg.recaptcha_action);
            return true;
          }
          return false;
        })
        .catch(function () {
          return false;
        })
        .then(function (isProtected) {
          // .catch above means this never rejects; clear the abort timer and
          // pass the result through. (Avoids Promise.prototype.finally, which
          // is missing on some older browsers.)
          if (timer) {
            clearTimeout(timer);
          }
          return isProtected;
        });
    }

    var wrapper = form.closest('.w-form');
    var doneBox = wrapper ? wrapper.querySelector('.w-form-done') : null;
    var failBox = wrapper ? wrapper.querySelector('.w-form-fail') : null;
    var submitBtn = form.querySelector('input[type="submit"], button[type="submit"]');

    // Hide success/error initially
    if (doneBox) doneBox.style.display = 'none';
    if (failBox) failBox.style.display = 'none';

    var isSubmitting = false;

    form.addEventListener(
      'submit',
      function (e) {
        // If this is a synthetic re-dispatch for GTM, let it bubble through
        if (isSubmitting) {
          e.preventDefault();
          return;
        }

        e.preventDefault();
        // Prevent Webflow's native form handler from also processing this
        e.stopImmediatePropagation();
        isSubmitting = true;

        // Re-populate fields right before submit (in case URL changed)
        populateTrackingFields(form);

        var originalLabel = '';
        if (submitBtn) {
          originalLabel = submitBtn.value || submitBtn.textContent;
          submitBtn.disabled = true;
          submitBtn.classList.add('is-disabled');
          var waitText = submitBtn.getAttribute('data-wait') || 'Sender...';
          if (submitBtn.tagName === 'INPUT') {
            submitBtn.value = waitText;
          } else {
            submitBtn.textContent = waitText;
          }
        }

        var endpoint = form.getAttribute('action');
        var formData = new FormData(form);

        function resetButton() {
          isSubmitting = false;
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.classList.remove('is-disabled');
            if (submitBtn.tagName === 'INPUT') {
              submitBtn.value = originalLabel;
            } else {
              submitBtn.textContent = originalLabel;
            }
          }
        }

        var gtmSubmitFired = false;

        function showSuccess() {
          // Dispatch a real submit event so GTM's native Form Submission trigger fires
          if (!gtmSubmitFired) {
            gtmSubmitFired = true;
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
          }

          // Check for redirect URL
          var redirectUrl = form.getAttribute('data-redirect');
          if (redirectUrl) {
            window.open(redirectUrl, '_blank');
          }

          form.style.display = 'none';
          if (failBox) failBox.style.display = 'none';
          if (doneBox) doneBox.style.display = 'block';
          form.reset();
        }

        function showError() {
          // Keep the form visible so user can retry
          if (doneBox) doneBox.style.display = 'none';
          if (failBox) failBox.style.display = 'block';
          resetButton();
        }

        function fallbackFormPost() {
          // Ad blocker or network error blocked fetch - submit as regular form POST.
          // The server will redirect back with ?de_form=success or ?de_form=error.
          var fallbackForm = document.createElement('form');
          fallbackForm.method = 'POST';
          fallbackForm.action = endpoint;
          fallbackForm.style.display = 'none';

          // Copy all form data to the fallback form
          for (var pair of formData.entries()) {
            var input = document.createElement('input');
            input.type = 'hidden';
            input.name = pair[0];
            input.value = pair[1];
            fallbackForm.appendChild(input);
          }

          document.body.appendChild(fallbackForm);
          fallbackForm.submit();
        }

        var captchaRetried = false;

        function sendFormData() {
          fetch(endpoint, {
            method: 'POST',
            body: formData,
            headers: {
              Accept: 'application/json',
            },
          })
            .then(function (res) {
              return res
                .json()
                .catch(function () {
                  return {};
                })
                .then(function (data) {
                  if (res.ok && data.status === 'ok') {
                    showSuccess();
                  } else if (
                    res.status === 422 &&
                    data &&
                    data.error === 'Captcha verification failed' &&
                    !captchaRetried
                  ) {
                    // The server requires a captcha this page didn't satisfy —
                    // e.g. the CRM toggle was enabled while this page was
                    // already open, or a stale cached config. Re-check the
                    // config fresh (bypassing cache) and retry exactly once.
                    captchaRetried = true;
                    refreshCaptchaAndRetry();
                  } else {
                    showError();
                  }
                });
            })
            .catch(function (err) {
              // Network error - likely blocked by ad blocker.
              // Fall back to regular form POST.
              console.warn('DE Form: fetch blocked, falling back to form POST', err);
              fallbackFormPost();
            });
        }

        // Re-fetch this form's config bypassing the browser cache, set up the
        // widget if needed, obtain a token and resend. Called at most once per
        // submission, so it can never loop.
        function refreshCaptchaAndRetry() {
          var configUrl = configUrlFor(form);
          if (!configUrl) {
            showError();
            return;
          }
          fetch(configUrl, {
            headers: { Accept: 'application/json' },
            cache: 'reload',
          })
            .then(function (res) {
              return res.ok ? res.json() : null;
            })
            .then(function (cfg) {
              if (!cfg || !cfg.require_captcha || !cfg.recaptcha_sitekey) {
                // Config no longer says protected — just resend once.
                sendFormData();
                return;
              }
              if (!form._deCaptcha) {
                setupCaptcha(form, cfg.recaptcha_sitekey, cfg.recaptcha_action);
              }
              getCaptchaToken(form._deCaptcha).then(function (token) {
                if (token) {
                  formData.set('g-recaptcha-response', token);
                }
                sendFormData();
              });
            })
            .catch(function () {
              showError();
            });
        }

        // If this form is reCAPTCHA-protected, obtain a token before sending.
        // Unprotected forms (the default) skip straight to the existing flow.
        // Race the config check against a hard timeout so a stalled config
        // request can never hang submission (defaults to "unprotected"; a
        // genuinely protected form would then get a server 422 and retry).
        var configReady = Promise.race([
          Promise.resolve(form._deConfigReady),
          new Promise(function (resolve) {
            setTimeout(function () {
              resolve(false);
            }, 3000);
          }),
        ]);

        configReady
          .then(function (isProtected) {
            return isProtected ? getCaptchaToken(form._deCaptcha) : null;
          })
          .then(function (token) {
            if (token) {
              formData.set('g-recaptcha-response', token);
            }
            sendFormData();
          })
          .catch(function () {
            sendFormData();
          });
      },
      true,
    ); // useCapture=true to run before Webflow's handler
  }

  // ===========================================
  // 6. INIT ON DOM READY
  // ===========================================
  document.addEventListener('DOMContentLoaded', function () {
    storeUtmParams();
    checkFallbackResult();
    document.querySelectorAll(DE_FORM_SELECTOR).forEach(enhanceForm);
  });

  // ===========================================
  // 7. OBSERVE FOR DYNAMICALLY ADDED FORMS
  // ===========================================
  var observer = new MutationObserver(function (mutations) {
    mutations.forEach(function (mutation) {
      mutation.addedNodes.forEach(function (node) {
        if (node.nodeType === 1) {
          if (node.tagName === 'FORM' && (node.getAttribute('action') || '').includes('digitalestates.dk')) {
            enhanceForm(node);
          }
          if (node.querySelectorAll) {
            node.querySelectorAll(DE_FORM_SELECTOR).forEach(enhanceForm);
          }
        }
      });
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // ===========================================
  // 8. URL CHANGE LISTENER (for SPA navigation)
  // ===========================================
  var _pushState = history.pushState;
  var _replaceState = history.replaceState;

  history.pushState = function () {
    var result = _pushState.apply(this, arguments);
    document.querySelectorAll(DE_FORM_SELECTOR).forEach(populateTrackingFields);
    return result;
  };

  history.replaceState = function () {
    var result = _replaceState.apply(this, arguments);
    document.querySelectorAll(DE_FORM_SELECTOR).forEach(populateTrackingFields);
    return result;
  };

  window.addEventListener('popstate', function () {
    document.querySelectorAll(DE_FORM_SELECTOR).forEach(populateTrackingFields);
  });

  // ===========================================
  // 9. CONTACT POPUP HANDLER
  // ===========================================
  document.addEventListener('DOMContentLoaded', function () {
    var modal = document.querySelector('[webflow-visibility="popup"]');
    var selector = '[data-webflow-popup="kontakt"]';

    document.addEventListener('click', function (e) {
      var trigger = e.target.closest(selector);
      if (!trigger) return;
      e.preventDefault();
      if (modal) modal.style.display = 'flex';
    });
  });
})();
