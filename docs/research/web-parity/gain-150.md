# Gain — 150 columns (1200px viewport)

**Web route:** `routes/GainRoute.tsx`
**IR citation:** `src/layout/spec.ts:1264-1268` —
`lines: "128-152 (StatGrid), 154-170 (Savings over time), 171-173 (By source), 181-227 (columns)"`
**Capture:** `screens/gain-150.png` — live, `#/gain?range=all`, 1200px, dark, fullPage.

> **Range note.** At `range=24h` this screen renders its **`EmptyState`** and no data at all — confirmed live
> (the DOM contains only `div.empty > div.empty-title + div.empty-hint`, and the 24h screenshot is identical at
> every width). Gain data comes from **snapcompact**, which only records once tool output has been compacted, so
> short windows are legitimately empty. All captures for this screen therefore use **`range=all`**. The empty state
> itself is documented at the end of this file.

## Page header

```
h1.page-title        "Gain"                                                    GainRoute.tsx:89-91
p.page-description   "Tokens snapcompact kept out of context in the last 24 hours."   ← range-dependent
                      (…+ scope, where scope = ` for ${project}` when a project filter is set,  :72)
div.page-actions
  select.input[aria-label=Project]  style max-width 320px                        :93-106
     "All projects" + one <option> per project
```

`pageOptions` keeps a selected project selectable even if the current range never saw it (`:70-71`).
`SOURCE_LABEL` maps `snapcompact → "Snapcompact"` (`:29`) — **there is exactly one source in the data model today.**

## Top-level order — **no grid container**, three blocks

| # | Element | Wrapper | `file:line` |
|---|---|---|---|
| 1 | `PageHeader` (with a project `<select>` action) | — | `:89-107` |
| 2 | **StatGrid** — 5 `md` tiles, `min={180}` | `div[data-stale]` | `:131-151` |
| 3 | **Card** "Savings over time" | full width | `:154-169` |
| 4 | **Card** "By source" — `flush` | full width | `:171-173` |

## StatGrid — `--stat-min: 180px`, 5 tiles, **5 columns, no wrap**

`GainRoute.tsx:131-151`. `floor(942/180) = 5` — a clean single row, as at Costs and Projects.

| # | Tile | label | value formatter | hint | spark | `file:line` |
|---|---|---|---|---|---|---|
| 1 | Saved tokens | **`formatCompact(overall.savedTokens)`** `:134` | **`formatInteger(overall.savedTokens)`** `:135` | `spark={series.daily}` `:136` | `:132-137` |
| 2 | Saved bytes | **`formatBytes(overall.savedBytes)`** `:138` | **none** | none | `:138` |
| 3 | Reduction | `overall.reductionPercent !== null ? formatPercent(overall.reductionPercent) : "–"` `:142` | `"original size not recorded"` when null `:143` | none | `:139-144` |
| 4 | Hits | `formatInteger(overall.hits)` `:145` | **none** | none | `:145` |
| 5 | Saved per hit | `overall.hits > 0 ? formatCompact(overall.savedTokens / overall.hits) : "–"` `:148` | `"tokens"` `:149` | none | `:146-150` |

**This is the only stat row in the dashboard where the compact figure is the VALUE and the exact figure is the
HINT.** Tile 1 renders `967M` at 24px and `967,412,830` at 12px below it — the inverse of every other row.
`spec.ts:1273-1278` records exactly this (`metric: gainOverall("savedTokens")`, `hint: gainOverall("savedTokens")`,
both `emphasis: "primary"`).

**`formatCompact` appears twice here** — tile 1's value (`:134`) and tile 5's value (`:148`). `formatInteger`
appears twice — tile 1's hint (`:135`) and tile 4 (`:145`).

**`formatBytes`** (`formatters.ts:100-105`) is used only here: `>= 1e9 → "X.X GB"`, `>= 1e6 → "X.X MB"`,
`>= 1e3 → "X.X KB"`, else `"N B"` — always **exactly one decimal place**, with a **space** before the unit.

**`Reduction` is permanently `"–"` for snapcompact.** The route's `title` reads *"Saved bytes ÷ original bytes,
when the original size is known"* (`:141`) and the hint says `"original size not recorded"` (`:143`). The IR states
this as a rule at `spec.ts:1310-1313`: *"Reduction stays null for snapcompact — original sizes are never recorded —
so the tile reads the web's dash, never 0%."* **A terminal that prints `0.0%` here is wrong.**

Only tile 1 has a hint among tiles 2/4; tiles 2 and 4 are **2-line**, tiles 1/3/5 are 3-line.

`Saved bytes` is **tokens × 4** — the IR says so at `spec.ts:1267` and the tile pair makes it visible: tile 1's
compact token count and tile 2's byte count describe the same quantity in two units.

