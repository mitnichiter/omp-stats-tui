# F15 — Portable logic in the stats web app: what to port, what to ignore

Audit date: 2026-10-03. omp 18.4.10, Bun 1.4.2, darwin-arm64.
Source: `/Users/yuzu/.bun/install/global/node_modules/@oh-my-pi/omp-stats/src/client/` (read-only).

# Angle

The panel is a **port** of the stats dashboard, not a new design. Before more view
code is written, separate the web app's logic into the half that is pure
arithmetic over numbers — which we can copy or import verbatim — and the half
that is React and SVG — which we cannot. This file is that separation.

The headline finding is uncomfortable and worth stating plainly: **we have
already reinvented several of these functions**, and one of them
(`src/data/ranges.ts`) duplicates a table the host already exports. See
§ Already reinvented.

# Summary

| Area | Portable logic | Verdict |
|---|---|---|
| `data/view-models.ts` (469 L) | 11 exported functions, all pure over plain data | **PORT** — the highest-value file in the client |
| `data/formatters.ts` (3.7 K) | 13 functions, all pure | **PORTED** in Task 4; 5 deliberately left |
| `data/range.ts` | `bucketAxis`, `formatBucket`, `formatTick`, `rangeMeta`, `TIME_RANGES` | **PORT** — we duplicated `RANGE_META` |
| `data/series.ts` | `densify`, `pivotSeries` — both pure | **PORT** — this is the downsampler Task 7 needs |
| `data/colors.ts` | `modelKey`, `buildColorLookup` | **PORT** `modelKey`; SKIP the colour lookups |
| `charts/Chart.tsx` | `niceScale` only | **PORT** `niceScale`; SKIP all SVG |
| `charts/{Sparkline,BarList,ShareBar}.tsx` | scaling arithmetic is inline in JSX | **PORT the arithmetic, rewrite the render** |

---

## view-models.ts

The file's own header states the contract: it is where "raw stats become display
shapes". Every exported function takes plain data and returns plain data. **There
is no React import in this file** — it is importable logic, which is exactly why
it is worth porting rather than reimplementing.

### Exported functions

| Function | Signature | What it does | Verdict |
|---|---|---|---|
| `sumConversationTokens` | `(ConversationTokenStats) => number` | `input + output + cacheRead + cacheWrite` | **PORT** — see the warning below |
| `buildAgentTokenShare` | `(AgentTypeStats[]) => AgentTokenShareView` | One segment per agent type present, fixed order, with token share | **PORT** |
| `buildCostSummary` | `(CostTimeSeriesPoint[]) => CostSummaryView` | Per-`model::provider` totals, component split, ranked models, `topModel` | **PORT** — this is a whole screen |
| `buildModelPerformanceLookup` | `(ModelPerformancePoint[]) => Map<string, ModelPerformanceDataPoint[]>` | Groups per model, sorts ascending by time, converts TTFT to seconds | **PORT** |
| `buildFolderRows` | `(FolderStats[]) => FolderTableView` | Totals + per-folder shares + temp-folder detection + max scales | **PORT** |
| `buildToolRows` | `(ToolUsageStats[]) => ToolRowView[]` | Error rate, call/token/cost fractions, avg result chars | **PORT** |
| `requestStatus` | `(Pick<MessageStats,"stopReason"\|"errorMessage">) => "ok"\|"aborted"\|"failed"` | Outcome of one request | **PORT** |
| `summarizeRequests` | `(MessageStats[]) => RequestLogSummary` | Totals + median/p95 latency + median TTFT + oldest/newest | **PORT** |
| `errorSignature` | `(string \| null) => string` | Normalises an error message into a group key | **PORT** — this is genuinely non-obvious logic |
| `groupErrorsBySignature` | `(MessageStats[]) => ErrorGroupView[]` | Groups failures, counts per model, sorts most-frequent-first | **PORT** |
| `quantile` | `(sorted, q) => number \| null` | Nearest-rank quantile — **not exported** | PORT the 2 lines if we need percentiles |

### The interesting lines

**Cache rate excludes writes — confirmed, and we must match it:**

```ts
// view-models.ts:282, inside buildFolderRows
cacheRate: input + cacheRead > 0 ? cacheRead / (input + cacheRead) : 0,
```

This is the identical rule to our `cacheShare` in `src/tui/format.ts`, including
the `> 0` guard against dividing by zero. **Our port is correct.** Note it
appears as an inline expression here rather than as a helper — the web app has
no single `cacheRate` function, which is why Task 4 had to write one.

