# Providers — 100 columns (800px viewport)

**Web route:** `routes/ProvidersRoute.tsx` · **IR citation:** `src/layout/spec.ts:1159-1163`
**Capture:** `screens/providers-100.png` — live, `#/providers?range=24h`, 800px, dark, fullPage. Page height **2661px**.
Full column/format detail: **`providers-150.md`**. All deltas measured live.

## Measured at 800px

| Property | At 1200px | **At 800px** |
|---|---|---|
| `.shell-content` padded box | `986px` | **`782px`** (inner `750px`) |
| `--gutter` | `22px` | `16px` |
| **`.grid-main-side`** | `617.328px 308.656px` (2-up) | **`750px` — ONE column** (`styles.css:716-722`) |
| StatGrid (`min 190`) | 4 cols → 4 + 1 | **3 columns**, 5 tiles → **3 + 2** |
| Provider-totals table | 9 cols, `940px` = `940px` | 9 cols, **`748px` client**, `901px` scroll → **+153px** |
| Subscription windows *(out of scope)* | 8 cols, `940px` client, `964px` scroll | 8 cols, `748px` client, `964px` scroll |
| Window-utilization table *(out of scope)* | 7 cols, `940px` = `940px` | 7 cols, `748px` client, `836px` scroll |
| `data-dense` | totals `false` | totals `false` |

**Two load-bearing facts at 100 columns:**

1. **`grid-main-side` has collapsed.** Burn by provider and Peak burn hours become stacked 750px cards, in that order.
2. **Provider totals crosses from fitting to overflowing.** At 1200px `scrollWidth === clientWidth === 940px`; at
   800px it needs 901px in a 748px box. **This is the only table whose overflow status changes across the four
   capture widths**, and it is driven by the 9-column set plus two fixed `64px` meters.

## Page header

```
h1.page-title        "Providers"                                                       ProvidersRoute.tsx:146-149
p.page-description   "Burn, reliability and subscription headroom per provider over the last 24 hours."
(no .page-actions)
```

## Top-level order — unchanged by width

| # | Element | `file:line` |
|---|---|---|
| 1 | `PageHeader` | `:146-149` |
| 2 | StatGrid — 5 `md` tiles, `min={190}` → **3 cols** | `:154-185` |
| 3 | Card "Provider totals" — `flush`, `limit={12}` | `:190-204` |
| 4 | Burn by provider (750px) → Peak burn hours (750px) | `:206-249` |
| 5 | Subscription windows *(out of scope)* | `:251-261` |
| 6 | Window utilization *(out of scope)* | `:263-268` |

**Provider totals comes BEFORE Burn by provider in the web.** The IR's band order is the reverse
(`spec.ts:1190-1205` then `spec.ts:1206-1251`). Recorded in `providers-150.md`.

## StatGrid — 3 + 2

| # | Tile | value formatter | hint formatter | spark |
|---|---|---|---|---|
| 1 | Providers | `formatInteger(providers.length)` `:157` | `Most tokens: ${view.topProvider.provider}` `:158` | none |
| 2 | Requests | `formatInteger(t.requests)` `:162` | `formatInteger(t.failed)` `" failed"` `:163` | `view.spark.requests` `:164` |
| 3 | Tokens | **`formatCompact(t.tokens)`** `:169` | **none** | `view.spark.tokens` `:170` |
| 4 | API-equivalent cost | `formatEstimatedCost(t.cost, t.unpriced)` `:175` | `formatInteger(t.unpriced)` `" unpriced"` `:176` | `view.spark.cost`, **`var(--chart-secondary)`** `:177-178` |
| 5 | Error rate | `formatErrorRate(t.requests > 0 ? t.failed / t.requests : 0)` `:182` | `formatInteger(t.requests - t.failed)` `" succeeded"` `:183` | none |

**`formatCompact` on tile 3 only** — and tile 3 is one of only two hintless tiles (3 and 5), so the trailing row at
this width (Tokens + Error rate) is the row that shows the 2-line vs 3-line distinction most clearly.

**Three sparklines** on this stat row (2, 3, 4) — the only stat row in the dashboard with three.

## Card 1 — "Provider totals" — `flush`, 9 columns, +153px

`rowKey = p.provider` `:422`; `initialSort {key:"tokens",dir:"desc"}` `:424`; **`limit={12}`** `:425`;
`selectedKey={open}` `:426`; `expanded` → `TokenMix` `:428`; **not `dense`**.

### Columns — `ProvidersRoute.tsx:301-417`, in the **web's** order

