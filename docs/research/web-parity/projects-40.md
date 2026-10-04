# Projects — 40 columns (320px viewport)

**Web route:** `routes/ProjectsRoute.tsx` · **IR citation:** `src/layout/spec.ts:728-731`
**Capture:** `screens/projects-40.png` — live, `#/projects?range=24h`, 320px, dark, fullPage. Page height **1315px**.
Full column/format detail: **`projects-150.md`**. All deltas measured live.

## Measured at 320px

| Property | At 1200px | **At 320px** |
|---|---|---|
| `.shell-content` padded box | `986px` | **`302px`** (inner `270px`) |
| `--gutter` | `22px` | `16px` |
| `.grid-2` | `463px 463px` | **`270px` — ONE column** |
| StatGrid (`min 180`) | 5 cols | **1 column** — `floor(270/180) = 1` |
| Folders table | 9 cols, `940px` client, `1119px` scroll | 9 cols, **`268px` client**, `1119px` scroll → **+851px (4.17×)** |
| `data-dense` | `true` | `true` |
| BarList rows | 6 | **6** |

**Load-bearing fact at 40 columns: the stat grid is a 5-tile vertical stack and the table overflows 4.17×.**
The BarList cards keep all 3 rows each — a `BarList` has no width-dependent behaviour at all
(`30px` rows, `16%` fill, `0.5%` floor).

## Page header

```
h1.page-title        "Projects"                                                 ProjectsRoute.tsx:78-79
p.page-description   "Usage by session folder in the last 24 hours."
(no .page-actions)
```

## Top-level order — unchanged by width

| # | Element | `file:line` |
|---|---|---|
| 1 | `PageHeader` | `:78-79` |
| 2 | StatGrid — 5 `md` tiles, `min={180}` → **1 col** | `:84-113` |
| 3 | Top by cost (270px) → Top by requests (270px) | `:118-160` |
| 4 | Card "Folders" — `flush`, `dense` | `:162-214` |

## StatGrid — one tile per row

| # | Tile | value | hint |
|---|---|---|---|
| 1 | Folders | `formatInteger(view.rows.length)` `:87` | `formatInteger(view.temporaryCount)` + " temporary" `:88` |
| 2 | Requests | `formatInteger(view.totalRequests)` `:92` | `formatInteger(view.failedRequests)` + " failed" `:93` |
| 3 | API-equivalent cost | `formatEstimatedCost(view.totalCost, view.unpricedRequests)` `:98` | `formatInteger(view.unpricedRequests)` + " unpriced" `:99-101` |
| 4 | Conversation tokens | **`formatCompact(view.conversationTokens)`** `:106` | **none** |
| 5 | Cache rate | `formatPercent(view.cacheRate)` `:111` | **none** |

Tiles 1–3 are 3-line (label / 24px value / 12px foot); **tiles 4 and 5 are 2-line** because they pass no `hint`
(`Stat.tsx:37` gates `.stat-foot` on `hint !== undefined || delta`). In a single column that difference is directly
visible — the terminal should reproduce it rather than padding tiles 4–5 with an empty foot.

**Only tile 4 uses `formatCompact`.**

## Cards 1 & 2 — "Top by cost" / "Top by requests" (270px)

```
section.card.rise[--i=1]   270px
  h2.card-title        "Top by cost" / "Share of API-equivalent cost"       ProjectsRoute.tsx:119
  div.bar-list
    button.bar-list-row × 3                    height 30px, padding 0 8px, radius 6px
      span.bar-list-fill[style width:%]        inset top/bottom 3px, opacity .16, radius 5px
      span.bar-list-label > span.mono          flex:1, truncates
      span.bar-list-value                      font-mono 12px, does NOT truncate
        `${formatEstimatedCost(row.totalCost, row.unpricedRequests)} · ${formatPercent(row.costShare)}`  :132

section.card.rise[--i=2]   270px
  h2.card-title        "Top by requests" / "Share of all requests"          :140
  div.bar-list > button.bar-list-row × 3
      span.bar-list-value
        `${formatInteger(row.totalRequests)} · ${formatPercent(row.requestShare)}`   :153
```

**`BarList`, not `ShareBar`** — 3 ranked rows of 30px, not one 8px bar. The comparison table is in `projects-150.md`.

**At 270px the label is the thing that gives way.** `.bar-list-label { flex: 1; min-width: 0; overflow: hidden;
text-overflow: ellipsis; white-space: nowrap }` (`styles.css:1818-1827`) versus `.bar-list-value` which carries no
truncation rules at all (`styles.css:1829-1833`). Long temp-dir names ellipsise; the `value · share` string never
does. `.projects-folder`'s 280px cap (`projects.css:2-6`) exists for the same reason.

