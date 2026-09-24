import * as React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertCircleIcon,
  Loader2Icon,
  PackageIcon,
  UploadIcon,
  VideoIcon,
  XIcon,
} from "lucide-react";

import { EntityCombobox, type ComboboxOption } from "~/components/entity-combobox";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import { productQueryOptions, productsQueryOptions } from "~/features/products/queries";
import { cn } from "~/lib/utils";
import type {
  AdDestinationKind,
  CallToAction,
  CampaignAdInput,
  DraftComplaint,
  DraftField,
} from "~/types/api";
import { uploadCampaignCreativeServerFn } from "../server";

/**
 * One ad as the form holds it. The picture is remembered with what it looks
 * like, so the card can show it; only the reference is sent.
 */
export type AdDraftState = {
  key: string;
  media:
    | { source: "product"; productId: string; mediaId: string; url: string }
    | { source: "upload"; url: string; kind: "image" | "video"; fileName: string }
    | null;
  primaryText: string;
  headline: string;
  callToAction: CallToAction;
  destination: AdDestinationKind;
  destinationProductId: string;
  destinationPath: string;
};

export function emptyAd(): AdDraftState {
  return {
    key: crypto.randomUUID(),
    media: null,
    primaryText: "",
    headline: "",
    callToAction: "shop_now",
    destination: "product",
    destinationProductId: "",
    destinationPath: "",
  };
}

/** The ad as the server takes it: references, never URLs. */
export function toAdInput(ad: AdDraftState): CampaignAdInput {
  return {
    mediaSource: ad.media?.source ?? "product",
    ...(ad.media?.source === "product" ? { productMediaId: ad.media.mediaId } : {}),
    ...(ad.media?.source === "upload" ? { uploadUrl: ad.media.url } : {}),
    primaryText: ad.primaryText,
    headline: ad.headline,
    callToAction: ad.callToAction,
    destination: ad.destination,
    ...(ad.destination === "product"
      ? { destinationProductId: ad.destinationProductId }
      : {}),
    ...(ad.destination === "custom" ? { destinationPath: ad.destinationPath } : {}),
  };
}

/** What can be seen to be missing from one ad without asking anyone. */
export function adGaps(ad: AdDraftState, index: number): DraftComplaint[] {
  const out: DraftComplaint[] = [];
  const add = (field: DraftField, message: string) =>
    out.push({ adIndex: index, field, message });
  if (!ad.media) add("media", "Choose an image or a video.");
  if (!ad.primaryText.trim()) add("primaryText", "Write the text above the picture.");
  if (!ad.headline.trim()) add("headline", "Write a headline.");
  if (ad.destination === "product" && !ad.destinationProductId) {
    add("destination", "Choose the product the ad leads to.");
  }
  if (ad.destination === "custom" && !ad.destinationPath.trim()) {
    add("destination", "Type the page on your storefront the ad leads to.");
  }
  return out;
}

export const CALL_TO_ACTION_LABELS: Record<CallToAction, string> = {
  shop_now: "Shop now",
  buy_now: "Buy now",
  order_now: "Order now",
  get_offer: "Get offer",
  learn_more: "Learn more",
  sign_up: "Sign up",
  subscribe: "Subscribe",
};

const DESTINATION_LABELS: Record<AdDestinationKind, string> = {
  product: "A product",
  all_products: "All products",
  home: "The home page",
  custom: "A page on the storefront",
};

/** Largest file the upload accepts, matching the server's limits. */
const MAX_IMAGE_MB = 30;
const MAX_VIDEO_MB = 100;

