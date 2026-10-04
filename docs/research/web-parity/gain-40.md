# Gain — 40 columns (320px viewport)

**Web route:** `routes/GainRoute.tsx` · **IR citation:** `src/layout/spec.ts:1264-1268`
**Capture:** `screens/gain-40.png` — live, `#/gain?range=all`, 320px, dark, fullPage.
Full column/format detail: **`gain-150.md`**.

> **Range note.** At `range=24h` this screen renders only an `EmptyState`. All captures use **`range=all`**.

## Measured at 320px

| Property | At 1200px | **At 320px** |
|---|---|---|
| `.shell-content` padded box | `986px` | **`302px`** (inner `270px`) |
| `--gutter` | `22px` | `16px` |
| `.grid-*` container | n/a | n/a |
| StatGrid (`min 180`) | 5 cols | **1 column** — `floor(270/180) = 1`; 5 tiles stack |
| By-source table | 6 cols, `940px` client | 6 cols, **`268px` client** — **fits, no overflow** |
| `data-dense` | `false` | `false` |
| Chart height | `260px` | `260px` |

**Load-bearing fact at 40 columns: Gain's table is the only wide-enough table on the dashboard that still fits at
320px.** Six columns, a 64px meter and a handful of short figures fit in 268px. Every other ported table overflows
at this width.

## Page header

```
h1.page-title        "Gain"                                                       GainRoute.tsx:89-91
p.page-description   "Tokens snapcompact kept out of context in all time."
div.page-actions
  select.input[aria-label=Project]  max-width 320px                              :93-106
```

The `<select>`'s inline `max-width: 320px` (`:104`) equals the viewport width, so it fills the 270px card body
exactly. `.page-header` wraps (`styles.css:674`), placing it on its own line.

## Top-level order — unchanged by width

| # | Element | `file:line` |
|---|---|---|
| 1 | `PageHeader` + project `<select>` | `:89-107` |
| 2 | StatGrid — 5 `md` tiles, `min={180}` → **1 col** | `:131-151` |
| 3 | Card "Savings over time" | `:154-169` |
| 4 | Card "By source" — `flush` | `:171-173` |

## StatGrid — one tile per row

| # | Tile | value formatter | hint formatter | lines |
|---|---|---|---|---|
| 1 | Saved tokens | **`formatCompact(overall.savedTokens)`** `:134` | **`formatInteger(overall.savedTokens)`** `:135` | 3 + 28px spark |
| 2 | Saved bytes | **`formatBytes(overall.savedBytes)`** `:138` | none | **2** |
| 3 | Reduction | `reductionPercent !== null ? formatPercent(...) : "–"` `:142` | `"original size not recorded"` `:143` | 3 |
| 4 | Hits | `formatInteger(overall.hits)` `:145` | none | **2** |
| 5 | Saved per hit | `hits > 0 ? formatCompact(savedTokens / hits) : "–"` `:148` | `"tokens"` `:149` | 3 |

**Tile 1 remains the dashboard's only tile with the compact figure as the VALUE and the exact figure as the HINT**
(`:134-135`). In a single column this is fully visible: `967M` at 24px directly above `967,412,830` at 12px.

**Tile 3 reads `"–"`, never `0.0%`** (`:142`; IR rule `spec.ts:1310-1313`) — snapcompact never records an original
size, so the ratio is undefined rather than zero.

`formatBytes` (`:138`): `">=1e9 → X.X GB"`, `">=1e6 → X.X MB"`, `">=1e3 → X.X KB"`, else `"N B"` — one decimal
place, a space before the unit (`formatters.ts:100-105`). **The only two calls on the dashboard are `:138` and
`:211`.**

## Card 1 — "Savings over time"

```
section.card.rise[--i=1]
  h2.card-title        "Savings over time"                                :156
  p.card-description   "Tokens saved per UTC day, with the running total"   :157
  div.card-actions > div.legend > span.legend-item ×2   ← HEADER, no values  :158
  div.card-body > div.chart[height=260px]              ← 236px wide          :165
```

**Two series on two axes** (`chartSeries`, `:74-84`): `daily` = cyan **bars**, left axis, **stacked**;
`cumulative` = pink **`kind: "line"`** on **`axis: "right"`**. The right axis sets
`padRight = max(28, labelWidth + 12)` rather than `8` (`Chart.tsx:115`), so at 236px the plot is ≈ `236 - 28 - 28`
= `180px`. `formatRight={formatCompact}` `:167`; `formatTooltip={formatInteger}` `:166`.
`tickLabel = DAY_LABEL.format(...)` `:163` — **UTC** (`timeZone: "UTC"`, `:32`).