**The ranking comparators, which are the most valuable lines in the file:**

```ts
// view-models.ts:184-186 — buildCostSummary
summary.models = [...byKey.values()].sort(
    (a, b) => b.cost - a.cost || b.requests - a.requests || a.key.localeCompare(b.key),
);
```

Rank by **cost first**, then requests, then key for stability. This is the same
cost-not-tokens rule the panel is bound by, expressed as a sort.

```ts
// view-models.ts:466-467 — per-model list inside an error group
.sort((a, b) => b.count - a.count || a.model.localeCompare(b.model))

// view-models.ts:468 — groups themselves
.sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen)
```

**`errorSignature` is the single most reusable non-obvious function here.** It
collapses whitespace, replaces UUIDs / prefixed ids / hex blobs / free-standing
numbers with placeholders, **keeps HTTP status codes**, and truncates:

```ts
// view-models.ts:407-414
const normalized = message
    .replace(/\s+/g, " ").trim()
    .replace(UUID_RE, "<id>")
    .replace(PREFIXED_ID_RE, "<id>")
    .replace(HEX_RE, "<hex>")
    .replace(NUMBER_RE, n => (HTTP_STATUS_RE.test(n) ? n : "N"));
return normalized.length > SIGNATURE_MAX ? `${normalized.slice(0, SIGNATURE_MAX - 1)}…` : normalized;
```

with the regexes at `:392-398`:

```ts
const SIGNATURE_MAX = 180;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const PREFIXED_ID_RE = /\b(?:req|msg|call|toolu|chatcmpl|resp|run|gen)[-_][A-Za-z0-9_-]{6,}/g;
const HEX_RE = /\b[0-9a-f]{12,}\b/gi;
/** Free-standing numbers; digits inside identifiers (`gpt-5.2`) are kept. */
const NUMBER_RE = /(?<![\w.-])\d+(?:\.\d+)?/g;
const HTTP_STATUS_RE = /^[1-5]\d\d$/;
```

Anyone grouping errors by hand would get most of this wrong, and the failures are
silent (near-duplicate groups, or over-collapsing). Copy these verbatim.

**The temp-folder test**, which encodes a real-world convention:

```ts
// view-models.ts:236
const TEMP_FOLDER_RE = /^\/?-?(?:private-)?(?:tmp|var-folders)(?:[-/]|$)/;
```

Folder names are session directories with separators flattened to `-`, so
`/tmp/x` arrives as `/tmp-x/`. Benchmarks and scratch sessions leave tens of
thousands of these; `ProjectsRoute` hides them by default.

**Zero-guards everywhere.** Every ratio in the file is written
`total > 0 ? value / total : 0` — never a bare division. Our formatters follow
the same convention.

### ⚠ One function to port with care

```ts
// view-models.ts:24-26
export function sumConversationTokens(stats: ConversationTokenStats): number {
    return stats.totalInputTokens + stats.totalOutputTokens + stats.totalCacheReadTokens + stats.totalCacheWriteTokens;
}
```

This is the one exported helper in the file that **our project's rules
deliberately forbid** as a *displayed figure*. The web app uses it for a
share-of-total denominator (`OverviewRoute.tsx:191-193`, the token-mix bar), which
is legitimate — a share bar needs a denominator. We may import it for that use,
but we must never render its return value as a headline token count. Our
`tokenCells` deliberately has no summing equivalent, and that asymmetry is
intentional, not an omission.

---

## formatters.ts

**Parity with our `src/tui/format.ts` is complete for everything that formats an
aggregate.** Verified by direct differential comparison across 24 cases
(`formatCost`, `formatCompact`, `formatPercent`, `formatElapsed`, and
`formatEstimatedCost`): byte-identical except for the one deliberate divergence
below.

| Host function | Ported? | Note |
|---|---|---|
| `formatInteger` | yes — `formatInteger` | identical |
| `formatCompact` | yes — `compactTokens` | renamed for intent, identical output |
| `formatCost` | yes — `formatCost` | identical, including the sub-cent 4-digit rule |
| `formatEstimatedCost` | **superseded** — `costWithUnpriced` | the only divergence; see below |
| `formatPercent` | yes — `formatPercent` | identical |
| `formatDurationMs` | yes — `formatDurationMs` | identical |
| `formatElapsed` | yes — `formatElapsed` | identical, 60s switch included |
| `isUnpricedMessage` | **SKIP** | per-**row** helper over `MessageStats`; see below |
| `formatMessageCost` | **SKIP** | same reason |
| `formatTokensPerSecond` | **SKIP** | one line, no correctness rule |
| `formatRelativeTime` | **PORT later** | needs `date-fns` `formatDistanceToNow` |
| `formatTimestamp` | **PORT later** | same, `date-fns` `format` |
| `formatFolder` | **PORT later** | pure, 1 line, needed by any folder screen |
| `formatBytes` | **SKIP** | the panel never shows a file size |