| # | header | align | cell | formatter, verbatim | `file:line` |
|---|---|---|---|---|---|
| 1 | `Provider` | left | `span.row[gap:8]` = `Swatch` + `span.mono.cell-primary` — **a single line, not a `LabelCell`** | — | `:311-321` |
| 2 | `Requests` | **right** | **`MeterCell`** `max={maxRequests}` | `formatInteger(p.totalRequests)` `:328` | `:322-330` |
| 3 | `Error rate` | **right** | `span.num.dim` + **`Badge` mono** (`tone="neutral"` at 0) | `formatInteger(p.failedRequests)` `:340`; `formatErrorRate(rate)` `:342` | `:331-347` |
| 4 | `Models` | **right** | `span.num` | `formatInteger(p.models)` `:354` | `:348-355` |
| 5 | `Tokens` | **right** | **`MeterCell`** `max={maxTokens}` | **`formatCompact(p.totalTokens)`** `:366` | `:356-370` |
| 6 | `Share` | **right** | `span.num.muted` | `formatPercent(grandTokens > 0 ? p.totalTokens / grandTokens : 0)` `:378` | `:371-380` |
| 7 | `Cost` | **right** | `span.num` + conditional `title` | `formatEstimatedCost(p.totalCost, p.unpricedRequests)` `:392` | `:381-395` |
| 8 | `Tokens/s` | **right** | `span.num` | `formatTokensPerSecond(p.avgTokensPerSecond)` `:402` | `:396-403` |
| 9 | `Premium` | **right** | `span.num`, `span.num.dim` when 0 | `formatInteger(Math.round(p.totalPremiumRequests * 100) / 100)` `:412` | `:404-415` |

**`formatCompact` on exactly one column (`Tokens`); `formatInteger` on four** (Requests, Error rate's count, Models,
Premium).

**The IR's column order is different** (`spec.ts:1215-1249`): Provider, Requests, Tokens, Cost, Share, Error rate,
Models, Tokens/s, Premium. **The web puts Error rate 3rd, Models 4th, Tokens 5th, Share 6th, Cost 7th.** Recorded,
not reconciled.

Two independent MeterCell maxima, computed separately (`:302-308`). `Share` divides by the **grand** token total
(`:378`).

## Card 2 — "Burn by provider" (750px)

```
section.card.rise[--i=2]
  h2.card-title        "Burn by provider"                                              :209
  p.card-description   "Per hour, top 6 providers stacked"                             :213
  div.card-actions > div.segmented[sm]                                                :215
  div.card-body > div.stack[gap:12]
    div.chart[height:260px]                                                           :226
    div.legend > button.legend-item ×N   (measured 2)                                  :231
```

`TOP_PROVIDERS = 6` (`:61`); `pivotSeries` folds the rest into `Other` (`:115-116`).
`burnFormat = metric === "cost" ? (v => formatCost(v)) : formatCompact` (`:141`) — **the axis formatter changes
with the metric; money is never compacted.**
`formatTooltip={metric === "cost" ? v => formatCost(v) : formatInteger}` `:228`.
`emptyLabel = "No provider activity in this range"` `:229`.
Legend `value = burnFormat(sum(values))` `:236`, toggleable `:239`.

At 750px the chart is ~716px wide; 24 hourly buckets → `slotW ≈ 28px` → `barW = min(56, 28 × 0.72) = 20px`.

## Card 3 — "Peak burn hours" (750px, out of IR scope)

`ProvidersRoute.tsx:246-248`. Bare `Chart` in the card body — **no legend**, a `select.input.providers-select`
(`max-width: 220px`, `providers.css:1-3`) as its action, description
`"Tokens by local hour of day; peak at 21:00"`. A local aggregate, so not network-gated, but the IR omits it.

## Terminal shape at 100 columns

```
Providers
Burn, reliability and subscription headroom per provider over the last 24 hours.

  Providers            3
  Requests             3,984   ▁▂▄▆▅
  Tokens               968M    ▁▁▂▄▆
  API-equivalent cost  $4.13    ▁▂▃▅▇    ← PINK spark
  Error rate           1.4%
                          ← 3 + 2; Tokens and Error rate are the
                            two hintless tiles, so row 2 is short

─ Provider totals ─── Cost is an API-equivalent estimate. Select a row … ──
  Provider  Requests  Error rate  Models  Tokens  Share  Cost   Tokens/s  Premium
  anthropic 1,802 ▓▓▓ 4 [0.2%]    3       512M ▓▓▓ 52.9% $2.10   71.2      0
  openai    1,540 ▓▓  2 [0.1%]    2       380M ▓▓  39.2% $1.60   68.4    1.50
  ← 901px of table in 748px — it FIT at 150 columns and now scrolls

─ Burn by provider ────────── Per hour, top 6 providers stacked ──────────
  stacked 260px; ~20px bars at 716px
  ▪ anthropic $2.10   ▪ openai $1.60
─ Peak burn hours ────────── Tokens by local hour of day; peak at 21:00 ──
  [provider ▾]   ← bare Chart, no legend
```

- **`grid-main-side` collapsed**: the two cards stack, in order.
- Provider totals flips from fitting to overflowing between 150 and 100 columns.
