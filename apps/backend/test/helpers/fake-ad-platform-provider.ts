import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { AdPlatform } from '../../src/shared/database/schema';
import {
  CampaignRejectedError,
  CreateInFlightError,
} from '../../src/modules/ad-platform/interfaces/ad-platform-provider.interface';
import type {
  AdAccountOption,
  AdPlatformProvider,
  AdTree,
  CampaignDraft,
  CampaignDraftInput,
  CreateCampaignInput,
  CreatedCampaign,
  DraftCheck,
  DraftComplaint,
  BeginConnectionInput,
  BeginConnectionResult,
  CompleteConnectionInput,
  ConnectionGrant,
  CreativeFile,
  EnsurePixelInput,
  FetchAdTreeInput,
  GrantedAccount,
  IssueCredentialInput,
  LinkTagRefusal,
  LinkTagWrite,
  ProviderHealth,
  PurchaseEvent,
  ReadLinkTagsInput,
  SendPurchaseInput,
  StoreCredential,
  WriteLinkTagsInput,
} from '../../src/modules/ad-platform/interfaces/ad-platform-provider.interface';

interface IssuedCredential extends StoreCredential {
  storeId: string;
  storeName: string;
}

interface BegunConnection {
  platform: AdPlatform;
  returnUrl: string;
  providerRef: string;
}

interface ReleaseRecord {
  providerRef: string;
  platform: AdPlatform;
  providerAccountRef: string;
}

/** A pixel this fake was asked to find or make, and what it answered with. */
export interface PixelRecord {
  providerAccountRef: string;
  externalAccountId: string;
  storeName: string;
  /** Whether there was one already, or this call created it. */
  created: boolean;
  pixelId: string;
}

/**
 * What a sync asked for, which is most of what is worth asserting about one:
 * that a first connection asked for history rather than for today, and that
 * every sync after it asked for a window that overlaps what it already holds.
 */
export interface FetchRecord {
  providerRef: string;
  platform: AdPlatform;
  providerAccountRef: string;
  externalAccountId: string;
  from: string;
  to: string;
}

/**
 * One purchase this fake was told about — the whole of what is worth asserting
 * about the other direction of the integration.
 *
 * The event is kept verbatim, because every claim ticket 06 makes is a claim
 * about its contents: that the event id is the Order's id so the browser's copy
 * and this one collapse into one purchase, that the frozen browser identifiers
 * travelled with it, and that the total arrived as the platform's decimal rather
 * than as our cents.
 */
export interface PurchaseRecord {
  providerRef: string;
  platform: AdPlatform;
  providerAccountRef: string;
  pixelId: string;
  event: PurchaseEvent;
}

/** One ad whose link tags the sync asked for. */
export interface TagReadRecord {
  providerRef: string;
  externalAdId: string;
}

/**
 * One tag write the fake was asked for — the assertion that matters most about
 * Start tracking, since each one sends a merchant's ad back through review.
 */
export interface TagWriteRecord {
  providerRef: string;
  externalAdId: string;
  /** Exactly what was sent, as `key=value` joined with `&`. */
  urlTags: string;
}

/**
 * One campaign this fake was asked to create — the assertion the whole create
 * path exists for: that every ad went out carrying the Link Tags, in the same
 * call that made it.
 */
export interface CreateRecord {
  providerRef: string;
  providerAccountRef: string;
  externalAccountId: string;
  idempotencyKey: string;
  draft: CampaignDraft;
  /** The tags every ad was created carrying, as `key=value` joined with `&`. */
  urlTags: string;
  /** What the platform answered with, so a replay can answer the same. */
  created: CreatedCampaign;
}

/** What the merchant approved at the platform, and what it can see. */
interface Approval {
  providerAccountRef: string;
  accounts: AdAccountOption[];
}

/**
 * Stands in for the ad platform. The second collaborator in the suite that
 * would otherwise reach a third party over the network, faked the way the
 * payment provider already is, and swapped in through the same
 * `overrideProvider` seam — everything else stays production wiring against a
 * real database.
 *
 * It records what it was asked for, because most of what is worth asserting
 * about this integration is a question about the request rather than the
 * response: that a credential was issued per Store and not once for the
 * Organization, that the merchant was sent to the platform's own approval
 * screen, that a pixel was looked for before one was created, and that a
 * disconnect actually reached the provider.
 *
 * `approve` and `deny` let a test say what the merchant did on the platform's
 * screen, and `approve` also says which ad accounts that login can see — the
 * one thing a fake has to supply that a real provider would learn from the
 * merchant's own Meta account.
 */
