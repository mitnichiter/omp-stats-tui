# Costs — 150 columns (1200px viewport)

**Web route:** `routes/CostsRoute.tsx`
**IR citation:** `src/layout/spec.ts:617-620` —
`lines: "90-149 (Daily estimate card), 150-156 (Where it went card), 157-171 (By model card), 246-280 (StatGrid), 323-405 (columns)"`
**Capture:** `screens/costs-150.png` — live, `#/costs?range=24h`, 1200px, dark, fullPage. Page height **1137px**.

## Page header

```
h1.page-title        "Costs"
p.page-description   "What the last 24 hours of usage would cost at public API rates. Subscription usage without a
                      public price is called out separately and never folded into the total."
(no .page-actions — the Split segmented control lives on the Daily-estimate CARD, not the page)
```

## Top-level order

| # | Element | Wrapper | `file:line` |
|---|---|---|---|
| 1 | `PageHeader` | — | `CostsRoute.tsx:74-79` |
| 2 | **StatGrid** — 5 `md` tiles, `min={180}` | `CostStats` → `div[data-stale]` | `:240-282` (cited 246-280) |
| 3 | **`div.grid .grid-main-side`** — Daily estimate (2fr) + Where it went (1fr) | — | `:89-155` |
| 4 | **Card** "By model" — `flush`, `limit={20}` | full width | `:157-177` |

## StatGrid — `--stat-min: 180px`, 5 tiles, **5 columns, no wrap**

`CostsRoute.tsx:246-279`. `floor(942/180) = 5`, so this row is **exactly one clean row of 5** — the same property
Models gets at `min 200`. Measured `data.grids[0].cols === 5`.

| # | Tile | label | value formatter | hint | spark | `file:line` |
|---|---|---|---|---|---|---|
| 1 | API-equivalent estimate | `formatEstimatedCost(summary.totalCost, summary.unpricedRequests)` `:250` | `` `${formatInteger(summary.requests)} requests` `` `:251` | `spark={view.dailyTotals}` `sparkColor="var(--chart-secondary)"` `:252-253` | `:247-254` |
| 2 | Average per day | `formatEstimatedCost(summary.avgDailyCost, summary.unpricedRequests)` `:258` | `` `over ${formatInteger(summary.activeDays)} active day${summary.activeDays === 1 ? "" : "s"}` `` `:259` | none | `:255-260` |
| 3 | Top model | `top ? top.model : "–"` — **a STRING** `:264` | `` `${formatCost(top.cost)} · ${formatPercent(top.share)} of estimate` `` `:265` | none | `:261-266` |
| 4 | Per priced request | `pricedRequests > 0 ? formatUnitCost(summary.totalCost / pricedRequests) : "–"` `:270` | `` `${formatInteger(pricedRequests)} priced` `` `:271` | none | `:267-272` |
| 5 | Unpriced requests | `formatInteger(summary.unpricedRequests)` `:276` | `"excluded from the estimate"` if > 0, else `"all usage priced"` `:277` | none | `:273-278` |

**`formatCompact` vs `formatInteger` — there is NO `formatCompact` on the Costs stat row.** Every figure is either a
cost (`formatEstimatedCost` / `formatCost` / `formatUnitCost`), a percent, or a **`formatInteger`** count. Tile 3's
value is a model-name string, like Models' "Most used".

**`formatUnitCost` is a local helper, not `data/formatters.ts`** — `CostsRoute.tsx:416-418`:

```ts
function formatUnitCost(value: number): string {
	return value > 0 && value < 0.0001 ? "<$0.0001" : formatCost(value);
}
```

**This matters and is easy to get wrong:** a per-request cost below $0.0001 renders as the bound **`<$0.0001`**,
never `$0.0000`. The live capture shows `$0.0010` for tile 4. The IR's note at `spec.ts:633-637` correctly calls
tile 2 `avgDailyCost` ("Estimate ÷ days with any usage", `:257`) and **not** `max`.

`pricedRequests = summary.requests - summary.unpricedRequests` (`:242`) — the denominator is **priced** requests
only, so the per-request figure is not diluted by subscription traffic.

## Card 1 — "Daily estimate" (2fr)

```
section.card.rise[--i=1]
  header.card-header
    h2.card-title        "Daily estimate"                                       :92
    p.card-description   "Per UTC day, stacked by model" | "…stacked by billing component"  :94
    div.card-actions > div.segmented[sm]   MODEL | COMPONENT                     :97-103
  div.card-body
    div.stack[gap:12]
      div.chart[height:280px]                                                  :119
      div.legend > button.legend-item ×2 (measured)                             :134
```

**This is the only chart on the dashboard at `height={280}`** (`CostsRoute.tsx:119`); every other one is 260. Plot
height `280 - 10 - 24 = 246px`.

Chart is **stacked**, `slots = view.buckets.length`, `tickLabel = i => UTC_DAY.format(view.buckets[i])` (`:115`),
`tooltipTitle` uses `UTC_DAY_LONG` (`:116`). **`format` is cost-aware, not compact** (`:120`):

