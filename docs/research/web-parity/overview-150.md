# Overview — 150 columns (1200px viewport)

**Web route:** `routes/OverviewRoute.tsx`
**IR citation:** `src/layout/spec.ts:346-351` — `lines: "63-276"`
**Capture:** `screens/overview-150.png` — live, `http://127.0.0.1:3847/#/overview?range=24h`, 1200px viewport, dark
theme, `fullPage: true`. Page height **1746px**.
**Hash routing, no basename.** `App.tsx` uses `useHashRoute` (`App.tsx:30`, `data/useHashRoute.ts:13-25`); the URL
form is `#/<section>?range=<range>` where `<range> ∈ {1h, 24h, 7d, 30d, 90d, all}` (`data/range.ts:37`). There is no
react-router and no basename — the server serves one `index.html` at `/`.

**Layout state at 1200px:** above both the 1360px and 1100px breakpoints, so `--sidebar-w = 204px`,
`--gutter = 22px`, and `.grid-main-side` is a real **2fr : 1fr** two-column split.

---

## Page header

```
header.page-header
  div
    h1.page-title   "Overview"                                    OverviewRoute.tsx:98
    p.page-description "Everything omp did across your sessions in the last 24 hours."
  (no .page-actions — this route passes none)
```

Description is a template literal over `meta.windowLabel` (`data/range.ts:25-32`): `24h` → `"the last 24 hours"`.

**This is the only Overview card row with no right-hand control.** Compare Costs, Tools, Providers and Gain, which
all pass `actions`.

## Top-level order

| # | Element | Wrapper | `file:line` |
|---|---|---|---|
| 1 | `PageHeader` | — | `OverviewRoute.tsx:98` |
| 2 | **StatGrid A** — 5 `md` tiles, `min={190}` | `div.stack[gap:16]` inside `QueryView` | `OverviewRoute.tsx:103-142` |
| 3 | **StatGrid B** — 8 `sm` tiles, `min={140}` | same `div.stack[gap:16]` | `OverviewRoute.tsx:143-156` |
| 4 | **`div.grid .grid-main-side`** — Activity (2fr) + Token mix (1fr) | — | `OverviewRoute.tsx:161-246` |
| 5 | **Card** "Latest requests" — `flush` | full width | `OverviewRoute.tsx:248-274` |

StatGrid A and B live inside **one** `div.stack` with `gap: 16px` (`OverviewRoute.tsx:102`), and that whole stack is
a direct child of `.page`, so the gap between the stat block and the grid of cards below is the `.page` gap of **20px**
— **not** 16px. Do not flatten that distinction.

## StatGrid A — `--stat-min: 190px`, 5 tiles, `size="md"`

Cited `OverviewRoute.tsx:103-142`. At a 942px content column this resolves to **4 columns** (measured:
`235px 235px 235px 235px`), so tile 5 wraps. Values shown are from the live capture at `range=24h`.

| Tile | label | value call | hint | spark | `file:line` |
|---|---|---|---|---|---|
| 1 | `API-equivalent cost` | `formatEstimatedCost(overall.totalCost, overall.unpricedRequests)` | `${formatInteger(overall.unpricedRequests)} unpriced` (only if > 0) | `series.cost`, `sparkColor="var(--chart-secondary)"` | `:104-115` |
| 2 | `Requests` | `formatInteger(overall.totalRequests)` | `` `${formatInteger(overall.failedRequests)} failed` `` (always) | `series.all` | `:116-121` |
| 3 | `Conversation tokens` | `formatCompact(sumConversationTokens(overall))` | `` `${formatCompact(overall.totalOutputTokens)} output` `` | `series.tokens` | `:122-128` |
| 4 | `Cache rate` | `formatPercent(overall.cacheRate)` | `` `${formatPercent(overall.cacheSavings)} saved` `` | **none** | `:129-134` |
| 5 | `Error rate` | `formatErrorRate(overall.errorRate)` | `` `${formatInteger(overall.successfulRequests)} succeeded` `` | `series.errors`, `sparkColor="var(--bad)"` | `:135-141` |

**`formatCompact` vs `formatInteger` in StatGrid A — this is the easy thing to get wrong:**

- **Compact** (`formatCompact` = `toLocaleString("en-US", {notation:"compact"})`, `formatters.ts:15-17`): tile 3's
  *value*, and tile 3's *hint*. Compact is used **only when the figure is a token count that can reach 7+ digits.**
- **Integer** (full `1,234,567`, `formatters.ts:11-13`): tile 1's hint, tile 2's value and hint, tile 5's hint.
- **Neither**: tile 1's value (a cost → `formatEstimatedCost`), tile 4 (percents), tile 5's value (`formatErrorRate`).

