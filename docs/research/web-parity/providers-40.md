# Providers — 40 columns (320px viewport)

**Web route:** `routes/ProvidersRoute.tsx` · **IR citation:** `src/layout/spec.ts:1159-1163`
**Capture:** `screens/providers-40.png` — live, `#/providers?range=24h`, 320px, dark, fullPage. Page height **3240px**.
Full column/format detail: **`providers-150.md`**. All deltas measured live.

## Measured at 320px

| Property | At 1200px | **At 320px** |
|---|---|---|
| `.shell-content` padded box | `986px` | **`302px`** (inner `270px`) |
| `--gutter` | `22px` | `16px` |
| `.grid-main-side` | `617px 309px` | **`270px` — ONE column** |
| StatGrid (`min 190`) | 4 cols → 4 + 1 | **1 column** — `floor(270/190) = 1`; 5 tiles stack |
| Provider-totals table | 9 cols, `940px` = `940px` | 9 cols, **`268px` client**, `901px` scroll → **+633px (3.4×)** |
| Subscription windows *(out of scope)* | 8 cols | 8 cols, `268px` client, `964px` scroll → **+696px (3.6×)** |
| Window-utilization table *(out of scope)* | 7 cols, dense | 7 cols, dense, `268px` client, `836px` scroll → **+568px (3.1×)** |
| `data-dense` (totals) | `false` | `false` |

**Load-bearing fact at 40 columns: the stat grid is a 5-tile vertical stack and every table on the screen
overflows 3× or more.** The web's only adaptation is stacking and the horizontal scrollbar; nothing is dropped,
wrapped or reordered.

## Page header

```
h1.page-title        "Providers"                                                    ProvidersRoute.tsx:146-149
p.page-description   "Burn, reliability and subscription headroom per provider over the last 24 hours."
(no .page-actions)
```

## Top-level order — unchanged by width

| # | Element | `file:line` |
|---|---|---|
| 1 | `PageHeader` | `:146-149` |
| 2 | StatGrid — 5 `md` tiles, `min={190}` → **1 col** | `:154-185` |
| 3 | Card "Provider totals" — `flush`, `limit={12}` | `:190-204` |
| 4 | Burn by provider (270px) → Peak burn hours (270px) | `:206-249` |
| 5 | Subscription windows *(out of scope)* | `:251-261` |
| 6 | Window utilization *(out of scope)* | `:263-268` |

## StatGrid — one tile per row

| # | Tile | value formatter | hint formatter | spark |
|---|---|---|---|---|
| 1 | Providers | `formatInteger(providers.length)` `:157` | `Most tokens: ${view.topProvider.provider}` `:158` | none |
| 2 | Requests | `formatInteger(t.requests)` `:162` | `formatInteger(t.failed)` `" failed"` `:163` | `view.spark.requests` `:164` |
| 3 | Tokens | **`formatCompact(t.tokens)`** `:169` | **none** | `view.spark.tokens` `:170` |
| 4 | API-equivalent cost | `formatEstimatedCost(t.cost, t.unpriced)` `:175` | `formatInteger(t.unpriced)` `" unpriced"` `:176` | `view.spark.cost`, **`var(--chart-secondary)`** `:177-178` |
| 5 | Error rate | `formatErrorRate(t.requests > 0 ? t.failed / t.requests : 0)` `:182` | `formatInteger(t.requests - t.failed)` `" succeeded"` `:183` | none |

**`formatCompact` on tile 3 only.** Tiles 3 and 5 are the hintless pair, so in a single column they are visibly
**2 lines** while tiles 1, 2 and 4 are **3 lines** (`Stat.tsx:37-42` gates `.stat-foot` on `hint !== undefined`).

Tile 1's hint is a provider name (`:158`) and tile 3's value is a compact token count (`:169`) — a stat value and a
stat hint both carrying prose at 40 columns, both of which must ellipsise rather than wrap
(`styles.css:848-857`).

**Three sparklines** (tiles 2, 3, 4) at 28px tall (`styles.css:876-879`), filling the tile width.

## Card 1 — "Provider totals" — `flush`, 9 columns, 3.4×

Description `:193-197`. `rowKey = p.provider` `:422`; `initialSort {key:"tokens",dir:"desc"}` `:424`;
**`limit={12}`** `:425`; `selectedKey` `:426`; `expanded` → `TokenMix` `:428`; **not `dense`**.

