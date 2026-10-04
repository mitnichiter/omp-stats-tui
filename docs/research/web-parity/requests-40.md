# Requests — 40 columns (320px viewport)

**Web route:** `routes/RequestsRoute.tsx` · **IR citation:** `src/layout/spec.ts:832-835`
**Capture:** `screens/requests-40.png` — live, `#/requests?range=24h`, 320px, dark, fullPage. Page height **6316px**.
Full column/format detail: **`requests-150.md`**. All deltas measured live.

## Measured at 320px

| Property | At 1200px | **At 320px** |
|---|---|---|
| `.shell-content` padded box | `986px` | **`302px`** (inner `270px`) |
| `--gutter` | `22px` | `16px` |
| `.grid-*` container | n/a | n/a |
| StatGrid (`min 160`) | 5 cols | **1 column** — `floor(270/160) = 1`; 6 tiles stack |
| Request-log table | 10 cols, `940px` client, `944px` scroll | 10 cols, **`268px` client**, `944px` scroll → **+676px (3.5×)** |
| `data-dense` | `true` | `true` |
| Rows rendered | 100 | **100** |

**The load-bearing fact at 40 columns: `min: 160px` collapses to a single column in a 270px box.** Six tiles become
a vertical list of 3, 3, 2, 2, 3, 2 lines. The screen's height goes from 5733px to 6316px — the extra ~580px is the
stat grid's wrap plus the header's description wrapping to four lines.

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
| 2 | StatGrid — 6 `md` tiles, `min={160}` → **1 col** | `:115-151` |
| 3 | Card "Request log" — `flush`, `dense`, `limit={100}` | `:156-212` |

## StatGrid — one tile per row

| # | Tile | value | hint | lines |
|---|---|---|---|---|
| 1 | Requests | `formatInteger(summary.requests)` `:118` | `formatRelativeTime(summary.oldest)` `:122` | 3 |
| 2 | Failed | `formatInteger(summary.failed)` `:127` | `formatErrorRate(failed / requests)` + `·` + `formatInteger(aborted)` + `" aborted"` `:128` | 3 |
| 3 | Tokens | **`formatCompact(summary.tokens)`** `:133` | none | **2** |
| 4 | API-equivalent cost | `formatEstimatedCost(summary.cost, summary.unpriced)` `:138` | `formatInteger(summary.unpriced)` `:139` | 3 |
| 5 | Median duration | `formatDurationMs(summary.medianDuration)` `:143` | `formatDurationMs(summary.p95Duration)` `:144` | 3 |
| 6 | Median TTFT | `formatDurationMs(summary.medianTtft)` `:149` | none | **2** |

`Failed`'s hint is the widest string on the screen: `"1.2% · 3 aborted"`. In a single column the full 270px is
available, so it fits without truncation — but it is the only `.stat-foot` that composes **two different formatters
into one string** (`:128`).

**`formatCompact` on `Tokens` only. `formatInteger` on four figures across the row.**

## Card — "Request log"

- Title `:158`; live-count description `:159-165`, wrapping to several lines at 270px.
- Actions stack: `SearchInput` `:168` then the 4-option `Segmented` `:169-175`, each on its own line
  (`styles.css:760`).
- Footer `justify-content: space-between` (`styles.css:808`): prose `:182-187` left, `loadMore` `:188` right —
  in 268px these effectively stack.
- Table: `limit={100}` `:201`, **`dense`** `:202`, `initialSort {key:"time",dir:"desc"}` `:200`.

### Columns — `RequestsRoute.tsx:217-311`. All ten retained, 3.5× overflow.

