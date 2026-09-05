/**
 * The store config validator, exercised as a pure unit. What is asserted here
 * is what a merchant with a typo sees: whether the app refuses to start, and
 * whether the message names the field they have to go and fix.
 *
 * The `Intl` cases are the point of the exercise. A locale or currency that is
 * shaped like a real one but rejected at runtime is otherwise invisible until
 * the first price renders blank, which is the failure this validation exists
 * to move to boot.
 */
import { describe, expect, it } from "vitest";
import { StoreConfigError, validateStoreConfig } from "./validate-store-config";
import { storeConfig, type StoreConfig } from "./store.config";

const VALID: StoreConfig = {
  name: "Acme",
  description: "Thoughtfully made goods for everyday life.",
  currency: "USD",
  locale: "en-US",
  nav: [{ label: "Shop All", to: "/products" }],
  social: [],
};

/** The problems reported for a config, or `[]` when it was accepted. */
function problemsFor(overrides: Partial<StoreConfig>): string[] {
  try {
    validateStoreConfig({ ...VALID, ...overrides });
    return [];
  } catch (err) {
    if (err instanceof StoreConfigError) return [...err.problems];
    throw err;
  }
}

describe("validateStoreConfig", () => {
  it("accepts the config the template ships with", () => {
    expect(() => validateStoreConfig(storeConfig)).not.toThrow();
  });

  it("returns the config it was given", () => {
    expect(validateStoreConfig(VALID)).toBe(VALID);
  });

  describe("currency and locale", () => {
    it("rejects a locale Intl will not construct, naming the field", () => {
      // Shaped like a locale, and the underscore is what a human writes.
      const [problem] = problemsFor({ locale: "en_US" });
      expect(problem).toContain("locale");
      expect(problem).toContain('"en_US"');
    });

    it("rejects a currency code Intl will not construct, naming the field", () => {
      const [problem] = problemsFor({ currency: "USDD" });
      expect(problem).toContain("currency");
      expect(problem).toContain('"USDD"');
    });

    it("rejects an empty currency rather than formatting without one", () => {
      expect(problemsFor({ currency: "" })).toHaveLength(1);
    });

    it("blames each of a bad locale and a bad currency separately", () => {
      const problems = problemsFor({ locale: "en_US", currency: "USDD" });
      expect(problems).toHaveLength(2);
      expect(problems.some((p) => p.includes("en_US"))).toBe(true);
      expect(problems.some((p) => p.includes("USDD"))).toBe(true);
    });

    it("accepts currencies and locales other than the shipped pair", () => {
      expect(problemsFor({ currency: "EUR", locale: "de-DE" })).toEqual([]);
      expect(problemsFor({ currency: "JPY", locale: "ja-JP" })).toEqual([]);
    });
  });

  describe("identity", () => {
    it("rejects a blank name, so a fork cannot ship an empty header", () => {
      expect(problemsFor({ name: "   " })[0]).toContain("name");
    });

    it("rejects a blank description, so the tagline and meta are never empty", () => {
      expect(problemsFor({ description: "" })[0]).toContain("description");
    });
  });

  describe("links", () => {
    it("rejects a nav target that is not a storefront path", () => {
      const [problem] = problemsFor({
        nav: [{ label: "Shop", to: "products" }],
      });
      expect(problem).toContain("nav[0].to");
    });

    it("names the offending entry by index", () => {
      const [problem] = problemsFor({
        nav: [
          { label: "Shop", to: "/products" },
          { label: "About", to: "about" },
        ],
      });
      expect(problem).toContain("nav[1].to");
    });

    it("rejects a blank nav label", () => {
      expect(
        problemsFor({ nav: [{ label: "", to: "/products" }] })[0],
      ).toContain("nav[0].label");
    });

    it("accepts an absolute URL as a social link", () => {
      expect(
        problemsFor({ social: [{ label: "X", to: "https://x.com/acme" }] }),
      ).toEqual([]);
    });

    it("rejects a schemeless social link, which would resolve to our own origin", () => {
      const [problem] = problemsFor({
        social: [{ label: "X", to: "x.com/acme" }],
      });
      expect(problem).toContain("social[0].to");
    });
  });

  it("reports every problem at once rather than the first", () => {
    const problems = problemsFor({
      name: "",
      currency: "USDD",
      nav: [{ label: "Shop", to: "products" }],
    });
    expect(problems).toHaveLength(3);
  });

  it("lists every problem in the thrown message", () => {
    let message = "";
    try {
      validateStoreConfig({ ...VALID, name: "", currency: "USDD" });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("src/config/store.config.ts");
    expect(message).toContain("name");
    expect(message).toContain("USDD");
  });
});
