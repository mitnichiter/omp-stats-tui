# F21 — Web dashboard layout specification (per screen)

**Purpose:** a per-screen description of how the ORIGINAL web dashboard lays each screen out,
so the terminal port can mirror it band by band instead of inventing its own stacking.

**Method:** read only. Every claim below is quoted from source with `file:line`. Where a screen
renders nothing meaningful, that is said rather than filled in. No production code was written.

**Package under study:** `@oh-my-pi/omp-stats` v?. `src/client/` — read-only, never modified.

---

## 1. Overview — `routes/OverviewRoute.tsx`

### Section order (top to bottom, exactly as the JSX nests it)

| # | Band | Component | Source |
|---|---|---|---|
| 0 | Page header | `PageHeader` | `OverviewRoute.tsx:97` |
| 1 | Primary stat band (5 tiles) | `StatGrid min={190}` | `OverviewRoute.tsx:102-141` |
| 2 | Secondary stat band (8 small tiles) | `StatGrid min={140}` | `OverviewRoute.tsx:142-155` |
| 3 | Two-column band: chart + share | `div.grid-main-side` | `OverviewRoute.tsx:160` |
| 3a | └ "Activity" | `Card index={1}` → `TimeChart` | `OverviewRoute.tsx:161-179` |
| 3b | └ "Token mix" | `Card index={2}` → `ShareBar` + `Legend` + a second `ShareBar` | `OverviewRoute.tsx:181-244` |
| 4 | Table band | `Card index={3}` "Latest requests" → `Table dense` | `OverviewRoute.tsx:247-273` |

**Five bands**, two of which (1 and 2) are stat grids and one of which (3) is a 2:1 split.

### Visual identity of each section

Bands 1 and 2 are **not cards and not bare text** — they are a shared surface that the tiles
divide with hairlines. `Stat.tsx:58` calls this out: `/** Tiles sharing one card, separated by
hairlines. */`, and the tile carries the separator itself (`Stat.tsx:36-37`):

```tsx
<div className="stat" data-size={size} title={title}>
```

with `box-shadow: 1px 0 0 var(--line-1), 0 1px 0 var(--line-1);` (`styles.css:834-836`).

Band 3a and 3b are **real `Card`s**, each with a title, a description, and — for 3a — a
right-aligned `Segmented` control in the header:

```tsx
<Card
	index={1}
	title="Activity"
	description={`Per ${meta.bucketMs < 3_600_000 ? "5 minutes" : meta.bucketMs < 86_400_000 ? "hour" : "day"}`}
	actions={<Segmented size="sm" options={ACTIVITY_OPTIONS} value={metric} onChange={setMetric} />}
	stale={overview.stale}
>
```
`OverviewRoute.tsx:161-167`

Band 4 is a `Card` with `flush`, so the table runs full-bleed to the card edge, and its title
carries a live indicator:

```tsx
title={
	<>
		<Dot tone="live" pulse /> Latest requests
	</>
}
```
`OverviewRoute.tsx:249-253`

### KPI tiles at the top

Band 1, five tiles, each `label` / big `value` / `hint` / optional `spark` (`Stat.tsx:32-47`):

| Label | Value | Hint | Sparkline |
|---|---|---|---|
| `API-equivalent cost` | `formatEstimatedCost(totalCost, unpricedRequests)` | `"N unpriced"` when non-zero | `series.cost`, secondary colour |
| `Requests` | `formatInteger(totalRequests)` | `"N failed"` | `series.all` |
| `Conversation tokens` | `formatCompact(sumConversationTokens(overall))` | `"N output"` | `series.tokens` |
| `Cache rate` | `formatPercent(cacheRate)` | `"N% saved"` | — |
| `Error rate` | `formatPercent(errorRate)` | `"N succeeded"` | `series.errors`, `--bad` |

(`OverviewRoute.tsx:103-140`.) **Four of five tiles carry a sparkline.** The sparkline is a
fixed-height strip under the value: `.stat-spark { margin-top: 2px; height: 28px; }`
(`styles.css:872-875`).

Band 2 is **eight `size="sm"` tiles with no hint and no sparkline** — a flat reference row:

