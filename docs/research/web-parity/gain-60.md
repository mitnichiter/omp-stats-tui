# Gain — 60 columns (480px viewport)

**Web route:** `routes/GainRoute.tsx` · **IR citation:** `src/layout/spec.ts:1264-1268`
**Capture:** `screens/gain-60.png` — live, `#/gain?range=all`, 480px, dark, fullPage.
Full column/format detail: **`gain-150.md`**.

> **Range note.** At `range=24h` this screen renders only an `EmptyState`. All captures use **`range=all`**.

## Measured at 480px

| Property | At 1200px | **At 480px** |
|---|---|---|
| `.shell-content` padded box | `986px` | **`462px`** (inner `430px`) |
| `--gutter` | `22px` | `16px` |
| `.grid-*` container | n/a | n/a |
| StatGrid (`min 180`) | 5 cols | **2 columns**, 5 tiles → **2 + 2 + 1** |
| By-source table | 6 cols, `940px` client | 6 cols, `428px` client — **fits** |
| `data-dense` | `false` | `false` |
| Chart height | `260px` | `260px` |

`floor(430/180) = 2`, so the five tiles pair 2 + 2 with "Saved per hit" alone on a third row.

## Page header

```
h1.page-title        "Gain"                                                       GainRoute.tsx:89-91
p.page-description   "Tokens snapcompact kept out of context in all time."
div.page-actions
  select.input[aria-label=Project]  max-width 320px                              :93-106
```

`.page-header { flex-wrap: wrap }` (`styles.css:674`), so at 430px the `<select>` drops onto its own line beneath
the description. Its inline `max-width: 320px` (`:104`) exceeds the 430px card width but is under the viewport, so
it stays one line.

## Top-level order — unchanged by width

| # | Element | `file:line` |
|---|---|---|
| 1 | `PageHeader` + project `<select>` | `:89-107` |
| 2 | StatGrid — 5 `md` tiles, `min={180}` → **2 cols** | `:131-151` |
| 3 | Card "Savings over time" | `:154-169` |
| 4 | Card "By source" — `flush` | `:171-173` |

## StatGrid — 2 + 2 + 1

| # | Tile | value | hint | lines |
|---|---|---|---|---|
| 1 | Saved tokens | **`formatCompact(overall.savedTokens)`** `:134` | **`formatInteger(overall.savedTokens)`** `:135` | 3 + spark |
| 2 | Saved bytes | **`formatBytes(overall.savedBytes)`** `:138` | none | **2** |
| 3 | Reduction | `reductionPercent !== null ? formatPercent(...) : "–"` `:142` | `"original size not recorded"` `:143` | 3 |
| 4 | Hits | `formatInteger(overall.hits)` `:145` | none | **2** |
| 5 | Saved per hit | `hits > 0 ? formatCompact(savedTokens / hits) : "–"` `:148` | `"tokens"` `:149` | 3 |

**Tile 1 is the dashboard's only tile where the exact figure is the HINT and the compact figure is the VALUE**
(`:134-135`). **Tile 3's value is `"–"`, never `0.0%`** (`:142`; IR rule `spec.ts:1310-1313`).

`formatBytes` = `">=1e9 → X.X GB"`, `">=1e6 → X.X MB"`, `">=1e3 → X.X KB"`, else `"N B"` — one decimal, space
before the unit (`formatters.ts:100-105`). **The only two calls on the dashboard are `:138` and `:211`.**

## Card 1 — "Savings over time"

```
section.card.rise[--i=1]
  h2.card-title        "Savings over time"                                :156
  p.card-description   "Tokens saved per UTC day, with the running total"   :157
  div.card-actions > div.legend > span.legend-item ×2   ← HEADER, no values, no toggle  :158
  div.card-body > div.chart[height:260px]              ← 396px wide                        :165
```

**Two series on two axes** (`chartSeries`, `:74-84`): `daily` = cyan bars, left axis, **stacked**; `cumulative` =
pink **`kind: "line"`** on **`axis: "right"`**. The right axis forces
`padRight = max(28, labelWidth + 12)` instead of `8` (`Chart.tsx:115`), so at 396px the plot is ≈ `396 - 28 - 28`
= `340px`. `formatRight={formatCompact}` `:167`; `formatTooltip={formatInteger}` `:166`.
`tickLabel = DAY_LABEL.format(...)` `:163` — a **UTC** formatter (`:32`).

**The legend is in the card header** (`:158`) — the only card on the dashboard where that is true. Its two
`span.legend-item`s sit in `.card-actions` (`flex-wrap: wrap`, `styles.css:788`), so at 430px they stay on the
header's own row.

## Card 2 — "By source" — `flush`, 6 columns, fits

| # | header | align | cell | formatter, verbatim | `file:line` |
|---|---|---|---|---|---|
| 1 | `Source` | left | `span.cell-primary` — single line | `SOURCE_LABEL[row.source]` `:186` | `:182-187` |
| 2 | `Saved tokens` | **right** | **`MeterCell max={1}`** | **`formatCompact(row.savedTokens)`** `:195` (tooltip `formatInteger` `:194`) | `:188-198` |
| 3 | `Share` | **right** | `span.num.muted` | `formatPercent(row.share)` `:204` | `:199-205` |
| 4 | `Saved bytes` | **right** | `span.num` | **`formatBytes(row.savedBytes)`** `:211` | `:206-212` |
| 5 | `Hits` | **right** | `span.num` | `formatInteger(row.hits)` `:218` | `:213-219` |
| 6 | `Reduction` | **right** | `span.num`, `"–"` when null | `formatPercent` or `"–"` `:226` | `:220-228` |

No `limit`, no `dense` (`:172`). `share = bySource[source].savedTokens / overall.savedTokens` (`:65`).
`MeterCell max={1}` is **unique to this screen** — the bar length IS the share, so the bar and the Share column
state the same number twice by design.

## Terminal shape at 60 columns

```
Gain
Tokens snapcompact kept out of context in all time.
[All projects ▾]

  Saved tokens
    967M      ▁▂▃▅▇▅▃
    967,412,830
  Saved bytes
    3.7 GB
  Reduction
    –
    original size not recorded
  Hits
    1,204
  Saved per hit
    802K
    tokens

─ Savings over time ── Tokens saved per UTC day, with the running total ──
  ▪ Saved per day   ▪ Cumulative      ← legend in the HEADER
  bars (cyan, stacked, left, ≈340px plot) + line (pink, right, compact ticks)

─ By source ─────────────────── Savings per subsystem ───────────────────
  Source       Saved tokens  Share  Saved bytes  Hits  Reduction
  Snapcompact  967M ▓▓▓▓▓▓▓▓ 99.9% 3.7 GB      1,204  –
```

- The stat grid's **2 + 2 + 1** arrangement puts both hintless tiles (2 and 4) side by side in row 2, which is the
  clearest place the 2-line vs 3-line tile difference shows.
- The `MeterCell max={1}` bar and the `Share` column are redundant by design — do not "fix" that by dropping one.
