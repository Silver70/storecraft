# 06: Visitors and conversion rate

**What to build:** A merchant can tell a creative nobody clicked from one that
was clicked and did not convert. Visitors and conversion rate join the card,
visually demoted and labelled, because they come from a different and weaker
source than everything beside them.

**Blocked by:** 05 (The merged page and the card grid).

**Status:** ready-for-agent

- [ ] Visitors and conversion rate are reported per Ad and per Campaign, joined
      from the tracked event stream on the Campaign Tag, the Ad Tag and the
      visitor identity
- [ ] Conversion rate is purchases over visitors
- [ ] Both are **absent, not zero**, when the event stream has nothing for a
      Campaign or Ad. A zero would read as "nobody came" where the truth is "we
      did not see anyone"
- [ ] **The measured figures are visibly distinguished from the order-derived
      ones on the card.** Revenue, purchases, Spend, ROAS and margin come from
      Orders. Visitors and conversion rate come from a stream that is
      ad-blockable and is eventually deleted by the retention purge. Presenting
      them in identical typography implies they are equally solid; when ad
      blockers eat a third of traffic, conversion rate reads far higher than it
      is and the merchant optimises toward a fiction
- [ ] The distinction follows the convention this codebase already uses for a
      qualified number — cost coverage beside Contribution Margin, the Lookback
      Window beside ROAS, Declared beside Correlated Attribution
- [ ] The figures are returned in a shape that marks them as measured, so the UI
      cannot present them identically to order-derived figures by accident
- [ ] The join is scoped to the Organization and Store like every other read
- [ ] Adding these figures does not change any order-derived figure on the page