```tsx
<Stat size="sm" label="Uncached input" value={formatCompact(overall.totalInputTokens)} />
<Stat size="sm" label="Cache read" value={formatCompact(overall.totalCacheReadTokens)} />
<Stat size="sm" label="Cache write" value={formatCompact(overall.totalCacheWriteTokens)} />
<Stat size="sm" label="Output" value={formatCompact(overall.totalOutputTokens)} />
```
`OverviewRoute.tsx:143-146` — plus Premium requests, Tokens/s, Avg latency, Avg TTFT
(`:147-154`).

### Chart sections

`TimeChart` is `Chart` over a time axis (`TimeChart.tsx:12-21`). Props on band 3a:

- `height={260}` — **pixels, axes included** (`Chart.tsx:29`: `/** Plot height in px (axes included). Default 220. */`)
- series is **metric-dependent**: requests splits into two stacked series (`Succeeded` /
  `Failed`, `OverviewRoute.tsx:88-90`), tokens is one series, cost is one series named
  `API-equivalent` (`:91-93`)
- `format` switches to `formatEstimatedCost` for cost (`:175`)
- the chart has **no title of its own** — the title is the `Card`'s. It has a `Segmented`
  control in the card header instead.

Band 3b has **no chart at all**: a `ShareBar`, a `Legend` carrying a percentage per token
class, a `section-label` "By agent", a second `ShareBar`, and a per-agent row list with a
right-aligned share column (`OverviewRoute.tsx:193-240`).

### Table columns

`REQUEST_COLUMNS` (`OverviewRoute.tsx:278-314`): Model (`LabelCell` primary/secondary), When,
Tokens (right), Cost (right), Duration (right), Status (right, `Badge` OK/Failed). **No footer
or summary row.** `dense`, clickable rows, no `limit` shown here.

---

## 2. Models — `routes/ModelsRoute.tsx`

### Section order

| # | Band | Component | Source |
|---|---|---|---|
| 0 | Header | `PageHeader` | `ModelsRoute.tsx:74` |
| 1 | Stat band (4 tiles) | `StatGrid min={200}` | `ModelsRoute.tsx:88-118` |
| 2 | Chart band | `Card index={1}` "Request share" → `TimeChart` + `Legend` | `ModelsRoute.tsx:124-172` |
| 3 | Table band | `Card index={2}` "All models", `flush` → `Table` | `ModelsRoute.tsx:174-211` |

**Four bands.** The chart is full-width here, not in a grid — `Models` has no `grid-main-side`.

### Tiles

Models used · Most used (model name, hint = "% of requests · provider") · Requests (spark =
`view.requestTotals`) · API-equivalent cost (`ModelsRoute.tsx:89-117`).

### Chart section

`TimeChart` with a `Segmented` in the card header switching between **share** and **count**
(`ModelsRoute.tsx:132-139`). `height={260}`; `yMax={mode === "share" ? 1 : undefined}`;
`showTotal={mode === "requests"}` (`:147-157`). The `Legend` below it is **interactive** —
`onToggle={toggleSeries}` (`:166`) — and every legend item carries its own share percentage
(`:163`).

### Table columns

`buildModelColumns` (`ModelsRoute.tsx:311-433`): expand chevron (width 28, empty header),
Model (`LabelCell` with a colour swatch, provider as secondary line), Requests (right, rendered
as a **`MeterCell`** — a right-aligned number with a proportional bar), Cost (right), Tokens
(right), Cache rate (right), Errors (right), plus latency/throughput columns. `initialSort`
requests desc, `limit={25}`, rows **expand into a detail chart** (`ModelDetail`, `:195-206`).

---

## 3. Costs — `routes/CostsRoute.tsx`

### Section order

| # | Band | Component | Source |
|---|---|---|---|
| 0 | Header | `PageHeader` | `CostsRoute.tsx:75` |
| 1 | Stat band (5 tiles) | `CostStats` → `StatGrid min={180}` | `CostsRoute.tsx:86`, `:246-279` |
| 2 | Two-column band | `div.grid-main-side` | `CostsRoute.tsx:89` |
| 2a | └ "Daily estimate" | `Card index={1}` → `Chart` + `Legend` | `CostsRoute.tsx:90-148` |
| 2b | └ "Where it went" | `Card index={2}` → `ComponentBreakdown` | `CostsRoute.tsx:150-154` |
| 3 | Table band | `Card index={3}` "By model", `flush` → `Table` | `CostsRoute.tsx:157-177` |

