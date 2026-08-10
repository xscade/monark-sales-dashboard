/**
 * Monark lead capture snippet.
 *
 * Drop this on every page of every site and landing page:
 *
 *   <script src="https://cdn.monark.in/monark.js"
 *           data-endpoint="https://api.monark.in/v1/leads"
 *           data-key="mk_live_xxxx_yyyy"></script>
 *
 * ── Why this file exists ─────────────────────────────────────────────────
 * Click identifiers are capture-or-lose-forever. If `gclid` is not read out of
 * the URL and persisted at the moment the visitor lands, that conversion can
 * NEVER be attributed — there is no backfill, no API to look it up later.
 *
 * And the loss is not rare. The common real-estate journey is:
 *
 *   click ad → land on /4bhk-vizag → browse → leave
 *   ...three days later...
 *   type the domain directly → fill the enquiry form
 *
 * A form that only reads the CURRENT URL sees no gclid on that second visit and
 * silently reports an organic lead. The ad that actually produced the buyer
 * gets no credit, and the campaign looks worse than it is.
 *
 * So: capture on first touch, persist for 90 days (Google's click window),
 * attach at submit time.
 */
(function () {
  "use strict";

  var STORAGE_KEY = "monark_attribution";
  var SESSION_KEY = "monark_session";
  var MAX_SESSION_SECONDS = 86400;
  // Matches Google's GCLID lifespan — holding it longer would attach a click id
  // that Google has already expired and will silently drop.
  var ATTRIBUTION_TTL_DAYS = 90;

  var script =
    document.currentScript ||
    (function () {
      var all = document.getElementsByTagName("script");
      return all[all.length - 1];
    })();

  var config = {
    endpoint: (script && script.getAttribute("data-endpoint")) || "",
    apiKey: (script && script.getAttribute("data-key")) || "",
    project: (script && script.getAttribute("data-project")) || null,
    autoBind: (script && script.getAttribute("data-auto-bind")) !== "false",
  };

  var CLICK_PARAMS = [
    "gclid",
    "gbraid",
    "wbraid",
    "fbclid",
    "ctwa_clid",
    "msclkid",
    "li_fat_id",
  ];
  var UTM_PARAMS = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
    "utm_id",
  ];

  function now() {
    return new Date().getTime();
  }

  function getStorage(kind) {
    try {
      return kind === "session" ? window.sessionStorage : window.localStorage;
    } catch (e) {
      return null;
    }
  }

  function readStore(kind, key) {
    try {
      var storage = getStorage(kind);
      var raw = storage && storage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null; // Safari private mode, storage disabled, quota exceeded.
    }
  }

  function writeStore(kind, key, value) {
    try {
      var storage = getStorage(kind);
      if (storage) storage.setItem(key, JSON.stringify(value));
    } catch (e) {
      /* non-fatal — we still send whatever is in memory */
    }
  }

  function hasValue(value) {
    if (value === null || value === undefined) return false;
    if (typeof value === "string") return value.trim() !== "";
    if (typeof value === "number") return isFinite(value);
    if (Object.prototype.toString.call(value) === "[object Object]") {
      return Object.keys(value).length > 0;
    }
    return true;
  }

  function compactObject(value) {
    if (Object.prototype.toString.call(value) !== "[object Object]") {
      return value;
    }

    var compacted = {};
    Object.keys(value).forEach(function (key) {
      var child = compactObject(value[key]);
      if (hasValue(child)) compacted[key] = child;
    });
    return compacted;
  }

  function setOptional(target, key, value) {
    var compacted = compactObject(value);
    if (hasValue(compacted)) target[key] = compacted;
  }

  function getCookie(name) {
    var match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
    return match ? decodeURIComponent(match[2]) : null;
  }

  function queryParams() {
    var out = {};
    try {
      var params = new URLSearchParams(window.location.search);
      params.forEach(function (value, key) {
        out[key.toLowerCase()] = value;
      });
    } catch (e) {
      /* very old browser */
    }
    return out;
  }

  /**
   * Capture attribution.
   *
   * FIRST TOUCH WINS for click identifiers. If a visitor arrives via Google,
   * leaves, and returns via a Meta retargeting ad, the original Google click is
   * what earned the demand — overwriting it would hand every conversion to
   * whichever retargeting campaign happened to touch them last.
   *
   * Last touch is recorded alongside, so both models stay available server-side.
   */
  function captureAttribution() {
    var params = queryParams();
    var stored = readStore("local", STORAGE_KEY);

    var incoming = { capturedAt: now(), landingPage: window.location.href };
    var sawAttribution = false;

    CLICK_PARAMS.concat(UTM_PARAMS).forEach(function (key) {
      if (params[key]) {
        incoming[key] = params[key];
        sawAttribution = true;
      }
    });
    setOptional(incoming, "referrer", document.referrer);

    function asTouch(value) {
      var touch = {};
      if (!value) return touch;
      if (typeof value.capturedAt === "number" && isFinite(value.capturedAt)) {
        touch.capturedAt = value.capturedAt;
      }
      setOptional(touch, "landingPage", value.landingPage);
      setOptional(touch, "referrer", value.referrer);
      CLICK_PARAMS.concat(UTM_PARAMS).forEach(function (key) {
        setOptional(touch, key, value[key]);
      });
      return touch;
    }

    function hasCampaignTouch(value) {
      var found = false;
      CLICK_PARAMS.concat(UTM_PARAMS).forEach(function (key) {
        if (hasValue(value[key])) found = true;
      });
      return found;
    }

    function withTouches(firstTouch, lastTouch) {
      var first = asTouch(firstTouch);
      var last = asTouch(lastTouch || firstTouch);
      var result = asTouch(first);
      result.firstTouch = first;
      result.lastTouch = last;
      return result;
    }

    var firstTouch = stored && asTouch(stored.firstTouch || stored);
    var lastTouch = stored && asTouch(stored.lastTouch || stored);
    var expired =
      !firstTouch ||
      !firstTouch.capturedAt ||
      now() - firstTouch.capturedAt > ATTRIBUTION_TTL_DAYS * 86400000;

    if (expired) {
      var fresh = withTouches(incoming, incoming);
      writeStore("local", STORAGE_KEY, fresh);
      return fresh;
    }

    // A campaign revisit updates only last touch. The original click remains
    // available at the legacy top level and in firstTouch for attribution.
    var capturedFirst =
      sawAttribution && !hasCampaignTouch(firstTouch) ? incoming : firstTouch;
    var captured = withTouches(
      capturedFirst,
      sawAttribution ? incoming : lastTouch,
    );
    writeStore("local", STORAGE_KEY, captured); // also migrates legacy records.
    return captured;
  }

  /** RFC4122-ish v4. Shared with the Meta Pixel so the browser-side Lead event
   *  and our server-side CAPI event deduplicate into one conversion. */
  function uuid() {
    if (window.crypto && window.crypto.randomUUID) {
      return window.crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  var generatedEventIds = typeof WeakMap === "function" ? new WeakMap() : null;

  function eventIdFor(fields) {
    if (hasValue(fields.event_id)) return fields.event_id;
    if (generatedEventIds && generatedEventIds.has(fields)) {
      return generatedEventIds.get(fields);
    }

    var eventId = uuid();
    if (generatedEventIds) generatedEventIds.set(fields, eventId);
    return eventId;
  }

  var attribution = captureAttribution();

  var session = readStore("session", SESSION_KEY);
  if (
    !session ||
    typeof session.startedAt !== "number" ||
    !isFinite(session.startedAt) ||
    session.startedAt > now()
  ) {
    session = { startedAt: now() };
  }
  writeStore("session", SESSION_KEY, session);

  function sessionSeconds() {
    var elapsed = Math.round((now() - session.startedAt) / 1000);
    return Math.min(MAX_SESSION_SECONDS, Math.max(0, elapsed));
  }

  function buildPayload(fields) {
    fields = fields && typeof fields === "object" ? fields : {};
    var firstTouch = attribution.firstTouch || attribution;
    var lastTouch = attribution.lastTouch || firstTouch;
    var payload = {
      source: hasValue(fields.source) ? fields.source : "website_form",
      // Shared with the Pixel. Without it Meta counts this enquiry twice.
      event_id: eventIdFor(fields),
      time_on_page_seconds: sessionSeconds(),
    };

    setOptional(payload, "name", fields.name);
    setOptional(payload, "phone", fields.phone);
    setOptional(payload, "email", fields.email);
    setOptional(payload, "city", fields.city);
    setOptional(payload, "notes", fields.notes);
    setOptional(payload, "project_id", config.project || fields.project_id);
    setOptional(payload, "landing_page", firstTouch.landingPage || window.location.href);
    setOptional(payload, "referrer", firstTouch.referrer || document.referrer);

    // Meta browser cookies. Sending both materially raises match quality.
    setOptional(payload, "fbp", getCookie("_fbp"));
    setOptional(payload, "fbc", getCookie("_fbc"));

    CLICK_PARAMS.concat(UTM_PARAMS).forEach(function (key) {
      setOptional(payload, key, firstTouch[key]);
    });

    // The API keeps unknown fields in raw_input, preserving both models while
    // the legacy top-level fields continue to represent first touch.
    setOptional(payload, "first_touch", firstTouch);
    setOptional(payload, "last_touch", lastTouch);

    // The attribution clock runs from the click, not from form submit. Passing
    // it lets the server compute an honest 90-day expiry for a lead that was
    // captured three days after the ad click.
    if (firstTouch.capturedAt) {
      payload.clicked_at = new Date(firstTouch.capturedAt).toISOString();
    }

    setOptional(payload, "consent", fields.consent);

    return payload;
  }

  function submitLead(fields) {
    if (!config.endpoint || !config.apiKey) {
      return Promise.reject(new Error("Monark: data-endpoint and data-key are required"));
    }

    var payload = buildPayload(fields || {});

    // Idempotency key survives a retry on a flaky mobile connection without
    // creating duplicate leads.
    var idempotencyKey = payload.event_id;

    return fetch(config.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + config.apiKey,
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(payload),
      keepalive: true, // survives the navigation that usually follows submit
    })
      .then(function (response) {
        return response.json().then(function (body) {
          if (!response.ok) throw new Error(body.error || "Submission failed");

          // Fire the Pixel with the SAME event_id so Meta collapses the
          // browser event and the server event into one conversion.
          if (window.fbq) {
            window.fbq("track", "Lead", {}, { eventID: payload.event_id });
          }
          if (window.gtag) {
            window.gtag("event", "generate_lead", { value: 0, currency: "INR" });
          }
          return body;
        });
      });
  }

  /**
   * Auto-bind forms marked `data-monark-form`.
   *
   * Reads inputs by name (name/phone/email/city) plus an optional consent
   * checkbox `data-monark-consent`. Submits via fetch, then lets the form's own
   * success handling continue.
   */
  function autoBind() {
    var forms = document.querySelectorAll("[data-monark-form]");
    Array.prototype.forEach.call(forms, function (form) {
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        if (form.__monarkSubmitting) return;
        form.__monarkSubmitting = true;
        form.__monarkEventId = form.__monarkEventId || uuid();

        var data = new FormData(form);
        var consentEl = form.querySelector("[data-monark-consent]");
        var granted = consentEl ? Boolean(consentEl.checked) : false;

        submitLead({
          name: data.get("name"),
          phone: data.get("phone"),
          email: data.get("email"),
          city: data.get("city"),
          notes: data.get("message") || data.get("notes"),
          source: form.getAttribute("data-monark-source") || "website_form",
          event_id: form.__monarkEventId,
          consent: {
            marketing: granted,
            ad_user_data: granted,
            ad_personalization: granted,
            collected_via: window.location.href,
          },
        })
          .then(function (result) {
            form.__monarkSubmitting = false;
            form.__monarkEventId = null;
            form.dispatchEvent(
              new CustomEvent("monark:success", { detail: result, bubbles: true }),
            );
            var redirect = form.getAttribute("data-monark-redirect");
            if (redirect) window.location.href = redirect;
          })
          .catch(function (error) {
            form.__monarkSubmitting = false;

            // Dispatching a cancelable event lets a host page opt into its own
            // recovery. Otherwise use native submission so capture failure
            // never drops the visitor's enquiry.
            var shouldSubmitNatively = form.dispatchEvent(
              new CustomEvent("monark:error", {
                detail: error,
                bubbles: true,
                cancelable: true,
              }),
            );
            var nativeAction = form.getAttribute("action");
            var nativeMethod = (form.getAttribute("method") || "").toLowerCase();
            var safeNativeFallback = false;
            if (nativeAction && nativeMethod === "post") {
              try {
                var fallbackUrl = new URL(nativeAction, window.location.href);
                safeNativeFallback =
                  fallbackUrl.protocol === "https:" ||
                  fallbackUrl.origin === window.location.origin;
              } catch (_) {
                safeNativeFallback = false;
              }
            }
            // An implicit browser fallback is GET to the current URL, which
            // would put phone/email/notes into history and access logs. Only a
            // deliberately configured POST fallback is safe to invoke.
            if (shouldSubmitNatively !== false && safeNativeFallback) {
              var formPrototype =
                window.HTMLFormElement && window.HTMLFormElement.prototype;
              if (formPrototype && typeof formPrototype.submit === "function") {
                formPrototype.submit.call(form);
              } else if (typeof form.submit === "function") {
                form.submit();
              }
            }
          });
      });
    });
  }

  window.monark = {
    submitLead: submitLead,
    getAttribution: function () {
      return attribution;
    },
    buildPayload: buildPayload,
  };

  if (config.autoBind) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", autoBind);
    } else {
      autoBind();
    }
  }
})();
