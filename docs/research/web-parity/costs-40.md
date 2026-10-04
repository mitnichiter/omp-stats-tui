# Costs — 40 columns (320px viewport)

**Web route:** `routes/CostsRoute.tsx` · **IR citation:** `src/layout/spec.ts:617-620`
**Capture:** `screens/costs-40.png` — live, `#/costs?range=24h`, 320px, dark, fullPage. Page height **1970px**.
Full column/format detail: **`costs-150.md`**. All deltas measured live.

## Measured at 320px

| Property | At 1200px | **At 320px** |
|---|---|---|
| `.shell-content` padded box | `986px` | **`302px`** (inner `270px`) |
| `--gutter` | `22px` | `16px` |
| `.grid-main-side` | `617px 309px` | **`270px` — ONE column** |
| StatGrid (`min 180`) | 5 cols | **1 column** — all 5 tiles stack |
| By-model table | 11 cols, `940px` client, `1117px` scroll | 11 cols, **`268px` client**, `1117px` scroll → **+849px (4.17×)** |
| `data-dense` | `false` | `false` |

**The load-bearing number: at 320px the Costs table overflows 4.17×.** `nowrap` on every cell
(`styles.css:1278`, `1317`) plus `overflow-x: auto` on the wrapper (`styles.css:1259-1262`) means the web's only
move is the scrollbar. Nothing is dropped, nothing wraps, nothing reorders. The page simply grows taller
(1137px → 1970px) as every grid collapses to one column.

## Page header

```
h1.page-title        "Costs"
p.page-description   "What the last 24 hours of usage would cost at public API rates. Subscription usage without a
                      public price is called out separately and never folded into the total."
(no .page-actions)
```
Description wraps to ~4 lines at 270px (`max-width: 72ch`, `styles.css:688`).

## Top-level order — unchanged by width

| # | Element | `file:line` |
|---|---|---|
| 1 | `PageHeader` | `CostsRoute.tsx:74-79` |
| 2 | StatGrid — 5 `md` tiles, `min={180}` → **1 col** | `:240-282` |
| 3 | Daily estimate (270px) → Where it went (270px) | `:89-155` |
| 4 | Card "By model" — `flush`, `limit={20}` | `:157-177` |

## StatGrid — one tile per row

| # | Tile | value formatter | hint formatter | spark |
|---|---|---|---|---|
| 1 | API-equivalent estimate | `formatEstimatedCost(summary.totalCost, summary.unpricedRequests)` `:250` | `formatInteger(summary.requests)` `:251` | `view.dailyTotals`, `var(--chart-secondary)` `:252-253` |
| 2 | Average per day | `formatEstimatedCost(summary.avgDailyCost, summary.unpricedRequests)` `:258` | `formatInteger(summary.activeDays)` `:259` | none |
| 3 | Top model | `top ? top.model : "–"` `:264` | `formatCost(top.cost)` + `formatPercent(top.share)` `:265` | none |
| 4 | Per priced request | `formatUnitCost(summary.totalCost / pricedRequests)` `:270` | `formatInteger(pricedRequests)` `:271` | none |
| 5 | Unpriced requests | `formatInteger(summary.unpricedRequests)` `:276` | `"excluded from the estimate"` `:277` | none |

**No `formatCompact` on this row at any width.** Tile 3 is a **string** in a `24px` `nowrap`+`ellipsis`
`.stat-value` (`styles.css:848-857`) — at 270px a model name ellipsises hard; the `title` (`:263`) carries it in full.

**The five tiles are 2-line, 2-line, 2-line, 2-line, 2-line** — every one has a hint, so every one renders a
`.stat-foot` (`Stat.tsx:37-42`). Tiles 1's sparkline is 28px tall (`styles.css:876-879`) and the rest have none, so
tile 1 is the tallest of the five.

## Card 1 — "Daily estimate" (270px)

- Title `:92`, description `"Per UTC day, stacked by model"` `:94`, `Segmented[sm]` MODEL | COMPONENT `:97-103`.
  `.card-actions` is `flex-wrap: wrap` (`styles.css:788`), so the Segmented drops below the title at this width.
- `Chart height={280}` `:119`, stacked, **236px wide**. `padLeft = 28`, `padRight = 8`, plot ≈ `200px`.
  2 daily buckets → `slotW ≈ 100px` → **`barW = min(56, 100 × 0.72) = 56px`** — the cap governs.
- `format={v => formatCost(v, Number.isInteger(v) ? 0 : 2)}` `:120`; `tooltipExtra` unpriced row `:123-132`.
- `Legend` below, `div.stack[gap:12]` `:112`, `value = formatCost(sum(s.values))` `:139`; wraps to 1 item per row
  (`styles.css:1733`).

## Card 2 — "Where it went" (270px)

- Title `:150`, description `:150`. No actions.
- `div.stack[gap:14]` `:286` → `ShareBar height={10}` `:288` → `.costs-components` 4 rows + total `:292`, `:304` →
  conditional `p.micro.dim` `:311`.