@Injectable()
export class FakeAdPlatformProvider implements AdPlatformProvider {
  readonly issued: IssuedCredential[] = [];
  readonly begun: BegunConnection[] = [];
  readonly disconnected: ReleaseRecord[] = [];
  readonly revoked: string[] = [];
  readonly pixels: PixelRecord[] = [];

  /** What the merchant will have approved, keyed `providerRef:platform`. */
  private readonly approvals = new Map<string, Approval>();

  /** Pixels the ad account already had, keyed by ad account id. */
  private readonly existingPixels = new Map<string, string>();

  readonly fetched: FetchRecord[] = [];
  readonly purchases: PurchaseRecord[] = [];

  readonly tagReads: TagReadRecord[] = [];
  /** Every creative URL the sync fetched, in order. */
  readonly creativeFetches: string[] = [];

  /**
   * What the platform will say is on each ad account, keyed by the ad
   * account's id — which a test knows before it connects, so the tree can be
   * in place for the backfill that connecting runs.
   */
  private readonly trees = new Map<string, AdTree>();

  /** Each ad's stored link tags, keyed by the ad's platform id. */
  private readonly linkTags = new Map<string, string | null>();

  readonly tagWrites: TagWriteRecord[] = [];

  /** Ads the platform will refuse to retag, and why. */
  private readonly tagRefusals = new Map<string, LinkTagRefusal>();

  /**
   * Makes tag writes throw after this many have succeeded — a platform that
   * goes away part-way through. Null never fails.
   */
  failTagWritesAfter: number | null = null;

  /** Every campaign actually created, in order. A replayed key adds none. */
  readonly creates: CreateRecord[] = [];

  /** Every dry run asked for, in order. */
  readonly validations: CampaignDraftInput[] = [];

  /** What the dry run will object to. Empty accepts every draft. */
  draftComplaints: DraftComplaint[] = [];

  /**
   * What the real create will object to, when the dry run could not see it —
   * a video Meta could not use. Null creates.
   */
  createRejection: DraftComplaint[] | null = null;

  /** Makes the next create answer "already in flight", as a double press would. */
  createInFlight = false;

  /**
   * Makes a create reach the platform and then fail before answering, the way
   * a dropped connection does. The campaign exists at the platform; a retry
   * with the same key is answered with it rather than making another.
   */
  failAfterCreating = false;

  private campaignSeq = 0;

  /** Makes creative downloads fail — a CDN link that has already expired. */
  failCreatives = false;

  /** Makes link-tag reads fail, independently of the tree read. */
  failTagReads = false;

  /** Makes the next provider call fail, the way a vendor outage would. */
  failNext: Error | null = null;

  /**
   * Makes every call fail until it is cleared — a vendor outage that lasts
   * longer than one request, which is what a merchant actually experiences.
   */
  failAlways: Error | null = null;

  /** What `health` answers. A provider can be down without being unreachable. */
  reachable = true;
  maxBackfillDays = 365;

  /**
   * Says the merchant approved at the platform, and which ad accounts the
   * login they used can see.
   *
   * One usable account by default, because that is the ordinary merchant: a
   * test that cares about the picker says so by passing several.
   */
  approve(
    providerRef: string,
    platform: AdPlatform,
    accounts: Partial<AdAccountOption>[] = [{}],
  ): Approval {
    const approval: Approval = {
      providerAccountRef: `acct_${randomUUID()}`,
      accounts: accounts.map((account, index) => ({
        externalAccountId: account.externalAccountId ?? `act_${100 + index}`,
        name: account.name ?? `Test Ad Account ${index + 1}`,
        currency: account.currency ?? 'USD',
        unusableReason: account.unusableReason ?? null,
      })),
    };
    this.approvals.set(`${providerRef}:${platform}`, approval);
    return approval;
  }

  /** Says the merchant denied, or closed the tab without choosing. */
  deny(providerRef: string, platform: AdPlatform): void {
    this.approvals.delete(`${providerRef}:${platform}`);
  }

  /** Says this ad account already has a pixel, so none has to be created. */
  setExistingPixel(externalAccountId: string, pixelId: string): void {
    this.existingPixels.set(externalAccountId, pixelId);
  }

