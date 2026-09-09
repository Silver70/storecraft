import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CampaignSpend } from '../../../shared/database/schema';
import { StoreService } from '../../tenant/services/store.service';
import { AdRepository } from '../repositories/ad.repository';
import { CampaignRepository } from '../repositories/campaign.repository';
import { CampaignSpendRepository } from '../repositories/campaign-spend.repository';
import {
  resolvePeriodRange,
  type AttributionPeriod,
} from '../utils/attribution-period.util';
import {
  isCalendarDay,
  spendDayRange,
  storeToday,
  type SpendDay,
} from '../utils/spend-day.util';
import {
  countDays,
  enumerateDays,
  splitAcrossDays,
  MAX_SPEND_RANGE_DAYS,
} from '../utils/spend-range.util';

/**
 * What a figure is being recorded against.
 *
 * `adId` is the grain, and null is a real answer rather than a missing one: the
 * Campaign cost this much and the split across its creatives is unknown. It is
 * never "this cost belongs to no Ad", and nothing here invents an Ad to carry
 * it — a synthetic "default Ad" would sit in the card grid forever claiming to
 * be a creative that never ran.
 *
 * Grouped into an object rather than trailing the ids it sits among. A fourth
 * positional uuid next to three others is a call site where a transposition
 * type-checks, and the two it would swap are the Campaign and the creative
 * whose cost is being recorded.
 */
export interface SpendTarget {
  organizationId: string;
  storeId: string;
  campaignId: string;
  adId: string | null;
}

export interface RecordCampaignSpendInput {
  day: string;
  /** In the smallest currency unit. Zero or positive. */
  amount: number;
  currency: string;
  note?: string | null;
}

/**
 * One figure covering a stretch of days, which becomes one row per day.
 *
 * `total` rather than `amount` on purpose: a merchant typing 70000 against a
 * week means seven hundred dollars for the week, not per day. A field named
 * `amount` sitting next to the single-day call that also takes `amount` would
 * make the seven-fold version of that mistake easy to write and impossible to
 * see.
 */
export interface RecordCampaignSpendRangeInput {
  startDay: string;
  endDay: string;
  /** For the whole range, in the smallest currency unit. Zero or positive. */
  total: number;
  currency: string;
  note?: string | null;
}

export interface UpdateCampaignSpendInput {
  amount?: number;
  note?: string | null;
}

/**
 * A Campaign's Spend for a period, with the facts a merchant needs to enter the
 * next row correctly: the currency it must be in, and the latest day it can be
 * dated.
 *
 * Both come from the Store rather than from the browser. A date picker capped
 * by the viewer's own clock would refuse a legitimate figure for a merchant
 * travelling, and offer an impossible one for a Store ahead of them.
 */
export interface CampaignSpendReport {
  campaignId: string;
  /**
   * The Ad the report is scoped to, or null when it covers the whole Campaign
   * — its own rows and its Ads'.
   */
  adId: string | null;
  period: AttributionPeriod;
  /** The Store's currency. Spend is recorded in it and never converted. */
  currency: string;
  /** The Store's timezone — the one a Spend day is read in. */
  timezone: string;
  /** Today where the Store is: the latest day Spend can be recorded for. */
  today: SpendDay;
  /** The inclusive calendar day range the rows cover. */
  from: SpendDay;
  to: SpendDay;
  rows: CampaignSpend[];
  /**
   * What the push cost over the period, in the smallest currency unit and
   * never formatted here: the Campaign's own rows plus its Ads'. There is one
   * cost, read at two grains, and this is it.
   */
  total: number;
  /**
   * The part of `total` recorded without naming an Ad — cost known, split not.
   *
   * Its own figure rather than something the caller subtracts, because the
   * subtraction is the place a reader would go wrong: this is not "spend on no
   * ad", it is the share of the push whose split nobody has typed in yet.
   */
  unsplitTotal: number;
  /** Per-Ad totals for the period, for the Ads with any Spend in it. */
  byAd: AdSpendTotal[];
}

export interface AdSpendTotal {
  adId: string;
  /** In the smallest currency unit. Never formatted here. */
  total: number;
}

