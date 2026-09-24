import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  Loader2Icon,
  RefreshCwIcon,
  UnlinkIcon,
} from "lucide-react";

import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import type { AdPlatformConnection } from "~/types/api";
import { adAccountsQueryOptions } from "../queries";
import {
  connectAdPlatformServerFn,
  disconnectAdPlatformServerFn,
  selectAdAccountServerFn,
  syncAdPlatformServerFn,
} from "../server";

/**
 * Connecting this store to Meta, and saying what that connection is doing.
 *
 * It lives on the campaigns page rather than in Settings because it is not a
 * preference. Before it exists there is nothing on this page at all; after it
 * exists it is the one line that says whose ad account the figures below came
 * from and how fresh they are — and a figure that stopped moving has to be
 * legibly stale rather than silently so.
 */

/** Which connection on this store is Meta's, if any. */
export const metaConnection = (
  connections: AdPlatformConnection[],
): AdPlatformConnection | undefined =>
  connections.find((connection) => connection.platform === "meta");

/**
 * Everything that changes when the connection changes.
 *
 * The campaigns and their figures come from the connected account, so anything
 * showing them is behind the moment it is connected, refreshed or revoked.
 */
function useInvalidateCampaigns() {
  const queryClient = useQueryClient();
  return React.useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["campaigns"] }),
    [queryClient],
  );
}

/**
 * The whole page, before there is anything to show.
 *
 * One button, and no explanation of features the merchant cannot reach yet. The
 * campaigns on this page are the ones on their ad account; until one is
 * connected there are none, and saying so is the entire content.
 */
