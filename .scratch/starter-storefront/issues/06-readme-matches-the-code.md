# 06: README matches the code

**What to build:** A developer follows the README end to end and ends up with a
running, rebranded store — every command works, every knob it names exists, and
the conventions it states are the ones the code actually follows.

This lands last on purpose. A README written before the code is true documents
intentions; written after, it documents the thing.

Two additions beyond correcting what is already there. The fork checklist has to
match what 04 and 05 built. And the layering rule the storefront now
demonstrates — **a page may fetch; a component may not** — has to be written
down, because the whole point of the separation work is that a forking merchant
knows which layer is theirs to restyle and which is wiring to leave alone.

**Blocked by:** 02 (Cart components take props), 03 (Optimistic add to cart), 04 (A fork that actually starts), 05 (Logo and typeface knobs).

**Status:** resolved

- [x] Every command in the README works when run in order against a clean checkout
- [x] The environment variable table matches `.env.example` exactly, with no variable in one and missing from the other
- [x] The fork checklist matches what the code supports: env, store config, homepage sections, theme tokens, logo, typeface, favicons
- [x] The page-fetches/component-doesn't convention is stated, with the four components named as the worked examples
- [x] The project layout section matches the actual directory structure, including any feature folder it currently claims exists
- [x] The attribution section still accurately describes behaviour after the optimistic add, particularly that attribution travels with the call that creates the cart
- [x] How to run the storefront's tests is documented, and what they cover — the pure cart patch functions, deliberately not components
- [x] Following the checklist on a fresh fork produces a rebranded store, verified by doing it

## Comments

Implemented 2026-09-05.

Verified by forking twice into the scratch directory — `git clone` of the repo,
so a genuinely clean checkout with no `node_modules` and no `.env` — rather than
by reading the README against the source. The second fork followed only the
rewritten README, which is the version of the test that means anything.

**Every command, in order.** `cp .env.example .env` → `npm install` at the root
→ `npx turbo dev --filter=storefront` boots a clean fork. Four more are now
documented because they exist and work: `npm test` (64 specs), `npm run build`
(`tsc --noEmit` included), `npm run preview` (4173, SSR), and `npm start` (srvx,
3000). The Getting-started block gained the `cd` that the first line always
needed — `cp .env.example .env` only works from `apps/storefront`, and the
`npm install` line right after it says "from the monorepo root", which is two
different directories in three lines with no way to tell.

Two things the README asserted that a fork disproves, both now stated. Port 5173
is a preference, not a promise — Vite moves to the next free port and prints it,
which is what both forks got. And `.env.example` leaves four blanks, not one, of
which only `COMMERCE_API_KEY` stops the catalog loading.

**Env table.** Already matched the seven variables in `.env.example`. What was
missing is `NODE_ENV`, which the code reads (`session.ts`, for the cookie
`Secure` flag) and which `.env.example` names in its closing "set by the runtime,
not here" section. Listing it as a table row would invite someone to set it;
leaving it out entirely left the file and the table disagreeing. It is now a
note under the table saying why it is in neither.

**Layout.** The claimed `features/account/` does not exist. `lib/session.ts`
carries customer-token helpers under an "Account feature — optional v1" heading,
which is presumably where the line came from, but nothing is built on them —
exactly the "reader infers a feature and goes looking for it" failure 04 removed
the `accounts` toggle for. The section now names the four real features, says
which have `pages/` and `components/` (`attribution` has neither, being all
wiring), and adds `public/`, `router.tsx`, `validate-store-config.ts` and
`countries.ts`. `CartButton` was listed under `layout/` and is not there.

**The layering rule** is a new section, stated as the three-layer split
(routes prefetch, pages fetch, components take props) with the four components
from 02 and 03 as a table of what each takes. It also names the one exception,
because a rule with an undocumented exception is a rule a reader stops trusting
the first time they open `header.tsx` and find `useCart` in a file under
`components/`. The header is the layout shell standing in for the page that is
not above the drawer; `cart-ui.tsx` holds the open state higher still. Checked
by grep rather than assumed: nothing under any `features/*/components/` calls a
query or mutation hook, and the header is the only file under `components/` that
does.

**Attribution** needed one paragraph rewritten, not for accuracy but for what a
reader would now conclude. "Both travel to the commerce API when the cart is
created" was still true, but after 03 a reader who knows the add is optimistic
would reasonably wonder whether the local patch carries attribution and whether
a rolled-back add sends a touch. It now says the optimistic line is a local
estimate carrying nothing, that `useAddToCart` reads the touches at click time
and sends them with the add underneath, and that a failed add sends nothing.

**Tests** were undocumented. The section covers both commands, why the runner
has its own config, and what the 64 specs are: 36 on the three pure cart-patch
functions and 28 on the boot-time config check. It states outright that
components are verified by running the app — as a decision with its reason (the
arithmetic worth pinning was moved into pure functions so it could be tested
without a DOM), not as an omission, because otherwise the next person adds
jsdom to close a gap that is not one.

**The fork checklist** went from six steps to eight, split so each step is one
file or one asset: env, store config, logo, typeface, homepage sections, theme
tokens, favicons, deploy. Three things it did not say and now does. Homepage
sections silently render nothing when a slug matches no category
(`home-page.tsx:70`), so the shipped `new` / `apparel` produce an empty homepage
against any store that lacks them — which is what the first fork showed before
the slugs were changed, and is the least debuggable failure in the whole
checklist. `site.webmanifest` ships with `name` and `short_name` blank, so a
rebrand that stops at the favicon files leaves the installed-app name empty.
And the closing note now says which steps are boot-validated (2–4, the store
config) and which fail quietly (5–7) — the previous draft of this line claimed
the theme tokens were validated too, which they are not; they are CSS and
`validate-store-config.ts` never sees them.

The validation claim was checked by breaking two fields at once on the fork:
`currency: "GBPP"` and a schemeless `logo.src` produced one `StoreConfigError`
listing both, each naming its field. Worth knowing, and now in the README: the
browser gets a bare `{"status":500,"message":"HTTPError"}` and the useful
message is in the server console.

**The rebrand, done rather than described.** Fork two — Northwind Goods, GBP /
en-GB, a `public/logo.svg`, Space Grotesk with its Google Fonts URL, two
homepage sections against real category slugs, `--primary` and `--radius`
changed, manifest filled in — following the checklist and nothing else. The
served page: title and meta description from config, the logo `<img>` in both
header and footer with the store name as alt text, `--typeface` on `<html>` with
the stylesheet in `<head>`, both sections populated, prices as `£10.00`, and the
custom nav entry. `npm test` and `npm run build` pass on it, the built CSS
carries the new tokens and `--font-sans:var(--typeface,…)`, and `dist/client`
contains neither the API key nor its name. Fork one was the same exercise
against the pre-rewrite checklist (Verdant Supply, EUR / de-DE), and is what
turned up the empty-homepage and blank-manifest gaps.

Three things observed and deliberately not changed, each a code change rather
than a README one:

- `npm start` runs `pnpx srvx …`, so it needs pnpm even though this is an npm
  workspace repo, and `srvx` is not a declared dependency — it is fetched at run
  time. It works here because pnpm happens to be installed. The README says so
  rather than pretending otherwise; `npx` and a real devDependency would be the
  fix.
- `__root.tsx:59` sets `color: "#fffff"` on the manifest link — five `f`s, not
  six.
- `public/favicon.png` is in the directory and referenced by nothing.