### The one deliberate divergence

Host `formatEstimatedCost(0, 12)` → `"N/A"`. Ours `costWithUnpriced(0, 12)` →
`"N/A · 12 unpriced"`.

The host attaches the count in the *component* (`OverviewRoute.tsx:117-121`:
`hint={overall.unpricedRequests > 0 ? \`${formatInteger(...)} unpriced\` : undefined}`),
which a terminal panel has nowhere to put. We fold it into the single string so
it cannot be separated from the figure by a caller. This is a **superset**: our
output contains the host's, plus the count. Where a host screen renders the hint
conditionally, ours renders it unconditionally whenever the count is non-zero.

### Why `isUnpricedMessage` is skipped, carefully

It is not dead — it is the **per-row** unpriced rule, and it is more precise than
the count we carry:

```ts
// formatters.ts (host)
export function isUnpricedMessage(message: Pick<MessageStats, "provider"|"usage"|"costUnpriced">): boolean {
    return message.usage.totalTokens > 0 && message.usage.cost.total === 0 &&
        (message.provider === "xai-oauth" || message.costUnpriced === true);
}
```

It distinguishes "priced, and genuinely zero" from "could not be priced" by
checking the provider and the ingest-set `costUnpriced` flag. **If we ever render
a per-request row, we must port this** — a row-level `$0.00` is exactly where
Review Focus line 1 bites. Aggregate screens already carry `unpricedRequests`
from the API and are safe. Do not port it speculatively; do not forget it.

---

## charts/

### `Chart.tsx` (388 L) — the big SVG chart

**Portable:** one function.

```ts
// Chart.tsx:354-364
/** Round an axis maximum up to 1/2/2.5/5 × 10ⁿ and return evenly spaced ticks from 0. */
export function niceScale(max: number): { max: number; ticks: number[] } {
    if (!(max > 0)) return { max: 1, ticks: [0] };
    const rough = max / Y_TICKS;                              // Y_TICKS = 4
    const magnitude = 10 ** Math.floor(Math.log10(rough));
    const step = [1, 2, 2.5, 5, 10].map(m => m * magnitude).find(s => s >= rough) ?? 10 * magnitude;
    const top = Math.ceil(max / step) * step;
    const ticks: number[] = [];
    for (let t = 0; t <= top + step / 2; t += step) ticks.push(Number(t.toPrecision(12)));
    return { max: top, ticks };
}
```

Pure, 11 lines, and it solves a real problem: without it a bar chart's axis says
"$0.00 / $7.31 / $14.62 / $21.93" and every reader does arithmetic. **Port it.**
Note it has a `!(max > 0)` guard rather than `max <= 0` — identical for finite
numbers, and it also catches `NaN`.

**Not portable:** everything else. `pathThrough` emits SVG path data
(`"M12.0,88.0L34.5,40.2"`), `cssId` mangles ids for CSS, and the remaining ~330
lines are layout math in pixels plus `useId`/`useMemo`/`useState` and a
mouse-driven tooltip system. There is no second portable function in the file.

### `Sparkline.tsx` (38 L)

No exported pure helper — the scaling is three inline expressions:

```ts
// Sparkline.tsx:18-21
const max = Math.max(0, ...values);
const step = n > 1 ? w / (n - 1) : 0;
const y = max > 0 ? height - 2 - (values[i] / max) * (height - 4) : height - 2;
```

**Portable:** the *shape* — max-scale from zero with a `> 0` guard, and a
degenerate-width case. The `+2`/`-4` inset is pixel padding; we substitute cell
insets. Note this scales from **zero**, unlike Task 8's planned sparkline, which
the plan says should use the **minimum** as its baseline. The plan's choice is
correct for a bar-like trend in a table cell; keep the difference explicit.

**Not portable:** the `<svg>`/`<path>` output and the `useWidth` ResizeObserver.

### `BarList.tsx` (49 L)

**Portable — the scaling rule, in one line:**

```ts
// BarList.tsx:25-26
const top = max ?? Math.max(0, ...items.map(i => i.value));
const pct = top > 0 ? Math.max(0.5, (item.value / top) * 100) : 0;
```

