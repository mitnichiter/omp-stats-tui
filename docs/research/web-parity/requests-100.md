# Requests — 100 columns (800px viewport)

**Web route:** `routes/RequestsRoute.tsx` · **IR citation:** `src/layout/spec.ts:832-835`
**Capture:** `screens/requests-100.png` — live, `#/requests?range=24h`, 800px, dark, fullPage. Page height **5768px**.
Full column/format detail: **`requests-150.md`**. All deltas measured live.

## Measured at 800px

| Property | At 1200px | **At 800px** |
|---|---|---|
| `.shell-content` padded box | `986px` | **`782px`** (inner `750px`) |
| `--gutter` | `22px` | `16px` |
| `.grid-*` container | n/a | n/a — Requests never has one |
| StatGrid (`min 160`) | **5 columns**, 6 tiles → 5 + 1 | **4 columns**, 6 tiles → **4 + 2** |
| Request-log table | 10 cols, `940px` client, `944px` scroll | 10 cols, **`748px` client**, `944px` scroll → **+196px** |
| `data-dense` | `true` | `true` |
| Rows rendered | 100 (`limit={100}`) | **100** |

`floor(750/160) = 4`, so the six tiles wrap **4 + 2** rather than 5 + 1. The final row holds **Requests** and
**Failed** — and those are two of the four tiles that *do* carry hints, so the trailing row is a full 3-line row
rather than the short 2-line pair that lands there at 150 columns.

## Page header

```
h1.page-title        "Requests"                                                            RequestsRoute.tsx:107-110
p.page-description   "Every model call omp made in the last 24 hours, newest first. Open a row for its full payload."
(no .page-actions)
```

## Top-level order — unchanged by width

| # | Element | `file:line` |
|---|---|---|
| 1 | `PageHeader` | `:107-110` |
| 2 | StatGrid — 6 `md` tiles, `min={160}` → **4 cols** | `:115-151` |
| 3 | Card "Request log" — `flush`, `dense`, `limit={100}` | `:156-212` |

## StatGrid — 4 + 2

| # | Tile | value formatter | hint formatter | lines |
|---|---|---|---|---|
| 1 | Requests | `formatInteger(summary.requests)` `:118` | `formatRelativeTime(summary.oldest)` `:122` | 3 |
| 2 | Failed | `formatInteger(summary.failed)` `:127` | `formatErrorRate(summary.failed / summary.requests)` + `·` + `formatInteger(summary.aborted)` + `" aborted"` `:128` | 3 |
| 3 | Tokens | **`formatCompact(summary.tokens)`** `:133` | none | 2 |
| 4 | API-equivalent cost | `formatEstimatedCost(summary.cost, summary.unpriced)` `:138` | `formatInteger(summary.unpriced)` `:139` | 3 |
| 5 | Median duration | `formatDurationMs(summary.medianDuration)` `:143` | `formatDurationMs(summary.p95Duration)` `:144` | 3 |
| 6 | Median TTFT | `formatDurationMs(summary.medianTtft)` `:149` | none | 2 |

**`Tokens` is the only `formatCompact` on this row.** Tiles 3 and 6 are the only hintless (2-line) tiles.

## Card — "Request log"

- Title `:158`; description is a live count — `"{n} of {total} requests in {window}"`, or
  `"{n} of the latest {total} requests"`, or `"Loading the latest requests…"` (`:159-165`).
- Actions: `SearchInput` `"Model, provider or project"` `:168` and a 4-option `Segmented` `ALL | OK | FAILED |
  ABORTED` `:169-175`. `.card-header` is `flex-wrap: wrap` (`styles.css:760`), so at 750px the two controls drop
  onto their own line beneath the title.
- Footer: prose `"Showing the latest {n} requests, back to {ts}. Older requests in {window} are not loaded."`
  `:182-187` plus a `loadMore` button `:188`.
- Table: `rowKey` `:197`, `onRowClick` → `RequestDrawer` `:198`, `initialSort {key:"time",dir:"desc"}` `:200`,
  **`limit={100}`** `:201`, **`dense`** `:202`.

### Columns — `RequestsRoute.tsx:217-311`. All ten retained.

| # | header | align | cell | formatter, verbatim | `file:line` |
|---|---|---|---|---|---|
| 1 | `Model` | left | **LabelCell** `span.mono` / provider | — | `:218-223` |
| 2 | `When` | left | `span.muted` + `title` | `formatRelativeTime(row.timestamp)` `:230` | `:224-233` |
| 3 | `Project` | left | `span.mono.muted.truncate`, `max-width 180px` | `formatFolder(row.folder)` `:240` | `:234-243` |
| 4 | `Input` | **right** | `span.num` | **`formatCompact(row.usage.input)`** `:250` | `:244-251` |
| 5 | `Cache read` | **right** | `span.num` + `title` (cache write) | **`formatCompact(row.usage.cacheRead)`** `:260` | `:252-263` |
| 6 | `Output` | **right** | `span.num` | **`formatCompact(row.usage.output)`** `:269` | `:264-270` |
| 7 | `Cost` | **right** | `span.num` | `formatMessageCost(row, 4)` `:277` | `:271-278` |
| 8 | `Duration` | **right** | `span.num` | `formatDurationMs(row.duration)` `:284` | `:279-285` |
| 9 | `TTFT` | **right** | `span.num.muted` | `formatDurationMs(row.ttft)` `:292` | `:286-293` |
| 10 | `Status` | left | **LabelCell** `lead={<Dot/>}` | `REQUEST_STATUS[requestStatus(row)]` `:299` | `:294-310` |

**`formatCompact` on exactly three columns — Input, Cache read, Output. `formatInteger` on none.**
The 4th token figure (cache write) lives only in the `Cache read` cell's tooltip (`:259`).

Measured `scrollWidth 944px` vs `clientWidth 748px` — a **196px** overflow. `nowrap` on every cell
(`styles.css:1278`, `1317`) means nothing compresses; the web scrolls.

## Terminal shape at 100 columns

```
Requests
Every model call omp made in the last 24 hours, newest first. Open a row
for its full payload.

  Requests           500
  Failed             6
  Tokens             102M          ← 2-line tile
  API-equivalent cost  $0.23
  Median duration    4.4s
  Median TTFT        2.5s          ← 2-line tile

─ Request log ────── 500 of the latest 500 requests ── [search] [ALL|OK|FAILED|ABORTED]
  Model      When     Project  Input  Cache read  Output  Cost   Duration  TTFT  Status
  muse-sp…   2m ago   omp-st…  18K    944K        5.5K   $0.0021  12.4s    2.1s   ● ok
  …
  ──────────────────────────────────────────────────────
  100 of 100                                     [Show more]
  Showing the latest 500 requests, back to Sep 28.   [Load more]
```

- The stat row wraps **4 + 2**; at 150 columns it wrapped **5 + 1**. The change moves which tiles land alone.
- The card header's two controls wrap onto their own row (`styles.css:760`).
- The table overflows by 196px and the web scrolls rather than dropping a column.
