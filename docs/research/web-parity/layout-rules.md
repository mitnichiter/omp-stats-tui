# Layout grammar — what the web renders, as structure

**Sources:** `ui/Stat.tsx`, `ui/Table.tsx`, `ui/Card.tsx`, `ui/Badge.tsx`, `ui/States.tsx`, `charts/*.tsx`,
`app/Shell.tsx`, and the matching blocks of `styles.css`.
**How produced:** each component's DOM was read from its `.tsx`, then its computed box metrics were measured on the
live dashboard with `getComputedStyle` + `getBoundingClientRect` at `1200px` viewport, dark theme. Every number below
is either a CSS literal with a `styles.css:<line>` citation or a measured value marked **[measured]**.

**The rule that outranks all the numbers here:** a terminal cannot reproduce *pixels*, so it must reproduce
**GROUPING**. Each section below therefore gives an indented DOM outline first and numbers second. If you take the
outline and lose every number, you still have the web. If you take the numbers and lose the outline, you have a
spreadsheet.

---

## 1. Shell — the frame around every screen

`app/Shell.tsx:44-127`. DOM:

```
div.shell-ambient                              (fixed, z-index 0, two radial accent glows)
header.topbar                                  (position: fixed, z-index above sidebar)
  button.topbar-menu.btn                        (display:none until ≤900px)
  div.topbar-brand
    svg.topbar-mark        22×22
    span                   "omp"
    span.topbar-slash      "/"      → ink-4, weight 300, 18px
    span.topbar-title      "stats"  → weight 500, ink-1
  div.topbar-spacer                           (flex:1)
  div.topbar-actions                           (gap 8px)
    span.topbar-hide-narrow > LiveChip         (hidden ≤900px)
    div.segmented          6 range options
    ThemeToggle
  div.topbar-progress > div.topbar-progress-fill  (only while syncing)
nav.sidebar[data-open]                          (fixed, top: --topbar-h)
  div.nav-group            (×3)
    div.nav-heading        "Usage" / "Activity" / "Insights"
    button.nav-row         (×N)  icon 15px + span.nav-row-label + kbd "G O"
  div.sidebar-foot.micro     (margin-top:auto)  "1–6 range", "G then letter to jump"
main.shell-panel
  div.shell-content          ← the page column lives here
```

| Property | Value | Citation / measurement |
|---|---|---|
| `--topbar-h` | `52px` | `styles.css:122`; **[measured]** `.topbar` height `52px` |
| `--sidebar-w` | `224px`, → `204px` at ≤1360px | `styles.css:123`, `615`; **[measured]** `204px` at 1200px |
| `.topbar` padding | `0 14px 0 18px` | **[measured]** |
| `.topbar` background | `rgba(0,0,0,0.72)`, `border-bottom: 1px solid transparent` → `var(--line-1)` once `window.scrollY > 4` | `styles.css:408-425`; **[measured]** `color(srgb 0 0 0 / 0.72)` |
| `.topbar` gap | `12px` | **[measured]** |
| `.sidebar` padding | `8px 10px 14px` | **[measured]** |
| `.shell-panel` margin | `var(--topbar-h) 8px 8px var(--sidebar-w)` | `styles.css:590` |
| `.shell-panel` | `background: var(--panel)`, `border-radius: var(--r-panel)`, `border: 1px solid var(--line-1)`, `box-shadow: var(--shadow-1)`, `overflow: clip` | `styles.css:591-596` |
| `.shell-content` padding | `26px var(--gutter) 48px` | `styles.css:600` |
| `.shell-content` max-width | `1560px`, centred | `styles.css:601-602` |
| `.nav-row` gap | `10px`; icon `15px` | `styles.css:526`, `Shell.tsx:106` |
| `.nav-row` height | ≈ `34px` (12px font + `2px` padding ×2 + `8px` gap, from `styles.css:522-536`) | derived |
| `.nav-row kbd` | `10.5px`, `ink-4`, `opacity: 0` → `1` on row hover | `styles.css:566-573` |
| `.nav-heading` | `12px`, weight 500, `ink-3`, uppercase-ish (`text-transform` unset — it is literal casing) | `styles.css:516-519` |

**Terminal consequence:** the *fixed* topbar and the *fixed* sidebar are the two things a fullscreen panel most
naturally has. The web's own `kbd` hints show `G O`, `G M`, … (second key of the `g <key>` jump, `app/nav.ts:33`).
A terminal that renders the sidebar as a static column loses the fixed-frame property but keeps the grouping.

## 2. Page header

`ui/Card.tsx:44-61`. DOM:

```
header.page-header.rise          display:flex, align-items:flex-end, justify-content:space-between, gap:16px, flex-wrap:wrap, padding-bottom:4px
  div
    h1.page-title
    p.page-description           margin-top 4px, ink-2, max-width 72ch
  div.page-actions                display:flex, align-items:center, gap:8px, flex-wrap:wrap
```

| Property | Value | Citation / measurement |
|---|---|---|
| `.page` | `display:flex; flex-direction:column; gap:20px` | `styles.css:663-667` |
| `.page-header` gap / padding-bottom | `16px` / `4px` | `styles.css:673`, `675` |
| `.page-title` | `22px`, weight **600**, `letter-spacing: -0.02em`, `line-height: 1.2` | `styles.css:678-683`; **[measured]** `22px / 600 / -0.44px` (= `-0.02em × 22`) |
| `.page-description` | inherits `13.5px`/`1.5`, `ink-2`, `margin-top: 4px`, `max-width: 72ch` | `styles.css:685-689`; **[measured]** `rgb(160,160,168)`, rect `383×20` |
| `.page-actions` gap | `8px` | `styles.css:694` |

