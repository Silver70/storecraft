# Zernio API — Research Findings

**Researched:** 2026-09-08
**Primary sources:** https://docs.zernio.com/ (reachable, public, no login wall), https://zernio.com/
**Method:** Full docs corpus pulled from `https://docs.zernio.com/llms-full.txt` (5.07 MB, 118,224 lines), plus
`sitemap.xml` (785 URLs), plus individual `.mdx` page fetches and web searches.

> **Doc availability (Q10):** `docs.zernio.com` is fully reachable and public. No login wall, no errors.
> The site publishes `llms.txt`, `llms-full.txt`, a `sitemap.xml`, and an OpenAPI 3.1 spec at
> `https://zernio.com/openapi.yaml`. Every `.mdx` page is fetchable by appending `.mdx` to the URL.
> The single exception: `https://status.zernio.com` 301-redirects to `https://zernio-status.com/`, which
> returned **HTTP 403** to automated fetches — status-page content is UNVERIFIED.

---

## Headline answer

Zernio is **not** an organic-only social posting API. It is a broad, unified
**social + messaging + telephony + paid-ads** API. Paid advertising is a first-class,
deeply-built surface: **~134 documented advertising endpoints across 7 ad networks**,
including campaign creation, budgets, bid strategies, audience targeting, Conversions API,
and spend/ROAS reporting.

The critical caveat is **maturity, not capability**: Zernio is a **2025-founded, bootstrapped,
8-person company in Girona, Spain**, and it is a **rebrand of "Late" (getlate.dev)** that
happened in **early 2026**. The Ads API shipped **April 2026** — roughly five months old.

---

## 1. What does it actually do?

**Answer: a mix of all four — (a) organic publishing, (b) paid ads, (c) messaging/DMs, (d) analytics — plus telephony (SMS/voice/WhatsApp numbers).**

The homepage tagline: *"The social media and messaging API for developers and AI agents."*

