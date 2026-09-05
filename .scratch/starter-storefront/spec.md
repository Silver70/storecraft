# Starter Storefront

Status: ready-for-agent

Stage 3 of the product roadmap — "storefront as a real starter". Prepares the
ground for ADR-0003 (Inline Editing via an iframe postMessage protocol) without
implementing any of it.

## Problem Statement

`apps/storefront` was built as an example and has been reclassified as the
Starter Storefront: the first-party, forkable storefront that is the reference
implementation of every public contract. It is not yet good enough to deserve
that name, in three specific ways.

**Adding to cart feels broken.** Quantity edits and removals patch the cached
cart optimistically and feel instant. Adding does not: the shopper clicks "Add
to cart", the button says "Adding…", and nothing else on the page moves until a
server function has round-tripped to the commerce API and back. On the one
interaction that matters most — the one the entire funnel narrows to — the
storefront is the slowest it ever is. The header badge does not move, the drawer
does not open, and on a slow connection the shopper clicks again.

**Four components fetch their own data.** The cart drawer reads the cart, and the
line item, the coupon field, and the add-to-cart button each reach for the cart
mutations directly. Every one of them is a component a forking merchant will
want to restyle, and each one currently comes welded to a data hook. An
integrator who wants a different add-to-cart button has to understand React
Query to write one. The reference implementation is teaching the wrong lesson,
and it is the exact coupling that Inline Editing will later have to work
against, because a component that owns its own fetching has no clean boundary to
mark editable regions on.

**Forking it does not actually work as documented.** The README opens with
`cp .env.example .env` and no such file exists in the repository. The store
config exposes an `accounts` feature toggle that nothing reads. The fork
checklist says to swap the logo, and there is no logo knob. A bad `currency` or
`locale` in the config fails somewhere inside `Intl` at render time rather than
at startup with a useful message. The template promises a five-minute rebrand
and delivers a scavenger hunt.

## Solution

Adding to cart becomes instant. The cached cart is patched the moment the
shopper clicks — the line appears, the badge moves, the drawer opens — and the
server's authoritative cart replaces the estimate when it arrives, exactly as
quantity edits already work.

The four coupled components become props-only. Pages own every hook call and
pass data and handlers down. The README states the convention, so a forking
merchant knows which layer is theirs to restyle and which layer is wiring.

The fork checklist becomes true. There is a real `.env.example`. The store
config is validated at startup and fails loudly with a message naming the field.
The knobs the README promises — logo, typeface — exist. The toggle that does
nothing is gone.

Nothing about the commerce API contract changes. This stage is entirely inside
`apps/storefront`.

## User Stories

### Adding to cart

1. As a Visitor, I want the cart to reflect my add immediately, so that the most important action on the site does not feel like the slowest.
2. As a Visitor, I want the header cart badge to increment the moment I click, so that I have proof the click registered.
3. As a Visitor, I want the cart drawer to open on a successful add, so that I can see what I added and keep shopping or check out.
4. As a Visitor, I want adding the same variant twice to increase that line's quantity rather than create a second identical line, so that my cart is not full of duplicates.
5. As a Visitor, I want my first add to work as fast as my second, so that not having a cart yet is not something I experience as a delay.
6. As a Visitor, I want the estimate to be replaced by the real cart when it arrives, so that discounts and repricing are always the server's answer and never a guess that sticks.
7. As a Visitor, I want a failed add to put the cart back exactly as it was, so that I never see an item I do not actually have.
8. As a Visitor, I want to be told when an add fails, so that a silent rollback does not read as the site ignoring me.
9. As a Visitor, I want an add that fails because the cart expired to recover on its own, so that a cart the server swept out from under me does not become a dead end.
10. As a Visitor, I want to click Add twice quickly and get two units, so that an impatient double-click is not swallowed or doubled into four.
11. As a Visitor, I want prices shown during the optimistic moment to be the ones I was just looking at, so that nothing appears to change price as I add it.
12. As a Visitor on a slow connection, I want the pending state to remain visible while the request is in flight, so that instant feedback is not mistaken for a completed purchase step.
13. As a merchant, I want the server to remain the source of truth for every money figure, so that an optimistic estimate can never become the number a shopper is charged.

### Restyling and forking the components

14. As a developer forking the Starter Storefront, I want the cart drawer, line item, coupon field, and add-to-cart button to take everything they render as props, so that I can restyle or replace any of them without understanding the data layer.
15. As a developer, I want every hook call to live in a page, so that there is one obvious place to look when I want to change what is fetched.
16. As a developer, I want the convention documented, so that I know which layer is mine to change and which is wiring I should leave alone.
17. As a developer, I want a replaced component to keep working without touching the pages, so that the props are a real contract rather than an accident of the current markup.
18. As a developer, I want the add-to-cart button to receive the display details of what it is adding, so that the optimistic line can render without the button fetching anything.
19. As a developer, I want the cart drawer's open state to be controllable from outside it, so that an add elsewhere on the page can open it.
20. As a maintainer, I want presentational components to hold no server state, so that Inline Editing later has a clean boundary to attach editable regions to rather than a component that fetches mid-render.

### Forking and rebranding