**Load-bearing numbers:** the title is **22px @ weight 600** — the heaviest text on any screen, and heavier than a
card title (`550`) or a stat value (`550`). `.page` gap is **20px**. In a terminal: the screen title is the ONLY
bold-underline heading; `.page-description` is `ink-2`; the whole header occupies **2 rows** (title, description) and
actions are right-aligned on row 1.

## 3. Card

`ui/Card.tsx:20-42`. DOM:

```
section.card.rise[style --i]
  header.card-header                       ← only if title | description | actions
    div.card-titles
      h2.card-title
      p.card-description
    div.card-actions
  div.card-body[data-flush][data-stale]
  footer.card-footer                       ← only if footer
```

| Property | Value | Citation / measurement |
|---|---|---|
| `.card` background | `linear-gradient(var(--card), var(--card)) padding-box, linear-gradient(180deg, var(--line-3), var(--line-1) 40%) border-box` | `styles.css:745-747`; **[measured]** inner layer `rgb(14,14,16)` |
| `.card` border | `1px solid transparent` (the gradient paints the top-lit edge) | `styles.css:744` |
| `.card` radius / shadow | `var(--r-card)` = `12px`; `var(--shadow-1)` | `styles.css:743`, `748` |
| `.card-header` | `flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:14px 16px 0; flex-wrap:wrap` | `styles.css:754-761` |
| `.card-titles` | `flex column; gap:2px; min-width:0` | `styles.css:763-768` |
| `.card-title` | `14px`, weight **550**, `letter-spacing: -0.005em`, `display:flex; align-items:center; gap:8px` | `styles.css:770-777`; **[measured]** `14px / 550 / -0.07px` |
| `.card-description` | `12.5px`, `ink-3` | `styles.css:779-782` |
| `.card-actions` | `flex; align-items:center; gap:6px; flex-wrap:wrap` | `styles.css:784-789` |
| `.card-body` | `padding: 14px 16px 16px; flex:1; min-width:0` | `styles.css:791-795` |
| `.card-body[data-flush="true"]` | `padding: 10px 0 0` — **left/right padding drops to 0** | `styles.css:797-799` |
| `.card-footer` | `border-top: 1px solid var(--line-1); padding: 10px 16px; font-size: 12.5px; color: ink-3; flex; align-items:center; justify-content:space-between; gap:8px` | `styles.css:801-810` |

**Load-bearing numbers:** a card's header is **14px @ 550** — *below* the page title (22 @ 600) and *below* a stat
value (24 @ 550, but 1.7× its size). Header padding-top `14px`, body padding `14px 16px 16px`, so the gap between the
header block and the first content row is **14px, not 16**. `flush` is the flag that matters: it removes the body's
**left and right** padding entirely so a table runs edge-to-edge under the header text — that is how every data table
on the dashboard is wrapped (`OverviewRoute.tsx:261`, `ModelsRoute.tsx:180`, `CostsRoute.tsx:162`,
`ProjectsRoute.tsx:187`, `RequestsRoute.tsx:178`, `ErrorsRoute.tsx:163`/`265`, `ToolsRoute.tsx:189`/`212`,
`GainRoute.tsx:171`). `data-stale` dims the body while previous data is on screen (`Card.tsx:14`).

**Terminal consequence:** `flush` → **a card that contains a table has NO indent between its title and its rows.**
A card that contains a chart or a stat list indents its body by 2 spaces. That difference is exactly `16px` and it is
one of the strongest grouping signals on the page.

## 4. StatGrid and Stat

`ui/Stat.tsx:29-68`. DOM:

```
div.stat-grid.rise[style --stat-min: Npx]
  div.stat[data-size=md|sm][title]
    div.stat-label
    div.stat-value[data-flash]
    div.stat-foot              ← only if hint !== undefined || delta
      span.delta[data-tone]    ← if delta
      span.truncate            ← the hint text
    div.stat-spark             ← only if spark && spark.length > 1
      div.sparkline > svg > path.area, path.chart-line
```

### 4.1 The grid

| Property | Value | Citation / measurement |
|---|---|---|
| `grid-template-columns` | `repeat(auto-fit, minmax(var(--stat-min, 170px), 1fr))` | `styles.css:817` |
| **default `--stat-min`** | **`170px`** | `styles.css:817`; `Stat.tsx:53` documents "Default 170px" |
| border | `1px solid transparent` over the same two-layer gradient as `.card` | `styles.css:819-822` |
| radius / shadow / overflow | `12px` / `var(--shadow-1)` / `hidden` | `styles.css:818`, `823`, `824` |
| `gap` | **none** — tiles are separated by shadow, not gap | **[measured]** `gap: normal`; `styles.css` sets no `gap` on `.stat-grid` |

**[measured]** at `1200px` viewport (content column `942px`), a `min={190}` grid resolved to
`grid-template-columns: 235px 235px 235px 235px` — **4 columns for 5 tiles**, so the 5th wrapped to a second row.

### 4.2 Every `--stat-min` override in the codebase

`StatGrid` sets `--stat-min` inline (`Stat.tsx:63`). Every call site:

| `min` | Route | Citation | Tiles | Columns at `942px` content width |
|---|---|---|---|---|
| `190` | Overview (primary row) | `OverviewRoute.tsx:103` | 5 | 4 |
| **`140`** | Overview (secondary row) | `OverviewRoute.tsx:143` | 8 | 6 |
| `200` | Models | `ModelsRoute.tsx:89` | 4 | 4 |
| `180` | Costs | `CostsRoute.tsx:246` | 5 | 5 |
| `180` | Projects | `ProjectsRoute.tsx:84` | 5 | 5 |
| `160` | Requests | `RequestsRoute.tsx:115` | 6 | 5 |
| `170` | Errors | `ErrorsRoute.tsx:131` | 4 | 5 → 4 |
| `190` | Tools (primary row) | `ToolsRoute.tsx:85` | 5 | 4 |
| **`150`** | Tools (secondary row) | `ToolsRoute.tsx:122` | 4 | 6 → 4 |
| `190` | Providers | `ProvidersRoute.tsx:154` | 5 | 4 |
| `180` | Gain | `GainRoute.tsx:131` | 5 | 5 |
| `170` | Frustration (not ported) | `FrustrationRoute.tsx:139` | — | — |

