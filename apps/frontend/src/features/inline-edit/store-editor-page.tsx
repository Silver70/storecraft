import * as React from "react";
import { getRouteApi, useRouter } from "@tanstack/react-router";
import {
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import {
  SESSION_PARAM,
  applyPaste,
  describeTarget,
  locateInStore,
  message,
  parseFrameMessage,
  parseTarget,
  regionSpec,
  sanitizeText,
  type AdminCommand,
  type FieldSpec,
  type Region,
  type SlotDeclaration,
  type StoreLocation,
  type Target,
} from "@repo/inline-edit-js/protocol";
import { Button } from "~/components/ui/button";
import {
  updateCategoryServerFn,
  updateProductServerFn,
} from "~/features/products/server";
import { inlineEditQueryOptions } from "./server";
import {
  contentSlotsQueryOptions,
  discardContentSlotDraftServerFn,
  publishContentSlotServerFn,
  saveContentSlotDraftServerFn,
  type ContentSlot,
} from "./content-server";

const route = getRouteApi("/admin/store");
/**
 * An edit in progress. It carries the spec it was opened with rather than
 * looking one up as it goes, so a re-render of the Store cannot change the
 * rules half way through typing — and, for a Content Slot, the declaration the
 * storefront made, which is what the draft is saved as.
 */
type Draft = {
  target: string;
  original: string;
  value: string;
  page: string;
  spec: FieldSpec;
  slot: SlotDeclaration | null;
};
/** Which Store page the frame is pointed at. `path` is relative to the Store. */
type Entry = { path: string; category?: string };

export function StoreEditorPage() {
  const { data: config } = useSuspenseQuery(inlineEditQueryOptions());
  const { productSlug, categorySlug, returnTo } = route.useSearch();
  const entry: Entry = productSlug
    ? { path: `products/${encodeURIComponent(productSlug)}` }
    : categorySlug
      ? { path: "products", category: categorySlug }
      : { path: "" };
  // Changing the configured Store or entry page creates a fresh frame/session.
  return (
    <StoreEditor
      key={`${config.storefrontUrl}:${config.canEditProducts}:${config.canEditContent}:${entry.path}:${entry.category ?? ""}`}
      {...config}
      entry={entry}
      returnTo={returnTo}
    />
  );
}

function StoreEditor({
  storefrontUrl,
  canEditProducts,
  canEditContent,
  entry: initialEntry,
  returnTo,
}: {
  storefrontUrl: string;
  canEditProducts: boolean;
  canEditContent: boolean;
  entry: Entry;
  returnTo?: string;
}) {
  // A role that can edit either kind of copy gets an editing session; what it
  // may actually change is decided per region, by the same permissions the
  // admin forms use.
  const canEdit = canEditProducts || canEditContent;
  const queryClient = useQueryClient();
  const router = useRouter();
  /**
   * Every Slot of this Store, published value and draft alike. Held here
   * because the admin owns draft state: the frame renders published copy —
   * it is a shopper's view of the Store — and the editor pushes the drafts
   * over the top so the merchant is editing what they will publish.
   */
  const slots = React.useRef<Map<string, ContentSlot>>(new Map());
  /**
   * What the storefront calls each Slot, learned from the regions it announces
   * and kept for the rest of the session. A Slot the merchant drafted on
   * another page is still theirs to publish from here, and "Homepage headline"
   * is what they called it — `homepage.hero` is what the code calls it.
   */
  const slotLabels = React.useRef<Map<string, string>>(new Map());
  const frame = React.useRef<HTMLIFrameElement>(null);
  const surface = React.useRef<HTMLDivElement>(null);
  const input = React.useRef<HTMLTextAreaElement>(null);
  const currentDraft = React.useRef<Draft | null>(null);
  const currentPage = React.useRef<string | null>(null);
  const currentRegions = React.useRef<Region[]>([]);
  const saving = React.useRef(false);
  const blocked = React.useRef(false);
  const waiting = React.useRef(0);
  const arrived = React.useRef(false);
  const astray = React.useRef(false);
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
  /** Where the frame says it is. Null until it has said, or once it has left. */
  const [location, setLocation] = React.useState<StoreLocation | null>(null);
  const [offStore, setOffStore] = React.useState(false);
  const [reload, setReload] = React.useState(0);
  /** Bumped when a draft is saved or published, to re-render what says so. */
  const [slotsChanged, setSlotsChanged] = React.useState(0);

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
      if (canEdit && session) base.searchParams.set(SESSION_PARAM, session);
      return base;
    } catch {
      return null;
    }
  }, [storefrontUrl, entry, canEdit, session]);

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

  /**
   * Forgets the page the frame was showing. Called whenever the document in
   * the frame is replaced or has moved somewhere this editor cannot follow.
   */
  function forgetPage() {
    currentPage.current = null;
    currentRegions.current = [];
    setRegions([]);
    setHovered(null);
    setConnected(false);
  }

  /**
   * The frame has landed on a new page of the Store. An edit the merchant
   * never committed goes with the page it belonged to; one already sent to
   * save is travelling through the admin API and finishes regardless.
   */
  function enterPage(page: string) {
    if (currentPage.current === page) return;
    currentPage.current = page;
    currentRegions.current = [];
    setRegions([]);
    setHovered(null);
    setError(null);
    const edit = currentDraft.current;
    if (edit && !saving.current) {
      setDraft(null);
      setNotice(
        "The Store moved to another page, so the edit you hadn’t saved was discarded.",
      );
    }
  }

  /**
   * The frame is somewhere this editor has no business editing — another site,
   * or a page above the Store's root. Editing stops rather than continuing to
   * point at a Store the merchant is no longer looking at.
   */
  function leaveStore(reason: string) {
    astray.current = true;
    forgetPage();
    setOffStore(true);
    setLocation(null);
    if (!saving.current) setDraft(null);
    setError(reason);
  }

  /** Puts the frame back on the page the editor was opened at. */
  function returnToStore() {
    astray.current = false;
    forgetPage();
    setOffStore(false);
    setLocation(null);
    setError(null);
    setNotice("");
    setEntry(initialEntry);
    setReload((count) => count + 1);
  }

  /**
   * Waits for the document in the frame to say where it is. Silence means it
   * is not carrying the bridge: on arrival that is a setup problem worth
   * explaining, and afterwards it means the frame has left the Store for
   * somewhere this editor cannot hear.
   */
  function awaitFrame() {
    if (!canEdit) return;
    window.clearTimeout(waiting.current);
    waiting.current = window.setTimeout(
      () =>
        arrived.current
          ? leaveStore(
              "The frame is showing a page that isn’t part of your Store, so editing is off here.",
            )
          : setError(
              "The Store hasn’t connected to the editor. Check its ADMIN_ORIGIN, the backend STOREFRONT_URL, and that /ie.js is available, then reload.",
            ),
      arrived.current ? 8000 : 12000,
    );
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
    if (!url || !session || !canEdit) return;
    awaitFrame();

    function receive(event: MessageEvent) {
      const parsed = parseFrameMessage(event, {
        origin: url!.origin,
        source: frame.current?.contentWindow,
        session: session!,
      });
      if (!parsed.ok) {
        if (parsed.reason === "version") {
          blocked.current = true;
          window.clearTimeout(waiting.current);
          setConnected(false);
          setError(
            "This Store uses an unsupported editing protocol version. Update the Store’s edit script and reload to continue.",
          );
        }
        return;
      }
      if (blocked.current) return;
      const command = parsed.command;
      if (command.type === "navigate") {
        window.clearTimeout(waiting.current);
        arrived.current = true;
        // Whether the frame is still showing this merchant's Store is decided
        // against the Store the editor opened, never against what it claims.
        const at = locateInStore(command.url, storefrontUrl);
        if (!at) {
          leaveStore(
            "The frame has left your Store, so editing is off. Return to your Store to carry on editing.",
          );
          return;
        }
        astray.current = false;
        setOffStore(false);
        setLocation(at);
        enterPage(command.page);
      } else if (astray.current) {
        // The frame has already said it is somewhere else. Only another
        // navigation, back into the Store, makes it editable again.
        return;
      } else if (command.type === "regions") {
        window.clearTimeout(waiting.current);
        arrived.current = true;
        enterPage(command.page);
        setConnected(true);
        currentRegions.current = command.regions;
        setRegions(command.regions);
        learnSlotLabels(command.regions);
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
        showDrafts(command.regions, command.page);
      } else if (command.page === currentPage.current) {
        if (command.type === "hover") setHovered(command.target);
        if (command.type === "select") open(command.target, command.page);
      }
    }
    window.addEventListener("message", receive);
    return () => {
      window.clearTimeout(waiting.current);
      window.removeEventListener("message", receive);
    };
  }, [url, session, canEdit, storefrontUrl]);

  /**
   * Puts the merchant's unpublished drafts over the published copy the frame
   * rendered, so the editing frame shows what they are working on. It is the
   * only place a draft is ever visible: the Store's own read returns published
   * values, and a shopper's browser has no way to ask for anything else.
   */
  function showDrafts(
    list = currentRegions.current,
    page = currentPage.current,
  ) {
    if (!canEditContent || !session || !url || !page || blocked.current) return;
    const edit = currentDraft.current;
    for (const region of list) {
      const parsed = parseTarget(region.target);
      if (!parsed || parsed.kind !== "slot") continue;
      // An open edit is the merchant's most recent word; it is reapplied
      // above, and a saved draft must not overwrite what they are typing.
      if (edit?.target === region.target) continue;
      const value = slots.current.get(parsed.key)?.draftValue;
      if (value == null || value === region.value) continue;
      frame.current?.contentWindow?.postMessage(
        message(session, page, {
          type: "preview",
          target: region.target,
          value,
        }),
        url.origin,
      );
    }
  }

  /**
   * Remembers what the storefront calls the Slots on this page, so a draft the
   * merchant left somewhere else can be listed by its name rather than by its
   * key. Only a name it has not seen re-renders anything: regions are
   * announced on every scroll and resize.
   */
  function learnSlotLabels(list: Region[]) {
    let learned = false;
    for (const region of list) {
      const parsed = parseTarget(region.target);
      if (parsed?.kind !== "slot" || !region.slot) continue;
      if (slotLabels.current.get(parsed.key) === region.slot.label) continue;
      slotLabels.current.set(parsed.key, region.slot.label);
      learned = true;
    }
    if (learned) setSlotsChanged((count) => count + 1);
  }

  const slotQuery = useQuery({
    ...contentSlotsQueryOptions(),
    enabled: canEditContent,
  });
  React.useEffect(() => {
    if (!slotQuery.data) return;
    slots.current = new Map(slotQuery.data.map((slot) => [slot.key, slot]));
    setSlotsChanged((count) => count + 1);
    showDrafts();
  }, [slotQuery.data]);

  React.useEffect(() => {
    const field = input.current;
    if (!draft || !field) return;
    field.focus();
    // Selecting a whole paragraph would put one keystroke between a merchant
    // and their copy; a single line is the thing you came to replace.
    if (draft.spec.multiline)
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
    const parsed = region && parseTarget(region.target);
    const spec = parsed && regionSpec(parsed, region.slot);
    if (!region || !parsed || !spec) return;
    if (parsed.kind === "slot" ? !canEditContent : !canEditProducts) {
      setError(
        `Your role does not have permission to edit ${
          parsed.kind === "slot" ? "this region" : "product and category copy"
        }.`,
      );
      return;
    }
    // A Slot is opened on the merchant's own latest word — their unpublished
    // draft if they have one, and what shoppers are reading if they do not.
    const stored =
      parsed.kind === "slot" ? slots.current.get(parsed.key) : undefined;
    const original =
      stored?.draftValue ??
      (parsed.kind === "slot" ? (stored?.value ?? region.value) : region.value);
    setDraft({
      target: region.target,
      original,
      value: original,
      page,
      spec,
      slot: region.slot,
    });
    setError(null);
    setNotice("");
    if (original !== region.value)
      send({ type: "preview", target: region.target, value: original }, page);
    if (region.rect) send({ type: "focus", target }, page);
  }

  function change(value: string) {
    const edit = currentDraft.current;
    if (!edit || saving.current || blocked.current) return;
    const spec = edit.spec;
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
    forgetPage();
    setLocation(null);
    setEntry(next);
  }

  /**
   * Saves a Slot's draft, and publishes it when the merchant asked to. Both go
   * through the admin API on the admin's origin, under `content.write` — the
   * frame never holds a credential and never writes anything.
   */
  async function saveSlot(edit: Draft, key: string, andPublish: boolean) {
    if (!canEditContent || !edit.slot) return;
    saving.current = true;
    setSaving(true);
    setError(null);
    try {
      let record = await saveContentSlotDraftServerFn({
        data: { key, type: edit.slot.type, value: edit.value },
      });
      if (andPublish) {
        record = await publishContentSlotServerFn({ data: { key } });
      }
      slots.current.set(key, record);
      setSlotsChanged((count) => count + 1);
      // Show back what was stored. The merchant keeps seeing their draft in
      // the frame after saving one, which is the point: they are editing what
      // they will publish, not what is currently live.
      send(
        {
          type: "preview",
          target: edit.target,
          value: record.draftValue ?? record.value ?? "",
        },
        edit.page,
      );
      setDraft(null);
      setHovered(null);
      setNotice(
        andPublish
          ? `${edit.spec.label} published. It is live on your Store now.`
          : `${edit.spec.label} saved as a draft. Shoppers still see the published copy until you publish it.`,
      );
      void queryClient.invalidateQueries({ queryKey: ["content-slots"] });
    } catch (cause) {
      setError(
        `Couldn’t save. Your text is still here; try again. ${cause instanceof Error ? cause.message : ""}`,
      );
    } finally {
      saving.current = false;
      setSaving(false);
    }
  }

  /**
   * Runs one of the two things a merchant can do to a draft they already have,
   * from wherever they are — the panel they are typing in, or the list of
   * everything they have left unpublished. Both go through the admin API under
   * `content.write`; neither can touch a published value except by replacing
   * it, which is what publishing is.
   */
  async function actOnDraft(key: string, action: "publish" | "discard") {
    if (!canEditContent || saving.current) return;
    saving.current = true;
    setSaving(true);
    setError(null);
    try {
      const record =
        action === "publish"
          ? await publishContentSlotServerFn({ data: { key } })
          : await discardContentSlotDraftServerFn({ data: { key } });
      slots.current.set(key, record);
      setSlotsChanged((count) => count + 1);
      // Put back what the Slot now holds. After a discard that is the copy
      // shoppers were reading all along; after a publish it is the same text
      // the merchant was already looking at.
      const target = describeTarget({ kind: "slot", key });
      send({ type: "preview", target, value: record.value ?? "" });
      if (currentDraft.current?.target === target) {
        setDraft(null);
        setHovered(null);
      }
      const name = slotName(key);
      setNotice(
        action === "publish"
          ? `${name} published. It is live on your Store now.`
          : record.value === null
            ? `Draft discarded. ${name} is empty again, and shoppers see nothing there.`
            : `Draft discarded. ${name} still shows the copy you published.`,
      );
      void queryClient.invalidateQueries({ queryKey: ["content-slots"] });
    } catch (cause) {
      setError(
        `Couldn’t ${action} that draft. Nothing changed on your Store; try again. ${cause instanceof Error ? cause.message : ""}`,
      );
    } finally {
      saving.current = false;
      setSaving(false);
    }
  }

  /** What the storefront calls this Slot, falling back to its key. */
  function slotName(key: string) {
    return slotLabels.current.get(key) ?? key;
  }

  /**
   * Commits the open edit.
   *
   * The two kinds of copy behave differently on purpose, and the editor says
   * so rather than hiding it. An entity field goes through the same admin
   * endpoint the admin form uses and is live the moment it is saved. A Content
   * Slot is saved to its draft, and only the merchant sees it until they
   * publish — so the copy on their live Store is never half-written, and
   * shoppers keep reading what was already there.
   */
  async function save(andPublish = false) {
    const edit = currentDraft.current;
    const target = edit && parseTarget(edit.target);
    if (!edit || !target || saving.current || blocked.current) return;
    if (target.kind === "slot") return saveSlot(edit, target.key, andPublish);
    if (!canEditProducts) return;
    const spec = edit.spec;
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

  // Until the frame has said where it is — and for a role that never loads the
  // bridge — the honest answer is the address the editor pointed it at.
  const showing =
    location ?? (url ? locateInStore(url.href, storefrontUrl) : null);
  const editingTarget: Target | null = draft ? parseTarget(draft.target) : null;
  const spec = draft?.spec ?? null;
  /** A Slot is drafted and published; an entity field is live when saved. */
  const drafting = editingTarget?.kind === "slot";
  /** Whether the open Slot has work already saved that could be thrown away. */
  const storedDraft =
    editingTarget?.kind === "slot" &&
    slots.current.get(editingTarget.key)?.draftValue != null;
  /**
   * Every Slot of this Store the merchant has touched, read straight from the
   * ref because a save, a publish and a discard all rewrite it and bump
   * `slotsChanged`, which is what re-renders this.
   */
  const storeSlots = [...slots.current.values()];
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Store</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {canEdit
              ? "Browse your Store as a shopper would; editing follows you from page to page. Click any outlined text to edit it, or pick a field from the list below the Store."
              : "You can view the Store. Your role does not have permission to edit its copy."}
          </p>
          {/* The two behaviours differ, so the editor says which is which
              before the merchant meets either of them. */}
          {canEdit && (
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              {canEditProducts && (
                <li>
                  <strong className="font-medium text-foreground">
                    Product and category copy
                  </strong>{" "}
                  goes live the moment you save it.
                </li>
              )}
              {canEditContent && (
                <li>
                  <strong className="font-medium text-foreground">
                    Page regions
                  </strong>{" "}
                  — your homepage headline and the like — are saved as a draft
                  only you can see, and go live when you publish them.
                </li>
              )}
            </ul>
          )}
        </div>
        {/* Editing is a mode, so it has a door out as well as a door in. */}
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            void router.navigate({ href: returnTo ?? "/admin/dashboard" })
          }
        >
          Exit editor
        </Button>
      </div>
      <div aria-live="polite" className="text-sm">
        {notice ||
          (canEdit
            ? offStore
              ? "Editing paused"
              : connected
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
          {/* Which page of the Store this is, and a way to see it for real. */}
          <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 text-sm">
            <span className="text-muted-foreground">
              {offStore
                ? "Left your Store"
                : location
                  ? "Showing"
                  : "Opened at"}
            </span>
            <code
              title={offStore ? undefined : showing?.href}
              className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs"
            >
              {offStore ? "A page outside your Store" : (showing?.path ?? "…")}
            </code>
            {offStore && (
              <Button variant="outline" size="sm" onClick={returnToStore}>
                Return to your Store
              </Button>
            )}
            {showing && !offStore && (
              <Button asChild variant="outline" size="sm">
                <a
                  href={showing.href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open in new tab
                </a>
              </Button>
            )}
          </div>
          <div ref={surface} className="relative h-[70vh] min-h-[420px]">
            {session && (
              <iframe
                key={reload}
                ref={frame}
                title="Store preview"
                src={url.href}
                className="block h-full w-full border-0"
                referrerPolicy="strict-origin-when-cross-origin"
                onLoad={awaitFrame}
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
                  {/* Said where the merchant is working, because this is the
                      one place the difference between the two behaviours
                      matters and the one place they will read it. */}
                  <p className="text-xs text-muted-foreground">
                    {drafting ? "Saved as a draft" : "Live when saved"} ·{" "}
                    {draft.value.length}/{spec.maxLength}
                    {spec.multiline ? " · Ctrl+Enter saves" : ""}
                  </p>
                  {drafting && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Shoppers keep seeing the published copy until you press
                      Publish.
                    </p>
                  )}
                  {error && (
                    <p role="alert" className="mt-2 text-sm text-destructive">
                      {error}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    {/* Abandoning an idea is one action, and it leaves what
                        shoppers are reading exactly where it was. */}
                    {drafting && storedDraft && editingTarget && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="mr-auto text-destructive"
                        onClick={() =>
                          void actOnDraft(editingTarget.key, "discard")
                        }
                        disabled={isSaving || blocked.current}
                      >
                        Discard draft
                      </Button>
                    )}
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
                      variant={drafting ? "outline" : "default"}
                      disabled={isSaving || blocked.current}
                    >
                      {isSaving ? "Saving…" : drafting ? "Save draft" : "Save"}
                    </Button>
                    {/* Going live is its own button, so it is a decision the
                        merchant made rather than a side effect of typing. */}
                    {drafting && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => void save(true)}
                        disabled={isSaving || blocked.current}
                      >
                        Publish
                      </Button>
                    )}
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}
      {canEditContent && storeSlots.length > 0 && (
        <ContentRegions
          slots={storeSlots}
          name={slotName}
          busy={isSaving}
          onPublish={(key) => void actOnDraft(key, "publish")}
          onDiscard={(key) => void actOnDraft(key, "discard")}
        />
      )}
      {canEdit && connected && regions.length > 0 && (
        <PageFields
          key={slotsChanged}
          regions={regions}
          slots={slots.current}
          busy={!!draft}
          onOpen={open}
        />
      )}
    </div>
  );
}

/**
 * When a Slot was last published, said the way a merchant would date it, so
 * copy written this morning can be told apart from copy written six weeks ago
 * and forgotten. Null for a Slot that has never gone live — the state beside
 * it already says as much, and saying it twice says it less.
 */
function publishedOn(at: string | null | undefined): string | null {
  if (!at) return null;
  const when = new Date(at);
  return Number.isNaN(when.getTime())
    ? null
    : `Last published ${when.toLocaleDateString("en-US", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })}`;
}

/**
 * Every Content Slot of this Store, and the state each one is in.
 *
 * This exists because a draft is otherwise silent. The frame only shows the
 * page it is on, so unpublished work on any other page would sit there
 * unmentioned until a merchant happened to walk back to it — and copy they
 * wrote six weeks ago and forgot is indistinguishable from copy they wrote
 * this morning unless something says when it last went live.
 *
 * Publishing and discarding are offered here as well as in the editing panel,
 * so a merchant clearing up what they left behind does not have to find the
 * page each draft belongs to first.
 */
function ContentRegions({
  slots,
  name,
  busy,
  onPublish,
  onDiscard,
}: {
  slots: ContentSlot[];
  name: (key: string) => string;
  busy: boolean;
  onPublish: (key: string) => void;
  onDiscard: (key: string) => void;
}) {
  // What is waiting on the merchant comes first; the rest keep a stable order.
  const ordered = [...slots].sort((a, b) => {
    const waiting = Number(b.draftValue != null) - Number(a.draftValue != null);
    return waiting || a.key.localeCompare(b.key);
  });
  const drafts = ordered.filter((slot) => slot.draftValue != null).length;

  return (
    <div className="rounded-lg border bg-background p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">Page regions across your Store</h2>
        <p className="text-xs text-muted-foreground">
          {drafts === 0
            ? "Nothing unpublished"
            : `${drafts} ${drafts === 1 ? "region has" : "regions have"} an unpublished draft`}
        </p>
      </div>
      <ul className="mt-3 space-y-2">
        {ordered.map((slot) => {
          const waiting = slot.draftValue != null;
          const published = publishedOn(slot.lastPublishedAt);
          return (
            <li
              key={slot.key}
              className="flex flex-wrap items-start justify-between gap-3 rounded-md border px-3 py-2"
            >
              <div className="min-w-0">
                <span className="block text-sm font-medium">
                  {name(slot.key)}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {(waiting ? slot.draftValue : slot.value)?.trim() || "Empty"}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {waiting
                    ? slot.value
                      ? "Draft — shoppers still see the published copy"
                      : "Draft — nothing is showing to shoppers yet"
                    : slot.value
                      ? "Published"
                      : "Nothing published yet"}
                  {published && ` · ${published}`}
                </span>
              </div>
              {waiting && (
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    disabled={busy}
                    onClick={() => onDiscard(slot.key)}
                  >
                    Discard
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy}
                    onClick={() => onPublish(slot.key)}
                  >
                    Publish
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Every region this page carries, including the ones it does not display. SEO
 * copy belongs to the page it describes but has no text on it to click, and a
 * Content Slot the merchant has never filled in shows nothing at all — a list
 * is the only honest way to offer either from the page they belong to.
 */
function PageFields({
  regions,
  slots,
  busy,
  onOpen,
}: {
  regions: Region[];
  slots: Map<string, ContentSlot>;
  busy: boolean;
  onOpen: (target: string) => void;
}) {
  return (
    <div className="rounded-lg border bg-background p-4">
      <h2 className="text-sm font-medium">Editable on this page</h2>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {regions.map((region) => {
          const target = parseTarget(region.target);
          const spec = target && regionSpec(target, region.slot);
          if (!target || !spec) return null;
          const slot =
            target.kind === "slot" ? slots.get(target.key) : undefined;
          const shown = slot?.draftValue ?? slot?.value ?? region.value;
          const published = publishedOn(slot?.lastPublishedAt);
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
                  {shown.trim() || "Empty"}
                </span>
                {/* A region whose copy is not what shoppers are reading says
                    so here, where the merchant is choosing what to work on. */}
                {target.kind === "slot" && (
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {slot?.draftValue != null
                      ? "Draft — not published yet"
                      : slot?.value
                        ? "Published"
                        : "Nothing published yet"}
                    {published && ` · ${published}`}
                  </span>
                )}
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
