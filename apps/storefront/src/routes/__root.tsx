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
import { ConsentBanner } from "~/features/measurement/components/consent-banner";
import { measurementPermitted } from "~/features/measurement/consent";
import { useMeasurementCapture } from "~/features/measurement/hooks";
import { measurementQueryOptions } from "~/features/measurement/queries";
import { useInlineEdit } from "~/features/inline-edit/use-inline-edit";
import appCss from "~/styles/app.css?url";
import { seo } from "~/utils/seo";

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
}>()({
  // What this store measures, asked of the commerce API rather than configured
  // here, so that connecting an ad platform switches the pixel on and
  // disconnecting switches it off — neither being a deploy of this app. Loaded
  // rather than fetched from the component because the answer decides what goes
  // in the document's head, and because a visitor who declined should never
  // receive a tracking script at all.
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(measurementQueryOptions()),
  head: ({ loaderData }) => ({
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
      // The stylesheet that loads the configured typeface, when it needs one.
      // A stack of fonts already on the device does not.
      ...(storeConfig.typeface.url
        ? [{ rel: "stylesheet", href: storeConfig.typeface.url }]
        : []),
    ],
    // The drop-in behavioral tracker. `defer` keeps it off the critical path,
    // and it boots before hydration, so the visitor and session ids it mints
    // are the ones attribution capture then declares to the commerce API.
    //
    // Left out entirely while a store that asks for consent has not been given
    // it — a script that is not in the document cannot measure anyone, which is
    // a stronger promise than one that is there and asked not to. Accepting
    // injects it without waiting for the next page.
    // Unknown settings count as not permitted, never as permitted: the effect
    // adds the script as soon as the answer arrives, so erring this way costs
    // a moment of events, and erring the other way ships a tracking script to
    // someone who was never asked.
    scripts:
      trackingScript &&
      loaderData !== undefined &&
      measurementPermitted(loaderData.consentRequired, loaderData.consent)
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
  // Loads the pixel and mints the ad platform's browser identifiers, but only
  // where the store has a connection and the visitor has not said no.
  useMeasurementCapture();
  useInlineEdit();

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
        <ConsentBanner />
      </CartUiProvider>
    </RootDocument>
  );
}

/**
 * The typeface knob, applied as the custom property the theme's `--font-sans`
 * reads. It is set here rather than in `app.css` so that changing the font is
 * an edit to `store.config.ts` and nothing else; colors and roundness stay
 * theme tokens.
 */
const brandStyle = {
  "--typeface": storeConfig.typeface.family,
} as React.CSSProperties;

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" style={brandStyle}>
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
