/**
 * commerce-os analytics — ca.js
 * ---------------------------------------------------------------------------
 * Zero-dependency, drop-in storefront tracker. Embed once:
 *
 *   <script src="https://api.<host>/ca.js" data-key="pk_live_..." defer></script>
 *
 * Posts behavioral events to the headless ingest API (POST /api/events?k=KEY —
 * the query-param form so `navigator.sendBeacon` can deliver on page unload).
 *
 * Cookieless by default: identifiers live in first-party localStorage, never in
 * cookies. Auto-captures page views (incl. SPA route changes). Click and form
 * capture are OPT-IN (data-autocapture, or per-element data-ca-event). Exposes a
 * small imperative API on `window.ca` for custom events + ecommerce funnel.
 *
 * Config via data-* on the script tag:
 *   data-key             (required) publishable ingest/API key
 *   data-endpoint        ingest origin; defaults to the script's own origin
 *   data-autocapture     "none" (default) | "click" | "form" | "all"
 *   data-respect-dnt     honor Do-Not-Track / GPC (default off)
 *   data-require-consent buffer events until ca('consent','grant') (default off)
 *   data-debug           log to console
 */
type Dict = Record<string, unknown>;
type QueuedEvent = Dict;

interface CaWindow extends Window {
  ca?: ((...args: unknown[]) => void) & { q?: unknown[][] };
}

