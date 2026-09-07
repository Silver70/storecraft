import { describe, expect, it } from "vitest";
import {
  applyPaste,
  fieldSpec,
  FIELDS,
  locateInStore,
  MAX_PAYLOAD_BYTES,
  MAX_URL_LENGTH,
  message,
  parseAdminMessage,
  parseFrameMessage,
  parseTarget,
  parseOrigin,
  parseUrl,
  sanitizeText,
  SESSION_PARAM,
} from "./protocol";

const session = "11111111-1111-4111-8111-111111111111";
const page = "22222222-2222-4222-8222-222222222222";
const id = "33333333-3333-4333-8333-333333333333";
const target = `product:${id}:name`;
const source = {};
const peer = { origin: "https://admin.example", source, session };
const preview = message(session, page, {
  type: "preview",
  target,
  value: "New name",
});
const region = {
  target,
  value: "Original",
  rect: { x: 100, y: 200, width: 300, height: 40 },
};
const event = (data: unknown) => ({ ...peer, data });
const nameLimit = FIELDS.product.name!.maxLength;

describe("target descriptors", () => {
  it("identifies the entity and field without page position", () => {
    expect(parseTarget(target)).toEqual({ kind: "product", id, field: "name" });
  });
  it.each([
    [`product:${id}:description`, "product", "description"],
    [`product:${id}:seoTitle`, "product", "seoTitle"],
    [`product:${id}:seoDescription`, "product", "seoDescription"],
    [`category:${id}:name`, "category", "name"],
    [`category:${id}:description`, "category", "description"],
  ])(
    "carries the entity kind as a real dimension: %s",
    (descriptor, kind, field) => {
      expect(parseTarget(descriptor)).toEqual({ kind, id, field });
    },
  );
  it.each([
    null,
    {},
    "",
    "product:1:name",
    `product:${id}`,
    `product:${id}:name:extra`,
    `product:${id}:price`,
    `category:${id}:seoTitle`,
    `variant:${id}:name`,
    `constructor:${id}:name`,
    `product:${id}:toString`,
    ` product:${id}:name`,
    `product:${id}:name `,
  ])("refuses malformed or unsupported descriptors: %j", (value) => {
    expect(parseTarget(value)).toBeNull();
  });
});

describe("field specifications", () => {
  it("describes a paragraph field differently from a single line", () => {
    expect(fieldSpec({ kind: "product", id, field: "description" })).toEqual({
      label: "Product description",
      maxLength: 5000,
      multiline: true,
    });
    expect(fieldSpec({ kind: "product", id, field: "name" }).multiline).toBe(
      false,
    );
  });
});

describe("origin configuration", () => {
  it.each([
    "*",
    "null",
    "https://admin.example/path",
    "https://admin.example/",
    "javascript:alert(1)",
    "https://user:pass@admin.example",
    undefined,
  ])("refuses an ambiguous origin: %j", (origin) => {
    expect(parseOrigin(origin)).toBeNull();
  });
  it("accepts an exact HTTP(S) origin including a development port", () => {
    expect(parseOrigin("http://localhost:3000")).toBe("http://localhost:3000");
  });
});

describe("text entering the Store", () => {
  const paragraph = fieldSpec({ kind: "product", id, field: "description" });
  const line = fieldSpec({ kind: "product", id, field: "name" });

  it("keeps markup as the literal characters a shopper will read", () => {
    expect(sanitizeText("<b>Bold</b> & <script>x</script>", paragraph)).toBe(
      "<b>Bold</b> & <script>x</script>",
    );
  });
  it("normalises the line endings a word processor pastes", () => {
    expect(sanitizeText("one\r\ntwo\rthree", paragraph)).toBe(
      "one\ntwo\nthree",
    );
  });
  it("drops control characters no storefront can render", () => {
    expect(sanitizeText("clean\u0000 text\u007f", paragraph)).toBe(
      "clean text",
    );
  });
  it("never lets a single-line field acquire a newline", () => {
    expect(sanitizeText("Summer\nSale", line)).toBe("Summer Sale");
    expect(sanitizeText("Summer\nSale", paragraph)).toBe("Summer\nSale");
  });
  it("inserts a paste at the selection as text", () => {
    expect(applyPaste("Winter boots", 0, 6, "Summer", line)).toEqual({
      ok: true,
      value: "Summer boots",
      caret: 6,
    });
  });
  it("refuses an oversized paste rather than truncating it", () => {
    expect(applyPaste("Name", 4, 4, "x".repeat(nameLimit), line)).toEqual({
      ok: false,
      reason: "oversized",
    });
    // The same paste fits a paragraph field: the limit belongs to the field.
    expect(applyPaste("Name", 4, 4, "x".repeat(nameLimit), paragraph).ok).toBe(
      true,
    );
  });
});

