# Models — 150 columns (1200px viewport)

**Web route:** `routes/ModelsRoute.tsx`
**IR citation:** `src/layout/spec.ts:524-529` —
`lines: "61-214 (page), 88-118 (StatGrid), 124-172 (Request share card), 174-211 (All models card), 311-433 (buildModelColumns)"`
**Capture:** `screens/models-150.png` — live, `#/models?range=24h`, 1200px, dark, fullPage. Page height **1096px**.
Structure at other widths: `models-100.md`, `models-60.md`, `models-40.md`.

## Page header

```
h1.page-title        "Models"                                                                 ModelsRoute.tsx:~70
p.page-description   "Which models did the work in the last 24 hours, and how fast they answered."
(no .page-actions)
```

## Top-level order — **no grid container at all**

| # | Element | Wrapper | `file:line` |
|---|---|---|---|
| 1 | `PageHeader` | — | `ModelsRoute.tsx:70-74` (cited 61-214) |
| 2 | **StatGrid** — 4 `md` tiles, `min={200}` | `div[data-stale]` | `:89-119` |
| 3 | **Card** "Request share" — full width | — | `:125-173` |
| 4 | **Card** "All models" — full width, `flush` | — | `:175-212` |

**Models is one of the four routes with no `.grid-*` container** (with Tools, Requests, Gain). Every card is
full-width, stacked at the `.page` gap of **20px** (`styles.css:666`). **A terminal must not invent a two-up layout
for Models at any width.**

## StatGrid — `--stat-min: 200px`, the **largest** on the dashboard

`ModelsRoute.tsx:89-119`. At a 942px content column, `floor(942/200) = 4` → **exactly 4 columns, exactly 4 tiles,
one clean row with no wrap.** This is the only StatGrid in the dashboard where the tile count divides the column
count, and it is why `min` is 200 here rather than 180 or 190: the route picked 200 *to* get a single row of 4.

| Tile | label | value | hint | spark | `file:line` |
|---|---|---|---|---|---|
| 1 | `Models used` | `formatInteger(view.models.length)` | `` `across ${formatInteger(view.providerCount)} provider${view.providerCount === 1 ? "" : "s"}` `` | none | `:90-94` |
| 2 | `Most used` | `view.top ? view.top.model : "–"` — **a STRING, not a number** | `` `${formatPercent(view.top.totalRequests / Math.max(1, view.totalRequests))} of requests · ${view.top.provider}` `` | none | `:95-104` |
| 3 | `Requests` | `formatInteger(view.totalRequests)` | `` `${formatInteger(view.failedRequests)} failed` `` | `spark={view.requestTotals}` (default cyan) | `:105-110` |
| 4 | `API-equivalent cost` | `formatEstimatedCost(view.totalCost, view.unpricedRequests)` | `view.unpricedRequests > 0 ? `${formatInteger(view.unpricedRequests)} unpriced` : undefined` | none | `:111-118` |

**`formatCompact` vs `formatInteger` in this StatGrid: there is NO `formatCompact` anywhere on the Models stat
row.** Four tiles, and three of them are `formatInteger` or a cost. Tile 2's value is a **model name string** — the
IR models this as `LabelRef` (`spec.ts:101-105`) and its tile carries no metric number at all; it renders the label
directly (see `spec.ts:539-541`, which correctly uses a `derived` `mostUsedModel`). A terminal must not try to
right-align or numerically format it — but it must still apply the same 24px `tabular-nums` value treatment, because
the CSS applies `.stat-value` to whatever the value is (`Stat.tsx:34-36`).

The `title` tooltip on tile 2 is `` `${view.top.model} (${view.top.provider})` `` (`:97`) — the disambiguated name,
because `modelKey(model, provider)` is the true identity (`data/colors.ts:25-27`).

**Model identity is `model::provider`.** It appears in `rowKey` (`:187`), in the colour lookup (`:346`, `:424`),
and it is why the label helper appends the provider only when a model name appears under more than one provider
(`ModelsRoute.tsx:301-310`). **A terminal table row is keyed by the pair, not the name.**

## Card 1 — "Request share"

```
section.card.rise[--i=1]
  header.card-header
    div.card-titles
      h2.card-title        "Request share"                                    :127
      p.card-description   "Each model's share of requests per hour"           :130
                            (mode==="share")  |  "Requests per hour, stacked by model"  (mode==="requests")  :131
    div.card-actions
      div.segmented[sm]    SHARE | REQUESTS                                  :134-140
  div.card-body[data-flush=false]
    div.stack[gap:12]
      div.chart[height:260px]
      div.legend > button.legend-item ×N   (swatch + label + value)           :159-168
```

