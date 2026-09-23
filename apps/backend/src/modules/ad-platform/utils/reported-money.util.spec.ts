import { toCount, toDecimalAmount, toMinorUnits } from './reported-money.util';

/**
 * The rounding rule, asserted at the values that break the obvious
 * implementation.
 *
 * Every case here is a number a merchant could read off their own ad platform
 * invoice. The ones that matter are the two-decimal amounts whose IEEE 754
 * product with 100 lands just below the half — `2.675` is the canonical one —
 * because those are exactly the figures that would be off by a cent, in a
 * report that never throws and reconciles against nothing.
 */
describe('reported money', () => {
  describe('toMinorUnits', () => {
    it('converts a plain decimal amount', () => {
      expect(toMinorUnits(12.34)).toBe(1234);
      expect(toMinorUnits(0)).toBe(0);
      expect(toMinorUnits(2675)).toBe(267500);
    });

    it('rounds halves away from zero', () => {
      expect(toMinorUnits(0.005)).toBe(1);
      expect(toMinorUnits(0.004)).toBe(0);
      expect(toMinorUnits(-0.005)).toBe(-1);
      expect(toMinorUnits(-0.004)).toBe(0);
    });

    it('rounds the amounts whose binary representation falls short of the half', () => {
      // 2.675 * 100 is 267.49999999999994; 19.995 * 100 is 1999.4999999999998.
      // Rounding those directly loses a cent on a figure the merchant can read
      // off an invoice.
      expect(toMinorUnits(2.675)).toBe(268);
      expect(toMinorUnits(19.995)).toBe(2000);
      expect(toMinorUnits(1.005)).toBe(101);
      expect(toMinorUnits(8.165)).toBe(817);
    });

    it('keeps a long decimal from becoming a fraction of a cent', () => {
      expect(toMinorUnits(0.1 + 0.2)).toBe(30);
      expect(toMinorUnits(1234.5678)).toBe(123457);
      expect(Number.isInteger(toMinorUnits(3.333333333))).toBe(true);
    });

    it('refuses an amount the platform could not state', () => {
      // Zero would read as "this ad spent nothing today", which is a claim
      // with a cost basis behind it. The sync surfaces the failure instead.
      expect(() => toMinorUnits(Number.NaN)).toThrow(RangeError);
      expect(() => toMinorUnits(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    });
  });

  describe('toDecimalAmount', () => {
    it('states an amount the way the platform expects it', () => {
      expect(toDecimalAmount(2599)).toBe(25.99);
      expect(toDecimalAmount(0)).toBe(0);
      expect(toDecimalAmount(5)).toBe(0.05);
      expect(toDecimalAmount(100)).toBe(1);
      expect(toDecimalAmount(-2599)).toBe(-25.99);
    });

    it('round-trips every amount a money column could hold', () => {
      // The direction that needs a rounding rule is the other one. Dividing by a
      // hundred is exact for an integer, which is why a total leaves here as the
      // figure the merchant will see on their receipt and not a cent beside it.
      for (const cents of [1, 7, 99, 1234, 99999, 2147483647]) {
        expect(toMinorUnits(toDecimalAmount(cents))).toBe(cents);
      }
    });

    it('refuses a fraction of a cent, which is a float that got into a total', () => {
      expect(() => toDecimalAmount(25.5)).toThrow(RangeError);
      expect(() => toDecimalAmount(Number.NaN)).toThrow(RangeError);
    });
  });

  describe('toCount', () => {
    it('rounds a fractional count, which attributed conversions routinely are', () => {
      expect(toCount(1200)).toBe(1200);
      expect(toCount(3.5)).toBe(4);
      expect(toCount(3.4)).toBe(3);
      expect(toCount(null)).toBe(0);
      expect(toCount(undefined)).toBe(0);
    });
  });
});
