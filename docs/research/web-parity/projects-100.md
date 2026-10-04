# Projects — 100 columns (800px viewport)

**Web route:** `routes/ProjectsRoute.tsx` · **IR citation:** `src/layout/spec.ts:728-731`
**Capture:** `screens/projects-100.png` — live, `#/projects?range=24h`, 800px, dark, fullPage. Page height **1052px**.
Full column/format detail: **`projects-150.md`**. All deltas measured live.

## Measured at 800px

| Property | At 1200px | **At 800px** |
|---|---|---|
| `.shell-content` padded box | `986px` | **`782px`** (inner `750px`) |
| `--gutter` | `22px` | `16px` |
| **`.grid-2`** | `463px 463px` (1:1) | **`750px` — ONE column** (`styles.css:716-722`) |
| StatGrid (`min 180`) | 5 cols | **4 columns**, 5 tiles → **4 + 1** |
| Folders table | 9 cols, `940px` client, `1119px` scroll | 9 cols, **`748px` client**, `1119px` scroll → **+371px** |
| `data-dense` | `true` | `true` |
| BarList rows rendered | 6 | **6** (2 cards × 3 folders) |

**Load-bearing fact at 100 columns: `.grid-2` collapses.** Top-by-cost and Top-by-requests go from side-by-side
463px cards to **stacked 750px cards**, in that order. The page height barely changes (1052px at both 1200 and 800)
because the two BarLists are short — 3 folders each, 30px rows, `gap: 2px` (`styles.css:1787`).

`floor(750/180) = 4`, so the 5 stat tiles wrap 4 + 1 and tile 5 ("Cache rate", which has no hint) sits alone on a
full-width second row.

## Page header

```
h1.page-title        "Projects"                                                   ProjectsRoute.tsx:78-79
p.page-description   "Usage by session folder in the last 24 hours."
(no .page-actions)
```

## Top-level order — unchanged by width

| # | Element | Wrapper | `file:line` |
|---|---|---|---|
| 1 | `PageHeader` | — | `:78-79` |
| 2 | StatGrid — 5 `md` tiles, `min={180}` → **4 cols** | `div[data-stale]` | `:84-113` |
| 3 | Top by cost (750px) → Top by requests (750px) | `.grid-2` **collapsed** | `:118-160` |
| 4 | Card "Folders" — `flush`, `dense` | full width | `:162-214` |

## StatGrid — 4 + 1

| # | Tile | value | hint | spark |
|---|---|---|---|---|
| 1 | Folders | `formatInteger(view.rows.length)` `:87` | `formatInteger(view.temporaryCount)` + " temporary" `:88` | none |
| 2 | Requests | `formatInteger(view.totalRequests)` `:92` | `formatInteger(view.failedRequests)` + " failed" `:93` | none |
| 3 | API-equivalent cost | `formatEstimatedCost(view.totalCost, view.unpricedRequests)` `:98` | `formatInteger(view.unpricedRequests)` + " unpriced" `:99-101` | none |
| 4 | Conversation tokens | **`formatCompact(view.conversationTokens)`** `:106` | **none** | none |
| 5 | Cache rate | `formatPercent(view.cacheRate)` `:111` | **none** | none |

**`formatCompact` appears exactly once on this stat row — tile 4.** Tiles 4 and 5 are the only hintless tiles.

## Cards 1 & 2 — "Top by cost" / "Top by requests", now stacked

```
section.card.rise[--i=1]   750px
  h2.card-title        "Top by cost"                                        ProjectsRoute.tsx:119
  p.card-description   "Share of API-equivalent cost"
  div.card-body > div.bar-list
    button.bar-list-row × 3
      span.bar-list-fill[style width:%]     ← top:3 bottom:3, opacity .16, radius 5px
      span.bar-list-label > span.mono > formatFolder(row.folder)
      span.bar-list-value
        `${formatEstimatedCost(row.totalCost, row.unpricedRequests)} · ${formatPercent(row.costShare)}`   :132

section.card.rise[--i=2]   750px
  h2.card-title        "Top by requests"                                    :140
  p.card-description   "Share of all requests"
  div.card-body > div.bar-list
    button.bar-list-row × 3
      span.bar-list-label > span.mono > formatFolder(row.folder)
      span.bar-list-value
        `${formatInteger(row.totalRequests)} · ${formatPercent(row.requestShare)}`   :153
```

**These are `BarList`s — 30px rows, bar behind the label — not `ShareBar`s.** Full comparison in
`projects-150.md` § Cards 1 & 2 and `layout-rules.md` § 8.2. The IR types them `shareBar` at `spec.ts:770` and
`786`, which is the component error this document is recording.

