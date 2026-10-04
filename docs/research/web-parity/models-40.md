# Models — 40 columns (320px viewport)

**Web route:** `routes/ModelsRoute.tsx` · **IR citation:** `src/layout/spec.ts:524-529`
**Capture:** `screens/models-40.png` — live, `#/models?range=24h`, 320px, dark, fullPage. Page height **1543px**.
Full column/format detail: **`models-150.md`**. All deltas measured live.

## Measured at 320px

| Property | At 1200px | **At 320px** |
|---|---|---|
| `.shell-content` padded box | `986px` | **`302px`** (inner `270px`) |
| `--gutter` | `22px` | `16px` |
| `.sidebar` | 204px docked | `260px` off-canvas |
| `.grid-*` container | n/a | n/a — Models never has one |
| StatGrid (`min 200`) | 4 cols | **1 column** — `floor(270/200) = 1`; all 4 tiles stack |
| All-models table | 10 cols, `940px` client, `1004px` scroll | **10 cols, `268px` client, `1004px` scroll → overflows by 736px (3.75×)** |
| `data-dense` | `false` | `false` |

**The load-bearing fact: at 320px the Models stat grid is a 4-tile vertical stack, and the table overflows 3.75×.**
`minmax(200px, 1fr)` cannot fit two columns in 270px. The web's whole response is (a) stack, (b) scroll.

## Page header

```
h1.page-title        "Models"                                                       ModelsRoute.tsx:70-74
p.page-description   "Which models did the work in the last 24 hours, and how fast they answered."
(no .page-actions)
```

## Top-level order — unchanged by width

| # | Element | `file:line` |
|---|---|---|
| 1 | `PageHeader` | `ModelsRoute.tsx:70-74` |
| 2 | StatGrid — 4 `md` tiles, `min={200}` → **1 col** | `:89-119` |
| 3 | Card "Request share" | `:125-173` |
| 4 | Card "All models" — `flush`, `limit={25}` | `:175-212` |

## StatGrid — one tile per row

| Tile | value formatter | hint formatter | spark |
|---|---|---|---|
| Models used | `formatInteger(view.models.length)` `:92` | `formatInteger(view.providerCount)` `:93` | none |
| Most used | `view.top ? view.top.model : "–"` `:98` | `formatPercent(... / Math.max(1, view.totalRequests))` `:101` | none |
| Requests | `formatInteger(view.totalRequests)` `:107` | `formatInteger(view.failedRequests)` `:108` | `view.requestTotals` `:109` |
| API-equivalent cost | `formatEstimatedCost(view.totalCost, view.unpricedRequests)` `:114` | `formatInteger(view.unpricedRequests)` `:116` | none |

`mostUsedModel` is a **string** — a long model name like `muse-spark-1.3-contributor` inside a 24px
`white-space: nowrap; text-overflow: ellipsis` `.stat-value` (`styles.css:854-856`) **ellipsises** at this width.
The full name is in the tile's `title` (`:97`). A terminal must truncate too, and must not wrap a stat value.

**No `formatCompact` on this stat row at any width.**

## Card 1 — "Request share"

Title `:127`, description `:130`, `Segmented[sm]` `:134-140`. `TimeChart height={260}` `:153` at 236px wide:
`padLeft ≈ 37`, `padRight = 8`, plot ≈ `191px`, `slotW ≈ 8px` → `barW = 8 × 0.72 ≈ 5.8px`.
Stacked; `yMax={1}`; `formatPercent(v, 0)`. Legend below the chart (`:159`), toggleable, 4 items now **one per row**
(`flex-wrap: wrap`, `styles.css:1733`).

## Card 2 — "All models" — 10 columns, 3.75× overflow

| # | header | align | cell | formatter, verbatim | `file:line` |
|---|---|---|---|---|---|
| 1 | *(empty)* | left | chevron, 28px | — | `:314-323` |
| 2 | `Model` | left | **LabelCell** + Swatch, `span.mono` primary + provider secondary | — | `:324-335` |
| 3 | `Requests` | **right** | **MeterCell** `64px × 4px` | `formatInteger(row.totalRequests)` `:345` | `:336-349` |
| 4 | `Cost` | **right** | `span.num` | `formatEstimatedCost(row.totalCost, row.unpricedRequests)` `:356` | `:350-357` |
| 5 | `Tokens` | **right** | `span.num` | **`formatCompact(sumConversationTokens(row))`** `:368` | `:358-372` |
| 6 | `Cache rate` | **right** | `span.num` | `formatPercent(row.cacheRate)` `:379` | `:373-380` |
| 7 | `Errors` | **right** | **Badge** `mono` / dim `0%` | `formatErrorRate(row.errorRate)` `:392` | `:381-396` |
| 8 | `Tokens/s` | **right** | `span.num` | `formatTokensPerSecond(row.avgTokensPerSecond)` `:403` | `:397-404` |
| 9 | `TTFT` | **right** | `span.num` | `formatDurationMs(row.avgTtft)` `:411` | `:405-412` |
| 10 | `Trend` | left | **Sparkline** `96×22` | — | `:413-432` |

**`LabelCell`'s two lines are non-negotiable at this width**: `13px/500/ink-1` primary over `12px/400/ink-3`
secondary with **zero gap** (`Table.tsx:224-226`, `styles.css:1366-1374`). Both lines are `.truncate`, so a long
model name ellipsises. The cell is 2 terminal rows tall.

## Notable formatter calls, verbatim

```
formatInteger(view.models.length)                                    ModelsRoute.tsx:92
formatPercent(view.top.totalRequests / Math.max(1, view.totalRequests)) ModelsRoute.tsx:101
formatInteger(view.totalRequests)                                    ModelsRoute.tsx:107
formatEstimatedCost(view.totalCost, view.unpricedRequests)           ModelsRoute.tsx:114
formatInteger(row.totalRequests)                                     ModelsRoute.tsx:345
formatEstimatedCost(row.totalCost, row.unpricedRequests)             ModelsRoute.tsx:356
formatCompact(sumConversationTokens(row))                            ModelsRoute.tsx:368
formatPercent(row.cacheRate)                                         ModelsRoute.tsx:379
formatErrorRate(row.errorRate)                                        ModelsRoute.tsx:392
formatTokensPerSecond(row.avgTokensPerSecond)                        ModelsRoute.tsx:403
formatDurationMs(row.avgTtft)                                         ModelsRoute.tsx:411
```

## Terminal shape at 40 columns

```
Models
Which models did the work in the last 24
hours, and how fast they answered.

  Models used
    4
  Most used
    muse-spark-1.3-contributor     ← 24px, ellipsised if needed
  Requests
    3,956   ▁▂▄▆▅
  API-equivalent cost
    $4.09

─ Request share ────────── Each model's share … ──
  stacked bars, ~6px wide at 236px plot
  ▪ muse… 34%
  ▪ gpt… 22%
  ▪ claude… 18%
  ▪ …                     ← 1 legend item per row
─ All models ─────────── Click a row for … ───────────
  ▸ Model   Requests  Cost  Tokens  Cache  Errors  T/s  TTFT  Trend
     muse…       1,204  $1.90  412M   98.1% [0.4%] 71.2 2.9s ▁▂▄▆
     ← the web scrolls 1004px of table in 268px
```

**What 40 columns forces that the web never has to decide.** Ten columns need 1004px; the wrapper has 268px.
The web scrolls. A 40-cell terminal cannot. The IR's `priority` field (`spec.ts:236-244`) is explicitly recorded
as **the terminal's own decision, not a web fact** — this document does not supply one, it supplies the
measurement that a decision has to be made against.
