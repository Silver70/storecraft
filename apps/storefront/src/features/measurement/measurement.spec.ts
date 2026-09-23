/**
 * The measurement rules that decide whether anybody is measured at all, and
 * what identifies them when they are — exercised as pure units, no DOM and no
 * network.
 *
 * These are asserted because every one of them fails quietly. A consent check
 * that reads the wrong way measures a visitor who said no and nothing on the
 * page looks different; a click id assembled wrongly is accepted by the platform
 * and simply never matches anyone.
 */
import { describe, expect, it } from "vitest";
import { buildClickId, readCookie } from "./browser-ids";
import { measurementPermitted, parseConsent, readConsentFrom } from "./consent";

describe("measurementPermitted", () => {
  it("allows everything on a store that does not ask", () => {
    expect(measurementPermitted(false, null)).toBe(true);
    expect(measurementPermitted(false, "denied")).toBe(true);
  });

  it("allows only an explicit yes on a store that asks", () => {
    expect(measurementPermitted(true, "granted")).toBe(true);
    expect(measurementPermitted(true, "denied")).toBe(false);
  });

  it("treats an unanswered banner as a no, or the banner is decoration", () => {
    expect(measurementPermitted(true, null)).toBe(false);
  });
});

describe("parseConsent", () => {
  it("reads the two answers and nothing else", () => {
    expect(parseConsent("granted")).toBe("granted");
    expect(parseConsent("denied")).toBe("denied");
  });

  it("treats anything unrecognised as no answer at all", () => {
    expect(parseConsent("yes")).toBeNull();
    expect(parseConsent("")).toBeNull();
    expect(parseConsent(undefined)).toBeNull();
  });
});

describe("readConsentFrom", () => {
  it("finds the answer among other cookies", () => {
    expect(
      readConsentFrom("cartId=abc; cos_consent=granted; _fbp=fb.1.2.3"),
    ).toBe("granted");
  });

  it("is not fooled by a cookie whose name merely ends the same way", () => {
    expect(readConsentFrom("not_cos_consent=granted")).toBeNull();
  });

  it("reads no answer out of no cookies", () => {
    expect(readConsentFrom("")).toBeNull();
    expect(readConsentFrom(undefined)).toBeNull();
  });
});

describe("readCookie", () => {
  it("returns a value carrying its own equals signs intact", () => {
    expect(readCookie("a=1; _fbc=fb.1.99.AbC=dEf; b=2", "_fbc")).toBe(
      "fb.1.99.AbC=dEf",
    );
  });

  it("returns undefined for an absent or empty cookie", () => {
    expect(readCookie("a=1", "_fbp")).toBeUndefined();
    expect(readCookie("_fbp=; a=1", "_fbp")).toBeUndefined();
  });
});

describe("buildClickId", () => {
  it("assembles the click id the platform expects", () => {
    expect(buildClickId("IwAR0abc", 1_757_000_000_000)).toBe(
      "fb.1.1757000000000.IwAR0abc",
    );
  });
});