**This is the one card on Models where the legend is a proper toggle** — it passes `hidden={hidden}` and
`onToggle={toggleSeries}` (`:166-167`), so each item is a `<button.legend-item>` with `data-off` and
`opacity: 0.38` when hidden (`styles.css:1752-1754`).

Legend `value` is **`formatPercent`, not compact** — each model's share of all requests:
`` value: formatPercent(sumValues(s.values) / Math.max(1, sumValues(view.requestTotals))) `` (`:164`).

`SHARE_OPTIONS` toggles two chart *configurations*:
- `share` mode: `yMax={1}`, `format={v => formatPercent(v, 0)}` — **whole percents**, axis pinned at 100% (`:154-155`)
- `requests` mode: `format={formatCompact}`, `showTotal` (tooltip gets a total row) (`:156-157`)

**Chart geometry:** `height={260}` (`:153`), **stacked** (`Chart.tsx:60`), `barW = min(56, slotW × 0.72)`,
`Y_TICKS = 4`, `PAD_TOP 10` / `PAD_BOTTOM 24`.

## Card 2 — "All models" — the widest table on the dashboard

```
section.card.rise[--i=2]  flush
  header.card-header
    h2.card-title        "All models"                                    :177
    p.card-description   "Click a row for latency and throughput over time" :178
  div.card-body[data-flush=true]
    div.table-wrap > table.table[data-dense=FALSE]
      thead > tr > th ×10
      tbody
        tr[data-clickable] > td ×10
        tr (detail) > td[colspan=10] > ModelDetail        ← when expanded
  (no .table-more rendered until limit is exceeded; limit={25} at :190)
```

Table props: `rowKey={row => modelKey(row.model, row.provider)}` (`:187`),
`initialSort={{key:"requests", dir:"desc"}}` (`:189`), **`limit={25}`** (`:190`), `onRowClick` toggles the expanded
row (`:191-194`), `expanded={row => <ModelDetail …/>}` (`:196-207`). **Not `dense`** — measured `data-dense=false`.

### Columns — `buildModelColumns`, `ModelsRoute.tsx:311-434`. **Ten columns.**

| # | key | header | align | width | cell | formatter, verbatim | `file:line` |
|---|---|---|---|---|---|---|---|
| 0 | `expand` | *(empty string)* | left | **`28px`** | `span.models-chevron` + `ChevronRight 14px` | — | `:314-323` |
| 1 | `model` | `Model` | left | — | **`LabelCell`** `lead={<Swatch/>}` `primary={<span className="mono">{row.model}</span>}` `secondary={row.provider}` | — | `:324-335` |
| 2 | `requests` | `Requests` | **right** | — | **`MeterCell`** `max={view.maxRequests}` | `formatInteger(row.totalRequests)` `:345` | `:336-349` |
| 3 | `cost` | `Cost` | **right** | — | `span.num` | `formatEstimatedCost(row.totalCost, row.unpricedRequests)` `:356` | `:350-357` |
| 4 | `tokens` | `Tokens` | **right** | — | `span.num` + `title` | **`formatCompact(tokens)`** where `tokens = sumConversationTokens(row)` `:368` | `:358-372` |
| 5 | `cache` | `Cache rate` | **right** | — | `span.num` | `formatPercent(row.cacheRate)` `:379` | `:373-380` |
| 6 | `errors` | `Errors` | **right** | — | **`Badge`** `mono` `tone={errorRateTone(row.errorRate)}`, or `span.num.dim` `"0%"` when `row.failedRequests === 0` | `formatErrorRate(row.errorRate)` `:392` | `:381-396` |
| 7 | `tps` | `Tokens/s` | **right** | — | `span.num` | `formatTokensPerSecond(row.avgTokensPerSecond)` `:403` | `:397-404` |
| 8 | `ttft` | `TTFT` | **right** | — | `span.num` | `formatDurationMs(row.avgTtft)` `:411` | `:405-412` |
| 9 | `trend` | `Trend` | (left; header only) | **`112px`** | **`Sparkline width={96} height={22}`**, or `span.dim "–"` | — | `:413-432` |

**`formatCompact` vs `formatInteger` in this table — the one place they genuinely differ within a single column set:**

