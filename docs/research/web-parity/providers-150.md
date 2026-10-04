# Providers — 150 columns (1200px viewport)

**Web route:** `routes/ProvidersRoute.tsx`
**IR citation:** `src/layout/spec.ts:1159-1163` —
`lines: "146-188 (StatGrid), 189-205 (Provider totals), 206-249 (Burn by provider), 311-422 (columns)"`
**Capture:** `screens/providers-150.png` — live, `#/providers?range=24h`, 1200px, dark, fullPage. Page height **2298px**.

> **Scope note.** This screen has FOUR cards in the web and the IR ports three of them. The fourth —
> **"Subscription windows"** (`ProvidersRoute.tsx:251-261`) and **"Window utilization"** (`:263-268`) — reads
> `provider-windows`, a **network-only** payload the panel never fetches. The IR's note at `spec.ts:1162` records
> that boundary. Those two cards are documented below for completeness but are **out of the port's scope**; the
> ported screen is: StatGrid → Provider totals → Burn by provider (+ Peak burn hours, a local aggregate).

## Page header

```
h1.page-title        "Providers"                                                    ProvidersRoute.tsx:146-149
p.page-description   "Burn, reliability and subscription headroom per provider over the last 24 hours."
(no .page-actions)
```

## Top-level order

| # | Element | Wrapper | `file:line` |
|---|---|---|---|
| 1 | `PageHeader` | — | `:146-149` |
| 2 | **StatGrid** — 5 `md` tiles, `min={190}` | `div[data-stale]` | `:154-185` |
| 3 | **Card** "Provider totals" — `flush`, `limit={12}` | full width | `:190-204` |
| 4 | **`div.grid .grid-main-side`** — Burn by provider (2fr) + Peak burn hours (1fr) | — | `:206-249` |
| 5 | Card "Subscription windows" — **out of port scope** | full width | `:251-261` |
| 6 | Card "Window utilization" — **out of port scope** | full width | `:263-268` |

**The card order is not the IR's band order.** The IR's bands are StatGrid → Burn by provider → Provider totals
(`spec.ts:1164-1251`); the web renders **Provider totals before Burn by provider**. If the terminal follows the IR
band order it will put a chart where the web has a table. Flag this when diffing the port.

## StatGrid — `--stat-min: 190px`, 5 tiles → **4 columns, 4 + 1**

`ProvidersRoute.tsx:154-185`. `floor(942/190) = 4`.

| # | Tile | label | value formatter | hint | spark | `file:line` |
|---|---|---|---|---|---|---|
| 1 | Providers | `formatInteger(providers.length)` `:157` | `view.topProvider ? \`Most tokens: ${view.topProvider.provider}\` : undefined` `:158` | none | `:155-159` |
| 2 | Requests | `formatInteger(t.requests)` `:162` | `` `${formatInteger(t.failed)} failed` `` `:163` | `spark={view.spark.requests}` `:164` | `:160-165` |
| 3 | Tokens | **`formatCompact(t.tokens)`** `:169` | **none** | `spark={view.spark.tokens}` `:170` | `:166-171` |
| 4 | API-equivalent cost | `formatEstimatedCost(t.cost, t.unpriced)` `:175` | `t.unpriced > 0 ? \`${formatInteger(t.unpriced)} unpriced\` : undefined` `:176` | `spark={view.spark.cost}` `sparkColor="var(--chart-secondary)"` `:177-178` | `:172-179` |
| 5 | Error rate | `formatErrorRate(t.requests > 0 ? t.failed / t.requests : 0)` `:182` | `` `${formatInteger(t.requests - t.failed)} succeeded` `` `:183` | none | `:180-184` |

**`formatCompact` vs `formatInteger`: tile 3 (`Tokens`) is the ONLY `formatCompact`** — and it is also one of only
two hintless tiles (3 and 5), so it renders 2 lines while 1, 2 and 4 render 3.