Two decisions worth copying: the caller may **override the scale maximum** (so a
list does not rescale while filtered — `ProjectsRoute.tsx:76` uses exactly this:
"Meter scales follow the whole range so a bar's length does not change while
filtering"), and **a non-zero value never renders as zero width** (`Math.max(0.5, …)`
floor). That floor is the bar-list analogue of Task 7's zero-cell decision.

**Not portable:** `ReactNode` labels, the `<button>` wrapper, CSS class names.

### `ShareBar.tsx` (26 L)

**Portable:** the normalisation, including dropping zero segments:

```ts
// ShareBar.tsx:18
const total = segments.reduce((sum, s) => sum + Math.max(0, s.value), 0);
// …then .filter(s => s.value > 0) before rendering
```

**Not portable:** `flexGrow` styling and CSS colours.

### `types.ts`, `useWidth.ts`, `TimeChart.tsx`, `Legend.tsx`, `index.ts`

- `types.ts` — `ChartSeries` / `ChartKind` / `ReferenceLine` interfaces. Portable
  *shape*, but it carries `color: string` and `pattern: "hatch"`, which our
  callback-based colouring replaces. Low value.
- `useWidth.ts` — React `ResizeObserver`. **SKIP entirely**; we are handed a width.
- `TimeChart.tsx` — a 20-line wrapper binding `Chart` to `formatTick`. Its real
  content is the two formatters it imports, which live in `data/range.ts`.
- `Legend.tsx` — pure rendering. **SKIP.**

---

## data/range.ts, data/series.ts, data/colors.ts

Not part of `charts/` but higher-value than anything in it.

### `bucketAxis` — portable, and we need it

```ts
// range.ts:63-83 (abridged)
export function bucketAxis(range, dataTimestamps, bucketMs = RANGE_META[range].bucketMs, now = Date.now()): number[] {
    const last = Math.floor(now / bucketMs) * bucketMs;
    // …span === null (all time) starts at the earliest data point…
    first = Math.max(first, last - (MAX_BUCKETS - 1) * bucketMs);   // MAX_BUCKETS = 1500
    const buckets: number[] = [];
    for (let t = first; t <= last; t += bucketMs) buckets.push(t);
    return buckets;
}
```

Pure and directly reusable (its only impure input, `now`, is already a parameter
with a default — testable by passing it). Two behaviours matter: gaps between
sessions **render as zeros** rather than being skipped, and the axis is capped so
a stray epoch-zero timestamp cannot explode it into decades of empty days.

### `densify` — portable, and this is Task 7's downsampler

```ts
// series.ts:10-22
export function densify<P extends { timestamp: number }>(
    points: readonly P[], buckets: readonly number[], value: (point: P) => number,
): number[] {
    const index = bucketIndex(buckets);
    const out = Array.from({ length: buckets.length }, () => 0);
    for (const point of points) {
        const i = index.get(point.timestamp);
        if (i !== undefined) out[i] += value(point);       // SUM, and off-axis points dropped
    }
    return out;
}
```

Pure, generic, 8 lines. **Port it.** It solves the same problem as our planned
`bucketToWidth` — many buckets into few columns — by summing, and it is the web
app's own answer, tested against its own data.

### `pivotSeries` — portable, high value for the stacked screens

Pure, generic over `P`, and implements the whole **top-N + Other** policy:

```ts
// series.ts:59-77
const ranked = [...byKey.entries()]
    .map(([key, values]) => ({ key, values, total: values.reduce((s, v) => s + v, 0) }))
    .filter(entry => entry.total !== 0)                                  // drop empty series
    .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));    // rank by total
const limit = opts.limit ?? Number.POSITIVE_INFINITY;
const head = ranked.slice(0, limit);
const tail = ranked.slice(limit);
// …tail is summed into a "__other__" series labelled `Other (${tail.length})`
```

**Port it.** The rank-by-total-then-key comparator, the zero-drop, and the
`Other (n)` label are three decisions we would otherwise invent three different
ways across three screens.

### `colors.ts`

- `modelKey(model, provider)` → `` `${model}::${provider}` ``. **PORT.** It is the
  identity key used by `buildCostSummary`, `pivotSeries`, `groupErrorsBySignature`
  and every colour lookup; if we invent our own separator we cannot join those
  views together.
- `buildColorLookup` / `buildModelColorLookup` / `SERIES_COLORS`. **SKIP the
  colours, PORT the ranking** — the comparator
  `b.weight - a.weight || a.key.localeCompare(a.key)` means a colour is assigned
  by *rank*, not response order, which we still need when colour is unavailable
  and we must fall back to ordering.