**The legend is in the card header** (`:158`) — the only card on the dashboard where that is true. Its two
`span.legend-item`s wrap inside `.card-actions` (`flex-wrap: wrap`, `styles.css:788`).

## Card 2 — "By source" — `flush`, 6 columns, fits at 268px

| # | header | align | cell | formatter, verbatim | `file:line` |
|---|---|---|---|---|---|
| 1 | `Source` | left | `span.cell-primary` — **single line, not a `LabelCell`** | `SOURCE_LABEL[row.source]` `:186` | `:182-187` |
| 2 | `Saved tokens` | **right** | **`MeterCell max={1}`** `64px × 4px` | **`formatCompact(row.savedTokens)`** `:195` (tooltip `formatInteger` `:194`) | `:188-198` |
| 3 | `Share` | **right** | `span.num.muted` | `formatPercent(row.share)` `:204` | `:199-205` |
| 4 | `Saved bytes` | **right** | `span.num` | **`formatBytes(row.savedBytes)`** `:211` | `:206-212` |
| 5 | `Hits` | **right** | `span.num` | `formatInteger(row.hits)` `:218` | `:213-219` |
| 6 | `Reduction` | **right** | `span.num`, `"–"` when null | `formatPercent` or `"–"` `:226` | `:220-228` |

`SOURCE_LABEL` = `{ snapcompact: "Snapcompact" }` (`:29`) — **one source**, one row.
No `limit`, no `dense`, no `initialSort` (`:172`) → no `.table-more`.
`share = bySource[source].savedTokens / overall.savedTokens` (`:65`) — a fraction of the **grand** total.
**`MeterCell max={1}` is unique to this screen**: the bar length IS the share, so the bar and the Share column
state the same number twice.

## Notable formatter calls, verbatim

```
formatCompact(overall.savedTokens)                                    GainRoute.tsx:134
formatInteger(overall.savedTokens)                                    GainRoute.tsx:135
formatBytes(overall.savedBytes)                                       GainRoute.tsx:138
overall.reductionPercent !== null ? formatPercent(overall.reductionPercent) : "–"    :142
formatInteger(overall.hits)                                           GainRoute.tsx:145
overall.hits > 0 ? formatCompact(overall.savedTokens / overall.hits) : "–"          :148
formatInteger(row.savedTokens)        (MeterCell tooltip)            GainRoute.tsx:194
formatCompact(row.savedTokens)                                        GainRoute.tsx:195
formatPercent(row.share)                                              GainRoute.tsx:204
formatBytes(row.savedBytes)                                           GainRoute.tsx:211
formatInteger(row.hits)                                               GainRoute.tsx:218
row.reductionPercent !== null ? formatPercent(row.reductionPercent) : "–"          :226
```

## Terminal shape at 40 columns

```
Gain
Tokens snapcompact kept out of context in all time.
[All projects ▾]

  Saved tokens
    967M      ▁▂▃▅▇▅▃
    967,412,830           ← compact value, exact hint: unique to this screen
  Saved bytes
    3.7 GB                ← formatBytes: one decimal, space before unit
  Reduction
    –
    original size not recorded     ← the dash, NEVER 0.0%
  Hits
    1,204
  Saved per hit
    802K
    tokens

─ Savings over time ── Tokens saved per UTC day, with the running total ──
  ▪ Saved per day   ▪ Cumulative        ← legend in the HEADER, no values
  180px plot: cyan stacked bars on the left axis, a pink line on the
  right axis (right axis costs 28px of padding instead of 8)

─ By source ───────────────────── Savings per subsystem ─────────────────────
  Source       Saved tokens  Share  Saved bytes  Hits  Reduction
  Snapcompact  967M ▓▓▓▓▓▓▓▓ 99.9% 3.7 GB      1,204  –
  ↑ the ONLY ported table that still fits at 320px
```

**What 40 columns forces.** Nothing structural on this screen — the stat grid stacks and every block keeps its
content. Gain is the one screen where 40 columns costs layout rather than columns, because it has only one table
with six short columns and no `LabelCell`-based identity column that needs two lines.