**The load-bearing finding: a `140px`/`150px` row is always the `sm` secondary row** (Overview's token breakdown,
Tools' character counters). A `160px`–`200px` row is always the primary headline row. The primary row's 4–5 tiles are
deliberately wide so a **24px value fits without truncation**; the secondary row's 8 tiles are deliberately narrow
because their values are 18px `formatCompact` strings like `944M`.

**Terminal translation:** `--stat-min` is the *minimum tile width before wrapping*. At 150 columns a terminal should
show the primary row as **one row of 4–5** and the secondary row as **one row of 8** — because a 150-column terminal
is roughly the 942px content column's worth of character cells. At 100 → primary row 3–4, secondary row 4–5 (drop
sm first). At 60 → primary row 2, secondary row dropped or folded into a 2×2. At 40 → primary row 1, secondary row
dropped entirely.

### 4.3 The tile

| Property | Value | Citation / measurement |
|---|---|---|
| `.stat` padding | `14px 16px 12px` | `styles.css:829`; **[measured]** `14px 16px 12px` |
| `.stat` gap (between label/value/foot/spark) | `6px` | `styles.css:832`; **[measured]** `6px` |
| **separator** | `box-shadow: 1px 0 0 var(--line-1), 0 1px 0 var(--line-1)` — a **1px right rule AND a 1px bottom rule**, i.e. a full hairline grid | `styles.css:834-836` |
| border / radius / background | **none** (`0px none`, `0px`, transparent) — the tile is *transparent inside the grid's shared surface* | **[measured]** |
| **`.stat-label`** | `12.5px`, weight **500**, `ink-2`, `display:flex; gap:6px` | `styles.css:839-846`; **[measured]** `12.5px / 500 / rgb(160,160,168) / normal text-transform` |
| **`.stat-value`** | **`24px`**, weight **550**, `letter-spacing: -0.025em`, `font-variant-numeric: tabular-nums`, `line-height: 1.15`, `white-space:nowrap; overflow:hidden; text-overflow:ellipsis` | `styles.css:848-857`; **[measured]** `24px / 550 / -0.6px / tabular-nums / line-height 27.6px` |
| **`.stat[data-size="sm"] .stat-value`** | **`18px`** | `styles.css:859-861` |
| **`.stat-foot`** | `12px`, `ink-3`, `min-height: 18px`, `flex; align-items:center; gap:8px` | `styles.css:867-874`; **[measured]** `12px / rgb(108,108,116)` |
| `.stat-spark` | `margin-top: 2px; height: 28px` | `styles.css:876-879`; **[measured]** `28px` |

**Load-bearing numbers, in order of how often they get lost:**
1. **value 24px, label 12.5px — a 1.92× ratio.** `sm` value 18px vs label 12.5px — 1.44×.
2. **three ink levels per tile**: label `ink-2`, value `ink-1`, foot `ink-3`.
3. **the tile has NO background and NO border** — only the grid around it has a surface and an edge. A terminal that
   draws a box per stat has added a border the web does not have.
4. **`tabular-nums` on the value** — digits are fixed-width, so a column of stat values aligns without padding.
5. **the separator is a 1px right + 1px bottom hairline**, so the last column and last row have a doubled edge.
6. **`min-height: 18px` on `.stat-foot`** — a tile with no hint still reserves the foot row, so tiles in one row are
   the same height whether or not they have a hint. That is why the web's stat rows never look ragged.

### 4.4 The delta pill

`ui/Stat.tsx:71-83`. DOM: `span.delta[data-tone=good|bad]` containing `sign` + `pct%`.

| Property | Value | Citation |
|---|---|---|
| `.delta` | `inline-flex; align-items:center; gap:2px; font-mono; 11.5px; weight 500; padding: 1px 6px; border-radius: var(--r-pill); background: var(--raised); color: var(--ink-2)` | `styles.css:881-892` |
| `[data-tone=good]` | `color: var(--ok); background: var(--ok-soft)` | `styles.css:894-897` |
| `[data-tone=bad]` | `color: var(--bad); background: var(--bad-soft)` | `styles.css:899-902` |
| sign glyphs | `+` / `−` (U+2212 MINUS, not hyphen) / `±` | `Stat.tsx:75` |
| rounding | `|change| < 0.0005 → 0`; `pct ≥ 100 → toFixed(0)`, else `toFixed(1)` | `Stat.tsx:73`, `80` |
| no baseline | renders `<span className="delta">new</span>` | `Stat.tsx:72` |

**Which stats actually have a delta?** **None in any ported route.** No route passes `delta`. Verified: no `delta=`
prop in any `routes/*.tsx`. The pill exists in the component library and is currently unused — so the IR's `hint`
maps to `.stat-foot > span.truncate` only. Say this rather than inventing a delta column.

## 5. Table

`ui/Table.tsx:39-186`. DOM:

```
div.table-wrap                                overflow-x:auto
  table.table[data-dense]
    thead > tr
      th[data-align][data-sortable][data-sorted][style width][aria-sort]
        (header text)
        span.sort-arrow > svg (11px)          ← only when sorted
    tbody
      tr[data-clickable][data-selected]
        td[data-align][data-wrap]
      tr (detail row)                         ← only when expanded() != null
        td[colspan=N][data-wrap=true][style padding:0]
div.table-more                                ← only when limit !== undefined && rows > limit
  span.micro   "{n} of {total}"
  button.btn   "Show more" / "Show fewer"
```