  /** Says what the platform will report for this ad account. */
  setAdTree(externalAccountId: string, tree: AdTree): void {
    this.trees.set(externalAccountId, tree);
  }

  /** Says what link tags an ad carries on the platform. Untagged by default. */
  setLinkTags(externalAdId: string, urlTags: string | null): void {
    this.linkTags.set(externalAdId, urlTags);
  }

  /** Says the platform will refuse to retag this ad, the way it refuses one made from a post. */
  refuseTagWrite(externalAdId: string, reason: LinkTagRefusal): void {
    this.tagRefusals.set(externalAdId, reason);
  }

  /** The ad's link tags as the platform now holds them. */
  linkTagsOf(externalAdId: string): string | null {
    return this.linkTags.get(externalAdId) ?? null;
  }

  /** How many times the sync asked for one ad's tags. */
  tagReadsFor(externalAdId: string): number {
    return this.tagReads.filter((r) => r.externalAdId === externalAdId).length;
  }

  /** The credential issued for a store, as a test that seeded one can find it. */
  credentialFor(storeId: string): IssuedCredential | undefined {
    return this.issued.find((entry) => entry.storeId === storeId);
  }

  reset(): void {
    this.issued.length = 0;
    this.begun.length = 0;
    this.disconnected.length = 0;
    this.revoked.length = 0;
    this.fetched.length = 0;
    this.tagReads.length = 0;
    this.creativeFetches.length = 0;
    this.linkTags.clear();
    this.tagWrites.length = 0;
    this.tagRefusals.clear();
    this.creates.length = 0;
    this.validations.length = 0;
    this.draftComplaints = [];
    this.createRejection = null;
    this.createInFlight = false;
    this.failAfterCreating = false;
    this.failTagWritesAfter = null;
    this.failCreatives = false;
    this.failTagReads = false;
    this.pixels.length = 0;
    this.purchases.length = 0;
    this.approvals.clear();
    this.existingPixels.clear();
    this.trees.clear();
    this.failNext = null;
    this.failAlways = null;
    this.reachable = true;
    this.maxBackfillDays = 365;
  }

  issueStoreCredential(input: IssueCredentialInput): Promise<StoreCredential> {
    this.maybeFail();
    const credential: IssuedCredential = {
      providerRef: `ref_${randomUUID()}`,
      providerKeyRef: `key_${randomUUID()}`,
      secret: `secret_${randomUUID()}`,
      storeId: input.storeId,
      storeName: input.storeName,
    };
    this.issued.push(credential);
    return Promise.resolve(credential);
  }

  beginConnection(input: BeginConnectionInput): Promise<BeginConnectionResult> {
    this.maybeFail();
    this.begun.push({
      platform: input.platform,
      returnUrl: input.returnUrl,
      providerRef: input.credential.providerRef,
    });
    // A stand-in for the platform's hosted approval screen and its Facebook
    // Page picker. The return URL rides on it exactly as it would in the real
    // flow.
    return Promise.resolve({
      approvalUrl: `https://approve.test/${input.platform}?return=${encodeURIComponent(input.returnUrl)}`,
    });
  }

  completeConnection(
    input: CompleteConnectionInput,
  ): Promise<ConnectionGrant | null> {
    this.maybeFail();
    const approval = this.approvalFor(
      input.credential.providerRef,
      input.platform,
    );
    return Promise.resolve(
      approval ? { providerAccountRef: approval.providerAccountRef } : null,
    );
  }

  listAdAccounts(input: GrantedAccount): Promise<readonly AdAccountOption[]> {
    this.maybeFail();
    const approval = this.approvalFor(
      input.credential.providerRef,
      input.platform,
    );
    if (approval?.providerAccountRef !== input.providerAccountRef) {
      // A grant this login never gave. The real provider answers the same way,
      // and the distinction matters: it is what stops a stale grant from
      // reaching an ad account after the merchant revoked it.
      return Promise.resolve([]);
    }
    return Promise.resolve(approval.accounts);
  }