```ts
format={v => formatCost(v, Number.isInteger(v) ? 0 : 2)}
```

— i.e. whole-dollar axis ticks (`$4`) and cent-precision non-integer ticks. `formatTooltip={v => formatCost(v)}`
(`:121`).

`tooltipExtra` adds a `.chart-tooltip-total` row reading `"Unpriced requests"` +
`formatInteger(view.unpricedPerDay[i])` when that day has unpriced traffic (`:123-132`).

**The measured legend has only 2 items** in `model` split mode because there are 2 models in range; in `component`
mode it has 4 (`COMPONENTS`, `CostsRoute.tsx:48-53`). The 4 components, with the exact colours:

| key | label | colour | `file:line` |
|---|---|---|---|
| `costInput` | `Input` | **`#5b8cff`** (blue, `SERIES_COLORS[5]`) | `:49` |
| `costOutput` | `Output` | **`var(--chart-secondary)`** (pink) | `:50` |
| `costCacheRead` | `Cache read` | **`var(--chart-primary)`** (cyan) | `:51` |
| `costCacheWrite` | `Cache write` | *(4th entry, `:52`)* | — |

**Note the ordering: cache read is CYAN and output is PINK.** This is the inverse of the intuition (output is the
expensive kind), and it is deliberate — cache read is the dominant bar so it gets the primary hue. A terminal that
colours output cyan has inverted it.

Legend `value` is `formatCost(sum(s.values))` (`:139`) — money, not compact, not percent.

## Card 2 — "Where it went" (1fr)

```
section.card.rise[--i=2]                ← no actions
  h2.card-title        "Where it went"                                       :150
  p.card-description   "Estimate by billing component"                        :150
  div.card-body > div.stack[gap:14]
    div.share-bar[height=10px] > div.share-bar-seg ×3 (measured)             :288
    div.costs-components
      div.costs-component-row ×4      (one per COMPONENT)                    :292
      div.costs-component-row.costs-component-total   "Total"                 :304
    p.micro.dim   (only when unpricedRequests > 0)                           :310-315
```

`ComponentBreakdown`, `CostsRoute.tsx:284-318`. Two differences from Overview's share bars, both load-bearing:

1. **`height={10}`**, not the `8px` default (`:288` vs `ShareBar.tsx:9`).
2. **The per-component rows are a 3-column grid**, not a `.stack` — `costs.css:8-15`:
   `grid-template-columns: minmax(0, 1fr) auto 56px; gap: 12px; padding: 7px 0; border-bottom: 1px solid var(--line-1)`.
   The third column is a **fixed `56px`** holding `formatPercent(x / totalCost)` (`:299-301`), so the percentages
   form a right-aligned column. `.costs-component-total` drops the border and goes weight 500 (`costs.css:21-24`).
3. The trailing `<p className="micro dim">` is `12px` `ink-3` (`:311`) and reads
   `"N unpriced subscription request(s) … not included."` — the **`micro` class** (`styles.css:267-272`).

## Card 3 — "By model" — `flush`, **11 columns**, the widest table measured

```
section.card.rise[--i=3] flush
  h2.card-title        "By model"                                             :159
  p.card-description   "Estimate per model with its input, output and cache split"  :160
  div.card-body[data-flush=true]
    div.table-wrap > table.table[data-dense=false]
      thead > tr > th ×11
      tbody > tr ×N   (limit={20})
  div.table-more   "N of M" + "Show more"        ← appears past 20 rows
```

Table props: `rowKey={row => row.key}` `:169`, `initialSort={{key:"cost", dir:"desc"}}` `:171`, **`limit={20}`**
`:172`, **not dense**. Measured `scrollWidth 1117px > clientWidth 940px` — **this table overflows at 1200px too.**

### Columns — `buildCostColumns`, `CostsRoute.tsx:320-413`. Eleven.

| # | key | header | align | width | cell | formatter, verbatim | `file:line` |
|---|---|---|---|---|---|---|---|
| 1 | `model` | `Model` | left | — | **`LabelCell`** `lead={<Swatch/>}` `primary={<span className="mono">{row.model}</span>}` `secondary={row.provider}` | — | `:329-340` |
| 2 | `requests` | `Requests` | **right** | — | `span.num` | `formatInteger(row.requests)` `:346` | `:341-347` |
| 3 | `cost` | `Estimate` | **right** | — | **`MeterCell`** `max={view.maxModelCost}` | `formatEstimatedCost(row.cost, row.unpricedRequests)` `:358` | `:348-362` |
| 4 | `share` | `Share` | **right** | — | `span.num.muted` | `row.cost > 0 ? formatPercent(row.share) : "–"` `:368` | `:363-369` |
| 5 | `split` | `Split` | (left) | **`150px`** | **`ShareBar`** (8px, 4 segments) or `span.dim "–"` | — | `:370-383` |
| 6 | `costInput` | `Input` | **right** | — | `span.num` | `formatCost(row.costInput)` `:326` | `:321-327` (spread) |
| 7 | `costOutput` | `Output` | **right** | — | `span.num` | `formatCost(row.costOutput)` | `:321-327` |
| 8 | `costCacheRead` | `Cache read` | **right** | — | `span.num` | `formatCost(row.costCacheRead)` | `:321-327` |
| 9 | `costCacheWrite` | `Cache write` | **right** | — | `span.num` | `formatCost(row.costCacheWrite)` | `:321-327` |
| 10 | `perRequest` | `Per request` | **right** | — | `span.num` | `formatUnitCost(row.cost / (row.requests - row.unpricedRequests))` `:394` | `:385-398` |
| 11 | `unpriced` | `Unpriced` | **right** | — | `span.num.tone-warn` if > 0, else `span.num.dim "–"` | `formatInteger(row.unpricedRequests)` `:407` | `:399-411` |