describe("untrusted messages", () => {
  it("parses valid commands in each direction", () => {
    expect(parseAdminMessage(event(preview), peer)).toEqual({
      ok: true,
      command: preview,
    });
    for (const command of [
      message(session, page, { type: "discover" }),
      message(session, page, { type: "focus", target }),
    ])
      expect(parseAdminMessage(event(command), peer)).toEqual({
        ok: true,
        command,
      });
    for (const command of [
      message(session, page, { type: "regions", regions: [region] }),
      message(session, page, { type: "hover", target }),
      message(session, page, { type: "hover", target: null }),
      message(session, page, { type: "select", target }),
      message(session, page, {
        type: "navigate",
        url: "https://store.example/products/kettle?category=kitchen#reviews",
      }),
    ])
      expect(parseFrameMessage(event(command), peer)).toEqual({
        ok: true,
        command,
      });
  });
  it("accepts a region the page declares but does not display", () => {
    const hidden = {
      target: `product:${id}:seoDescription`,
      value: "Search snippet",
      rect: null,
    };
    const command = message(session, page, {
      type: "regions",
      regions: [hidden],
    });
    expect(parseFrameMessage(event(command), peer)).toEqual({
      ok: true,
      command,
    });
  });
  it("refuses another origin even when its payload is valid", () => {
    expect(
      parseAdminMessage(
        { ...event(preview), origin: "https://attacker.example" },
        peer,
      ),
    ).toEqual({ ok: false, reason: "origin" });
    expect(
      parseFrameMessage(
        { ...event(preview), origin: "https://attacker.example" },
        peer,
      ),
    ).toEqual({ ok: false, reason: "origin" });
  });
  it("refuses a different window on the same origin and a missing peer", () => {
    expect(parseFrameMessage({ ...event(preview), source: {} }, peer)).toEqual({
      ok: false,
      reason: "source",
    });
    expect(
      parseAdminMessage(event(preview), { ...peer, source: null }),
    ).toEqual({ ok: false, reason: "source" });
  });
  it("refuses a stale or absent session", () => {
    for (const value of [page, undefined, ""]) {
      expect(
        parseAdminMessage(event({ ...preview, session: value }), peer),
      ).toEqual({ ok: false, reason: "session" });
    }
  });
  it("reports unknown and missing versions distinctly so the admin can explain them", () => {
    for (const version of [2, 4, "3", undefined]) {
      for (const parse of [parseAdminMessage, parseFrameMessage]) {
        expect(parse(event({ ...preview, version }), peer)).toEqual({
          ok: false,
          reason: "version",
        });
      }
    }
  });
  it.each([
    null,
    [],
    {},
    "not an envelope",
    { ...preview, page: undefined },
    { ...preview, target: undefined },
    { ...preview, value: 42 },
    { ...preview, value: undefined },
    { ...preview, type: "save" },
    { ...preview, target: "h1:first-child" },
    { ...preview, credential: "unwanted" },
  ])("refuses malformed or partial payloads: %j", (data) => {
    expect(parseAdminMessage(event(data), peer).ok).toBe(false);
  });
  it("does not accept commands in the opposite direction", () => {
    expect(parseFrameMessage(event(preview), peer).ok).toBe(false);
    expect(
      parseAdminMessage(
        event(message(session, page, { type: "select", target })),
        peer,
      ).ok,
    ).toBe(false);
  });
  it("refuses invalid geometry, duplicate targets, and incomplete region lists", () => {
    for (const regions of [
      undefined,
      [region, region],
      [{ ...region, rect: { ...region.rect, width: -1 } }],
      [{ ...region, rect: { ...region.rect, x: NaN } }],
      [{ ...region, rect: undefined }],
      [{ ...region, value: undefined }],
    ])
      expect(
        parseFrameMessage(
          event(message(session, page, { type: "regions", regions } as never)),
          peer,
        ).ok,
      ).toBe(false);
  });
  it("bounds every value by its own field, without truncating", () => {
    expect(
      parseAdminMessage(
        event({ ...preview, value: "a".repeat(nameLimit + 1) }),
        peer,
      ),
    ).toEqual({ ok: false, reason: "payload" });
    const description = message(session, page, {
      type: "preview",
      target: `product:${id}:description`,
      value: "a".repeat(nameLimit + 1),
    });
    expect(parseAdminMessage(event(description), peer).ok).toBe(true);
    expect(
      parseAdminMessage(
        event({
          ...description,
          value: "a".repeat(FIELDS.product.description!.maxLength + 1),
        }),
        peer,
      ),
    ).toEqual({ ok: false, reason: "payload" });
  });
  it("refuses oversized envelopes, including multibyte text", () => {
    for (const value of [
      "a".repeat(MAX_PAYLOAD_BYTES + 1),
      "🐈".repeat(MAX_PAYLOAD_BYTES / 3),
    ]) {
      expect(parseAdminMessage(event({ ...preview, value }), peer)).toEqual({
        ok: false,
        reason: "oversized",
      });
    }
  });
  it("refuses cyclic data instead of throwing", () => {
    const cyclic: Record<string, unknown> = { ...preview };
    cyclic.extra = cyclic;
    expect(parseAdminMessage(event(cyclic), peer).ok).toBe(false);
  });
  it("keeps markup as literal text for textContent rendering", () => {
    const literal = { ...preview, value: '<img src=x onerror="alert(1)">' };
    expect(parseAdminMessage(event(literal), peer)).toEqual({
      ok: true,
      command: literal,
    });
  });
});

