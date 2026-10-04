# Requests — 150 columns (1200px viewport)

**Web route:** `routes/RequestsRoute.tsx`
**IR citation:** `src/layout/spec.ts:832-835` —
`lines: "107-114 (header), 115-154 (StatGrid), 156-205 (Request log card), 219-299 (columns)"`
**Capture:** `screens/requests-150.png` — live, `#/requests?range=24h`, 1200px, dark, fullPage. Page height **5733px**
— by far the tallest screen, because it renders up to 100 rows.

## Page header

```
h1.page-title        "Requests"                                                    RequestsRoute.tsx:107-110
p.page-description   "Every model call omp made in the last 24 hours, newest first. Open a row for its full payload."
(no .page-actions)
```

## Top-level order — **no grid container**

| # | Element | Wrapper | `file:line` |
|---|---|---|---|
| 1 | `PageHeader` | — | `:107-110` |
| 2 | **StatGrid** — 6 `md` tiles, `min={160}` | `div[data-stale]` | `:115-151` |
| 3 | **Card** "Request log" — `flush`, `dense`, `limit={100}` | full width | `:156-212` |

Requests has **one card and one stat row.** No charts, no `.grid-*`, no legend, no BarList. The whole screen is a
header, six tiles, and one very long table.

## StatGrid — `--stat-min: 160px`, 6 tiles, **5 columns at 1200px**

`RequestsRoute.tsx:115-151`. `floor(942/160) = 5`, so **6 tiles wrap 5 + 1**. `160px` is the **smallest primary-row
`min` on the dashboard** — chosen because this row has six tiles.

| # | Tile | label | value formatter | hint | spark | `file:line` |
|---|---|---|---|---|---|---|
| 1 | Requests | `formatInteger(summary.requests)` `:118` | `summary.oldest === null ? \`none in ${meta.windowLabel}\` : \`since ${formatRelativeTime(summary.oldest)}\`` `:119-123` | none | `:116-124` |
| 2 | Failed | `formatInteger(summary.failed)` `:127` | `` `${summary.requests > 0 ? formatErrorRate(summary.failed / summary.requests) : "–"} · ${formatInteger(summary.aborted)} aborted` `` `:128` | none | `:125-129` |
| 3 | Tokens | **`formatCompact(summary.tokens)`** `:133` | **none** | none | `:130-134` |
| 4 | API-equivalent cost | `formatEstimatedCost(summary.cost, summary.unpriced)` `:138` | `summary.unpriced > 0 ? `${formatInteger(summary.unpriced)} unpriced` : undefined` `:139` | none | `:135-140` |
| 5 | Median duration | `formatDurationMs(summary.medianDuration)` `:143` | `` `p95 ${formatDurationMs(summary.p95Duration)}` `` `:144` | none | `:141-145` |
| 6 | Median TTFT | `formatDurationMs(summary.medianTtft)` `:149` | **none** | none | `:146-150` |

**`formatCompact` vs `formatInteger`: `Tokens` (tile 3) is the only `formatCompact`.** Tiles 1, 2 and 4's hints are
`formatInteger`. Tile 2's hint is the interesting one — it composes **two different formatters into one string**:

```ts
hint={`${summary.requests > 0 ? formatErrorRate(summary.failed / summary.requests) : "–"} · ${formatInteger(summary.aborted)} aborted`}   // RequestsRoute.tsx:128
```

i.e. `"1.2% · 3 aborted"`. Note this is a **rate computed inline** — the IR records it as `requestFailed` /
`requestAborted` at `spec.ts:847-848`.

Tiles 3 and 6 pass **no `hint`** and so render **2 lines**; tiles 1, 2, 4, 5 render 3 lines.

**There is no sparkline anywhere on the Requests screen.** It is the only ported route with a stat row and **zero**
sparks — a request log is not a trend.

`Median duration` / `Median TTFT` are **medians**, not averages, and the tile title names them
(`:142`, `:147`); tile 5's hint carries the p95. A terminal that renders a mean here has changed the metric.

## Card — "Request log"

