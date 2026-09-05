import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Unit tests only. This deliberately does not extend `vite.config.ts`: none of
 * the app plugins (TanStack Start, React, Tailwind) are needed to exercise pure
 * functions, and loading them would drag a server runtime into a test run that
 * has no DOM, renders no components and opens no browser.
 */
export default defineConfig({
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.spec.ts"],
  },
});
