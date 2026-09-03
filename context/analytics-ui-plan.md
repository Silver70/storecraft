# Analytics UI Plan

A redesign plan for `/admin/analytics`, driven by the two references in
[context/analytic-ui-extracted1webp.webp](analytic-ui-extracted1webp.webp) (Live View overview) and
[context/analytic-funnel-ui.png](analytic-funnel-ui.png) (funnel drill-down).

> **Premise:** the data pipeline is done (Phase 3 A–D). Every number on this page already exists
> or is one query away. This plan is about **what the page says**, not what it can compute.

> **Decisions locked (2026-07-24):**
> 1. **Scope — all three phases**, sequenced P1 → P2 → P3 (P3 adds prior-period deltas + sparklines).
> 2. **IA — Overview + consolidate to 6 tabs** (Traffic+Audience → Acquisition; Sales+Orders → Commerce).
> 3. **Hero — country-shaded world map**, honest with our country-only geo. No globe, no city pins.
> 4. **No realtime mode** — keep the Today/7d/30d/90d selector; deltas compare against the prior
>    equivalent period.

---

## 0. What the references actually do

Stripping the screenshots to their working parts — these are the patterns worth taking:

| Pattern | Where it shows up | Why it works |
| --- | --- | --- |
| **One hero visual** | the globe, centered, dominating | gives the page a focal point and a "where" answer at a glance |
| **Every number carries a delta** | `2,181 ↓3% vs last 30 min` on *every* stat and *every* funnel stage | a number without a comparison isn't insight |
| **Funnel as a continuous tapering shape** | 4 stage columns over one graduated area | you read drop-off as a *shape*, not by subtracting numbers |
| **Drill-down, not more page** | `View More` / expand icons → full-screen funnel modal | overview stays scannable; depth is one click away |
| **Rich list rows** | flags for countries, thumbnails for products, proportional micro-bars, sparklines | scanning by icon is faster than reading strings |
| **A narrative banner** | "Strong Engagement from Store Arrival to Checkout — 85% … 60% … 40%" | tells the operator what to *think*, not just what happened |
| **Warm accent, cool data** | orange CTAs/bars; blue funnel; teal/blue/orange donut | brand colour stays for actions; data gets its own hues |
| **Sub-stats inside a card** | `Total Sesion 2,092` + `Avg. Duration 5m 24s` nested in Total Visitors | related context without another card |

---

## 1. Honest diagnosis of the current page

Not "it looks dated" — here's what's actually wrong, UX first.

### 1.1 The IA is the biggest problem, not the styling

Seven flat tabs — **Sales · Orders · Traffic · Audience · Behavior · Customers · Inventory** — organised
by *data source*, not by *question*. Consequences:

- **There is no answer page.** Nothing responds to "how is the store doing right now?" You must
  pick a tab and assemble the answer yourself. The reference leads with exactly that page.
- **Cross-cutting reads are impossible.** "Traffic is up but revenue is flat" spans two tabs.
- **Tab cost is real.** Seven targets, each hiding its contents until clicked, on a page most people
  open to check one thing.

### 1.2 No number has a comparison