21. As a developer forking the Starter Storefront, I want an `.env.example` I can copy, so that the first command in the README works.
22. As a developer, I want every environment variable the storefront reads listed in that file with a comment, so that I do not discover a missing one at runtime.
23. As a developer, I want the store config validated when the app starts, so that a typo in `currency` or `locale` fails immediately with a message naming the field rather than deep inside a formatting call.
24. As a developer, I want to set my logo in config, so that the fork checklist's promise about swapping the logo is something I can actually do.
25. As a developer, I want a wordmark fallback when no logo is set, so that an unbranded fork still renders a header.
26. As a developer, I want a typeface knob, so that changing the font is editing config rather than hunting through CSS.
27. As a developer, I want the config to contain no toggle that does nothing, so that I do not spend an afternoon looking for the accounts feature it implies exists.
28. As a developer, I want the fork checklist in the README to match what the code actually supports, so that following it end to end produces a rebranded store.
29. As a developer, I want the theme tokens to stay the single place colors and roundness are defined, so that restyling does not mean editing components.
30. As a merchant, I want my store's name, description, and logo to appear consistently across the header, footer, and page titles, so that a fork looks like one brand rather than a half-renamed template.

### Correctness and safety

31. As a merchant, I want the browser to still hold no secret, so that making the storefront faster does not widen its attack surface.
32. As a merchant, I want attribution to keep travelling with the first add, so that making the add optimistic does not cost me campaign reporting.
33. As a merchant, I want a failed optimistic add never to leave a phantom item in a cart that later checks out, so that an order can never contain something the server did not accept.
34. As a developer, I want the optimistic patch to be a pure function, so that the two ways it goes wrong are testable without a browser.

## Implementation Decisions

### Scope boundary

Everything here is inside `apps/storefront`. No backend module, no GraphQL
schema change, no change to the admin. Any change required outside the
storefront means the slice was drawn wrong and should be raised.

### Optimistic add to cart

An `optimisticAdd` joins the existing `optimisticQuantity` and `optimisticRemove`
patch functions, and follows their established precedent exactly: it computes a
**transient estimate** that the server's authoritative cart replaces on
resolution. The storefront's standing principle is that the client never
computes money; the qualification the existing patches already document — that
an estimate held for one round-trip is not the same thing as the client owning
pricing — is extended rather than reopened.

Three cases distinguish it from the existing patches:

- **There may be no cart yet.** The cart is created lazily on the first add, so
  the patch has to synthesize a whole cart, not amend one. The synthesized cart
  carries a placeholder id and zeroed discount, tax, and shipping, and is
  replaced wholesale on success. It is never persisted and never read by
  checkout, which derives the cart id from the cookie server-side.
- **A repeat variant merges.** Adding a variant already in the cart increases
  that line's quantity. Appending a second line would double the badge count and
  show the shopper a cart they do not have — visible, wrong, and exactly the
  kind of thing a shopper reports as "it added it twice".
- **The line id is not known yet.** The optimistic line carries a temporary id,
  distinguishable from a server id, and every optimistic line is discarded when
  the real cart lands. Quantity and remove controls are disabled on a line that
  is still optimistic, because those mutations address a line by an id the
  server has never seen.

The add mutation gains the same `onMutate` snapshot and `onError` rollback shape
the other two use. Concurrent adds are handled the way the existing patches are:
in-flight cart queries are cancelled before patching, and the last server
response wins.

The display details the optimistic line needs — product name, slug, variant
name, sku, image, and unit price — are **passed in by the caller**, not fetched.
The product detail page already has all of them. This is what makes the
optimistic add possible without the button reaching for data, and it is why this
work and the separation work below belong in the same stage.

Attribution is read at click time and travels with the add exactly as it does
today. The optimistic patch happens on the client; the attribution read is
unchanged and still runs before the server function is called.

The drawer opens on a **successful** add, not on the optimistic patch, so a
failed add does not open a drawer onto a rolled-back cart.

### Data and presentation separation

Four components become props-only: the cart drawer, the cart line item, the
coupon field, and the add-to-cart button. Each receives its data and its
callbacks from a page. No component below a page calls a query or mutation hook.

Pages remain the data layer and keep calling hooks directly — that is the
existing convention across both frontends and it is not being changed. The rule
being established is narrower and worth stating precisely: **a page may fetch; a
component may not.**

The drawer's open state is lifted so that a successful add elsewhere on the page
can open it. The drawer keeps rendering its own trigger.

This is deliberately not a full container/presentational split across every
feature. The catalog and checkout components already take everything as props;
adding container wrappers around components that already comply would be
ceremony. The four that violate the rule are fixed, the rule is written down,
and the rest is left alone.

The forward reason, recorded but not acted on: ADR-0003 has the storefront mark
editable regions with data attributes and post messages to an admin that owns
all editing chrome. A component that fetches its own data has no stable boundary
to mark. Nothing about Inline Editing is built here.

### Fork gaps

- A real `.env.example` listing every variable the storefront reads, each with a
  one-line comment and no real values. The README's first command works.
