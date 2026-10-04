# Projects — 150 columns (1200px viewport)

**Web route:** `routes/ProjectsRoute.tsx`
**IR citation:** `src/layout/spec.ts:728-731` —
`lines: "78-117 (StatGrid), 118-138 (Top by cost), 139-160 (Top by requests), 161-219 (Folders card), 221-320 (columns)"`
**Capture:** `screens/projects-150.png` — live, `#/projects?range=24h`, 1200px, dark, fullPage. Page height **1052px**.

## Page header

```
h1.page-title        "Projects"
p.page-description   "Usage by session folder in the last 24 hours."
(no .page-actions)
```

## Top-level order

| # | Element | Wrapper | `file:line` |
|---|---|---|---|
| 1 | `PageHeader` | — | `ProjectsRoute.tsx:78-79` |
| 2 | **StatGrid** — 5 `md` tiles, `min={180}` | `div[data-stale]` | `:84-113` |
| 3 | **`div.grid .grid-2`** — Top by cost + Top by requests, 1fr : 1fr | — | `:118-160` |
| 4 | **Card** "Folders" — `flush`, `dense`, `limit={TABLE_LIMIT}` | full width | `:162-214` |

**Projects uses `.grid-2`, not `.grid-main-side`.** Measured `463px 463px` — a true **1:1** split with the standard
`16px` gap (`styles.css:704-706`, `701`). Contrast Overview/Costs/Errors/Providers at **2:1**. The IR records this
screen's two charts as `type: "shareBar"` (`spec.ts:770`, `786`), which is **wrong about the component**: they are
`BarList`s, not `ShareBar`s (`ProjectsRoute.tsx:127`, `148`). See § Card 1.

## StatGrid — `--stat-min: 180px`, 5 tiles, **5 columns, no wrap**

`ProjectsRoute.tsx:84-113`. `floor(942/180) = 5`.

| # | Tile | label | value formatter | hint | spark | `file:line` |
|---|---|---|---|---|---|---|
| 1 | Folders | `formatInteger(view.rows.length)` `:87` | `view.temporaryCount > 0 ? `${formatInteger(view.temporaryCount)} temporary` : undefined` `:88` | none | `:85-89` |
| 2 | Requests | `formatInteger(view.totalRequests)` `:92` | `` `${formatInteger(view.failedRequests)} failed` `` `:93` | none | `:90-94` |
| 3 | API-equivalent cost | `formatEstimatedCost(view.totalCost, view.unpricedRequests)` `:98` | `view.unpricedRequests > 0 ? `${formatInteger(view.unpricedRequests)} unpriced` : undefined` `:99-101` | none | `:95-102` |
| 4 | Conversation tokens | **`formatCompact(view.conversationTokens)`** `:106` | **none — no `hint` prop at all** | none | `:103-107` |
| 5 | Cache rate | `formatPercent(view.cacheRate)` `:111` | **none** | none | `:108-112` |

**`formatCompact` vs `formatInteger` — tile 4 is the ONLY `formatCompact` on this row**, and it is the **only stat
tile anywhere in the dashboard that carries no `hint`**. That makes tile 4 and tile 5 **2-line tiles** while tiles
1–3 are 3-line. In a 5-wide row the row height is set by tiles 1–3; tiles 4 and 5 sit top-aligned in it.

`view.cacheRate` is the **range-wide** rate, not `view.rows[0].cacheRate` — the IR calls this out at `spec.ts:755-762`
and the route implements it that way (`view-models.ts` `buildFolderRows` sums input and cache reads across every
folder and divides once). **A folder row's own `cacheRate` is a per-folder figure and must not be summed.**

## Card 1 & 2 — "Top by cost" / "Top by requests" (1:1, side by side)

```
section.card.rise[--i=1]                     ┐ 463px
  h2.card-title        "Top by cost"          │ ProjectsRoute.tsx:119
  p.card-description   "Share of API-equivalent cost"   :119
  div.card-body > div.bar-list
    button.bar-list-row × N
      span.bar-list-fill[style width:%]
      span.bar-list-label  <span className="mono">{formatFolder(row.folder)}</span>
      span.bar-list-value  "…"                  ┘

section.card.rise[--i=2]                     ┐ 463px
  h2.card-title        "Top by requests"      │ :140
  p.card-description   "Share of all requests"│ :140
  div.card-body > div.bar-list  (same shape)  ┘
```

**These are `BarList`s, not `ShareBar`s — and the difference is structural, not cosmetic.**