**This is the only stat row in the dashboard with three sparklines** (tiles 2, 3, 4), and the **only one where the
spark colours are Requests=cyan, Tokens=cyan, Cost=pink** — the same cost-is-pink convention as
`OverviewRoute.tsx:114` and `CostsRoute.tsx:253`.

The StatGrid has **no gap** of its own: `.stat-grid` sets none, and tiles are separated by
`box-shadow: 1px 0 0 var(--line-1), 0 1px 0 var(--line-1)` — a 1px right rule **and** a 1px bottom rule
(`styles.css:815-837`). `.grid-main-side` resolves to **`617.328px 308.656px`** at 1200px — a measured **2fr : 1fr**
split with the `16px` `.grid` gap (`styles.css:712-714`, `:701`).

## Card 1 — "Provider totals" — `flush`, 9 columns

```
section.card.rise[--i=1] flush
  p.card-description   "Cost is an API-equivalent estimate[ and excludes N unpriced subscription request(s)].
                        Select a row for its token mix."                        :193-197
  div.card-body[data-flush=true]
    div.table-wrap > table.table[data-dense=FALSE]
      thead > tr > th ×9
      tbody
        tr[data-clickable][data-selected] > td ×9
        tr > td[colspan=9] > TokenMix      ← when expanded
```

`ProviderTotalsTable` (`:293-431`): `rowKey={p => p.provider}` `:422`, `initialSort={{key:"tokens",dir:"desc"}}`
`:424`, **`limit={12}`** `:425`, `selectedKey={open}` `:426`, `onRowClick` toggles `:427`,
`expanded={p => <TokenMix provider={p}/>}` `:428`. **Not `dense`.**

At 1200px `.grid-main-side` resolves to **`617.328px 308.656px`** — a measured **2fr : 1fr** split with the
`16px` `.grid` gap (`styles.css:712-714`, `:701`).

### Columns — `ProvidersRoute.tsx:301-417`. Nine, in this order.

| # | key | header | align | cell | formatter, verbatim | `file:line` |
|---|---|---|---|---|---|---|
| 1 | `provider` | `Provider` | left | `span.row[gap:8]` = `Swatch` + `span.mono.cell-primary` | — | `:311-321` |
| 2 | `requests` | `Requests` | **right** | **`MeterCell`** `max={maxRequests}` | `formatInteger(p.totalRequests)` `:328` | `:322-330` |
| 3 | `errors` | `Error rate` | **right** | `span.row[gap:8, justify-content:flex-end]` = `span.num.dim` + **`Badge`** `mono` (`tone="neutral"` when `failedRequests === 0` else `errorRateTone(rate)`) `:341` | `formatInteger(p.failedRequests)` `:340`; `formatErrorRate(rate)` `:342` | `:331-347` |
| 4 | `models` | `Models` | **right** | `span.num` | `formatInteger(p.models)` `:354` | `:348-355` |
| 5 | `tokens` | `Tokens` | **right** | **`MeterCell`** `max={maxTokens}` `color={colors.get(p.provider)}` | **`formatCompact(p.totalTokens)`** `:366` | `:356-370` |
| 6 | `share` | `Share` | **right** | `span.num.muted` | `formatPercent(grandTokens > 0 ? p.totalTokens / grandTokens : 0)` `:378` | `:371-380` |
| 7 | `cost` | `Cost` | **right** | `span.num` + conditional `title` | `formatEstimatedCost(p.totalCost, p.unpricedRequests)` `:392` | `:381-395` |
| 8 | `tps` | `Tokens/s` | **right** | `span.num` | `formatTokensPerSecond(p.avgTokensPerSecond)` `:402` | `:396-403` |
| 9 | `premium` | `Premium` | **right** | `span.num`, or `span.num.dim` when 0 `:411` | `formatInteger(Math.round(p.totalPremiumRequests * 100) / 100)` `:412` | `:404-415` |

**`formatCompact` vs `formatInteger` — one of each:**
- **`formatCompact`** on `Tokens` `:366`
- **`formatInteger`** on `Requests` `:328`, `Errors` `:340`, `Models` `:354`, `Premium` `:412`