(function () {
  "use strict";
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const w = window as CaWindow;

  // ── Locate our own <script> + read configuration ─────────────────────────
  const self =
    (document.currentScript as HTMLScriptElement | null) ||
    (function () {
      const list = document.getElementsByTagName("script");
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].src && /ca\.js(\?|$)/.test(list[i].src)) return list[i];
      }
      return null;
    })();

  const ds: DOMStringMap = (self && self.dataset) || {};
  const KEY = ds.key || "";
  const log = (...a: unknown[]) => {
    if (ds.debug != null && window.console) console.log("[ca]", ...a);
  };
  if (!KEY) {
    if (window.console)
      console.warn("[ca] missing data-key — tracking disabled");
    return;
  }

  const bool = (v: string | undefined) => v === "" || v === "true" || v === "1";
  const ENDPOINT = (
    ds.endpoint || (self ? new URL(self.src).origin : location.origin)
  ).replace(/\/+$/, "");
  const AUTO = (ds.autocapture || "none").toLowerCase();
  const AUTO_CLICK = AUTO === "all" || AUTO.indexOf("click") >= 0;
  const AUTO_FORM = AUTO === "all" || AUTO.indexOf("form") >= 0;
  const RESPECT_DNT = bool(ds.respectDnt);
  const REQUIRE_CONSENT = bool(ds.requireConsent);
  const INGEST_URL = ENDPOINT + "/api/events?k=" + encodeURIComponent(KEY);

  // Honor Do-Not-Track / Global Privacy Control when asked to.
  if (RESPECT_DNT) {
    const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
    const dnt =
      nav.doNotTrack === "1" ||
      (w as unknown as { doNotTrack?: string }).doNotTrack === "1" ||
      nav.globalPrivacyControl === true;
    if (dnt) {
      log("DNT/GPC signaled — tracking disabled");
      return;
    }
  }

  // ── Safe storage (localStorage may throw in private mode / be blocked) ────
  const store = {
    get(k: string): string | null {
      try {
        return window.localStorage.getItem(k);
      } catch {
        return mem[k] ?? null;
      }
    },
    set(k: string, v: string) {
      try {
        window.localStorage.setItem(k, v);
      } catch {
        mem[k] = v;
      }
    },
  };
  const mem: Record<string, string> = {};

  const uuid = () => {
    const c = window.crypto as Crypto | undefined;
    if (c && typeof c.randomUUID === "function") return c.randomUUID();
    return "xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
      const r = (Math.random() * 16) | 0;
      return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  };

  // ── Identity: persistent visitor + 30-min-inactivity session (cookieless) ─
  const V_KEY = "_ca_vid";
  const S_KEY = "_ca_sid";
  const S_TS = "_ca_sid_ts";
  const SESSION_TTL = 30 * 60 * 1000;

  const visitorId = (() => {
    let v = store.get(V_KEY);
    if (!v) {
      v = uuid();
      store.set(V_KEY, v);
    }
    return v;
  })();

  let sessionIsNew = false;
  function sessionId(): string {
    const now = Date.now();
    let sid = store.get(S_KEY);
    const ts = parseInt(store.get(S_TS) || "0", 10);
    if (!sid || !ts || now - ts > SESSION_TTL) {
      sid = uuid();
      sessionIsNew = true;
      store.set(S_KEY, sid);
    }
    store.set(S_TS, String(now));
    return sid;
  }

  // ── First-touch attribution (captured at load, kept for the session) ──────
  const attribution = (() => {
    const qs = new URLSearchParams(location.search);
    return {
      referrer: document.referrer || undefined,
      utmSource: qs.get("utm_source") || undefined,
      utmMedium: qs.get("utm_medium") || undefined,
      utmCampaign: qs.get("utm_campaign") || undefined,
      // Which creative was clicked. Captured with the rest of the tuple and
      // held for the session, so every event of a visit reports against the
      // same Ad rather than only the landing hit.
      utmContent: qs.get("utm_content") || undefined,
    };
  })();

  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const clip = (s: unknown, n: number) =>
    typeof s === "string" ? s.slice(0, n) : undefined;

  // ── Transport: batch + flush (sendBeacon primary, fetch keepalive fallback)─
  let queue: QueuedEvent[] = [];
  let timer: number | null = null;
  let consent = REQUIRE_CONSENT ? false : true;
  const FLUSH_AT = 20;
  const FLUSH_MS = 5000;

  function schedule() {
    if (timer != null) return;
    timer = window.setTimeout(() => {
      timer = null;
      flush();
    }, FLUSH_MS);
  }

  function flush(sync?: boolean) {
    if (!consent || queue.length === 0) return;
    const batch = queue.splice(0, 100);
    const payload = JSON.stringify({ events: batch });
    log("flush", batch.length, sync ? "(sync)" : "");

    let beaconOk = false;
    if (sync && navigator.sendBeacon) {
      try {
        beaconOk = navigator.sendBeacon(
          INGEST_URL,
          new Blob([payload], { type: "application/json" }),
        );
      } catch {
        beaconOk = false;
      }
    }
    if (!beaconOk) {
      try {
        fetch(INGEST_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          keepalive: true,
          credentials: "omit",
          mode: "cors",
        }).catch(() => reQueue(batch));
      } catch {
        reQueue(batch);
      }
    }
  }

  // On hard failure, put events back so the next flush retries (bounded).
  function reQueue(batch: QueuedEvent[]) {
    if (queue.length < 500) queue = batch.concat(queue);
  }

  // ── Core: enqueue one event ───────────────────────────────────────────────
  function track(type: string, opts?: Dict) {
    try {
      const o = opts || {};
      const ev: QueuedEvent = {
        type,
        sessionId: sessionId(),
        visitorId,
        occurredAt: new Date().toISOString(),
        path: clip(o.path ?? location.pathname + location.search, 1024),
        referrer: clip(attribution.referrer, 1024),
        utmSource: clip(attribution.utmSource, 255),
        utmMedium: clip(attribution.utmMedium, 255),
        utmCampaign: clip(attribution.utmCampaign, 255),
        utmContent: clip(attribution.utmContent, 255),
      };
      if (o.eventName) ev.eventName = clip(o.eventName, 128);
      // productId/variantId must be UUIDs (server validates) — otherwise carry
      // the caller's own id inside properties so nothing 400s.
      const props: Dict = (o.properties as Dict) || {};
      assignId(ev, props, "productId", o.productId);
      assignId(ev, props, "variantId", o.variantId);
      if (Object.keys(props).length) ev.properties = props;

      // strip undefined for a compact payload
      for (const k in ev) if (ev[k] === undefined) delete ev[k];

      queue.push(ev);
      log("track", type, ev);
      if (queue.length >= FLUSH_AT) flush();
      else schedule();
    } catch (e) {
      log("track error", e);
    }
  }

  function assignId(ev: Dict, props: Dict, field: string, val: unknown) {
    if (val == null) return;
    if (typeof val === "string" && UUID_RE.test(val)) ev[field] = val;
    else props[field] = val;
  }

  // ── Page views (incl. SPA route changes) ──────────────────────────────────
  let lastPath = "";
  function page(opts?: Dict) {
    const path = location.pathname + location.search;
    lastPath = path;
    track("page_view", { path, ...(opts || {}) });
  }

  function patchHistory() {
    const h = window.history;
    const wrap = (name: "pushState" | "replaceState") => {
      const orig = h[name];
      h[name] = function (this: History, ...args: unknown[]) {
        const r = (orig as (...a: unknown[]) => unknown).apply(this, args);
        onRouteChange();
        return r;
      } as History[typeof name];
    };
    wrap("pushState");
    wrap("replaceState");
    window.addEventListener("popstate", onRouteChange);
  }
  function onRouteChange() {
    // microtask so the framework updates location first
    window.setTimeout(() => {
      const path = location.pathname + location.search;
      if (path !== lastPath) page();
    }, 0);
  }

  // ── Opt-in autocapture: clicks ────────────────────────────────────────────
  function actionable(el: Element | null): HTMLElement | null {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const h = n as HTMLElement;
      const tag = h.tagName;
      if (h.dataset && h.dataset.caEvent != null) return h;
      if (
        tag === "A" ||
        tag === "BUTTON" ||
        h.getAttribute("role") === "button" ||
        (tag === "INPUT" &&
          /^(submit|button)$/i.test((h as HTMLInputElement).type))
      )
        return h;
    }
    return null;
  }

  function onClick(e: MouseEvent) {
    try {
      const el = actionable(e.target as Element);
      if (!el) return;
      const explicit = el.dataset && el.dataset.caEvent != null;
      if (!AUTO_CLICK && !explicit) return; // opt-in only
      const props: Dict = {
        tag: el.tagName.toLowerCase(),
        text: clip((el.textContent || "").trim().replace(/\s+/g, " "), 120),
      };
      if (el.id) props.id = el.id;
      const href = el.getAttribute("href");
      if (href) props.href = clip(href, 1024);
      collectData(el, props);
      track("click", {
        eventName:
          (el.dataset && el.dataset.caEvent) || props.text || props.tag,
        properties: props,
      });
    } catch (err) {
      log("click error", err);
    }
  }

  // ── Opt-in autocapture: form submissions (field NAMES only, never values) ─
  function onSubmit(e: Event) {
    try {
      const form = e.target as HTMLFormElement;
      if (!form || form.tagName !== "FORM") return;
      const explicit =
        form.dataset &&
        (form.dataset.caEvent != null || form.dataset.caTrack != null);
      if (!AUTO_FORM && !explicit) return; // opt-in only
      const fields: string[] = [];
      const els = form.elements;
      for (let i = 0; i < els.length; i++) {
        const f = els[i] as HTMLInputElement;
        if (f.name && f.type !== "password" && fields.indexOf(f.name) < 0) {
          fields.push(f.name);
        }
      }
      const props: Dict = { fields };
      if (form.id) props.id = form.id;
      if (form.getAttribute("name")) props.name = form.getAttribute("name");
      const action = form.getAttribute("action");
      if (action) props.action = clip(action.split("?")[0], 1024);
      collectData(form, props);
      track("form_submit", {
        eventName:
          (form.dataset && form.dataset.caEvent) ||
          form.id ||
          form.getAttribute("name") ||
          "form",
        properties: props,
      });
    } catch (err) {
      log("submit error", err);
    }
  }

  // Copy any data-ca-* (besides -event/-track) onto the event properties.
  function collectData(el: HTMLElement, props: Dict) {
    const d = el.dataset;
    if (!d) return;
    for (const k in d) {
      if (k.indexOf("ca") === 0 && k !== "caEvent" && k !== "caTrack") {
        const name = k.slice(2, 3).toLowerCase() + k.slice(3);
        props[name] = clip(d[k], 255);
      }
    }
  }

  // ── Public imperative API: window.ca('command', ...args) ──────────────────
  const HELPERS: Record<string, string> = {
    productView: "product_view",
    addToCart: "add_to_cart",
    checkoutStart: "checkout_start",
    purchase: "purchase",
  };

  function api(...args: unknown[]) {
    try {
      const command = args[0];
      switch (command) {
        case "page":
          page(args[1] as Dict);
          break;
        case "track":
          track("custom", {
            eventName: args[1] as string,
            properties: args[2] as Dict,
          });
          break;
        case "consent":
          if (args[1] === "grant" || args[1] === "granted") {
            consent = true;
            flush();
          } else {
            consent = false;
            queue = [];
          }
          break;
        case "identify":
          if (typeof args[1] === "string") store.set(V_KEY, args[1]);
          break;
        default:
          if (typeof command === "string" && HELPERS[command]) {
            track(HELPERS[command], args[1] as Dict);
          } else if (typeof command === "string") {
            // treat unknown string as a custom event name
            track("custom", {
              eventName: command,
              properties: args[1] as Dict,
            });
          }
      }
    } catch (e) {
      log("api error", e);
    }
  }

  // Drain any queued calls made before the script loaded (snippet pattern).
  const pending = w.ca && (w.ca as { q?: unknown[][] }).q;
  w.ca = api as CaWindow["ca"];
  if (pending && pending.length) {
    for (let i = 0; i < pending.length; i++) api(...(pending[i] as unknown[]));
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  sessionId(); // resolves + rotates before first event
  if (sessionIsNew) track("session_start");
  page();
  patchHistory();
  if (AUTO_CLICK || document.querySelector("[data-ca-event]")) {
    document.addEventListener("click", onClick, true);
  }
  document.addEventListener("submit", onSubmit, true);

  // Reliable delivery on tab hide / unload.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush(true);
  });
  window.addEventListener("pagehide", () => flush(true));

  log("initialized", { endpoint: ENDPOINT, autocapture: AUTO, visitorId });
})();
