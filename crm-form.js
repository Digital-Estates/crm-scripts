(function () {
  var DE_FORM_SELECTOR = 'form[action*="digitalestates.dk"]';

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
      'property_id',
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

    // Property ID / Bolig ID (from URL param)
    var propertyField = form.querySelector('input[name="property_id"]');
    if (propertyField) {
      propertyField.value = urlParams.get('bolig-id') || '';
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
        e.preventDefault();
        // Prevent Webflow's native form handler from also processing this
        e.stopImmediatePropagation();

        if (isSubmitting) return;
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

        function showSuccess() {
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
