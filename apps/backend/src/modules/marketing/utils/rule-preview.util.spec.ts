/**
 * What a candidate rule would do to a period's Orders, as a pure unit.
 *
 * The preview exists because a saved rule reshapes history the instant it
 * exists, so the thing under test is really one promise: the figures shown
 * before saving are the figures saving produces. That promise is asserted here
 * directly — every case computes the preview, then computes the real tally with
 * the candidate actually in the rule set, and requires the two to agree.
 *
 * No database, no framework, no clock.
 */
import {
  previewMatchingRule,
  type PreviewableOrder,
  type RulePreviewTally,
} from './rule-preview.util';
import {
  tallyAttributedRevenue,
  type CostedOrder,
} from './attributed-revenue.util';
import {
  createCampaignMatcher,
  type MatchableRule,
} from './campaign-matching.util';

const SUMMER = 'campaign-summer';
const SPRING = 'campaign-spring';

const LOOKBACK = 30;
const PLACED_AT = new Date('2026-06-01T12:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const daysBefore = (days: number) =>
  new Date(PLACED_AT.getTime() - days * DAY_MS);

const CREATED = {
  summer: new Date('2026-01-01T00:00:00Z'),
  spring: new Date('2026-01-02T00:00:00Z'),
};

/** Every campaign owns an exact rule on its own tag, as creation gives it. */
const SAVED_RULES: MatchableRule[] = [
  {
    campaignId: SUMMER,
    field: 'utm_campaign',
    operator: 'equals',
    value: 'summer-sale',
    campaignCreatedAt: CREATED.summer,
  },
  {
    campaignId: SPRING,
    field: 'utm_campaign',
    operator: 'equals',
    value: 'spring-sale',
    campaignCreatedAt: CREATED.spring,
  },
];

let nextOrder = 0;

/** An order with only the parts a case cares about spelled out. */
type OrderOverrides = Partial<Omit<PreviewableOrder, 'touch'>> & {
  touch?: Partial<PreviewableOrder['touch']>;
};

function order(overrides: OrderOverrides = {}): PreviewableOrder {
  nextOrder += 1;
  return {
    id: `order-${nextOrder}`,
    orderNumber: `#${1000 + nextOrder}`,
    total: 3000,
    placedAt: PLACED_AT,
    isBot: false,
    ...overrides,
    touch: {
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      referrer: null,
      at: daysBefore(1),
      ...overrides.touch,
    },
  };
}

function candidateRule(overrides: Partial<MatchableRule> = {}): MatchableRule {
  return {
    campaignId: SUMMER,
    field: 'utm_source',
    operator: 'equals',
    value: 'instagram',
    campaignCreatedAt: CREATED.summer,
    ...overrides,
  };
}

function preview(
  orders: PreviewableOrder[],
  candidate: MatchableRule,
  existingRules: MatchableRule[] = SAVED_RULES,
): RulePreviewTally {
  return previewMatchingRule({
    orders,
    existingRules,
    candidate,
    lookbackDays: LOOKBACK,
    sampleLimit: 10,
  });
}

/**
 * A preview Order as the tally wants it. A preview answers which Campaign wins
 * an Order and never what the Order cost, so the goods basis is absent from
 * `PreviewableOrder` and zeroed here; nothing in this file asserts on it.
 */
const costless = (order: PreviewableOrder): CostedOrder => ({
  ...order,
  goodsRevenue: 0,
  cost: 0,
  revenueWithCost: 0,
  discount: 0,
});

/**
 * What the attributed-revenue report would actually say once the rule is saved.
 * The preview is only worth anything if it agrees with this.
 */
function revenueAfterSaving(
  orders: PreviewableOrder[],
  candidate: MatchableRule,
  existingRules: MatchableRule[] = SAVED_RULES,
) {
  const matcher = createCampaignMatcher([...existingRules, candidate]);
  return tallyAttributedRevenue(orders.map(costless), matcher, LOOKBACK);
}

const EMPTY = { orders: 0, revenue: 0 };

describe('previewMatchingRule', () => {
  // ─── What the rule would claim ──────────────────────────────────────────────

  describe('what the rule would claim', () => {
    it('reports the orders and revenue a rule would pull in', () => {
      const orders = [
        order({ touch: { utmSource: 'instagram', at: daysBefore(1) } }),
        order({ total: 5000, touch: { utmSource: 'Instagram' } }),
        order({ touch: { utmSource: 'google' } }),
      ];

      const tally = preview(orders, candidateRule());

      // Two orders, and normalization means the capitalized one is not a
      // separate value the merchant would have to write a second rule for.
      expect(tally.claimed).toEqual({ orders: 2, revenue: 8000 });
      expect(tally.fromUnattributed).toEqual({ orders: 2, revenue: 8000 });
      expect(tally.totals).toEqual({ orders: 3, revenue: 11000 });
    });

    it('claims nothing when no order carries the value', () => {
      const orders = [order({ touch: { utmSource: 'google' } })];

      const tally = preview(orders, candidateRule());

      expect(tally.claimed).toEqual(EMPTY);
      expect(tally.campaignAfter).toEqual(tally.campaignBefore);
    });

    it('claims nothing from an empty period rather than erroring', () => {
      const tally = preview([], candidateRule());

      expect(tally.claimed).toEqual(EMPTY);
      expect(tally.totals).toEqual(EMPTY);
      expect(tally.samples).toEqual([]);
    });

    it('shows the campaign figures before and after, so the change is legible', () => {
      const orders = [
        // Already this campaign's, through the tag rule it was created with.
        order({ touch: { utmCampaign: 'summer_sale' } }),
        // Would be claimed by the candidate.
        order({ touch: { utmSource: 'instagram' } }),
      ];

      const tally = preview(orders, candidateRule());

      expect(tally.campaignBefore).toEqual({ orders: 1, revenue: 3000 });
      expect(tally.campaignAfter).toEqual({ orders: 2, revenue: 6000 });
      expect(tally.claimed).toEqual({ orders: 1, revenue: 3000 });
    });

    it('never shows a campaign losing revenue to its own new rule', () => {
      // Adding a rule can only add matches — the matcher takes the first rule
      // in precedence order, so a new one changes a verdict only by winning.
      const orders = [
        order({ touch: { utmCampaign: 'summer_sale', utmSource: 'google' } }),
        order({ touch: { utmCampaign: 'spring_sale' } }),
        order({ touch: { utmSource: 'instagram' } }),
        order(),
      ];

      const tally = preview(orders, candidateRule());

      expect(tally.campaignAfter.orders).toBeGreaterThanOrEqual(
        tally.campaignBefore.orders,
      );
      expect(tally.campaignAfter.revenue).toBeGreaterThanOrEqual(
        tally.campaignBefore.revenue,
      );
    });
  });

  // ─── Overlaps with other campaigns ──────────────────────────────────────────

  describe('overlaps with other campaigns', () => {
    it('separates revenue taken from another campaign from revenue newly claimed', () => {
      const orders = [
        // Spring's tag rule holds this one today; the candidate is on
        // utm_source, which loses to a utm_campaign rule.
        order({
          touch: { utmCampaign: 'spring_sale', utmSource: 'instagram' },
        }),
        // Nobody has this one.
        order({ total: 4000, touch: { utmSource: 'instagram' } }),
      ];

      const tally = preview(orders, candidateRule());

      expect(tally.claimed).toEqual({ orders: 1, revenue: 4000 });
      expect(tally.fromUnattributed).toEqual({ orders: 1, revenue: 4000 });
      expect(tally.takenFrom.size).toBe(0);

      // The overlap is still visible — it is why the rule claims one order and
      // not two, which is exactly what a merchant would otherwise puzzle over.
      expect(tally.blockedBy.get(SPRING)).toEqual({ orders: 1, revenue: 3000 });
    });

    it('reports what a higher-precedence rule would take from another campaign', () => {
      // A utm_campaign rule outranks the tag rule holding these orders only if
      // it wins on operator or age; here the candidate claims a value Spring's
      // starts_with rule holds more loosely.
      const existing: MatchableRule[] = [
        ...SAVED_RULES,
        {
          campaignId: SPRING,
          field: 'utm_campaign',
          operator: 'starts_with',
          value: 'spring',
          campaignCreatedAt: CREATED.spring,
        },
      ];
      const orders = [
        order({ touch: { utmCampaign: 'spring_clearance' } }),
        order({ total: 7000, touch: { utmCampaign: 'spring_clearance' } }),
      ];

      const candidate = candidateRule({
        field: 'utm_campaign',
        operator: 'equals',
        value: 'spring_clearance',
      });
      const tally = preview(orders, candidate, existing);

      // Exact beats prefix, so the revenue moves — and the merchant is told
      // whose it was rather than only that their own number went up.
      expect(tally.claimed).toEqual({ orders: 2, revenue: 10000 });
      expect(tally.takenFrom.get(SPRING)).toEqual({
        orders: 2,
        revenue: 10000,
      });
      expect(tally.fromUnattributed).toEqual(EMPTY);
      expect(tally.blockedBy.size).toBe(0);
    });

    it('does not report an overlap with the campaign the rule belongs to', () => {
      // The campaign already holds this through its tag rule; the candidate
      // also matches it. That is not an overlap the merchant needs to see.
      const orders = [
        order({
          touch: { utmCampaign: 'summer_sale', utmSource: 'instagram' },
        }),
      ];

      const tally = preview(orders, candidateRule());

      expect(tally.takenFrom.size).toBe(0);
      expect(tally.blockedBy.size).toBe(0);
      expect(tally.claimed).toEqual(EMPTY);
    });

    it('shows an over-broad rule swallowing several campaigns at once', () => {
      const orders = [
        order({
          touch: { utmCampaign: 'spring_sale', utmSource: 'instagram' },
        }),
        order({
          touch: { utmCampaign: 'summer_sale', utmSource: 'instagram' },
        }),
        order({ touch: { utmSource: 'instagram' } }),
        order({ touch: { utmSource: 'instagram' } }),
        order({ touch: { utmSource: 'instagram' } }),
      ];

      const tally = preview(orders, candidateRule());

      // Three of five orders, and the merchant can see it is most of the
      // period's revenue rather than a precise claim.
      expect(tally.claimed).toEqual({ orders: 3, revenue: 9000 });
      expect(tally.totals).toEqual({ orders: 5, revenue: 15000 });
      expect(tally.blockedBy.get(SPRING)).toEqual({ orders: 1, revenue: 3000 });
    });
  });

  // ─── The disqualifications still apply ──────────────────────────────────────

  describe('a rule cannot claim what no rule could claim', () => {
    it('does not claim an order whose touch is outside the lookback window', () => {
      const orders = [
        order({
          touch: { utmSource: 'instagram', at: daysBefore(LOOKBACK + 1) },
        }),
        order({ touch: { utmSource: 'instagram', at: daysBefore(LOOKBACK) } }),
      ];

      const tally = preview(orders, candidateRule());

      // The window is inclusive at its edge, and both orders still count in
      // the totals — the revenue is real either way.
      expect(tally.claimed).toEqual({ orders: 1, revenue: 3000 });
      expect(tally.totals).toEqual({ orders: 2, revenue: 6000 });
    });

    it('does not claim a bot order', () => {
      const orders = [
        order({ isBot: true, touch: { utmSource: 'instagram' } }),
      ];

      const tally = preview(orders, candidateRule());

      expect(tally.claimed).toEqual(EMPTY);
      expect(tally.totals).toEqual({ orders: 1, revenue: 3000 });
    });

    it('does not claim an order carrying no touch at all', () => {
      const orders = [order({ touch: { utmSource: 'instagram', at: null } })];

      const tally = preview(orders, candidateRule());

      expect(tally.claimed).toEqual(EMPTY);
    });
  });

  // ─── The orders themselves ──────────────────────────────────────────────────

  describe('the orders it names', () => {
    it('names the claimed orders with what they carried and who has them now', () => {
      const orders = [
        order({
          touch: { utmCampaign: 'spring_sale', utmSource: 'instagram' },
        }),
        order({ touch: { utmSource: 'Instagram ' } }),
      ];

      // Same field and operator as Spring's own tag rule, so the tie breaks on
      // campaign age — and Summer is the older campaign.
      const candidate = candidateRule({
        field: 'utm_campaign',
        operator: 'equals',
        value: 'spring-sale',
      });
      const tally = preview(orders, candidate);

      expect(tally.samples).toHaveLength(1);
      expect(tally.samples[0]).toMatchObject({
        orderId: orders[0].id,
        orderNumber: orders[0].orderNumber,
        total: 3000,
        currentCampaignId: SPRING,
        // The value in the field the rule compares, as the order carries it —
        // what makes an over-broad rule obvious at a glance.
        matchedValue: 'spring_sale',
      });
    });

    it('names the referring host for a referrer rule, not the whole URL', () => {
      const orders = [
        order({ touch: { referrer: 'https://www.instagram.com/p/abc/' } }),
      ];

      const tally = preview(
        orders,
        candidateRule({ field: 'referrer_host', value: 'instagram.com' }),
      );

      expect(tally.samples[0].matchedValue).toBe('instagram.com');
    });

    it('caps the named orders without capping the figures', () => {
      const orders = Array.from({ length: 25 }, () =>
        order({ touch: { utmSource: 'instagram' } }),
      );

      const tally = previewMatchingRule({
        orders,
        existingRules: SAVED_RULES,
        candidate: candidateRule(),
        lookbackDays: LOOKBACK,
        sampleLimit: 10,
      });

      expect(tally.samples).toHaveLength(10);
      expect(tally.claimed).toEqual({ orders: 25, revenue: 75000 });
    });
  });

  // ─── The promise the preview makes ──────────────────────────────────────────

  describe('saving the previewed rule produces the figures shown', () => {
    it.each([
      [
        'a rule claiming unattributed orders',
        candidateRule(),
        [
          order({ touch: { utmSource: 'instagram' } }),
          order({ total: 9900, touch: { utmSource: 'INSTAGRAM' } }),
          order({ touch: { utmCampaign: 'summer_sale' } }),
          order(),
        ],
      ],
      [
        'a rule taking orders from another campaign',
        candidateRule({
          field: 'utm_campaign',
          operator: 'equals',
          value: 'spring-sale',
        }),
        [
          order({ touch: { utmCampaign: 'spring_sale' } }),
          order({ total: 4200, touch: { utmCampaign: 'Spring Sale' } }),
        ],
      ],
      [
        'a rule blocked by a higher-precedence rule',
        candidateRule(),
        [
          order({
            touch: { utmCampaign: 'spring_sale', utmSource: 'instagram' },
          }),
          order({ touch: { utmSource: 'instagram' } }),
        ],
      ],
      [
        'a rule that claims nothing',
        candidateRule({ value: 'pinterest' }),
        [order({ touch: { utmSource: 'instagram' } }), order()],
      ],
      [
        'orders no rule may claim',
        candidateRule(),
        [
          order({ isBot: true, touch: { utmSource: 'instagram' } }),
          order({
            touch: { utmSource: 'instagram', at: daysBefore(LOOKBACK + 5) },
          }),
        ],
      ],
    ])('%s', (_name, candidate, orders) => {
      const tally = preview(orders, candidate);
      const saved = revenueAfterSaving(orders, candidate);

      // The headline the preview shows is the line the report would print.
      expect(tally.campaignAfter).toEqual(
        saved.byCampaign.get(candidate.campaignId) ?? EMPTY,
      );
      expect(tally.totals).toEqual(saved.totals);
    });

    it('leaves the rules it was handed untouched, so nothing is previewed twice', () => {
      const existing = [...SAVED_RULES];
      const orders = [order({ touch: { utmSource: 'instagram' } })];

      const first = preview(orders, candidateRule(), existing);
      const second = preview(orders, candidateRule(), existing);

      // Previewing changes nothing — not the rule set, not the answer.
      expect(existing).toHaveLength(SAVED_RULES.length);
      expect(second.claimed).toEqual(first.claimed);
      expect(second.campaignAfter).toEqual(first.campaignAfter);
    });
  });
});
