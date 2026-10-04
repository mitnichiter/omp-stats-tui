# Projects — 60 columns (480px viewport)

**Web route:** `routes/ProjectsRoute.tsx` · **IR citation:** `src/layout/spec.ts:728-731`
**Capture:** `screens/projects-60.png` — live, `#/projects?range=24h`, 480px, dark, fullPage. Page height **1096px**.
Full column/format detail: **`projects-150.md`**. All deltas measured live.

## Measured at 480px

| Property | At 1200px | **At 480px** |
|---|---|---|
| `.shell-content` padded box | `986px` | **`462px`** (inner `430px`) |
| `--gutter` | `22px` | `16px` |
| `.grid-2` | `463px 463px` | **`430px` — ONE column** |
| StatGrid (`min 180`) | 5 cols | **2 columns**, 5 tiles → **2 + 2 + 1** |
| Folders table | 9 cols, `940px` client, `1119px` scroll | 9 cols, **`428px` client**, `1119px` scroll → **+691px (2.6×)** |
| `data-dense` | `true` | `true` |
| BarList rows | 6 | **6** |

`floor(430/180) = 2`. The two BarList cards are now 430px wide each and stacked.

## Page header

```
h1.page-title        "Projects"                                            ProjectsRoute.tsx:78-79
p.page-description   "Usage by session folder in the last 24 hours."
(no .page-actions)
```

## Top-level order — unchanged by width

| # | Element | `file:line` |
|---|---|---|
| 1 | `PageHeader` | `:78-79` |
| 2 | StatGrid — 5 `md` tiles, `min={180}` → **2 cols** | `:84-113` |
| 3 | Top by cost (430px) → Top by requests (430px) | `:118-160` |
| 4 | Card "Folders" — `flush`, `dense` | `:162-214` |

## StatGrid — 2 + 2 + 1

| # | Tile | value | hint |
|---|---|---|---|
| 1 | Folders | `formatInteger(view.rows.length)` `:87` | `formatInteger(view.temporaryCount)` + " temporary" `:88` |
| 2 | Requests | `formatInteger(view.totalRequests)` `:92` | `formatInteger(view.failedRequests)` + " failed" `:93` |
| 3 | API-equivalent cost | `formatEstimatedCost(view.totalCost, view.unpricedRequests)` `:98` | `formatInteger(view.unpricedRequests)` + " unpriced" `:99-101` |
| 4 | Conversation tokens | **`formatCompact(view.conversationTokens)`** `:106` | none |
| 5 | Cache rate | `formatPercent(view.cacheRate)` `:111` | none |

**Only tile 4 is `formatCompact`.** Tiles 4 and 5 are the only hintless tiles — in a 2-wide row, the second row pairs
those two, so it is visibly shorter than the first.

## Cards 1 & 2 — "Top by cost" / "Top by requests" (430px, stacked)

```
section.card.rise[--i=1]
  h2.card-title        "Top by cost"          "Share of API-equivalent cost"    :119
  div.bar-list > button.bar-list-row × 3
    span.bar-list-fill[style width:%]     top:3 bottom:3 opacity .16 radius 5px
    span.bar-list-label > span.mono > formatFolder(row.folder)
    span.bar-list-value  `${formatEstimatedCost(...)} · ${formatPercent(row.costShare)}`   :132

section.card.rise[--i=2]
  h2.card-title        "Top by requests"      "Share of all requests"            :140
  div.bar-list > button.bar-list-row × 3
    span.bar-list-value  `${formatInteger(row.totalRequests)} · ${formatPercent(row.requestShare)}`   :153
```

**`BarList`, not `ShareBar`.** Row height stays `30px` (`styles.css:1795`), fill stays 24px tall at 16% opacity
(`styles.css:1807-1816`), `pct` keeps its `Math.max(0.5, …)` floor (`BarList.tsx:26`).