- The store config is parsed and validated at module load, failing with a
  message that names the offending field. Currency and locale are validated by
  actually attempting the `Intl` construction they will be used for, because a
  syntactically plausible locale that `Intl` rejects is the failure that
  otherwise surfaces as a blank price.
- A logo knob in the store config, with the store name as a wordmark fallback
  when it is unset, honouring what the fork checklist already promises.
- A typeface knob, so changing the font is a config edit rather than a CSS hunt.
  The CSS tokens stay the single definition of colors and roundness.
- The `features.accounts` toggle is **removed**. Nothing reads it and no accounts
  feature exists; a toggle that implies a feature which is not there is worse
  than its absence. It comes back with the feature, if the feature comes.
- The README is updated last, once the code is true: the fork checklist,
  the page-fetches/component-doesn't convention, and the new knobs.

### What is deliberately not changed

The security boundary is untouched: every commerce call still goes through a
server function holding the API key, and the browser still holds no secret. The
cart id remains an httpOnly cookie derived server-side. The GraphQL operations,
the session helpers, and the attribution capture are unchanged.

## Testing Decisions

A good test here asserts what the shopper ends up seeing — a cart with the right
lines and the right counts — and never asserts on how a component was wired,
which hook fired, or what a mutation was called with. Component rendering,
drawer behaviour, and styling stay untested, per the standing position that the
testing floor rises only where blast radius is money or tenancy.

One new seam, agreed with the developer. `apps/storefront` currently has no test
runner; this stage adds Vitest and uses it for exactly one thing.

**Seam — the cart patch functions as pure units.** Inputs are a cached cart (or
its absence) and a line to add; output is the patched cart. No DOM, no React, no
network. Cases: adding when there is no cart at all synthesizes one containing
the line; adding a variant already present merges into that line rather than
appending a second; the badge count after a merge is the sum and not a double
count; subtotal and total move as a transient estimate consistent with the
existing quantity patch; an optimistic line is distinguishable from a
server-issued one; and a server cart replacing the estimate leaves no optimistic
remnant. The existing `optimisticQuantity` and `optimisticRemove` get coverage in
the same pass, since they share the shape and currently have none.

This seam exists because the two ways an optimistic add goes wrong — a duplicate
line and a wrong count — are silent, survive until the server response, and are
pure functions of the inputs. Everything else in this stage is presentational
and is verified by running the app.

Deliberately not used: component tests, browser automation, and any test that
mounts a hook. The backend end-to-end suite is untouched, because the GraphQL
contract does not change in this stage.

Prior art: the backend's unit specs establish the house style for a pure-function
seam, and the marketing utility specs are the closest analogue — pure functions
over data already read, tested without a framework. Vitest rather than Jest
because the storefront is a Vite app and its config already exists; the backend
keeps Jest.

## Out of Scope

- **The CMS.** Content Slots, Inline Editing, the iframe protocol, and any data
  attributes for marking editable regions. Stage 4 in its entirety. The
  separation work here is groundwork, and adding protocol surface before the
  protocol is specified would fix its shape prematurely.
- **Customer accounts.** No login, registration, or order history. The dead
  toggle is removed rather than implemented.
- **A theme preset system.** One set of CSS tokens stays the theme. Named
  selectable themes are a lot of design surface for a store that has one brand.
- **Component tests and browser automation.** See Testing Decisions.
- **Backend changes of any kind.** No schema, no resolver, no GraphQL contract.
- **Checkout and payment work.** The Stripe flow, the confirmation poll, and the
  idempotency behaviour are all unchanged.
- **Optimistic patching of anything else.** Coupons and shipping rates involve
  server-side money the client cannot estimate honestly, and stay as they are.
- **Performance work beyond the add path.** No image pipeline, no bundle
  splitting, no prefetch tuning.
- **Deployment.** Still no Dockerfile or CI for the storefront; that belongs with
  the deploy path, not here.

## Further Notes

**The transient-estimate precedent is the load-bearing argument.** "The client
never computes money" is a real principle in this codebase, and an optimistic
add appears to violate it. It does not, for the same reason the existing
quantity patch does not: the estimate lives for one round-trip, is never
persisted, is never read by checkout, and is replaced wholesale by the server's
answer. Anyone reopening this should read the existing patch functions first —
the decision was made there and is only being extended.

**The merge case is the one to get right.** A duplicate line is the failure a
shopper actually notices and reports, it looks like a bug in the merchant's
store rather than in the template, and it is invisible in every manual test that
only ever adds one thing.

**Separation and the optimistic add are genuinely one piece of work.** The
optimistic line needs product display details at click time; the button can only
have them without fetching if the page passes them down. Doing the separation
first would leave a button whose new props nothing uses; doing the optimistic add
first would mean the button fetching what it needs. They land together.

**This is the stage where the template claim gets tested for real.** Every
previous stage judged the storefront by whether it worked. This one judges it by
whether someone else can fork it, and the honest finding from reading it is that
they cannot yet — the first command in the README fails. That is a small bug and
a large signal.

**The dead accounts toggle is worth removing rather than leaving.** It is
harmless to the running app and expensive to a reader, who reasonably infers a
feature exists and goes looking for it. Config that lies is worse than config
that is missing.