**Exact formatter calls, verbatim:**
- `formatEstimatedCost(overall.totalCost, overall.unpricedRequests)` — `OverviewRoute.tsx:107`
- `formatCompact(sumConversationTokens(overall))` — `:125`
- `formatPercent(overall.cacheRate)` — `:132`
- `formatErrorRate(overall.errorRate)` — `:137`

**Spark colour is semantic, not decorative:**
- tile 1 = `var(--chart-secondary)` (pink) because it is **cost** (`:114`)
- tile 2 = default `var(--chart-primary)` (cyan) — plain requests (`:120`)
- tile 3 = default cyan (`:127`)
- tile 5 = `var(--bad)` (red) because it is **errors** (`:140`)

`sumConversationTokens(overall)` is **uncached input + cache reads + cache writes + output** — stated verbatim in the
tile's `title` at `:124`. The IR calls this `conversationTokens` (`spec.ts:331-337`) and its `op` is recorded as
`"sum"` of `totalInputTokens` `against` `totalCacheReadTokens`; the real implementation adds all four.

**No tile here has `emphasis`.** The web has no "primary tile" concept in `Stat` at all — `Stat.tsx:11-23` has no
`emphasis` prop, and no route passes one. The IR's `emphasis: "primary"` on tile 1 (`spec.ts:359`) is the terminal's
own concept with **no web counterpart**; do not look for one in the CSS.

## StatGrid B — `--stat-min: 140px`, 8 tiles, `size="sm"`

Cited `OverviewRoute.tsx:143-156`. At 942px, `minmax(140px, 1fr)` fits **6 columns** (6 × 140 = 840 ≤ 942; 7 × 140 =
980 > 942), so tiles 7–8 wrap to a second row. This row uses the **smallest `--stat-min` on the whole dashboard**
because it carries the most tiles.

| # | label | value call | `file:line` |
|---|---|---|---|
| 1 | `Uncached input` | `formatCompact(overall.totalInputTokens)` | `:144` |
| 2 | `Cache read` | `formatCompact(overall.totalCacheReadTokens)` | `:145` |
| 3 | `Cache write` | `formatCompact(overall.totalCacheWriteTokens)` | `:146` |
| 4 | `Output` | `formatCompact(overall.totalOutputTokens)` | `:147` |
| 5 | `Premium requests` | `formatInteger(Math.round(overall.totalPremiumRequests * 100) / 100)` | `:151` |
| 6 | `Tokens/s` | `formatTokensPerSecond(overall.avgTokensPerSecond)` | `:153` |
| 7 | `Avg latency` | `formatDurationMs(overall.avgDuration)` | `:154` |
| 8 | `Avg TTFT` | `formatDurationMs(overall.avgTtft)` | `:155` |

**Every tile in this row is `formatCompact` except #5, which is `formatInteger` on a value rounded to 2 decimals.**
Tiles 1–4 are the four token kinds that tile 3 of StatGrid A sums — so the A-row answers "how much in total" and the
B-row answers "of which kind", and the terminal must keep that split rather than merging them.

`formatTokensPerSecond` → `value.toFixed(1)` or `"-"` when null (`formatters.ts:81-84`).
`formatDurationMs` → `sec.toFixed(sec < 1 ? 2 : 1) + "s"`, `"-"` when null (`formatters.ts:66-71`).

**There is no `hint` on any tile in StatGrid B**, so no tile renders a `.stat-foot`. Because `.stat-foot` has
`min-height: 18px` **only when it exists** (`styles.css:873`, and `Stat.tsx:37` gates the render), the B-row tiles are
**shorter than the A-row tiles** in the web. Terminal: the B-row is a **2-line tile** (label, value), not 3.

## Card 1 — "Activity" (2fr column of `grid-main-side`)

```
section.card.rise[--i=1]
  header.card-header
    div.card-titles
      h2.card-title        "Activity"                        :164
      p.card-description   "Per hour"                        :165
    div.card-actions
      div.segmented[data-size=sm]   Requests | Tokens | Cost  :166
  div.card-body[data-flush=false]
    div.chart[style height:260px] > svg
```

Description is computed: `meta.bucketMs < 3_600_000 ? "5 minutes" : meta.bucketMs < 86_400_000 ? "hour" : "day"`
(`:165`). At `24h` `bucketMs = HOUR_MS` (`range.ts:27`) so it reads **"Per hour"**.

`ACTIVITY_OPTIONS` = `Requests | Tokens | Cost` (`OverviewRoute.tsx:44-48`). Default state is `requests`
(`:67`).

**Series for the default `requests` mode** (`:86-94`):