**Five bands.**

### Tiles

API-equivalent estimate (spark = daily totals) · Average per day · Top model · Per priced
request · **Unpriced requests** (`CostsRoute.tsx:247-278`). The last is a first-class tile, not
a hint: `hint={summary.unpricedRequests > 0 ? "excluded from the estimate" : "all usage priced"}`
(`:277`).

### Chart section

Uses `Chart` directly, not `TimeChart` (`:113-133`) — `slots={view.buckets.length}` with a UTC
day `tickLabel`. `height={280}` px. Series are stacked by billing component or by model,
switched by a `Segmented` (`:97-104`). `tooltipExtra` injects an "Unpriced requests" row into
the tooltip when a bucket has any (`:123-132`). `emptyLabel="No priced usage in this range"`.

Band 2b is a `ShareBar height={10}` plus a per-component row list with cost and share
(`CostsRoute.tsx:287-303`).

### Table columns

`buildCostColumns(view)`, `initialSort` cost desc, `limit={20}` (`CostsRoute.tsx:167-173`).

---

## 4. Projects — `routes/ProjectsRoute.tsx`

| # | Band | Component | Source |
|---|---|---|---|
| 0 | Header | `PageHeader` | `ProjectsRoute.tsx:78` |
| 1 | Stat band (5 tiles) | `StatGrid min={180}` | `ProjectsRoute.tsx:83-112` |
| 2 | Two-column band | `div.grid-2` (1:1) | `ProjectsRoute.tsx:117` |
| 2a | └ "Top by cost" | `Card index={1}` → `BarList` | `ProjectsRoute.tsx:118-138` |
| 2b | └ "Top by requests" | `Card index={2}` → `BarList` | `ProjectsRoute.tsx:139-158` |
| 3 | Table band | `Card index={3}` "Folders", `flush` → `Table` | `ProjectsRoute.tsx:161-213` |

**Five bands.** This is the only screen whose chart band is a **pair of identical ranked lists**
rather than a time chart. Each `BarList` item's display string is `cost · share`
(`ProjectsRoute.tsx:131`) or `requests · share` (`:152`).

Table has `initialSort` cost desc, `limit={TABLE_LIMIT}`, `dense`, and a filter `SearchInput`
plus a "Hide temporary" checkbox in the card actions (`ProjectsRoute.tsx:171-185`).

---

## 5. Tools — `routes/ToolsRoute.tsx`

| # | Band | Component | Source |
|---|---|---|---|
| 0 | Header | `PageHeader` | `ToolsRoute.tsx:74` |
| 1 | Primary stat band (5) | `StatGrid min={190}` | `ToolsRoute.tsx:84-120` |
| 2 | Secondary stat band (4 small) | `StatGrid min={150}` | `ToolsRoute.tsx:121-144` |
| 3 | Chart band | `Card index={1}` → `TimeChart` + `Legend` | `ToolsRoute.tsx:150-182` |
| 4 | Table band | `Card index={2}` "By tool", `flush` → `Table` | `ToolsRoute.tsx:184-205` |
| 5 | Second table band | `Card index={3}` "By tool and model", `flush` → `Table` | `ToolsRoute.tsx:207-248` |

**Six bands — the most of any screen.** Tiles are wrapped in a `stack gap:16` so bands 1 and 2
sit as one visual group (`ToolsRoute.tsx:83`).