export function AdEditor({
  index,
  ad,
  complaints,
  storefrontUrl,
  onChange,
  onRemove,
  title,
}: {
  index: number;
  ad: AdDraftState;
  complaints: DraftComplaint[];
  storefrontUrl: string | null;
  onChange: (next: AdDraftState) => void;
  onRemove: (() => void) | null;
  /** The card's heading; "Ad N" by default. */
  title?: string;
}) {
  const set = <K extends keyof AdDraftState>(key: K, value: AdDraftState[K]) =>
    onChange({ ...ad, [key]: value });
  const about = (field: DraftField) => complaints.filter((c) => c.field === field);
  const general = complaints.filter((c) => c.field === null);

  return (
    <Card className="gap-0 p-0">
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <p className="text-sm font-medium">{title ?? `Ad ${index + 1}`}</p>
        {onRemove && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs text-muted-foreground"
            onClick={onRemove}
          >
            <XIcon className="h-3.5 w-3.5" />
            Remove
          </Button>
        )}
      </div>

      <div className="space-y-5 p-4">
        <Complaints items={general} />

        <MediaField
          media={ad.media}
          onChange={(media) => {
            // A picture of a product usually means an ad for that product.
            const next = { ...ad, media };
            if (
              media?.source === "product" &&
              ad.destination === "product" &&
              !ad.destinationProductId
            ) {
              next.destinationProductId = media.productId;
            }
            onChange(next);
          }}
          complaints={about("media")}
        />

        <div className="space-y-1.5">
          <Label htmlFor={`${ad.key}-text`}>Primary text</Label>
          <Textarea
            id={`${ad.key}-text`}
            value={ad.primaryText}
            onChange={(e) => set("primaryText", e.target.value)}
            placeholder="What the ad says, above the picture"
            rows={3}
            maxLength={2000}
          />
          <Complaints items={about("primaryText")} />
        </div>

        <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="space-y-1.5">
            <Label htmlFor={`${ad.key}-headline`}>Headline</Label>
            <Input
              id={`${ad.key}-headline`}
              value={ad.headline}
              onChange={(e) => set("headline", e.target.value)}
              placeholder="Short, beside the button"
              maxLength={255}
            />
            <Complaints items={about("headline")} />
          </div>
          <div className="space-y-1.5">
            <Label>Button</Label>
            <Select
              value={ad.callToAction}
              onValueChange={(v) => set("callToAction", v as CallToAction)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(CALL_TO_ACTION_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Complaints items={about("callToAction")} />
          </div>
        </div>

        <DestinationField
          ad={ad}
          storefrontUrl={storefrontUrl}
          onChange={onChange}
          complaints={about("destination")}
        />
      </div>
    </Card>
  );
}

// ─── Media ────────────────────────────────────────────────────────────────────

function MediaField({
  media,
  onChange,
  complaints,
}: {
  media: AdDraftState["media"];
  onChange: (media: AdDraftState["media"]) => void;
  complaints: DraftComplaint[];
}) {
  const [mode, setMode] = React.useState<"product" | "upload">(
    media?.source ?? "product",
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Image or video</Label>
        <div className="flex rounded-md border p-0.5 text-xs">
          {(["product", "upload"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                "rounded px-2.5 py-1 transition-colors",
                mode === m
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m === "product" ? "From a product" : "Upload"}
            </button>
          ))}
        </div>
      </div>

      {media && <MediaPreview media={media} onClear={() => onChange(null)} />}

      {!media &&
        (mode === "product" ? (
          <ProductImagePicker onPick={onChange} />
        ) : (
          <UploadPicker onUploaded={onChange} />
        ))}

      <Complaints items={complaints} />
    </div>
  );
}

function MediaPreview({
  media,
  onClear,
}: {
  media: NonNullable<AdDraftState["media"]>;
  onClear: () => void;
}) {
  const isVideo = media.source === "upload" && media.kind === "video";
  return (
    <div className="flex items-center gap-3 rounded-lg border p-2">
      <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
        {isVideo ? (
          <VideoIcon className="h-6 w-6 text-muted-foreground" />
        ) : (
          <img src={media.url} alt="" className="h-full w-full object-cover" />
        )}
      </div>
      <div className="min-w-0 flex-1 text-sm">
        <p className="truncate font-medium">
          {media.source === "upload" ? media.fileName : "Product photo"}
        </p>
        <p className="text-xs text-muted-foreground">
          {isVideo
            ? "Video. Meta checks it when the campaign is created."
            : "Image"}
        </p>
      </div>
      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onClear}>
        Change
      </Button>
    </div>
  );
}