---

## screens/

How each of the 11 routes derives its rows. **All of these files are React; what
follows is the logic extracted from them, which is what we would port.**

### OverviewRoute (314 L) — our Task 13 screen

- Fetches `getOverviewStats(range)` + `getRecentRequests(12)`.
- Row derivation: **`densify` over a `bucketAxis`** — four separate dense series
  (`requests - errors`, `errors`, `tokens`, `cost`). Nothing is computed inline
  beyond `p.requests - p.errors`.
- Sorting: **none.** The activity chart is time-ordered by construction.
- Top-N: **none** for the chart. The recent-requests table takes `12`, a constant.
- Inline math: the token-mix legend computes `mix[t.key] / total` inline, and the
  per-agent rows use `buildAgentTokenShare`'s precomputed `share`.
- Empty state: `isEmpty` is not used; the stat grid renders zeroes.
- **Cost framing confirmed:** the Activity chart has a `metric` switch whose
  options are `requests | tokens | cost`, and when `cost` is selected it formats
  with `formatEstimatedCost(v, 0)`. Cost is a first-class, selectable metric.

### ModelsRoute (576 L) — our Task 9 screen

- Fetches the model dashboard; derives via `buildModelsView` (`:238-295`).
- Sorting: `pivotSeries`'s rank-by-total. `buildModelColorLookup(models)` ranks by
  `totalRequests`.
- Top-N: **`SHARE_LIMIT = 6`** (`:59`) — top 6 models per bucket, remainder
  folded into `Other`. Separately, `MAX_ROWS` governs the table (check at render).
- Derived vs read: reads `byModel`, `modelSeries`, `modelPerformanceSeries`;
  derives `requestTotals`, `countSeries`, `shareSeries` (each bucket's share
  `v / requestTotals[i]`), `trends`, and `providerCount` via `new Set(...)`.
- Notable: **`values: s.values.map(v => v || null)`** — zero slots become *gaps*
  so tooltips list only models active in that bucket. Worth keeping in the
  terminal: an empty column and a zero are different facts.
- Empty state: `"No model usage in this range"` / `"No performance samples"`.

### CostsRoute (424 L) — our Task 11 screen

- `buildCostSummary(points)` does essentially all the derivation (`:196`).
- Sorting: cost desc → requests desc → key (`view-models.ts:184-186`).
- Top-N: **`MODEL_LIMIT = 6`** (`:43`) fed to `pivotSeries`.
- Derived vs read: reads `costSeries`; derives everything else.
- Empty state: `"No usage in this range"` / `"No priced usage in this range"`.

### ProjectsRoute (319 L)

- `buildFolderRows(folders)` (`:52`) then three memos over `view.rows`:
  hide-temporary → search-filter → **top-N**.
- Sorting (`:63-64`), quoted verbatim:
  ```tsx
  cost:     [...scoped].sort((a, b) => b.totalCost - a.totalCost).slice(0, TOP_LIMIT),
  requests: [...scoped].sort((a, b) => b.totalRequests - a.totalRequests).slice(0, TOP_LIMIT),
  ```
  **`TOP_LIMIT = 8`** (`:42`), **`TABLE_LIMIT = 100`** (`:41`).
- Scale stability is deliberate: `folderColumns(view.maxRequests, view.maxCost)`
  uses range-wide maxima "so a bar's length does not change while filtering".
- Empty state: `"No project folders in this range"` /
  `"Only temporary folders in this range"` — the second is a **distinct** state
  and worth porting as such.

### ToolsRoute (572 L)

- `buildToolRows(byTool).sort((a, b) => b.calls - a.calls)` (`:272`).
- Colours from `buildColorLookup(byTool.map(t => ({ key: t.tool, weight: t.calls })))`
  (`:273`) — rank by **call count**.
- Derived: `errorRate`, `callFraction`, `tokenFraction`, `costFraction`,
  `avgResultChars`.
- No slice — the table is virtualised/paged rather than truncated.
- Empty states: `"No tool calls in this range"`, `"No tool errors in this range"`.

### ProvidersRoute (1050 L)

- The largest route; mostly windowed-utilisation display, which needs network
  data this panel must not fetch (`getProviderWindowStats` is on the forbidden
  list).
- One notable comparator (`:789-793`), which sorts the selected window first:
  ```ts
  .sort((a, b) =>
      Number(b.color !== null) - Number(a.color !== null) ||
      a.series.windowLabel.localeCompare(b.series.windowLabel) ||
      (b.latest?.fraction ?? -1) - (a.latest?.fraction ?? -1))
  ```