| | `BarList` (what these are) | `ShareBar` (what the IR calls them) |
|---|---|---|
| Shape | **N rows**, one per folder | **1 row**, N segments |
| Component | `charts/BarList.tsx:21-49` | `charts/ShareBar.tsx:9-26` |
| Row height | **`30px`** (`styles.css:1795`) | **`8px`** (`styles.css:1770`) |
| Bar placement | **behind** the label, `opacity 0.16`, inset `top/bottom 3px` → 24px tall (`styles.css:1807-1816`) | in place of it, full height |
| Labels | yes — one per row, left; value right | none — `title` tooltip only |
| Floor | `Math.max(0.5, pct)` — a nonzero row is never invisible (`BarList.tsx:26`) | `min-width: 2px` (`styles.css:1779`) |
| Interactive | `onSelect` → clicking a row sets the folder search (`ProjectsRoute.tsx:135`, `155`) | none |

**The IR's two Projects charts are typed `shareBar` at `spec.ts:770` and `786`, which loses the entire ranked list.**
The per-screen IR note at `spec.ts:822` acknowledges the missing hide-temporary/search/click-to-filter but does not
record the BarList/ShareBar distinction. **A terminal porting this screen as a share bar has ported one row of the
wrong component.**

BarList `value` strings — **both cards compose two figures with a `·` separator**:

```ts
// Top by cost — ProjectsRoute.tsx:132
`${formatEstimatedCost(row.totalCost, row.unpricedRequests)} · ${formatPercent(row.costShare)}`
// Top by requests — ProjectsRoute.tsx:153
`${formatInteger(row.totalRequests)} · ${formatPercent(row.requestShare)}`
```

Bar colours: cost card → `"var(--chart-secondary)"` (pink) `:133`; requests card → **no `color`, so it defaults to
`var(--chart-primary)`** (cyan) (`BarList.tsx:31`). **Cost is pink, requests is cyan — the same convention as every
sparkline and MeterCell.**

Labels are wrapped in `<span className="mono">{formatFolder(row.folder)}</span>` (`:130`, `:151`), and
`formatFolder` strips leading/trailing slashes and renders `"(root)"` for the empty folder
(`formatters.ts:96-98`).

## Card 3 — "Folders" — `flush`, `dense`, 9 columns

```
section.card.rise[--i=3] flush
  h2.card-title        "Folders"                                              :164
  p.card-description   "3 folders"  |  "N of M folders"                       :165-171
  div.card-actions
    label.check  "Hide temporary (N)"   (only when temporaryCount > 0)       :174-183
    label.search > input.input          "Filter folders…"  width 240         :184
  div.card-body[data-flush=true]
    div.table-wrap > table.table[data-dense=TRUE]
      thead > tr > th ×9
      tbody > tr ×N
  div.table-more    ← appears past TABLE_LIMIT rows
```

The card **description is a live count**, not prose (`:165-171`): `"N folders"` when unfiltered, `"M of N folders"`
when the search is active. Table props: `rowKey={row => row.folder}` `:194`, `initialSort {{key:"cost",dir:"desc"}}`
`:196`, `limit={TABLE_LIMIT}` `:197`, **`dense`** `:198`.

### Columns — `folderColumns`, `ProjectsRoute.tsx:219-320`. Nine.

| # | key | header | align | cell | formatter, verbatim | `file:line` |
|---|---|---|---|---|---|---|
| 1 | `folder` | `Folder` | left | `span.row.projects-folder` (`max-width: 280px`) with `span.mono.truncate` + optional `<Badge>temp</Badge>` | `formatFolder(row.folder)` | `:221-231` |
| 2 | `requests` | `Requests` | **right** | **`MeterCell`** `max={maxRequests}` | `formatInteger(row.totalRequests)` `:239` | `:232-242` |
| 3 | `cost` | `Cost` | **right** | **`MeterCell`** `max={maxCost}` `color="var(--chart-secondary)"` `:255` | `formatEstimatedCost(row.totalCost, row.unpricedRequests)` `:254` | `:243-259` |
| 4 | `tokens` | `Tokens` | **right** | `span.num` + `title={formatInteger(...)}` | **`formatCompact(row.conversationTokens)`** `:268` | `:260-271` |
| 5 | `cacheRate` | `Cache rate` | **right** | `span.num` | `formatPercent(row.cacheRate)` `:278` | `:272-279` |
| 6 | `cacheSavings` | `Cache savings` | **right** | `span.num` + `tone-bad` if `< 0` else `muted` | `formatPercent(row.cacheSavings)` `:288` | `:280-291` |
| 7 | `errorRate` | `Errors` | **right** | **`Badge`** `mono`, `tone="neutral"` when `failedRequests === 0` else `errorRateTone(row.errorRate)` `:299` | `formatErrorRate(row.errorRate)` `:300` | `:292-304` |
| 8 | `duration` | `Avg duration` | **right** | `span.num` | `formatDurationMs(row.avgDuration)` `:310` | `:305-311` |
| 9 | `last` | `Last active` | **right** | **`span.dim`** (not `.num`, not `.muted`) `:317` | `formatRelativeTime(row.lastTimestamp)` `:317` | `:312-318` |

