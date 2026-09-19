import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  AdPlatform,
  Ad,
  UnlinkedAd,
  UnlinkedAdState,
} from '../../../shared/database/schema';
import { isUniqueViolation } from '../../../shared/database/db-error.util';
import { AdRepository } from '../../marketing/repositories/ad.repository';
import { CampaignRepository } from '../../marketing/repositories/campaign.repository';
import { AdService } from '../../marketing/services/ad.service';
import {
  CampaignService,
  type CampaignTaggedLink,
} from '../../marketing/services/campaign.service';
import { PlatformMirrorService } from '../../marketing/services/platform-mirror.service';
import { SyncedSpendService } from '../../marketing/services/synced-spend.service';
import { PLATFORM_LINK_DEFAULTS } from '../../marketing/utils/tagged-link.util';
import { AdReportedFigureRepository } from '../repositories/ad-reported-figure.repository';
import {
  UnlinkedAdRepository,
  type TransitionPatch,
  type UnlinkedAdSightingRow,
} from '../repositories/unlinked-ad.repository';
import {
  nextState,
  refusalFor,
  type UnlinkedAdAction,
} from '../utils/unlinked-ad-state.util';
import {
  planUnlinkedAds,
  type PlatformAdSighting,
} from '../utils/unlinked-ad-plan.util';

/**
 * An ad the platform is spending on, as the merchant is asked about it.
 *
 * Everything on it is there to answer one question — what is this, and is it
 * worth claiming. The name and the creative are how they recognise it, the
 * flight is how they place it in time, and the spend is why they should care.
 */
export interface UnlinkedAdView {
  id: string;
  platform: AdPlatform;
  externalAdId: string;
  name: string | null;
  creativeUrl: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  state: UnlinkedAdState;
  /**
   * What the platform says it has spent since the first day ever pulled for it,
   * in minor units of `currency` — which is the ad account's and may not be the
   * store's. Zero days pulled reads as zero spend with a `days` of 0, and the
   * two are different facts.
   */
  spendToDate: number;
  currency: string | null;
  /** How many days of figures are already held, and what they span. */
  days: number;
  firstDay: string | null;
  lastDay: string | null;
  /** The Ad a claim resolved onto, with the Campaign it hangs from. */
  claimedAdId: string | null;
  claimedAdName: string | null;
  claimedCampaignId: string | null;
  claimedAt: Date | null;
  dismissedAt: Date | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

/**
 * What a claim answers with.
 *
 * The Tagged Link is on this response and not a page away, because it is the
 * merchant's actual next action: the claim told us which Campaign the ad
 * belongs to, and the link is the only thing that will ever tell us what it
 * sold. An ad claimed onto a Campaign whose link is never pasted into the
 * platform reports cost against no revenue for as long as it runs.
 */
export interface ClaimResult {
  unlinkedAd: UnlinkedAdView;
  ad: Ad;
  /** Carrying the Campaign Tag and this Ad's Tag, ready to paste. */
  taggedLink: CampaignTaggedLink | null;
  /**
   * Why no link could be composed, on the rare platform whose defaults are
   * empty. A claim is never failed by this — the ad is claimed either way, and
   * the merchant can build a link from the Ad's own card.
   */
  taggedLinkProblem: string | null;
  /** The history that came with it. Claiming never starts spend from zero. */
  attached: {
    days: number;
    spend: number;
    currency: string | null;
    /**
     * How many of those days were recorded as this Ad's own Spend, labelled
     * `synced`, rather than only as the platform's figures.
     */
    spendDaysRecorded: number;
    /**
     * Set when the ad account's currency is not the Store's, in which case none
     * were. The platform's figures are still attached and still readable in the
     * currency they are in — what is refused is summing them into a book kept
     * in another one, because there is no conversion anywhere (ADR-0005).
     */
    spendCurrencyMismatch: { store: string; account: string } | null;
  };
}

export interface ClaimInput {
  /** The Campaign the ad belongs to. Always required, including on an Ad claim. */
  campaignId: string;
  /** An Ad that already exists here, or omitted to create one under the Campaign. */
  adId?: string;
  /** What to call a newly created Ad. Defaults to what the platform calls it. */
  name?: string;
}

/** What a newly created Ad is called when the platform named it nothing. */
const UNNAMED_AD = 'Untitled ad';

/**
 * Unlinked Ads: holding what a sync found, and resolving it.
 *
 * ## Why this exists at all
 *
 * The sync finds ads the merchant is spending real money on that nothing here
 * claims. **It never turns one into an Ad.** An Ad invented from a platform's
 * tree carries real cost and has no Ad Tag rule, so it has no way to earn
 * revenue — it would show spend against zero and read as a catastrophic loser,
 * auto-generating the most alarming card in the UI. So the ad is held, and the
 * merchant is asked.
 *
 * ## One writer of state
 *
 * Claim, dismiss, restore and unlink all go through `move`, which asks
 * `unlinked-ad-state.util.ts` whether the transition exists and refuses with a
 * sentence when it does not — the convention `OrderService.transition` sets.
 * The sync's own reconciliation goes through the same table of transitions. No
 * other code path writes `unlinked_ads.state`.
 *
 * ## What a claim actually does
 *
 * It writes `ads.external_id`. That one column is the join
 * `ad_reported_figures` was keyed for, so every day already pulled for the ad —
 * the backfill included — attaches to the Ad the moment it is set, with nothing
 * rewritten and no second pass. Unlinking clears it, which detaches the history
 * without losing a row of it.
 *
 * It also records the spend of those days into the merchant's own book, as
 * `synced` Spend against the Ad, through `SyncedSpendService`. That is not the
 * same join doing double duty: a scheduled sync only re-reads a trailing
 * window, so a day backfilled six weeks ago would never come round again, and a
 * claim that left it out would start the creative's Spend from zero — the one
 * thing claiming exists not to do. Unlinking withdraws those rows again,
 * leaving every Reported Figure and everything the merchant typed or pinned
 * exactly where it was.
 *
 * ## What a claim and an unlink never touch
 *
 * `ads.status`. Claiming an ad the platform has rejected does not archive the
 * Ad, and unlinking one does not revive it. The platform's own state rides
 * beside the merchant's on its own column and neither overwrites the other —
 * which is what makes an Ad that is active here and rejected there readable as
 * both, instead of as a contradiction one of them silently won.
 */
@Injectable()
export class UnlinkedAdService {
  private readonly logger = new Logger(UnlinkedAdService.name);

