import { parseOrigin } from "@repo/inline-edit-js/protocol";
import { createServerFn } from "@tanstack/react-start";

/** Public addresses only. The commerce API key never enters the bridge. */
export const getInlineEditConfig = createServerFn({ method: "GET" }).handler(() => {
    const adminOrigin = parseOrigin(
        process.env.ADMIN_ORIGIN ?? (import.meta.env.DEV ? "http://localhost:3000" : undefined),
    );
    const apiUrl = process.env.COMMERCE_API_URL;
    if (!adminOrigin || !apiUrl) return null;
    const scriptUrl = new URL("/ie.js", new URL(apiUrl).origin);
    if (!/^https?:$/.test(scriptUrl.protocol)) return null;
    return { adminOrigin, scriptUrl: scriptUrl.href };
});