Columns 6–9 are **generated by a `.map` over `COMPONENTS`** (`:321-327`), not written out. Their headers are the
component *labels*, not their keys — so the header text is `Input` / `Output` / `Cache read` / `Cache write`.
**The IR spells these out as four separate columns at `spec.ts:708-711`**, which is the correct expansion.

**`formatCompact` vs `formatInteger` in this table: NO `formatCompact` anywhere.** Costs uses `formatCost` for
money (never compact — you never abbreviate a dollar amount in this table), `formatInteger` for counts, and
`formatPercent` for shares. `formatUnitCost` handles the sub-cent bound. **The IR's `Spec` for Costs has no compact
formatter either**, which is consistent.

**The `Split` column is the most distinctive cell in the dashboard.** It is a **4-segment 8px `ShareBar` in a
`150px` cell** (`:374`), showing that model's input/output/cache-read/cache-write split. It is the only place a
`ShareBar` appears inside a table. Per the IR's note (`spec.ts:718`) — and this is the reason it matters — **bars
scale by cost, never by tokens**, because the data carries a ~41× price spread at comparable token volume and a
token-scaled chart inverts the ranking.

Column alignment as measured: `Model` and `Split` are left; **all nine numeric columns are right** — verified from
the live DOM (`hdr` shows `»` suffix on every header except `Model` and `Split`).

## Notable formatter calls, verbatim

```
formatEstimatedCost(summary.totalCost, summary.unpricedRequests)      CostsRoute.tsx:250
formatEstimatedCost(summary.avgDailyCost, summary.unpricedRequests)   CostsRoute.tsx:258
formatCost(top.cost)                                                   CostsRoute.tsx:265
formatPercent(top.share)                                               CostsRoute.tsx:265
formatUnitCost(summary.totalCost / pricedRequests)                     CostsRoute.tsx:270
formatInteger(summary.unpricedRequests)                                CostsRoute.tsx:276
formatCost(v, Number.isInteger(v) ? 0 : 2)                             CostsRoute.tsx:120
formatCost(sum(s.values))                                              CostsRoute.tsx:139
formatEstimatedCost(row.cost, row.unpricedRequests)                    CostsRoute.tsx:358
formatPercent(row.share)                                               CostsRoute.tsx:368
formatCost(row[c.key])                                                 CostsRoute.tsx:326
formatUnitCost(row.cost / (row.requests - row.unpricedRequests))       CostsRoute.tsx:394
formatInteger(row.unpricedRequests)                                    CostsRoute.tsx:407
formatInteger(view.unpricedPerDay[i])                                  CostsRoute.tsx:128
```

## Terminal shape at 150 columns

```
Costs
What the last 24 hours of usage would cost at public API rates. Subscription
usage without a public price is called out separately and never folded in.

  API-equivalent estimate  $4.09      ▁▂▃▅▇▅▃    ← spark PINK (cost)
  Average per day         $2.04
  Top model               muse-spark-1.3-contributor
  Per priced request      $0.0010
  Unpriced requests       0
                                          ← 5 tiles, ONE row, no wrap

┌─ Daily estimate ────── Per UTC day, stacked by model ──────────────┐┌─ Where it went ────┐
│ stacked, height 280px (the only 280 on the dashboard)              ││ ████▓▒░ 10px bar   │
│ axis in whole DOLLARS ($4), tooltip in cents                      ││ ▪ Input    $0.12  3%│
│                                                                 ││ ▪ Output   $3.90 95%│
│ ▪ muse… $3.90   ▪ gpt… $0.19                                 [MODEL]││ …                   │
└────────────────────────────────────────────────────────────────────┘│ Total   $4.09      │
                                                                     └─────────────────────┘

─ By model ─────── Estimate per model with its input, output and cache split ──
  Model  Requests  Estimate  Share  Split  Input  Output  CacheR  CacheW  Per req  Unpriced
  muse…   1,204      $3.90   95.3%  ██▓░   $0.12  $3.78   $0.00   $0.00   $0.0032      –
  ← 11 columns; the web scrolls (1117px of table in 940px)
```

- **`grid-main-side` is genuinely 2-up only here and at Errors/Providers**, at a measured **617px : 309px**.
- The 5-tile stat row does not wrap at 1200px because `min: 180px` divides 942 evenly — same property as Models.
- The `Split` column is the only in-table share bar; keep it at its `150px` relative weight or drop it explicitly.
