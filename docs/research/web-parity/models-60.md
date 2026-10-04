# Models — 60 columns (480px viewport)

**Web route:** `routes/ModelsRoute.tsx` · **IR citation:** `src/layout/spec.ts:524-529`
**Capture:** `screens/models-60.png` — live, `#/models?range=24h`, 480px, dark, fullPage. Page height **1241px**.
Full column/format detail: **`models-150.md`**. All deltas measured live.

## Measured at 480px

| Property | At 1200px | **At 480px** |
|---|---|---|
| `.shell-content` padded box | `986px` | **`462px`** (inner `430px`) |
| `--gutter` | `22px` | `16px` (`styles.css:620-623`) |
| `.sidebar` | 204px docked | `260px` off-canvas (`styles.css:633-644`) |
| `.grid-*` container | n/a | n/a — **Models is single-column at every width** |
| StatGrid (`min 200`) | 4 cols | **2 columns**, 4 tiles → 2 + 2 |
| All-models table | 10 cols, `940px` client, `1004px` scroll | **10 cols, `428px` client, `1004px` scroll → overflows by 576px** |
| Table `data-dense` | `false` | `false` — unchanged |

**The load-bearing number at 60 columns: the All-models table needs 1004px and has 428px — a 2.35× overflow.**
The web does not narrow the columns, does not drop any, and does not truncate the cells. It scrolls. `table-wrap`
is `overflow-x: auto` (`styles.css:1259-1262`) and the `td`/`th` `white-space: nowrap` (`styles.css:1278`, `1317`)
means no cell can wrap either.

`floor(430 / 200) = 2`, so the 4 stat tiles pair 2 + 2.

## Page header

```
h1.page-title        "Models"                                                              ModelsRoute.tsx:70-74
p.page-description   "Which models did the work in the last 24 hours, and how fast they answered."
(no .page-actions)
```
`max-width: 72ch` (`styles.css:688`) wraps the description to 2 lines at 430px.

## Top-level order — unchanged by width

| # | Element | `file:line` |
|---|---|---|
| 1 | `PageHeader` | `ModelsRoute.tsx:70-74` |
| 2 | StatGrid — 4 `md` tiles, `min={200}` → 2 cols | `:89-119` |
| 3 | Card "Request share" | `:125-173` |
| 4 | Card "All models" — `flush`, `limit={25}` | `:175-212` |

## StatGrid — 2 columns

| Tile | value formatter | hint formatter | spark |
|---|---|---|---|
| Models used | `formatInteger(view.models.length)` `:92` | `formatInteger(view.providerCount)` `:93` | none |
| Most used | `view.top ? view.top.model : "–"` `:98` | `formatPercent(... / Math.max(1, view.totalRequests))` `:101` | none |
| Requests | `formatInteger(view.totalRequests)` `:107` | `formatInteger(view.failedRequests)` `:108` | `view.requestTotals` `:109` |
| API-equivalent cost | `formatEstimatedCost(view.totalCost, view.unpricedRequests)` `:114` | `formatInteger(view.unpricedRequests)` `:116` | none |

**No `formatCompact` on this stat row at any width.**

## Card 1 — "Request share"

Title `:127`, description `:130`, `Segmented[sm]` `:134-140`. `TimeChart height={260}` `:153` at ~396px wide;
stacked; `yMax={1}`; `formatPercent(v, 0)`. Legend **below**, toggleable, 4 items `:159-168`, now wrapping to
**2 rows** (`flex-wrap: wrap; gap: 4px 14px`, `styles.css:1732-1735`).

## Card 2 — "All models" — 10 columns, 2.35× overflow

| # | header | align | cell | formatter, verbatim | `file:line` |
|---|---|---|---|---|---|
| 1 | *(empty)* | left | chevron, 28px | — | `:314-323` |
| 2 | `Model` | left | **LabelCell** + Swatch | — | `:324-335` |
| 3 | `Requests` | **right** | **MeterCell** | `formatInteger(row.totalRequests)` `:345` | `:336-349` |
| 4 | `Cost` | **right** | `span.num` | `formatEstimatedCost(row.totalCost, row.unpricedRequests)` `:356` | `:350-357` |
| 5 | `Tokens` | **right** | `span.num` | **`formatCompact(sumConversationTokens(row))`** `:368` | `:358-372` |
| 6 | `Cache rate` | **right** | `span.num` | `formatPercent(row.cacheRate)` `:379` | `:373-380` |
| 7 | `Errors` | **right** | **Badge** `mono` / dim `0%` | `formatErrorRate(row.errorRate)` `:392` | `:381-396` |
| 8 | `Tokens/s` | **right** | `span.num` | `formatTokensPerSecond(row.avgTokensPerSecond)` `:403` | `:397-404` |
| 9 | `TTFT` | **right** | `span.num` | `formatDurationMs(row.avgTtft)` `:411` | `:405-412` |
| 10 | `Trend` | left | **Sparkline** `96×22` | — | `:413-432` |

`rowKey = modelKey(row.model, row.provider)` `:187`; `limit={25}` `:190`; **not dense**.

**The `.meter` is a fixed `64px × 4px` sliver regardless of width** (`styles.css:1401-1403`, `1379`) — so at
430px it occupies 15% of the row. The `.sparkline` is a fixed `96×22` (`ModelsRoute.tsx:425-426`) — 22% of the row.
**Both are fixed-size, so neither scales with the viewport.** A terminal that scales them to the available width is
inventing behaviour; keep them at their fixed relative weight.

## Terminal shape at 60 columns

```
Models
Which models did the work in the last 24 hours,
and how fast they answered.

  Models used   4
  Most used     muse-spark-1.3-contributor
  Requests      3,956   ▁▂▄▆▅
  API-equivalent cost  $4.09

─ Request share ─────── Each model's share of requests per hour ──
  stacked bars, 4 legend items over 2 rows
─ All models ──── Click a row for latency and throughput over time ──
  ▸ Model  Requests  Cost  Tokens  Cache  Errors  T/s  TTFT  Trend
     …      1204     $1.90  412M    98.1%  [0.4%]  71.2  2.9s  ▁▂▄▆
     ← the web scrolls 1004px of table in 428px; all 10 columns kept
```

- **The stat row pairs 2 + 2.** The two tiles with no spark (`Models used`, `Most used`) are shorter than the two
  with one, but `.stat-foot { min-height: 18px }` only applies when a foot exists — so at 2 columns the row heights
  are driven by the longest tile in each row, not by each tile individually.
- **Nothing is dropped or reordered by the web at this width.** The `.table-wrap` scroll is the whole adaptation.
