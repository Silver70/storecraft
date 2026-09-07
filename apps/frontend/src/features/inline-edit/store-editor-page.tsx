import * as React from "react";
import { getRouteApi } from "@tanstack/react-router";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import {
  SESSION_PARAM,
  applyPaste,
  fieldSpec,
  message,
  parseFrameMessage,
  parseTarget,
  sanitizeText,
  type AdminCommand,
  type FieldSpec,
  type Region,
  type Target,
} from "@repo/inline-edit-js/protocol";
import { Button } from "~/components/ui/button";
import {
  updateCategoryServerFn,
  updateProductServerFn,
} from "~/features/products/server";
import { inlineEditQueryOptions } from "./server";

const route = getRouteApi("/admin/store");
type Draft = { target: string; original: string; value: string; page: string };
/** Which Store page the frame is pointed at. `path` is relative to the Store. */
type Entry = { path: string; category?: string };

export function StoreEditorPage() {
  const { data: config } = useSuspenseQuery(inlineEditQueryOptions());
  const { productSlug, categorySlug } = route.useSearch();
  const entry: Entry = productSlug
    ? { path: `products/${encodeURIComponent(productSlug)}` }
    : categorySlug
      ? { path: "products", category: categorySlug }
      : { path: "" };
  // Changing the configured Store or entry page creates a fresh frame/session.
  return (
    <StoreEditor
      key={`${config.storefrontUrl}:${config.canEditProducts}:${entry.path}:${entry.category ?? ""}`}
      {...config}
      entry={entry}
    />
  );
}