  constructor(
    private readonly unlinked: UnlinkedAdRepository,
    private readonly figures: AdReportedFigureRepository,
    private readonly ads: AdRepository,
    private readonly adService: AdService,
    private readonly campaigns: CampaignRepository,
    private readonly campaignService: CampaignService,
    private readonly syncedSpend: SyncedSpendService,
    private readonly platformMirror: PlatformMirrorService,
  ) {}

  // ─── Reading ────────────────────────────────────────────────────────────────

  async list(
    orgId: string,
    storeId: string,
    state?: UnlinkedAdState,
  ): Promise<UnlinkedAdView[]> {
    const rows = await this.unlinked.findMany(orgId, storeId, state);
    return this.asViews(orgId, storeId, rows);
  }

  /**
   * How many are waiting, and how many have been dealt with.
   *
   * The waiting count is the number surfaced beside the campaign grid, because
   * the merchant will not go looking for a review list they do not know has
   * anything in it — and what is in it is money leaving their account that this
   * system is not counting.
   */
  async counts(
    orgId: string,
    storeId: string,
  ): Promise<{ pending: number; claimed: number; dismissed: number }> {
    const [pending, claimed, dismissed] = await Promise.all([
      this.unlinked.countInState(orgId, storeId, 'pending'),
      this.unlinked.countInState(orgId, storeId, 'claimed'),
      this.unlinked.countInState(orgId, storeId, 'dismissed'),
    ]);
    return { pending, claimed, dismissed };
  }

  // ─── The merchant's four decisions ──────────────────────────────────────────