**The IR's column ORDER differs from the web's.** The IR lists Provider, Requests, Tokens, Cost, Share, Error rate,
Models, Tokens/s, Premium (`spec.ts:1215-1249`). The web's actual order is Provider, Requests, **Error rate**,
**Models**, **Tokens**, **Share**, **Cost**, Tokens/s, Premium (`:311-415`). **Error rate and Models come third and
fourth in the web, and Cost comes seventh — not fourth.** The IR's `note` at `spec.ts:1216-1222` explicitly states
its own order follows the web ("it follows the web's column ORDER"), which the source does not support. This is a
real divergence to resolve, and it is recorded here rather than silently reconciled.

The card is `flush`, so `.card-body` drops its left/right padding to `10px 0 0` (`styles.css:797-799`) and the
table runs edge to edge under the description. `initialSort` puts an 11px `.sort-arrow`
(`margin-left: 4px; opacity: 0.8; vertical-align: -1px`) inside the sorted `th` (`styles.css:1306-1311`), and the
sorted header also lifts from `ink-3` to `ink-1` (`styles.css:1302-1304`).

**Two MeterCells on one table with independent maxima** — `maxRequests` (`:328`) and `maxTokens` (`:363`) — computed
separately at `:302-308`.

The `Premium` value is **`Math.round(x * 100) / 100`** (`:412`), i.e. 2-decimal precision on a fractional count, and
renders `dim` when zero. Same treatment as Overview's `Premium requests` tile (`OverviewRoute.tsx:151`).

`Share` is `formatPercent(p.totalTokens / grandTokens)` — **the GRAND total**, not the row's own scope (`:378`).
That is precisely the bug the IR documents at `spec.ts:1227-1244`, where it originally pointed at `totalTokens`
again and so printed a second copy of the Tokens column.

`Provider` uses `span.mono.cell-primary` (`:318`) — **not a `LabelCell`**, so it is a single line, unlike Providers'
other mono cells.

Measured: `scrollWidth 940px = clientWidth 940px` — **this table does NOT overflow at 1200px**, unlike most.

## Card 2 — "Burn by provider" (2fr)

```
section.card.rise[--i=2]
  h2.card-title        "Burn by provider"                                          :209
  p.card-description   "Per {5 minutes|hour|day}, top 6 providers stacked"
                       | (cost mode + unpriced) "API-equivalent estimate per {hour|day}; excludes unpriced…"  :210-214
  div.card-actions > div.segmented[sm]   (3 options)                              :215
  div.card-body > div.stack[gap:12]
    div.chart[height:260px]                                                     :226
    div.legend > button.legend-item ×N     (measured 2)                           :231
```

`TOP_PROVIDERS = 6` (`:61`) — providers stacked individually, the rest folded into `Other` by `pivotSeries`
(`:115-116`). The IR records this as `foldTo` implicitly (its Providers spec has no `foldTo`, which is itself a gap —
the chart will show up to 7 series including `Other` and the IR does not say so).

`TimeChart height={260}` `:226`, stacked, `format={burnFormat}` where `burnFormat = metric === "cost" ? v => formatCost(v) : formatCompact` (`:141`), `formatTooltip={metric === "cost" ? v => formatCost(v) : formatInteger}` (`:228`),
`emptyLabel="No provider activity in this range"` (`:229`).

**Legend** `:231-240`: `value = burnFormat(sum(values))` `:236`, toggleable via `onToggle={toggleHidden}` `:239`.

`.legend { flex-wrap: wrap; gap: 4px 14px; font-size: 12px; color: var(--ink-2) }`
(`styles.css:1732-1738`) — **12px, `ink-2`, below the chart**, not beside it.

## Card 3 — "Peak burn hours" (1fr) — out of the IR's scope

```
section.card  (rendered by PeakHoursCard, ProvidersRoute.tsx:246-248)
  h2.card-title        "Peak burn hours"
  p.card-description   "Tokens by local hour of day; peak at 21:00"
  div.card-actions > select.input.providers-select   (max-width 220px, providers.css:1-3)
  div.card-body > div.chart          ← a bare Chart, NO legend
```