## Card 1 — "Savings over time"

```
section.card.rise[--i=1]
  h2.card-title        "Savings over time"                              :156
  p.card-description   "Tokens saved per UTC day, with the running total"  :157
  div.card-actions
    div.legend > span.legend-item ×N        ← NO value, NO onToggle     :158
  div.card-body
    div.chart[height:260px]                                              :165
```

**This is the only card on the entire dashboard whose legend sits in the card HEADER rather than below the chart.**
`actions={<Legend items={chartSeries.map(s => ({ key: s.key, label: s.label, color: s.color }))} />}` (`:158`) —
no `value`, no `hidden`, no `onToggle`, so each item renders as a **`span.legend-item`**, not a button
(`charts/Legend.tsx:41-43`). Every other chart card puts its legend in a `div.stack[gap:12px]` after the chart
(`ModelsRoute.tsx:159`, `CostsRoute.tsx:134`, `ToolsRoute.tsx:170`, `ProvidersRoute.tsx:231`).

**The chart has two series on two axes** (`chartSeries`, `:74-84`):

| key | label | colour | kind | axis | values |
|---|---|---|---|---|---|
| `daily` | `Saved per day` | `var(--chart-primary)` (cyan) | bars (default `kind`) | left | `series.daily` — `densify(points, buckets, p => p.snapcompact)` `:53` |
| `cumulative` | `Cumulative` | `var(--chart-secondary)` (pink) | **`kind: "line"`** | **`axis: "right"`** | `series.cumulative` — a running sum `:54-55` |

**This is the only chart in the dashboard with a right axis and the only one with a bar+line combination.**
Consequences from `Chart.tsx`:
- `daily` is **stacked**; `cumulative` is **not** (`stackable = stacked && (s.kind ?? kind) !== "line"`, `:83`).
- `cumulative` is a **right-axis** series, and right-axis series never stack (`:124`).
- Therefore `padRight = max(28, labelWidth(rightLabels) + 12)` instead of the `8` used with no right axis (`:115`).
- `cumulative`'s line is drawn with `stroke-width: 1.5` and `vector-effect: non-scaling-stroke`
  (`styles.css:1659-1665`).
- The chart fills `4` y-ticks on each axis from `niceScale` (`:354-364`), both starting at 0.

`Chart slots={series.buckets.length}` `:162`, `tickLabel={i => DAY_LABEL.format(series.buckets[i])}` `:163`,
`height={260}` `:165`, `formatTooltip={formatInteger}` `:166`, **`formatRight={formatCompact}`** `:167`.

**`DAY_LABEL` is a UTC formatter** — `new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric",
timeZone: "UTC" })` (`:32`) — because the server buckets gain by **UTC calendar day** (`YYYY-MM-DD`, comment `:31`)
and the series parses `Date.parse(\`${p.date}T00:00:00Z\`)` (`:47`).

This is **not** a `TimeChart`: `TimeChart` derives `tickLabel` from `formatTick` (`charts/TimeChart.tsx:17`), which
is local-time-aware (`data/range.ts:44-53`). Gain needs UTC, so it calls `Chart` directly. That is a real
distinction a port must preserve.

## Card 2 — "By source" — `flush`, 6 columns, no `limit`

```
section.card.rise[--i=2] flush
  h2.card-title        "By source"                     :171
  p.card-description   "Savings per subsystem"          :171
  (no card-actions)
  div.card-body[data-flush=true]
    div.table-wrap > table.table[data-dense=false]
      thead > tr > th ×6
      tbody > tr ×N
```

`<Table rows={sourceRows} rowKey={row => row.source} columns={SOURCE_COLUMNS} />` (`:172`) — **no `limit`, no
`dense`, no `initialSort`.** Measured `data-dense=false` and no `.table-more`. With one source in the data model
there is a single row.

### Columns — `SOURCE_COLUMNS`, `GainRoute.tsx:181-229`. Six.

| # | key | header | align | cell | formatter, verbatim | `file:line` |
|---|---|---|---|---|---|---|
| 1 | `source` | `Source` | left | `span.cell-primary` — **not a `LabelCell`, so a single line** | `SOURCE_LABEL[row.source]` `:186` | `:182-187` |
| 2 | `tokens` | `Saved tokens` | **right** | **`MeterCell` `max={1}`** — the bar IS the share | **`formatCompact(row.savedTokens)`** `:195` (tooltip `formatInteger(row.savedTokens)` `:194`) | `:188-198` |
| 3 | `share` | `Share` | **right** | `span.num.muted` | `formatPercent(row.share)` `:204` | `:199-205` |
| 4 | `bytes` | `Saved bytes` | **right** | `span.num` | **`formatBytes(row.savedBytes)`** `:211` | `:206-212` |
| 5 | `hits` | `Hits` | **right** | `span.num` | `formatInteger(row.hits)` `:218` | `:213-219` |
| 6 | `reduction` | `Reduction` | **right** | `span.num`, `"–"` when null `:226` | `row.reductionPercent !== null ? formatPercent(row.reductionPercent) : "–"` | `:220-228` |

