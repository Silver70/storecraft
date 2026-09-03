# 06: Tagged link generator

**What to build:** A merchant can get a correctly tagged URL out of the admin instead of composing UTM parameters by hand, so matching is exact by construction and typos become impossible.

The merchant picks a Campaign, a destination page on their Store, and a source and medium, and gets a complete URL using the Campaign's canonical tag. One click copies it, ready to paste into an ad platform. Several links can be generated for one Campaign differing by source or medium, so the same push running on more than one platform still reports as a single Campaign.

The generator is a convenience, not a precondition — links tagged by hand before a Campaign existed remain claimable by a matching rule.

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] A merchant can generate a tagged URL for a Campaign, choosing destination page, source and medium
- [ ] The generated URL uses the Campaign's canonical tag
- [ ] A generated link's traffic attributes to its Campaign with no additional rule authored
- [ ] Several links differing only by source or medium all attribute to the same Campaign
- [ ] The generated URL can be copied in one action
- [ ] The destination can be any page of the Store, not only the home page