  /**
   * Resolves an Unlinked Ad onto a Campaign as a new Ad, or onto an Ad that
   * already exists here.
   *
   * The Campaign is named either way, and on the `adId` path it is what scopes
   * the lookup: an Ad has no meaning outside its Campaign (ADR-0004), and an ad
   * id from a sibling Campaign or another tenant reads as "not found".
   *
   * A new Ad is created through `AdService.create`, not by an insert here, so
   * the tag derivation and the per-Campaign uniqueness ticket 01 established
   * apply unchanged — including the canonical `utm_content` rule that is the
   * only reason a tagged link will ever resolve back onto this ad.
   *
   * The transition is **checked** first and **applied** last. Checking first
   * means an ad that is already claimed is refused before an Ad is created for
   * it, so a misdirected second click leaves nothing behind. Applying last
   * means a claim that fails partway leaves a row still asking its question,
   * which is recoverable — where moving the state first would leave an ad
   * marked claimed with nothing claiming it.
   */
  async claim(
    orgId: string,
    storeId: string,
    id: string,
    input: ClaimInput,
    now: Date = new Date(),
  ): Promise<ClaimResult> {
    const row = await this.require(orgId, storeId, id);
    this.assertMove(row, 'claim');

    // Checked before anything is created, so a claim naming another tenant's
    // Campaign creates no Ad on the way to being refused.
    const campaign = await this.campaigns.findById(
      input.campaignId,
      orgId,
      storeId,
    );
    if (!campaign) throw new NotFoundException('Campaign not found');

    const ad = input.adId
      ? await this.attachToExistingAd(
          orgId,
          storeId,
          campaign.id,
          input.adId,
          row,
        )
      : await this.createAdFor(orgId, storeId, campaign.id, row, input.name);

    const moved = await this.move(orgId, storeId, row, 'claim', now, {
      claimedAdId: ad.id,
      claimedAt: now,
      dismissedAt: null,
    });

    // The history, into the merchant's own book, now rather than at the next
    // sync. A scheduled sync only re-reads a trailing window, so a backfilled
    // day from six weeks ago would never be offered again — claiming would
    // attach the platform's figures and start this creative's Spend from zero,
    // which is the opposite of what claiming is for.
    const attachedSpend = await this.attachSpendFor(orgId, storeId, ad.id, row);

    const [view] = await this.asViews(orgId, storeId, [moved]);
    const link = await this.taggedLinkFor(orgId, storeId, campaign.id, ad.tag);

    this.logger.log(
      `Claimed platform ad ${row.externalAdId} (${row.platform}) onto ad ${ad.id} in store ${storeId}`,
    );

    return {
      unlinkedAd: view,
      ad,
      taggedLink: link.link,
      taggedLinkProblem: link.problem,
      attached: {
        days: view.days,
        spend: view.spendToDate,
        currency: view.currency,
        spendDaysRecorded: attachedSpend.written,
        spendCurrencyMismatch: attachedSpend.currencyMismatch,
      },
    };
  }

  /**
   * The merchant does not want this ad tracked.
   *
   * Durable by construction rather than by a flag the sync has to remember to
   * check: the sync's write updates what the ad looks like and never its state,
   * so a dismissed ad is met again on every run and stays dismissed.
   *
   * Nothing happens to its Reported Figures. They stay pulled and stay
   * readable — the merchant declined to attribute the money, not to know about
   * it.
   */
  async dismiss(
    orgId: string,
    storeId: string,
    id: string,
    now: Date = new Date(),
  ): Promise<UnlinkedAdView> {
    const row = await this.require(orgId, storeId, id);
    const moved = await this.move(orgId, storeId, row, 'dismiss', now, {
      dismissedAt: now,
    });
    const [view] = await this.asViews(orgId, storeId, [moved]);
    return view;
  }

  /** Back into the list. A misclick on dismiss must not be permanent. */
  async restore(
    orgId: string,
    storeId: string,
    id: string,
    now: Date = new Date(),
  ): Promise<UnlinkedAdView> {
    const row = await this.require(orgId, storeId, id);
    const moved = await this.move(orgId, storeId, row, 'restore', now, {
      dismissedAt: null,
    });
    const [view] = await this.asViews(orgId, storeId, [moved]);
    return view;
  }

