const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const snippetPath = path.join(__dirname, "monark.js");
const snippetSource = fs.readFileSync(snippetPath, "utf8");

class MemoryStorage {
  constructor(initial = {}) {
    this.values = new Map(Object.entries(initial));
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }
}

class FakeCustomEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.detail = options.detail;
    this.bubbles = Boolean(options.bubbles);
    this.cancelable = Boolean(options.cancelable);
    this.defaultPrevented = false;
  }

  preventDefault() {
    if (this.cancelable) this.defaultPrevented = true;
  }
}

class FakeForm {
  constructor(fields = {}, attributes = {}, consent = null) {
    this.fields = fields;
    this.attributes = attributes;
    this.consent = consent;
    this.listeners = new Map();
    this.events = [];
    this.nativeSubmissions = 0;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatchEvent(event) {
    this.events.push(event);
    for (const listener of this.listeners.get(event.type) || []) listener(event);
    return !event.defaultPrevented;
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  querySelector(selector) {
    return selector === "[data-monark-consent]" ? this.consent : null;
  }

  triggerSubmit() {
    let prevented = false;
    this.dispatchEvent({
      type: "submit",
      preventDefault() {
        prevented = true;
      },
    });
    return prevented;
  }
}

function createHarness(options = {}) {
  const localStorage = options.localStorage || new MemoryStorage();
  const sessionStorage = options.sessionStorage || new MemoryStorage();
  const forms = options.forms || [];
  const calls = [];
  const location = new URL(options.url || "https://example.com/contact");
  let uuidCounter = 0;

  function HTMLFormElement() {}
  HTMLFormElement.prototype.submit = function submit() {
    this.nativeSubmissions += 1;
  };

  const scriptAttributes = {
    "data-endpoint": "https://api.example.com/v1/leads",
    "data-key": "mk_live_test_secret",
    "data-auto-bind": options.autoBind === false ? "false" : "true",
    ...(options.scriptAttributes || {}),
  };
  const script = {
    getAttribute(name) {
      return scriptAttributes[name] ?? null;
    },
  };

  const document = {
    cookie: options.cookie || "",
    currentScript: script,
    readyState: "complete",
    referrer: options.referrer || "",
    getElementsByTagName() {
      return [script];
    },
    querySelectorAll() {
      return forms;
    },
    addEventListener() {},
  };

  const fetchImpl =
    options.fetch ||
    (async () => {
      return { ok: true, json: async () => ({ status: "created" }) };
    });

  const window = {
    HTMLFormElement,
    crypto: {
      randomUUID() {
        uuidCounter += 1;
        return `00000000-0000-4000-8000-${String(uuidCounter).padStart(12, "0")}`;
      },
    },
    localStorage,
    sessionStorage,
    location,
  };

  class FormData {
    constructor(form) {
      this.form = form;
    }

    get(name) {
      return this.form.fields[name] ?? null;
    }
  }

  const context = vm.createContext({
    Boolean,
    CustomEvent: FakeCustomEvent,
    Date,
    FormData,
    Math,
    Object,
    Promise,
    URL,
    URLSearchParams,
    WeakMap,
    console,
    decodeURIComponent,
    document,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return fetchImpl(url, init);
    },
    isFinite,
    window,
  });

  vm.runInContext(snippetSource, context, { filename: snippetPath });
  return { calls, localStorage, sessionStorage, window };
}

function assertNoNulls(value) {
  if (Array.isArray(value)) {
    value.forEach(assertNoNulls);
    return;
  }
  if (value && typeof value === "object") {
    Object.values(value).forEach(assertNoNulls);
    return;
  }
  assert.notEqual(value, null);
}

test("buildPayload omits null and blank optional values", () => {
  const { window } = createHarness({ autoBind: false });
  const payload = window.monark.buildPayload({
    source: "",
    name: "   ",
    phone: "+91 99999 99999",
    email: null,
    city: undefined,
    project_id: "",
    notes: "",
    consent: { marketing: false, policy_version: "" },
  });

  assert.equal(payload.source, "website_form");
  assert.equal(payload.phone, "+91 99999 99999");
  assert.equal("name" in payload, false);
  assert.equal("email" in payload, false);
  assert.equal("city" in payload, false);
  assert.equal("project_id" in payload, false);
  assert.equal("notes" in payload, false);
  assert.deepEqual({ ...payload.consent }, { marketing: false });
  assertNoNulls(payload);
});

test("session timing is per-tab and capped at the API maximum", () => {
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage({
    monark_session: JSON.stringify({ startedAt: Date.now() - 172800000 }),
  });
  const { window } = createHarness({
    autoBind: false,
    localStorage,
    sessionStorage,
  });

  assert.equal(window.monark.buildPayload({ email: "buyer@example.com" }).time_on_page_seconds, 86400);
  assert.equal(localStorage.getItem("monark_session"), null);
  assert.notEqual(sessionStorage.getItem("monark_session"), null);
});

test("first and last campaign touches are both retained", () => {
  const localStorage = new MemoryStorage();
  createHarness({
    autoBind: false,
    localStorage,
    url: "https://example.com/?gclid=first-click&utm_source=google",
  });
  const second = createHarness({
    autoBind: false,
    localStorage,
    url: "https://example.com/return?fbclid=last-click&utm_source=facebook",
  });

  const attribution = second.window.monark.getAttribution();
  const payload = second.window.monark.buildPayload({ email: "buyer@example.com" });
  assert.equal(attribution.firstTouch.gclid, "first-click");
  assert.equal(attribution.firstTouch.utm_source, "google");
  assert.equal(attribution.lastTouch.fbclid, "last-click");
  assert.equal(attribution.lastTouch.utm_source, "facebook");
  assert.equal(payload.gclid, "first-click");
  assert.equal(payload.first_touch.gclid, "first-click");
  assert.equal(payload.last_touch.fbclid, "last-click");
});

test("the first campaign replaces an earlier direct-only visit", () => {
  const localStorage = new MemoryStorage();
  createHarness({ autoBind: false, localStorage, url: "https://example.com/" });
  const campaign = createHarness({
    autoBind: false,
    localStorage,
    url: "https://example.com/?gclid=first-campaign",
  });

  const attribution = campaign.window.monark.getAttribution();
  assert.equal(attribution.firstTouch.gclid, "first-campaign");
  assert.equal(attribution.lastTouch.gclid, "first-campaign");
});

test("the same submission object keeps one event and idempotency ID", async () => {
  const harness = createHarness({ autoBind: false });
  const fields = { email: "buyer@example.com" };
  const first = harness.window.monark.buildPayload(fields);
  const second = harness.window.monark.buildPayload(fields);
  assert.equal(first.event_id, second.event_id);

  await harness.window.monark.submitLead(fields);
  await harness.window.monark.submitLead(fields);
  assert.equal(harness.calls[0].init.headers["Idempotency-Key"], first.event_id);
  assert.equal(harness.calls[1].init.headers["Idempotency-Key"], first.event_id);
});

test("auto-bound forms deny consent by default and use an explicit POST fallback", async () => {
  const form = new FakeForm(
    { email: "buyer@example.com" },
    { action: "/backup-lead", method: "post" },
  );
  const harness = createHarness({
    forms: [form],
    fetch: async () => {
      throw new Error("network unavailable");
    },
  });

  assert.equal(form.triggerSubmit(), true);
  await new Promise((resolve) => setImmediate(resolve));

  const body = JSON.parse(harness.calls[0].init.body);
  assert.deepEqual(
    { ...body.consent },
    {
      marketing: false,
      ad_user_data: false,
      ad_personalization: false,
      collected_via: "https://example.com/contact",
    },
  );
  assert.equal(form.nativeSubmissions, 1);
  assert.equal(form.events.some((event) => event.type === "monark:error"), true);
});

test("API failure never puts lead PII into an implicit GET submission", async () => {
  const form = new FakeForm({ email: "buyer@example.com", phone: "+919876543210" });
  createHarness({
    forms: [form],
    fetch: async () => {
      throw new Error("network unavailable");
    },
  });

  form.triggerSubmit();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(form.nativeSubmissions, 0);
  assert.equal(form.events.some((event) => event.type === "monark:error"), true);
});

test("the deployed public snippet is byte-for-byte identical", () => {
  const publicPath = path.join(__dirname, "../../apps/web/public/monark.js");
  assert.equal(fs.readFileSync(publicPath, "utf8"), snippetSource);
});