| key | label | colour | values |
|---|---|---|---|
| `ok` | `Succeeded` | `var(--chart-primary)` (cyan) | `densify(points, buckets, p => p.requests - p.errors)` (`:78`) |
| `err` | `Failed` | `var(--bad)` (red) | `densify(points, buckets, p => p.errors)` (`:79`) |

The two other modes are **single-series**: `tokens` → `[{key:"tokens", color: var(--chart-primary)}]` (`:93`);
`cost` → `[{key:"cost", label:"API-equivalent", color: var(--chart-secondary)}]` (`:94`).

**Chart geometry:** `TimeChart` with `height={260}` (`:176`) → plot height `260 - 10 - 24 = 226px`;
`barW = min(56, slotW × 0.72)` (`Chart.tsx:125`); **stacked** (default `stacked = true`, `Chart.tsx:60`), so
"Succeeded" is the bottom band and "Failed" the thin red cap on top of it.

**There is NO legend on this card.** `OverviewRoute.tsx:169-179` renders only the `TimeChart`. This is deliberate and
it is a trap: the IR's legend band for Overview (`spec.ts:429-441`) lists seven items spanning *both* the Token-mix and
Activity regions, but the **Activity chart has none**. See the Overview 100/60/40 docs for how the IR's legend maps.

The `format` prop switches with the mode: `metric === "cost" ? v => formatEstimatedCost(v, 0) : formatCompact`
(`:176`).

## Card 2 — "Token mix" (1fr column)

```
section.card.rise[--i=2]                ← NO actions on this card
  header.card-header > h2.card-title "Token mix"          :182
                        > p.card-description "Where conversation tokens went"
  div.card-body
    div.stack[gap:18]
      div.stack[gap:10]                                   ← block 1
        div.share-bar[height:8px] > div.share-bar-seg ×3  :196
        div.legend > span.legend-item ×4                  :204
      div.stack[gap:10]                                   ← block 2
        div.section-label "By agent"                      :214
        div.share-bar[height:8px] > div.share-bar-seg ×2  :217
        div.row ×2   (per agent type)                     :225
```

`TOKEN_MIX` has **four** entries (`OverviewRoute.tsx:57-62`):

| key | label | colour | `file:line` |
|---|---|---|---|
| `input` | `Uncached input` | `#5b8cff` (blue) | `:58` |
| `cacheRead` | `Cache read` | `var(--chart-primary)` (cyan `#5ad8e6`) | `:59` |
| `cacheWrite` | `Cache write` | `#f5b54a` (amber) | `:60` |
| `output` | `Output` | `var(--chart-secondary)` (pink `#ed4abf`) | `:61` |

Only **3** segments rendered in the live capture at 24h because `cacheWrite` is `0` and `ShareBar.tsx:15` filters
`s.value > 0`. The legend still shows all **4** — the legend is not filtered.

Legend `value` is `total > 0 ? formatPercent(mix[t.key] / total, 0) : "–"` (`:209`) — **`formatPercent` with
`digits = 0`**, i.e. whole percents, because the legend sits at 11.5px mono and cannot carry a decimal.

**Block 2, "By agent"** (`OverviewRoute.tsx:213-240`) is the part most easily missed. `AGENT_COLOR`
(`:51-55`) is a **fixed 3-entry map, not the rank-assigned `SERIES_COLORS`**:

| agentType | label | colour |
|---|---|---|
| `main` | `Main agent` | `var(--chart-primary)` |
| `subagent` | `Subagents` | `var(--chart-secondary)` |
| `advisor` | `Advisor` | `#9d7bff` (violet) |

Each agent row is a `div.row` with `justify-content: space-between` (`:226`) and **two** inner `span.row`s:

- left: `swatch` + label + `<span className="dim num">{formatInteger(s.requests)} req</span>` (`:230`)
- right: `<span className="dim num">{formatCompact(s.tokens)}</span>` + `<span className="num" style={{minWidth:48, textAlign:"right"}}>{formatPercent(s.share)}</span>` (`:233-236`)

The `minWidth: 48` + `textAlign: right` on the percentage is a **column alignment hack** — it makes the percentages
line up regardless of the number of digits. A terminal should right-align that column to a fixed width.

## Card 3 — "Latest requests" (full width, `flush`)

```
section.card.rise[--i=3]
  header.card-header
    div.card-titles
      h2.card-title  <Dot tone="live" pulse/> "Latest requests"     :250-254
      p.card-description "Most recent model calls across every session" :255
    div.card-actions
      a.btn[data-size=sm] "All requests" > ArrowRight                :257
  div.card-body[data-flush=TRUE]
    div.table-wrap > table.table[data-dense=TRUE]
```