Bar fill colours are fixed: cost `var(--chart-secondary)` `:133`; requests default `var(--chart-primary)`
(`BarList.tsx:31`).

## Card 3 — "Folders" — `flush`, `dense`, 9 columns, 4.17× overflow

| # | header | align | cell | formatter, verbatim | `file:line` |
|---|---|---|---|---|---|
| 1 | `Folder` | left | `span.row.projects-folder` `max-width 280px` + `span.mono.truncate` + `<Badge>temp</Badge>` | `formatFolder(row.folder)` | `:221-231` |
| 2 | `Requests` | **right** | **`MeterCell`** `max={maxRequests}` | `formatInteger(row.totalRequests)` `:239` | `:232-242` |
| 3 | `Cost` | **right** | **`MeterCell`** `max={maxCost}` pink | `formatEstimatedCost(row.totalCost, row.unpricedRequests)` `:254` | `:243-259` |
| 4 | `Tokens` | **right** | `span.num` + `title` | **`formatCompact(row.conversationTokens)`** `:268` | `:260-271` |
| 5 | `Cache rate` | **right** | `span.num` | `formatPercent(row.cacheRate)` `:278` | `:272-279` |
| 6 | `Cache savings` | **right** | `span.num` `tone-bad` if `< 0` else `muted` | `formatPercent(row.cacheSavings)` `:288` | `:280-291` |
| 7 | `Errors` | **right** | **`Badge`** `mono`, `tone="neutral"` when clean | `formatErrorRate(row.errorRate)` `:300` | `:292-304` |
| 8 | `Avg duration` | **right** | `span.num` | `formatDurationMs(row.avgDuration)` `:310` | `:305-311` |
| 9 | `Last active` | **right** | **`span.dim`** | `formatRelativeTime(row.lastTimestamp)` `:317` | `:312-318` |

`rowKey = row.folder` `:194`; `limit={TABLE_LIMIT}` `:197`; **`dense`** `:198`; card description is the live count
`:165-171`; actions are the hide-temporary checkbox and the 240px filter input `:174-185`.

**Two independent MeterCell maxima** (`:239`, `:253`), range-scoped so filtering does not rescale (`:74`).
`.meter` is a fixed `64px × 4px` (`styles.css:1401-1403`, `1379`) — at 268px it is 24% of the visible wrapper.

## Notable formatter calls, verbatim

```
formatInteger(view.rows.length)                                       ProjectsRoute.tsx:87
formatEstimatedCost(view.totalCost, view.unpricedRequests)             ProjectsRoute.tsx:98
formatCompact(view.conversationTokens)                                 ProjectsRoute.tsx:106
formatPercent(view.cacheRate)                                          ProjectsRoute.tsx:111
`${formatEstimatedCost(row.totalCost, row.unpricedRequests)} · ${formatPercent(row.costShare)}`   :132
`${formatInteger(row.totalRequests)} · ${formatPercent(row.requestShare)}`                       :153
formatFolder(row.folder)                                               ProjectsRoute.tsx:130, 151
formatCompact(row.conversationTokens)                                  ProjectsRoute.tsx:268
formatPercent(row.cacheRate)                                           ProjectsRoute.tsx:278
formatErrorRate(row.errorRate)                                         ProjectsRoute.tsx:300
```

## Terminal shape at 40 columns

```
Projects
Usage by session folder in the last 24 hours.

  Folders
    3
  Requests
    3,956
  API-equivalent cost
    $4.09
  Conversation tokens
    965M                 ← 2-line tile, no foot
  Cache rate
    98.1%                ← 2-line tile, no foot

─ Top by cost ───────────── Share of API-equivalent cost ──
  omp-sta…  ▓▓▓▓▓▓░  $3.90 · 68%
  omp…      ▓▓░░░     $1.10 · 28%
  other     ▓░░░      $0.09 ·  4%
─ Top by requests ─────────── Share of all requests ──────
  omp-sta…  ▓▓▓▓▓▓░  2,190 · 55%
  omp…      ▓▓░░░    1,540 · 39%
  other     ▓░░░       226 ·  6%

─ Folders ────────────────── 3 folders ───────────────────
  Folder  Requests  Cost  Tokens  Cache rate  Cache sav  Errors  Avg dur  Last active
  omp…    2,190     $3.90  612M   98.1%      71.2%      [0.4%]   12.1s   2m ago
```

**What 40 columns forces.** The Folders table's fixed-size elements — `.projects-folder`'s `280px` cap, two
`64px` meters — total 408px inside a 268px wrapper, before the seven numeric columns. That is a measurement. The
`priority` drop order, if any, belongs in the IR (`spec.ts:236-244`), which records it as the terminal's own decision;
this document does not invent one.