The chart's title is **state-dependent**: `title={metric === "calls" ? "Calls over time" :
"Errors over time"}` (`ToolsRoute.tsx:152`), with a `Segmented` in the header. Stacked, top
`TOP_TOOLS`, `height={260}`, interactive `Legend` (`:160-178`).

---

## 6. Providers — `routes/ProvidersRoute.tsx`

| # | Band | Component | Source |
|---|---|---|---|
| 0 | Header | `PageHeader` | `ProvidersRoute.tsx:145` |
| 1 | Stat band (5) | `StatGrid min={190}` | `ProvidersRoute.tsx:153-184` |
| 2 | Table band | `Card index={1}` "Provider totals", `flush` → `ProviderTotalsTable` | `ProvidersRoute.tsx:189-203` |
| 3 | Two-column band | `div.grid-main-side` | `ProvidersRoute.tsx:205` |
| 3a | └ "Burn by provider" | `Card index={2}` → `TimeChart` + `Legend` | `ProvidersRoute.tsx:206-243` |
| 3b | └ peak-hours card | `PeakHoursCard` | `ProvidersRoute.tsx:245-247` |
| 4 | Table band | `Card index={4}` "Subscription windows", `flush` | `ProvidersRoute.tsx:250-260` |
| 5 | Card | `WindowUtilizationCard` | `ProvidersRoute.tsx:262-267` |

**Providers is the only screen where a table band precedes the chart band** — the table
(`index={1}`) is at `ProvidersRoute.tsx:189`, the chart (`index={2}`) at `:206`.

Band 3b is selected dynamically, so its content is range-dependent, but it always occupies the
**narrow 1fr side** of the split.

---

## 7. Requests — `routes/RequestsRoute.tsx`

| # | Band | Component | Source |
|---|---|---|---|
| 0 | Header | `PageHeader` | `RequestsRoute.tsx:107` |
| 1 | Stat band (6) | `StatGrid min={160}` | `RequestsRoute.tsx:115-151` |
| 2 | Table band | `Card index={1}` "Request log", `flush`, **with `footer`** → `Table` | `RequestsRoute.tsx:156-212` |

**Three bands — the fewest. There is no chart at all.** The screen is stats + table.

This is the one screen that uses `Card`'s `footer` prop (`Card.tsx:10`), to state that older
requests are not loaded (`RequestsRoute.tsx:180-191`). Table: `initialSort` time desc,
`limit={100}`, `dense`, `SearchInput` + status `Segmented` in the actions (`:166-177`).

---

## 8. Errors — `routes/ErrorsRoute.tsx`

| # | Band | Component | Source |
|---|---|---|---|
| 0 | Header | `PageHeader` | `ErrorsRoute.tsx:123` |
| 1 | Stat band (4) | `StatGrid min={170}` | `ErrorsRoute.tsx:131-153` |
| 2 | Two-column band | `div.grid-main-side` | `ErrorsRoute.tsx:158` |
| 2a | └ "Error signatures" | `Card index={1}`, `flush` → `Table` | `ErrorsRoute.tsx:159-195` |
| 2b | └ "By model" | `Card index={2}` → `BarList` | `ErrorsRoute.tsx:197-226` |
| 3 | Table band | `Card index={3}` "Failures", `flush`, `footer` → `Table` | `ErrorsRoute.tsx:229-288` |

**Five bands**, and **two of them are tables**. Band 2 is the only place in the whole dashboard
where a table and a ranked list sit side by side in the same 2:1 split.

---

## Shared layout grammar

This is the part the terminal port should reproduce structurally.

**A screen is a vertical stack of bands.** `.page { display: flex; flex-direction: column;
gap: 20px; }` (`styles.css:663-667`) — one uniform 20px gutter between every band, no
per-screen rhythm.

**There are exactly four band shapes**, and every route is a sequence of them:

1. **`StatGrid`** — a run of 3–8 tiles on one shared surface, separated by hairlines.
   `grid-template-columns: repeat(auto-fit, minmax(var(--stat-min), 1fr))` (`styles.css:817`),
   so it wraps rather than scrolls. Every route opens with one. Two of them (Overview, Tools)
   stack a second `StatGrid min={140|150}` of `size="sm"` tiles directly beneath the first,
   inside the same `stack gap:16` — a **primary band** and a **secondary band**.
2. **`Card` containing a chart** — header (`title` + `description` + optional `actions`), then
   `Chart`/`TimeChart`, then usually a `Legend`. Height is **px, axes included** (`Chart.tsx:29`).
3. **`Card` containing a ranked list** — `BarList` (`BarList.tsx:21`) or a `ShareBar` plus a
   labelled row list. Used instead of a chart when the dimension is categorical, not temporal.
4. **`Card` containing a `Table`**, almost always `flush`. Sorting is per-column via `sort`
   (`Table.tsx:11`), alignment is per-column via `align` (`:12`), numeric columns are
   right-aligned and typically rendered in a `.num` tabular-figure span. A `limit` adds a
   "N of M" footer row (`Table.tsx:155-160`); `expanded` inserts a detail row *under* the row
   (`Table.tsx:142-148`).

**Charts never carry their own title.** The title belongs to the enclosing `Card`
(`Card.tsx:30`). What sits in the card header instead is a `Segmented` metric toggle
(`Card.tsx:33` → `.card-actions`), and on Overview/Models/Tools/Providers/Costs that toggle is
the thing that changes what the chart is showing. **This is the single most transferable
structural fact**: a terminal port should give each chart band a title line and a metric
indicator, not a standalone chart heading.

**Two-column bands are `grid-main-side`, not arbitrary.** `minmax(0, 2fr) minmax(0, 1fr)`
(`styles.css:712-714`), collapsing to one column below 1100px (`:717-721`). Projects uses
`grid-2`, a 1:1 pair (`styles.css:704-706`). **In every `grid-main-side`, the left card is the
time chart and the right card is a share/rank breakdown.** Not one exception across the eight
routes.

**Card headers are three-part:** title left, description under it in `--ink-2`
(`styles.css:31`, capped at `max-width: 72ch`), actions right. The description is not
decoration — it carries the bucket unit ("Per hour", "Per UTC day") and, on Costs and
Providers, the **unpriced caveat in prose** (`CostsRoute.tsx:77`,
`ProvidersRoute.tsx:193-196`).

**Tables have no footer summary row.** The only footers are `Card footer` prose about
incompleteness (`RequestsRoute.tsx:180-191`, `ErrorsRoute.tsx:267`) and the "N of M" counter
`Table` emits itself when `limit` is set.

**Stat tiles are three lines, not one:** label, big value, then a `hint` line, then optionally a
28px sparkline (`Stat.tsx:33-47`). The `hint` line is where secondary figures live —
`"N failed"`, `"N% saved"`, `"N output"`, `"N unpriced"`.

---

## Divergences from our screens

### `overview` — diverges most, and structurally

Web order: **stats(5) → stats(8 small) → [chart | share] → table** (`OverviewRoute.tsx:102`,
`:142`, `:160`, `:247`).

Ours: **stat strip(4) → token list → cost bars → ranked model list → staleness footer**
(`src/tui/screens/overview.ts:368`, `:394`, `:427`, `:457`, `:476`).

Missing or wrong, in order of how much they cost the resemblance:

1. **No table band at all.** The web Overview ends in a six-column "Latest requests" table
   (`OverviewRoute.tsx:247-273`). Ours ends in a bar list. This is the largest single gap.
2. **No share band.** The web has a "Token mix" side card with a `ShareBar`, a four-way
   `Legend` carrying percentages, and a second "By agent" share
   (`OverviewRoute.tsx:181-244`). We have no `ShareBar` and no `Legend` anywhere on this
   screen — our token section is a plain `label value` list.
3. **The second small stat band is gone.** Web has 8 `size="sm"` tiles
   (`OverviewRoute.tsx:142-155`): Premium requests, Tokens/s, Avg latency, Avg TTFT are missing
   from ours entirely.
4. **The chart band is the wrong chart.** Web's band 3a is "Activity" with a
   `Segmented` over requests/tokens/cost, stacked succeeded/failed
   (`OverviewRoute.tsx:85-93`, `:165`). Ours is a cost-only bar chart with no toggle and no
   ok/err split. The cost chart is the *cost* metric of a three-metric control, not the band.
5. **Tile composition differs.** Web's cost tile is 1st of 5 and carries a sparkline
   (`OverviewRoute.tsx:103-114`); ours is 2nd of 4 with none.
6. **Repeated rules.** Ours draws a `rule()` under the screen title and again under each of its
   three section headings (`overview.ts:368`, `:394`, `:427`, `:457`). The web has one surface
   per band and no rule inside a band — the hairline is between tiles, not above them. This is
   the "stacked text blocks with repeated dividers" complaint, literally.

### `models` — right shape, wrong emphasis

Web order: **stats(4) → chart("Request share", segmented share/count) → table("All models",
meter cells, expandable)** (`ModelsRoute.tsx:88`, `:124`, `:174`).

Ours: **stats → "Cost by model" bars → "Cost by provider" bars → detail rows**
(`models.ts:400`, `:403`, `:420`, `:441`).

1. **No table band.** The web model's band 3 is a nine-column sortable table with `MeterCell`
   bars and row expansion into a latency/throughput chart (`ModelsRoute.tsx:174-211`,
   `:335-348`). Ours has ranked bars instead — a BarList where the original has a Table.
2. **Chart is missing entirely.** The web's band 2 is a stacked/share `TimeChart` per bucket,
   interactive legend with per-model share percentages (`ModelsRoute.tsx:146-167`). Ours has no
   time axis on this screen at all.
3. **Wrong ranking dimension.** The web ranks by **requests**; ours ranks by **cost**. The
   screen is literally titled "Request share" (`ModelsRoute.tsx:126`).
4. **"Cost by provider" has no counterpart at all** (`models.ts:420`). The web groups models by
   provider only as a secondary line inside the model table's `LabelCell`
   (`ModelsRoute.tsx:331`).

### `activity` — smallest divergence, but on the wrong axis

`activity` is not one of the eight web routes; its counterpart is the Overview "Activity" card
(`OverviewRoute.tsx:161-179`). Ours renders a calendar heatmap (`activity.ts:172-194`).

The web Activity is a **vertical bar chart of buckets over time with a metric toggle**; ours is
a **calendar grid of days**. Neither is wrong — the calendar is arguably better for spotting
gaps — but the divergence is a deliberate substitution, not an oversight, and it means activity
cannot be compared band-for-band with the original. Worth recording as a conscious choice
rather than a bug.

---

## Sources

Read, all under `~/.bun/install/global/node_modules/@oh-my-pi/omp-stats/src/client/`:

- `routes/OverviewRoute.tsx` (314 lines) — full read
- `routes/ModelsRoute.tsx` (576) — render body + `buildModelsView` + `buildModelColumns`
- `routes/CostsRoute.tsx` (424) — render body + `CostStats` + `ComponentBreakdown`
- `routes/ProjectsRoute.tsx` (319) — render body
- `routes/ToolsRoute.tsx` (572) — render body
- `routes/ProvidersRoute.tsx` (1050) — render body
- `routes/RequestsRoute.tsx` (311) — render body + column defs
- `routes/ErrorsRoute.tsx` (421) — render body + `buildGroupColumns`
- `ui/Card.tsx` (61), `ui/Stat.tsx` (104), `ui/Table.tsx` (230), `ui/Segmented.tsx`
- `charts/Chart.tsx` (props), `charts/TimeChart.tsx` (22), `charts/BarList.tsx` (49),
  `charts/Legend.tsx` (61)
- `styles.css` — `.page`, `.grid-2`, `.grid-main-side`, `.stack`, `.stat*` rules
- `data/range.ts` — `RANGE_META`, the source of every "Per hour / Per day" description

## Gaps

1. **`activity` has no web counterpart.** Its nearest equivalent is the Overview "Activity"
   card. There is no `ActivityRoute.tsx` in `routes/`, so no band-for-band spec exists for it.
2. **`GainRoute.tsx`, `TracesRoute.tsx`, `FrustrationRoute.tsx` were not specified.** They are
   the last three routes; `traces` and `frustration` are excluded from the terminal port, and
   `gain` has no implemented TUI counterpart yet.
3. **CSS is read, not rendered.** Band heights, hairlines and card borders are inferred from
   `styles.css` declarations rather than observed in a browser. The `20px` page gutter
   (`styles.css:663-667`) and the `16px` grid gap (`:704`) are the only numbers quoted.
4. **`Segmented.tsx` was not read in full.** Its visual weight in a terminal port is
   undetermined; it is only cited here for its position in the `Card` header slot.
5. **Provider bands 3b/5 are range-dependent** (`ProvidersRoute.tsx:245-247`, `:262-267`) and
   their contents were not traced.
6. **`Cost` has a `footer` prop that no route in these eight uses** (`Card.tsx:10`). Whether the
   terminal port should have a footer slot at all is therefore unresolved by this document.
7. **Column widths for tables are mostly unset.** Only the Models expand column declares one
   (`width: 28`, `ModelsRoute.tsx:316`); the rest are content-sized, so a terminal port cannot
   derive column widths from this source.