Bar colours: cost card `var(--chart-secondary)` (pink) `:133`; requests card defaults to `var(--chart-primary)`
(cyan) via `BarList.tsx:31`.

BarList row metrics, all width-independent: `height 30px` (`styles.css:1795`), `padding 0 8px`, `gap 10px`,
`border-radius 6px`, `.bar-list { gap: 2px }` (`styles.css:1787`), fill `top/bottom 3px` → **24px tall at 16%
opacity**, value `font-mono 12px tabular-nums ink-2` (`styles.css:1829-1833`).

Pct floor: `Math.max(0.5, (value / top) * 100)` (`BarList.tsx:26`) — a folder with a nonzero but tiny share is still
visible at 0.5%.

## Card 3 — "Folders" — `flush`, `dense`, 9 columns, +371px

| # | header | align | cell | formatter, verbatim | `file:line` |
|---|---|---|---|---|---|
| 1 | `Folder` | left | `span.row.projects-folder` `max-width 280px` + `span.mono.truncate` + optional `<Badge>temp</Badge>` | `formatFolder(row.folder)` | `:221-231` |
| 2 | `Requests` | **right** | **`MeterCell`** `max={maxRequests}` | `formatInteger(row.totalRequests)` `:239` | `:232-242` |
| 3 | `Cost` | **right** | **`MeterCell`** `max={maxCost}`, pink | `formatEstimatedCost(row.totalCost, row.unpricedRequests)` `:254` | `:243-259` |
| 4 | `Tokens` | **right** | `span.num` + `title` | **`formatCompact(row.conversationTokens)`** `:268` (title: `formatInteger` `:267`) | `:260-271` |
| 5 | `Cache rate` | **right** | `span.num` | `formatPercent(row.cacheRate)` `:278` | `:272-279` |
| 6 | `Cache savings` | **right** | `span.num` + `tone-bad` if `< 0` else `muted` | `formatPercent(row.cacheSavings)` `:288` | `:280-291` |
| 7 | `Errors` | **right** | **`Badge`** `mono`, `tone="neutral"` when clean | `formatErrorRate(row.errorRate)` `:300` | `:292-304` |
| 8 | `Avg duration` | **right** | `span.num` | `formatDurationMs(row.avgDuration)` `:310` | `:305-311` |
| 9 | `Last active` | **right** | **`span.dim`** | `formatRelativeTime(row.lastTimestamp)` `:317` | `:312-318` |

`rowKey = row.folder` `:194`; `initialSort {key:"cost", dir:"desc"}` `:196`; `limit={TABLE_LIMIT}` `:197`;
**`dense`** `:198`. Card description is the live count `"N folders"` / `"M of N folders"` `:165-171`.

**Two independent MeterCell maxima on this one table** — `maxRequests` and `maxCost` (`:239`, `:253`), deliberately
scoped to the whole range so filtering does not rescale the bars (`:74`).

## Terminal shape at 100 columns

```
Projects
Usage by session folder in the last 24 hours.

  Folders   3
  Requests  3,956
  API-equivalent cost  $4.09
  Conversation tokens  965M
  Cache rate          98.1%
                          ← 4 + 1

─ Top by cost ───────────── Share of API-equivalent cost ──────────
  omp-stats-tui  ▓▓▓▓▓▓░  $3.90 · 68%
  omp             ▓▓░░░    $1.10 · 28%
  other           ▓░░░     $0.09 ·  4%
─ Top by requests ─────────── Share of all requests ───────────────
  omp-stats-tui  ▓▓▓▓▓▓░  2,190 · 55%
  omp             ▓▓░░░    1,540 · 39%
  other           ▓░░░       226 ·  6%
     ← both stacked; these are 30px RANKED ROWS, not 8px share bars

─ Folders ───────────── 3 folders ─────── [Hide temporary (1)] [Filter…]
  Folder  Requests  Cost  Tokens  Cache rate  Cache sav  Errors  Avg dur  Last active
  omp…    2,190     $3.90  612M   98.1%      71.2%      [0.4%]   12.1s   2m ago
```

- **BarList value strings are two figures joined by `·`** — a cost + a percent, or a count + a percent
  (`:132`, `:153`). The `·` separator is a literal U+00B7 MIDDLE DOT, not a pipe.
- Both BarList cards now have **750px** of width for a label and a value. The bar fill spans the label region only
  (`span.bar-list-label { flex: 1 }`, `styles.css:1819`), so a very wide card produces a very wide fill, not a wider
  value column.