describe("where the frame says it is", () => {
  const store = "https://store.example";
  const navigate = (url: unknown) => ({
    ...message(session, page, {
      type: "navigate",
      url: "https://store.example/",
    }),
    url,
  });

  it("is announced by the frame and never accepted from the admin", () => {
    const command = navigate("https://store.example/products/kettle");
    expect(parseFrameMessage(event(command), peer).ok).toBe(true);
    expect(parseAdminMessage(event(command), peer).ok).toBe(false);
  });
  it.each([
    null,
    42,
    "/products/kettle",
    "javascript:alert(1)",
    "data:text/html,<h1>hi</h1>",
    "https://user:pass@store.example/",
    `https://store.example/${"a".repeat(MAX_URL_LENGTH)}`,
  ])("refuses an address that is not a plain absolute page: %j", (url) => {
    expect(parseFrameMessage(event(navigate(url)), peer)).toEqual({
      ok: false,
      reason: "payload",
    });
  });
  it("refuses a navigation with no address at all", () => {
    expect(parseFrameMessage(event(navigate(undefined)), peer).ok).toBe(false);
  });
  it("is refused from another origin and under an unknown version", () => {
    const command = navigate("https://store.example/products/kettle");
    expect(
      parseFrameMessage(
        { ...event(command), origin: "https://attacker.example" },
        peer,
      ),
    ).toEqual({ ok: false, reason: "origin" });
    expect(parseFrameMessage(event({ ...command, version: 2 }), peer)).toEqual({
      ok: false,
      reason: "version",
    });
  });

  it("locates a page of the Store, keeping its query and fragment", () => {
    expect(
      locateInStore(
        "https://store.example/products?category=kitchen#top",
        store,
      ),
    ).toEqual({
      href: "https://store.example/products?category=kitchen#top",
      path: "/products?category=kitchen#top",
    });
    expect(locateInStore(store, store)).toEqual({
      href: "https://store.example/",
      path: "/",
    });
  });
  it("hands back an address a shopper could use, without the editing marker", () => {
    expect(
      locateInStore(
        `https://store.example/products/kettle?${SESSION_PARAM}=${session}`,
        store,
      ),
    ).toEqual({
      href: "https://store.example/products/kettle",
      path: "/products/kettle",
    });
  });
  it("locates pages under a Store that lives on a path", () => {
    const nested = "https://example.test/shop/";
    expect(locateInStore("https://example.test/shop/cart", nested)).toEqual({
      href: "https://example.test/shop/cart",
      path: "/cart",
    });
    expect(locateInStore("https://example.test/other", nested)).toBeNull();
    expect(locateInStore("https://example.test/shopping", nested)).toBeNull();
  });
  it.each([
    "https://other.example/products/kettle",
    "http://store.example/products/kettle",
    "https://store.example:8443/products/kettle",
    "https://store.example.evil.test/",
    "not a url",
  ])("refuses to call %s a page of the Store", (url) => {
    expect(locateInStore(url, store)).toBeNull();
  });
  it("refuses to locate anything against an unusable Store address", () => {
    expect(locateInStore("https://store.example/", "not a url")).toBeNull();
    expect(parseUrl("ftp://store.example/")).toBeNull();
  });
});
