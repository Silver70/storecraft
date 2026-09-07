/**
 * Version 4 covers the copy fields of a product and a category, the Content
 * Slots a storefront declares, and the frame announcing where it has navigated
 * to. No command in the protocol saves anything: the frame is a rendering
 * surface and an event source, and every write happens in the admin, on the
 * admin's origin.
 */
export const CHANNEL = "commerce-inline-edit";
export const VERSION = 4;
export const SESSION_PARAM = "__commerce_edit";
export const MAX_PAYLOAD_BYTES = 64 * 1024;
export const MAX_REGIONS = 100;
/** Total announced text per message, so a page of long copy still fits. */
export const MAX_REGIONS_TEXT = 32 * 1024;
export const MAX_URL_LENGTH = 2048;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isSession(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function parseOrigin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) && url.origin === value
      ? value
      : null;
  } catch {
    return null;
  }
}

/** An absolute http(s) address, bounded, carrying no credentials. */
export function parseUrl(value: unknown): URL | null {
  if (typeof value !== "string" || value.length > MAX_URL_LENGTH) return null;
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password
      ? url
      : null;
  } catch {
    return null;
  }
}

/** Where the frame is, said in terms of the Store the editor opened. */
export type StoreLocation = { href: string; path: string };
/**
 * Resolves an announced address against the Store the editor opened. Another
 * origin, or a path above the Store's root, is not a page of this Store, and
 * `null` is how the editor stops believing it is still editing one. The
 * session marker is dropped, so the address handed to a merchant opening the
 * page in a real tab is the address a shopper would use.
 */
export function locateInStore(
  value: unknown,
  store: unknown,
): StoreLocation | null {
  const url = parseUrl(value);
  const base = parseUrl(store);
  if (!url || !base || url.origin !== base.origin) return null;
  const root = base.pathname.replace(/\/+$/, "");
  if (root && url.pathname !== root && !url.pathname.startsWith(`${root}/`))
    return null;
  url.searchParams.delete(SESSION_PARAM);
  const path = `${url.pathname.slice(root.length) || "/"}${url.search}${url.hash}`;
  return { href: url.href, path };
}

export type EntityKind = "product" | "category";
/**
 * A field a merchant may edit through the protocol, with what the admin needs
 * in order to offer it: what to call it, how long it may be, and whether it is
 * a paragraph. The limits are the editor's, not the database's — those columns
 * are unbounded text, and an editing channel that accepts an unbounded paste
 * is a broken page waiting to happen.
 */
export type FieldSpec = {
  label: string;
  maxLength: number;
  multiline: boolean;
};
export const FIELDS: Record<EntityKind, Record<string, FieldSpec>> = {
  product: {
    name: { label: "Product name", maxLength: 255, multiline: false },
    description: {
      label: "Product description",
      maxLength: 5000,
      multiline: true,
    },
    seoTitle: { label: "SEO title", maxLength: 255, multiline: false },
    seoDescription: {
      label: "SEO description",
      maxLength: 500,
      multiline: true,
    },
  },
  category: {
    name: { label: "Category name", maxLength: 255, multiline: false },
    description: {
      label: "Category description",
      maxLength: 2000,
      multiline: true,
    },
  },
};

/**
 * The shape of a Content Slot's content. A closed set, because a Slot the
 * storefront cannot render is worse than one the merchant cannot fill: the
 * type is what lets the admin offer the right editor and bound the paste.
 * Adding a shape is a change to this table and to the storefronts that render
 * it, which is why the protocol carries a version.
 */
export type SlotType = "heading" | "text";
export const SLOT_SPECS: Record<
  SlotType,
  { maxLength: number; multiline: boolean }
> = {
  heading: { maxLength: 120, multiline: false },
  text: { maxLength: 2000, multiline: true },
};
export const MAX_SLOT_KEY = 64;
export const MAX_SLOT_LABEL = 60;
/** The widest any Slot value may be, for bounding a value of unstated type. */
export const MAX_SLOT_VALUE = Math.max(
  ...Object.values(SLOT_SPECS).map((spec) => spec.maxLength),
);
/** Dotted lowercase segments — `homepage.hero`. A name, not a path. */
const SLOT_KEY = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
export function parseSlotKey(value: unknown): string | null {
  return typeof value === "string" &&
    value.length <= MAX_SLOT_KEY &&
    SLOT_KEY.test(value)
    ? value
    : null;
}

/**
 * What a storefront says about a Slot it renders: the shape of its content and
 * what to call the region in front of the merchant. The storefront declares
 * it; the admin never invents one, so a merchant is only ever offered regions
 * that exist on the page they are looking at.
 */
export type SlotDeclaration = { type: SlotType; label: string };
export function parseSlotDeclaration(value: unknown): SlotDeclaration | null {
  if (!record(value) || !keysAre(value, ["type", "label"])) return null;
  const { type, label } = value;
  if (typeof type !== "string" || !Object.hasOwnProperty.call(SLOT_SPECS, type))
    return null;
  if (
    typeof label !== "string" ||
    !label.trim() ||
    label.length > MAX_SLOT_LABEL
  )
    return null;
  return { type: type as SlotType, label };
}

