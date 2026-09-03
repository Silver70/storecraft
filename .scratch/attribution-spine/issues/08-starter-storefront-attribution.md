# 08: Starter Storefront attribution capture

**What to build:** The Starter Storefront captures attribution and reports it, so a merchant running it gets campaign reporting with no work, and a developer forking it inherits a working reference implementation of the contract.

On landing, the storefront reads UTM parameters and the referrer. It persists the First Touch for the duration of the Lookback Window so a Visitor who returns days later — as someone considering a large purchase does — is still attributed to the Campaign that found them, and it updates the Last Touch on each new attributed arrival. Both are passed when a Cart is created. The storefront also embeds the existing tracking script.

Capture must never block or slow the page, and must collect no personal data. This is the first time the whole path runs in a real browser, and it is where the ergonomics of the public contract get proven before any third party meets them.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] Landing on the storefront with UTM parameters and later checking out produces an Order carrying that attribution
- [ ] First Touch survives across separate visits for the Lookback Window duration
- [ ] Returning through a different Campaign updates Last Touch and leaves First Touch intact
- [ ] Landing with no UTM parameters still checks out, producing an Unattributed Order
- [ ] Attribution capture does not block rendering or add a perceptible delay to browsing or adding to cart
- [ ] No personal data is collected for attribution
- [ ] The tracking script is embedded and reporting events
