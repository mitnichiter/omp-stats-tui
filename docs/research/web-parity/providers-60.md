# Providers — 60 columns (480px viewport)

**Web route:** `routes/ProvidersRoute.tsx` · **IR citation:** `src/layout/spec.ts:1159-1163`
**Capture:** `screens/providers-60.png` — live, `#/providers?range=24h`, 480px, dark, fullPage. Page height **2887px**.
Full column/format detail: **`providers-150.md`**. All deltas measured live.

## Measured at 480px

| Property | At 1200px | **At 480px** |
|---|---|---|
| `.shell-content` padded box | `986px` | **`462px`** (inner `430px`) |
| `--gutter` | `22px` | `16px` |
| `.grid-main-side` | `617px 309px` | **`430px` — ONE column** |
| StatGrid (`min 190`) | 4 cols → 4 + 1 | **2 columns**, 5 tiles → **2 + 2 + 1** |
| Provider-totals table | 9 cols, `940px` = `940px` | 9 cols, **`428px` client**, `901px` scroll → **+473px (2.1×)** |
| Subscription windows *(out of scope)* | 8 cols | 8 cols, `428px` client, `964px` scroll |
| Window-utilization table *(out of scope)* | 7 cols, dense | 7 cols, dense, `428px` client, `836px` scroll |
| `data-dense` (totals) | `false` | `false` |

`floor(430/190) = 2`, so the five stat tiles pair 2 + 2 with "Error rate" alone on a third row.

## Page header

```
h1.page-title        "Providers"                                                    ProvidersRoute.tsx:146-149
p.page-description   "Burn, reliability and subscription headroom per provider over the last 24 hours."
(no .page-actions)
```

`.stat-grid` sets **no `gap`** — tiles are separated by `box-shadow: 1px 0 0 var(--line-1), 0 1px 0 var(--line-1)`,
a 1px right rule **and** a 1px bottom rule (`styles.css:815-837`). `.stat-foot { min-height: 18px }`
(`styles.css:873`) means a hinted tile never changes height with its text.

At 1200px `.grid-main-side` is `617.328px 308.656px` — a **2fr : 1fr** split with a `16px` gap
(`styles.css:712-714`, `:701`).

The card is `flush`, so `.card-body` drops its left/right padding (`styles.css:797-799`).

`.chart` is `position: relative; width: 100%` (`styles.css:1619-1624`), so the plot fills the card body; the axis
band is `PAD_BOTTOM 24` with `10.5px` mono ticks in `--chart-axis` (`styles.css:1630-1634`).


## Top-level order — unchanged by width

| # | Element | `file:line` |
|---|---|---|
| 1 | `PageHeader` | `:146-149` |
| 2 | StatGrid — 5 `md` tiles, `min={190}` → **2 cols** | `:154-185` |
| 3 | Card "Provider totals" — `flush`, `limit={12}` | `:190-204` |
| 4 | Burn by provider (430px) → Peak burn hours (430px) | `:206-249` |
| 5 | Subscription windows *(out of scope)* | `:251-261` |
| 6 | Window utilization *(out of scope)* | `:263-268` |

## StatGrid — 2 + 2 + 1

| # | Tile | value formatter | hint formatter | spark |
|---|---|---|---|---|
| 1 | Providers | `formatInteger(providers.length)` `:157` | `Most tokens: ${view.topProvider.provider}` `:158` | none |
| 2 | Requests | `formatInteger(t.requests)` `:162` | `formatInteger(t.failed)` `" failed"` `:163` | `view.spark.requests` `:164` |
| 3 | Tokens | **`formatCompact(t.tokens)`** `:169` | **none** | `view.spark.tokens` `:170` |
| 4 | API-equivalent cost | `formatEstimatedCost(t.cost, t.unpriced)` `:175` | `formatInteger(t.unpriced)` `" unpriced"` `:176` | `view.spark.cost`, **`var(--chart-secondary)`** `:177-178` |
| 5 | Error rate | `formatErrorRate(t.requests > 0 ? t.failed / t.requests : 0)` `:182` | `formatInteger(t.requests - t.failed)` `" succeeded"` `:183` | none |

**`formatCompact` on tile 3 only.** Tiles 3 and 5 are the hintless pair; tile 5 standing alone makes that visible.


At 1200px `.grid-main-side` is `617.328px 308.656px` — a **2fr : 1fr** split with a `16px` gap
(`styles.css:712-714`, `:701`).

**Three sparklines** (tiles 2, 3, 4) — Requests cyan, Tokens cyan, Cost **pink**.

## Card 1 — "Provider totals" — `flush`, 9 columns, 2.1×

Description `:193-197`: `"Cost is an API-equivalent estimate and excludes N unpriced subscription request(s).
Select a row for its token mix."` — or the same without the exclusion clause when nothing is unpriced.

