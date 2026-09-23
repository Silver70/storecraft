import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  LinkIcon,
  Loader2Icon,
  RefreshCwIcon,
  UnlinkIcon,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { AD_PLATFORMS, type AdPlatform } from "~/types/api";
import type { AdPlatformConnection } from "~/types/api";
import { adPlatformConnectionsQueryOptions } from "../queries";
import {
  connectAdPlatformServerFn,
  disconnectAdPlatformServerFn,
  syncAdPlatformServerFn,
} from "../server";

const route = getRouteApi("/admin/settings");

const PLATFORM_LABELS: Record<AdPlatform, string> = {
  meta: "Meta",
  google: "Google Ads",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  pinterest: "Pinterest",
  x: "X",
};

/**
 * What the merchant is told when they come back from the platform.
 *
 * Every way the trip can end says something, including the two that are not
 * successes — a merchant who denied or closed the tab has to land on a sentence
 * rather than on a page that looks like nothing happened.
 */
const RESULT_MESSAGES = {
  connected: {
    tone: "ok" as const,
    text: (platform: string) => `${platform} is connected to this store.`,
  },
  not_approved: {
    tone: "warn" as const,
    text: (platform: string) =>
      `${platform} was not connected — the approval was not completed. You can start again whenever you like.`,
  },
  failed: {
    tone: "warn" as const,
    text: (platform: string) =>
      `${platform} could not be connected just now. Nothing has changed; this is usually the platform rather than your account.`,
  },
};

const formatDate = (value: string) =>
  new Date(value).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

/**
 * When a figure was last confirmed, to the minute.
 *
 * To the minute and not to the day, because the question this answers is "is
 * what I am looking at current", and "synced Sep 19" does not answer it at four
 * in the afternoon.
 */
const formatDateTime = (value: string) =>
  new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/**
 * How fresh this platform's figures are, in one line.
 *
 * A connection that has never synced says so rather than saying nothing: an
 * empty report and an unsynced one look identical on the page otherwise, and
 * the merchant would be left to guess which they were reading.
 */
const freshness = (connection: AdPlatformConnection): string =>
  connection.lastSyncedAt
    ? `Figures synced ${formatDateTime(connection.lastSyncedAt)}`
    : "No figures pulled yet";

/**
 * Which ad platforms this Store is connected to.
 *
 * Per Store and not per Organization, deliberately and visibly: the panel reads
 * the active store, and a US store and a UK store hold separate connections to
 * separate ad accounts. There is no credential anywhere on this page — the
 * secret is held server-side and is not returned by any read, so there is
 * nothing here to reveal, copy, or leak into a screenshot.
 */