  /**
   * Undoes a claim: the platform id comes off the Ad and the row goes back to
   * waiting.
   *
   * **The Ad itself is kept.** It may already have earned revenue through its
   * own tag, and deleting it would silently re-bucket that money — the same
   * reason there is no delete for an Ad anywhere in this codebase. What is
   * undone is the link to the platform, and with it the attachment of the
   * platform's history; no figure is deleted, and a reclaim brings all of it
   * back.
   */
  async unlink(
    orgId: string,
    storeId: string,
    id: string,
    now: Date = new Date(),
  ): Promise<UnlinkedAdView> {
    const row = await this.require(orgId, storeId, id);

    if (row.claimedAdId) {
      const ad = await this.ads.findByIdInStore(
        row.claimedAdId,
        orgId,
        storeId,
      );
      // Only if it still carries *this* ad's id: an Ad repointed at a different
      // platform ad in the meantime is not this claim's to clear.
      if (ad && ad.externalId === row.externalAdId) {
        await this.ads.update(ad.id, ad.campaignId, orgId, storeId, {
          externalId: null,
        });
        // The cost goes with the claim. Not a figure is deleted from the
        // platform's book — `ad_reported_figures` is untouched, and a reclaim
        // brings all of it back — but an Ad that no longer claims a platform ad
        // must stop reporting what that ad spent, or the same days would be
        // counted again under whichever Ad claims it next.
        await this.syncedSpend.detach(orgId, storeId, ad.id);
        // And what the platform said about it. This is the one place either
        // field is cleared: a sync that stops reporting an ad preserves them,
        // because an ad leaves a tree for reasons that are not facts about the
        // ad — but an Ad that claims no platform ad has no platform state, and
        // a preserved "rejected" on it would be a confident sentence about
        // somebody else's ad. Its own status is untouched, as always.
        await this.platformMirror.forget(orgId, storeId, ad.id);
      }
    }

    const moved = await this.move(orgId, storeId, row, 'unlink', now, {
      claimedAdId: null,
      claimedAt: null,
    });
    const [view] = await this.asViews(orgId, storeId, [moved]);
    return view;
  }

  // ─── What the sync calls ────────────────────────────────────────────────────

  /**
   * Records what one sync saw, and reconciles it with what this Store claims.
   *
   * Called by the sync after the figures are written, and returns rather than
   * throws for the same reason every other step of a sync does: this is
   * bookkeeping behind a scheduled job, and a merchant's dashboard is not the
   * place a failure here should surface.
   *
   * Three things come out of `planUnlinkedAds`, and none of them is an Ad:
   * ads to hold, pending rows an Ad has since come to claim by hand, and
   * claimed rows whose Ad no longer carries the platform id. The last two are
   * transitions and go through the same engine a merchant's click does.
   */
  async recordSighting(
    scope: {
      orgId: string;
      storeId: string;
      connectionId: string;
      platform: AdPlatform;
    },
    sightings: readonly PlatformAdSighting[],
    now: Date = new Date(),
  ): Promise<{ held: number; resolved: number; released: number }> {
    const [claimedByAds, held] = await Promise.all([
      this.unlinked.adsByExternalId(scope.orgId, scope.storeId),
      this.unlinked.statesForConnection(scope.connectionId),
    ]);

    const plan = planUnlinkedAds({ sightings, claimedByAds, held });

    const rows: UnlinkedAdSightingRow[] = plan.hold.map((sighting) => ({
      ...sighting,
      organizationId: scope.orgId,
      storeId: scope.storeId,
      connectionId: scope.connectionId,
      platform: scope.platform,
    }));
    await this.unlinked.holdMany(rows, now);

    for (const { externalAdId, adId } of plan.resolve) {
      await this.unlinked.transitionByExternalId(
        scope.connectionId,
        externalAdId,
        'pending',
        'claimed',
        { claimedAdId: adId, claimedAt: now, dismissedAt: null },
        now,
      );
    }

    for (const externalAdId of plan.release) {
      await this.unlinked.transitionByExternalId(
        scope.connectionId,
        externalAdId,
        'claimed',
        'pending',
        { claimedAdId: null, claimedAt: null },
        now,
      );
    }

    return {
      held: plan.hold.length,
      resolved: plan.resolve.length,
      released: plan.release.length,
    };
  }

  // ─── Internals ──────────────────────────────────────────────────────────────

  private async require(
    orgId: string,
    storeId: string,
    id: string,
  ): Promise<UnlinkedAd> {
    const row = await this.unlinked.findById(id, orgId, storeId);
    if (!row) throw new NotFoundException('Unlinked ad not found');
    return row;
  }

  /**
   * The one place a state is written, and the one place an illegal move is
   * refused.
   *
   * The transition table decides whether the move exists; the repository's
   * `state = from` predicate decides whether the row is still where the caller
   * found it. A row somebody else moved a moment ago matches nothing and reads
   * back as the same refusal, rather than as this request overwriting their
   * decision.
   */
  private async move(
    orgId: string,
    storeId: string,
    row: UnlinkedAd,
    action: UnlinkedAdAction,
    now: Date,
    patch: TransitionPatch,
  ): Promise<UnlinkedAd> {
    const to = this.assertMove(row, action);

    const moved = await this.unlinked.transition(
      row.id,
      orgId,
      storeId,
      row.state,
      to,
      patch,
      now,
    );
    if (!moved) throw new ConflictException(refusalFor(row.state, action));
    return moved;
  }