The title is a **fragment with a pulsing live dot before the text** (`:252`) — `<Dot tone="live" pulse />`. This is
the only card title in the whole dashboard that carries a status dot.

Columns — `REQUEST_COLUMNS`, `OverviewRoute.tsx:279-315`:

| # | key | header | align | render | cell | `file:line` |
|---|---|---|---|---|---|---|
| 1 | `model` | `Model` | left (default) | `LabelCell primary={row.model} secondary={row.provider}` | **LabelCell** | `:280-284` |
| 2 | `time` | `When` | left | `<span className="muted">{formatRelativeTime(row.timestamp)}</span>` | text | `:285-289` |
| 3 | `tokens` | `Tokens` | **right** | `<span className="num">{formatInteger(row.usage.totalTokens)}</span>` | text | `:290-295` |
| 4 | `cost` | `Cost` | **right** | `<span className="num">{formatMessageCost(row, 4)}</span>` | text | `:296-301` |
| 5 | `duration` | `Duration` | **right** | `<span className="num">{formatDurationMs(row.duration)}</span>` | text | `:302-307` |
| 6 | `status` | `Status` | **right** | `row.errorMessage ? <Badge tone="bad">Failed</Badge> : <Badge tone="ok">OK</Badge>` | **Badge** | `:308-314` |

**`formatCompact` vs `formatInteger` here — all `formatInteger`, no `formatCompact`.** `Tokens` uses
`formatInteger(row.usage.totalTokens)` (`:294`), *not* `formatCompact`. That is a real difference from the Requests
route's token columns, which use `formatCompact`. Preserve it.

**`formatMessageCost(row, 4)`** — the `4` forces 4 decimal places. It delegates to
`formatEstimatedCost(message.usage.cost.total, isUnpricedMessage(message) ? 1 : 0, digits)` (`formatters.ts:48-53`),
so a row with real tokens and an unknown price prints **`N/A`**, never `$0` (`formatters.ts:30`). This is the rule the
Errors screen's IR note is about (`spec.ts:1006`).

Table props: `rowKey={row => row.id ?? `${row.sessionFile}:${row.entryId}`}` (`:267`), `onRowClick` opens the
`RequestDrawer` (`:268`), **`dense`** (`:270`), **no `limit`** → no `.table-more` footer (contrast: Costs `limit={20}`,
Models `limit={25}`, Providers `limit={12}`, Errors `limit={12}`/`{50}`, Projects `TABLE_LIMIT`, Tools `limit={20}`,
Requests `limit={100}`). Data is capped upstream by the fetch: `getRecentRequests(12)` (`OverviewRoute.tsx:66`), and
the IR records that as `limit: 12` (`spec.ts:446`).

**`dense` = 6px top/bottom padding instead of 9px** (`styles.css:1352-1355`). Measured row height **51px**.

## Terminal shape at 150 columns

```
Overview                                                  ← 22px @ 600, the heaviest text on screen
Everything omp did across your sessions in the last 24 hours.   ← ink-2, one row, truncated if needed

  API-equivalent cost   $4.12      ▁▂▃▅▇▅▃    ← value 24px tabular; spark 28px pink
  Requests             3,977           ▁▂▄▆▅
  Conversation tokens  967M           ▁▁▂▄▆     ← formatCompact
  Cache rate           98.1%
  Error rate           1.4%           ▁▁▁▁      ← spark red

  Uncached input  18M   Cache read 944M   Cache write 0   Output 5.5M   …   ← 8 sm tiles, ONE row
  Premium requests 0   Tokens/s 69.9   Avg latency 14.0s   Avg TTFT 3.2s      ← NO foot line on any

┌─ Activity ─────────────────────── Per hour ────────────┐┌─ Token mix ──────────┐
│ Succeeded / Failed stacked, 260px                       ││ ████▓▒░ 8px share bar │
│                                                         ││ ▪ legend 4 items      │
│                                                         ││ By agent              │
│                                                         ││ ████▒  share bar      │
│                                                         ││ ● Main agent …        │
└─────────────────────────────────────────────────────────┘└───────────────────────┘

─ Latest requests ─────────── Most recent model calls across every session ─ [All requests]
  Model / When / Tokens / Cost / Duration / Status         ← 12px@500 ink-3 header, no indent
```

- `grid-main-side` is genuinely 2-up **only here**, at a **2:1** ratio (617px : 309px, 16px gap — measured).
- The stat block and the card grid are separated by the **`.page` gap of 20px**, i.e. **one blank line**.
- The Latest-requests card is `flush`, so its rows carry **no indent** while every other card body indents by 2.