/**
 * Recording what a Campaign — or one creative under it — cost.
 *
 * The behaviour that matters most is that recording is a *correction*, not an
 * addition: submitting a day that already has a figure replaces it. Insert
 * semantics would let a double-submit double a day's cost and halve the
 * Campaign's ROAS forever, without ever throwing. The guarantee lives on the
 * unique constraint in the database rather than in a read performed here, and
 * it now holds at both grains: one Campaign-level row per day, and one row per
 * Ad per day.
 *
 * Every write names a `SpendTarget`, whose `adId` is the grain. Both grains go
 * through the same path — the same refusals, the same upsert, the same range
 * split — because they are the same act recorded at different resolutions, and
 * a second implementation for the finer one would be free to drift from the one
 * that has been holding the money correct.
 *
 * Everything else is refusal. Spend is money, so it is an integer in minor
 * units and never negative. A day is a calendar date in the Store's timezone
 * and never in the future — a mistyped year would otherwise sit in the account
 * distorting a period nobody is looking at yet. And the currency must be the
 * Store's, because there is no conversion anywhere in this feature and a
 * figure in the wrong unit is worse than a missing one.
 */
@Injectable()
export class CampaignSpendService {
  constructor(
    private readonly campaigns: CampaignRepository,
    private readonly ads: AdRepository,
    private readonly spend: CampaignSpendRepository,
    private readonly stores: StoreService,
  ) {}

  /**
   * A period's Spend for a target.
   *
   * At the Campaign grain (`adId: null`) this is the whole push: the Campaign's
   * own rows and every one of its Ads'. Anything narrower would let the two
   * levels disagree about what a Campaign cost, which is the one thing this
   * feature cannot do. `unsplitTotal` and `byAd` divide that same figure up
   * rather than adding to it, so the parts always reconcile against the total
   * by construction.
   *
   * At an Ad grain it is that creative's rows alone, and `unsplitTotal` is
   * zero: an Ad's own cost has nothing left to split.
   */
  async list(
    target: SpendTarget,
    period: AttributionPeriod,
  ): Promise<CampaignSpendReport> {
    const { organizationId: orgId, storeId, campaignId, adId } = target;
    await this.requireTarget(target);
    const store = await this.requireStore(orgId, storeId);

    // The same `[start, end)` helper every marketing read shares, converted to
    // calendar days here. Two definitions of "the last 30 days" that disagreed
    // by an hour would make Spend and revenue describe different windows.
    const { start, end } = resolvePeriodRange(period);
    const { from, to } = spendDayRange(start, end, store.timezone);

    const rows = await this.spend.findForCampaign(
      campaignId,
      orgId,
      storeId,
      from,
      to,
      adId ?? undefined,
    );

    // Totalled from the rows already loaded rather than from a second query.
    // A separate sum could answer differently from the rows on screen — after a
    // write between the two reads, say — and a merchant reading a total that
    // does not add up loses trust in every figure beside it.
    const byAd = new Map<string, number>();
    let total = 0;
    let unsplitTotal = 0;
    for (const row of rows) {
      total += row.amount;
      if (row.adId === null) unsplitTotal += row.amount;
      else byAd.set(row.adId, (byAd.get(row.adId) ?? 0) + row.amount);
    }

    return {
      campaignId,
      adId,
      period,
      currency: store.currency,
      timezone: store.timezone,
      today: storeToday(store.timezone, new Date()),
      from,
      to,
      rows,
      total,
      unsplitTotal,
      byAd: [...byAd].map(([id, amount]) => ({ adId: id, total: amount })),
    };
  }

  /**
   * Records one day's Spend for the target, correcting that day if it already
   * has a figure.
   *
   * The correction is per grain. A Campaign-level figure and an Ad-level figure
   * for the same day are two different facts and coexist; two submits of either
   * one replace it. That is the whole of the day-uniqueness guarantee, and it
   * is the database that holds it.
   *
   * The Campaign — or the Ad — may be archived. Closing out a finished
   * creative's real cost is a normal thing to want, and refusing it would leave
   * the account permanently understating what it spent.
   */
  async record(
    target: SpendTarget,
    input: RecordCampaignSpendInput,
  ): Promise<CampaignSpend> {
    const { organizationId: orgId, storeId, campaignId, adId } = target;
    await this.requireTarget(target);
    const store = await this.requireStore(orgId, storeId);

    const day = this.assertDay(input.day, store.timezone);
    const amount = this.assertAmount(input.amount);
    this.assertCurrency(input.currency, store.currency);

    return this.spend.record({
      organizationId: orgId,
      storeId,
      campaignId,
      adId,
      day,
      amount,
      // The Store's own casing, not the caller's: the row is a record of what
      // this Store's money was, and a later currency change must not be able to
      // reinterpret it.
      currency: store.currency,
      note: normalizeNote(input.note),
    });
  }