A `grid-main-side` sibling of Burn by provider. **It is a local aggregate** (hourly buckets from
`/api/stats/providers`), so unlike the window cards it is not network-gated — but the IR does not declare it, so
the ported screen omits it.

## Cards 4 & 5 — "Subscription windows" / "Window utilization" — out of port scope

`.chart` is `position: relative; width: 100%; min-width: 0` (`styles.css:1619-1624`), so a plot fills the card
body; the axis band is `PAD_BOTTOM = 24` with `10.5px` mono ticks in `--chart-axis` (`styles.css:1630-1634`).


`:251-261` and `:263-268`. Both read `provider-windows`, which needs **broker network I/O per load**. Measured
header columns: `Window | Accounts | Resets | Windows burned | Tokens / window | Peak utilization | Accounts needed |
Exhaustions` (8, `scrollWidth 964px`) and `Account | Window | Latest used | Status | Peak in range | Snapshots |
Recorded` (7, dense). `providers.css:5-28` styles the expanded `TokenMix`/account blocks.

## Notable formatter calls, verbatim

```
formatInteger(providers.length)                                       ProvidersRoute.tsx:157
formatCompact(t.tokens)                                               ProvidersRoute.tsx:169
formatEstimatedCost(t.cost, t.unpriced)                                ProvidersRoute.tsx:175
formatErrorRate(t.requests > 0 ? t.failed / t.requests : 0)           ProvidersRoute.tsx:182
formatInteger(p.totalRequests)                                        ProvidersRoute.tsx:328
formatPercent(grandTokens > 0 ? p.totalTokens / grandTokens : 0)      ProvidersRoute.tsx:378
formatCompact(p.totalTokens)                                          ProvidersRoute.tsx:366
formatEstimatedCost(p.totalCost, p.unpricedRequests)                  ProvidersRoute.tsx:392
formatTokensPerSecond(p.avgTokensPerSecond)                           ProvidersRoute.tsx:402
formatInteger(Math.round(p.totalPremiumRequests * 100) / 100)        ProvidersRoute.tsx:412
burnFormat = metric === "cost" ? (v => formatCost(v)) : formatCompact ProvidersRoute.tsx:141
```

## Terminal shape at 150 columns

```
Providers
Burn, reliability and subscription headroom per provider over the last 24 hours.

  Providers          3
  Requests           3,984   ▁▂▄▆▅
  Tokens             968M    ▁▁▂▄▆
  API-equivalent cost  $4.13  ▁▂▃▅▇   ← PINK spark
  Error rate         1.4%
                       ← 4 + 1

─ Provider totals ─── Cost is an API-equivalent estimate. Select a row … ──
  Provider  Requests  Error rate  Models  Tokens  Share  Cost   Tokens/s  Premium
  anthropic 1,802 ▓▓▓ 4 [0.2%]    3       512M ▓▓▓ 52.9% $2.10   71.2      0
  openai    1,540 ▓▓  2 [0.1%]    2       380M ▓▓  39.2% $1.60   68.4    1.50
  google     642 ▓    0          1        76M ▓    7.9% $0.43   70.1      0
  ← the WEB's order: Error rate and Models come 3rd and 4th, Cost 7th

┌─ Burn by provider ──── Per hour, top 6 providers stacked ──────┐┌─ Peak burn hours ──┐
│ stacked 260px; cost mode uses formatCost, token mode compact   ││ bare Chart,        │
│ ▪ anthropic $2.10   ▪ openai $1.60   ▪ google $0.43            ││ NO legend          │
└───────────────────────────────────────────────────────────────┘└───────────────────┘
```

- **`grid-main-side` is 2-up at 2:1** here (617px : 309px, measured), as at Overview, Costs and Errors.
- **Provider totals does NOT overflow at 150 columns** (940 = 940); every other wide table does.
- The IR's column order for this screen should be checked against `ProvidersRoute.tsx:311-415` before porting.
