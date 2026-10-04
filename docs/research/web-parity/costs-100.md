# Costs — 100 columns (800px viewport)

**Web route:** `routes/CostsRoute.tsx` · **IR citation:** `src/layout/spec.ts:617-620`
**Capture:** `screens/costs-100.png` — live, `#/costs?range=24h`, 800px, dark, fullPage. Page height **1542px**.
Full column/format detail: **`costs-150.md`**. All deltas measured live.

## Measured at 800px

| Property | At 1200px | **At 800px** |
|---|---|---|
| `.shell-content` padded box | `986px` | **`782px`** (inner `750px`) |
| `--gutter` | `22px` | `16px` (`styles.css:620-623`) |
| **`.grid-main-side`** | `617.328px 308.656px` (2-up) | **`750px` — ONE column** (`styles.css:716-722`) |
| StatGrid (`min 180`) | **5 columns**, 5 tiles, no wrap | **4 columns**, 5 tiles → **4 + 1** |
| By-model table | 11 cols, `940px` client, `1117px` scroll | 11 cols, **`748px` client**, `1117px` scroll → **+369px** |
| `data-dense` | `false` | `false` |
| Card order | Daily estimate then Where it went | **same order**, both 750px wide |

**Two load-bearing facts at 100 columns:**

1. **`grid-main-side` has collapsed.** Daily estimate and Where it went are now **stacked full width**, in that
   order. There is no 2:1 split below 1100px anywhere on the dashboard.
2. **The stat row now wraps 4 + 1.** `floor(750/180) = 4`, so tile 5 ("Unpriced requests") sits alone on a second
   row and, because `auto-fit` uses `1fr`, it **stretches to the full 750px**. Its 24px value stays at the left
   edge; the rest of the row is empty. That empty space is the web's actual narrow behaviour, not a bug to fix.

## Page header

```
h1.page-title        "Costs"
p.page-description   "What the last 24 hours of usage would cost at public API rates. Subscription usage without a
                      public price is called out separately and never folded into the total."
(no .page-actions)
```

## Top-level order — unchanged by width

| # | Element | Wrapper | `file:line` |
|---|---|---|---|
| 1 | `PageHeader` | — | `CostsRoute.tsx:74-79` |
| 2 | StatGrid — 5 `md` tiles, `min={180}` → **4 cols** | `CostStats` | `:240-282` |
| 3 | Daily estimate (750px) → Where it went (750px) | `.grid-main-side` **collapsed** | `:89-155` |
| 4 | Card "By model" — `flush`, `limit={20}` | full width | `:157-177` |

## StatGrid — 4 columns, 4 + 1

| # | Tile | value | hint | spark |
|---|---|---|---|---|
| 1 | API-equivalent estimate | `formatEstimatedCost(summary.totalCost, summary.unpricedRequests)` `:250` | `formatInteger(summary.requests)` `:251` | `view.dailyTotals`, pink `:252-253` |
| 2 | Average per day | `formatEstimatedCost(summary.avgDailyCost, summary.unpricedRequests)` `:258` | `formatInteger(summary.activeDays)` `:259` | none |
| 3 | Top model | `top ? top.model : "–"` — string `:264` | `formatCost(top.cost)` + `formatPercent(top.share)` `:265` | none |
| 4 | Per priced request | `formatUnitCost(summary.totalCost / pricedRequests)` `:270` | `formatInteger(pricedRequests)` `:271` | none |
| 5 | Unpriced requests | `formatInteger(summary.unpricedRequests)` `:276` | `"excluded from the estimate"` `:277` | none |

**No `formatCompact` on the Costs stat row at any width.**

## Card 1 — "Daily estimate" (full width at 800px)

- Title `:92`; description `"Per UTC day, stacked by model"` `:94`; `Segmented[sm]` MODEL | COMPONENT `:97-103`.
- `Chart slots={view.buckets.length}` `:114`, **`height={280}`** `:119`, stacked, `tickLabel = UTC_DAY.format(...)` `:115`.
- `format={v => formatCost(v, Number.isInteger(v) ? 0 : 2)}` `:120` — **dollar axis, whole-dollar ticks**.
- `tooltipExtra` adds the `Unpriced requests` total row `:123-132`.
- `Legend` below the chart in `div.stack[gap:12]` `:112`, `value = formatCost(sum(s.values))` `:139`,
  toggleable. Measured **2 items** in `model` mode (2 models in range); 4 in `component` mode.
