import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { AdPlatform } from '../../src/shared/database/schema';
import type {
  AdPlatformProvider,
  AdTree,
  BeginConnectionInput,
  BeginConnectionResult,
  CompleteConnectionInput,
  ConnectedAccount,
  FetchAdTreeInput,
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
}

/**
 * What a sync asked for, which is most of what is worth asserting about one:
 * that a first connection asked for history rather than for today, and that
 * every sync after it asked for a window that overlaps what it already holds.
 */
export interface FetchRecord {
  providerRef: string;
  platform: AdPlatform;
  externalAccountId: string;
  from: string;
  to: string;
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
 * screen, that a disconnect actually reached the provider — and, above all,
 * that nothing ever asked it to write. There is no write method to record.
 *
 * `approve` and `deny` let a test say what the merchant did on the platform's
 * screen, which is the one thing a fake has to supply that a real provider
 * would learn from the merchant.
 */
@Injectable()
export class FakeAdPlatformProvider implements AdPlatformProvider {
  readonly issued: IssuedCredential[] = [];
  readonly begun: BegunConnection[] = [];
  readonly disconnected: ReleaseRecord[] = [];
  readonly revoked: string[] = [];

  /** What the merchant will have approved, keyed `providerRef:platform`. */
  private readonly approvals = new Map<string, ConnectedAccount>();

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

  /** Says the merchant approved this account on the platform's own screen. */
  approve(
    providerRef: string,
    platform: AdPlatform,
    account: Partial<ConnectedAccount> = {},
  ): ConnectedAccount {
    const approved: ConnectedAccount = {
      externalAccountId: account.externalAccountId ?? `act_${randomUUID()}`,
      accountName: account.accountName ?? 'Test Ad Account',
      currency: account.currency ?? 'USD',
    };
    this.approvals.set(`${providerRef}:${platform}`, approved);
    return approved;
  }

  /** Says the merchant denied, or closed the tab without choosing. */
  deny(providerRef: string, platform: AdPlatform): void {
    this.approvals.delete(`${providerRef}:${platform}`);
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
    this.approvals.clear();
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
    // A stand-in for the platform's hosted approval and account-selection
    // screens. The return URL rides on it exactly as it would in the real flow.
    return Promise.resolve({
      approvalUrl: `https://approve.test/${input.platform}?return=${encodeURIComponent(input.returnUrl)}`,
    });
  }

  completeConnection(
    input: CompleteConnectionInput,
  ): Promise<ConnectedAccount | null> {
    this.maybeFail();
    return Promise.resolve(
      this.approvals.get(`${input.credential.providerRef}:${input.platform}`) ??
        null,
    );
  }

  disconnect(credential: StoreCredential, platform: AdPlatform): Promise<void> {
    this.maybeFail();
    this.disconnected.push({ providerRef: credential.providerRef, platform });
    this.approvals.delete(`${credential.providerRef}:${platform}`);
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

  private maybeFail(): void {
    const error = this.failNext ?? this.failAlways;
    if (error) {
      this.failNext = null;
      throw error;
    }
  }
}
