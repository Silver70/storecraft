# 09: Matching-rule preview

**What to build:** Before saving a matching rule, the merchant can see which existing Orders it would claim, so an over-broad rule is caught before it reshapes reports rather than after.

Because Campaigns resolve at read time, a saved rule immediately changes historical figures. That is the property that lets a correction repair the past, and it is also what makes a careless rule quietly rewrite it. The preview makes the consequence visible at the moment of authoring: the merchant sees the Orders and the revenue a candidate rule would pull in, and can tell a precise rule from one that swallows everything.

**Blocked by:** 04, 05

**Status:** ready-for-agent

- [ ] A merchant can preview a candidate rule before saving it
- [ ] The preview reports the Orders and revenue the rule would claim for a period
- [ ] The preview shows Orders that another Campaign's rule already claims, so overlaps are visible
- [ ] Previewing changes nothing — no rule is created and no report is altered
- [ ] Saving the previewed rule produces the figures the preview showed
- [ ] The preview is scoped to the merchant's own Organization and Store
