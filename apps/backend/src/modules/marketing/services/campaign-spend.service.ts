import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CampaignSpend } from '../../../shared/database/schema';
import { StoreService } from '../../tenant/services/store.service';
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

export interface RecordCampaignSpendInput {
  day: string;
  /** In the smallest currency unit. Zero or positive. */
  amount: number;
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
  /** The period's Spend in the smallest currency unit. Never formatted here. */
  total: number;
}

/**
 * Recording what a Campaign cost.
 *
 * The behaviour that matters most is that recording is a *correction*, not an
 * addition: submitting a day that already has a figure replaces it. Insert
 * semantics would let a double-submit double a day's cost and halve the
 * Campaign's ROAS forever, without ever throwing. The guarantee lives on the
 * unique constraint in the database rather than in a read performed here.
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
    private readonly spend: CampaignSpendRepository,
    private readonly stores: StoreService,
  ) {}

  async list(
    orgId: string,
    storeId: string,
    campaignId: string,
    period: AttributionPeriod,
  ): Promise<CampaignSpendReport> {
    await this.requireCampaign(orgId, storeId, campaignId);
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
    );

    return {
      campaignId,
      period,
      currency: store.currency,
      timezone: store.timezone,
      today: storeToday(store.timezone, new Date()),
      from,
      to,
      rows,
      total: rows.reduce((sum, row) => sum + row.amount, 0),
    };
  }

  /**
   * Records one day's Spend, correcting that day if it already has a figure.
   *
   * The Campaign may be archived. Closing out a finished Campaign's real cost
   * is a normal thing to want, and refusing it would leave the account
   * permanently understating what it spent.
   */
  async record(
    orgId: string,
    storeId: string,
    campaignId: string,
    input: RecordCampaignSpendInput,
  ): Promise<CampaignSpend> {
    await this.requireCampaign(orgId, storeId, campaignId);
    const store = await this.requireStore(orgId, storeId);

    const day = this.assertDay(input.day, store.timezone);
    const amount = this.assertAmount(input.amount);
    this.assertCurrency(input.currency, store.currency);

    return this.spend.record({
      organizationId: orgId,
      storeId,
      campaignId,
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
    orgId: string,
    storeId: string,
    campaignId: string,
    spendId: string,
    input: UpdateCampaignSpendInput,
  ): Promise<CampaignSpend> {
    await this.requireCampaign(orgId, storeId, campaignId);

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
  async remove(
    orgId: string,
    storeId: string,
    campaignId: string,
    spendId: string,
  ): Promise<void> {
    await this.requireCampaign(orgId, storeId, campaignId);

    const removed = await this.spend.remove(
      spendId,
      campaignId,
      orgId,
      storeId,
    );
    if (!removed) throw new NotFoundException('Spend row not found');
  }

  // ─── Refusals ───────────────────────────────────────────────────────────────

  /**
   * The Campaign, in this Organization and Store. Archived is allowed on
   * purpose — see `record`.
   */
  private async requireCampaign(
    orgId: string,
    storeId: string,
    campaignId: string,
  ): Promise<void> {
    const campaign = await this.campaigns.findById(campaignId, orgId, storeId);
    if (!campaign) throw new NotFoundException('Campaign not found');
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
