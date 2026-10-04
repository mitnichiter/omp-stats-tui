# Gain — 100 columns (800px viewport)

**Web route:** `routes/GainRoute.tsx` · **IR citation:** `src/layout/spec.ts:1264-1268`
**Capture:** `screens/gain-100.png` — live, `#/gain?range=all`, 800px, dark, fullPage.
Full column/format detail: **`gain-150.md`**.

> **Range note.** At `range=24h` this screen renders only an `EmptyState` and no data. All captures use
> **`range=all`**. The empty state is documented in `gain-150.md`.

## Measured at 800px

| Property | At 1200px | **At 800px** |
|---|---|---|
| `.shell-content` padded box | `986px` | **`782px`** (inner `750px`) |
| `--gutter` | `22px` | `16px` |
| `.grid-*` container | n/a | n/a — Gain never has one |
| StatGrid (`min 180`) | **5 columns**, 5 tiles, no wrap | **4 columns**, 5 tiles → **4 + 1** |
| By-source table | 6 cols, `940px` client | 6 cols, `748px` client — **fits**, no overflow |
| `data-dense` | `false` | `false` |
| Chart | `260px` tall, legend in header | `260px` tall, legend in header, wraps |

`floor(750/180) = 4`, so the five stat tiles wrap 4 + 1 and tile 5 ("Saved per hit") stands alone on a full-width
second row. **Tile 5 has a hint** (`"tokens"`, `GainRoute.tsx:149`), so the lone trailing tile is a 3-line tile
here — unlike Overview's sm-only trailing tiles.

## Page header

```
h1.page-title        "Gain"                                                          GainRoute.tsx:89-91
p.page-description   "Tokens snapcompact kept out of context in all time."            ← range-dependent (:72)
div.page-actions
  select.input[aria-label=Project]  max-width 320px                                  :93-106
```

`.page-header` is `flex-wrap: wrap` (`styles.css:674`); at 750px the select stays on the title row beside it,
because `.page-actions { gap: 8px }` (`:694`) fits.

## Top-level order — unchanged by width

| # | Element | `file:line` |
|---|---|---|
| 1 | `PageHeader` + project `<select>` | `:89-107` |
| 2 | StatGrid — 5 `md` tiles, `min={180}` → **4 cols** | `:131-151` |
| 3 | Card "Savings over time" | `:154-169` |
| 4 | Card "By source" — `flush` | `:171-173` |

## StatGrid — 4 + 1

| # | Tile | value formatter | hint formatter | lines |
|---|---|---|---|---|
| 1 | Saved tokens | **`formatCompact(overall.savedTokens)`** `:134` | **`formatInteger(overall.savedTokens)`** `:135` | 3 + 28px spark |
| 2 | Saved bytes | **`formatBytes(overall.savedBytes)`** `:138` | none | **2** |
| 3 | Reduction | `reductionPercent !== null ? formatPercent(...) : "–"` `:142` | `"original size not recorded"` `:143` | 3 |
| 4 | Hits | `formatInteger(overall.hits)` `:145` | none | **2** |
| 5 | Saved per hit | `hits > 0 ? formatCompact(savedTokens / hits) : "–"` `:148` | `"tokens"` `:149` | 3 |

**The only stat row where the compact figure is the VALUE and the exact figure is the HINT** (tile 1) — the
inverse of every other row on the dashboard.

**`formatBytes`:** `>=1e9 → "X.X GB"`, `>=1e6 → "X.X MB"`, `>=1e3 → "X.X KB"`, else `"N B"` — always one decimal,
always a space before the unit (`formatters.ts:100-105`). **The only two `formatBytes` calls on the dashboard are
tile 2 (`:138`) and the table column (`:211`).**

**`Reduction` is `"–"`, never `0.0%`** (`:142`; IR rule `spec.ts:1310-1313`) — snapcompact never records an
original size.

**`formatCompact` twice** (tile 1 value `:134`, tile 5 value `:148`); **`formatInteger` twice** (tile 1 hint `:135`,
tile 4 `:145`).

## Card 1 — "Savings over time"

```
section.card.rise[--i=1]
  h2.card-title        "Savings over time"                                :156
  p.card-description   "Tokens saved per UTC day, with the running total"   :157
  div.card-actions > div.legend > span.legend-item ×2   ← NO value, NO toggle, in the HEADER  :158
  div.card-body > div.chart[height:260px]                                   :165
```