`StatTile` carries no delta — its own docstring says so ("Unlike the dashboard's KpiCard it carries
no period delta"). So the whole page reads as a flat wall of digits. **This single gap is the
biggest reason it doesn't feel like the reference**, where every figure has `↑8%`.

### 1.3 No sense of time

No sparklines, no trend anywhere except the Customers growth area chart. The period selector changes
the numbers but you never see the *shape* of the period.

### 1.4 The chart palette can't encode categories

The theme ships `--chart-1 … --chart-5` as **all warm oranges** (hues 13°, 38°, 16°, 45°, 13°). For
categorical data — 7 acquisition channels, 3 device types — those are effectively **one colour**.
I already worked around this with an ad-hoc `CHART_PALETTE` in `utils.ts`; that's a band-aid, not a
system. (Fixed in §2.1, with a validator run.)

### 1.5 Everything has the same visual weight

Every card is the same size, same radius, same border, same title treatment. No hierarchy means no
focal point — the eye has nowhere to land. The reference is deliberately unequal.

### 1.6 Small stuff that adds up

- `flag.tsx` **already exists in the codebase and analytics doesn't use it** — countries render as
  bare `US` / `GB` text. Free win.
- Empty states speak in code: *"clicks and form submissions require opt-in autocapture
  (`data-autocapture`) or per-element `data-ca-event`"*. That's documentation, not an invitation.
- `RankedBarList` is doing the job of four different cards (pages, referrers, clicks, forms) — it's
  become the default answer rather than a chosen form.
- Cards are `--radius: 0.625rem` (10px); the reference reads noticeably softer (~14–16px).

---

## 2. The visual system

### 2.1 Colour — brand orange for chrome, a validated set for data

The rule the references follow, which we should copy exactly: **orange is for actions and brand
(buttons, active tab, focus rings). Data gets its own hues.**

Adopt this categorical order for series (blue-led, orange kept as slot 2 so charts still feel on-brand):

| Slot | Hue | Light | Dark |
| --- | --- | --- | --- |
| 1 | blue | `#2a78d6` | `#3987e5` |
| 2 | orange | `#eb6834` | `#d95926` |
| 3 | aqua | `#1baf7a` | `#199e70` |
| 4 | yellow | `#eda100` | `#c98500` |
| 5 | magenta | `#e87ba4` | `#d55181` |
| 6 | green | `#008300` | `#008300` |
| 7 | violet | `#4a3aa7` | `#9085e9` |
| 8 | red | `#e34948` | `#e66767` |

**Validated against our real surfaces** (`#ffffff` light / `#171717` dark), not eyeballed:

```
LIGHT  PASS lightness · PASS chroma · PASS CVD (worst adjacent ΔE 9.1) · PASS normal-vision (19.6)
       WARN contrast <3:1 for aqua/yellow/magenta → relief rule: visible labels or table view
DARK   PASS all five checks (worst adjacent CVD ΔE 8.4, all ≥3:1 on surface)
```

The light-mode WARN is already satisfied by our list components (every row shows its value as text),
and must stay satisfied wherever those three hues appear.

Supporting roles:
- **Sequential (magnitude / funnel stages):** one blue ramp, light→dark. For discrete stages don't go
  lighter than `#86b6ef` on light so the palest band still reads.
- **Status (deltas):** good `#0ca30c` / warning `#fab219` / critical `#d03b3b` — **reserved**, never
  reused as a series colour, always paired with an arrow icon so it isn't colour-alone.
- **Hard rule: no dual-axis charts.** This retires the deferred "revenue vs orders dual-axis overlay"
  (Phase 1, item 6) — two y-scales is the single most misread chart form. If we want that comparison:
  two stacked charts sharing an x-axis, or index both to 100 at period start.

### 2.2 Form, spacing, type

- **Radius** 10px → **14px** on cards; keep inner elements tighter (6–8px) so nesting reads.
- **Hierarchy by size, not by border:** hero row taller with a larger figure; supporting cards
  smaller. Kill the uniform grid.
- **Type scale:** hero figure 40–44px / card value 24px / label 11px uppercase with tracking /
  helper 11px muted. System sans throughout.
- **Figures:** `tabular-nums` only where numbers align in columns (table rows, axis ticks);
  proportional for standalone hero figures — they read better large.
- **Motion, restrained:** chart draw-in on mount and hover transitions only. No count-up animations,
  no staggered card cascade — over-animation is what makes a dashboard read as generated. Respect
  `prefers-reduced-motion`.

### 2.3 Interaction floor

Every chart gets a hover layer (crosshair + tooltip on area/line, per-mark tooltip on bars/donut) —
several current charts have none. Filters stay in one row above the content.

---

## 3. Information architecture

### 3.1 Lead with an Overview

Add **Overview** as the default tab — the "Live View" equivalent, and the page that finally answers
"how are we doing?".

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Analytics                          [ Today  7d  30d  90d ]   [ Export ] │
│  Overview | Acquisition | Behavior | Commerce | Customers | Inventory    │
├──────────────────────────────────────────────────────────────────────────┤
│ ┌───────────────┐  ┌──────────────────────────┐  ┌────────────────────┐ │
│ │ VISITORS      │  │                          │  │ TOP LOCATIONS      │ │
│ │ 2,181  ↓3%    │  │      W O R L D   M A P   │  │ 🇺🇸 United States 102│ │
│ │ ▁▂▃▅▂▇▃ spark │  │   (shaded by sessions)   │  │ 🇨🇦 Canada        89 │ │
│ │ sess. 2,092   │  │                          │  │ 🇮🇩 Indonesia     68 │ │
│ ├───────────────┤  │                          │  ├────────────────────┤ │
│ │ CHANNELS      │  │                          │  │ DEVICES            │ │
│ │ Organic  ████ │  │                          │  │   ◕  desktop 65%   │ │
│ │ Direct   ███  │  └──────────────────────────┘  │      phone   25%   │ │
│ └───────────────┘                                └────────────────────┘ │
├──────────────────────────────────────────────────────────────────────────┤
│ CONVERSION FUNNEL                                          [ View more ] │
│  Visitors      Product view     Add to cart      Checkout     Purchase  │
│  2,181 ↓3%     1,892 ↑8%        1,201 ↑8%        1,029 ↑4%    412 ↑2%   │
│  ███████████▇▇▇▇▇▇▇▆▆▆▆▆▆▅▅▅▅▅▅▄▄▄▄▄▄▃▃▃▃▃▃▂▂▂▂  (tapering area)        │
└──────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Collapse 7 tabs → 6, grouped by question

| New tab | Answers | Absorbs |
| --- | --- | --- |
| **Overview** | How are we doing? | *new* |
| **Acquisition** | Where do they come from, and who are they? | Traffic + Audience |
| **Behavior** | What do they do on site? | Behavior |
| **Commerce** | What sold, and did we make money? | Sales + Orders |
| **Customers** | Who buys, and do they come back? | Customers |
| **Inventory** | What's in stock? | Inventory |

Traffic+Audience merge is natural (both are "who arrived"). Sales+Orders is the bigger refactor —
flagged as a question below.

### 3.3 Depth goes in drill-downs, not on the page

`dialog.tsx` already exists. Each overview card gets a **View more** affordance opening a focused
modal — the second reference *is* this pattern for the funnel: full funnel + exit pages + top
purchased + most-added-to-cart.

---

## 4. Components

| Component | Status | What changes |
| --- | --- | --- |
| `MetricTile` | replaces `StatTile` | delta pill (icon + %, status colour), optional sparkline, optional nested sub-stats (the reference's "Total Session / Avg Duration" pattern) |
| `FunnelBoard` | upgrade of `FunnelChart` | per-stage delta, ordinal blue bands per stage, hover tooltip, `View more` → drill-down. The existing tapering SVG is already good — it keeps its geometry |
| `GeoPanel` | new | world map shaded by sessions + `Top locations` list **using the existing `flag.tsx`** |
| `RankedList` | upgrade of `RankedBarList` | leading icon slot (flag / favicon / product thumb), optional sparkline, chevron for drill-in |
| `InsightBanner` | new | the "AI Review Analysis" analogue — one sentence + the 2–3 step-conversion figures that justify it |
| `DrillDownDialog` | new | shared shell for card → modal |
| `ChartTooltip` | exists | apply consistently — several charts have no hover layer |

Copy also gets a pass: empty states become invitations (*"No traffic yet — add the tracker to your
storefront to see where visitors come from"*) with the code-level detail demoted to a secondary line.

---

## 5. What this needs from the backend

The reference look depends on two things we don't currently return:

1. **Prior-period deltas** on every analytics metric. The pattern already exists on the dashboard
   (`stats` returns `{ current, prior, delta, sparkline }`); the `/analytics/*` endpoints return bare
   numbers. Every `↑8%` in the mockups needs this.
2. **Per-day series** for sparklines and trend shapes.

The good news: **slice D's `analytics_daily_metrics` rollup table is exactly the right source for
both**, and it currently has no reader. This redesign is its first real consumer — sparklines and
prior-period comparisons come from cheap rollup reads rather than re-scanning raw events.

Not yet computable, would need new work: avg. session duration, exit pages/exit rate, product
thumbnails in analytics lists.

---

## 6. Phasing

| Phase | Scope | Backend? | Payoff |
| --- | --- | --- | --- |
| **P1 — Visual system** | palette + validator, radius/hierarchy/type scale, `MetricTile`, funnel polish, flags, tooltips, empty-state copy | none | biggest visual lift per hour; nothing blocked |
| **P2 — Overview + IA** | Overview tab, tab consolidation, drill-down dialogs, `GeoPanel` | none (parallel existing queries) | the page finally answers the main question |
| **P3 — Deltas & trends** | prior-period + sparkline series from the rollup table, `InsightBanner` | yes | the thing that makes it *feel* like the reference |

P1 alone fixes most of the "flat" feeling. P3 is what closes the gap completely.

### P1 task breakdown

1. **Palette tokens** — add the validated 8-slot categorical scale + sequential blue ramp + reserved
   status colours to `app.css` (light + dark), replacing the all-orange `--chart-1…5`. Retire the
   ad-hoc `CHART_PALETTE` in `utils.ts` in favour of the tokens.
2. **`MetricTile`** — replaces `StatTile`: delta pill slot (dormant until P3), optional sparkline
   slot, optional nested sub-stats. Migrate all tabs to it.
3. **Card system** — 14px radius, size-based hierarchy, unified header (icon + title + optional
   action), consistent 11px uppercase labels.
4. **Funnel polish** — ordinal blue bands per stage, hover tooltip, per-stage delta slot (dormant
   until P3).
5. **Flags** — wire the existing `flag.tsx` into the countries list.
6. **Hover layer** — audit every chart; add tooltips where missing.
7. **Copy pass** — empty states become invitations; code-level detail demoted to a second line.

### P2 map implementation note

Prefer a **zero-dependency inline SVG** world map (country paths keyed by ISO-3166 alpha-2, filled
from the sequential blue ramp) over pulling in `react-simple-maps`/`d3-geo`. It keeps the supply
chain unchanged, themes cleanly from CSS tokens, and we only need country granularity. Decide at
build time against the actual path-data size.

---

## 7. Deliberate omissions

- **No dual-axis charts** (§2.1).
- **No decorative motion** — restraint is the aesthetic.
- **City-level geo stays out.** Slice A intentionally derives country only and never stores IP. A
  globe with precise city pins would imply precision we deliberately don't collect; a country-shaded
  map is the honest form.