**At 430px the value string is the pressure point.** `formatEstimatedCost` yields e.g. `$3.90`, so the value cell is
`$3.90 · 68%` ≈ 10 characters; `.bar-list-value` is `font-mono 12px` with no `truncate` class
(`styles.css:1829-1833`), while `.bar-list-label` **is** `.truncate`-equivalent (`styles.css:1818-1827`). **The label
truncates; the value does not.** The flexbox resolves by shrinking the label.

Colours: cost bar `var(--chart-secondary)` `:133`; requests bar defaults to `var(--chart-primary)` (`BarList.tsx:31`).

## Card 3 — "Folders" — `flush`, `dense`, 9 columns, 2.6× overflow

| # | header | align | cell | formatter, verbatim | `file:line` |
|---|---|---|---|---|---|
| 1 | `Folder` | left | `span.row.projects-folder` (`max-width 280px`) + `span.mono.truncate` + `<Badge>temp</Badge>` | `formatFolder(row.folder)` | `:221-231` |
| 2 | `Requests` | **right** | **`MeterCell`** `max={maxRequests}` | `formatInteger(row.totalRequests)` `:239` | `:232-242` |
| 3 | `Cost` | **right** | **`MeterCell`** `max={maxCost}` pink | `formatEstimatedCost(row.totalCost, row.unpricedRequests)` `:254` | `:243-259` |
| 4 | `Tokens` | **right** | `span.num` + `title` | **`formatCompact(row.conversationTokens)`** `:268` | `:260-271` |
| 5 | `Cache rate` | **right** | `span.num` | `formatPercent(row.cacheRate)` `:278` | `:272-279` |
| 6 | `Cache savings` | **right** | `span.num` `tone-bad`/`muted` | `formatPercent(row.cacheSavings)` `:288` | `:280-291` |
| 7 | `Errors` | **right** | **`Badge`** `mono` | `formatErrorRate(row.errorRate)` `:300` | `:292-304` |
| 8 | `Avg duration` | **right** | `span.num` | `formatDurationMs(row.avgDuration)` `:310` | `:305-311` |
| 9 | `Last active` | **right** | **`span.dim`** | `formatRelativeTime(row.lastTimestamp)` `:317` | `:312-318` |

`rowKey = row.folder` `:194`; `limit={TABLE_LIMIT}` `:197`; **`dense`** `:198`; card description is the live folder
count `:165-171`. Two independent MeterCell maxima (`:239`, `:253`), deliberately range-scoped (`:74`).

`.projects-folder { max-width: 280px }` (`projects.css:2-6`) — the comment reads *"Long temp-dir names must not
stretch the table."* At 430px that 280px cap is the dominant column width.

## Terminal shape at 60 columns

```
Projects
Usage by session folder in the last 24 hours.

  Folders   3
  Requests  3,956
  API-equivalent cost  $4.09
  Conversation tokens  965M      ← NO foot
  Cache rate          98.1%      ← NO foot
                          ← 2 + 2 + 1

─ Top by cost ───────────── Share of API-equivalent cost ──
  omp-stats-tui  ▓▓▓▓▓▓░  $3.90 · 68%
  omp             ▓▓░░░    $1.10 · 28%
  other           ▓░░░     $0.09 ·  4%
─ Top by requests ─────────── Share of all requests ──────
  omp-stats-tui  ▓▓▓▓▓▓░  2,190 · 55%
  omp             ▓▓░░░    1,540 · 39%
  other           ▓░░░       226 ·  6%
                        ← label truncates, value never does

─ Folders ─────────────── 3 folders ────────────────────
  Folder  Requests  Cost  Tokens  Cache rate  Cache sav  Errors  Avg dur  Last active
  omp…    2,190     $3.90  612M   98.1%      71.2%      [0.4%]   12.1s   2m ago
  ← 9 columns, 1119px of content in a 428px box: the web scrolls
```

- **The `Folder` column's `max-width: 280px` and the two `MeterCell`s' fixed `64px` are unchanged by width.** In a
  428px wrapper they occupy 408px before any numeric column is read.
- The BarList rows keep their exact 30px height and 0.5% floor at every width — the web does not compress ranked
  lists as they narrow, it just gives them more or less horizontal room for the fill.