export type EntityTarget =
  | {
      kind: "product";
      id: string;
      field: "name" | "description" | "seoTitle" | "seoDescription";
    }
  | { kind: "category"; id: string; field: "name" | "description" };
/** A Slot is addressed by its key alone: it is a region, not a row. */
export type SlotTarget = { kind: "slot"; key: string };
export type Target = EntityTarget | SlotTarget;

export function fieldSpec(target: EntityTarget): FieldSpec {
  return FIELDS[target.kind][target.field]!;
}
export function slotSpec(declaration: SlotDeclaration): FieldSpec {
  return { label: declaration.label, ...SLOT_SPECS[declaration.type] };
}
/**
 * How to edit a region: for an entity field the protocol already knows, and
 * for a Slot whatever the storefront declared. A Slot with no declaration has
 * no spec — the admin offers nothing rather than guessing a shape.
 */
export function regionSpec(
  target: Target,
  slot: SlotDeclaration | null,
): FieldSpec | null {
  return target.kind === "slot" ? slot && slotSpec(slot) : fieldSpec(target);
}
/** The most a value for this target may ever be, before its type is known. */
export function targetLimit(target: Target): number {
  return target.kind === "slot" ? MAX_SLOT_VALUE : fieldSpec(target).maxLength;
}

/**
 * `<kind>:<uuid>:<field>` for an entity field, `slot:<key>` for a Content
 * Slot — identity, never a position on the page.
 */
export function parseTarget(descriptor: unknown): Target | null {
  if (typeof descriptor !== "string" || descriptor.length > 128) return null;
  const parts = descriptor.split(":");
  if (parts[0] === "slot") {
    const key = parts.length === 2 ? parseSlotKey(parts[1]) : null;
    return key ? { kind: "slot", key } : null;
  }
  if (parts.length !== 3) return null;
  const [kind, id, field] = parts as [string, string, string];
  if (!Object.hasOwnProperty.call(FIELDS, kind) || !UUID.test(id)) return null;
  if (!Object.hasOwnProperty.call(FIELDS[kind as EntityKind]!, field))
    return null;
  return { kind, id, field } as Target;
}
export function describeTarget(target: Target): string {
  return target.kind === "slot"
    ? `slot:${target.key}`
    : `${target.kind}:${target.id}:${target.field}`;
}

/**
 * Copy is text. Line endings are normalised, control characters no storefront
 * can render are dropped, and a single-line field never acquires a newline
 * from a paste. Markup is left as the literal characters it is: a preview is
 * applied with `textContent`, so it can only ever be read, never parsed.
 */
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
export function sanitizeText(value: string, spec: FieldSpec): string {
  const text = value.replace(/\r\n?/g, "\n").replace(CONTROL, "");
  return spec.multiline ? text : text.replace(/[\n\t]+/g, " ");
}

export type PasteResult =
  | { ok: true; value: string; caret: number }
  | { ok: false; reason: "oversized" };
/**
 * Refuses an oversized paste outright rather than truncating it, so a merchant
 * is told what happened instead of finding a sentence missing later.
 */
export function applyPaste(
  current: string,
  start: number,
  end: number,
  pasted: string,
  spec: FieldSpec,
): PasteResult {
  const text = sanitizeText(pasted, spec);
  const from = Math.max(0, Math.min(start, current.length));
  const to = Math.max(from, Math.min(end, current.length));
  const value = current.slice(0, from) + text + current.slice(to);
  if (value.length > spec.maxLength) return { ok: false, reason: "oversized" };
  return { ok: true, value, caret: from + text.length };
}

export type Rect = { x: number; y: number; width: number; height: number };
/**
 * `rect` is null for a region the page declares but does not display. `slot`
 * carries the storefront's declaration for a Content Slot and is null for an
 * entity field, whose shape the protocol already knows.
 */
export type Region = {
  target: string;
  value: string;
  rect: Rect | null;
  slot: SlotDeclaration | null;
};
export type FrameCommand =
  | { type: "regions"; regions: Region[] }
  | { type: "hover"; target: string | null }
  | { type: "select"; target: string }
  | { type: "navigate"; url: string };
export type AdminCommand =
  | { type: "discover" }
  | { type: "preview"; target: string; value: string }
  | { type: "focus"; target: string };
export type Envelope<T> = T & {
  channel: typeof CHANNEL;
  version: typeof VERSION;
  session: string;
  page: string;
};
export function message<T extends AdminCommand | FrameCommand>(
  session: string,
  page: string,
  command: T,
): Envelope<T> {
  return { channel: CHANNEL, version: VERSION, session, page, ...command };
}

type Refusal =
  | "origin"
  | "source"
  | "channel"
  | "session"
  | "version"
  | "payload"
  | "oversized";
export type ParseResult<T> =
  | { ok: true; command: Envelope<T> }
  | { ok: false; reason: Refusal };