export function ConnectMetaEmptyState() {
  const [error, setError] = React.useState<string | null>(null);

  const connect = useMutation({
    mutationFn: () => connectAdPlatformServerFn({ data: { platform: "meta" } }),
    // Off to Meta's own approval screen, where the merchant grants access with
    // their own credentials and picks a Facebook Page if Meta asks for one.
    onSuccess: ({ approvalUrl }) => {
      window.location.href = approvalUrl;
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <Card className="flex flex-col items-center gap-4 px-6 py-20 text-center">
      <div className="max-w-md space-y-2">
        <h2 className="text-lg font-semibold">Connect Meta</h2>
        <p className="text-sm text-muted-foreground">
          Your campaigns live on your Meta ad account. Connect it once, on
          Meta&rsquo;s own screen, and they appear here with what each one
          earned.
        </p>
      </div>

      <Button
        className="gap-2"
        disabled={connect.isPending}
        onClick={() => {
          setError(null);
          connect.mutate();
        }}
      >
        {connect.isPending && <Loader2Icon className="h-4 w-4 animate-spin" />}
        Connect Meta
      </Button>

      {error && <Refusal>{error}</Refusal>}
    </Card>
  );
}

/**
 * Which of the merchant&rsquo;s ad accounts this store reports against.
 *
 * Meta cannot answer this: it has never heard of this store. So the approval
 * grants access and this asks the question, and it is asked once — after it is
 * answered the page is the campaigns page and this is gone.
 *
 * Every account the login can see is listed, including the ones that cannot be
 * used. An account left out is a merchant wondering whether they approved with
 * the wrong login and going back through Meta to find out.
 */
export function AdAccountPicker() {
  const invalidate = useInvalidateCampaigns();
  const [error, setError] = React.useState<string | null>(null);

  const { data: accounts = [], isPending } = useQuery(adAccountsQueryOptions());

  const select = useMutation({
    mutationFn: (accountId: string) =>
      selectAdAccountServerFn({ data: { platform: "meta", accountId } }),
    onSuccess: () => void invalidate(),
    // The server refuses a mismatch too, so a reason that never reached the
    // picker still arrives as a sentence rather than as a broken connection.
    onError: (err: Error) => setError(err.message),
  });

  return (
    <Card className="mx-auto max-w-2xl gap-0 px-0 py-0">
      <div className="space-y-1 px-6 py-5">
        <h2 className="text-lg font-semibold">
          Choose the ad account for this store
        </h2>
        <p className="text-sm text-muted-foreground">
          Meta is connected. Pick the account whose spend belongs to this
          store&rsquo;s revenue — every figure on this page is in this
          store&rsquo;s own currency, and nothing is ever converted.
        </p>
      </div>

      {isPending ? (
        <p className="border-t px-6 py-8 text-center text-sm text-muted-foreground">
          Reading your ad accounts…
        </p>
      ) : accounts.length === 0 ? (
        <p className="border-t px-6 py-8 text-center text-sm text-muted-foreground">
          That Meta login cannot see any ad accounts. Connect again with a login
          that can, or create one in Ads Manager first.
        </p>
      ) : (
        accounts.map((account) => (
          <div
            key={account.accountId}
            className="flex items-start justify-between gap-4 border-t px-6 py-4"
          >
            <div className="min-w-0">
              <p
                className={cn(
                  "truncate text-sm font-medium",
                  !account.selectable && "text-muted-foreground",
                )}
              >
                {account.name ?? account.accountId}
              </p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {account.accountId}
                {account.currency ? ` · ${account.currency}` : ""}
              </p>
              {/* Disabled, with the reason, rather than hidden. */}
              {account.reason && (
                <p className="mt-1 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                  <AlertCircleIcon className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>{account.reason}</span>
                </p>
              )}
            </div>

            <Button
              variant={account.selectable ? "default" : "outline"}
              className="shrink-0 gap-2"
              disabled={!account.selectable || select.isPending}
              onClick={() => {
                setError(null);
                select.mutate(account.accountId);
              }}
            >
              {select.isPending && select.variables === account.accountId && (
                <Loader2Icon className="h-4 w-4 animate-spin" />
              )}
              Use this account
            </Button>
          </div>
        ))
      )}

      {error && (
        <div className="border-t px-6 py-4">
          <Refusal>{error}</Refusal>
        </div>
      )}
    </Card>
  );
}

/**
 * The header line: which account these figures came from, and how fresh they
 * are.
 *
 * Small, because it is context rather than content, and a link rather than a
 * card, because the things behind it — Refresh, Disconnect — are rare. What it
 * refuses to be is silent about staleness: "updated 12 minutes ago" and
 * "updated last Tuesday" are the same sentence to a page that prints neither.
 */
export function MetaConnectionSummary({
  connection,
}: {
  connection: AdPlatformConnection;
}) {
  const invalidate = useInvalidateCampaigns();
  const [note, setNote] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const gone = connection.status === "disconnected";
  // Said on the header line, not only behind it: a merchant who never opens
  // the panel still has to be able to tell stale figures from live ones.
  const failing = !gone && connection.lastSyncError !== null;

  const sync = useMutation({
    mutationFn: () => syncAdPlatformServerFn({ data: { platform: "meta" } }),
    // A refusal arrives in the response rather than as an error, so a vendor
    // outage costs this page freshness and not the page.
    onSuccess: (outcomes) => {
      // A partial sync carries a sentence too: history still arriving is not
      // "up to date", and saying so would make the missing days look final.
      const notice = outcomes.find((outcome) => outcome.status !== "synced");
      setNote(notice?.message ?? "Up to date.");
      void invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });

  const disconnect = useMutation({
    mutationFn: () =>
      disconnectAdPlatformServerFn({ data: { platform: "meta" } }),
    onSuccess: () => void invalidate(),
    onError: (err: Error) => setError(err.message),
  });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-muted/60",
            failing
              ? "text-amber-700 dark:text-amber-400"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {gone ? (
            <UnlinkIcon className="h-3 w-3" />
          ) : failing ? (
            <AlertCircleIcon className="h-3 w-3" />
          ) : (
            <CheckCircle2Icon className="h-3 w-3" />
          )}
          <span className="truncate">
            Meta · {connection.accountName ?? connection.accountId}
            {" · "}
            {gone ? "disconnected" : freshness(connection)}
            {failing && " · last refresh failed"}
          </span>
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 space-y-3">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">
            {connection.accountName ?? connection.accountId}
          </p>
          <p className="text-xs text-muted-foreground">
            {connection.accountId}
            {connection.accountCurrency
              ? ` · ${connection.accountCurrency}`
              : ""}
          </p>
        </div>

        <p className="text-xs text-muted-foreground">
          {gone ? (
            // Said out loud, because it is the thing a merchant is afraid of
            // when they press Disconnect.
            <>
              Disconnected {formatDate(connection.disconnectedAt)}. Everything
              already pulled was kept — revoking access never rewrites a past
              report.
            </>
          ) : (
            <>
              Connected {formatDate(connection.connectedAt)}.{" "}
              {freshness(connection)}.
            </>
          )}
        </p>

        {!gone && connection.lastSyncError && (
          // The figures above are from whenever the last sync succeeded. Shown
          // rather than thrown, and worded so the merchant does not go looking
          // for a fault in their own ad account.
          <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
            <AlertCircleIcon className="mt-0.5 h-3 w-3 shrink-0" />
            <span>{connection.lastSyncError}</span>
          </p>
        )}

        {note && <p className="text-xs text-muted-foreground">{note}</p>}
        {error && <Refusal>{error}</Refusal>}

        {!gone && (
          <div className="flex items-center gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              disabled={sync.isPending || disconnect.isPending}
              onClick={() => {
                setError(null);
                setNote(null);
                sync.mutate();
              }}
            >
              {sync.isPending ? (
                <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCwIcon className="h-3.5 w-3.5" />
              )}
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              disabled={sync.isPending || disconnect.isPending}
              onClick={() => {
                setError(null);
                disconnect.mutate();
              }}
            >
              <UnlinkIcon className="h-3.5 w-3.5" />
              Disconnect
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * What the merchant is told when they come back from Meta.
 *
 * Every way the trip can end says something. A merchant who denied, or closed
 * the tab, has to land on a sentence rather than on a page that looks like
 * nothing happened.
 */
export function ConnectionResultNote({
  result,
}: {
  result: "connected" | "choose_account" | "not_approved" | "failed";
}) {
  // The picker is already on screen and says what to do, so the successful
  // half-way outcome needs no banner of its own.
  if (result === "choose_account") return null;

  const ok = result === "connected";
  const text =
    result === "connected"
      ? "Meta is connected to this store."
      : result === "not_approved"
        ? "Meta was not connected — the approval was not completed. You can start again whenever you like."
        : "Meta could not be connected just now. Nothing has changed; this is usually the platform rather than your account.";

  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md border px-4 py-3 text-sm",
        ok
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
      )}
    >
      {ok ? (
        <CheckCircle2Icon className="mt-0.5 h-4 w-4 shrink-0" />
      ) : (
        <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />
      )}
      <span>{text}</span>
    </div>
  );
}

function Refusal({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
      <AlertCircleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

const formatDate = (value: string | null) =>
  value
    ? new Date(value).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "—";

/**
 * How fresh these figures are, in one phrase.
 *
 * A connection that has never synced says so rather than saying nothing: an
 * empty report and an unsynced one look identical on the page otherwise, and
 * the merchant would be left to guess which they were reading.
 */
function freshness(connection: AdPlatformConnection): string {
  if (!connection.lastSyncedAt) return "no figures yet";

  const minutes = Math.floor(
    (Date.now() - new Date(connection.lastSyncedAt).getTime()) / 60_000,
  );
  if (minutes < 1) return "updated just now";
  if (minutes < 60) return `updated ${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `updated ${hours} h ago`;
  return `updated ${Math.floor(hours / 24)} d ago`;
}
