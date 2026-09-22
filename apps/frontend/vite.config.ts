import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { defineConfig } from 'vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  server: {
    port: 3000,
  },
  resolve: {
    tsconfigPaths: true,
  },
  optimizeDeps: {
    // eventemitter3 v5 (pulled in by recharts) ships an ESM wrapper around a
    // CJS index.js with no default export. Force-prebundle it so Vite flattens
    // it into valid ESM; otherwise the raw CJS reaches the browser, throws
    // "does not provide an export named 'default'", and breaks hydration.
    include: ['eventemitter3'],
  },
  ssr: {
    // The @visx/* 4.0.1-alpha builds (pulled in by the bklit chart components)
    // ship ESM entry points with extensionless relative imports — './x' rather
    // than './x.js'. Node's ESM resolver rejects those outright, so letting it
    // import them natively throws ERR_MODULE_NOT_FOUND during SSR and TanStack
    // Start silently falls back to client rendering for the whole route.
    // Bundling them through Vite instead lets Vite's resolver fill in the
    // extensions. Drop this once visx 4.0.1 ships a fixed stable build.
    noExternal: [/^@visx\//],
  },
  plugins: [tailwindcss(), tanstackStart(), viteReact()],
})
