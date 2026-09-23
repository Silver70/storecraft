import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  AD_PLATFORM_PROVIDER,
  type AdPlatformProvider,
  type PurchaseEvent,
  type StoreCredential,
} from '../interfaces/ad-platform-provider.interface';
import { AdPlatformCredentialRepository } from '../repositories/ad-platform-credential.repository';
import {
  PurchaseEventDispatchRepository,
  type PurchaseDispatchTarget,
} from '../repositories/purchase-event-dispatch.repository';
import { CredentialVault } from './credential-vault.service';
import {
  asEmailMatchKey,
  asPhoneMatchKey,
  mayReportPurchase,
} from '../utils/purchase-dispatch.util';

/** What one pass of the dispatcher did, for the log and for a test. */
export interface PurchaseDispatchSummary {
  sent: number;
  /** Not sent, and never will be: the visitor did not agree to be measured. */
  withheld: number;
  failed: number;
  /** Claimed by somebody else, or already settled between query and claim. */
  skipped: number;
  /** Dispatches closed off because the platform can no longer attribute them. */
  expired: number;
}

/**
 * Reports paid Orders to the ad platform, so that it learns who buys instead of
 * who clicks.
 *
 * ## What it sends, and for which Orders
 *
 * Every paid Order, not only the ones we credited to a Campaign. The platform
 * runs its own attribution over its own window; handing it only the sales we
 * already know came from an ad would teach it that its other ads produce nothing,
 * which is the opposite of the lesson. So the Campaign side of this feature and
 * this side never consult each other.
 *
 * Each Purchase carries the Order's total and currency, its id as the platform's
 * event id, the customer's contact details as match keys, and the browser
 * identifiers frozen onto the Order at checkout. The Order's id as the event id is
 * the load-bearing part: the storefront's Pixel reports the same purchase from the
 * browser under the same id, so the platform counts one purchase and this copy is
 * the one that survives an ad blocker.
 *
 * ## Why nothing here can fail a checkout
 *
 * Reporting is evidence, exactly as attribution is (ADR-0001), and it is held to
 * the same rule: it may cost a report, never a sale. Three things enforce that
 * rather than one comment hoping for it —
 *
 * 1. Every public method resolves. A vendor outage, a database error, a payload
 *    the platform refuses: all of them end as a recorded failure and a log line.
 * 2. The send happens *after* the Order is paid and outside its transaction,
 *    driven by an event and by a schedule. Nothing a shopper waits on is on this
 *    path, and nothing here can roll a payment back or leave a cart open.
 * 3. The dispatch row is the record, not this process. If the listener never runs
 *    — a restart between the payment and the send — the scheduled pass finds the
 *    Order itself and reports it.
 *
 * ## Consent
 *
 * On a Store that asks, a purchase is reported only when the visitor agreed, and
 * the answer consulted is the one frozen onto the Order. A send that happens an
 * hour after the sale has no cookie and no browser to ask, and a hashed email and
 * an IP address are personal data exactly as a page view is.
 *
 * ## Refunds
 *
 * Not retracted. See `NO_RETRACTION` in `purchase-dispatch.util.ts`, which is the
 * file somebody would open to add it.
 */
@Injectable()
export class PurchaseEventService {
  private readonly logger = new Logger(PurchaseEventService.name);

  constructor(
    @Inject(AD_PLATFORM_PROVIDER)
    private readonly provider: AdPlatformProvider,
    private readonly dispatches: PurchaseEventDispatchRepository,
    private readonly credentials: AdPlatformCredentialRepository,
    private readonly vault: CredentialVault,
  ) {}

  /**
   * Hourly, and a one-line delegation on purpose: the schedule belongs to the
   * framework and the work belongs to a method a test can call.
   *
   * Hourly rather than by the minute because the browser's copy of a purchase has
   * already arrived and the platform's attribution window is measured in days —
   * and rather than nightly because an Order that fails every attempt has only
   * seven days of attempts left.
   */
  @Cron('15 * * * *')
  async scheduledDispatch(): Promise<void> {
    await this.dispatchDue();
  }