| Property | Value | Citation / measurement |
|---|---|---|
| `.table` | `width: 100%; font-size: 13px` | `styles.css:1264-1267`; **[measured]** `fontSize 13px` |
| **`.table th`** | `font-size: 12px`, weight **500**, `color: var(--ink-3)`, `padding: 8px 12px`, `white-space: nowrap`, `background: var(--card)`, `border-bottom: 1px solid var(--line-1)`, `user-select:none` | `styles.css:1269-1282`; **[measured]** `12px / 500 / rgb(108,108,116)` |
| **`.table th:first-child` / `td:first-child`** | `padding-left: 16px` (not 12) | `styles.css:1284-1287`; **[measured]** `8px 12px 8px 16px` |
| **`.table th:last-child` / `td:last-child`** | `padding-right: 16px` | `styles.css:1289-1292` |
| **`.table td`** | `padding: 9px 12px`, `border-bottom: 1px solid var(--line-1)`, `vertical-align: middle`, `white-space: nowrap` | `styles.css:1313-1318` |
| **`.table[data-dense="true"] td`** | `padding-top: 6px; padding-bottom: 6px` — **only vertical changes; horizontal stays 12/16** | `styles.css:1352-1355`; **[measured]** dense `td` `6px 12px 6px 16px` vs normal `9px 12px` |
| **`[data-align="right"]`** | `text-align: right` — applies to BOTH `th` and `td` (the selector is `.table [data-align="right"]`, not `td`) | `styles.css:1340-1342`; **[measured]** `th[data-align=right]` `textAlign: right` |
| `[data-align="center"]` | `text-align: center` | `styles.css:1344-1346` |
| `td[data-wrap="true"]` | `white-space: normal` | `styles.css:1348-1350` |
| **sticky header** | `position: sticky; top: 0; z-index: 1` — `top:0` relative to the **page**, not the table, because `.table-wrap` has no `overflow-y` | `styles.css:1270-1272`; **[measured]** `position: sticky` |
| `tbody tr:last-child td` | `border-bottom: 0` | `styles.css:1320-1322` |
| `tbody tr:hover` | `background: var(--hover)`, `transition: background var(--dur-1)` | `styles.css:1324-1330` |
| `tr[data-selected]` | `background: var(--selected)` | `styles.css:1336-1338` |
| **`.table-more`** | `flex; justify-content:center; align-items:center; gap:8px; padding:10px; border-top: 1px solid var(--line-1)` | `styles.css:1357-1364`; **[measured]** `padding 10px / border-top 1px` |
| **measured row height** | **51px** dense (`td` `6px`×2 + 39px content), non-dense rows measure taller | **[measured]** `td` rect `260×51` on the dense Latest-requests table |

**Load-bearing numbers:**
1. **Header `12px` @ `500` in `ink-3`; body `13px` in `ink-1`.** The header is *smaller and dimmer* than the data.
   It is not a bold uppercase band. A terminal that renders a bold uppercase header row has inverted this.
2. **`dense` is a 3px-per-side row-height change, nothing else.** `9px → 6px` top and bottom. Non-dense `td` is
   `9px 12px`, dense is `6px 12px 6px 16px`.
3. **First and last cells get `16px` of side padding; interior cells `12px`.**
4. **`[data-align=right]` flips header AND body.** A right-aligned header over left-aligned body is the single most
   common terminal mistake.
5. **`th` has `background: var(--card)`** — the sticky header is opaque *because* the table is `flush` inside a card
   whose surface is the same `--card`. There is no sticky-header offset/border hack.
6. **`.table-wrap { overflow-x: auto }`** — at narrow widths the web **scrolls horizontally; it never drops a
   column.** This is stated explicitly in the IR at `src/layout/spec.ts:236-243`. The terminal's `priority` field is
   the terminal's own decision and is *not* a web fact.

### 5.1 `MeterCell`

`ui/Table.tsx:189-209`. DOM:

```
div.meter-cell                       display:flex; align-items:center; gap:10px; justify-content:flex-end
  span.num                           ← the display ReactNode, class is "num"
  div.meter
    div.meter-fill[style width:%][style background]
```

| Property | Value | Citation / measurement |
|---|---|---|
| **the number's own class** | **`span.num`** — i.e. `.mono` + `font-variant-numeric: tabular-nums` + `font-size: 0.93em` | `Table.tsx:203`; `styles.css:252-257` |
| `.meter-cell` | `flex; align-items:center; gap:10px; justify-content:flex-end` | `styles.css:1394-1399`; **[measured]** `gap 10px`, `justify-content flex-end` |
| **`.meter` width** | **`64px`** (from `.meter-cell .meter`) | `styles.css:1401-1403`; **[measured]** `width 64px` |
| `.meter` min-width | `48px` | `styles.css:1383` |
| **`.meter` height** | **`4px`** | `styles.css:1379`; **[measured]** `4px` |
| `.meter` track | `background: var(--line-1)`, `border-radius: 2px`, `overflow: hidden` | `styles.css:1380-1382`; **[measured]** `rgba(255,255,255,0.06)` |
| **`.meter-fill`** | `position:absolute; inset:0 auto 0 0; border-radius:2px; background: var(--chart-primary); transition: width var(--dur-3) var(--ease-out)` | `styles.css:1386-1392`; **[measured]** fill background `rgb(90,216,230)` = `#5ad8e6` |
| **relation to max** | `pct = max > 0 ? Math.min(100, (value / max) * 100) : 0` — **clamped at 100, and `max` is passed in by the CALLER, never derived inside** | `Table.tsx:200` |

