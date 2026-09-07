import {
  isSession,
  parseOrigin,
  parseSlotDeclaration,
  parseTarget,
  parseAdminMessage,
  message,
  targetLimit,
  MAX_REGIONS,
  MAX_REGIONS_TEXT,
  SESSION_PARAM,
  SLOT_SPECS,
  type FrameCommand,
  type Rect,
  type Region,
  type SlotDeclaration,
} from "./protocol";

// No credential, persistence, editing UI, or boot-time listeners for shoppers.
function boot() {
  const script = document.currentScript as HTMLScriptElement | null;
  const session = script?.dataset.session;
  const origin = parseOrigin(script?.dataset.adminOrigin);
  if (
    window.parent === window ||
    !origin ||
    !isSession(session) ||
    new URL(location.href).searchParams.get(SESSION_PARAM) !== session
  )
    return;

  const peer = { origin, source: window.parent, session };
  const selector = "[data-commerce-edit]";
  // A page is a rendering of one address. A navigation mints a new one, so a
  // command aimed at the page the merchant has left lands on nothing.
  let page = crypto.randomUUID();
  let here = "";
  const send = (command: FrameCommand) =>
    window.parent.postMessage(message(session, page, command), origin);
  let hovered: string | null = null;
  let scheduled = 0;
  let lastRegions = "";

  /**
   * Announces the address the frame is showing, on arrival and on every move.
   * The admin decides whether that address is still the merchant's Store; the
   * frame only reports where it went.
   */
  function moved(): boolean {
    if (location.href === here) return false;
    here = location.href;
    page = crypto.randomUUID();
    hovered = null;
    lastRegions = "";
    send({ type: "navigate", url: here });
    return true;
  }

  function elements(): Map<string, HTMLElement[]> {
    const found = new Map<string, HTMLElement[]>();
    document.querySelectorAll<HTMLElement>(selector).forEach((element) => {
      const target = element.dataset.commerceEdit!;
      if (!parseTarget(target)) return;
      if (!found.has(target) && found.size >= MAX_REGIONS) return;
      found.set(target, [...(found.get(target) ?? []), element]);
    });
    return found;
  }

  /**
   * What the page says about a Content Slot it renders. A Slot marked without
   * a usable type and label is not announced at all: the admin would have no
   * honest way to offer it, and guessing a shape is how a Slot ends up holding
   * something the storefront cannot render.
   */
  function declaration(element: HTMLElement): SlotDeclaration | null {
    return parseSlotDeclaration({
      type: element.dataset.commerceSlotType,
      label: element.dataset.commerceSlotLabel,
    });
  }

  function fits(element: Element, target: string): boolean {
    const parsed = parseTarget(target);
    if (!parsed) return false;
    const slot =
      parsed.kind === "slot" && element instanceof HTMLElement
        ? declaration(element)
        : null;
    if (parsed.kind === "slot" && !slot) return false;
    const limit = slot ? SLOT_SPECS[slot.type].maxLength : targetLimit(parsed);
    return (element.textContent?.length ?? 0) <= limit;
  }

  function announce(force = false) {
    if (moved()) force = true;
    const regions: Region[] = [];
    let budget = MAX_REGIONS_TEXT;
    for (const [target, matches] of elements()) {
      // A region the page declares but does not display — SEO copy, say — is
      // announced without geometry rather than withheld, so the admin can
      // still offer it. Geometry comes from the first occurrence that renders.
      const shown = matches.find((node) => node.getClientRects().length > 0);
      const element = shown ?? matches[0]!;
      const value = element.textContent ?? "";
      if (!fits(element, target)) continue;
      if ((budget -= value.length) < 0) break;
      let rect: Rect | null = null;
      if (shown) {
        const box = shown.getBoundingClientRect();
        rect = { x: box.x, y: box.y, width: box.width, height: box.height };
      }
      const slot = target.startsWith("slot:") ? declaration(element) : null;
      regions.push({ target, value, rect, slot });
    }
    const snapshot = JSON.stringify(regions);
    if (force || snapshot !== lastRegions) {
      lastRegions = snapshot;
      send({ type: "regions", regions });
    }
  }

  function schedule() {
    if (!scheduled)
      scheduled = requestAnimationFrame(() => {
        scheduled = 0;
        announce();
      });
  }

  function targetAt(event: Event): string | null {
    const element =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>(selector)
        : null;
    const target = element?.dataset.commerceEdit;
    return element && target && fits(element, target) ? target : null;
  }

  window.addEventListener("message", (event) => {
    const parsed = parseAdminMessage(event, peer);
    if (!parsed.ok || parsed.command.page !== page) return;
    const command = parsed.command;
    if (command.type === "discover") {
      announce(true);
      return;
    }
    // Resolve identity on every command: never retain a node from an old render.
    const matches = elements().get(command.target) ?? [];
    if (command.type === "preview") {
      matches.forEach((element) => {
        if (element.textContent !== command.value)
          element.textContent = command.value;
      });
      announce();
    } else {
      matches
        .find((node) => node.getClientRects().length > 0)
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
      announce(true);
    }
  });
  document.addEventListener("pointerover", (event) => {
    const target = targetAt(event);
    if (target !== hovered) {
      hovered = target;
      announce();
      send({ type: "hover", target });
    }
  });
  document.addEventListener("pointerleave", () => {
    hovered = null;
    send({ type: "hover", target: null });
  });
  document.addEventListener(
    "click",
    (event) => {
      markLink(event);
      const target = targetAt(event);
      if (!target) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      announce(true);
      send({ type: "select", target });
    },
    true,
  );
  /**
   * Keeps the editing marker on the address a link leads to, so a link that
   * loads a whole new document — which, on a storefront that is not a
   * single-page app, is every link — lands in the same editing session. A
   * storefront whose router handles the click itself navigates in place and
   * never reads the rewritten address, so this costs it nothing.
   */
  function markLink(event: MouseEvent) {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const anchor =
      event.target instanceof Element
        ? event.target.closest<HTMLAnchorElement>("a[href]")
        : null;
    if (
      !anchor ||
      anchor.hasAttribute("download") ||
      (anchor.target && anchor.target !== "_self")
    )
      return;
    try {
      const next = new URL(anchor.href, location.href);
      if (
        next.origin !== location.origin ||
        next.searchParams.get(SESSION_PARAM) === peer.session
      )
        return;
      next.searchParams.set(SESSION_PARAM, peer.session);
      anchor.href = next.href;
    } catch {
      // Not an address this bridge can rewrite; leave the link alone.
    }
  }
  document.addEventListener("pointerdown", markLink, true);
  // A navigation with nothing else to show for it — a hash link, the back
  // button — still has to be announced, and no mutation reports it.
  setInterval(() => {
    if (moved()) announce(true);
  }, 250);
  document.addEventListener("scroll", schedule, true);
  window.addEventListener("resize", schedule);
  // Re-announce after hydration, text wrapping, images loading and SPA renders.
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
  });
  const resizeObserver = new ResizeObserver(schedule);
  resizeObserver.observe(document.documentElement);
  document.addEventListener("load", schedule, true);
  announce(true);
}

boot();
