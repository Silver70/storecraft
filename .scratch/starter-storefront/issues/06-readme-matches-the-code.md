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

**Status:** ready-for-agent

- [ ] Every command in the README works when run in order against a clean checkout
- [ ] The environment variable table matches `.env.example` exactly, with no variable in one and missing from the other
- [ ] The fork checklist matches what the code supports: env, store config, homepage sections, theme tokens, logo, typeface, favicons
- [ ] The page-fetches/component-doesn't convention is stated, with the four components named as the worked examples
- [ ] The project layout section matches the actual directory structure, including any feature folder it currently claims exists
- [ ] The attribution section still accurately describes behaviour after the optimistic add, particularly that attribution travels with the call that creates the cart
- [ ] How to run the storefront's tests is documented, and what they cover — the pure cart patch functions, deliberately not components
- [ ] Following the checklist on a fresh fork produces a rebranded store, verified by doing it