**Callers and their `max`:** `ModelsRoute.tsx:344` `max={view.maxRequests}`; `CostsRoute.tsx:357`
`max={view.maxModelCost}`; `ProjectsRoute.tsx:239` `max={maxRequests}` and `:253` `max={maxCost}` — with the comment at
`ProjectsRoute.tsx:74`: *"Meter scales follow the whole range so a bar's length does not change while filtering."*;
`ErrorsRoute.tsx:334` `max={maxCount}` with `color="var(--bad)"`; `ToolsRoute.tsx:372` `max={maxCalls}`;
`ProvidersRoute.tsx:328` `max={maxRequests}` and `:363` `max={maxTokens}`; `GainRoute.tsx:195` `max={1}` (the bar is
the share itself).

**Load-bearing:** the number sits **first, the bar second, and the pair is right-aligned as a unit**. The bar is a
flat `64px × 4px` sliver — a 16:1 sliver. The bar's *fill colour* is the row's series colour (or `--bad` for error
counts, `--chart-secondary` for money), which is why a MeterCell column reads as a **coloured ranking bar** and not
as a text column with decoration.

### 5.2 `LabelCell`

`ui/Table.tsx:212-230`. DOM:

```
div.row[style gap:10px]               ← inline override of .row's 8px
  (lead)                               ← optional, e.g. <Swatch/> or <Dot/>
  div.stack[style gap:0]               ← inline override of .stack's 4px
    span.cell-primary.truncate
    span.cell-secondary.truncate       ← only if secondary !== undefined
```