```
section.card.rise[--i=1] flush
  header.card-header
    div.card-titles
      h2.card-title        "Request log"                                     :158
      p.card-description   "{n} of {total} requests in {window}"
                          | "{n} of the latest {total} requests"
                          | "Loading the latest requests…"                  :159-165
    div.card-actions
      label.search > input.input         "Model, provider or project"       :168
      div.segmented[sm]                  ALL | OK | FAILED | ABORTED         :169-175
  div.card-body[data-flush=true]
    div.table-wrap > table.table[data-dense=TRUE]
      thead > tr > th ×10
      tbody > tr ×N                        (limit={100})
  footer.card-footer
    span   "Showing the latest {n} requests, back to {ts}. Older requests in {window} are not loaded."   :182-187
    button  {loadMore}                                                              :188
```

Table props: `rowKey={row => row.id ?? \`${row.sessionFile}:${row.entryId}\`}` `:197`,
`onRowClick` opens the `RequestDrawer` `:198`, `initialSort={{key:"time",dir:"desc"}}` `:200`,
**`limit={100}`** `:201`, **`dense`** `:202`.

**This is the only card in the dashboard with a `footer`** besides Errors. `.card-footer` is
`border-top 1px var(--line-1); padding 10px 16px; font-size 12.5px; color ink-3; flex; justify-content space-between;
gap 8px` (`styles.css:801-810`) — so the footer is **prose on the left, an action on the right**, both at 12.5px in
`ink-3`.

**`limit={100}` + `.table-more`:** the first 100 rows render, and a `.table-more` footer appears with
`formatInteger(visible.length) + " of " + formatInteger(sorted.length)` plus a "Show more" button that adds
**`limit × 4 = 400`** rows at a time (`Table.tsx:155-183`, `:166`). This is the tallest screen on the dashboard
(5733px at 150 columns) purely because of it.

### Columns — `REQUEST_COLUMNS`, `RequestsRoute.tsx:217-311`. Ten.

| # | key | header | align | cell | formatter, verbatim | `file:line` |
|---|---|---|---|---|---|---|
| 1 | `model` | `Model` | left | **`LabelCell`** `primary={<span className="mono">{row.model}</span>}` `secondary={row.provider}` | — | `:218-223` |
| 2 | `time` | `When` | left | `span.muted` + `title={formatTimestamp(...)}` | `formatRelativeTime(row.timestamp)` `:230` | `:224-233` |
| 3 | `project` | `Project` | left | `span.mono.muted.truncate`, `display:block; maxWidth: 180px` | `formatFolder(row.folder)` `:240` | `:234-243` |
| 4 | `input` | `Input` | **right** | `span.num` | **`formatCompact(row.usage.input)`** `:250` | `:244-251` |
| 5 | `cache` | `Cache read` | **right** | `span.num` + `title={Cache write: …}` | **`formatCompact(row.usage.cacheRead)`** `:260`; title `formatInteger(row.usage.cacheWrite)` `:259` | `:252-263` |
| 6 | `output` | `Output` | **right** | `span.num` | **`formatCompact(row.usage.output)`** `:269` | `:264-270` |
| 7 | `cost` | `Cost` | **right** | `span.num` | `formatMessageCost(row, 4)` `:277` | `:271-278` |
| 8 | `duration` | `Duration` | **right** | `span.num` | `formatDurationMs(row.duration)` `:284` | `:279-285` |
| 9 | `ttft` | `TTFT` | **right** | `span.num.muted` — **`muted`, not plain** `:292` | `formatDurationMs(row.ttft)` `:292` | `:286-293` |
| 10 | `status` | `Status` | left | **`LabelCell`** `lead={<Dot tone={status.tone} />}` | `REQUEST_STATUS[requestStatus(row)]` `:299` | `:294-310` |

**`formatCompact` vs `formatInteger` — this is where the Routes diverge, and it is the easiest thing to get wrong:**

- **`formatCompact` on exactly three columns:** `Input` `:250`, `Cache read` `:260`, `Output` `:269`.
  **All three token columns are compact.**
