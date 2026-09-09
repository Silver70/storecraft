import { CAMPAIGN_LIMITS } from '../../../shared/database/schema';

/** Used when a name slugifies to nothing — "🎉", "!!!", "   ". */
export const CAMPAIGN_TAG_FALLBACK = 'campaign';

/** The same, for an Ad — so an emoji-named creative is not tagged `campaign`. */
export const AD_TAG_FALLBACK = 'ad';

/**
 * Derives a Campaign's canonical `utm_campaign` tag from its name.
 *
 * Deliberately not `generateSlug` from shared/utils, which strips underscores
 * outright: that is right for a product slug but wrong here, because a merchant
 * who names a campaign "Summer_Sale" and hand-tags a link `utm_campaign=summer_sale`
 * must land on the same Campaign as the generated link. Every run of
 * non-alphanumerics — spaces, underscores, hyphens, punctuation — therefore
 * becomes one hyphen, which is the separator ticket 04's matcher normalizes to.
 *
 * Accents fold to their base letter so "Été" and "Ete" are one tag rather than
 * two, and the result is truncated to the column width rather than failing the
 * write of a campaign whose name is merely long.
 *
 * An Ad Tag is derived by this same function, with its own fallback word. The
 * derivation is deliberately shared rather than reimplemented: a Campaign Tag
 * and an Ad Tag are compared against values normalized the same way, so the two
 * must land in the same canonical form for the same input.
 */
export function deriveCampaignTag(
  name: string,
  fallback: string = CAMPAIGN_TAG_FALLBACK,
): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // combining marks left by NFKD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, CAMPAIGN_LIMITS.tag)
    .replace(/-+$/, ''); // the slice may have landed mid-separator

  return slug || fallback;
}

/**
 * The nth candidate for a base tag: `summer-sale`, `summer-sale-2`, … The base
 * is shortened, never the suffix, so the candidate always stays inside the
 * column and always stays distinguishable.
 */
export function campaignTagCandidate(base: string, attempt: number): string {
  if (attempt <= 1) return base;
  const suffix = `-${attempt}`;
  const room = CAMPAIGN_LIMITS.tag - suffix.length;
  return `${base.slice(0, room).replace(/-+$/, '')}${suffix}`;
}