/** Search a product, then pick one of its own photographs. */
function ProductImagePicker({
  onPick,
}: {
  onPick: (media: AdDraftState["media"]) => void;
}) {
  const [productId, setProductId] = React.useState("");
  const product = useQuery({
    ...productQueryOptions(productId),
    enabled: !!productId,
  });
  const images = (product.data?.media ?? []).filter((m) => m.mediaType === "image");

  return (
    <div className="space-y-2 rounded-lg border border-dashed p-3">
      <ProductCombobox value={productId} onChange={setProductId} />
      {productId && product.isLoading && (
        <p className="text-xs text-muted-foreground">Loading photos…</p>
      )}
      {productId && product.data && images.length === 0 && (
        <p className="text-xs text-muted-foreground">
          This product has no photos. Upload one instead.
        </p>
      )}
      {images.length > 0 && (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {images.map((image) => (
            <button
              key={image.id}
              type="button"
              onClick={() =>
                onPick({
                  source: "product",
                  productId,
                  mediaId: image.id,
                  url: image.url,
                })
              }
              className="aspect-square overflow-hidden rounded-md border transition hover:ring-2 hover:ring-ring"
              aria-label={image.altText ?? "Use this photo"}
            >
              <img src={image.url} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
      {!productId && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <PackageIcon className="h-3.5 w-3.5" />
          Use a photo the catalogue already has, rather than exporting it and
          uploading it again.
        </p>
      )}
    </div>
  );
}

export function UploadPicker({
  onUploaded,
  imagesOnly = false,
}: {
  onUploaded: (media: AdDraftState["media"]) => void;
  /** Pictures only, for a campaign's cover. */
  imagesOnly?: boolean;
}) {
  const [problem, setProblem] = React.useState<string | null>(null);
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      const stored = await uploadCampaignCreativeServerFn({
        data: {
          fileBase64: btoa(binary),
          mimeType: file.type,
          fileName: file.name,
        },
      });
      return { ...stored, fileName: file.name };
    },
    onSuccess: (stored) =>
      onUploaded({
        source: "upload",
        url: stored.url,
        kind: stored.kind,
        fileName: stored.fileName,
      }),
    onError: (err) => setProblem(err.message),
  });

  const choose = (file: File | undefined) => {
    setProblem(null);
    if (!file) return;
    const isVideo = file.type.startsWith("video/");
    if (imagesOnly && isVideo) {
      setProblem("Choose a JPEG or PNG image.");
      return;
    }
    const limit = (isVideo ? MAX_VIDEO_MB : MAX_IMAGE_MB) * 1024 * 1024;
    if (file.size > limit) {
      setProblem(
        `That ${isVideo ? "video" : "image"} is larger than ${isVideo ? MAX_VIDEO_MB : MAX_IMAGE_MB} MB.`,
      );
      return;
    }
    upload.mutate(file);
  };

  return (
    <label className="flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border border-dashed p-5 text-center text-sm transition-colors hover:bg-muted/40">
      {upload.isPending ? (
        <Loader2Icon className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : (
        <UploadIcon className="h-5 w-5 text-muted-foreground" />
      )}
      <span className="font-medium">
        {upload.isPending
          ? "Uploading…"
          : imagesOnly
            ? "Choose an image"
            : "Choose an image or a video"}
      </span>
      <span className="text-xs text-muted-foreground">
        JPEG or PNG up to {MAX_IMAGE_MB} MB
        {imagesOnly ? "" : ` · MP4 or MOV up to ${MAX_VIDEO_MB} MB`}
      </span>
      <input
        type="file"
        accept={
          imagesOnly
            ? "image/jpeg,image/png"
            : "image/jpeg,image/png,video/mp4,video/quicktime"
        }
        className="sr-only"
        disabled={upload.isPending}
        onChange={(e) => choose(e.target.files?.[0])}
      />
      {problem && <span className="text-xs text-destructive">{problem}</span>}
    </label>
  );
}

// ─── Destination ──────────────────────────────────────────────────────────────

function DestinationField({
  ad,
  storefrontUrl,
  onChange,
  complaints,
}: {
  ad: AdDraftState;
  storefrontUrl: string | null;
  onChange: (next: AdDraftState) => void;
  complaints: DraftComplaint[];
}) {
  return (
    <div className="space-y-1.5">
      <Label>Where the ad leads</Label>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Select
          value={ad.destination}
          onValueChange={(v) =>
            onChange({ ...ad, destination: v as AdDestinationKind })
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(DESTINATION_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {ad.destination === "product" && (
          <ProductCombobox
            value={ad.destinationProductId}
            onChange={(id) => onChange({ ...ad, destinationProductId: id })}
          />
        )}
        {ad.destination === "custom" && (
          <div className="flex items-center rounded-md border bg-background pl-3 text-sm">
            <span className="shrink-0 truncate text-muted-foreground">
              {storefrontUrl ?? "your storefront"}
            </span>
            <Input
              value={ad.destinationPath}
              onChange={(e) => onChange({ ...ad, destinationPath: e.target.value })}
              placeholder="/sale"
              className="border-0 shadow-none focus-visible:ring-0"
            />
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Always a page on your own storefront, where the visit can be measured.
      </p>
      <Complaints items={complaints} />
    </div>
  );
}

/** Products by name, searched on the server as the merchant types. */
function ProductCombobox({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const [query, setQuery] = React.useState("");
  const products = useQuery(
    productsQueryOptions({ search: query || undefined, status: "active", limit: 20 }),
  );
  const options = React.useMemo<ComboboxOption[]>(
    () => (products.data?.items ?? []).map((p) => ({ id: p.id, label: p.name })),
    [products.data],
  );
  const search = React.useMemo(() => {
    let timer: ReturnType<typeof setTimeout>;
    return (q: string) => {
      clearTimeout(timer);
      timer = setTimeout(() => setQuery(q), 200);
    };
  }, []);

  return (
    <EntityCombobox
      items={options}
      value={value}
      onChange={onChange}
      placeholder="Search products…"
      emptyText={products.isLoading ? "Loading…" : "No products on sale match."}
      onQueryChange={search}
      className="w-full"
    />
  );
}

// ─── Complaints ───────────────────────────────────────────────────────────────

/** What is wrong with one part of the form, in the words it came with. */
export function Complaints({ items }: { items: DraftComplaint[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="space-y-1">
      {items.map((c, i) => (
        <li key={i} className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertCircleIcon className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>{c.message}</span>
        </li>
      ))}
    </ul>
  );
}

