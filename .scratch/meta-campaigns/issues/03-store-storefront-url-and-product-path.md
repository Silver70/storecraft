# 03: A Store knows where its storefront lives

**What to build:** A Store gains the address its storefront is served at, and
the shape of its product page paths. Without these, nothing here can build the
link an ad points at.

The system is headless, so the URL shape belongs to whoever built the storefront.
The Starter Storefront serves products at `/products/{slug}`, which is the
default, but a merchant who forked it and changed the routing must be able to say
so rather than being silently wrong.

An ad's destination must land on the Store's own storefront, because that is the
only place the capture script reads the link tags. A destination pointing
anywhere else is a campaign that cannot be measured, so it is refused here rather
than discovered later.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] A merchant sets their Store's storefront URL in settings, and it is
      validated as an absolute `http`/`https` URL with no query or fragment
- [ ] A merchant sets a product path pattern, defaulting to `/products/{slug}`
      and required to contain the slug placeholder
- [ ] Given a product, the system produces its full storefront URL
- [ ] It produces the URL of the all-products page and of the home page
- [ ] It accepts a custom path and refuses anything not on the Store's own
      storefront, with a message saying why
- [ ] The resolved URL is stable regardless of trailing slashes in either
      setting
- [ ] Both settings are optional until something needs them, and the admin says
      what will not work while they are unset
- [ ] Writing them requires the same permission as other Store settings
