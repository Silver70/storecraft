import * as React from "react";
import { getRouteApi } from "@tanstack/react-router";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import {
  MAX_NAME_LENGTH,
  SESSION_PARAM,
  message,
  parseFrameMessage,
  parseTarget,
  type AdminCommand,
  type Region,
} from "@repo/inline-edit-js/protocol";
import { Button } from "~/components/ui/button";
import { updateProductServerFn } from "~/features/products/server";
import { inlineEditQueryOptions } from "./server";

const route = getRouteApi("/admin/store");
type Draft = { target: string; original: string; value: string; page: string };

export function StoreEditorPage() {
  const { data: config } = useSuspenseQuery(inlineEditQueryOptions());
  const { productSlug } = route.useSearch();
  // Changing the configured Store or entry page creates a fresh frame/session.
  return (
    <StoreEditor
      key={`${config.storefrontUrl}:${config.canEditProducts}:${productSlug ?? ""}`}
      {...config}
      productSlug={productSlug}
    />
  );
}

function StoreEditor({
  storefrontUrl,
  canEditProducts,
  productSlug,
}: {
  storefrontUrl: string;
  canEditProducts: boolean;
  productSlug?: string;
}) {
  const queryClient = useQueryClient();
  const frame = React.useRef<HTMLIFrameElement>(null);
  const surface = React.useRef<HTMLDivElement>(null);
  const input = React.useRef<HTMLTextAreaElement>(null);
  const currentDraft = React.useRef<Draft | null>(null);
  const currentPage = React.useRef<string | null>(null);
  const currentRegions = React.useRef<Region[]>([]);
  const saving = React.useRef(false);
  const blocked = React.useRef(false);
  const [session, setSession] = React.useState<string | null>(null);
  const [entrySlug, setEntrySlug] = React.useState(productSlug);
  const [regions, setRegions] = React.useState<Region[]>([]);
  const [hovered, setHovered] = React.useState<string | null>(null);
  const [draft, setDraftState] = React.useState<Draft | null>(null);
  const [isSaving, setSaving] = React.useState(false);
  const [connected, setConnected] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState("");
  const [size, setSize] = React.useState({ width: 1000, height: 700 });

  const url = React.useMemo(() => {
    try {
      const base = new URL(storefrontUrl);
      if (!/^https?:$/.test(base.protocol) || base.username || base.password)
        return null;
      if (entrySlug)
        base.pathname = `${base.pathname.replace(/\/$/, "")}/products/${encodeURIComponent(entrySlug)}`;
      base.searchParams.delete(SESSION_PARAM);
      if (canEditProducts && session)
        base.searchParams.set(SESSION_PARAM, session);
      return base;
    } catch {
      return null;
    }
  }, [storefrontUrl, entrySlug, canEditProducts, session]);

  function setDraft(value: Draft | null) {
    currentDraft.current = value;
    setDraftState(value);
  }

  function send(command: AdminCommand, page = currentPage.current) {
    if (session && page && url && !blocked.current) {
      frame.current?.contentWindow?.postMessage(
        message(session, page, command),
        url.origin,
      );
    }
  }

  React.useEffect(() => {
    setSession(crypto.randomUUID());
  }, []);
  React.useEffect(() => {
    if (!surface.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry)
        setSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
    });
    observer.observe(surface.current);
    return () => observer.disconnect();
  }, [session]);

  React.useEffect(() => {
    if (!url || !session || !canEditProducts) return;
    const timeout = window.setTimeout(
      () =>
        setError(
          "The Store hasn’t connected to the editor. Check its ADMIN_ORIGIN, the backend STOREFRONT_URL, and that /ie.js is available, then reload.",
        ),
      12000,
    );

    function receive(event: MessageEvent) {
      const parsed = parseFrameMessage(event, {
        origin: url!.origin,
        source: frame.current?.contentWindow,
        session: session!,
      });
      if (!parsed.ok) {
        if (parsed.reason === "version") {
          blocked.current = true;
          clearTimeout(timeout);
          setConnected(false);
          setError(
            "This Store uses an unsupported editing protocol version. Update the Store’s edit script and reload to continue.",
          );
        }
        return;
      }
      if (blocked.current) return;
      const command = parsed.command;
      if (command.type === "regions") {
        clearTimeout(timeout);
        setConnected(true);
        if (!currentPage.current) setError(null);
        if (currentPage.current !== command.page) setHovered(null);
        currentPage.current = command.page;
        currentRegions.current = command.regions;
        setRegions(command.regions);
        // Hydration/re-renders may replace text nodes. The admin remains the
        // source of the draft and reapplies it by entity identity if necessary.
        const edit = currentDraft.current;
        const region = command.regions.find(
          (item) => item.target === edit?.target,
        );
        if (
          edit &&
          edit.page === command.page &&
          region &&
          region.value !== edit.value
        ) {
          frame.current?.contentWindow?.postMessage(
            message(session!, edit.page, {
              type: "preview",
              target: edit.target,
              value: edit.value,
            }),
            url!.origin,
          );
        }
      } else if (command.page === currentPage.current) {
        if (command.type === "hover") setHovered(command.target);
        if (
          command.type === "select" &&
          !currentDraft.current &&
          !saving.current
        ) {
          const region = currentRegions.current.find(
            (item) => item.target === command.target,
          );
          if (!region) return;
          setDraft({
            target: region.target,
            original: region.value,
            value: region.value,
            page: command.page,
          });
          setError(null);
          setNotice("");
        }
      }
    }
    window.addEventListener("message", receive);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener("message", receive);
    };
  }, [url, session, canEditProducts]);

  React.useEffect(() => {
    if (draft) {
      input.current?.focus();
      input.current?.select();
    }
  }, [draft?.target]);

  function change(value: string) {
    if (!draft || saving.current || blocked.current) return;
    if (value.length > MAX_NAME_LENGTH) {
      setError(
        `Product names can contain at most ${MAX_NAME_LENGTH} characters. The extra text wasn’t applied.`,
      );
      return;
    }
    const next = { ...draft, value };
    setDraft(next);
    setError(null);
    send({ type: "preview", target: next.target, value }, next.page);
  }

  function cancel() {
    if (!draft || saving.current) return;
    if (blocked.current && frame.current && url) {
      // A refused protocol cannot restore text via a command. Reload the
      // persisted page when abandoning instead of leaving a draft visible.
      frame.current.src = url.href;
    }
    send(
      { type: "preview", target: draft.target, value: draft.original },
      draft.page,
    );
    setDraft(null);
    setHovered(null);
    if (!blocked.current) setError(null);
    setNotice("Edit discarded.");
  }

  async function save() {
    const edit = currentDraft.current;
    if (!edit || saving.current || blocked.current || !canEditProducts) return;
    if (!edit.value.trim()) {
      setError("Enter a product name before saving.");
      return;
    }
    const target = parseTarget(edit.target);
    if (!target) return;
    saving.current = true;
    setSaving(true);
    setError(null);
    try {
      const product = await updateProductServerFn({
        data: { productId: target.id, body: { name: edit.value } },
      });
      send(
        { type: "preview", target: edit.target, value: product.name },
        edit.page,
      );
      setDraft(null);
      setHovered(null);
      setNotice("Product name saved. The change is live.");
      // The existing endpoint regenerates the slug on rename. Reopen the saved
      // product so refreshes and subsequent edits use its actual public URL.
      if (entrySlug !== product.slug) {
        currentPage.current = null;
        currentRegions.current = [];
        setRegions([]);
        setConnected(false);
        setEntrySlug(product.slug);
      }
      void queryClient.invalidateQueries({ queryKey: ["products"] });
    } catch (cause) {
      setError(
        `Couldn’t save. Your text is still here; try again. ${cause instanceof Error ? cause.message : ""}`,
      );
    } finally {
      saving.current = false;
      setSaving(false);
    }
  }

  const selected = regions.find(
    (region) => region.target === (draft?.target ?? hovered),
  );
  const panelWidth = Math.min(360, Math.max(200, size.width - 24));
  const panelLeft = Math.max(
    12,
    Math.min(selected?.rect.x ?? 12, size.width - panelWidth - 12),
  );
  const panelTop = Math.max(
    12,
    Math.min(
      (selected?.rect.y ?? 0) + (selected?.rect.height ?? 0) + 8,
      size.height - 240,
    ),
  );

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Store</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {canEditProducts
            ? "Open a product page, then click its name to edit. Save makes the change live; Cancel restores the original."
            : "You can view the Store. Your role does not have permission to edit products."}
        </p>
      </div>
      <div aria-live="polite" className="text-sm">
        {notice ||
          (canEditProducts
            ? connected
              ? "Editor connected"
              : "Connecting to the Store…"
            : "View only")}
      </div>
      {!draft && error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!url ? (
        <p role="alert">
          The backend Store address must be a valid HTTP or HTTPS URL.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-background">
          <div ref={surface} className="relative h-[70vh] min-h-[420px]">
            {session && (
              <iframe
                ref={frame}
                title="Store preview"
                src={url.href}
                className="block h-full w-full border-0"
                referrerPolicy="strict-origin-when-cross-origin"
                onPointerLeave={() => setHovered(null)}
              />
            )}
            {selected && connected && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute rounded-sm border-2 border-blue-500"
                style={{
                  left: selected.rect.x,
                  top: selected.rect.y,
                  width: selected.rect.width,
                  height: selected.rect.height,
                }}
              />
            )}
            {draft && (
              <>
                {/* Stray clicks cannot navigate the frame or commit an edit. */}
                <div
                  className="absolute inset-0"
                  onClick={() => input.current?.focus()}
                />
                <form
                  aria-label="Edit product name"
                  className="absolute rounded-lg border bg-background p-3 shadow-lg"
                  style={{ left: panelLeft, top: panelTop, width: panelWidth }}
                  onSubmit={(event) => {
                    event.preventDefault();
                    void save();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      cancel();
                    }
                    if (
                      event.key === "Enter" &&
                      (event.ctrlKey || event.metaKey)
                    ) {
                      event.preventDefault();
                      void save();
                    }
                  }}
                >
                  <label
                    htmlFor="inline-product-name"
                    className="text-sm font-medium"
                  >
                    Product name
                  </label>
                  <textarea
                    ref={input}
                    id="inline-product-name"
                    value={draft.value}
                    rows={2}
                    disabled={isSaving || blocked.current}
                    onChange={(event) => change(event.target.value)}
                    className="mt-2 w-full resize-none rounded-md border bg-background p-2 text-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    Live when saved · {draft.value.length}/{MAX_NAME_LENGTH}
                  </p>
                  {error && (
                    <p role="alert" className="mt-2 text-sm text-destructive">
                      {error}
                    </p>
                  )}
                  <div className="mt-3 flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={cancel}
                      disabled={isSaving}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      size="sm"
                      disabled={isSaving || blocked.current}
                    >
                      {isSaving ? "Saving…" : "Save"}
                    </Button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
