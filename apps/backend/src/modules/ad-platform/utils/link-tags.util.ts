/**
 * Our Link Tags: the four click parameters every ad created here carries, and
 * the test for whether an ad the sync discovered carries them.
 *
 * **The tags are the whole product.** Every revenue figure on the campaign
 * screens exists because an ad carried `utm_campaign` and `utm_content` when it
 * was clicked. The platform expands the two macros at click time with its own
 * ids, so an Order's stored Touch names the Campaign and the Ad by exactly the
 * ids the sync keys them under, and the join is an equality — no normalization,
 * no matching rules, and a rename cannot break it.
 *
 * One template, used both to write tags and to recognise them, so the two can
 * never drift into a create path that writes one spelling and a sync that looks
 * for another.
 */

/** The platform macro that expands to the campaign's own id at click time. */
export const CAMPAIGN_ID_MACRO = '{{campaign.id}}';

/** The platform macro that expands to the ad's own id at click time. */
export const AD_ID_MACRO = '{{ad.id}}';

export interface LinkTag {
  readonly key: string;
  readonly value: string;
}

/**
 * The tags, in the order they are written.
 *
 * `utm_source` and `utm_medium` name the channel for anything reading the
 * Touch by hand; `utm_campaign` and `utm_content` are the join.
 */
export const LINK_TAGS: readonly LinkTag[] = [
  { key: 'utm_source', value: 'meta' },
  { key: 'utm_medium', value: 'paid' },
  { key: 'utm_campaign', value: CAMPAIGN_ID_MACRO },
  { key: 'utm_content', value: AD_ID_MACRO },
];

/**
 * The tags as the platform's `url_tags` string, macros unescaped so the
 * platform can expand them.
 *
 * Built by hand rather than through `URLSearchParams`, which would
 * percent-encode the braces and leave the platform nothing to expand — the ad
 * would go live carrying the literal text `%7B%7Bcampaign.id%7D%7D` on every
 * click, and not one Order would ever find its Campaign.
 */
export function buildLinkTags(): string {
  return LINK_TAGS.map(({ key, value }) => `${key}=${value}`).join('&');
}

/**
 * Whether an ad's stored `url_tags` carry our join.
 *
 * Only the two join parameters are required. An ad a merchant tagged with a
 * different `utm_source`, or with extra parameters of their own, still reports
 * its revenue to the right Campaign and Ad — what it cannot do is name them
 * with anything but the macros, because a hand-typed campaign name matches no
 * platform id.
 *
 * Read tolerantly: a leading `?`, percent-encoded braces and surrounding
 * whitespace are all spellings the platform or a merchant might have stored.
 */
export function carriesOurLinkTags(
  urlTags: string | null | undefined,
): boolean {
  if (!urlTags) return false;

  const params = new URLSearchParams(urlTags.trim().replace(/^\?/, ''));
  const read = (key: string): string | null => {
    const value = params.get(key);
    return value === null ? null : value.trim();
  };

  return (
    read('utm_campaign') === CAMPAIGN_ID_MACRO &&
    read('utm_content') === AD_ID_MACRO
  );
}

/**
 * The tags to write onto an ad that already carries some of its own: ours
 * merged into the merchant's rather than written over them.
 *
 * A tag write replaces the ad's whole set, so anything left out is lost. The
 * merchant's other parameters are kept in their order. The two join parameters
 * are always ours, because a hand-typed campaign name matches no platform id.
 * `utm_source` and `utm_medium` are only added where the ad has none: nothing
 * joins on them, and a merchant who labelled their own traffic keeps the label.
 *
 * Values come back decoded, which is what the platform expects on a write.
 */
export function mergeLinkTags(existing: string | null | undefined): LinkTag[] {
  const kept: LinkTag[] = [];
  const seen = new Set<string>();
  const params = new URLSearchParams(
    (existing ?? '').trim().replace(/^\?/, ''),
  );
  for (const [key, value] of params) {
    if (!key || seen.has(key)) continue;
    seen.add(key);
    kept.push({ key, value });
  }

  const ours = new Map(LINK_TAGS.map((tag) => [tag.key, tag.value]));
  const joins = new Set(['utm_campaign', 'utm_content']);

  const merged = kept.map((tag) =>
    joins.has(tag.key) ? { key: tag.key, value: ours.get(tag.key)! } : tag,
  );
  for (const tag of LINK_TAGS) {
    if (!seen.has(tag.key)) merged.push(tag);
  }
  return merged;
}
