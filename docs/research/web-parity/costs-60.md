# Costs — 60 columns (480px viewport)

**Web route:** `routes/CostsRoute.tsx` · **IR citation:** `src/layout/spec.ts:617-620`
**Capture:** `screens/costs-60.png` — live, `#/costs?range=24h`, 480px, dark, fullPage. Page height **1665px**.
Full column/format detail: **`costs-150.md`**. All deltas measured live.

## Measured at 480px

| Property | At 1200px | **At 480px** |
|---|---|---|
| `.shell-content` padded box | `986px` | **`462px`** (inner `430px`) |
| `--gutter` | `22px` | `16px` |
| `.grid-main-side` | `617px 309px` | **`430px` — ONE column** |
| StatGrid (`min 180`) | 5 cols | **2 columns**, 5 tiles → **2 + 2 + 1** |
| By-model table | 11 cols, `940px` client | 11 cols, **`428px` client**, `1117px` scroll → **+689px (2.6×)** |
| `data-dense` | `false` | `false` |
| ShareBars on page | 3 | **3** — Where-it-went (10px) + By-model `Split` (8px) + … |
| Legend items | 2 | **2**, wrapping to 2 rows |

`floor(430/180) = 2`, so the 5 tiles pair 2 + 2 and the fifth stands alone.

## Page header

```
h1.page-title        "Costs"
p.page-description   "What the last 24 hours of usage would cost at public API rates. Subscription usage without a
                      public price is called out separately and never folded into the total."
(no .page-actions)
```

## Top-level order — unchanged by width

| # | Element | `file:line` |
|---|---|---|
| 1 | `PageHeader` | `CostsRoute.tsx:74-79` |
| 2 | StatGrid — 5 `md` tiles, `min={180}` → **2 cols** | `:240-282` |
| 3 | Daily estimate (430px) → Where it went (430px) | `:89-155` |
| 4 | Card "By model" — `flush`, `limit={20}` | `:157-177` |

## StatGrid — 2 + 2 + 1

| # | Tile | value | hint | spark |
|---|---|---|---|---|
| 1 | API-equivalent estimate | `formatEstimatedCost(summary.totalCost, summary.unpricedRequests)` `:250` | `formatInteger(summary.requests)` `:251` | `view.dailyTotals` pink `:252-253` |
| 2 | Average per day | `formatEstimatedCost(summary.avgDailyCost, summary.unpricedRequests)` `:258` | `formatInteger(summary.activeDays)` `:259` | none |
| 3 | Top model | `top ? top.model : "–"` `:264` | `formatCost(top.cost)` + `formatPercent(top.share)` `:265` | none |
| 4 | Per priced request | `formatUnitCost(summary.totalCost / pricedRequests)` `:270` | `formatInteger(pricedRequests)` `:271` | none |
| 5 | Unpriced requests | `formatInteger(summary.unpricedRequests)` `:276` | `"excluded from the estimate"` `:277` | none |

**Still no `formatCompact` on this row.**

Tile 3's value is a model-name string inside a `24px` `.stat-value` with `white-space: nowrap; text-overflow: ellipsis`
(`styles.css:854-856`) — at 430px/2 = 215px tiles a name like `muse-spark-1.3-contributor` **ellipsises**. The full
name is in the tile's `title` (`:263`).

## Card 1 — "Daily estimate" (430px)

- Title `:92`, description `"Per UTC day, stacked by model"` `:94`, `Segmented[sm]` `:97-103`.
- `Chart height={280}` `:119`, stacked, at ~396px wide → plot ≈ `396 - padLeft - 8`. `padLeft = max(28, labelWidth+12)`
  (`Chart.tsx:114`); dollar labels like `"$4"` are 2 chars → `labelWidth ≈ 12.6` → `padLeft = 28`.
  Plot ≈ `360px`. At `24h` there are 2 daily buckets, so `slotW ≈ 180px` and **`barW = min(56, 180 × 0.72) = 56px`
  — the 56px cap is what actually applies** (`Chart.tsx:125`). Two 56px bars sit centred in a 360px plot.
- `format={v => formatCost(v, Number.isInteger(v) ? 0 : 2)}` `:120`.
- `Legend` below in `div.stack[gap:12]` `:112`, `value = formatCost(sum(s.values))` `:139`, toggleable.
- `tooltipExtra` → `Unpriced requests` total row `:123-132`.

## Card 2 — "Where it went" (430px)