  /**
   * Whether the move exists, answered before any work is done towards it.
   *
   * Separate from `move` so a claim can be refused *before* it creates an Ad:
   * pressing Claim twice must cost nothing, and the second press finding out
   * only at the write would already have built the Ad it was refused.
   */
  private assertMove(
    row: UnlinkedAd,
    action: UnlinkedAdAction,
  ): UnlinkedAdState {
    const to = nextState(row.state, action);
    if (to === null) throw new ConflictException(refusalFor(row.state, action));
    return to;
  }

  /**
   * Records the platform's id against an Ad that already exists here, without
   * creating a second one.
   *
   * The unique index on `(store_id, external_id)` is the authority, not the
   * read above it: two admins claiming one platform ad onto two Ads at the same
   * moment must not both win, because both Ads would then match the same
   * figures and the same spend would be reported twice under two names.
   */
  private async attachToExistingAd(
    orgId: string,
    storeId: string,
    campaignId: string,
    adId: string,
    row: UnlinkedAd,
  ): Promise<Ad> {
    const ad = await this.ads.findById(adId, campaignId, orgId, storeId);
    if (!ad) throw new NotFoundException('Ad not found');

    // Already carrying it is success, not a conflict: the merchant is claiming
    // the ad the Ad already points at, and the row simply had not caught up.
    if (ad.externalId === row.externalAdId) return ad;

    if (ad.externalId) {
      throw new ConflictException(
        `"${ad.name}" is already linked to a different ad on the platform. Unlink that one first.`,
      );
    }

    try {
      const updated = await this.ads.update(ad.id, campaignId, orgId, storeId, {
        externalId: row.externalAdId,
      });
      if (!updated) throw new NotFoundException('Ad not found');
      return updated;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          'Another ad in this store has already claimed this platform ad.',
        );
      }
      throw error;
    }
  }

  /** Creates the Ad this platform ad becomes, through the ordinary Ad path. */
  private async createAdFor(
    orgId: string,
    storeId: string,
    campaignId: string,
    row: UnlinkedAd,
    name: string | undefined,
  ): Promise<Ad> {
    const chosen = (name ?? row.name ?? '').trim() || UNNAMED_AD;

    let ad: Ad;
    try {
      ad = await this.adService.create(orgId, storeId, campaignId, {
        name: chosen,
        externalId: row.externalAdId,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          'Another ad in this store has already claimed this platform ad.',
        );
      }
      throw error;
    }

    // The creative the platform hosts, carried onto the Ad so the card the
    // merchant ends up with looks like the ad they recognised in the list. A
    // URL rather than an upload, which is exactly what the column is for.
    if (row.creativeUrl) {
      const withCreative = await this.ads.update(
        ad.id,
        campaignId,
        orgId,
        storeId,
        { creativeUrl: row.creativeUrl },
      );
      if (withCreative) return withCreative;
    }

    return ad;
  }

  /**
   * The spend already pulled for this platform ad, recorded as the Ad's own.
   *
   * Grouped by currency and never summed across two of them, for the reason
   * nothing in this feature crosses a currency: an ad account that reported in
   * two currencies has days that cannot be added together, and the group whose
   * currency is not the Store's is refused by `SyncedSpendService` rather than
   * converted (ADR-0005).
   *
   * Reported, never thrown. The claim has already happened by the time this
   * runs, and failing a claim that succeeded because its bookkeeping did not
   * would be the worst of both — the next sync records the trailing window
   * anyway, and the merchant can enter any older day by hand.
   */
  private async attachSpendFor(
    orgId: string,
    storeId: string,
    adId: string,
    row: UnlinkedAd,
  ): Promise<{
    written: number;
    currencyMismatch: { store: string; account: string } | null;
  }> {
    try {
      const days = await this.figures.dailySpendFor(
        orgId,
        storeId,
        row.externalAdId,
      );
      if (days.length === 0) return { written: 0, currencyMismatch: null };

      const byCurrency = new Map<string, typeof days>();
      for (const day of days) {
        const group = byCurrency.get(day.currency);
        if (group) group.push(day);
        else byCurrency.set(day.currency, [day]);
      }

      let written = 0;
      let mismatch: { store: string; account: string } | null = null;
      for (const [currency, group] of byCurrency) {
        const outcome = await this.syncedSpend.apply({
          organizationId: orgId,
          storeId,
          currency,
          days: group.map((day) => ({
            externalAdId: row.externalAdId,
            day: day.day,
            amount: day.spend,
          })),
        });
        written += outcome.written;
        mismatch ??= outcome.currencyMismatch;
      }

      return { written, currencyMismatch: mismatch };
    } catch (error) {
      this.logger.error(
        `Claimed ad ${adId} but could not record its pulled spend: ${
          error instanceof Error
            ? (error.stack ?? error.message)
            : String(error)
        }`,
      );
      return { written: 0, currencyMismatch: null };
    }
  }

  /**
   * The link that makes the ad measurable, composed at the moment of claiming.
   *
   * Carries the Campaign Tag and this Ad's Tag, because pasting it into the
   * platform is the merchant's next action and the only thing that will ever
   * join the platform's ad to our Orders. Source and medium default from the
   * Campaign's platform; a merchant who wants different ones builds the link
   * from the Ad's own card, which is unchanged.
   *
   * A problem composing it is reported, never thrown. The ad is claimed either
   * way — failing a claim that already succeeded because a convenience could
   * not be generated would be the worst of both.
   */
  private async taggedLinkFor(
    orgId: string,
    storeId: string,
    campaignId: string,
    adTag: string,
  ): Promise<{ link: CampaignTaggedLink | null; problem: string | null }> {
    const campaign = await this.campaigns.findById(campaignId, orgId, storeId);
    if (!campaign) return { link: null, problem: null };

    const defaults = PLATFORM_LINK_DEFAULTS[campaign.platform];
    if (!defaults.source || !defaults.medium) {
      return {
        link: null,
        problem:
          'This campaign’s platform has no default source and medium, so build the link from the ad’s card.',
      };
    }

    try {
      const link = await this.campaignService.generateLink(
        orgId,
        storeId,
        campaignId,
        {
          destination: '/',
          source: defaults.source,
          medium: defaults.medium,
          content: adTag,
        },
      );
      return { link, problem: null };
    } catch (error) {
      return {
        link: null,
        problem:
          error instanceof BadRequestException
            ? error.message
            : 'The tagged link could not be generated. Build it from the ad’s card.',
      };
    }
  }

  /**
   * Rows as the merchant reads them, with the spend that makes them worth
   * reading.
   *
   * The spend is summed from `ad_reported_figures` on the platform's ad id in
   * one query for the whole list, rather than stored on the row: those figures
   * are the platform's book, they are restated for days after the fact, and a
   * copy here would be the copy that goes quietly wrong.
   */
  private async asViews(
    orgId: string,
    storeId: string,
    rows: UnlinkedAd[],
  ): Promise<UnlinkedAdView[]> {
    if (rows.length === 0) return [];

    const [totals, adNames] = await Promise.all([
      this.figures.spendToDate(
        orgId,
        storeId,
        rows.map((row) => row.externalAdId),
      ),
      this.unlinked.adNamesById(
        rows.flatMap((row) => (row.claimedAdId ? [row.claimedAdId] : [])),
        orgId,
        storeId,
      ),
    ]);

    // Grouped by currency as well as by ad, so nothing is ever summed across
    // two. An ad account's currency does not change, so in practice each ad has
    // one group; where a platform contradicts itself, the most recently
    // reported currency is the one shown rather than an invented total.
    const spend = new Map<string, (typeof totals)[number]>();
    for (const total of totals) {
      const current = spend.get(total.externalAdId);
      if (!current || total.lastDay > current.lastDay) {
        spend.set(total.externalAdId, total);
      }
    }

    return rows.map((row) => {
      const total = spend.get(row.externalAdId);
      const claimed = row.claimedAdId
        ? adNames.get(row.claimedAdId)
        : undefined;

      return {
        id: row.id,
        platform: row.platform,
        externalAdId: row.externalAdId,
        name: row.name,
        creativeUrl: row.creativeUrl,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        state: row.state,
        spendToDate: total?.spend ?? 0,
        currency: total?.currency ?? null,
        days: total?.days ?? 0,
        firstDay: total?.firstDay || null,
        lastDay: total?.lastDay || null,
        claimedAdId: row.claimedAdId,
        claimedAdName: claimed?.name ?? null,
        claimedCampaignId: claimed?.campaignId ?? null,
        claimedAt: row.claimedAt,
        dismissedAt: row.dismissedAt,
        firstSeenAt: row.firstSeenAt,
        lastSeenAt: row.lastSeenAt,
      };
    });
  }
}
