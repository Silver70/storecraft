/** Version 1 is deliberately limited to product.name. No command can save. */
export const CHANNEL = "commerce-inline-edit";
export const VERSION = 1;
export const SESSION_PARAM = "__commerce_edit";
export const MAX_PAYLOAD_BYTES = 64 * 1024;
export const MAX_REGIONS = 100;
export const MAX_NAME_LENGTH = 255;

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

export type Target = { kind: "product"; id: string; field: "name" };
export function parseTarget(descriptor: unknown): Target | null {
  if (typeof descriptor !== "string" || descriptor.length > 64) return null;
  const parts = descriptor.split(":");
  if (
    parts.length !== 3 ||
    parts[0] !== "product" ||
    !UUID.test(parts[1]!) ||
    parts[2] !== "name"
  )
    return null;
  return { kind: "product", id: parts[1]!, field: "name" };
}
export function describeTarget(target: Target): string {
  return `${target.kind}:${target.id}:${target.field}`;
}

export type Rect = { x: number; y: number; width: number; height: number };
export type Region = { target: string; value: string; rect: Rect };
export type FrameCommand =
  | { type: "regions"; regions: Region[] }
  | { type: "hover"; target: string | null }
  | { type: "select"; target: string };
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

function validRect(value: unknown): value is Rect {
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
function validText(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_NAME_LENGTH;
}
function validRegion(value: unknown): value is Region {
  return (
    record(value) &&
    keysAre(value, ["target", "value", "rect"]) &&
    parseTarget(value.target) !== null &&
    validText(value.value) &&
    validRect(value.rect)
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
    if (data.type === "preview")
      valid =
        keysAre(data, [...base, "target", "value"]) &&
        !!parseTarget(data.target) &&
        validText(data.value);
  } else {
    if (data.type === "hover")
      valid =
        keysAre(data, [...base, "target"]) &&
        (data.target === null || !!parseTarget(data.target));
    if (data.type === "select")
      valid = keysAre(data, [...base, "target"]) && !!parseTarget(data.target);
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