From the docs overview (https://docs.zernio.com/api-reference), the resource groups and their
documented endpoint counts:

| Area | Resources | Endpoints |
|---|---|---|
| **Core** | Profiles (5), Accounts (14), Connect (50) | 69 |
| **Content & Scheduling** | Posts (10), Queue (6), Media (1), Validate (4) | 21 |
| **Inbox** | Messages (15), Comments (13), Reviews (3), Mentions (2), Broadcasts (10), Contacts (7), Custom Fields (6), Sequences (10), Workflows (14), Comment Automations (6) | 86 |
| **Analytics** | Posting Analytics (26), Inbox Analytics (7) | 33 |
| **Advertising** | Campaigns & Ads (37), Creatives (15), Audiences (7), Targeting (4), Ad Library (1), Insights (10), Conversions API (14), Messaging & Call Ads (2), Reach & Frequency (4), Lead Gen (7), Accounts & Ops (23), Pixels & Tracking Tags (10) | **134** |
| **Platform APIs** | WhatsApp (73), Google Business (25), Discord (24), Blogs (10), Twitter Engagement (8), Instagram (5), Reddit Search (2), Slack (1), LinkedIn Mentions (1) | 149 |
| **Telephony** | Phone Numbers (28), SMS (22), Voice (18), Calls (3), Verify (3) | 74 |
| **Developer** | Webhooks (7), API Keys (4), Usage (5), Logs (1) | 17 |
| **Settings & Admin** | Account Settings (9), Account Groups (4), Connected Apps (2), Users (2), Invites (1) | 18 |

The sitemap lists **785 URLs**, the bulk of which are per-endpoint reference pages.

Notable: it also does **telephony** (buy real phone numbers, PSTN voice, SMS with US 10DLC
registration, WhatsApp Business numbers) and **conversation automation** (drip sequences,
branching workflows, comment-to-DM growth automations) — surfaces most "social API" competitors
do not touch. It also connects **Shopify**, but connect-only for blog articles:

> "Connect a Shopify store and create, schedule, update and delete its blog articles through the Blogs API; a store publishes no social posts." — https://docs.zernio.com/platforms/shopify

There is also a hosted **MCP server** at `https://mcp.zernio.com/mcp` (https://docs.zernio.com/mcp)
and a CLI (https://docs.zernio.com/cli).

---

## 2. Platform coverage

### Organic publishing — 16 platforms (+ Shopify for blogs)

Connect via `GET /v1/connect/{platform}` where `{platform}` is one of:
`twitter`, `instagram`, `facebook`, `linkedin`, `tiktok`, `youtube`, `pinterest`, `reddit`,
`bluesky`, `threads`, `googlebusiness`, `telegram`, `snapchat`, `whatsapp`, `discord`, `slack`
(https://docs.zernio.com/platforms).

Per-platform publish features (verbatim from https://docs.zernio.com/platforms):

- **X** (`twitter`): threads, polls, scheduled spaces
- **Instagram**: Stories, Reels, carousels, collaborators
- **Facebook**: Reels, Stories, Page posts
- **LinkedIn**: documents (PDFs), company pages, personal profiles
- **TikTok**: privacy settings, duet and stitch controls
- **YouTube**: Shorts, playlists, visibility settings
- **Pinterest**: boards, rich pins
- **Reddit**: subreddits, flairs, NSFW tags, native video uploads
- **Bluesky**: custom feeds, app passwords (credential-based, not OAuth)
- **Threads**: reply controls
- **Google Business Profile**: location posts, offers, events, performance metrics, search keywords
- **Telegram**: channels, groups, silent messages, protected content (credential/bot-based)
- **Snapchat**: **closed beta** — "New connections return `403 PLATFORM_BETA_RESTRICTED` until the account is approved; there is no public release date yet."
- **WhatsApp**: template messages, broadcasts, contacts, conversations, Flows
- **Discord**: messages, embeds, native polls, forum posts, threads, crosspost
- **Slack**: channel messages, thread replies, file uploads, per-message bot identity
- **Shopify** (connect-only): storefront blogs and articles, HTML bodies, SEO fields

### DMs / inbox coverage (https://docs.zernio.com/platforms)

| Platform | List | Fetch | Send text | Attachments | Quick replies | Buttons | Edit | Archive |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Facebook | Y | Y | Y | Y | Y | Y | N | Y |
| Instagram | Y | Y | Y | Y | Y | Y | N | Y |
| X | Y | Y | Y | Y | N | N | N | N |
| Bluesky | Y | Y | Y | N | N | N | N | Y |
| Reddit | Y | Y | Y | N | N | N | N | Y |
| Telegram | Y | Y | Y | Y | Y | Y | Y | Y |
| WhatsApp | Y | Y | Y | Y | N | N | N | Y |
| SMS | Y | Y | Y | Y | N | N | N | Y |
| Slack | Y | Y | Y | Y | N | N | N | Y |

Discord is outbound-DM-only (`POST /v1/discord/dms`); replies do not arrive.
**No inbox at all** for Pinterest, Snapchat (platform exposes no API) or TikTok ("Not supported ... No DMs or comments through Zernio").

### Comments

Facebook, Instagram, X, Bluesky, Threads, Reddit, YouTube, LinkedIn — all list/reply/delete with
varying like/hide support. **TikTok: no comment support at all** (all six columns N).

### Reviews
Facebook Pages and Google Business Profile only (list, reply; delete-reply on GBP only).

---

## 3. Does it support PAID ADVERTISING? — **YES, extensively.** ✅

This is the decisive finding, and it is unambiguous.

> "The `/v1/ads` endpoints create campaigns, boost organic posts, manage audiences and read analytics on 7 ad networks" — https://docs.zernio.com/platforms

| Ad platform | Key | Create | Boost | Audiences | Analytics |
|---|---|---|---|---|---|
| **Meta Ads** (FB + IG) | `metaads` | Yes | Yes | Customer list, website, lookalike, engagement | Yes |
| **Google Ads** | `googleads` | Search and Display | No | Customer Match | Yes |
| **LinkedIn Ads** | `linkedinads` | Yes | Yes | Contact list, company list, engagement retargeting, website retargeting | Yes |
| **TikTok Ads** | `tiktokads` | Yes | Spark Ads | Customer list | Yes |
| **Pinterest Ads** | `pinterestads` | Yes | Yes | Customer list | Yes |
| **X Ads** | `xads` | Yes | Yes | Tailored Audiences | Yes |
| **OpenAI Ads** (ChatGPT) | `openaiads` | Yes | No | No | Yes |

**Can you create a campaign?** Yes. `POST /v1/ads/create` creates the whole 3-level tree
(campaign → ad set → ad) in one call. `POST /v1/ads/boost` promotes an already-published post.
There is also a dry-run: `validateOnly: true` "validates the whole tree and creates nothing"
(https://docs.zernio.com/platforms/meta-ads).

**Can you set a budget?** Yes. CBO (campaign-level) and ABO (ad-set-level) budgets, `budgetType`
of `daily` or `lifetime`, spend caps, `dailyMinSpendTarget`, and scheduled budget increases
(`/ad-accounts/create-high-demand-period`). Bid strategies documented:
`LOWEST_COST_WITHOUT_CAP`, `LOWEST_COST_WITH_BID_CAP`, `COST_CAP`, `LOWEST_COST_WITH_MIN_ROAS`
(the last takes a `roasAverageFloor` decimal multiplier).

> "Budgets and bids are whole units of `currency` (`75` is $75.00 on a USD account), never cents."
> — https://docs.zernio.com/platforms/meta-ads

**Can you target an audience?** Yes. Dedicated resources for:
- **Audiences** (7 endpoints): customer lists with hashed PII upload, website audiences, lookalikes, engagement audiences, saved-targeting presets.
- **Targeting** (4 endpoints): `GET /v1/ads/targeting/search` for interests/behaviors/geo/demographics, reach estimation, LinkedIn bid pricing and supply forecasts.
- Meta special ad categories are supported: `HOUSING`, `EMPLOYMENT`, `CREDIT`, `ISSUES_ELECTIONS_POLITICS`, `FINANCIAL_PRODUCTS_SERVICES`, `ONLINE_GAMBLING_AND_GAMING`.

**Can you launch a paid promotion?** Yes. `status: ACTIVE` publishes live by default;
`PAUSED` "creates them paused so you can review before they spend."

**Beyond the basics**, the ads surface also covers:
- **Conversions API** (14 endpoints): server-side conversion events with hashed matching, Event Match Quality reads, consent/Limited Data Use forwarding, pixel/dataset management.
- **Lead Gen** (7): Meta instant lead forms + lead retrieval by webhook or polling.
- **Reach & Frequency** (4): fixed-price reserved buying (quote → reserve → buy via a `RESERVED` campaign).
- **Messaging & Call Ads**: Click-to-WhatsApp (CTWA), Messenger, Instagram Direct, Call ads.
- **Catalog / Advantage+ dynamic ads** from product sets.
- **Ad Library** (1): competitor research over the public Meta and LinkedIn ad archives.
- **Creative previews**: "Meta iframe HTML for about 60 formats, before or after create."
- **A/B tests and lift studies**, ad labels, DSA beneficiary/payor defaults, value rule sets.
- **Google Ads specifics**: Search keywords (broad/phrase/exact), negative keywords, Keyword Planner (`generate-keyword-ideas`, `generate-keyword-historical-metrics`), portfolio bid strategies, search-terms report, raw **GAQL passthrough**, tracking templates.

**Meta review is not bypassed:** "A successful create means the ad exists, not that it delivers:
`reviewStatus` (`in_review`, `approved`, `rejected`, `with_issues`) is separate from the delivery `status`."

### Ads caveats worth knowing
- **Google Ads has no `boost`** and **conversion goals are not yet available on create** — `goal` is limited to `engagement, traffic, awareness, video_views` (https://docs.zernio.com/platforms/google-ads). Meta gets 10 goals including `conversions` and `catalog_sales`.
- An Instagram account connected with default Instagram Login **cannot run ads** — needs a `facebook` or `metaads` account in the same profile, or you get `422 linked_account_required`.
- Accounts connected before ads were enabled lack the ads scopes and must be reconnected.
- **Shared Google developer-token quota** — see §7.

---

## 4. Analytics / metrics retrieval

### Post-level organic metrics (https://docs.zernio.com/platforms)

| Platform | Impressions | Reach | Likes | Comments | Shares | Saves | Clicks | Views |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Instagram | Y | Y | Y | Y | Y | Y | N | Y |
| Facebook | Y | N | Y | Y | Y | N | Y | Y |
| X | Y | N | Y | Y | Y | N | Y | Y |
| LinkedIn | Y | Y | Y | Y | Y | Y* | Y** | Y*** |
| TikTok | N | N | Y | Y | Y | N | N | Y |
| YouTube | N | N | Y | Y | Y**** | N | N | Y |
| Threads | Y | N | Y | Y | Y | N | N | Y |
| Bluesky | N | N | Y | Y | Y | N | N | N |
| Reddit | N | N | Y | Y | N | N | N | N |
| Pinterest | Y | N | N | N | N | Y | Y | N |
| Snapchat | N | Y | N | N | Y | N | N | Y |
| Telegram | N | N | N | N | N | N | N | N |
| WhatsApp | N | N | N | N | N | N | N | N |
| Google Business Profile | N | N | N | N | N | N | N | N |

\* LinkedIn saves: personal accounts only. \*\* clicks: organization accounts only.
\*\*\* views: video posts only. \*\*\*\* YouTube shares from the daily Analytics API.
Google **deprecated per-post GBP analytics with no replacement** — use the location-level Performance API.

**Deeper per-platform endpoints:** YouTube demographics / daily views / video retention,
Instagram account insights + follower history + Story insights, TikTok account insights,
LinkedIn org aggregate analytics, Facebook Page insights + post earnings + reactions,
GBP daily performance + search keywords.

### Ad-level metrics — **yes: spend, impressions, clicks, CTR, CPC, CPM, conversions, ROAS**

Four levels of depth (https://docs.zernio.com/platforms/meta-ads/insights):

| You want | Call | Cost |
|---|---|---|
| Dashboard: spend, CPC, CPM, conversions, ROAS per campaign/ad set/ad | `GET /v1/ads/tree`, `GET /v1/ads`, `GET /v1/ads/{adId}` | Nothing — served from Zernio's synced metrics |
| One dimension split out | `GET /v1/ads/{adId}/analytics?breakdowns=` | One Meta call per dimension |
| Arbitrary Meta fields, breakdowns, filters | `GET /v1/ads/insights` | One live Graph call |
| Long ranges / agency scale | `POST /v1/ads/insights/reports` | An async Meta job you poll |

Real response shape from the docs:
```json
"summary": { "spend": 493.39, "impressions": 88210, "clicks": 1205,
             "ctr": 1.37, "cpc": 0.41, "cpm": 5.59 }
```
**ROAS is explicitly supported** — "how `roas` is recomputed at each level instead of averaged"
(campaigns page), and `website_purchase_roas` is shown as a queryable Meta field.

**Breakdown dimensions:** demographics (`age`, `gender`, `country`, `region`), placement
(`publisher_platform`, `platform_position`, `device_platform`, `impression_device`), and
**creative asset** (`video_asset`, `image_asset`, `body_asset`, `title_asset`) — the last group is
what makes per-creative attribution possible. LinkedIn adds firmographics (`job_title`, `seniority`, `industry`).

### Historical / time-series — **yes, genuinely time-series, not just snapshots**

- `GET /v1/analytics/daily-metrics` — daily aggregated buckets, **defaults to the last 180 days**, with a per-platform breakdown. Has an `attribution` param: `publish` (lifetime total on publish date) or `received` (per-day *increase* bucketed by the day it arrived — true engagement-over-time).
- `GET /v1/analytics` — `fromDate` defaults to 90 days ago, **max range 366 days**.
- Ad analytics: **90 days back by default, 730 days max**.
- Ads initial connect runs a **90-day historical backfill**.
- `GET /v1/analytics/post-timeline`, `/content-decay`, `/best-time`, `/posting-frequency`.
- Follower history: `GET /v1/accounts/follower-stats` — refreshed once per day.

**Freshness caveats:** post analytics **cached 60 minutes**; follower stats refresh **once a day**;
YouTube daily views arrive **2–3 days late** from YouTube's own API.

---

## 5. Auth model

**Your credential:** a single API key, `Authorization: Bearer $ZERNIO_API_KEY`. No OAuth dance for
*you* — just a key from https://zernio.com/dashboard/api-keys.

### Connecting an end-user's account
OAuth, brokered by Zernio:
1. `GET /v1/connect/{platform}?profileId=...&redirect_url=...` → returns `{ authUrl, state }`
2. Redirect the user's browser to `authUrl`
3. User approves on the platform; lands on your `redirect_url`
4. `account.connected` webhook fires carrying `accountId` + `profileId`

Exceptions: **Bluesky and Telegram use credentials (app password / bot token), not OAuth.**
Shopify needs the store's `shop` domain.

### Hosted connect UI — **yes, with a headless escape hatch**
> "**Standard mode** (default): Zernio hosts the selection screen. The user picks their Page or organization there, then lands on your `redirect_url`.
> **Headless mode**: you build the selection screen. Pass `headless=true` when starting the flow."
> — https://docs.zernio.com/guides/connecting-accounts

Five platforms add a post-OAuth selection step (Facebook Pages, LinkedIn organizations,
Pinterest boards, GMB locations, etc.). NOT DOCUMENTED: whether the hosted screen can be
white-labelled/branded.

### Multi-tenancy — **yes, first-class.** There is a dedicated guide: https://docs.zernio.com/multi-tenant
- The unit is a **profile**: "one profile per customer is the whole model." `POST /v1/profiles` with a name (your internal customer id works well — names are unique per team).
- **One API key manages every customer.** "One API key covers every customer."
- **Profiles are free and unlimited** — only connected accounts meter.
- **Scoped API keys**: `POST /v1/api-keys` with `scope: "profiles"`, `profileIds: [...]`, and optionally `permission: "read"` and `expiresIn` (days). Explicitly framed as access control, **not** throughput: "the rate limit belongs to the team, so a scoped key adds no throughput."
- Terminology: a **team** owns API keys and billing; a **profile** groups accounts; an **account** is one connected platform login. A profile "holds at most one account per platform."

⚠️ **Tenant-isolation footgun, called out in the docs:**
> "`POST /v1/posts` accepts any `accountId` your team owns, whichever profile it sits in. Pass a customer only the account ids stored against them in Step 2."

So **Zernio does not enforce cross-tenant isolation on the posting endpoint by default** — you must
enforce it in your own layer, or issue per-customer scoped keys. Relevant given commerce-os's own
`organization_id`-everywhere discipline.

### Does the end user need their own Meta developer app? — **No. Zernio provides the app registration.**
This is stated indirectly but unambiguously in several places:
- Google Ads: "There is no MCC or Standard Access application on your side: **Zernio operates under its own approved developer token**." (https://docs.zernio.com/platforms/google-ads)
- Reddit: "Reddit rate-limits per OAuth application, and **Zernio is one Reddit application**, so the budget is shared across all Zernio customers."
- TikTok: "TikTok caps the number of distinct accounts that can direct-post through **one application** per rolling 24 hours, shared across all Zernio customers."

That is the convenience *and* the risk — see §7.

### Zernio's own account security (https://docs.zernio.com/security)
Sign-in: email/password (screened against haveibeenpwned via k-anonymity), Google, GitHub, or
Enterprise SAML/OIDC SSO. TOTP 2FA with backup codes. Team roles: Owner, Admin, Billing Manager,
Member, Viewer. Append-only audit log for team-management actions. SCIM 2.0 on Enterprise.

---

## 6. Webhooks

**Both push and poll — and notably, metrics push is a *notification*, not the data.**

Configure with `POST /v1/webhooks/settings` (`name`, `url`, `events`, `secret`).
**Up to 50 endpoints per user.** You supply the secret: "Zernio never generates one for you."

### Event catalogue (https://docs.zernio.com/webhooks)

| Area | Events |
|---|---|
| **Posts** | `post.scheduled`, `post.published`, `post.failed`, `post.partial`, `post.cancelled`, `post.recycled`, `post.platform.published`, `post.platform.failed`, `post.platform.deleted`, `post.tiktok.url_resolved`, `post.external.created`, `post.external.updated`, `post.external.deleted` |
| **Inbox** | `message.received`, `message.sent`, `conversation.started`, `message.edited`, `message.deleted`, `message.delivered`, `message.read`, `message.failed`, `reaction.received`, `referral.received`, `comment.received`, `review.new`, `review.updated` |
| **Accounts** | `account.connected`, `account.disconnected` |
| **Analytics** | `analytics.synced` |
| **Ads** | `account.ads.initial_sync_completed`, `lead.received`, `ad.status_changed` |
| **Calls** | `call.received`, `call.ended`, `call.failed`, `call.permission_request` |
| **WhatsApp** | `whatsapp.template.status_updated`, `whatsapp.template.category_updated`, `whatsapp.account.name_status_updated`, `whatsapp.automatic_event` |
| **Phone numbers** | `whatsapp.number.kyc_submitted`, `.activated`, `.declined`, `.action_required`, `.verification_required`, `.suspended`, `.reactivated`, `.released`, `phone_number.stock_available` |

### Is there a push of metrics updates? — **Notification-push + cursor-pull hybrid.**

> "`analytics.synced` ... **Carries a cursor for the delta feed, not metrics.**"
> "Zernio sends no metrics in this event. It says an account's analytics changed; the delta feed says what changed."
> — https://docs.zernio.com/webhooks/analytics

The intended pattern:
1. Bootstrap baseline from `GET /v1/analytics`
2. Receive `analytics.synced` (carries `sync.cursor`)
3. Call `GET /v1/analytics/delta` with that cursor, then keep passing back `nextCursor`

`GET /v1/analytics/delta` is a **rolling 7-day cursor change-feed** across all accounts. Zernio
publishes real efficiency numbers: "Measured against a fleet of roughly 1,600 connected accounts:
about 1,599 per-account analytics calls an hour became about 205 delta calls an hour, a 7.8x reduction."
You can skip the webhook entirely and poll the delta feed on a timer — "The feed is the source of
truth either way."

⚠️ **Volume warning from the docs:** sync runs roughly hourly per account, so ~1,500 accounts →
~900 `analytics.synced` events/hour. Docs advise a **dedicated endpoint** for it, because an
endpoint's consecutive-failure count is shared across events and could silence `post.published`.

**Ads push:** `lead.received` is genuinely real-time (ingested from Meta's Page `leadgen` webhook).
`ad.status_changed` (Meta only) fires on status transitions with Meta's error codes. But **there is
no webhook that pushes ad spend/performance numbers** — ad metrics are pull-only via
`/v1/ads/tree` and the insights endpoints.

### Delivery mechanics
- **At-least-once.** Dedupe on `payload.id` / `X-Zernio-Event-Id`.
- **7 retry attempts**, exponential backoff capped at 24h: immediate, 10s, 1m40s, 16m40s, 2h46m, 24h, 24h (~51 hours total), then dead-letter. `POST /v1/webhooks/redeliver` replays.
- **5-second timeout**, must return 2xx.
- **HMAC-SHA256** of the raw body, lowercase hex, in `X-Zernio-Signature`.
- Auto-disable only after 3 days with no successful delivery **and** either 20 consecutive terminal failures or 3 days of continuous failure.
- ⚠️ Legacy aliases `X-Late-Event-Id` and `X-Late-Signature` are still sent — the fingerprint of the Late rebrand.

---

## 7. Rate limits, pricing, free tier

### Rate limits (https://docs.zernio.com/guides/rate-limits)
Sliding window; headers `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After`.

| Connected accounts | Requests/min | Requests/sec (analytics endpoints) |
|---|---|---|
| 0–2 (free) | 60 | 6 |
| 3–2,000 | 600 | 10 |
| 2,001+ | 1,200 | 20 |

Analytics endpoints use a **1-second** window: `requests_per_second = max(6, requests_per_minute / 60)`.

**Posting velocity caps** (separate from request limits): 25 posts/hour/account. Daily caps —
Instagram 100, Facebook 100, Threads 250, X 50, Pinterest 25, 50 for everything else.

⚠️ **Shared upstream quotas — the biggest operational risk:**
- **Google Ads:** "Google Ads API calls draw on a developer-token quota **shared by every Google Ads account connected to Zernio**, so a team with one account and a card on file can still hit it. ... Disconnecting other ad accounts or adding a payment method frees no quota, since the budget is app-wide." Resets once daily, early afternoon UTC. Connect can even fail with `error=google_ads_quota_exhausted`.
- **Reddit:** "the budget is shared across all Zernio customers. Low request volume on your side does not guarantee headroom."
- **TikTok:** direct-posting account cap per rolling 24h, shared across all Zernio customers.

⚠️ **Silent-failure footgun:** parameters are camelCase, and **unknown keys are ignored rather than
rejected**. `?profile_id=` returns every account in your team instead of one profile's; a
`scheduled_for` in a create-post body is dropped **and the post is silently saved as a draft**.
"Check the response, not only the status code."

### Pricing (https://docs.zernio.com/pricing) — usage-based, per connected account

| Connected accounts | Price per account/month |
|---|---|
| 1–2 | **Free, no credit card required** |
| 3–10 | $6 each |
| 11–100 | $3 each |
| 101–2,000 | $1 each |
| 2,001+ | $1 each, no cap |

**Graduated**, not flat. Prorated **by the day** (`account_cost = band_rate × days_active / days_in_month`).
The free tier is implemented as a **$12/month credit** against the connected-accounts line.

**Every account includes every feature** — "publishing, analytics, inbox and ads on all 16 platforms."
No feature gating by tier, no post caps, no profile limits.

**What counts as an account:** each posting account, **each ad account** (`metaads`, `googleads`,
etc.), and each WhatsApp number. Worked example from the docs: "A Facebook Page, its Instagram
account and the Meta ad account behind them are **3 connected accounts**."

**Additional meters:**
- **Managed ads:** first 500 active ads/month free, then **$0.01 per active ad per month**. Only running/in-review ads count. **"there is no percentage of ad spend"** — notable vs. agency tooling.
- **Outbound messages:** first 10,000/month free, then $0.0001 each. Meter starts 1 Oct 2026.
- **X API pass-through at cost, no markup** — $0.005/read, $0.015/post, **$0.200 per post containing a link**, $0.010/DM read, $0.015/DM send. There is a configurable monthly X spend cap.
- **Phone numbers** $3–$30/month (US $3); calls from $0.010/min; SMS from $0.008/segment; US SMS needs 10DLC ($9 one-time + campaign fee from $4/mo).
- WhatsApp template delivery and Meta's per-minute call fee are billed **by Meta directly to your WABA**, not by Zernio.

Billing runs on **Metronome on top of Stripe**. Card charged at a fraud threshold starting at $10 that doubles.

**Enterprise** (optional, never required): custom contracts, dedicated Slack, SOC 2 Type II + GDPR
docs via https://trust.zernio.com, SAML/OIDC SSO, SCIM, RBAC, IP allowlisting.
"Everything above is available the moment you sign up ... No usage level requires a contract, a quote or a call."

---

## 8. Maturity signals — **early-stage but unusually well-executed**

### Company
- **Founded 2025.** **8 people** (the /about page says 8; a search summary said seven). **Girona, Spain.** **Bootstrapped, no outside funding.** (https://zernio.com/about)
- Origin story: "We were working on a side project that needed to post to a few social platforms...we spent more time fighting their APIs than building our actual product."
- Scale claim: **"Tens of thousands of API requests go through Zernio every day."** That is a modest number. No customer count published.

### ⚠️ It is a rebrand of "Late" (getlate.dev), early 2026
Confirmed by three independent signals:
1. https://zernio.com/rebrand — "Late is now Zernio." "Zero breaking changes. Zero downtime. Same API keys. 100% compatible." 6-month grace period on old SDK packages; `getlate.dev` 301-redirects to `zernio.com`.
2. Legacy webhook headers `X-Late-Event-Id` / `X-Late-Signature` are still emitted.
3. Residue throughout the API surface: the `source` analytics filter still accepts the literal value **`"late"`** to mean "posted via Zernio"; the single-post analytics response still carries a **`latePostId`** field; the flagship open-source demo repo is still named **`latewiz`**.

Stated reason: "Try searching 'Late API' and you'll understand: generic words make terrible brand names." So the rebrand was naming/SEO/procurement-driven, not a pivot or a distressed relaunch. **The product lineage is longer than "founded 2025 + renamed 2026" implies** — but still ~1–2 years total.

### Engineering signals — strong
- **8 official SDKs**, all generated from one OpenAPI 3.1 spec: Node (`@zernio/node`), Python (`zernio-sdk`), Go, Ruby, Java (Maven Central), PHP, .NET, Rust. (https://docs.zernio.com/sdks)
- Public **OpenAPI 3.1 spec** at https://zernio.com/openapi.yaml.
- **CLI** and a hosted **MCP server** (`https://mcp.zernio.com/mcp`) — reportedly 280+ tools.
- **`llms.txt` / `llms-full.txt`** published — agent-friendly by design.
- Docs quality is genuinely high: per-platform "what the platform's API does not expose" sections, documented failure modes, real measured performance numbers (the 7.8x delta-feed figure), and explicit warnings about their own footguns. This is not vibe-coded documentation.

### GitHub — https://github.com/zernio-dev
**722 org followers**, 27 repositories. Top repos:

| Repo | Stars | Language |
|---|---|---|
| zernflow (visual chatbot builder) | 176 | TypeScript |
| latewiz (social scheduler) | 73 | TypeScript |
| zernio-node | 40 | TypeScript |
| unified-inbox | 33 | TypeScript |
| zernio-cli | 26 | TypeScript |
| ads-dashboard | 20 | TypeScript |
| zernio-python | 11 | Python |
| zernio-php / rust / java / go / ruby / dotnet | 0–3 each | — |

SDK repos were all updated **Sep 8, 2026** (i.e. today) — actively maintained. Also maintains a
public `openapi-specs` repo with OpenAPI specs for 14 *third-party* platform APIs.

### Changelog
https://docs.zernio.com/changelog — ~120+ entries spanning **3 Aug 2026 → 8 Sep 2026** (about 5 weeks
visible), multiple entries per day. Very high development velocity. Announced also on
https://t.me/zernio_dev and https://x.com/zernionews.

### Product Hunt — https://www.producthunt.com/products/zernio
- Main launch **18 March 2026**, 42 upvotes, 2 reviews, 5.0 rating
- **Ads API launched 22 April 2026** — 53 upvotes, 217 comments
- **WhatsApp API launched 19 June 2026** — 90 upvotes, 361 comments, #2 product of the day
- Maker: **Miquel Palet**

**This dates the ads capability precisely: ~5 months old as of Sept 2026.**

### Trustpilot — https://www.trustpilot.com/review/zernio.com
**154 reviews, 4.8/5** (91% 5-star, 4% 1-star), spanning **July 2026 → 6 Sept 2026**.
Praise: fast expert support (minutes), reliability, clear docs, straightforward OAuth.
Criticism: configuration options "complicated, restrictive, or challenging to navigate for beginners."

⚠️ 154 reviews concentrated in a ~2-month window for a company this size is a pattern worth
a skeptical eye — it usually indicates an active review-solicitation campaign.

### Could NOT verify
- **Status page: `status.zernio.com` → `zernio-status.com` returned HTTP 403.** No uptime history, SLA, or incident record verified. NOT DOCUMENTED / UNVERIFIED.
- **SOC 2 Type II**: *claimed* on the pricing page as an Enterprise deliverable via https://trust.zernio.com. Not independently verified.
- No funding rounds, revenue, customer count, or mainstream press (no TechCrunch/HN front page found).
- Legacy **AppSumo lifetime deals** exist (referenced repeatedly in rate-limit docs) — a lifetime-deal history is a common bootstrapped-SaaS monetization path and a mild signal about early revenue strategy.

### Verdict
**Not an early-stage solo project** — 8 SDKs, an OpenAPI spec, 785 documented endpoints, HMAC-signed
webhooks with dead-lettering, RBAC, audit logs, SSO/SCIM, and Metronome billing are all real
production engineering. **But it is also not an established platform**: ~1–2 years old, 8 people,
bootstrapped, no funding, a brand-new name, an ads product five months old, and an unverifiable
status page. The concentration risk is real and structural: **shared upstream API quotas** mean
another Zernio customer's traffic can throttle you on Google Ads, Reddit and TikTok.

---

## 9. Alternatives landscape — where Zernio sits

### (a) Organic social posting APIs
| Product | Notes |
|---|---|
| **Ayrshare** | The incumbent. ~13–15 platforms. Bills per active social profile; from ~$149/mo for a single profile — expensive at multi-tenant scale. **Zernio publishes a migration guide off it** (https://docs.zernio.com/resources/migrations/migrating-from-ayrshare). |
| **Late** | **This IS Zernio** (pre-rebrand). Do not evaluate as a separate option. |
| **Postiz** | Open-source, self-hostable. 30+ platforms incl. Nostr/Farcaster/Mastodon. Hosted $29–$99/mo by channel count. |
| **Blotato** | 9 platforms, flat $29/mo for 20 accounts, hosted MCP server. Cheapest, narrowest. |
| **Upload-Post, SocialChamp, Buffer API** | Adjacent; Buffer's is tied to its own product. |

**None of these do paid ads.** They are publish-and-schedule layers.

### (b) Creator-data / analytics APIs
| Product | Notes |
|---|---|
| **Phyllo** | Read-oriented. Creator-authorized OAuth to private analytics: true impressions, Stories performance, audience demographics, earnings. Built for influencer-marketing platforms. |
| **InsightIQ** | Same category; has added a Publish API. |
| **Modash, CreatorDB** | Influencer discovery + public metrics. |

The category distinction, from Phyllo's own framing: **"analytics APIs are about *reading* data,
while publishing APIs are about *writing* content."** These do **not** create ads and mostly do not publish.

### (c) Direct paid-ads APIs
| Product | Notes |
|---|---|
| **Meta Marketing API** | Full power. Requires your own Meta app, App Review, Business Verification, and tier progression. Weeks of onboarding. |
| **Google Ads API** | Requires your own developer token + Basic→Standard Access application. |
| **TikTok Business API**, **LinkedIn Marketing API**, **X Ads API**, **Pinterest Ads API** | Each its own app registration, review, and quota. |

Maximum control and no shared-quota risk — at the cost of N separate integrations, N approval
processes, and N sets of quota paperwork.

### Where Zernio sits
**Zernio is the only one of these that spans (a) + (c) — and adds messaging and telephony on top.**
It is best described as a **unified social + ads + messaging abstraction layer**: an aggregator that
holds the platform app registrations so you don't have to.

That is its differentiator *and* its structural weakness:
- **Upside:** one API key, one integration, ~750 endpoints, 16 organic platforms + 7 ad networks, no Meta/Google app approval on your side, multi-tenant profiles, $0 to start.
- **Downside:** you inherit their shared quota pools (Google Ads, Reddit, TikTok are explicitly app-wide), you depend on an 8-person bootstrapped company for a revenue-critical path, and coverage is a subset of each native API (e.g. no Google conversion goals on create, no Google boost, Snapchat in closed beta, TikTok comments/DMs absent).

Zernio does not publish a competitive comparison; the third-party comparison pages found
(getsocialclaw.com, blotato.com, docs.xquik.com, postplanify.com) are all **competitor-authored
marketing content** and should not be treated as neutral.

---

## Relevance to commerce-os

This project already has an attribution spine (ADR-0001, frozen first/last-touch UTM on orders) and
a Stage-2 campaign-performance module storing **Spend, ROAS, and Contribution Margin** — currently
fed by **manual range entry** (see `.scratch/campaign-performance/`, ticket 06 still pending).

Zernio maps onto that gap directly. `GET /v1/ads/tree` returns spend / impressions / clicks / CTR /
CPC / CPM / conversions / ROAS per campaign, ad set and ad from Zernio's own synced cache (no
upstream API call cost), across Meta, Google, TikTok, LinkedIn, X, Pinterest and OpenAI in one
shape — which is exactly the "record Spend" input that is manual today. The 90-day backfill on
connect and the 730-day ad analytics window would populate history, and `profileId` maps cleanly
onto `organization_id`.

Three things to weigh before adopting:
1. **The tenant-isolation gap.** `POST /v1/posts` (and by extension the ads writes) accept any `accountId` the *team* owns regardless of profile. That is the opposite of this codebase's `TenantScopedRepository` guarantee. Per-org scoped API keys, or a strict server-side allowlist, would be mandatory.
2. **Shared Google Ads quota.** A daily, app-wide developer-token budget you cannot buy your way out of is a poor dependency for a metric that appears on a customer-facing dashboard. Cache aggressively; degrade gracefully.
3. **Money representation.** Zernio returns ad budgets and spend as **decimal whole currency units** (`75` = $75.00, `spend: 493.39`) — directly contrary to this repo's integers-only rule. Any adapter must convert to cents at the boundary and never let a float reach the domain.

If the near-term need is *reading spend/ROAS* rather than *creating campaigns*, note that only ~10 of
the 134 ad endpoints are needed — but you still pay per connected ad account and per active ad.