| Property | Value | Citation |
|---|---|---|
| outer row gap | `10px` (inline; `.row`'s own gap is `8px`) | `Table.tsx:222` |
| **inner stack gap** | **`0`** (inline; `.stack`'s own gap is `4px`) | `Table.tsx:224` |
| `.cell-primary` | `font-weight: 500; color: var(--ink-1)` — **no size override**, so `13px` | `styles.css:1366-1369` |
| `.cell-secondary` | **`font-size: 12px`; color: var(--ink-3)`** | `styles.css:1371-1374` |
| both | `.truncate` → ellipsis, `nowrap` | `Table.tsx:225-226` |

**Load-bearing:** the two lines are **13px/500/`ink-1`** over **12px/400/`ink-3`** with **zero gap** — they read as one
label with a qualifier, not as two rows. A terminal's `LabelCell` is **2 lines, primary on line 1, secondary on line 2,
no blank line between**, which is why it needs a cell height of 2 rows wherever it appears. Where the `lead` swatch is
present, the primary line is a **series colour chip, then the model name**, and the secondary is the provider.

### 5.3 `Sparkline` in a table cell

`charts/Sparkline.tsx:14-38`, `ModelsRoute.tsx:414-432`, `ToolsRoute.tsx:352-364`.

| Property | Value | Citation |
|---|---|---|
| in a stat tile | `height 28px`, width fills the container | `Sparkline.tsx:14`, `styles.css:876-879` |
| **in the models table** | **`width={96} height={22}`**, `header` cell `width: 112` | `ModelsRoute.tsx:417`, `425-426` |
| **in the tools table** | **`width={80} height={20}`**, no cell width declared | `ToolsRoute.tsx:359` |
| area fill opacity | `path.area { opacity: 0.16 }` | `styles.css:1762-1764` |
| line stroke width | `1.5px`, `vector-effect: non-scaling-stroke` | `styles.css:1659-1665` |
| padding in the path | `y = height - 2 - (v/max) * (height - 4)` — the line is inset **2px top and bottom** | `Sparkline.tsx:24` |
| default colour | `var(--chart-primary)` | `Sparkline.tsx:14` |
| renders only if | `w > 0 && n > 0`; the parent only mounts it if `spark.length > 1` | `Sparkline.tsx:20`, `Stat.tsx:43` |
| no data in a table cell | `<span className="dim">–</span>` | `ModelsRoute.tsx:429`, `ToolsRoute.tsx:361` |

**Load-bearing numbers:** in-table sparklines are **20–22px tall and 80–96px wide** — half the tile sparkline's height
and a fixed width, not fluid. Three sizes exist and they are all distinct: **28px (stat tile), 22px (models table),
20px (tools table)**.

## 6. States

`ui/States.tsx:4-53`. DOM:

```
div.empty                     flex column; align-items:center; justify-content:center; gap:6px; padding:40px 16px; text-align:center; color:ink-3; min-height:140px
  svg                         Inbox, 20px, ink-4, margin-bottom 4px
  div.empty-title             ink-2, weight 500
  div.empty-hint              12.5px, max-width 44ch
div.error-state[role=alert]   flex; align-items:center; gap:12px; padding:12px 14px; margin:12px 16px; 15px TriangleAlert
  span.error-state-message
  button.btn                  "Retry"
div.skeleton                  arbitrary width/height
```

| Property | Value | Citation |
|---|---|---|
| `.empty` padding | `40px 16px` | `styles.css:1414` |
| `.empty` min-height | `140px` | `styles.css:1417` |
| `.empty` gap | `6px` | `styles.css:1413` |
| `.empty-hint` | `12.5px`, `max-width: 44ch` | `styles.css:1431-1432` |
| `TableSkeleton` rows | default `6`; rows `16px` tall, `gap: 10px`, widths `92% - ((i*13) % 30)%`, container padding `8px 16px 16px` | `States.tsx:46-54` |
| `ChartSkeleton` default height | `220px`, `border-radius: 8px` | `States.tsx:41-43` |
| `QueryView` precedence | `data===null && error → ErrorState`; `data===null → skeleton`; else `error && <ErrorState/>` then `isEmpty ? empty : children` | `States.tsx:70-80` |

**Terminal consequence:** an empty screen is **a centred, min-140px (≈7 terminal rows tall) block**, not a one-line
dash. `–` (U+2013 EN DASH) is the web's universal "no value" glyph, used in stat values (`ModelsRoute.tsx:98`,
`CostsRoute.tsx:264`), legends (`OverviewRoute.tsx:209`), BarLists and `formatDurationMs(null)`
(`formatters.ts:67`). Use it consistently.

## 7. Chart

`charts/Chart.tsx:54-352`. DOM:

```
div.chart[data-hovering][style height:Npx]
  svg[width][height]
    defs > pattern[id] (×N)         ← only for pattern:"hatch" series; 5×5, rotate(45), fillOpacity .14 + 1.6px stripe
    g.chart-grid > line (×Y_TICKS)  stroke var(--chart-grid), crispEdges
    g.chart-axis
      text (×Y_TICKS)               x = padLeft-8, textAnchor=end,  fill --chart-axis, mono 10.5px
      text (×Y_TICKS)               right axis, only if formatRight/right series exist
      text (×slots, every tickEvery) x = cx(i), y = height-6, textAnchor=middle
    rect.chart-cursor               ← only on hover; the hovered slot's column
    g (per area series) > path + path.chart-line
    g (per bar series)  > rect.chart-bar[data-hover]
    g (per line series) > path.chart-line
  div.chart-empty                   ← only when every visible value is falsy
  div.chart-tooltip                 ← only on hover
    div.chart-tooltip-title
    div.chart-tooltip-row × N
      span.swatch
      span.chart-tooltip-label
      span.chart-tooltip-value
    div.chart-tooltip-total         ← only if showTotal
```

### 7.1 Geometry constants

| Constant | Value | Citation |
|---|---|---|
| `PAD_TOP` | `10` | `Chart.tsx:49` |
| `PAD_BOTTOM` | `24` | `Chart.tsx:50` |
| `MIN_TICK_SPACING` | `68` | `Chart.tsx:51` |
| `Y_TICKS` | `4` | `Chart.tsx:52` |
| default `height` prop | `220` | `Chart.tsx:61` |
| `padLeft` | `Math.max(28, labelWidth(leftLabels) + 12)` | `Chart.tsx:114` |
| `padRight` | `rightScale ? Math.max(28, labelWidth + 12) : 8` | `Chart.tsx:115` |
| `labelWidth` | `max(labels.length * 6.3)` — a monospace-char estimate | `Chart.tsx:366-368` |
| **bar width** | **`Math.max(1, Math.min(56, slotW * (slotW > 6 ? 0.72 : 0.9)))`** — 72% of the slot, capped at **56px**; at slots narrower than 6px, 90% | `Chart.tsx:125` |
| grouped sub-bar | `subW = barW / groupedBars.length`, minus a **1px** gap when grouped | `Chart.tsx:224`, `241` |
| x tick density | `tickEvery = max(1, ceil(slots / max(1, floor(plotW / 68))))` | `Chart.tsx:126` |
| slot centre | `cx(i) = padLeft + (i + 0.5) * slotW` | `Chart.tsx:121` |
| y ticks | `niceScale` rounds up to 1/2/2.5/5 × 10ⁿ, **evenly spaced from 0** | `Chart.tsx:354-364` |
| chart ink | axis text `#5c5c64`, `10.5px`, `font-mono`; grid `rgba(255,255,255,0.055)`; baseline `var(--line-3)` | `styles.css:1630-1644` |
| bar minimum height | `Math.max(v > 0 ? 1 : 0, |y0-y1|)` — **a nonzero value draws at least 1px** | `Chart.tsx:242` |
| zero values | `{!v ? return null : …}` — **zero draws nothing at all**, leaving a gap | `Chart.tsx:229` |
| area fill opacity | `0.2` | `Chart.tsx:214` |
| hover dim | `.chart[data-hovering="true"] .chart-bar[data-hover="false"] { opacity: 0.45 }` | `styles.css:1655-1657` |
| empty state | `emptyLabel` default **`"No data in this range"`**; `.chart-empty` is absolutely centred, `12.5px`, `ink-3` | `Chart.tsx:71`, `styles.css:1667-1675` |
| tooltip | `min-width: 160px; max-width: 280px; padding: 8px 10px; radius var(--r-control); border 1px var(--line-2); background var(--overlay); font-size: 12px`; title `11px` mono `ink-3`; row `line-height: 1.7`; total gets `border-top` + `4px` margin/padding | `styles.css:1677-1730` |
| tooltip zero-row suppression | **with >1 visible series, zero rows are omitted**; with exactly 1 series a zero is shown | `Chart.tsx:140-145` |
| tooltip row order | descending by value when >1 series | `Chart.tsx:145` |

### 7.2 Stacked vs grouped — the default is STACKED

`Chart.tsx:60`: `stacked = true`. A series is stackable iff `stacked && (s.kind ?? kind) !== "line"` (`Chart.tsx:83`).
Stacked series share one slot and are drawn bottom-up **in series order, first = bottom** (`Chart.tsx:86-97`). Series
on `axis: "right"` are **never stacked** (`Chart.tsx:124`). **A line series over bars is never stacked** — that is the
only way `countSeries + a trend line` works.

**Every ported chart is a stacked `TimeChart`** except: the Overview Token-mix / Costs Where-it-went share bars
(`ShareBar`, not `Chart`), the ranked lists (`BarList`, not `Chart`), and the Providers Peak-burn card. So a terminal
chart band that draws **one bar per bucket** is correct for stacked; drawing N side-by-side bars per bucket is
**grouped and is wrong** for every ported screen.

### 7.3 Chart heights actually used

| Card | Height | Citation |
|---|---|---|
| Overview → Activity | `260` | `OverviewRoute.tsx:176` |
| Models → Request share | `260` | `ModelsRoute.tsx:153` |
| Costs → Daily estimate | `280` | `CostsRoute.tsx:119` |
| Tools → Calls over time | `260` | `ToolsRoute.tsx:166` |
| Providers → Burn by provider | `260` | `ProvidersRoute.tsx:226` |
| Gain → Savings over time | `260` | `GainRoute.tsx:165` |
| default | `220` | `Chart.tsx:61` |

**Load-bearing:** the plot area's usable height is `height - 10 - 24 = height - 34`. At `260` that is **226px of
plot under a 24px x-axis band**. In a terminal the axis band is the tick-label row.

## 8. ShareBar, BarList, Legend

### 8.1 `ShareBar`

`charts/ShareBar.tsx:9-26`. DOM:

```
div.share-bar[style height:Npx][role=img]
  div.share-bar-seg × N      flexGrow = value/total, background = segment colour, title "{label}: {pct}%"
```

| Property | Value | Citation |
|---|---|---|
| default height | `8px` (`height = 8`) | `ShareBar.tsx:9` |
| CSS default height | `8px` | `styles.css:1770`; **[measured]** |
| `.share-bar` | `flex; width:100%; border-radius: 3px; overflow: hidden; gap: 2px; background: var(--line-1)` | `styles.css:1767-1775` |
| **`.share-bar-seg`** | `height:100%; min-width: 2px` — **a segment never renders narrower than 2px** | `styles.css:1777-1781` |
| zero segments | `.filter(s => s.value > 0)` — omitted entirely | `ShareBar.tsx:15` |
| costs variant | `height={10}` | `CostsRoute.tsx:288` |
| total zero | renders the bar with **no children** | `ShareBar.tsx:13` |

**Load-bearing:** the bar is **`8px` tall with a `2px` gap between segments and a `3px` radius** — in a terminal, a
single row of blocks separated by one space. **The `2px` gap is mandatory**: adjacent same-colour segments must stay
distinguishable, which is why `min-width: 2px` exists.

### 8.2 `BarList` — the ranked horizontal bar list

`charts/BarList.tsx:21-49`. DOM:

```
div.bar-list                                flex column; gap:2px
  button.bar-list-row (or div, when no onSelect)   position:relative; flex; align-items:center; gap:10px; height:30px; padding:0 8px; border-radius:6px; isolation:isolate
    span.bar-list-fill[style width:%]       position:absolute; top:3px; bottom:3px; left:0; border-radius:5px; z-index:-1; opacity:0.16
    span.bar-list-label                     flex:1; min-width:0; display:flex; align-items:center; gap:8px; truncate
    span.bar-list-value                     font-mono; 12px; tabular-nums; ink-2
```

| Property | Value | Citation |
|---|---|---|
| **row height** | **`30px`** | `styles.css:1795` |
| `.bar-list` gap | `2px` | `styles.css:1787` |
| **fill opacity** | **`0.16`** — the bar is a *tint behind the label*, not a separate bar | `styles.css:1814` |
| fill inset | `top:3px; bottom:3px` → the fill is `30 - 6 = 24px` tall | `styles.css:1809-1810` |
| **`pct`** | `top > 0 ? Math.max(0.5, (value / top) * 100) : 0` — **floored at 0.5%** so a tiny-but-nonzero row is still visible | `BarList.tsx:26` |
| `max` default | `Math.max(0, ...items.map(i => i.value))` — **relative to the list, not the screen** | `BarList.tsx:22` |
| default display | `formatInteger(value)` | `BarList.tsx:34` |
| default colour | `var(--chart-primary)` | `BarList.tsx:31` |

**Load-bearing:** a BarList row is **30px with the bar drawn BEHIND the label at 16% opacity, 3px inset top and
bottom, label left / value right**. A terminal's rankedBars band should render one row per entry with a background
fill proportional to rank — the reader sees the *ranking* before reading any text.

**Which routes use it:** Projects "Top by cost" (`ProjectsRoute.tsx:127`, `color="var(--chart-secondary)"`) and
"Top by requests" (`:148`); Errors "By model" (`ErrorsRoute.tsx:210`, `.slice(0, 12)`, selected row `var(--bad)` else
`color-mix(in srgb, var(--bad) 45%, transparent)` at `:220`). Those are the only two.

### 8.3 `Legend`

`charts/Legend.tsx:18-48`. DOM:

```
div.legend
  (button|span).legend-item[data-off][title]     inline-flex; align-items:center; gap:6px; max-width:240px
    span.swatch[style background]                8×8, border-radius 2px, display block, flex-shrink 0
    span.truncate                               the label
    span.legend-value[?]                         ← only if item.value provided
```

| Property | Value | Citation / measurement |
|---|---|---|
| `.legend` | `flex; flex-wrap: wrap; gap: 4px 14px; font-size: 12px; color: var(--ink-2)` | `styles.css:1732-1738`; **[measured]** `gap 4px 14px`, `12px`, `rgb(160,160,168)` |
| `.legend-item` | `inline-flex; align-items:center; gap:6px; max-width: 240px` | `styles.css:1740-1746` |
| **`.swatch`** | **`8px × 8px`, `border-radius: 2px`** | `styles.css:` in `ui/Badge.tsx:20-22`; **[measured]** `8×8`, `radius 2px` |
| `.legend-item[data-off]` | `opacity: 0.38` | `styles.css:1752-1754` |
| `.legend-value` | `font-mono; 11.5px; color: var(--ink-3)` | `styles.css:1756-1760` |

### 8.4 **Where a legend sits relative to its chart — the load-bearing fact**

There are exactly **two** placements in the codebase, and they are not interchangeable:

| Placement | DOM | Where | Citation |
|---|---|---|---|
| **BELOW the chart**, inside a `div.stack[style gap:12px]` | `stack > chart` then `stack > legend` | Models Request share, Costs Daily estimate, Tools Calls over time, Providers Burn | `ModelsRoute.tsx:147-169`, `CostsRoute.tsx:112-144`, `ToolsRoute.tsx:160-180`, `ProvidersRoute.tsx:220-241` |
| **BELOW the share bar**, inside a `div.stack[style gap:10px]` | `stack > share-bar` then `stack > legend` | Overview Token mix | `OverviewRoute.tsx:194-212` |
| **INSIDE the card header**, as `actions` | `card-header > card-actions > legend` | Gain "Savings over time" — and note it passes **no `value`**, so it has swatch+label only | `GainRoute.tsx:158` |
| **NO legend at all** | — | Overview Activity (2 series, no legend!), Overview Latest requests, Projects Top by x, Errors By model | `OverviewRoute.tsx:162-180` |

**Load-bearing:** a legend is **12px in `ink-2`, wraps, with `4px` row-gap and `14px` column-gap**, and sits
**below** the chart it describes. The one exception is Gain, where it is in the header *because that card has no
separate legend row*. **Do not put a legend above a chart** — the web never does.

## 9. Grid containers — the two-up layout and when it collapses

`styles.css:699-722`.

| Class | `grid-template-columns` | Breakpoint |
|---|---|---|
| `.grid` | (none — just `display:grid; gap:16px`) | — |
| `.grid-2` | `repeat(2, minmax(0, 1fr))` | collapses at ≤1100px |
| `.grid-3` | `repeat(3, minmax(0, 1fr))` | collapses at ≤1100px |
| **`.grid-main-side`** | **`minmax(0, 2fr) minmax(0, 1fr)`** | collapses at ≤1100px |
| @ `max-width: 1100px` | all three → `minmax(0, 1fr)` | `styles.css:716-722` |

**[measured]** at `1200px`: `.grid-main-side` → `617.328px 308.656px`, `gap 16px`. That is exactly `2fr : 1fr`
on `(942 - 16) = 926px`: `926 × 2/3 = 617.33`, `926 × 1/3 = 308.67`. Confirmed.

**Which route uses which:**

| Route | Container | Children (in order) | Citation |
|---|---|---|---|
| Overview | `.grid .grid-main-side` | **Activity** (2fr), **Token mix** (1fr) | `OverviewRoute.tsx:161-246` |
| Errors | `.grid .grid-main-side` | **Error signatures** (2fr, `flush`), **By model** (1fr) | `ErrorsRoute.tsx:158-227` |
| Providers | `.grid .grid-main-side` | **Burn by provider** (2fr), **Peak burn hours** (1fr) | `ProvidersRoute.tsx:206-249` |
| Projects | `.grid .grid-2` | **Top by cost**, **Top by requests** (1fr each) | `ProjectsRoute.tsx:118-160` |
| Costs | `.grid .grid-main-side` | **Daily estimate** (2fr), **Where it went** (1fr) | `CostsRoute.tsx:89-155` |
| Models / Tools / Requests / Gain | *none* — full-width cards, stacked at `.page` gap `20px` | — | — |

**THE load-bearing consequence for the terminal:** `.grid-main-side` collapses to one column at **1100px**. The
capture widths are 1200px (= terminal 150) and 800px (= terminal 100). So:

- **At terminal width 150**, Activity and Token mix sit **side by side, 2:1**. This is the only width where a
  two-column card arrangement exists in the web.
- **At terminal width 100, 60 and 40** the web is **single-column**. Overview renders Activity above Token mix, full
  width. A terminal that keeps them side by side at 100 columns has invented a layout.

The same applies to `.grid-2` (Projects) and Errors' and Providers' two-up pairs.

## 10. The `.row` and `.stack` primitives

`styles.css:724-736`. Two flexbox utilities, both `min-width: 0`, used ~90 times across the routes. They are the
web's entire layout vocabulary for "things on one line" and "things stacked".

| Class | Definition | Notable overrides |
|---|---|---|
| `.row` | `flex; align-items:center; gap:8px; min-width:0` | `gap:10px` in `LabelCell` (`Table.tsx:222`); `justify-content:space-between` in the agent-share rows (`OverviewRoute.tsx:226`); `justify-content:flex-end` in MeterCell siblings (`ToolsRoute.tsx:390`, `ProvidersRoute.tsx:339`) |
| `.stack` | `flex; flex-direction:column; gap:4px; min-width:0` | `gap:0` in `LabelCell` (`Table.tsx:224`); `gap:16px` grouping two StatGrids (`OverviewRoute.tsx:102`, `ToolsRoute.tsx:84`); `gap:18px` (`OverviewRoute.tsx:194`); `gap:12px` chart+legend (4 sites); `gap:10px` sharebar+legend and agent rows (`OverviewRoute.tsx:195`, `213`); `gap:14px` costs breakdown (`CostsRoute.tsx:286`) |
| `.section-label` | the only *text* primitive — a small caps-ish subheading used for "By agent" | `OverviewRoute.tsx:214` |

**The gap values that recur:** `4` (base stack), `10` (sharebar/legend group), `12` (chart/legend group), `14`
(bill-component list), `16` (two StatGrids; `.grid` gap), `18` (Overview token-mix outer), `20` (`.page` gap).

**Terminal consequence:** this vocabulary maps almost 1:1 onto terminal indentation. A `.stack` of gap 12 is **no
blank line**; a `.page` gap of 20 is **one blank line**; a `.grid` gap of 16 is **one blank line within a section**.
