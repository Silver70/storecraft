/// <reference types="vite/client" />
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
} from "@tanstack/react-router";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import * as React from "react";
import type { QueryClient } from "@tanstack/react-query";
import { DefaultCatchBoundary } from "~/components/DefaultCatchBoundary";
import { NotFound } from "~/components/NotFound";
import { Header } from "~/components/layout/header";
import { Footer } from "~/components/layout/footer";
import { storeConfig } from "~/config/store.config";
import { CartUiProvider } from "~/features/cart/cart-ui";
import { trackingScript } from "~/features/attribution/config";
import { useAttributionCapture } from "~/features/attribution/hooks";
import appCss from "~/styles/app.css?url";
import { seo } from "~/utils/seo";

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
}>()({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      ...seo({
        title: storeConfig.name,
        description: storeConfig.description,
      }),
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      {
        rel: "apple-touch-icon",
        sizes: "180x180",
        href: "/apple-touch-icon.png",
      },
      {
        rel: "icon",
        type: "image/png",
        sizes: "32x32",
        href: "/favicon-32x32.png",
      },
      {
        rel: "icon",
        type: "image/png",
        sizes: "16x16",
        href: "/favicon-16x16.png",
      },
      { rel: "manifest", href: "/site.webmanifest", color: "#fffff" },
      { rel: "icon", href: "/favicon.ico" },
    ],
    // The drop-in behavioral tracker. `defer` keeps it off the critical path,
    // and it boots before hydration, so the visitor and session ids it mints
    // are the ones attribution capture then declares to the commerce API.
    scripts: trackingScript
      ? [
          {
            src: trackingScript.src,
            defer: true,
            "data-key": trackingScript.key,
            "data-autocapture": trackingScript.autocapture,
          },
        ]
      : [],
  }),
  errorComponent: (props) => {
    return (
      <RootDocument>
        <DefaultCatchBoundary {...props} />
      </RootDocument>
    );
  },
  notFoundComponent: () => <NotFound />,
  component: RootComponent,
});

function RootComponent() {
  // Reads UTM tags and the referrer on landing and on every client-side
  // navigation. Local, synchronous, and run from an effect — nothing here is
  // on the path between a click and what the shopper sees.
  useAttributionCapture();

  return (
    <RootDocument>
      {/* The drawer lives in the header and is opened by a confirmed add on
          the product page, so its open state is held above both. */}
      <CartUiProvider>
        <div className="flex min-h-svh flex-col">
          <Header />
          <main className="flex-1">
            <Outlet />
          </main>
          <Footer />
        </div>
      </CartUiProvider>
    </RootDocument>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <TanStackRouterDevtools position="bottom-right" />
        <ReactQueryDevtools buttonPosition="bottom-left" />
        <Scripts />
      </body>
    </html>
  );
}