- **`formatCompact` (exactly one column):** `Tokens` (`:368`). Its `title` carries the full
  `formatInteger(tokens)` (`:367`), so the compact form is the visible value and the exact value is the tooltip.
- **`formatInteger`:** `Requests` (`:345`).
- **`formatEstimatedCost`:** `Cost` (`:356`).
- **`formatPercent`:** `Cache rate` (`:379`).
- **`formatErrorRate`:** `Errors` (`:392`).
- **`formatTokensPerSecond` / `formatDurationMs`:** `Tokens/s` (`:403`) / `TTFT` (`:411`).

The IR collapses `Cost`+`Tokens`+`Cache rate`+`Errors`+`Tokens/s`+`TTFT` into six columns at `spec.ts:590-603`,
**omitting the `expand` chevron column** — a terminal must decide whether to keep the 28px chevron. The web keeps
it because rows expand; the IR's `expandable: true` on the Model column (`spec.ts:587`) records the same fact
differently.

**Notable per-column detail worth copying:**
- **`Errors` has two renderings** (`:386-395`): a bare dim `"0%"` when nothing failed, and a mono `Badge` when
  something did. A zero-failure row does **not** get a green `ok` badge. Contrast Projects, which uses
  `tone="neutral"` for zero (`ProjectsRoute.tsx:299`).
- **`MeterCell` colour is the row's series swatch**, or `OTHER_COLOR` `#6c6c74` (`data/colors.ts:22`) when the row
  is outside the palette (`:346`).
- **The chevron rotates 90° and goes `ink-3 → ink-1` when open** (`models.css:3-12`).
- **`Trend` is the only column with no `align`**, so it inherits `left` (`Table.tsx:91`, `135`), even though a
  sparkline is visually a right-anchored figure. The header "Trend" is therefore **left-aligned while every other
  header is right-aligned** (`:415`, no `align` key).
- The expanded `ModelDetail` is a **two-column grid** `minmax(260px, 340px) minmax(0, 1fr)` with `gap: 24px`,
  `padding: 16px 16px 18px 44px` (the 44px left padding clears the chevron column), background `var(--panel)`,
  `border-bottom: 1px solid var(--line-1)` (`models.css:14-22`), with `.section-label` sub-headings "Efficiency",
  "Latency", "Tokens" (`ModelsRoute.tsx:473`, `505`, `515`).

## Notable formatter calls, verbatim

```
formatEstimatedCost(view.totalCost, view.unpricedRequests)                   ModelsRoute.tsx:114
formatInteger(view.failedRequests)                                           ModelsRoute.tsx:108
formatPercent(view.top.totalRequests / Math.max(1, view.totalRequests))      ModelsRoute.tsx:101
formatEstimatedCost(row.totalCost, row.unpricedRequests)                     ModelsRoute.tsx:356
formatCompact(sumConversationTokens(row))                                     ModelsRoute.tsx:368
formatPercent(row.cacheRate)                                                 ModelsRoute.tsx:379
formatErrorRate(row.errorRate)                                                ModelsRoute.tsx:392
formatTokensPerSecond(row.avgTokensPerSecond)                                ModelsRoute.tsx:403
formatDurationMs(row.avgTtft)                                                 ModelsRoute.tsx:411
formatPercent(sumValues(s.values) / Math.max(1, sumValues(view.requestTotals))) ModelsRoute.tsx:164
```

## Terminal shape at 150 columns

```
Models
Which models did the work in the last 24 hours, and how fast they answered.

  Models used   4              ← 24px, NO spark
  Most used     muse-spark-1.3-contributor
  Requests      3,956     ▁▂▄▆▅
  API-equivalent cost  $4.09

─ Request share ─────────── Each model's share of requests per hour ──
  stacked bars, 260px, y pinned at 100%, whole-percent axis
  ▪ muse… 34%   ▪ gpt… 22%   ▪ claude… 18%   ▪ …      ← legend BELOW, toggles
─ All models ───────── Click a row for latency and throughput over time ─
  ▸ Model              Requests  Cost   Tokens  Cache rate  Errors  Tokens/s  TTFT  Trend
     muse-spark…         1,204  $1.90    412M     98.1%   [0.4%]     71.2   2.9s  ▁▂▄▆
```

- Ten columns at 150 characters is roughly 130 usable — the IR's `priority` drop order is the terminal's own
  decision; the web's decision is `overflow-x: auto`.
- The stat row is **one clean row of 4** because `min: 200px` divides 942 evenly. Preserve that: it is the only
  stat row in the dashboard with no wrap at full width.