- Ranking is by **latest utilization fraction**, i.e. most-pressed window first.

### RequestsRoute (311 L)

- Fetches `getRecentRequests(limit)` with `LOAD_STEPS = [500, 2_000, 10_000]`
  (`:42`) — **the limit is the fetched count, not a display slice.**
- Client-side range filter (`:54-55`): `rows.filter(row => row.timestamp >= cutoff)`.
- Summaries via `summarizeRequests(inRange)` (`:65`); counts by `requestStatus`.
- **No sorting** — rows are already newest-first from the API.
- Empty state: `` `No requests in ${meta.windowLabel}` ``.

### ErrorsRoute (421 L)

- `groupErrorsBySignature(errors.data)` (`:55`) does the grouping and ranking;
  the route then rebuilds a per-model list (`:58-65`) with
  `.sort((a, b) => b.count - a.count || a.model.localeCompare(a.model))`.
- Top-N: **`view.models.slice(0, 12)`** (`:211`) — the only route with a small
  display slice on a derived list.
- Load steps `[50, 200, 1_000]` (`:40`).
- Empty states: `` `No failures in ${meta.windowLabel}` ``, `"No failures match"`.

### GainRoute (229 L)

- Derives source shares inline (`:64`): `total > 0 ? savedTokens / total : 0`.
- Cumulative series is computed from the daily series — worth reading before
  porting; not needed for the first batch of screens.
- Empty: `` `No savings recorded${scope} in ${meta.windowLabel}` ``.

### FrustrationRoute (924 L) and TracesRoute (208 L)

- **No portable row-derivation.** Frustration is judge-job state (regex
  estimates vs verdicts) and traces is a wheel-zoomed flamegraph — both are
  `excluded` in our plan for the same reason. Their only reusable bit is
  `[...new Set(models.map(familyKey))].sort()` (`:507`).

### The three policy constants, collected

| Constant | Value | File | What it bounds |
|---|---|---|---|
| `SHARE_LIMIT` | 6 | ModelsRoute:59 | models per stacked bucket, rest → Other |
| `MODEL_LIMIT` | 6 | CostsRoute:43 | models per cost bucket, rest → Other |
| `TOP_LIMIT` | 8 | ProjectsRoute:42 | top folders in each of 2 charts |
| `TABLE_LIMIT` | 100 | ProjectsRoute:41 | rows before "Show all" |
| models slice | 12 | ErrorsRoute:211 | affected models per error group |
| `LOAD_STEPS` | 500/2k/10k | RequestsRoute:42 | requests fetched, not displayed |

---

## Recommended ports

Ordered by value. The first three are pure, already exist, and each replaces
something a later screen task would otherwise have to invent.

1. **`modelKey(model, provider)`** (`data/colors.ts:20`). The join key for every
   per-model view. Cheap, and every per-model screen depends on it.
2. **`densify`** (`data/series.ts:10`). The bucket→column downsampler. **Revises
   Task 7**: our planned `bucketToWidth` is a near-duplicate, and `densify` is the
   web app's tested version with a cleaner contract (sum, off-axis points dropped).
   Adopt it; keep `bucketToWidth` only if a width-driven variant is still needed.
3. **`buildCostSummary`** (`view-models.ts:143`). An entire screen's derivation in
   48 pure lines, including the cost-first ranking comparator and the
   `topModel > 0` guard. Replaces hand-rolled cost aggregation in Task 11.
4. **`pivotSeries`** (`data/series.ts:41`). The top-N + Other policy, ranked by
   total then key, with empty series dropped.
5. **`errorSignature`** (`view-models.ts:405`) + **`groupErrorsBySignature`**
   (`:435`). Error grouping that is very easy to get subtly wrong.
6. **`niceScale`** (`Chart.tsx:355`). Readable axis ticks.
7. **`bucketAxis`** (`data/range.ts:64`) and **`rangeMeta`** (`:35`). The axis,
   and the range→bucket-size table.
8. **`summarizeRequests`** / **`requestStatus`** / **`quantile`**. The Requests
   screen, including the nearest-rank percentile definition.
9. **`buildToolRows`**, **`buildFolderRows`**, **`buildAgentTokenShare`**,
   **`buildModelPerformanceLookup`**. One each for the Tools, Projects, Overview
   and Models screens respectively.
10. **`BarList`'s scale-max override and 0.5% floor** (`BarList.tsx:25-26`). Two
    lines of policy to carry into our Task 8 bar list.
