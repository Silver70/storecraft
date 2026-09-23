import { currencyRefusal, sameCurrency } from './account-currency.util';

/**
 * The currency guard, tested directly, because it is the thing standing between
 * this feature and a silently converted figure.
 *
 * It fails quietly if it fails at all: a mismatched account connects, spend
 * arrives in euros, revenue is counted in dollars, and every ROAS on the page
 * is wrong by an exchange rate nobody chose. Nothing about the page would look
 * broken.
 */
describe('the ad account currency guard', () => {
  describe('a match', () => {
    it('accepts the same currency', () => {
      expect(sameCurrency('USD', 'USD')).toBe(true);
      expect(currencyRefusal('USD', 'USD')).toBeNull();
    });

    it('does not care how either side was spelled', () => {
      // One comes off a Store row a merchant typed into, the other off a
      // platform's payload. Neither promises a case.
      expect(sameCurrency('usd', 'USD')).toBe(true);
      expect(sameCurrency('USD', ' usd ')).toBe(true);
      expect(currencyRefusal('usd', 'Usd')).toBeNull();
    });
  });

  describe('a mismatch', () => {
    it('refuses, naming both currencies', () => {
      expect(sameCurrency('USD', 'GBP')).toBe(false);

      const reason = currencyRefusal('USD', 'GBP')!;
      expect(reason).toContain('GBP');
      expect(reason).toContain('USD');
    });

    it('says figures are never converted, rather than offering to convert', () => {
      // The sentence is the whole of the explanation the merchant gets, so it
      // has to rule the alternative out rather than leave them waiting for it.
      expect(currencyRefusal('USD', 'EUR')).toMatch(/never converted/i);
    });
  });

  describe('an account that reports no currency', () => {
    it('is refused rather than assumed to match', () => {
      // A missing currency is not a matching one. Assuming it is would connect
      // exactly the account this guard exists to keep out.
      expect(sameCurrency('USD', null)).toBe(false);
      expect(sameCurrency('USD', undefined)).toBe(false);
      expect(sameCurrency('USD', '')).toBe(false);
      expect(currencyRefusal('USD', null)).toMatch(
        /does not report a currency/i,
      );
    });
  });
});