type MessageInput = { origin: string; source: unknown; data: unknown };
type Peer = { origin: string; source: unknown; session: string };
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const keysAre = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwnProperty.call(value, key));

// Bound work before serializing: reject deep/cyclic structures, large strings,
// and excessive collections without allocating another unbounded payload.
function withinBudget(value: unknown): boolean {
  let remaining = MAX_PAYLOAD_BYTES;
  function visit(item: unknown, depth: number): boolean {
    if (depth > 8 || --remaining < 0) return false;
    if (typeof item === "string") return (remaining -= item.length) >= 0;
    if (item === null || typeof item === "boolean" || typeof item === "number")
      return true;
    if (!record(item) && !Array.isArray(item)) return false;
    const keys = Object.keys(item);
    if (keys.length > 1000) return false;
    return keys.every(
      (key) =>
        visit(key, depth + 1) &&
        visit((item as Record<string, unknown>)[key], depth + 1),
    );
  }
  try {
    return (
      visit(value, 0) &&
      new TextEncoder().encode(JSON.stringify(value)).length <=
        MAX_PAYLOAD_BYTES
    );
  } catch {
    return false;
  }
}

function validRect(value: unknown): value is Rect | null {
  if (value === null) return true;
  if (!record(value) || !keysAre(value, ["x", "y", "width", "height"]))
    return false;
  return (
    Object.values(value).every(
      (n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 1e6,
    ) &&
    (value.width as number) >= 0 &&
    (value.height as number) >= 0
  );
}
/** Every value is bounded by the field it belongs to, never by one limit. */
function validText(value: unknown, limit: number): value is string {
  return typeof value === "string" && value.length <= limit;
}
function validRegion(value: unknown): value is Region {
  if (!record(value) || !keysAre(value, ["target", "value", "rect", "slot"]))
    return false;
  const target = parseTarget(value.target);
  if (!target || !validRect(value.rect)) return false;
  // A Slot arrives with the declaration that says how to edit it; an entity
  // field carries none. Either way the announced value is bounded by the shape
  // the region actually has, never by the widest shape in the protocol.
  const slot = target.kind === "slot" ? parseSlotDeclaration(value.slot) : null;
  if (target.kind === "slot" ? !slot : value.slot !== null) return false;
  return validText(
    value.value,
    slot ? SLOT_SPECS[slot.type].maxLength : targetLimit(target),
  );
}

function parse<T extends AdminCommand | FrameCommand>(
  event: MessageInput,
  peer: Peer,
  direction: "admin" | "frame",
): ParseResult<T> {
  if (!parseOrigin(peer.origin) || event.origin !== peer.origin)
    return { ok: false, reason: "origin" };
  if (!peer.source || event.source !== peer.source)
    return { ok: false, reason: "source" };
  const data = event.data;
  if (!record(data) || data.channel !== CHANNEL)
    return { ok: false, reason: "channel" };
  if (!isSession(peer.session) || data.session !== peer.session)
    return { ok: false, reason: "session" };
  if (data.version !== VERSION) return { ok: false, reason: "version" };
  if (!withinBudget(data)) return { ok: false, reason: "oversized" };
  if (!isSession(data.page)) return { ok: false, reason: "payload" };
  const base = ["channel", "version", "session", "page", "type"];
  let valid = false;
  if (direction === "admin") {
    if (data.type === "discover") valid = keysAre(data, base);
    if (data.type === "focus")
      valid = keysAre(data, [...base, "target"]) && !!parseTarget(data.target);
    if (data.type === "preview") {
      const target = parseTarget(data.target);
      valid =
        keysAre(data, [...base, "target", "value"]) &&
        target !== null &&
        validText(data.value, targetLimit(target));
    }
  } else {
    if (data.type === "hover")
      valid =
        keysAre(data, [...base, "target"]) &&
        (data.target === null || !!parseTarget(data.target));
    if (data.type === "select")
      valid = keysAre(data, [...base, "target"]) && !!parseTarget(data.target);
    // Whether that address is still the merchant's Store is the admin's
    // question, asked with `locateInStore` against the Store it opened.
    if (data.type === "navigate")
      valid = keysAre(data, [...base, "url"]) && !!parseUrl(data.url);
    if (data.type === "regions") {
      valid =
        keysAre(data, [...base, "regions"]) &&
        Array.isArray(data.regions) &&
        data.regions.length <= MAX_REGIONS &&
        data.regions.every(validRegion) &&
        new Set(data.regions.map((region: Region) => region.target)).size ===
          data.regions.length;
    }
  }
  return valid
    ? { ok: true, command: data as unknown as Envelope<T> }
    : { ok: false, reason: "payload" };
}

export const parseAdminMessage = (
  event: MessageInput,
  peer: Peer,
): ParseResult<AdminCommand> => parse(event, peer, "admin");
export const parseFrameMessage = (
  event: MessageInput,
  peer: Peer,
): ParseResult<FrameCommand> => parse(event, peer, "frame");