**`MeterCell max={1}` is unique in the dashboard** (`:195`). Everywhere else the `max` is a column maximum; here the
bar length **is** the share, so the bar and the `Share` column say the same thing twice by design. `sort: row =>
row.share` (`:203`) — the column sorts by the bar's quantity, not by the displayed token count.

**`formatBytes` appears in two places** — the Saved-bytes tile (`:138`) and the Saved-bytes column (`:211`) — and
nowhere else in the entire dashboard.

`share = data.bySource[source].savedTokens / data.overall.savedTokens` (`:65`) — a fraction of the **grand** total,
matching `ProvidersRoute.tsx:378`'s convention and `spec.ts:1304`'s `againstScope: "total"`.

## The empty state (what `range=24h` actually renders)

Confirmed live at `range=24h`:

```
section.card
  div.card-body[data-flush=false]
    div.empty
      svg (Inbox, 20px, --ink-4)
      div.empty-title      "…"
      div.empty-hint       "Savings appear here once snapcompact compacts tool output."  |  "Try a longer range."
```

`.empty` is `flex column; align-items:center; justify-content:center; gap:6px; padding:40px 16px; text-align:center;
color: var(--ink-3); min-height: 140px` (`styles.css:1408-1418`); `.empty-title` is `ink-2` at weight 500 (`:1425-1428`);
`.empty-hint` is `12.5px` with `max-width: 44ch` (`:1430-1433`). The hint text is chosen by range at `:119-123`:
`range === "all"` → *"Savings appear here once snapcompact compacts tool output."*, otherwise *"Try a longer range."*

**No StatGrid, no table, no chart, no header actions appear at all** when the payload is empty — the entire page is
one `Card` wrapping an `EmptyState`. A terminal that renders an empty stat row plus an empty table has invented a
structure the web does not have.

## Notable formatter calls, verbatim

```
formatCompact(overall.savedTokens)                                   GainRoute.tsx:134
formatInteger(overall.savedTokens)                                   GainRoute.tsx:135
formatBytes(overall.savedBytes)                                      GainRoute.tsx:138
overall.reductionPercent !== null ? formatPercent(overall.reductionPercent) : "–"    :142
formatInteger(overall.hits)                                          GainRoute.tsx:145
overall.hits > 0 ? formatCompact(overall.savedTokens / overall.hits) : "–"           :148
formatInteger(row.savedTokens)          (MeterCell tooltip)         GainRoute.tsx:194
formatCompact(row.savedTokens)                                     GainRoute.tsx:195
formatPercent(row.share)                                             GainRoute.tsx:204
formatBytes(row.savedBytes)                                          GainRoute.tsx:211
formatInteger(row.hits)                                              GainRoute.tsx:218
row.reductionPercent !== null ? formatPercent(row.reductionPercent) : "–"         :226
```

## Terminal shape at 150 columns

```
Gain                                                       ← 22px @ 600
Tokens snapcompact kept out of context in all time.          [All projects ▾]

  Saved tokens     967M         ← 24px formatCompact…
    967,412,830                 ← …with the exact integer as the 12px foot
  Saved bytes      3.7 GB       ← formatBytes: one decimal, space before unit
  Reduction        –            ← the web's dash, NEVER 0.0%
    original size not recorded
  Hits             1,204
  Saved per hit    802K         ← formatCompact(tokens / hits)
    tokens
                        ← 5 tiles, ONE row, no wrap

─ Savings over time ── Tokens saved per UTC day, with the running total ──
  ▪ Saved per day   ▪ Cumulative         ← legend is in the HEADER, no values
  bars (cyan, stacked, left axis) + line (pink, right axis, formatCompact ticks)
  UTC day ticks "Sep 28", "Sep 29", …  (DAY_LABEL, timeZone: "UTC")
─ By source ───────────────── Savings per subsystem ─────────────────
  Source        Saved tokens  Share  Saved bytes  Hits  Reduction
  Snapcompact   967M ▓▓▓▓▓▓▓▓ 99.9% 3.7 GB       1,204  –
                ↑ MeterCell max={1}: the bar IS the share
```

- **The only screen with a header legend** (`:158`) and **the only chart with a right axis** (`:74-84`).
- **`Reduction` is `"–"` at both the stat and the table level** — snapcompact never records an original size.
- **`formatBytes` is used on exactly one screen**, twice.
