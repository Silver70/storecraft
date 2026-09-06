import { useEffect } from "react";
import { isSession, SESSION_PARAM } from "@repo/inline-edit-js/protocol";
import { getInlineEditConfig } from "./server";

export function useInlineEdit() {
  useEffect(() => {
    const session = new URL(location.href).searchParams.get(SESSION_PARAM);
    if (window.parent === window || !isSession(session)) return;
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
