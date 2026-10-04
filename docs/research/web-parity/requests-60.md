# Requests — 60 columns (480px viewport)

**Web route:** `routes/RequestsRoute.tsx` · **IR citation:** `src/layout/spec.ts:832-835`
**Capture:** `screens/requests-60.png` — live, `#/requests?range=24h`, 480px, dark, fullPage. Page height **5961px**.
Full column/format detail: **`requests-150.md`**. All deltas measured live.

## Measured at 480px

| Property | At 1200px | **At 480px** |
|---|---|---|
| `.shell-content` padded box | `986px` | **`462px`** (inner `430px`) |
| `--gutter` | `22px` | `16px` |
| `.grid-*` container | n/a | n/a |
| StatGrid (`min 160`) | 5 cols | **2 columns**, 6 tiles → **2 + 2 + 2** |
| Request-log table | 10 cols, `940px` client, `944px` scroll | 10 cols, **`428px` client**, `944px` scroll → **+516px (2.2×)** |
| `data-dense` | `true` | `true` |
| Rows rendered | 100 | **100** |

`floor(430/160) = 2`, so the six tiles form **three even rows of 2** — the most regular arrangement the stat grid
achieves at any width, and the one that best exposes the **2-line vs 3-line tile distinction**:

- row 1: Requests (3-line) + Failed (3-line)
- row 2: **Tokens (2-line)** + API-equivalent cost (3-line)
- row 3: Median duration (3-line) + **Median TTFT (2-line)**

## Page header

```
h1.page-title        "Requests"                                                          RequestsRoute.tsx:107-110
p.page-description   "Every model call omp made in the last 24 hours, newest first. Open a row for its full payload."
(no .page-actions)
```

## Top-level order — unchanged by width

| # | Element | `file:line` |
|---|---|---|
| 1 | `PageHeader` | `:107-110` |
| 2 | StatGrid — 6 `md` tiles, `min={160}` → **2 cols** | `:115-151` |
| 3 | Card "Request log" — `flush`, `dense`, `limit={100}` | `:156-212` |

## StatGrid — 2 + 2 + 2

| # | Tile | value | hint | lines |
|---|---|---|---|---|
| 1 | Requests | `formatInteger(summary.requests)` `:118` | `formatRelativeTime(summary.oldest)` `:122` | 3 |
| 2 | Failed | `formatInteger(summary.failed)` `:127` | `formatErrorRate(failed/requests)` + `·` + `formatInteger(aborted)` + `" aborted"` `:128` | 3 |
| 3 | Tokens | **`formatCompact(summary.tokens)`** `:133` | none | **2** |
| 4 | API-equivalent cost | `formatEstimatedCost(summary.cost, summary.unpriced)` `:138` | `formatInteger(summary.unpriced)` `:139` | 3 |
| 5 | Median duration | `formatDurationMs(summary.medianDuration)` `:143` | `formatDurationMs(summary.p95Duration)` `:144` | 3 |
| 6 | Median TTFT | `formatDurationMs(summary.medianTtft)` `:149` | none | **2** |

**`Tokens` is the only `formatCompact`.** Tiles 3 and 6 are the only hintless tiles.

## Card — "Request log"

- Title `:158`; live-count description `:159-165`.
- Actions: `SearchInput` + 4-option `Segmented`, both wrapped onto their own line (`styles.css:760`).
- Footer: prose `:182-187` + `loadMore` button `:188`, laid out `justify-content: space-between` so the button
  sits hard right (`styles.css:808`).
- Table: `limit={100}` `:201`, **`dense`** `:202`, `initialSort {key:"time",dir:"desc"}` `:200`.

### Columns — `RequestsRoute.tsx:217-311`. All ten retained, 2.2× overflow.

| # | header | align | cell | formatter, verbatim | `file:line` |
|---|---|---|---|---|---|
| 1 | `Model` | left | **LabelCell** `span.mono` / provider | — | `:218-223` |
| 2 | `When` | left | `span.muted` | `formatRelativeTime(row.timestamp)` `:230` | `:224-233` |
| 3 | `Project` | left | `span.mono.muted.truncate`, `max-width 180px` | `formatFolder(row.folder)` `:240` | `:234-243` |
| 4 | `Input` | **right** | `span.num` | **`formatCompact(row.usage.input)`** `:250` | `:244-251` |
| 5 | `Cache read` | **right** | `span.num` + tooltip = cache write | **`formatCompact(row.usage.cacheRead)`** `:260` | `:252-263` |
| 6 | `Output` | **right** | `span.num` | **`formatCompact(row.usage.output)`** `:269` | `:264-270` |
| 7 | `Cost` | **right** | `span.num` | `formatMessageCost(row, 4)` `:277` | `:271-278` |
| 8 | `Duration` | **right** | `span.num` | `formatDurationMs(row.duration)` `:284` | `:279-285` |
| 9 | `TTFT` | **right** | `span.num.muted` | `formatDurationMs(row.ttft)` `:292` | `:286-293` |
| 10 | `Status` | left | **LabelCell** `lead={<Dot/>}` | `REQUEST_STATUS[requestStatus(row)]` `:299` | `:294-310` |

**`formatCompact` on Input, Cache read and Output only. `formatInteger` in no cell.**

**At 428px the `Project` column's fixed `max-width: 180px`** (`:239`) is 42% of the wrapper. Combined with the
`LabelCell`'s two non-wrapping, truncating lines (`Table.tsx:222-227`) this is where the table's width actually
goes.

`Status` is **left**-aligned — no `align` key at `:296`, so it defaults to `left` (`Table.tsx:91`). The IR's
`align: "right"` at `spec.ts:893` contradicts the route; the route is what the web renders.

## Terminal shape at 60 columns

```
Requests
Every model call omp made in the last 24 hours, newest first.
Open a row for its full payload.

  Requests      500
  Failed        6
  Tokens        102M        ← 2 lines
  API-equiv…    $0.23
  Median dur…   4.4s
  Median TTFT   2.5s        ← 2 lines
                         ← 3 rows of 2, the most regular the grid ever gets

─ Request log ────── 500 of the latest 500 requests ──
  [search]
  [ALL | OK | FAILED | ABORTED]
  Model      When     Project  Input  Cache read  Output  Cost   Duration  TTFT  Status
  muse-sp…   2m ago   omp-st…  18K    944K        5.5K   $0.0021 12.4s   2.1s   ● ok
  …
  ─────────────────────────────────────────────────────
  100 of 100                              [Show more]
  Showing the latest 500 requests…       [Load more]
```

- The card header's title, search and segmented control each take a line (`flex-wrap: wrap`, `styles.css:760`).
- The stat grid's three 2-tile rows are the clearest demonstration that a hintless tile is one line shorter.