`rowKey = p.provider` `:422`; `initialSort {key:"tokens",dir:"desc"}` `:424`; **`limit={12}`** `:425`;
`selectedKey={open}` `:426`; `expanded` → `TokenMix` `:428`; **not `dense`**.

| # | header | align | cell | formatter, verbatim | `file:line` |
|---|---|---|---|---|---|
| 1 | `Provider` | left | `span.row[gap:8]` = `Swatch` + `span.mono.cell-primary` — **single line, not a `LabelCell`** | — | `:311-321` |
| 2 | `Requests` | **right** | **`MeterCell 64×4`** `max={maxRequests}` | `formatInteger(p.totalRequests)` `:328` | `:322-330` |
| 3 | `Error rate` | **right** | `span.num.dim` + **`Badge` mono** (`tone="neutral"` at 0) | `formatInteger(p.failedRequests)` `:340`; `formatErrorRate(rate)` `:342` | `:331-347` |
| 4 | `Models` | **right** | `span.num` | `formatInteger(p.models)` `:354` | `:348-355` |

The card is `flush`, so `.card-body` drops its left/right padding (`styles.css:797-799`).

| 5 | `Tokens` | **right** | **`MeterCell 64×4`** `max={maxTokens}` | **`formatCompact(p.totalTokens)`** `:366` | `:356-370` |
| 6 | `Share` | **right** | `span.num.muted` | `formatPercent(grandTokens > 0 ? p.totalTokens / grandTokens : 0)` `:378` | `:371-380` |
| 7 | `Cost` | **right** | `span.num` + conditional `title` | `formatEstimatedCost(p.totalCost, p.unpricedRequests)` `:392` | `:381-395` |
| 8 | `Tokens/s` | **right** | `span.num` | `formatTokensPerSecond(p.avgTokensPerSecond)` `:402` | `:396-403` |
| 9 | `Premium` | **right** | `span.num` / `span.num.dim` at 0 | `formatInteger(Math.round(p.totalPremiumRequests * 100) / 100)` `:412` | `:404-415` |

**`formatCompact` on one column; `formatInteger` on four.** Two independent MeterCell maxima (`:302-308`).
`Share` divides by the **grand** token total (`:378`) — not the row's own scope.

**The IR's column order differs from the web's** (`spec.ts:1215-1249` vs `:311-415`); recorded in
`providers-150.md` and unresolved.

## Card 2 — "Burn by provider" (430px)

```
section.card.rise[--i=2]
  h2.card-title        "Burn by provider" / "Per hour, top 6 providers stacked"    :209, :213
  div.card-actions > div.segmented[sm]                                            :215
  div.card-body > div.stack[gap:12]
    div.chart[height:260px]                                                       :226
    div.legend > button.legend-item ×2   (measured; wraps to 2 rows)               :231
```

`TOP_PROVIDERS = 6` `:61`; rest folded into `Other` by `pivotSeries` `:115-116`.
`burnFormat = metric === "cost" ? v => formatCost(v) : formatCompact` `:141`.
`formatTooltip = metric === "cost" ? v => formatCost(v) : formatInteger` `:228`.
`emptyLabel = "No provider activity in this range"` `:229`.
Legend `value = burnFormat(sum)` `:236`, toggleable `:239`.

At 430px the chart is ~396px wide; 24 hourly buckets → `slotW ≈ 15px` → `barW ≈ 10.8px`.

## Card 3 — "Peak burn hours" (430px, out of IR scope)


`ProvidersRoute.tsx:246-248`. Bare `Chart`, **no legend**, `select.input.providers-select` action
(`providers.css:1-3`), description `"Tokens by local hour of day; peak at 21:00"`.

## Terminal shape at 60 columns

```
Providers
Burn, reliability and subscription headroom per provider
over the last 24 hours.

  Providers            3
  Requests             3,984   ▁▂▄▆▅
  Tokens               968M    ▁▁▂▄▆
  API-equivalent cost  $4.13    ▁▂▃▅▇   ← PINK
  Error rate           1.4%
                        ← 2 + 2 + 1

─ Provider totals ─── Cost is an API-equivalent estimate … ───
  Provider  Requests  Error rate  Models  Tokens  Share  Cost   Tokens/s  Premium
  anthropic 1,802▓▓▓ 4[0.2%]    3       512M▓▓▓ 52.9% $2.10  71.2      0
  openai    1,540▓▓  2[0.1%]    2       380M▓▓ 39.2% $1.60  68.4    1.50
  ← 901px of content in 428px

─ Burn by provider ──────── Per hour, top 6 providers stacked ──
  stacked, ~11px bars at 396px
  ▪ anthropic $2.10
  ▪ openai $1.60
─ Peak burn hours ──── Tokens by local hour of day; peak at 21:00 ──
  [provider ▾]   ← bare Chart, no legend
```

- **Provider totals' two fixed `64px` meters consume 30% of the 428px wrapper** before any data.
- `Provider` is a **single-line** `span.mono.cell-primary` — the only table on this screen that does not use
  `LabelCell` for its identity column.