  /**
   * Records one total across a range of days, as one row per day.
   *
   * A merchant who knows what a week cost but not what each day cost should not
   * have to invent seven figures or fill in seven forms. The rows written sum
   * to exactly the total typed — the remainder of the integer division lands on
   * the first day rather than being dropped — so the range still reconciles
   * against the invoice it came from.
   *
   * Like single-day entry, this is a *correction*: every day in the range is
   * overwritten, not added to. Re-submitting an overlapping range repairs the
   * days it covers instead of doubling them, which is the same guarantee the
   * unique constraint gives `record`, applied to a stretch of days at once.
   */
  async recordRange(
    target: SpendTarget,
    input: RecordCampaignSpendRangeInput,
  ): Promise<CampaignSpend[]> {
    const { organizationId: orgId, storeId, campaignId, adId } = target;
    await this.requireTarget(target);
    const store = await this.requireStore(orgId, storeId);

    const startDay = this.assertDay(input.startDay, store.timezone);
    const endDay = this.assertDay(input.endDay, store.timezone);
    const days = this.assertRange(startDay, endDay);
    const total = this.assertAmount(input.total);
    this.assertCurrency(input.currency, store.currency);

    const note = normalizeNote(input.note);
    const saved = await this.spend.recordMany(
      splitAcrossDays(total, days).map((row) => ({
        organizationId: orgId,
        storeId,
        campaignId,
        adId,
        day: row.day,
        amount: row.amount,
        // The Store's own casing, as in `record` — the row records what this
        // Store's money was, not how the caller spelled it.
        currency: store.currency,
        // The same note on every day of the range. It describes the entry, and
        // there is no per-day fact to say beyond the day itself.
        note,
      })),
    );

    // `RETURNING` has no defined order, and these are rows a merchant reads as
    // a sequence of days.
    return saved.sort((a, b) => a.day.localeCompare(b.day));
  }

  /**
   * Corrects a saved figure.
   *
   * The day is deliberately not editable. Moving a row to another day is
   * recording Spend on that day — which corrects whatever is already there —
   * and deleting the one entered by mistake. Allowing a move would need its own
   * answer for landing on a day that already has a figure, and "silently
   * replace the other one" is not an answer a merchant would expect.
   *
   * Nor is the currency: it is the Store's, frozen on the row.
   */
  async update(
    target: SpendTarget,
    spendId: string,
    input: UpdateCampaignSpendInput,
  ): Promise<CampaignSpend> {
    const { organizationId: orgId, storeId, campaignId } = target;
    await this.requireTarget(target);
    const grain = this.editGrain(target);

    const patch: { amount?: number; note?: string | null } = {};
    if (input.amount !== undefined)
      patch.amount = this.assertAmount(input.amount);
    if (input.note !== undefined) patch.note = normalizeNote(input.note);

    if (Object.keys(patch).length === 0) {
      const existing = await this.spend.findById(
        spendId,
        campaignId,
        orgId,
        storeId,
        grain,
      );
      if (!existing) throw new NotFoundException('Spend row not found');
      return existing;
    }

    const updated = await this.spend.update(
      spendId,
      campaignId,
      orgId,
      storeId,
      patch,
      grain,
    );
    if (!updated) throw new NotFoundException('Spend row not found');
    return updated;
  }

  /**
   * Removes a Spend row.
   *
   * Deletable, unlike a Campaign: a Campaign is history that explains Orders,
   * whereas a Spend row is a record of what a merchant typed. A figure entered
   * against the wrong Campaign should be removable rather than zeroed, because
   * a zero is itself a claim — that this Campaign ran that day and cost nothing.
   */
  async remove(target: SpendTarget, spendId: string): Promise<void> {
    const { organizationId: orgId, storeId, campaignId } = target;
    await this.requireTarget(target);

    const removed = await this.spend.remove(
      spendId,
      campaignId,
      orgId,
      storeId,
      this.editGrain(target),
    );
    if (!removed) throw new NotFoundException('Spend row not found');
  }

  // ─── Refusals ───────────────────────────────────────────────────────────────

