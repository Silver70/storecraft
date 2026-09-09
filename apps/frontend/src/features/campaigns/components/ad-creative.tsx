import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { ImageIcon, LoaderCircleIcon, XIcon } from "lucide-react";

import type { Ad } from "~/types/api";
import { removeAdCreativeServerFn, uploadAdCreativeServerFn } from "../server";

/** What the admin API accepts, said once so the picker and the guard agree. */
const ACCEPTED = "image/jpeg,image/png,image/webp,image/gif";
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * The picture a merchant recognises an ad by, since nobody recognises a slug.
 *
 * The empty tile is the point of this component. Most ads have no creative, and
 * ads under a campaign on email, SMS, affiliate, influencer or other never will
 * — nothing is ever going to supply an image for them. So the empty state is
 * drawn as an invitation rather than as a hole where a picture failed to load,
 * and a grid of them has to look deliberate, because for months that is the
 * grid every merchant will see.
 *
 * Clicking the tile uploads or replaces; the corner button clears. Neither
 * touches anything else about the ad — a creative is not a flight date, and
 * removing one is not archiving.
 */
export function AdCreative({
  campaignId,
  ad,
  onChanged,
  onError,
}: {
  campaignId: string;
  ad: Ad;
  onChanged: () => void;
  onError: (message: string | null) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  // A creative that 404s from storage would otherwise render as the broken
  // image this whole component exists to avoid, so a failed load falls back to
  // the same designed empty tile.
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [ad.creativeUrl]);

  const uploadMutation = useMutation({
    mutationFn: async (file: File) =>
      uploadAdCreativeServerFn({
        data: {
          campaignId,
          adId: ad.id,
          fileBase64: await toBase64(file),
          mimeType: file.type,
          fileName: file.name,
        },
      }),
    onSuccess: () => {
      onError(null);
      onChanged();
    },
    onError: (err) => onError(err.message),
  });

  const removeMutation = useMutation({
    mutationFn: () =>
      removeAdCreativeServerFn({ data: { campaignId, adId: ad.id } }),
    onSuccess: () => {
      onError(null);
      onChanged();
    },
    onError: (err) => onError(err.message),
  });

  const busy = uploadMutation.isPending || removeMutation.isPending;

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Clearing the input is what lets the same file be picked twice in a row
    // after a failure.
    e.target.value = "";
    if (!file) return;

    // The server enforces both of these; refusing here saves the merchant a
    // round trip to be told something they can see for themselves.
    if (!ACCEPTED.split(",").includes(file.type)) {
      onError("That file is not a JPEG, PNG, WebP or GIF image.");
      return;
    }
    if (file.size > MAX_BYTES) {
      onError("That image is larger than 10 MB.");
      return;
    }
    uploadMutation.mutate(file);
  }

  const hasCreative = Boolean(ad.creativeUrl) && !failed;

  return (
    <div className="relative shrink-0">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        className="sr-only"
        onChange={handleFileChange}
      />

      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        title={hasCreative ? "Replace creative" : "Add a creative"}
        aria-label={
          hasCreative
            ? `Replace creative for ${ad.name}`
            : `Add a creative for ${ad.name}`
        }
        className={`group flex h-11 w-11 items-center justify-center overflow-hidden rounded-md transition-colors ${
          hasCreative
            ? "border border-border/60"
            : "border-2 border-dashed border-border bg-muted/30 text-muted-foreground hover:border-amber-400 hover:bg-amber-50/40 hover:text-amber-600 dark:hover:bg-amber-950/10"
        } ${ad.status === "archived" ? "opacity-60" : ""}`}
      >
        {busy ? (
          <LoaderCircleIcon className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : hasCreative ? (
          <img
            src={ad.creativeUrl!}
            alt={`Creative for ${ad.name}`}
            loading="lazy"
            onError={() => setFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <ImageIcon className="h-4 w-4" />
        )}
      </button>

      {hasCreative && !busy && (
        <button
          type="button"
          onClick={() => removeMutation.mutate()}
          aria-label={`Remove creative for ${ad.name}`}
          title="Remove creative"
          className="absolute -right-1.5 -top-1.5 flex h-4.5 w-4.5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm transition-colors hover:text-foreground"
        >
          <XIcon className="h-2.5 w-2.5" />
        </button>
      )}
    </div>
  );
}

/**
 * Browser file to base64, because a server function takes JSON and not a
 * `File`. The same conversion the product media upload does.
 */
async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