| # | header | align | cell | formatter, verbatim | `file:line` |
|---|---|---|---|---|---|
| 1 | `Model` | left | **LabelCell** — 2 lines, 13px/500/`ink-1` over 12px/`ink-3`, **0 gap**, both truncate | — | `:218-223` |
| 2 | `When` | left | `span.muted` + `title={formatTimestamp(...)}` | `formatRelativeTime(row.timestamp)` `:230` | `:224-233` |
| 3 | `Project` | left | `span.mono.muted.truncate`, `display:block; max-width: 180px` | `formatFolder(row.folder)` `:240` | `:234-243` |
| 4 | `Input` | **right** | `span.num` | **`formatCompact(row.usage.input)`** `:250` | `:244-251` |
| 5 | `Cache read` | **right** | `span.num` + `title={`Cache write: ${formatInteger(row.usage.cacheWrite)}`}` | **`formatCompact(row.usage.cacheRead)`** `:260` | `:252-263` |
| 6 | `Output` | **right** | `span.num` | **`formatCompact(row.usage.output)`** `:269` | `:264-270` |
| 7 | `Cost` | **right** | `span.num` | `formatMessageCost(row, 4)` `:277` | `:271-278` |
| 8 | `Duration` | **right** | `span.num` | `formatDurationMs(row.duration)` `:284` | `:279-285` |
| 9 | `TTFT` | **right** | `span.num.muted` | `formatDurationMs(row.ttft)` `:292` | `:286-293` |
| 10 | `Status` | **left** | **LabelCell** `lead={<Dot tone/>}` | `REQUEST_STATUS[requestStatus(row)]` `:299` | `:294-310` |

**`formatCompact` on exactly Input, Cache read, Output. `formatInteger` in no cell — the only place
`formatInteger` appears on this screen is inside tile 2's hint (`:128`) and inside the Cache-read tooltip (`:259`).**

**`Status` is left-aligned** (no `align` key at `:296` → `left`, `Table.tsx:91`). The IR declares `align: "right"`
at `spec.ts:893`, which the web does not do.

## Notable formatter calls, verbatim

```
formatInteger(summary.requests)                                        RequestsRoute.tsx:118
`${summary.requests > 0 ? formatErrorRate(summary.failed / summary.requests) : "–"} · ${formatInteger(summary.aborted)} aborted`   :128
formatCompact(summary.tokens)                                           RequestsRoute.tsx:133
formatEstimatedCost(summary.cost, summary.unpriced)                    RequestsRoute.tsx:138
formatDurationMs(summary.medianDuration) / (summary.p95Duration)       RequestsRoute.tsx:143-144
formatDurationMs(summary.medianTtft)                                   RequestsRoute.tsx:149
formatRelativeTime(row.timestamp)                                      RequestsRoute.tsx:230
formatFolder(row.folder)                                               RequestsRoute.tsx:240
formatCompact(row.usage.input)                                         RequestsRoute.tsx:250
formatCompact(row.usage.cacheRead)                                     RequestsRoute.tsx:260
formatCompact(row.usage.output)                                        RequestsRoute.tsx:269
formatMessageCost(row, 4)                                              RequestsRoute.tsx:277
formatDurationMs(row.duration)                                         RequestsRoute.tsx:284
formatDurationMs(row.ttft)                                             RequestsRoute.tsx:292
```

## Terminal shape at 40 columns

```
Requests
Every model call omp made in the last 24 hours, newest first.
Open a row for its full payload.

  Requests
    500
    since 14 hours ago
  Failed
    6
    1.2% · 3 aborted
  Tokens
    102M                 ← 2 lines, no foot
  API-equivalent cost
    $0.23
    12 unpriced
  Median duration
    4.4s
    p95 22.1s
  Median TTFT
    2.5s                 ← 2 lines, no foot

─ Request log ────── 500 of the latest 500 requests ──
  [Model, provider or project]
  [ALL | OK | FAILED | ABORTED]
  Model   When  Project  Input  Cache read  Output  Cost   Duration  TTFT  Status
  muse-…  2m    omp-st…  18K   944K        5.5K   $0.0021 12.4s   2.1s   ● ok
  …
  ───────────────────────────────────────────
  100 of 100                             [Show more]
  Showing the latest 500 requests, back to Sep 28, 14:03.
  [Load more]
```

**What 40 columns forces.** Ten columns needing 944px in a 268px wrapper. The web scrolls. A 40-cell terminal must
drop something, and the IR is explicit that the web's ordering is the terminal's own default priority while the drop
decision is the terminal's (`spec.ts:236-244`). This document supplies the measurements a drop order would need and
does not supply the order.
