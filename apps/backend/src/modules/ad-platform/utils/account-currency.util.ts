/**
 * The one rule about an ad account's currency, written once.
 *
 * Every figure in this feature is in the Store's own currency and nothing is
 * ever converted — there is no rate fetched, inferred or hard-coded anywhere,
 * and there is not going to be. That leaves exactly one way to keep spend and
 * revenue comparable: refuse an ad account billed in anything else.
 *
 * Refusing is not the same as hiding. The picker lists a mismatched account and
 * says, in this sentence, why it cannot be picked — a merchant who cannot see
 * the account they were looking for goes and re-approves with a different login
 * to find out why, which costs them a trip through Meta and teaches them
 * nothing.
 *
 * Pure, and deliberately: the picker calls it to disable an option and the
 * service calls it again to refuse a request, so the two can never disagree
 * about what is allowed.
 */

/** Two currencies are the same currency, spelling and casing aside. */
export function sameCurrency(
  storeCurrency: string,
  accountCurrency: string | null | undefined,
): boolean {
  if (!accountCurrency) return false;
  return normalize(storeCurrency) === normalize(accountCurrency);
}

/**
 * Why this ad account cannot be used by this Store, or null when it can.
 *
 * The words are the merchant's, not an engineer's: what is wrong, and the two
 * things they can do about it. It never suggests converting, because nothing
 * here converts.
 */
export function currencyRefusal(
  storeCurrency: string,
  accountCurrency: string | null | undefined,
): string | null {
  if (sameCurrency(storeCurrency, accountCurrency)) return null;

  const store = normalize(storeCurrency);
  if (!accountCurrency) {
    return `This ad account does not report a currency, and this store reports in ${store}. Figures are never converted, so only an account billed in ${store} can be used here.`;
  }
  return `Billed in ${normalize(accountCurrency)}, and this store reports in ${store}. Figures are never converted, so use an ad account billed in ${store} — or change this store's currency first.`;
}

function normalize(currency: string): string {
  return currency.trim().toUpperCase();
}