- `.costs-component-row` is `minmax(0, 1fr) auto 56px; gap 12px; padding 7px 0`
  (`costs.css:8-15`). At a 238px card body: `56px` fixed share column + `24px` of gaps leaves ≈ **158px** for the
  label. The label is the flex element (`.row`, `styles.css:724-729`) and **truncates** rather than wrapping.
- Total row: `border-bottom: 0; font-weight: 500` (`costs.css:21-24`).

## Card 3 — "By model" — `flush`, 11 columns, 4.17× overflow

| # | header | align | cell | formatter, verbatim | `file:line` |
|---|---|---|---|---|---|
| 1 | `Model` | left | **LabelCell** + Swatch, `span.mono` / provider | — | `:329-340` |
| 2 | `Requests` | **right** | `span.num` | `formatInteger(row.requests)` `:346` | `:341-347` |
| 3 | `Estimate` | **right** | **`MeterCell`** `64px × 4px` | `formatEstimatedCost(row.cost, row.unpricedRequests)` `:358` | `:348-362` |
| 4 | `Share` | **right** | `span.num.muted` | `formatPercent(row.share)` / `"–"` `:368` | `:363-369` |
| 5 | `Split` | left, **150px** | **`ShareBar`**, 4 segments, 8px, `min-width 2px` | — | `:370-383` |
| 6 | `Input` | **right** | `span.num` | `formatCost(row.costInput)` `:326` | `:321-327` |
| 7 | `Output` | **right** | `span.num` | `formatCost(row.costOutput)` | `:321-327` |
| 8 | `Cache read` | **right** | `span.num` | `formatCost(row.costCacheRead)` | `:321-327` |
| 9 | `Cache write` | **right** | `span.num` | `formatCost(row.costCacheWrite)` | `:321-327` |
| 10 | `Per request` | **right** | `span.num` | `formatUnitCost(row.cost / (row.requests - row.unpricedRequests))` `:394` | `:385-398` |
| 11 | `Unpriced` | **right** | `span.num.tone-warn` / `span.num.dim "–"` | `formatInteger(row.unpricedRequests)` `:407` | `:399-411` |

**`formatCompact` appears in ZERO Costs columns at every width.** Money uses `formatCost` /
`formatEstimatedCost` / `formatUnitCost`; counts use `formatInteger`; shares use `formatPercent`. **A dollar amount
is never abbreviated in this dashboard.**

The `Split` column's `150px` and the `MeterCell`'s `64px` are **fixed** (`CostsRoute.tsx:374`, `styles.css:1401-1403`),
so at 268px they consume 80% of the visible row before a single character is read.

## Notable formatter calls, verbatim

```
formatEstimatedCost(summary.totalCost, summary.unpricedRequests)     CostsRoute.tsx:250
formatEstimatedCost(summary.avgDailyCost, summary.unpricedRequests)  CostsRoute.tsx:258
formatUnitCost(summary.totalCost / pricedRequests)                    CostsRoute.tsx:270
formatEstimatedCost(row.cost, row.unpricedRequests)                   CostsRoute.tsx:358
formatCost(v, Number.isInteger(v) ? 0 : 2)                           CostsRoute.tsx:120
formatCost(sum(s.values))                                            CostsRoute.tsx:139
formatUnitCost(row.cost / (row.requests - row.unpricedRequests))      CostsRoute.tsx:394
formatInteger(row.unpricedRequests)                                  CostsRoute.tsx:407
```

## Terminal shape at 40 columns

```
Costs
What the last 24 hours of usage would cost at
public API rates. Subscription usage without a
public price is called out separately and never
folded into the total.

  API-equivalent estimate
    $4.09    ▁▂▃▅▇▅▃
  Average per day
    $2.04
  Top model
    muse-spark-1.3-con…
  Per priced request
    $0.0010
  Unpriced requests
    0

─ Daily estimate ────── Per UTC day, stacked by model ──────
  two 56px bars in a 200px plot
  ▪ muse… $3.90
  ▪ gpt… $0.19
─ Where it went ────── Estimate by billing component ──────
  ████▓▒░  10px
  Input        $0.12    3%
  Output       $3.90   95%
  Cache read   $0.00    0%
  Cache write  $0.00    0%
  Total        $4.09

─ By model ───── Estimate per model with its input, output and cache split ──
  Model  Requests  Estimate  Share  Split  Input  Output  CacheR  CacheW  Per req  Unpriced
  …      1,204     $3.90     95.3%  ██▓░  $0.12  $3.78  $0.00  $0.00  $0.0032  –
```

**What 40 columns forces.** The Costs table's 11 columns carry **two fixed-size visual columns** (`Split` at 150px
and the `Estimate` meter at 64px) that do not shrink. That is 214px of the 268px the wrapper actually has, before any
data. This is a measurement, not a recommendation — the IR's `priority` field (`spec.ts:236-244`) is where a drop
order would be declared, and this document deliberately does not invent one.