- Component colours: Input `#5b8cff`, Output `var(--chart-secondary)`, Cache read `var(--chart-primary)`,
  Cache write (`:48-53`).

## Card 2 — "Where it went" (full width at 800px)

- Title `:150`, description `"Estimate by billing component"` `:150`. **No actions.**
- `div.stack[gap:14]` `:286` → `ShareBar height={10}` `:288` → `.costs-components` 4 rows + total row `:292`,
  `:304` → conditional `<p className="micro dim">` `:311`.
- **`.costs-component-row` is a 3-column grid** `minmax(0,1fr) auto 56px; gap 12px; padding 7px 0` with a
  `1px solid var(--line-1)` bottom border (`costs.css:8-15`). The third column is a **fixed `56px`** holding
  `formatPercent(x / summary.totalCost)` `:299-301`, so the percentages align as a column regardless of digit count.
  Total row: `border-bottom: 0; font-weight: 500` (`costs.css:21-24`).

## Card 3 — "By model" — `flush`, 11 columns, +369px overflow

| # | header | align | cell | formatter, verbatim | `file:line` |
|---|---|---|---|---|---|
| 1 | `Model` | left | **LabelCell** + Swatch | — | `:329-340` |
| 2 | `Requests` | **right** | `span.num` | `formatInteger(row.requests)` `:346` | `:341-347` |
| 3 | `Estimate` | **right** | **MeterCell** `max={view.maxModelCost}` | `formatEstimatedCost(row.cost, row.unpricedRequests)` `:358` | `:348-362` |
| 4 | `Share` | **right** | `span.num.muted` | `row.cost > 0 ? formatPercent(row.share) : "–"` `:368` | `:363-369` |
| 5 | `Split` | left (150px) | **`ShareBar`** 4 segments | — | `:370-383` |
| 6 | `Input` | **right** | `span.num` | `formatCost(row.costInput)` `:326` | `:321-327` |
| 7 | `Output` | **right** | `span.num` | `formatCost(row.costOutput)` | `:321-327` |
| 8 | `Cache read` | **right** | `span.num` | `formatCost(row.costCacheRead)` | `:321-327` |
| 9 | `Cache write` | **right** | `span.num` | `formatCost(row.costCacheWrite)` | `:321-327` |
| 10 | `Per request` | **right** | `span.num` | `formatUnitCost(row.cost / (row.requests - row.unpricedRequests))` `:394` | `:385-398` |
| 11 | `Unpriced` | **right** | `span.num.tone-warn` / `span.num.dim` | `formatInteger(row.unpricedRequests)` `:407` | `:399-411` |

**All 11 columns retained; the web scrolls.** `table-wrap { overflow-x: auto }` (`styles.css:1259-1262`) with
`white-space: nowrap` on both `th` and `td` (`styles.css:1278`, `1317`) — no cell can shrink.

**No `formatCompact` anywhere in the Costs table, at any width.** The `Split` ShareBar keeps its `150px` cell
(`:374`) regardless of width.

## Terminal shape at 100 columns

```
Costs
What the last 24 hours of usage would cost at public API rates. Subscription
usage without a public price is called out separately and never folded in.

  API-equivalent estimate  $4.09      ▁▂▃▅▇▅▃
  Average per day         $2.04
  Top model               muse-spark-1.3-contributor
  Per priced request      $0.0010
  Unpriced requests       0
                          ← 4 + 1; the lone tile spans the row and
                            stays left-aligned, leaving whitespace

─ Daily estimate ─────────── Per UTC day, stacked by model ─────────────
  stacked, 280px, dollar axis with whole-dollar ticks
  ▪ muse… $3.90   ▪ gpt… $0.19
─ Where it went ─────────── Estimate by billing component ────────────
  ████▓▒░  10px share bar
  Input          $0.12    3%
  Output         $3.90   95%
  Cache read     $0.00    0%
  Cache write    $0.00    0%
  Total          $4.09            ← 56px right column, aligned
  1,000 unpriced subscription requests are not included.

─ By model ─────── Estimate per model with its input, output and cache split ──
  Model  Requests  Estimate  Share  Split  Input  Output  CacheR  CacheW  Per req  Unpriced
     …    1,204      $3.90   95.3%  ██▓░  $0.12  $3.78  $0.00  $0.00  $0.0032  –
```

- The **2-up → 1-up collapse** is the whole story at this width. Both cards keep their order and their content.
- The `Where it went` component list is a **3-column grid with a fixed 56px percentage column**, so it reads as a
  table even though the web styles it as a plain flex list — the terminal should keep the alignment.
