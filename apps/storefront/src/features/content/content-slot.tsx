import type { ElementType } from "react";
import { useQuery } from "@tanstack/react-query";
import { contentSlots, type SlotKey } from "~/config/content-slots";
import { useInlineEditSession } from "~/features/inline-edit/use-inline-edit";
import { cn } from "~/lib/utils";
import { contentSlotsQueryOptions } from "./queries";

/**
 * Renders a Content Slot's published copy, and marks the region so the admin's
 * editor can offer it.
 *
 * Two rules, both of them deliberate:
 *
 * A Slot with no published value renders **nothing** on the live Store — not
 * placeholder text, not a fallback headline. An unconfigured Store shows
 * shoppers no scaffolding, and a region that is empty is empty.
 *
 * In an editing session it renders anyway, empty, marked out with the region's
 * own label so it can be found and filled rather than only stumbled on. That
 * is the only difference between the two, and it costs a shopper nothing:
 * outside a session this component never even asks whether one is running.
 *
 * What it renders is always the published value. The merchant's draft is
 * pushed into the frame by the admin as a live preview; nothing here fetches
 * one, and there is no API that would return one.
 */
export function ContentSlot({
  slotKey,
  as: Component = "div",
  className,
}: {
  slotKey: SlotKey;
  /** The element the region renders as — a hero headline is an `h1`. */
  as?: ElementType;
  className?: string;
}) {
  const declaration = contentSlots[slotKey];
  const { data } = useQuery(contentSlotsQueryOptions());
  const editing = useInlineEditSession();
  const value = data?.find((slot) => slot.key === slotKey)?.value ?? "";

  if (!value && !editing) return null;

  return (
    <Component
      data-commerce-edit={`slot:${slotKey}`}
      data-commerce-slot-type={declaration.type}
      data-commerce-slot-label={declaration.label}
      // An unfilled region is outlined and named in the editor, because the
      // only other way to fill a region that shows nothing is to already know
      // it is there. The rules behind this class apply only while the region
      // is empty, so a previewed draft replaces the placeholder rather than
      // sitting under it, and the label they draw comes from the attribute
      // above — generated content is not part of `textContent`, so what the
      // editor is told this region holds is still the nothing it holds.
      className={cn(className, editing && "commerce-empty-region")}
    >
      {value}
    </Component>
  );
}
