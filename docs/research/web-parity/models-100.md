# Models — 100 columns (800px viewport)

**Web route:** `routes/ModelsRoute.tsx` · **IR citation:** `src/layout/spec.ts:524-529`
**Capture:** `screens/models-100.png` — live, `#/models?range=24h`, 800px, dark, fullPage. Page height **1197px**.
Full column/format detail: **`models-150.md`**. All deltas below measured live.

## Measured at 800px

| Property | At 1200px | **At 800px** |
|---|---|---|
| `.shell-content` padded box | `986px` | **`782px`** (inner content `750px`) |
| `--gutter` | `22px` | **`16px`** (`styles.css:620-623`) |
| `.sidebar` | 204px docked | 260px off-canvas (`styles.css:633-644`) |
| **`.grid-*` container** | **none** | **none — unchanged.** Models is single-column at every width |
| StatGrid (`min 200`) | **4 columns**, 4 tiles, no wrap | **`3 columns`**, 4 tiles → 3 + 1 |
| `.table-wrap` (All models) | `1004px` scroll / `940px` client → **already overflows by 64px** | **`1004px` scroll / `748px` client → overflows by 256px** |
| Table columns | 10 | **10 — all kept** |

**The load-bearing finding at 100 columns: the Models table overflows at EVERY width, including 1200px.**
`scrollWidth 1004px > clientWidth 940px` at full desktop. Ten columns including a 28px chevron, a 112px Trend
sparkline and six right-aligned numerics do not fit a 940px content column. **The web's answer is a permanent
horizontal scrollbar, not a narrower table and not fewer columns.** A terminal at 150 columns must decide what to
drop; the web never faced that decision and this document does not invent an answer for it.

Second: at `min: 200px` and a 750px content width, `floor(750/200) = 3`, so the stat row wraps **3 + 1** and the
lone 4th tile stretches to the full 750px (`auto-fit` `1fr`).

## Page header

```
h1.page-title        "Models"
p.page-description   "Which models did the work in the last 24 hours, and how fast they answered."
(no .page-actions)
```

## Top-level order — unchanged by width

| # | Element | Wrapper | `file:line` |
|---|---|---|---|
| 1 | `PageHeader` | — | `ModelsRoute.tsx:70-74` |
| 2 | StatGrid — 4 `md` tiles, `min={200}` | `div[data-stale]` | `:89-119` |
| 3 | Card "Request share" | full width | `:125-173` |
| 4 | Card "All models" — `flush`, `limit={25}` | full width | `:175-212` |

## StatGrid at 3 columns

| Tile | value | hint | spark |
|---|---|---|---|
| Models used | `formatInteger(view.models.length)` `:92` | `formatInteger(view.providerCount)` + " provider(s)" `:93` | none |
| Most used | `view.top ? view.top.model : "–"` `:98` | `formatPercent(view.top.totalRequests / Math.max(1, view.totalRequests))` + " of requests · " + provider `:101` | none |
| Requests | `formatInteger(view.totalRequests)` `:107` | `formatInteger(view.failedRequests)` + " failed" `:108` | `spark={view.requestTotals}` `:109` |
| API-equivalent cost | `formatEstimatedCost(view.totalCost, view.unpricedRequests)` `:114` | `formatInteger(view.unpricedRequests)` + " unpriced" `:116` | none |

**Still no `formatCompact` on the Models stat row, at any width.** Tile 2's value is a model-name string.

## Card 1 — "Request share"

- Title `:127`; description "Each model's share of requests per hour" `:130`; `Segmented[sm]` `:134-140`.
- `TimeChart height={260}` `:153`, stacked, `yMax={1}` in share mode, `format={v => formatPercent(v, 0)}` `:155`.
- `Legend` **below** the chart inside `div.stack[gap:12]` (`:147`, `:159`), toggleable
  (`hidden` + `onToggle={toggleSeries}` `:166-167`), `value = formatPercent(...)` `:164`.
- **4 legend items** at this width, wrapping to **1 row** (`.legend { flex-wrap: wrap; gap: 4px 14px }`,
  `styles.css:1732-1735`; measured `flexWrap: wrap`).

## Card 2 — "All models" — `flush`, 10 columns, scrolls

| # | header | align | cell | formatter, verbatim | `file:line` |
|---|---|---|---|---|---|
| 1 | *(empty)* | left | `span.models-chevron` (28px) | — | `:314-323` |
| 2 | `Model` | left | **LabelCell** + `Swatch` lead | — | `:324-335` |
| 3 | `Requests` | **right** | **MeterCell** `max={view.maxRequests}` | `formatInteger(row.totalRequests)` `:345` | `:336-349` |
| 4 | `Cost` | **right** | `span.num` | `formatEstimatedCost(row.totalCost, row.unpricedRequests)` `:356` | `:350-357` |
| 5 | `Tokens` | **right** | `span.num` + `title` | **`formatCompact(sumConversationTokens(row))`** `:368` | `:358-372` |
| 6 | `Cache rate` | **right** | `span.num` | `formatPercent(row.cacheRate)` `:379` | `:373-380` |
| 7 | `Errors` | **right** | **Badge** `mono`, or `span.num.dim "0%"` | `formatErrorRate(row.errorRate)` `:392` | `:381-396` |
| 8 | `Tokens/s` | **right** | `span.num` | `formatTokensPerSecond(row.avgTokensPerSecond)` `:403` | `:397-404` |
| 9 | `TTFT` | **right** | `span.num` | `formatDurationMs(row.avgTtft)` `:411` | `:405-412` |
| 10 | `Trend` | **left** (no `align` key) | **Sparkline** `96×22` | — | `:413-432` |

**`formatCompact` appears in exactly one column (Tokens); `formatInteger` in exactly one (Requests).**

`rowKey = modelKey(row.model, row.provider)` `:187`; `initialSort {key:"requests", dir:"desc"}` `:189`;
`limit={25}` `:190`; **not dense**; rows expand into a `ModelDetail` two-column grid
`minmax(260px, 340px) minmax(0, 1fr)`, `gap 24px`, `padding 16px 16px 18px 44px` (`models.css:14-22`) which itself
collapses to one column below 1100px (`models.css:38-43`) — so the expanded detail is **single-column at 800px**.

## Terminal shape at 100 columns

```
Models
Which models did the work in the last 24 hours, and how fast they answered.

  Models used   4
  Most used     muse-spark-1.3-contributor
  Requests      3,956   ▁▂▄▆▅
  API-equivalent cost  $4.09
                                    ← 3 + 1, 4th tile alone on its row

─ Request share ────────── Each model's share of requests per hour ──
  stacked bars, y pinned at 100%, whole-percent axis
  ▪ muse… 34%   ▪ gpt… 22%   ▪ claude… 18%   ▪ …     ← one row, toggles
─ All models ──────── Click a row for latency and throughput over time ──
  ▸ Model   Requests  Cost  Tokens  Cache  Errors  T/s  TTFT  Trend
     …                                       ← the web scrolls: 1004px of
                                                table in a 748px box
```

- **No two-up layout exists for Models at any width.** The stat row wraps 3 + 1 and both cards stay full width.
- The expanded `ModelDetail` becomes **one column** below 1100px (`models.css:38-43`), so its `section-label`
  sub-headings — "Efficiency", "Latency", "Tokens" (`:473`, `:505`, `:515`) — become a vertical sequence.