**`formatCompact` vs `formatInteger` here: exactly one of each.**
- **`Tokens`** is `formatCompact(row.conversationTokens)` `:268`, with the exact value in the `title` as
  `formatInteger` `:267`. This is the same compact-with-exact-tooltip pattern as Models' Tokens column
  (`ModelsRoute.tsx:367-369`).
- **`Requests`** is `formatInteger(row.totalRequests)` `:239`.
- Everything else is a percent, a duration, a relative time, or a cost.

**Two MeterCell columns on one table, with independent maxima.** `Requests` scales to `maxRequests` and `Cost` to
`maxCost` — and the comment at `ProjectsRoute.tsx:74` states the intent: *"Meter scales follow the whole range so a
bar's length does not change while filtering."* **A terminal must compute two separate maxima, not one.**

**`Errors` uses `tone="neutral"` for a clean row** (`:299`), whereas Models uses a bare dim `"0%"` with no badge
(`ModelsRoute.tsx:388`). Both routes are correct for themselves; do not normalise them.

`.projects-folder { gap: 8px; max-width: 280px; min-width: 0 }` (`projects.css:2-6`) — the comment there reads
*"Long temp-dir names must not stretch the table."*

Measured: table `scrollWidth 1119px > clientWidth 940px` → **overflows at 1200px too.** 9 columns, `dense`.

## Notable formatter calls, verbatim

```
formatInteger(view.rows.length)                                       ProjectsRoute.tsx:87
formatEstimatedCost(view.totalCost, view.unpricedRequests)             ProjectsRoute.tsx:98
formatCompact(view.conversationTokens)                                 ProjectsRoute.tsx:106
formatPercent(view.cacheRate)                                          ProjectsRoute.tsx:111
`${formatEstimatedCost(row.totalCost, row.unpricedRequests)} · ${formatPercent(row.costShare)}`   :132
`${formatInteger(row.totalRequests)} · ${formatPercent(row.requestShare)}`                       :153
formatFolder(row.folder)                                               ProjectsRoute.tsx:130, 151
formatInteger(row.conversationTokens)   (title only)                   ProjectsRoute.tsx:267
formatCompact(row.conversationTokens)                                 ProjectsRoute.tsx:268
formatPercent(row.cacheRate)                                           ProjectsRoute.tsx:278
formatPercent(row.cacheSavings)                                        ProjectsRoute.tsx:288
formatErrorRate(row.errorRate)                                         ProjectsRoute.tsx:300
formatDurationMs(row.avgDuration)                                      ProjectsRoute.tsx:310
formatRelativeTime(row.lastTimestamp)                                  ProjectsRoute.tsx:317
```

## Terminal shape at 150 columns

```
Projects
Usage by session folder in the last 24 hours.

  Folders   3
  Requests  3,956          ← 5 tiles, ONE row, no wrap
  API-equivalent cost  $4.09
  Conversation tokens  965M       ← NO foot line
  Cache rate          98.1%       ← NO foot line

┌─ Top by cost ────────────────┐┌─ Top by requests ──────────────┐
│ Share of API-equivalent cost  ││ Share of all requests          │
│ omp-stats-tui  ▓▓▓▓▓▓░ $3.90 68% │ omp-stats-tui  ▓▓▓▓▓▓░ 2,190 55% │
│ omp           ▓▓░░░ $1.10 28%     │ omp           ▓▓░░░ 1,540 39%  │
│ other         ▓░░░ $0.09  4%     │ other         ▓░░░ 226  6%   │
│  ← 30px rows, bar BEHIND the label at 16%, min 0.5%     │
└──────────────────────────────┘└──────────────────────────────┘

─ Folders ────────── 3 folders ─────── [Hide temporary (1)] [Filter…]
  Folder  Requests  Cost  Tokens  Cache rate  Cache sav  Errors  Avg dur  Last active
  omp…    2,190(m)  $3.90(m)  612M   98.1%      71.2%      [0.4%]   12.1s   2m ago
```

- **`.grid-2` is a true 1:1** (463px each), not 2:1. The two BarList cards are peers.
- A BarList row is **30px** — the tallest repeated row unit in the dashboard after table rows. A terminal's ranked
  list should give each entry its own row with the bar as a background fill, not a bar on its own line.