| # | header | align | cell | formatter, verbatim | `file:line` |
|---|---|---|---|---|---|
| 1 | `Provider` | left | `span.row[gap:8]` = `Swatch` + `span.mono.cell-primary` — **single line** | — | `:311-321` |
| 2 | `Requests` | **right** | **`MeterCell 64×4`** `max={maxRequests}` | `formatInteger(p.totalRequests)` `:328` | `:322-330` |
| 3 | `Error rate` | **right** | `span.num.dim` + **`Badge` mono** (`tone="neutral"` at 0) | `formatInteger(p.failedRequests)` `:340`; `formatErrorRate(rate)` `:342` | `:331-347` |
| 4 | `Models` | **right** | `span.num` | `formatInteger(p.models)` `:354` | `:348-355` |
| 5 | `Tokens` | **right** | **`MeterCell 64×4`** `max={maxTokens}` | **`formatCompact(p.totalTokens)`** `:366` | `:356-370` |
| 6 | `Share` | **right** | `span.num.muted` | `formatPercent(grandTokens > 0 ? p.totalTokens / grandTokens : 0)` `:378` | `:371-380` |
| 7 | `Cost` | **right** | `span.num` + conditional `title` | `formatEstimatedCost(p.totalCost, p.unpricedRequests)` `:392` | `:381-395` |
| 8 | `Tokens/s` | **right** | `span.num` | `formatTokensPerSecond(p.avgTokensPerSecond)` `:402` | `:396-403` |
| 9 | `Premium` | **right** | `span.num` / `span.num.dim` at 0 | `formatInteger(Math.round(p.totalPremiumRequests * 100) / 100)` `:412` | `:404-415` |

**`formatCompact` on one column; `formatInteger` on four.** Two independent MeterCell maxima (`:302-308`).
`Share` divides by the **grand** token total (`:378`).

**The web's column order is Provider, Requests, Error rate, Models, Tokens, Share, Cost, Tokens/s, Premium**
(`:311-415`). The IR declares a different order (`spec.ts:1215-1249`). Recorded in `providers-150.md`.

## Card 2 — "Burn by provider" (270px)

```
section.card.rise[--i=2]
  h2.card-title        "Burn by provider" / "Per hour, top 6 providers stacked"     :209, :213
  div.card-actions > div.segmented[sm]     ← wraps below the title (styles.css:788)  :215
  div.card-body > div.stack[gap:12]
    div.chart[height:260px]                ← 236px wide                            :226
    div.legend > button.legend-item ×N     ← one per row                          :231
```

`TOP_PROVIDERS = 6` `:61`; rest folded into `Other` `:115-116`. Chart is **236px wide**: `padLeft = 28`,
`padRight = 8`, plot ≈ `200px`, 24 hourly buckets → `slotW ≈ 8.3px` → **`barW ≈ 6px`**.
`burnFormat = metric === "cost" ? v => formatCost(v) : formatCompact` `:141`.
`formatTooltip = metric === "cost" ? v => formatCost(v) : formatInteger` `:228`.
`emptyLabel = "No provider activity in this range"` `:229`. Legend `value = burnFormat(sum)` `:236`.

## Card 3 — "Peak burn hours" (270px, out of IR scope)

`ProvidersRoute.tsx:246-248`. Bare `Chart`, **no legend**, `select.input.providers-select`
(`max-width: 220px`, `providers.css:1-3`), description `"Tokens by local hour of day; peak at 21:00"`.

## Terminal shape at 40 columns

```
Providers
Burn, reliability and subscription headroom per provider
over the last 24 hours.

  Providers
    3
    Most tokens: anthropic
  Requests
    3,984    ▁▂▄▆▅
  Tokens
    968M     ▁▁▂▄▆
  API-equivalent cost
    $4.13    ▁▂▃▅▇      ← PINK spark
  Error rate
    1.4%

─ Provider totals ─── Cost is an API-equivalent estimate … ───
  Provider  Requests  Error rate  Models  Tokens  Share  Cost   Tokens/s  Premium
  anthropic 1,802▓▓▓ 4[0.2%]    3       512M▓▓▓ 52.9% $2.10  71.2      0
  openai    1,540▓▓  2[0.1%]    2       380M▓▓ 39.2% $1.60  68.4    1.50
  ← 901px of content in 268px

─ Burn by provider ──────── Per hour, top 6 providers stacked ──
  [metric switch]
  stacked, ~6px bars at 236px plot
  ▪ anthropic $2.10
  ▪ openai $1.60
─ Peak burn hours ── Tokens by local hour of day; peak at 21:00 ──
  [provider ▾]   ← bare Chart, no legend
```

**What 40 columns forces.** Nine columns needing 901px in a 268px wrapper, with two fixed `64px` meters and one
`64px` `Badge`. The IR's `priority` field is where a drop order belongs (`spec.ts:236-244`) and it is explicitly the
terminal's own decision — this document records the measurement and stops.
