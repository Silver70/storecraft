import {
  isSession,
  fieldSpec,
  parseOrigin,
  parseTarget,
  parseAdminMessage,
  message,
  MAX_REGIONS,
  MAX_REGIONS_TEXT,
  SESSION_PARAM,
  type FrameCommand,
  type Rect,
  type Region,
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
  const page = crypto.randomUUID();
  const selector = "[data-commerce-edit]";
  const send = (command: FrameCommand) =>
    window.parent.postMessage(message(session, page, command), origin);
  let hovered: string | null = null;
  let scheduled = 0;
  let lastRegions = "";

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

  function fits(element: Element, target: string): boolean {
    const parsed = parseTarget(target);
    return (
      !!parsed &&
      (element.textContent?.length ?? 0) <= fieldSpec(parsed).maxLength
    );
  }

  function announce(force = false) {
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
      regions.push({ target, value, rect });
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
      const target = targetAt(event);
      if (!target) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      announce(true);
      send({ type: "select", target });
    },
    true,
  );
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