  /**
   * Answers with the pixel the account already had, or makes one.
   *
   * Both paths are recorded, because "was one created" is the assertion worth
   * making: creating a pixel is not idempotent at the real platform, so a
   * connection that created one every time would litter a merchant's ad
   * account with them.
   */
  ensurePixel(input: EnsurePixelInput): Promise<string> {
    this.maybeFail();
    const existing = this.existingPixels.get(input.externalAccountId);
    const pixelId = existing ?? `pixel_${randomUUID()}`;
    if (!existing) this.existingPixels.set(input.externalAccountId, pixelId);

    this.pixels.push({
      providerAccountRef: input.providerAccountRef,
      externalAccountId: input.externalAccountId,
      storeName: input.storeName,
      created: !existing,
      pixelId,
    });
    return Promise.resolve(pixelId);
  }

  disconnect(input: GrantedAccount): Promise<void> {
    this.maybeFail();
    this.disconnected.push({
      providerRef: input.credential.providerRef,
      platform: input.platform,
      providerAccountRef: input.providerAccountRef,
    });
    this.approvals.delete(`${input.credential.providerRef}:${input.platform}`);
    return Promise.resolve();
  }

  revokeStoreCredential(credential: StoreCredential): Promise<void> {
    this.maybeFail();
    this.revoked.push(credential.providerRef);
    return Promise.resolve();
  }

  /**
   * Records the range and answers with whatever the test said is running.
   *
   * An account nobody set a tree for reports nothing rather than failing: an ad
   * account with no ads in the window is a real and unremarkable answer.
   */
  fetchAdTree(input: FetchAdTreeInput): Promise<AdTree> {
    this.maybeFail();
    this.fetched.push({
      providerRef: input.credential.providerRef,
      platform: input.platform,
      providerAccountRef: input.providerAccountRef,
      externalAccountId: input.externalAccountId,
      from: input.from,
      to: input.to,
    });

    return Promise.resolve(
      this.trees.get(input.externalAccountId) ?? {
        currency: null,
        campaigns: [],
        complete: true,
      },
    );
  }

  readLinkTags(input: ReadLinkTagsInput): Promise<string | null> {
    this.maybeFail();
    this.tagReads.push({
      providerRef: input.credential.providerRef,
      externalAdId: input.externalAdId,
    });
    if (this.failTagReads) {
      return Promise.reject(new Error('tag read refused'));
    }
    return Promise.resolve(this.linkTags.get(input.externalAdId) ?? null);
  }

  /**
   * Records the write and, unless the ad is one the platform refuses, stores the
   * tags — so a later read, by the sync or by a second press, sees them.
   */
  writeLinkTags(input: WriteLinkTagsInput): Promise<LinkTagWrite> {
    this.maybeFail();
    if (
      this.failTagWritesAfter !== null &&
      this.tagWrites.length >= this.failTagWritesAfter
    ) {
      return Promise.reject(new Error('tag write refused'));
    }

    const refusal = this.tagRefusals.get(input.externalAdId);
    if (refusal)
      return Promise.resolve({ outcome: 'refused', reason: refusal });

    const urlTags = input.tags
      .map(({ key, value }) => `${key}=${value}`)
      .join('&');
    this.tagWrites.push({
      providerRef: input.credential.providerRef,
      externalAdId: input.externalAdId,
      urlTags,
    });
    this.linkTags.set(input.externalAdId, urlTags);
    return Promise.resolve({ outcome: 'written' });
  }

  /**
   * Answers with whatever the test said is wrong with the draft, and records
   * the draft, so a test can assert the dry run saw what was about to be sent.
   * Video ads are unchecked, as they are at the real platform.
   */
  validateCampaign(input: CampaignDraftInput): Promise<DraftCheck> {
    this.maybeFail();
    this.validations.push(input);
    return Promise.resolve({
      complaints: [...this.draftComplaints],
      unchecked: input.draft.ads
        .map((ad, index) => (ad.media.kind === 'video' ? index : -1))
        .filter((index) => index >= 0),
    });
  }