**The only card on the dashboard with its legend in the header** (`:158`) — every other chart card puts a
`div.stack[gap:12px]` with chart-then-legend below (`ModelsRoute.tsx:159`, `CostsRoute.tsx:134`,
`ToolsRoute.tsx:170`, `ProvidersRoute.tsx:231`). Because `.card-actions` is `flex-wrap: wrap`
(`styles.css:788`), at 750px the two `legend-item`s wrap onto a second line inside the header.

**Two series, two axes** (`chartSeries`, `:74-84`):

| key | label | colour | kind | axis |
|---|---|---|---|---|
| `daily` | `Saved per day` | `var(--chart-primary)` cyan | bars (default) | left, **stacked** |
| `cumulative` | `Cumulative` | `var(--chart-secondary)` pink | **`kind: "line"`** | **`axis: "right"`** |

The right axis forces `padRight = max(28, labelWidth + 12)` instead of `8` (`Chart.tsx:115`), so the plot is
narrower at every width than a single-axis chart of the same card width. The line series never stacks
(`Chart.tsx:83`, `:124`).

`formatRight={formatCompact}` `:167` — **the right axis is compact while the tooltip is `formatInteger`** `:166`.
`tickLabel = DAY_LABEL.format(...)` `:163`, a **UTC** formatter (`timeZone: "UTC"`, `:32`) because the server
buckets by UTC day (`:31`, `:47`).

## Card 2 — "By source" — `flush`, 6 columns, fits

| # | header | align | cell | formatter, verbatim | `file:line` |
|---|---|---|---|---|---|
| 1 | `Source` | left | `span.cell-primary` — **single line, not a `LabelCell`** | `SOURCE_LABEL[row.source]` `:186` | `:182-187` |
| 2 | `Saved tokens` | **right** | **`MeterCell max={1}`** — the bar IS the share | **`formatCompact(row.savedTokens)`** `:195` (tooltip `formatInteger` `:194`) | `:188-198` |
| 3 | `Share` | **right** | `span.num.muted` | `formatPercent(row.share)` `:204` | `:199-205` |
| 4 | `Saved bytes` | **right** | `span.num` | **`formatBytes(row.savedBytes)`** `:211` | `:206-212` |
| 5 | `Hits` | **right** | `span.num` | `formatInteger(row.hits)` `:218` | `:213-219` |
| 6 | `Reduction` | **right** | `span.num`, `"–"` when null | `formatPercent` or `"–"` `:226` | `:220-228` |

`SOURCE_LABEL` has exactly one entry: `snapcompact → "Snapcompact"` (`:29`). No `limit`, no `dense`, no
`initialSort` (`:172`) → **no `.table-more`**.

`share = bySource[source].savedTokens / overall.savedTokens` (`:65`) — a fraction of the **grand** total.

## Terminal shape at 100 columns

```
Gain
Tokens snapcompact kept out of context in all time.       [All projects ▾]

  Saved tokens     967M    ▁▂▃▅▇▅▃
    967,412,830              ← compact value, exact hint
  Saved bytes      3.7 GB
  Reduction        –
    original size not recorded
  Hits             1,204
  Saved per hit    802K      ← alone on row 2, full width
    tokens

─ Savings over time ── Tokens saved per UTC day, with the running total ──
  ▪ Saved per day                          ← legend in the HEADER,
  ▪ Cumulative                                no values, not a toggle
  bars (cyan, stacked, left) + line (pink, right, formatCompact ticks)
  UTC day ticks; right axis costs 12px of padding
─ By source ───────────────── Savings per subsystem ─────────────────
  Source        Saved tokens  Share  Saved bytes  Hits  Reduction
  Snapcompact   967M ▓▓▓▓▓▓▓▓ 99.9% 3.7 GB      1,204  –
```

- **No two-up layout at any width.** The stat row wraps 4 + 1 and the lone tile is a hinted 3-line tile.
- The header legend wraps onto a second line inside `.card-actions` (`styles.css:788`).
- The right axis costs `padRight` = at least `28px` instead of `8` (`Chart.tsx:115`) — visible at every width.
