# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root: the glossary of domain terms.
- **`docs/adr/`**: read ADRs that touch the area you're about to work in.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

This is a **single-context** repo. One glossary and one ADR directory serve the whole
monorepo, because `apps/backend`, `apps/frontend`, `apps/storefront` and `packages/*` all
speak the same commerce domain (Organization, Store, Product, Order, Customer) and a term
must mean the same thing on both sides of the API.

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-attribution-snapshot-on-order.md
│   ├── 0002-campaign-as-first-class-entity.md
│   └── 0003-inline-editing-via-iframe-postmessage.md
├── apps/
│   ├── backend/
│   ├── frontend/
│   └── storefront/
└── packages/
```

There is no `CONTEXT-MAP.md` and there are no per-app `CONTEXT.md` files. Don't create them
without an explicit decision to move to a multi-context layout; a new term belongs in the
root `CONTEXT.md`, and a new decision belongs in `docs/adr/`.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0002 (campaign as a first-class entity), but worth reopening because…_
