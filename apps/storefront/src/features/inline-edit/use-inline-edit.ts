import { useEffect, useState } from "react";
import { isSession, SESSION_PARAM } from "@repo/inline-edit-js/protocol";
import { getInlineEditConfig } from "./server";

/**
 * Whether this document was opened as an admin editing frame. Read once per
 * document, because a client-side navigation drops the session parameter from
 * the URL while the bridge it booted keeps running.
 */
let framedSession: boolean | null = null;
function detectSession(): boolean {
  if (framedSession === null) {
    const session = new URL(location.href).searchParams.get(SESSION_PARAM);
    framedSession = window.parent !== window && isSession(session);
  }
  return framedSession;
}

export function useInlineEdit() {
  useEffect(() => {
    const session = new URL(location.href).searchParams.get(SESSION_PARAM);
    if (!detectSession() || !isSession(session)) return;
    let cancelled = false;
    void getInlineEditConfig()
      .then((config) => {
        if (
          cancelled ||
          !config ||
          document.querySelector("script[data-commerce-inline-edit]")
        )
          return;
        const script = document.createElement("script");
        script.src = config.scriptUrl;
        script.dataset.commerceInlineEdit = "";
        script.dataset.adminOrigin = config.adminOrigin;
        script.dataset.session = session;
        document.body.append(script);
      })
      .catch(() => {
        // A missing editor asset/configuration must never break the Store.
        // The admin reports a connection timeout with setup guidance.
      });
    return () => {
      cancelled = true;
    };
  }, []);
}

/**
 * Lets a page declare a region that a shopper's copy of it has no reason to
 * carry — SEO copy, or a description that is currently empty. It never gates
 * editing UI: the admin owns every piece of that, and the Store renders none.
 */
export function useInlineEditSession(): boolean {
  const [editing, setEditing] = useState(false);
  useEffect(() => setEditing(detectSession()), []);
  return editing;
}
