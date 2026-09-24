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
