# Overview — 40 columns (320px viewport)

**Web route:** `routes/OverviewRoute.tsx` · **IR citation:** `src/layout/spec.ts:346-351`
**Capture:** `screens/overview-40.png` — live, `#/overview?range=24h`, 320px, dark, fullPage. Page height **2962px**.
Structure: see **`overview-150.md`**; deltas below are measured live.

## What 320px changes — measured

| Property | At 1200px | **At 320px** |
|---|---|---|
| `.shell-content` width | `942px` | **`302px`** |
| `--gutter` | `22px` | `16px` |
| `.sidebar` | 204px docked | `260px` off-canvas, `translateX(-265.2px, 0)` |
| StatGrid A (`min 190`) | `235px ×4` | **`268px` — ONE column.** All 5 tiles stack vertically |
| StatGrid B (`min 140`) | 6 cols | **`268px` — ONE column.** All 8 tiles stack vertically |
| `.grid-main-side` | 2 cols | **`270px` — ONE column** |
| Activity chart width | `583px` | **`236px`** |
| `.table-wrap` | no overflow | **`scrollWidth 513px` vs `clientWidth 268px`** — the table is nearly **2× its wrapper** |
| `th` padding | `8px 12px 8px 16px` | unchanged |
| Card order | Activity → Token mix | **Activity top `1417`, Token mix top `1821`** — same order |

**The decisive number: at 320px both stat grids collapse to a single column.** `minmax(140px, 1fr)` cannot fit 2
columns in 270px (2 × 140 = 280 > 270), and `minmax(190px, 1fr)` obviously cannot. So the web's Overview becomes a
**13-tile vertical stack** (5 md + 8 sm) followed by two full-width cards and a horizontally-scrolling table. The
page grows from 1746px to 2962px — a **1.70× increase in height** purely from wrapping.

This is the web's actual narrow behaviour and it is worth stating plainly: **the web's narrow layout is a single
column, not a reduced layout.** Nothing is dropped, nothing is collapsed into a disclosure, nothing is reordered.

## Page header

```
h1.page-title        "Overview"                                    OverviewRoute.tsx:98
p.page-description   "Everything omp did across your sessions in the last 24 hours."
(no .page-actions)
```
`.page-description { max-width: 72ch }` (`styles.css:688`) wraps to ~3 lines at 270px. Title stays `22px @ 600`.

## Top-level order

| # | Element | Wrapper | `file:line` |
|---|---|---|---|
| 1 | `PageHeader` | — | `:98` |
| 2 | StatGrid A — 5 `md` tiles, `min={190}` → **1 col** | `div.stack[gap:16]` | `:103-142` |
| 3 | StatGrid B — 8 `sm` tiles, `min={140}` → **1 col** | same stack | `:143-156` |
| 4 | Activity (270px) → Token mix (270px) | `.grid-main-side` collapsed | `:161-246` |
| 5 | "Latest requests" — `flush`, scrolls ~2× | full width | `:248-274` |

## Card-by-card

### Card 1 — "Activity"

- Title `:164`, description `"Per hour"` `:165`, `Segmented[sm]` `:166`.
- `TimeChart height={260}` `:176`, **236px wide**. `padLeft ≈ 37`, `padRight = 8`, plot ≈ `191px`, 24 buckets →
  `slotW ≈ 8px` → `barW = min(56, 8 × 0.9) = 7.2px` (note: `slotW > 6` is still true at 8, so it uses the **0.72**
  branch → `5.8px`; the `0.9` branch only engages below `slotW ≤ 6`). Either way: **~6px bars**.
- Series: `ok`/`var(--chart-primary)`, `err`/`var(--bad)`, stacked. **No legend.**

### Card 2 — "Token mix"

- Title `:182`, description `:182`, no actions.
- `stack[gap:18]` `:194` → `stack[gap:10]` `:195` = ShareBar(8px) + Legend(4 items, now **4 rows**) →
  `stack[gap:10]` `:213` = `section-label "By agent"` + ShareBar(8px) + 2 agent rows.
- Legend `flex-wrap: wrap; gap: 4px 14px` (`styles.css:1732-1738`) → one item per row at this width.
- Agent rows: `div.row` with `space-between` (`:226`), left = swatch + label + `formatInteger(requests) + " req"`,
  right = `formatCompact(tokens)` + a `minWidth: 48, textAlign: right` `formatPercent(share)` (`:230-236`).

### Card 3 — "Latest requests" (`flush`, scrolls ~2×)

- `<Dot tone="live" pulse />` + title `:250-254`; description `:255`; action `a.btn` `:257`.
- `dense`, no `limit`, 12 rows `:66`.
- **All 6 columns retained**; the wrapper is 268px against 513px of content, so the web scrolls. Columns:

| # | header | align | cell | formatter, verbatim | `file:line` |
|---|---|---|---|---|---|
| 1 | `Model` | left | **LabelCell** `primary={row.model} secondary={row.provider}` | — | `:283` |
| 2 | `When` | left | `span.muted` | `formatRelativeTime(row.timestamp)` | `:288` |
| 3 | `Tokens` | **right** | `span.num` | `formatInteger(row.usage.totalTokens)` | `:294` |
| 4 | `Cost` | **right** | `span.num` | `formatMessageCost(row, 4)` | `:300` |
| 5 | `Duration` | **right** | `span.num` | `formatDurationMs(row.duration)` | `:306` |
| 6 | `Status` | **right** | **Badge** `tone="bad"` "Failed" / `tone="ok"` "OK" | — | `:313` |

**All numeric columns `formatInteger`; no `formatCompact` in this table at any width.**

## Stat rows — formatCompact vs formatInteger

Both grids are single-column, so **each tile is its own row** and the primary/secondary distinction is carried by
the **value size (24px vs 18px)** and by the **section boundary**, not by width.

**StatGrid A** (`:103-142`), value / hint formatters:

| Tile | value | hint |
|---|---|---|
| API-equivalent cost | `formatEstimatedCost` `:107` | `formatInteger` `:110` |
| Requests | **`formatInteger`** `:118` | `formatInteger` `:119` |
| Conversation tokens | **`formatCompact`** `:125` | **`formatCompact`** `:126` |
| Cache rate | `formatPercent` `:132` | `formatPercent` `:133` |
| Error rate | `formatErrorRate` `:137` | `formatInteger` `:138` |

**StatGrid B** (`:143-156`), **all eight `size="sm"` → 18px value** (`styles.css:859-861`):

| # | label | formatter |
|---|---|---|
| 1 | `Uncached input` | **`formatCompact`** `:144` |
| 2 | `Cache read` | **`formatCompact`** `:145` |
| 3 | `Cache write` | **`formatCompact`** `:146` |
| 4 | `Output` | **`formatCompact`** `:147` |
| 5 | `Premium requests` | **`formatInteger(Math.round(x * 100) / 100)`** `:151` |
| 6 | `Tokens/s` | `formatTokensPerSecond` `:153` |
| 7 | `Avg latency` | `formatDurationMs` `:154` |
| 8 | `Avg TTFT` | `formatDurationMs` `:155` |

No tile in B has a hint, so **no foot line anywhere in the B row** at any width.

## Notable formatter calls, verbatim

```
formatEstimatedCost(overall.totalCost, overall.unpricedRequests)     OverviewRoute.tsx:107
formatInteger(overall.unpricedRequests)                              OverviewRoute.tsx:110   (inside the hint template)
formatCompact(sumConversationTokens(overall))                        OverviewRoute.tsx:125
formatCompact(overall.totalOutputTokens)                             OverviewRoute.tsx:126
formatPercent(overall.cacheRate)                                    OverviewRoute.tsx:132
formatPercent(overall.cacheSavings)                                 OverviewRoute.tsx:133
formatErrorRate(overall.errorRate)                                   OverviewRoute.tsx:137
formatInteger(Math.round(overall.totalPremiumRequests * 100) / 100) OverviewRoute.tsx:151
formatMessageCost(row, 4)                                            OverviewRoute.tsx:300
```

## Terminal shape at 40 columns

```
Overview
Everything omp did across your
sessions in the last 24 hours.

  API-equivalent cost
    $4.12  ▁▂▃▅▇▅▃                 ← 24px value + 28px spark, own row
  Requests
    3,977  ▁▂▄▆▅
  Conversation tokens
    967M   ▁▁▂▄▆
  Cache rate
    98.1%
  Error rate
    1.4%   ▁▁▁▁

  Uncached input  18M               ← 18px value, 2-line tile, no spark
  Cache read      944M
  Cache write     0
  Output          5.5M
  Premium requests 0
  Tokens/s        69.9
  Avg latency     14.0s
  Avg TTFT        3.2s

─ Activity ──────────────── Per hour ────────────────
  Succeeded / Failed stacked, 13 tiles above cost 236px of plot
─ Token mix ───────── Where conversation tokens went ──
  ██████▓▒░░░
  ▪ Uncached input  2%
  ▪ Cache read      98%
  ▪ Cache write     0%
  ▪ Output          1%
  By agent
  ██████▒░░░
  ● Main agent      967M   98.1%

─ Latest requests ──────── Most recent model calls … ──
  Model / When / Tokens / Cost / Duration / Status
     ← the web scrolls; a 40-col terminal must make a
       decision the web never has to make
```

**What 40 columns forces that the web never has to decide.** The web has a scrollbar; a terminal has 40 cells. The
web's answer to "this table is 513px wide in a 268px box" is "let the reader scroll". The IR's answer is the
`priority` field (`spec.ts:236-244`), which is explicitly **the terminal's own decision, not a web fact**. This
document therefore states only what is measurable: at 320px the web keeps all six Overview table columns and
overflows by 245px, and it does so by **wrapping everything else into a single column first**.