  /**
   * Builds the campaign the way the platform does: every ad under one campaign
   * with platform ids of its own, each carrying the draft's tags, which a later
   * read by the sync sees.
   *
   * A key it has already created under is answered with the first campaign,
   * exactly as the real idempotency replay is, and nothing new is built.
   */
  createCampaign(input: CreateCampaignInput): Promise<CreatedCampaign> {
    this.maybeFail();
    if (this.createInFlight) {
      this.createInFlight = false;
      return Promise.reject(new CreateInFlightError());
    }
    if (this.createRejection) {
      return Promise.reject(new CampaignRejectedError(this.createRejection));
    }

    const replay = this.creates.find(
      (entry) =>
        entry.providerRef === input.credential.providerRef &&
        entry.idempotencyKey === input.idempotencyKey,
    );
    if (replay) return Promise.resolve(replay.created);

    const n = ++this.campaignSeq;
    const campaignId = `1202${String(n).padStart(14, '0')}`;
    const paused = input.draft.launch === 'paused';
    const created: CreatedCampaign = {
      externalCampaignId: campaignId,
      signals: {
        delivery: paused ? 'paused' : 'pending_review',
        review: 'in_review',
        startsAt: input.draft.startsAt,
        endsAt: input.draft.endsAt,
      },
      ads: input.draft.ads.map((ad, index) => ({
        externalAdId: `1203${String(n).padStart(10, '0')}${String(index).padStart(4, '0')}`,
        name: ad.name,
        format: ad.media.kind,
        signals: {
          delivery: paused ? 'paused' : 'pending_review',
          review: 'in_review',
          startsAt: input.draft.startsAt,
          endsAt: input.draft.endsAt,
        },
      })),
    };

    const urlTags = input.draft.linkTags
      .map(({ key, value }) => `${key}=${value}`)
      .join('&');
    for (const ad of created.ads) this.linkTags.set(ad.externalAdId, urlTags);

    // It is on the ad account now, so the next sync reads it back.
    const tree = this.trees.get(input.externalAccountId) ?? {
      currency: input.draft.currency,
      campaigns: [],
      complete: true,
    };
    this.trees.set(input.externalAccountId, {
      ...tree,
      currency: tree.currency ?? input.draft.currency,
      campaigns: [
        ...tree.campaigns,
        {
          externalCampaignId: created.externalCampaignId,
          name: input.draft.name,
          signals: created.signals,
          ads: created.ads.map((ad) => ({
            externalAdId: ad.externalAdId,
            name: ad.name,
            format: ad.format,
            creativeUrl: null,
            signals: ad.signals,
            days: [],
          })),
        },
      ],
    });

    this.creates.push({
      providerRef: input.credential.providerRef,
      providerAccountRef: input.providerAccountRef,
      externalAccountId: input.externalAccountId,
      idempotencyKey: input.idempotencyKey,
      draft: input.draft,
      urlTags,
      created,
    });

    if (this.failAfterCreating) {
      this.failAfterCreating = false;
      return Promise.reject(new Error('connection dropped after create'));
    }
    return Promise.resolve(created);
  }

  /**
   * Answers with a few bytes of "image" per URL, so a test can tell which
   * creative landed where by the stored key rather than by the content.
   */
  fetchCreative(url: string): Promise<CreativeFile> {
    this.maybeFail();
    this.creativeFetches.push(url);
    if (this.failCreatives) {
      return Promise.reject(new Error('creative link expired'));
    }
    return Promise.resolve({
      body: Buffer.from(`image:${url}`),
      contentType: 'image/jpeg',
    });
  }

  /**
   * Records the purchase it was asked to report.
   *
   * Accepting is silence, and refusing throws, exactly as the interface says —
   * which is what lets a test drive the failing side by setting `failAlways` and
   * then assert that the checkout stood and the purchase is still owed.
   */
  sendPurchase(input: SendPurchaseInput): Promise<void> {
    this.maybeFail();
    this.purchases.push({
      providerRef: input.credential.providerRef,
      platform: input.platform,
      providerAccountRef: input.providerAccountRef,
      pixelId: input.pixelId,
      event: input.event,
    });
    return Promise.resolve();
  }

  /** Every purchase reported for one Order, which should never be more than one. */
  purchasesFor(orderId: string): PurchaseRecord[] {
    return this.purchases.filter((entry) => entry.event.eventId === orderId);
  }

  health(): Promise<ProviderHealth> {
    this.maybeFail();
    return Promise.resolve({
      reachable: this.reachable,
      maxBackfillDays: this.maxBackfillDays,
    });
  }

  private approvalFor(
    providerRef: string,
    platform: AdPlatform,
  ): Approval | undefined {
    return this.approvals.get(`${providerRef}:${platform}`);
  }

  private maybeFail(): void {
    const error = this.failNext ?? this.failAlways;
    if (error) {
      this.failNext = null;
      throw error;
    }
  }
}
