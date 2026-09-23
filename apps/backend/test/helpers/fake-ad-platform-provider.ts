import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { AdPlatform } from '../../src/shared/database/schema';
import type {
  AdAccountOption,
  AdPlatformProvider,
  AdTree,
  BeginConnectionInput,
  BeginConnectionResult,
  CompleteConnectionInput,
  ConnectionGrant,
  EnsurePixelInput,
  FetchAdTreeInput,
  GrantedAccount,
  IssueCredentialInput,
  ProviderHealth,
  StoreCredential,
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

  /** What the platform will say is running, keyed `providerRef:platform`. */
  private readonly trees = new Map<string, AdTree>();

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

  /** Says what the platform will report for this account. */
  setAdTree(providerRef: string, platform: AdPlatform, tree: AdTree): void {
    this.trees.set(`${providerRef}:${platform}`, tree);
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
    this.pixels.length = 0;
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
      this.trees.get(`${input.credential.providerRef}:${input.platform}`) ?? {
        currency: 'USD',
        ads: [],
      },
    );
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