  /**
   * Reports every purchase that is owed, and never throws.
   *
   * A plain public method so a dispatch can be run without involving the
   * scheduler — from a script, from a test, or after a vendor comes back. One
   * Order's failure does not stop the next: they belong to different
   * Organizations, and a refusal on one merchant's ad account is not a reason to
   * leave another merchant's purchases unreported.
   */
  async dispatchDue(now: Date = new Date()): Promise<PurchaseDispatchSummary> {
    const summary: PurchaseDispatchSummary = {
      sent: 0,
      withheld: 0,
      failed: 0,
      skipped: 0,
      expired: 0,
    };

    try {
      summary.expired = await this.dispatches.expireStale(now);
    } catch (error) {
      // A sweep that could not run is not a reason to report nothing.
      this.logger.error(
        `Expiring stale purchase dispatches failed: ${detailOf(error)}`,
      );
    }

    let due: PurchaseDispatchTarget[];
    try {
      due = await this.dispatches.findDue(now);
    } catch (error) {
      this.logger.error(
        `Reading owed purchase dispatches failed: ${detailOf(error)}`,
      );
      return summary;
    }

    for (const target of due) {
      const outcome = await this.dispatch(target, now);
      summary[outcome] += 1;
    }

    if (summary.sent || summary.failed || summary.withheld) {
      this.logger.log(
        `Purchase events: ${summary.sent} sent, ${summary.failed} failed, ` +
          `${summary.withheld} withheld`,
      );
    }
    return summary;
  }

  /**
   * Reports one Order's purchase, as soon as it is paid.
   *
   * The reason this exists beside the scheduled pass is freshness: a platform
   * optimising a live campaign is more use with a purchase it heard about in
   * seconds than one it hears about within the hour. It is not the record — the
   * queue is — so a failure here is genuinely nothing more than a slower report.
   *
   * Takes the Organization and the Store because it is reached from a request's
   * event, and an Order id alone is never enough to name a row in this codebase.
   */
  async dispatchForOrder(
    orgId: string,
    storeId: string,
    orderId: string,
    now: Date = new Date(),
  ): Promise<void> {
    try {
      const target = await this.dispatches.findTargetForOrder(
        orgId,
        storeId,
        orderId,
      );
      // No connection, no Pixel, or an Order that is not paid after all. Nothing
      // is sent and — deliberately — nothing is queued: a Store that never
      // connected an ad platform accumulates no ledger of purchases it owes
      // nobody.
      if (!target) return;

      await this.dispatch(target, now);
    } catch (error) {
      // The last line of the guarantee. Whatever went wrong, the payment stands
      // and the queue still holds the purchase.
      this.logger.error(
        `Dispatching the purchase for order ${orderId} failed: ${detailOf(error)}`,
      );
    }
  }

  // ─── Internals ──────────────────────────────────────────────────────────────

