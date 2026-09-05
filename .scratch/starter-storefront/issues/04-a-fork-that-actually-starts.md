# 04: A fork that actually starts

**What to build:** A developer forking the Starter Storefront runs the first
command in the README and it works.

Today it does not. The README opens with `cp .env.example .env` and no such file
exists. The store config exposes an `accounts` toggle that nothing reads, so a
reader reasonably infers a feature that is not there and goes looking for it. A
bad `currency` or `locale` fails somewhere inside a formatting call at render
time rather than at startup, surfacing as a blank price rather than an error
naming the field.

The template promises a five-minute rebrand and currently delivers a scavenger
hunt. This slice makes the first five minutes true.

Config that lies is worse than config that is missing, which is why the dead
toggle is removed rather than implemented. It comes back with the feature, if
the feature comes.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] An `.env.example` exists and copying it is a working first step
- [ ] Every environment variable the storefront reads appears in it, each with a one-line comment, and no real values
- [ ] The store config is validated when the app starts, and an invalid value fails with a message naming the offending field
- [ ] Currency and locale are validated by attempting the formatting construction they will actually be used for, so a syntactically plausible locale that is rejected at runtime is caught at startup instead of showing a blank price
- [ ] The `accounts` feature toggle is removed, along with the type that declares it
- [ ] The security boundary is unchanged: server-only variables stay server-only, and the only key that reaches the browser is still the tracking key the README already explains