export function AdPlatformsSettings() {
  const queryClient = useQueryClient();
  const search = route.useSearch();
  const { data: connections = [] } = useQuery(
    adPlatformConnectionsQueryOptions(),
  );
  const [error, setError] = React.useState<string | null>(null);
  const [syncNote, setSyncNote] = React.useState<string | null>(null);

  const byPlatform = new Map<AdPlatform, AdPlatformConnection>(
    connections.map((c) => [c.platform, c]),
  );

  const connectMutation = useMutation({
    mutationFn: (platform: AdPlatform) =>
      connectAdPlatformServerFn({ data: { platform } }),
    onSuccess: ({ approvalUrl }) => {
      // Off to the platform's own approval and account-selection screens. We
      // build no picker of our own: the merchant approves with their own
      // credentials and sees what the platform says they are granting.
      window.location.href = approvalUrl;
    },
    onError: (err: Error) => setError(err.message),
  });

  /**
   * A sync the merchant asked for.
   *
   * The response says what happened, failure included — a platform that refused
   * the call comes back as a sentence rather than as a thrown error, because a
   * vendor outage must cost this page freshness and not the page. Only a
   * failure to reach our own API lands in `onError`.
   */
  const syncMutation = useMutation({
    mutationFn: (platform: AdPlatform) =>
      syncAdPlatformServerFn({ data: { platform } }),
    onSuccess: (outcomes) => {
      const failure = outcomes.find((outcome) => outcome.status === "failed");
      setSyncNote(
        failure?.message ??
          (outcomes.length === 0
            ? "Nothing to sync — this platform is not connected."
            : "Up to date."),
      );
      void queryClient.invalidateQueries({
        queryKey: ["settings", "ad-platforms"],
      });
      // The campaigns and their figures come from the platform, so anything
      // showing them may now be behind.
      void queryClient.invalidateQueries({ queryKey: ["campaigns"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const disconnectMutation = useMutation({
    mutationFn: (platform: AdPlatform) =>
      disconnectAdPlatformServerFn({ data: { platform } }),
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: ["settings", "ad-platforms"],
      }),
    onError: (err: Error) => setError(err.message),
  });

  const pending =
    connectMutation.isPending ||
    disconnectMutation.isPending ||
    syncMutation.isPending;
  const result = search.ad_platform_result
    ? RESULT_MESSAGES[search.ad_platform_result]
    : null;
  const resultPlatform = search.ad_platform
    ? PLATFORM_LABELS[search.ad_platform]
    : "The platform";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Ad Platforms</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect this store to the platforms you advertise on, so the figures
          they already hold stop being typed in by hand. Access is read-only:
          nothing here can create, change or spend money on an ad.
        </p>
      </div>

      {result && (
        <div
          className={cn(
            "flex items-start gap-2 rounded-md border px-4 py-3 text-sm",
            result.tone === "ok"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
          )}
        >
          {result.tone === "ok" ? (
            <CheckCircle2Icon className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <span>{result.text(resultPlatform)}</span>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {syncNote && (
        <div className="flex items-start gap-2 rounded-md border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{syncNote}</span>
        </div>
      )}

      <Card className="overflow-hidden gap-0 py-0">
        {AD_PLATFORMS.map((platform, index) => {
          const connection = byPlatform.get(platform);
          const isConnected = connection?.status === "connected";

          return (
            <div
              key={platform}
              className={cn(
                "flex items-center justify-between gap-4 px-5 py-4",
                index > 0 && "border-t",
              )}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">
                    {PLATFORM_LABELS[platform]}
                  </span>
                  {isConnected && (
                    <Badge variant="secondary" className="gap-1">
                      <CheckCircle2Icon className="h-3 w-3" />
                      Connected
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {isConnected ? (
                    <>
                      {connection.accountName ?? connection.accountId}
                      {connection.accountCurrency
                        ? ` · ${connection.accountCurrency}`
                        : ""}
                      {" · connected "}
                      {formatDate(connection.connectedAt)}
                      {" · "}
                      {freshness(connection)}
                    </>
                  ) : connection?.disconnectedAt ? (
                    // Said out loud, because it is the thing a merchant is
                    // afraid of when they press Disconnect.
                    `Disconnected ${formatDate(connection.disconnectedAt)} — figures already pulled were kept`
                  ) : (
                    "Not connected"
                  )}
                </p>
                {isConnected && connection.lastSyncError && (
                  // The last sync failed, and the figures above it are from
                  // whenever the last one succeeded. Shown rather than thrown,
                  // and worded so the merchant does not go looking for a fault
                  // in their own ad account.
                  <p className="mt-1 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                    <AlertCircleIcon className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>{connection.lastSyncError}</span>
                  </p>
                )}
              </div>

              {isConnected ? (
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    variant="outline"
                    className="gap-2"
                    disabled={pending}
                    onClick={() => {
                      setError(null);
                      setSyncNote(null);
                      syncMutation.mutate(platform);
                    }}
                  >
                    {syncMutation.isPending &&
                    syncMutation.variables === platform ? (
                      <Loader2Icon className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCwIcon className="h-4 w-4" />
                    )}
                    Sync now
                  </Button>
                  <Button
                    variant="outline"
                    className="gap-2"
                    disabled={pending}
                    onClick={() => {
                      setError(null);
                      disconnectMutation.mutate(platform);
                    }}
                  >
                    <UnlinkIcon className="h-4 w-4" />
                    Disconnect
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  className="gap-2"
                  disabled={pending}
                  onClick={() => {
                    setError(null);
                    connectMutation.mutate(platform);
                  }}
                >
                  {connectMutation.isPending &&
                  connectMutation.variables === platform ? (
                    <Loader2Icon className="h-4 w-4 animate-spin" />
                  ) : (
                    <LinkIcon className="h-4 w-4" />
                  )}
                  {connection ? "Reconnect" : "Connect"}
                </Button>
              )}
            </div>
          );
        })}
      </Card>

      <p className="text-xs text-muted-foreground">
        Figures are pulled on a schedule, and Sync now pulls them immediately. A
        first connection brings the history the platform holds, so the report is
        worth reading the day you connect. Disconnecting revokes access and
        destroys the stored credential. Anything already pulled stays exactly as
        it is — revoking access never rewrites a past report.
      </p>
    </div>
  );
}