- Title `:150`, description `:150`. No actions.
- `div.stack[gap:14]` `:286` → `ShareBar height={10}` `:288` → `.costs-components` 4 rows + total `:292`, `:304` →
  conditional `p.micro.dim` `:311`.
- **`.costs-component-row` grid** `minmax(0,1fr) auto 56px; gap 12px; padding 7px 0; border-bottom 1px`
  (`costs.css:8-15`). In a 398px inner card body, the fixed `56px` percentage column is 14% of the row and
  `gap: 12px` twice eats 24px — so the label column gets ≈ 270px. The 56px is **never** flexible; that is the point.

## Card 3 — "By model" — `flush`, 11 columns, 2.6× overflow

| # | header | align | cell | formatter, verbatim | `file:line` |
|---|---|---|---|---|---|
| 1 | `Model` | left | **LabelCell** + Swatch | — | `:329-340` |
| 2 | `Requests` | **right** | `span.num` | `formatInteger(row.requests)` `:346` | `:341-347` |
| 3 | `Estimate` | **right** | **MeterCell** | `formatEstimatedCost(row.cost, row.unpricedRequests)` `:358` | `:348-362` |
| 4 | `Share` | **right** | `span.num.muted` | `formatPercent(row.share)` or `"–"` `:368` | `:363-369` |
| 5 | `Split` | left (150px) | **`ShareBar`** 4 segments | — | `:370-383` |
| 6–9 | `Input` / `Output` / `Cache read` / `Cache write` | **right** | `span.num` | `formatCost(row[c.key])` `:326` | `:321-327` |
| 10 | `Per request` | **right** | `span.num` | `formatUnitCost(row.cost / (row.requests - row.unpricedRequests))` `:394` | `:385-398` |
| 11 | `Unpriced` | **right** | `span.num.tone-warn` / dim | `formatInteger(row.unpricedRequests)` `:407` | `:399-411` |

**All 11 columns kept; the web scrolls.** `nowrap` on `th` and `td` (`styles.css:1278`, `1317`) means nothing
compresses.

**No `formatCompact` anywhere in the Costs table, at any width.**

## Notable formatter calls, verbatim

```
formatEstimatedCost(summary.totalCost, summary.unpricedRequests)     CostsRoute.tsx:250
formatEstimatedCost(summary.avgDailyCost, summary.unpricedRequests)  CostsRoute.tsx:258
formatUnitCost(summary.totalCost / pricedRequests)                    CostsRoute.tsx:270
formatEstimatedCost(row.cost, row.unpricedRequests)                   CostsRoute.tsx:358
formatPercent(row.share)                                             CostsRoute.tsx:368
formatCost(v, Number.isInteger(v) ? 0 : 2)                           CostsRoute.tsx:120
formatCost(sum(s.values))                                            CostsRoute.tsx:139
formatUnitCost(row.cost / (row.requests - row.unpricedRequests))      CostsRoute.tsx:394
```

## Terminal shape at 60 columns

```
Costs
What the last 24 hours of usage would cost at public API
rates. Subscription usage without a public price is called
out separately and never folded into the total.

  API-equivalent estimate  $4.09   ▁▂▃▅▇▅▃
  Average per day         $2.04
  Top model               muse-spark-1.3-con…
  Per priced request      $0.0010
  Unpriced requests       0

─ Daily estimate ────────── Per UTC day, stacked by model ──────────
  two 56px bars in a 360px plot — the 56px CAP, not the 72% rule
  ▪ muse… $3.90
  ▪ gpt… $0.19
─ Where it went ─────────── Estimate by billing component ──────────
  ████▓▒░  10px
  Input        $0.12     3%
  Output       $3.90    95%
  Cache read   $0.00     0%
  Cache write  $0.00     0%
  Total        $4.09            ← 56px share column stays fixed

─ By model ────── Estimate per model with its input, output and cache split ──
  Model  Requests  Estimate  Share  Split  Input  Output  CacheR  CacheW  Per req  Unpriced
  …      1,204     $3.90     95.3%  ██▓░  $0.12  $3.78  $0.00  $0.00  $0.0032  –
  ← 11 columns, 1117px of content in a 428px box: the web scrolls
```

- The `Split` column keeps its `150px` and the `MeterCell` keeps its `64px × 4px` **regardless of width** — the web's
  in-cell visuals are fixed-size, so they occupy a larger share of the row as the viewport narrows.
