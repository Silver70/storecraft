import { describe, expect, it } from "vitest";
import {
  MAX_PAYLOAD_BYTES,
  MAX_NAME_LENGTH,
  message,
  parseAdminMessage,
  parseFrameMessage,
  parseTarget,
  parseOrigin,
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

describe("target descriptors", () => {
  it("identifies the entity and field without page position", () => {
    expect(parseTarget(target)).toEqual({ kind: "product", id, field: "name" });
  });
  it.each([
    null,
    {},
    "",
    "product:1:name",
    `product:${id}`,
    `product:${id}:name:extra`,
    `product:${id}:price`,
    `category:${id}:name`,
    ` product:${id}:name`,
    `product:${id}:name `,
  ])("refuses malformed or unsupported descriptors: %j", (value) => {
    expect(parseTarget(value)).toBeNull();
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
    ])
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
    for (const version of [2, "1", undefined]) {
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
      [{ ...region, value: undefined }],
    ])
      expect(
        parseFrameMessage(
          event(message(session, page, { type: "regions", regions } as never)),
          peer,
        ).ok,
      ).toBe(false);
  });
  it("refuses oversized names without truncating", () => {
    expect(
      parseAdminMessage(
        event({ ...preview, value: "a".repeat(MAX_NAME_LENGTH + 1) }),
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