  /**
   * The target exists, in this Organization and Store, and the Ad — if one was
   * named — hangs from the Campaign named alongside it.
   *
   * Both checks, not one. The Ad lookup names the Campaign as well, so an Ad id
   * belonging to a sibling Campaign is a 404 rather than a row whose `ad_id`
   * points across a boundary its `campaign_id` denies. Cost recorded against
   * such a row would be summed into one Campaign and split under another.
   *
   * Archived is allowed at both levels on purpose — see `record`.
   */
  private async requireTarget(target: SpendTarget): Promise<void> {
    const { organizationId: orgId, storeId, campaignId, adId } = target;

    const campaign = await this.campaigns.findById(campaignId, orgId, storeId);
    if (!campaign) throw new NotFoundException('Campaign not found');

    if (adId === null) return;
    const ad = await this.ads.findById(adId, campaignId, orgId, storeId);
    if (!ad) throw new NotFoundException('Ad not found');
  }

  /**
   * Which rows an edit or a delete may reach, given how the caller addressed
   * the row.
   *
   * Under an Ad, only that Ad's rows: the Ad in the path is a boundary, not a
   * decoration. Under the Campaign, any of its rows at either grain — that is
   * the address a merchant reaches a mistyped figure from, whichever grain it
   * was typed at, and the Campaign scope is already the tenancy check.
   */
  private editGrain(target: SpendTarget): string | undefined {
    return target.adId ?? undefined;
  }

  private async requireStore(orgId: string, storeId: string) {
    const store = await this.stores.findById(storeId, orgId);
    if (!store) throw new NotFoundException('Store not found');
    return store;
  }

  /**
   * A real calendar day, no later than today where the Store is.
   *
   * The future check is what catches a mistyped year. A row dated 2062 would
   * pass every other rule, appear in no period anyone reads, and quietly
   * withhold its cost from the Campaign's ROAS.
   */
  private assertDay(value: string, timezone: string): SpendDay {
    const day = value.trim();
    if (!isCalendarDay(day)) {
      throw new BadRequestException(
        'A spend day must be a real calendar date, written as YYYY-MM-DD.',
      );
    }

    const today = storeToday(timezone, new Date());
    // Both are zero-padded `YYYY-MM-DD`, so lexical order is date order.
    if (day > today) {
      throw new BadRequestException(
        `Spend cannot be dated in the future — today is ${today} in this store's timezone (${timezone}).`,
      );
    }

    return day;
  }

  /**
   * The days a range covers, refusing one that cannot be spent across.
   *
   * An inverted range is a swapped pair of fields, not a request for nothing:
   * silently writing zero rows would report success and leave the merchant
   * looking for a week of Spend that was never recorded.
   *
   * The upper bound catches the other direction. Nothing bounds how far back a
   * start date may go, so a mistyped year asks for a row every day since 1900 —
   * and a merchant who typed it should be told, not made to wait while it is
   * carried out.
   */
  private assertRange(startDay: SpendDay, endDay: SpendDay): SpendDay[] {
    if (endDay < startDay) {
      throw new BadRequestException(
        `A spend range must end on or after it starts — ${startDay} to ${endDay} runs backwards.`,
      );
    }

    const length = countDays(startDay, endDay);
    if (length > MAX_SPEND_RANGE_DAYS) {
      throw new BadRequestException(
        `A spend range can cover at most ${MAX_SPEND_RANGE_DAYS} days — ${startDay} to ${endDay} covers ${length}. Check the start date.`,
      );
    }

    return enumerateDays(startDay, endDay);
  }

  /**
   * Money, as this system means it: an integer in the smallest currency unit,
   * never negative. Checked here as well as at the DTO so the rule holds for
   * every caller — a mistyped minus sign would otherwise make a losing Campaign
   * look profitable.
   */
  private assertAmount(amount: number): number {
    if (!Number.isSafeInteger(amount)) {
      throw new BadRequestException(
        'Spend must be a whole number in the smallest currency unit — 1250 for $12.50.',
      );
    }
    if (amount < 0) {
      throw new BadRequestException('Spend cannot be negative.');
    }
    return amount;
  }

  /**
   * The Store's currency, and only it. There is no conversion anywhere in this
   * feature, so a figure in another currency cannot be interpreted — it would
   * be summed as if it were the Store's and silently distort every ratio built
   * on it.
   */
  private assertCurrency(supplied: string, storeCurrency: string): void {
    if (supplied.trim().toUpperCase() !== storeCurrency.toUpperCase()) {
      throw new BadRequestException(
        `Spend must be recorded in this store's currency (${storeCurrency}). There is no conversion.`,
      );
    }
  }
}

/** An empty note is no note: a blank string would render as a stray gap. */
function normalizeNote(note: string | null | undefined): string | null {
  return note?.trim() || null;
}