function StoreEditor({
  storefrontUrl,
  canEditProducts,
  entry: initialEntry,
}: {
  storefrontUrl: string;
  canEditProducts: boolean;
  entry: Entry;
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
  const [entry, setEntry] = React.useState(initialEntry);
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
      const root = base.pathname.replace(/\/+$/, "");
      base.pathname = entry.path ? `${root}/${entry.path}` : root || "/";
      base.searchParams.delete("category");
      if (entry.category) base.searchParams.set("category", entry.category);
      base.searchParams.delete(SESSION_PARAM);
      if (canEditProducts && session)
        base.searchParams.set(SESSION_PARAM, session);
      return base;
    } catch {
      return null;
    }
  }, [storefrontUrl, entry, canEditProducts, session]);

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
        if (command.type === "select") open(command.target, command.page);
      }
    }
    window.addEventListener("message", receive);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener("message", receive);
    };
  }, [url, session, canEditProducts]);

  React.useEffect(() => {
    const field = input.current;
    if (!draft || !field) return;
    field.focus();
    const target = parseTarget(draft.target);
    // Selecting a whole paragraph would put one keystroke between a merchant
    // and their copy; a single line is the thing you came to replace.
    if (target && fieldSpec(target).multiline)
      field.setSelectionRange(field.value.length, field.value.length);
    else field.select();
  }, [draft?.target]);

  /**
   * One way in, whether the merchant clicked the text in the Store or a field
   * the page declares but does not display. A field is only ever opened by
   * identity — never by what was in that spot when the message arrived.
   */
  function open(target: string, page = currentPage.current) {
    if (currentDraft.current || saving.current || !page) return;
    const region = currentRegions.current.find(
      (item) => item.target === target,
    );
    if (!region) return;
    setDraft({
      target: region.target,
      original: region.value,
      value: region.value,
      page,
    });
    setError(null);
    setNotice("");
    if (region.rect) send({ type: "focus", target }, page);
  }

  function change(value: string) {
    const edit = currentDraft.current;
    const target = edit && parseTarget(edit.target);
    if (!edit || !target || saving.current || blocked.current) return;
    const spec = fieldSpec(target);
    const text = sanitizeText(value, spec);
    if (text.length > spec.maxLength) {
      setError(
        `${spec.label} can contain at most ${spec.maxLength} characters. The extra text wasn’t applied.`,
      );
      return;
    }
    const next = { ...edit, value: text };
    setDraft(next);
    setError(null);
    send({ type: "preview", target: next.target, value: text }, next.page);
  }

  /** An oversized paste is refused whole; nothing is quietly cut off it. */
  function paste(
    event: React.ClipboardEvent<HTMLTextAreaElement>,
    spec: FieldSpec,
  ) {
    const field = event.currentTarget;
    event.preventDefault();
    if (saving.current || blocked.current) return;
    const result = applyPaste(
      field.value,
      field.selectionStart ?? field.value.length,
      field.selectionEnd ?? field.value.length,
      event.clipboardData.getData("text/plain"),
      spec,
    );
    if (!result.ok) {
      setError(
        `That paste would make the ${spec.label.toLowerCase()} longer than ${spec.maxLength} characters, so none of it was pasted. Shorten it and try again.`,
      );
      return;
    }
    change(result.value);
    requestAnimationFrame(() =>
      input.current?.setSelectionRange(result.caret, result.caret),
    );
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

  /** Reopen the Store at a page whose address the save has just changed. */
  function reopen(next: Entry) {
    if (next.path === entry.path && next.category === entry.category) return;
    currentPage.current = null;
    currentRegions.current = [];
    setRegions([]);
    setConnected(false);
    setEntry(next);
  }

  async function save() {
    const edit = currentDraft.current;
    const target = edit && parseTarget(edit.target);
    if (
      !edit ||
      !target ||
      saving.current ||
      blocked.current ||
      !canEditProducts
    )
      return;
    const spec = fieldSpec(target);
    if (target.field === "name" && !edit.value.trim()) {
      setError(`Enter a ${spec.label.toLowerCase()} before saving.`);
      return;
    }
    saving.current = true;
    setSaving(true);
    setError(null);
    try {
      // The same endpoint and the same permission as the admin form for this
      // field. Entering through the editor is not a second write path.
      const saved =
        target.kind === "product"
          ? await updateProductServerFn({
              data: {
                productId: target.id,
                body: { [target.field]: edit.value },
              },
            })
          : await updateCategoryServerFn({
              data: { id: target.id, [target.field]: edit.value },
            });
      // Show back what the endpoint stored; a cleared field comes back null,
      // and what was committed is the honest fallback either way.
      const stored = (saved as Record<string, unknown>)[target.field];
      send(
        {
          type: "preview",
          target: edit.target,
          value:
            typeof stored === "string"
              ? stored
              : stored === null
                ? ""
                : edit.value,
        },
        edit.page,
      );
      setDraft(null);
      setHovered(null);
      setNotice(`${spec.label} saved. The change is live.`);
      // The existing endpoints regenerate the slug on rename, so the page the
      // frame is showing has just moved. Reopen it at the address it now has.
      if (target.field === "name")
        reopen(
          target.kind === "product"
            ? { path: `products/${encodeURIComponent(saved.slug)}` }
            : { path: "products", category: saved.slug },
        );
      void queryClient.invalidateQueries({
        queryKey: [target.kind === "product" ? "products" : "categories"],
      });
    } catch (cause) {
      setError(
        `Couldn’t save. Your text is still here; try again. ${cause instanceof Error ? cause.message : ""}`,
      );
    } finally {
      saving.current = false;
      setSaving(false);
    }
  }

  const editingTarget: Target | null = draft ? parseTarget(draft.target) : null;
  const spec = editingTarget ? fieldSpec(editingTarget) : null;
  const selected = regions.find(
    (region) => region.target === (draft?.target ?? hovered),
  );
  const outline = selected?.rect ?? null;
  const panelWidth = Math.min(
    spec?.multiline ? 460 : 360,
    Math.max(200, size.width - 24),
  );
  const panelLeft = Math.max(
    12,
    Math.min(outline?.x ?? 12, size.width - panelWidth - 12),
  );
  const panelTop = Math.max(
    12,
    Math.min(
      outline ? outline.y + outline.height + 8 : 12,
      size.height - (spec?.multiline ? 340 : 240),
    ),
  );

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Store</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {canEditProducts
            ? "Click any outlined text to edit it, or pick a field from the list below the Store. Save makes the change live; Cancel restores the original."
            : "You can view the Store. Your role does not have permission to edit product and category copy."}
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
            {outline && connected && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute rounded-sm border-2 border-blue-500"
                style={{
                  left: outline.x,
                  top: outline.y,
                  width: outline.width,
                  height: outline.height,
                }}
              />
            )}
            {draft && spec && (
              <>
                {/* Stray clicks cannot navigate the frame or commit an edit. */}
                <div
                  className="absolute inset-0"
                  onClick={() => input.current?.focus()}
                />
                <form
                  aria-label={`Edit ${spec.label.toLowerCase()}`}
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
                    // A paragraph keeps Enter for its own use; a single line
                    // has nothing to do with it but commit.
                    if (
                      event.key === "Enter" &&
                      (event.ctrlKey || event.metaKey || !spec.multiline)
                    ) {
                      event.preventDefault();
                      void save();
                    }
                  }}
                >
                  <label
                    htmlFor="inline-edit-field"
                    className="text-sm font-medium"
                  >
                    {spec.label}
                  </label>
                  <textarea
                    ref={input}
                    id="inline-edit-field"
                    value={draft.value}
                    rows={spec.multiline ? 8 : 2}
                    disabled={isSaving || blocked.current}
                    onChange={(event) => change(event.target.value)}
                    onPaste={(event) => paste(event, spec)}
                    className="mt-2 w-full rounded-md border bg-background p-2 text-sm"
                    style={{ resize: spec.multiline ? "vertical" : "none" }}
                  />
                  <p className="text-xs text-muted-foreground">
                    Live when saved · {draft.value.length}/{spec.maxLength}
                    {spec.multiline ? " · Ctrl+Enter saves" : ""}
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
      {canEditProducts && connected && regions.length > 0 && (
        <PageFields regions={regions} busy={!!draft} onOpen={open} />
      )}
    </div>
  );
}

/**
 * Every field this page carries, including the ones it does not display. SEO
 * copy belongs to the page it describes but has no text on it to click, and a
 * list is the only honest way to offer it from that page.
 */
function PageFields({
  regions,
  busy,
  onOpen,
}: {
  regions: Region[];
  busy: boolean;
  onOpen: (target: string) => void;
}) {
  return (
    <div className="rounded-lg border bg-background p-4">
      <h2 className="text-sm font-medium">Editable on this page</h2>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {regions.map((region) => {
          const target = parseTarget(region.target);
          if (!target) return null;
          const spec = fieldSpec(target);
          return (
            <li key={region.target}>
              <button
                type="button"
                disabled={busy}
                onClick={() => onOpen(region.target)}
                className="w-full rounded-md border px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"
              >
                <span className="block font-medium">{spec.label}</span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {region.value.trim() || "Empty"}
                </span>
                {!region.rect && (
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    Not shown on the page
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
