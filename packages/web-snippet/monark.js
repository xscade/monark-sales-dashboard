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

  function readStore(key) {
    try {
      var raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null; // Safari private mode, storage disabled, quota exceeded.
    }
  }

  function writeStore(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      /* non-fatal — we still send whatever is in memory */
    }
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
    var stored = readStore(STORAGE_KEY);

    var expired =
      !stored ||
      !stored.capturedAt ||
      now() - stored.capturedAt > ATTRIBUTION_TTL_DAYS * 86400000;

    var incoming = { capturedAt: now(), landingPage: window.location.href };
    var sawClickId = false;

    CLICK_PARAMS.concat(UTM_PARAMS).forEach(function (key) {
      if (params[key]) {
        incoming[key] = params[key];
        if (CLICK_PARAMS.indexOf(key) !== -1) sawClickId = true;
      }
    });

    if (expired) {
      incoming.referrer = document.referrer || null;
      writeStore(STORAGE_KEY, incoming);
      return incoming;
    }

    // Only a NEW click id starts a new attribution window. A plain revisit with
    // no ad click must not reset the clock or clear what we already know.
    if (sawClickId) {
      incoming.referrer = document.referrer || null;
      incoming.previous = {
        capturedAt: stored.capturedAt,
        landingPage: stored.landingPage,
      };
      writeStore(STORAGE_KEY, incoming);
      return incoming;
    }

    return stored;
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

  var attribution = captureAttribution();

  var session = readStore(SESSION_KEY) || { startedAt: now() };
  writeStore(SESSION_KEY, session);

  function buildPayload(fields) {
    var payload = {
      source: fields.source || "website_form",
      name: fields.name || null,
      phone: fields.phone || null,
      email: fields.email || null,
      city: fields.city || null,
      notes: fields.notes || null,
      project_id: config.project || fields.project_id || null,
      landing_page: attribution.landingPage || window.location.href,
      referrer: attribution.referrer || document.referrer || null,

      // Shared with the Pixel. Without it Meta counts this enquiry twice.
      event_id: fields.event_id || uuid(),

      // Meta browser cookies. Sending both materially raises match quality.
      fbp: getCookie("_fbp"),
      fbc: getCookie("_fbc"),

      time_on_page_seconds: Math.round((now() - session.startedAt) / 1000),
    };

    CLICK_PARAMS.concat(UTM_PARAMS).forEach(function (key) {
      if (attribution[key]) payload[key] = attribution[key];
    });

    // The attribution clock runs from the click, not from form submit. Passing
    // it lets the server compute an honest 90-day expiry for a lead that was
    // captured three days after the ad click.
    if (attribution.capturedAt) {
      payload.clicked_at = new Date(attribution.capturedAt).toISOString();
    }

    if (fields.consent) payload.consent = fields.consent;

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
        var data = new FormData(form);
        var consentEl = form.querySelector("[data-monark-consent]");
        var granted = consentEl ? consentEl.checked : true;

        submitLead({
          name: data.get("name"),
          phone: data.get("phone"),
          email: data.get("email"),
          city: data.get("city"),
          notes: data.get("message") || data.get("notes"),
          source: form.getAttribute("data-monark-source") || "website_form",
          consent: {
            marketing: granted,
            ad_user_data: granted,
            ad_personalization: granted,
            collected_via: window.location.href,
          },
        })
          .then(function (result) {
            form.dispatchEvent(
              new CustomEvent("monark:success", { detail: result, bubbles: true }),
            );
            var redirect = form.getAttribute("data-monark-redirect");
            if (redirect) window.location.href = redirect;
          })
          .catch(function (error) {
            // Never leave the visitor staring at a dead form. Surface the
            // failure so the page can fall back to its own handling.
            form.dispatchEvent(
              new CustomEvent("monark:error", { detail: error, bubbles: true }),
            );
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