- **`formatCompact` appears nowhere else on this screen.** The StatGrid's `Tokens` tile (`:133`) is the only other.
- **No `formatInteger` appears in any cell.** `formatMessageCost` handles Cost and `formatDurationMs` the timings.
- **Contrast with Overview's Latest-requests table**, which uses `formatInteger(row.usage.totalTokens)`
  (`OverviewRoute.tsx:294`) for its Tokens column and has **no** Input/Cache-read/Output split at all.
  **The same underlying figure is compact in one table and integer in another.** That difference is deliberate —
  Overview's row is a summary with one token total; Requests splits three token kinds per row and needs the width.

**Column alignment, verified live:** `Model`, `When`, `Project`, `Status` are left; the six numeric columns
`Input`…`TTFT` are right. **`Status` is LEFT, not right** — the IR declares it `align: "right"` at `spec.ts:893`,
which contradicts `RequestsRoute.tsx:296` (no `align` key → `left`). The IR is wrong here; the route is right.
(Overview's `Status` **is** right — `OverviewRoute.tsx:311` — because it renders a bare `Badge`; Requests' `Status`
renders a `LabelCell` with a `Dot`, which belongs on the left.)

**Notable per-column details:**
- `Project` is `display: block; max-width: 180px` (`:239`) — the only column with an inline max-width in this table.
- `Cache read`'s title carries the **cache-write** count, which has no column of its own (`:255`, `:259`).
- `TTFT` is `span.num.muted` — dimmer than Duration's plain `span.num` (`:292` vs `:284`), because TTFT is a
  secondary timing.
- `Status` renders a **`Dot`** (a round status dot, `ui/Badge.tsx:15-17`), not a `Badge` pill. `Dot` is 8px-ish and
  colourless in shape; the tone carries the meaning.

## Notable formatter calls, verbatim

```
formatInteger(summary.requests)                                          RequestsRoute.tsx:118
formatRelativeTime(summary.oldest)                                       RequestsRoute.tsx:122
`${summary.requests > 0 ? formatErrorRate(summary.failed / summary.requests) : "–"} · ${formatInteger(summary.aborted)} aborted`   :128
formatCompact(summary.tokens)                                             RequestsRoute.tsx:133
formatEstimatedCost(summary.cost, summary.unpriced)                      RequestsRoute.tsx:138
formatDurationMs(summary.medianDuration)                                 RequestsRoute.tsx:143
formatDurationMs(summary.p95Duration)                                    RequestsRoute.tsx:144
formatDurationMs(summary.medianTtft)                                     RequestsRoute.tsx:149
formatRelativeTime(row.timestamp)                                        RequestsRoute.tsx:230
formatFolder(row.folder)                                                 RequestsRoute.tsx:240
formatCompact(row.usage.input)                                           RequestsRoute.tsx:250
formatCompact(row.usage.cacheRead)                                       RequestsRoute.tsx:260
formatCompact(row.usage.output)                                          RequestsRoute.tsx:269
formatMessageCost(row, 4)                                                RequestsRoute.tsx:277
formatDurationMs(row.duration)                                           RequestsRoute.tsx:284
formatDurationMs(row.ttft)                                               RequestsRoute.tsx:292
```

## Terminal shape at 150 columns

```
Requests
Every model call omp made in the last 24 hours, newest first. Open a row
for its full payload.

  Requests      500          ← 6 tiles, min 160px → 5 + 1 at 942px
  Failed        6
  Tokens        102M
  API-equivalent cost  $0.23
  Median duration  4.4s
  Median TTFT      2.5s       ← no foot

─ Request log ───────── 500 of the latest 500 requests ── [search] [ALL|OK|FAILED|ABORTED]
  Model       When      Project  Input  Cache read  Output  Cost    Duration  TTFT  Status
  muse-spark… 2m ago   omp-sta…  18K    944K        5.5K   $0.0021  12.4s     2.1s   ● ok
  …                                                           ← 100 rows, then
  ────────────────────────────────────────────────────────────      100 of 100 · Show more
  Showing the latest 500 requests, back to Sep 28, 14:03.      [Load more]
```

- **One blank line between the stat row and the single card** (`.page` gap, `20px`).
- The card is `flush`, so the table has **no indent** under the card title.
- The footer is **prose left, action right**, both 12.5px in `ink-3`.