  /**
   * One Order: decide, claim, send, record.
   *
   * The order of those four matters. Deciding first means a withheld purchase
   * never becomes a claim and never reaches the provider. Claiming before sending
   * means two writers cannot both report the same purchase. Recording last means a
   * send whose result we never saw stays owed rather than being marked done.
   */
  private async dispatch(
    target: PurchaseDispatchTarget,
    now: Date,
  ): Promise<'sent' | 'withheld' | 'failed' | 'skipped'> {
    const { order } = target;

    if (
      !mayReportPurchase({
        consentRequired: target.consentRequired,
        consent: order.measurementConsent,
      })
    ) {
      await this.dispatches.recordWithheld(target, now);
      return 'withheld';
    }

    const claimed = await this.dispatches.claim(target, now);
    // Already reported, already withheld, or claimed moments ago by the other
    // writer. All three mean the same thing here: not ours to send.
    if (!claimed) return 'skipped';

    try {
      const credential = await this.credentialFor(target);
      const pixelId = target.connection.pixelId;
      const providerAccountRef = target.connection.providerAccountRef;
      if (!pixelId || !providerAccountRef) {
        // The query filters for both; reaching here means the row changed under
        // us, and asking the platform to report against a Pixel nobody chose is
        // not a thing to guess at.
        throw new Error(
          `connection ${target.connection.id} has no pixel or grant to report against`,
        );
      }

      await this.provider.sendPurchase({
        credential,
        platform: target.connection.platform,
        providerAccountRef,
        pixelId,
        event: purchaseEventFor(target),
      });

      await this.dispatches.markSent(claimed.id, now);
      return 'sent';
    } catch (error) {
      // Logged in full here, where an engineer reads it, and recorded as a
      // sentence there, where the next attempt reads it. Neither carries the
      // customer's details: the provider's own errors never quote a request body.
      this.logger.warn(
        `Reporting the purchase for order ${order.id} failed ` +
          `(attempt ${claimed.attemptCount}): ${detailOf(error)}`,
      );
      await this.dispatches.recordFailure(claimed.id, messageOf(error), now);
      return 'failed';
    }
  }

  private async credentialFor(
    target: PurchaseDispatchTarget,
  ): Promise<StoreCredential> {
    const row = await this.credentials.findByStore(
      target.order.organizationId,
      target.order.storeId,
    );
    if (!row?.sealedSecret) {
      // The connection outlived its credential, which a disconnect mid-dispatch
      // does. There is nothing to ask the platform with.
      throw new Error(
        `no credential is held for store ${target.order.storeId}`,
      );
    }
    return {
      providerRef: row.providerRef,
      providerKeyRef: row.providerKeyRef,
      secret: this.vault.open(row.sealedSecret),
    };
  }
}

/** The shape of the address snapshot an Order froze at checkout. */
interface AddressSnapshot {
  phone?: string | null;
}

/**
 * The Order as the platform is told about it.
 *
 * Money stays in minor units all the way to the adapter, which is the only place
 * that knows the platform wants decimals. The match keys are normalized here
 * rather than there because normalization is a rule about a customer's data and
 * the adapter's job is a wire format — and because `Ada@Example.com` and
 * `ada@example.com` are two different people once something has hashed them.
 */
function purchaseEventFor(target: PurchaseDispatchTarget): PurchaseEvent {
  const { order } = target;
  const shipping = order.shippingAddress as AddressSnapshot | null;
  const billing = order.billingAddress as AddressSnapshot | null;

  return {
    // The Order's id, not the dispatch's: the browser reports the same purchase
    // under this value, and it is the only reason one sale is not two.
    eventId: order.id,
    occurredAt: order.createdAt,
    value: order.total,
    currency: order.currency,
    email: asEmailMatchKey(order.customerEmail),
    // Whichever address carries one. A shopper fills in shipping; a merchant
    // keying in a phone order frequently fills in neither the same way.
    phone: asPhoneMatchKey(shipping?.phone ?? billing?.phone),
    browserId: order.metaBrowserId,
    clickId: order.metaClickId,
    sourceUrl: target.storefrontUrl,
    origin: order.source === 'storefront' ? 'storefront' : 'internal',
  };
}

/**
 * A failure as the next attempt reads it.
 *
 * The provider's own exceptions are already written to be read — they say that a
 * rate limit is a limit on the integration rather than on a merchant's account —
 * so those are kept. Anything else becomes its message and nothing more: a stack
 * trace belongs in the log, not in a column.
 */
function messageOf(error: unknown): string {
  if (error instanceof HttpException) return error.message;
  return error instanceof Error ? error.message : String(error);
}

function detailOf(error: unknown): string {
  return error instanceof Error
    ? (error.stack ?? error.message)
    : String(error);
}
