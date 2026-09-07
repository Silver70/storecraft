/**
 * ◄ TEMPLATE KNOB — the Content Slots this storefront renders.
 *
 * A Slot is a named region the storefront renders at a stable key, holding
 * copy the merchant edits in the admin's editor rather than in this file. The
 * storefront declares which Slots exist — key, content type, and what to call
 * the region in front of the merchant — and the editor offers exactly those.
 *
 * That is what keeps this a set of named regions rather than a page builder:
 * the merchant fills in the regions a storefront chose to render, and cannot
 * invent new ones from the editor.
 *
 * To add a Slot, add an entry here and render it with `<ContentSlot>`. To
 * remove one, delete both — an unrendered key is a Slot nobody can find.
 */
import type { SlotDeclaration } from "@repo/inline-edit-js/protocol";

export const contentSlots = {
  /** The headline above the fold on the homepage. */
  "homepage.hero": { type: "heading", label: "Homepage headline" },
} as const satisfies Record<string, SlotDeclaration>;

export type SlotKey = keyof typeof contentSlots;