11. **`isUnpricedMessage`** (`formatters.ts`). Only when a per-request row is
    rendered — see the warning in § formatters.ts.

### Can we import rather than copy? **Yes — measured, not assumed.**

I expected this to fail on the F9 reasoning (the bare specifier
`@oh-my-pi/omp-stats` is not on the host's allowlist) and it does not. Deep
subpaths **resolve and execute**, because the `exports` map declares `"./*"` and
Task 1's `bun install` materialised the real package including its
`pi-natives-darwin-arm64` sibling — which is precisely the condition F9 said was
required. Measured in this project:

```
OK  @oh-my-pi/omp-stats/client/data/view-models
      -> buildAgentTokenShare, buildCostSummary, buildFolderRows,
         buildModelPerformanceLookup, buildToolRows, errorSignature,
         groupErrorsBySignature, requestStatus, sumConversationTokens,
         summarizeRequests
OK  @oh-my-pi/omp-stats/client/data/series -> densify, pivotSeries
OK  @oh-my-pi/omp-stats/client/data/range   -> TIME_RANGES, bucketAxis,
                                               formatBucket, formatTick, rangeMeta
```

And they **behave**, which matters more than resolving. Live check:

```
pivotSeries([{timestamp:0,k:"a",v:1},{timestamp:0,k:"b",v:5}], {buckets:[0,1], key:p=>p.k, value:p=>p.v, limit:1})
  -> [{key:"b",values:[5,0]}, {key:"__other__",values:[1,0], label:"Other (1)"}]
```

Ranked by total, limit honoured, tail folded into `Other (1)` — exactly as
documented. **10 ms** to import all three, and no React is pulled in: the whole
`client/data/` layer has **zero** `react` imports (verified by grep over
`view-models.ts`, `series.ts`, `range.ts`, `colors.ts`).

**The one that fails is the one we cannot use anyway:**

```
FAIL @oh-my-pi/omp-stats/client/charts/Chart
  -> ResolveMessage: Cannot find package '@oh-my-pi/omp-stats'
```

`charts/Chart.tsx` imports `react` directly (`:9`), and react is not resolvable
from this project — correctly, since a terminal panel must not carry React. So
the split is clean and it is the split we wanted:

| Layer | Imports? | Use it for |
|---|---|---|
| `client/data/*` | **Yes — measured working** | items 1–11 below |
| `client/charts/*` | No (needs `react`) | port the arithmetic only |

**Revised guidance: IMPORT the `client/data/` modules; PORT only
`niceScale` and the inline chart arithmetic.** This is better than copying —
the panel and the dashboard then cannot drift, which is the whole point of a
port. Two caveats:

1. `series.ts` imports `SERIES_COLORS` from `./colors`, so importing it drags in
   hex colour constants we will not use. Harmless (they are plain strings, no
   React), but `pivotSeries` will assign us hues we discard.
2. The extension loader resolves **static** imports only, so these must be
   static `import` statements — never `await import()` (F9).
3. `sumConversationTokens` still must not become a display figure. See § view-models.

---

## Already reinvented

Blunt section, as asked. Everything here is real duplication in code we wrote.

### 1. `src/data/ranges.ts` duplicates `RANGE_META` — **replace**

Ours declares:

```ts
export const NATURAL_BUCKETS: Record<Range, number> = {
    "1h": 12, "24h": 24, "7d": 7, "30d": 30, "90d": 90, all: 53,
};
```

The host declares the same table with the same values, plus the bucket **size**
and the prose window label we lack:

```ts
// range.ts:29-36
const RANGE_META: Record<TimeRange, RangeMeta> = {
    "1h":  { label: "1h", windowLabel: "the last hour", spanMs: HOUR_MS,      bucketMs: 5 * MINUTE_MS },
    "24h": { label: "24h", windowLabel: "the last 24 hours", spanMs: DAY_MS, bucketMs: HOUR_MS },
    "7d":  { label: "7d", windowLabel: "the last 7 days",  spanMs: 7 * DAY_MS, bucketMs: DAY_MS },
    "30d": { label: "30d", windowLabel: "the last 30 days", spanMs: 30 * DAY_MS, bucketMs: DAY_MS },
    "90d": { label: "90d", windowLabel: "the last 90 days", spanMs: 90 * DAY_MS, bucketMs: DAY_MS },
    all:  { label: "All", windowLabel: "all time", spanMs: null, bucketMs: DAY_MS },
};
```

Two problems with ours. First, `all: 53` is **our invention** — the host's `all`
range is daily buckets (`DAY_MS`), not weeks; 53 is a calendar-heatmap width we
chose. That is defensible but it is not "the range's natural bucket count", and
the doc comment claims it is. Second, we hand-maintained a table the host already
owns, which is precisely how the two drift.

**Fix is now cheap, because `rangeMeta` imports cleanly** (measured — see §
Recommended ports): replace the table with a `rangeMeta(range).bucketMs` lookup.
Note what that changes: `24h` really is 24 buckets and `7d` really is 7, which
our table already had right; only `all` (53 vs. the host's daily buckets) and the
added `bucketMs`/`windowLabel` values are affected.

`isRange`, `nextRange`, `RANGES` and `DEFAULT_RANGE` are **not** duplication —
the host exports `TIME_RANGES` but no guard or cycling helper, and our closed-set
validation is the whole point of that module. Keep those; replace the table.

### 2. `scripts/lib/timing.ts` `bucketLabel` duplicates `rangeMeta().bucketMs` — **merge**

`BUCKET_LABELS` in `scripts/lib/timing.ts:58-64` re-encodes minute/hour/day
thresholds that the host expresses once as `bucketMs`. Purely a probe script, so
low stakes, but the threshold list should come from `rangeMeta`.

### 3. Task 7's planned `bucketToWidth` duplicates `densify` — **replace**

This is the one that costs us if we ignore it. The plan invents a width-driven
downsampler; the web app already has a bucket-driven one, tested against real
data, that **sums** and **drops off-axis points**. Our version is not wrong, but
it is a second implementation of a solved problem.

### 4. `src/tui/format.ts` — **no duplication found; one superset**

Checked every export against the host. All are ports with attribution, except
`costWithUnpriced`, which is a deliberate superset. Nothing to change.

### 5. `src/tui/glyphs.ts` — **no duplication; no equivalent exists**

The host registry has 269 keys and **zero** data-ink ramps (ADR 0005, F10). There
was nothing to port. Worth stating explicitly because it is the one module where
"why didn't you just reuse it?" has a measured answer.

### 6. `src/tui/layout.ts` and `src/tui/icons.ts` — **no duplication found**

`layout.ts` has no web equivalent (the dashboard has CSS breakpoints, not a
narrow-terminal degradation plan). `icons.ts` reuses host symbol keys by design.

---

## Gaps and risks

1. **`getProviderWindowStats` is on our forbidden list** but is the backbone of
   `ProvidersRoute`. We can port that route's *presentation* logic (window
   ranking, latest/peak derivation) but will never have its data. Expect the
   providers scaffold to stay a placeholder.
2. **Frustration and Traces have no portable logic at all** — consistent with
   our plan excluding both.
3. **The `exports` map question is now RESOLVED — in our favour.** See §
   Recommended ports. `client/data/*` deep subpaths import and execute; only
   `client/charts/*` fails, and only because it needs `react`. Import, don't copy.
   The one thing to re-verify is under the **runtime extension loader**, not just
   under `bun run`: F9's failure mode was loader-specific, and a `bun test` pass
   is not evidence about the loader. Static imports only (F9).
4. **The web app has no `cacheRate` helper**, only the inline expression at
   `view-models.ts:282`. Our `cacheShare` is the better factoring and should stay.
5. **`sumConversationTokens` must not become a display figure** in our port —
   see the warning above. This is the one place where copying the web app's
   export would break a project rule.

---

## Searches

- `grep "export function" client/data/view-models.ts` → 11 exported builders
- `grep "sort(" client/routes/*.tsx` → the comparators quoted above
- `grep "slice(0" client/routes/*.tsx` → `SHARE_LIMIT` 6, `MODEL_LIMIT` 6,
  `TOP_LIMIT` 8, `TABLE_LIMIT` 100, models 12
- `grep "LIMIT" client/routes/*.tsx` → the six policy constants
- `grep "cacheRate" client/**` → only `view-models.ts:282`, inline
- `grep "^import" client/data/{view-models,series,range,colors}.ts` → confirmed
  **no `react` import anywhere in the data layer**; only `../types`, `./colors`,
  `./formatters`, `../charts/types` and `@oh-my-pi/pi-utils/dates`
- Runtime import of all three data subpaths → **OK, ~10 ms, zero React**;
  `pivotSeries` output matches its documented contract. `charts/Chart` → **FAIL**
  (needs `react`)

## Recommendation

Read this before each screen task (9, 11, 13–15) and before finishing Task 7.
Port the pure halves with a provenance comment, skip the rendering entirely, and
delete our `NATURAL_BUCKETS` in favour of the host's `RANGE_META`.
