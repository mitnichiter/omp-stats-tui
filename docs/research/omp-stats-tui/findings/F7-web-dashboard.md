# F7 — Web dashboard scope (omp-stats SPA)

Read-only investigation of `~/.bun/install/global/node_modules/@oh-my-pi/omp-stats/`.
No package file was modified.

## Angle

The web dashboard is a 11-screen React 19 SPA. This document measures exactly what each
screen shows, what API data it needs, what the chart primitives are, and how much of it is
realistically portable to a terminal. Bottom line: the chart *primitives* are small and mostly
portable; the *screens* are where the line count lives, and the Traces screen is not a
dashboard at all — it is a full DevTools-style flamegraph app.

## Route inventory

Router is not a library — it is a hash-route switch in
`src/client/App.tsx:31-70` (`useHashRoute()` from `src/client/data/useHashRoute.ts`, 64 lines),
plus a sidebar list in `src/client/app/nav.ts` (78 lines) that supplies ids, labels, lucide
icons and `g <key>` jump hotkeys. `App.tsx` keeps every visited page mounted-but-hidden so
revisits are instant; only the active page passes `enabled: active` to `useQuery`.

| # | path (`#/…`) | component file | lines | what the screen shows |
|---|---|---|---|---|
| 1 | `overview` | `src/client/routes/OverviewRoute.tsx` | 314 | Headline stat grid (requests, tokens, cost, errors), big time-series "Activity" chart with a cost/token segmented metric, two ShareBars (token mix by bucket, by agent type), recent-requests table |
| 2 | `models` | `src/client/routes/ModelsRoute.tsx` | 576 | Stat grid, stacked/100% TimeChart of request share per model (+ toggleable legend), per-model table with TTFT, error-rate badge, and a per-row Sparkline "trend" cell; a second dual-axis TimeChart of TTFT vs tokens/s per active model |
| 3 | `providers` | `src/client/routes/ProvidersRoute.tsx` | 1050 | Largest screen. Stat grid, per-provider table, token-mix ShareBar, TimeChart "burn" (4 metrics), 24-slot categorical Chart of tokens by local hour of day, subscription-window table, and a multi-line per-account utilization Chart with a 100% reference line |
| 4 | `costs` | `src/client/routes/CostsRoute.tsx` | 424 | Stat grid, stacked UTC-day Chart of cost split by model *or* by billing component (Segmented switch), ShareBar breakdown, per-model cost table with input/output/cache split |
| 5 | `requests` | `src/client/routes/RequestsRoute.tsx` | 311 | Request log: summary stat grid (ok/aborted/failed/tokens/cost/median/p95), searchable + status-filtered sortable table; row click opens the global `RequestDrawer` |
| 6 | `errors` | `src/client/routes/ErrorsRoute.tsx` | 421 | Stat grid, grouped-by-normalised-signature error table, a BarList of top error signatures, searchable full error table |
| 7 | `traces` | `src/client/routes/TracesRoute.tsx` | 208 | Session list (200 sessions, 30s poll) → opens `traces/TraceView.tsx`: flamegraph timeline, minimap, span drawer, transcript, aggregates |
| 8 | `tools` | `src/client/routes/ToolsRoute.tsx` | 572 | Stat grid, TimeChart of tool calls/tokens/cost per bucket (+ metric Segmented), big per-tool table with error rate, shares, avg result chars, and a per-row Sparkline |
| 9 | `frustration` | `src/client/routes/FrustrationRoute.tsx` | 924 | Largest route by feature count. Per-model-version frustration rates: a stacked 100% categorical Chart over model rows with hatch-patterned (regex-judged) series + an overlaid trend line, a per-model table, and a "classify with judge" Modal that spends money (`POST /api/frustration/judge`) with cancel |
| 10 | `projects` | `src/client/routes/ProjectsRoute.tsx` | 319 | Folder/project stat grid, two BarLists (top by cost, top by requests), full searchable per-folder table with `temp` badge, share meters, cache rate |
| 11 | `gain` | `src/client/routes/GainRoute.tsx` | 229 | Snapcompact token savings: stat grid, dual-axis Chart (daily saved bars + cumulative line, right axis), per-source table, project `<select>` |

Route `.tsx` total: **4,637 lines** (11 files).

### Shared widgets

`src/client/charts/` — 6 chart components + 3 helpers, **637 lines total** (`cat charts/* | wc -l`):

| file | lines | renders |
|---|---|---|
| `charts/Chart.tsx` | 388 | The one real engine. SVG: stacked/grouped bars, stacked areas, lines, left+right axes, reference lines, hatch `<pattern>` fills, hover cursor, floating tooltip, click-to-select, nice-rounded y scale, empty state |
| `charts/TimeChart.tsx` | 22 | Thin wrapper: `Chart` + a bucketed time axis, formats ticks/tooltips, optional bucket click |
| `charts/Sparkline.tsx` | 38 | Axis-free SVG polyline + optional area fill, fixed or container width |
| `charts/BarList.tsx` | 49 | Ranked rows with a proportional tinted fill behind each label |
| `charts/ShareBar.tsx` | 26 | One horizontal bar split proportionally among segments (flex-grow per segment) |
| `charts/Legend.tsx` | 61 | Swatch + label + optional value row; click-to-hide via `useHiddenSeries()` |
| `charts/types.ts` | 27 | `ChartSeries` / `ChartKind` (`bars|area|line`) / `ReferenceLine` |
| `charts/useWidth.ts` | 19 | ResizeObserver width hook |
| `charts/index.ts` | 7 | barrel |

`src/client/ui/` — **1,030 lines of `.tsx`**: `Table.tsx` 230 (sortable/filterable/limited column table with `MeterCell`), `RequestDrawer.tsx` 183, `Stat.tsx` 104 (+ `StatGrid`), `Drawer.tsx` 93, `States.tsx` 81 (skeletons/empty/error), `Card.tsx` 61, `Segmented.tsx` 61, `JsonBlock.tsx` 57, `Badge.tsx` 29, `SearchInput.tsx` 25.

`src/client/app/`: `Shell.tsx` 181 (sidebar + range picker + header), `LiveChip.tsx` 97, `ThemeToggle.tsx` 40.

## Screen → data requirement

Endpoints as named in `src/client/api.ts` (199 lines); the server dispatch table is
`src/server.ts:172-314` (538 lines total).

| screen | endpoint(s) | data needed |
|---|---|---|
| overview | `GET /api/stats/overview?range` + `GET /api/stats/recent?limit=12` | Overall totals, `byAgentType[]`, bucketed activity series (`bucketMs`, buckets, values), recent request rows for the table |
| models | `GET /api/stats/model-dashboard?range` | Per-model rows (requests, tokens, cost, avgTtft, error rate, unpriced), per-bucket request counts, per-bucket share fractions (for the 100% mode), `ModelPerformancePoint[]` for TTFT/tok-s |
| providers | `GET /api/stats/providers?range` + `GET /api/stats/provider-windows?range[&provider]` (two calls: all-providers, then selected provider) | Per-provider totals + hourly/bucketed series; per-account `UsageWindowSeries` with `usedFraction`, `exhausted`, window keys/labels |
| costs | `GET /api/stats/costs?range` | `CostTimeSeriesPoint[]` (per day, per model, cost split into input/output/cacheRead/cacheWrite, requests, unpricedRequests), from which totals/shares/activeDays are derived client-side by `data/view-models.ts` |
| requests | `GET /api/stats/recent?limit` | `MessageStats[]`: timestamp, model, provider, project, status/stopReason, errorMessage, usage tokens, cost, duration, ttft |
| errors | `GET /api/stats/errors?range&limit` | Same `MessageStats[]` shape, filtered to failures; `errorSignature()` grouping is pure client-side |
| traces | `GET /api/sessions?limit&[q]`, then `GET /api/session/trace?file`, `GET /api/session/entry?file&id` | `SessionSummary[]`, then a full `SessionTrace` (tracks/spans/markers) and opaque per-span journal entries |
| tools | `GET /api/stats/tools?range` | `ToolUsageStats[]` (calls, errors, resultChars, `totalTokensShare`, `costShare`) + a per-bucket per-tool series |
| frustration | `GET /api/stats/frustration?range`, plus `GET /api/frustration/estimate?range`, `POST /api/frustration/judge`, `POST /api/frustration/cancel` | `FrustrationDashboardStats` (per model-version counts at several layers), job status, and a spend quote |
| projects | `GET /api/stats/folders?range` | `FolderStats[]` (requests, failed, cost, unpriced, 4 token buckets) — `buildFolderRows()` derives shares + `temp` detection client-side |
| gain | `GET /api/stats/gain?range[&project]` | `GainDashboardStats`: overall totals + a UTC-day time series + per-source rows |

Global: `POST /api/sync` and the `GET /api/events` SSE stream (`data/live.tsx:52`,
`EventSource("/api/events")`) drive a global "live data version" that makes every cached
query refetch (`data/query.ts`, 166 lines).

Note the division of labour: `src/client/data/view-models.ts` (469 lines) holds almost all
the aggregation logic — `buildCostSummary`, `buildFolderRows`, `buildToolRows`,
`summarizeRequests`, `groupErrorsBySignature`, `errorSignature`, `buildAgentTokenShare`,
`buildModelPerformanceLookup`. A TUI port can reuse this logic verbatim as plain TS; it is not
React-bound.

## Chart inventory

Every file in `charts/` read in full.

**1. `Chart.tsx` (388 lines) — the SVG engine.** Visualises an arbitrary set of series over
N categorical x-slots. Data shape: `ChartSeries[]` = `{key, label, color, values:(number|null)[],
kind?, axis?, pattern?, dashed?, tooltip?}` plus `slots`, `tickLabel(i)`, optional
`references[]`, `hidden` set. Kinds: **stacked bars**, **grouped bars**, **stacked areas**,
**lines** (dashed, with gap-breaking `null`), plus an independent **right axis**. Complexity:
the highest of the set — nice-rounded axis, per-slot stack bases, bar grouping, hatch SVG
patterns, hover cursor + floating tooltip + total row, click-to-select. It is ~200 lines of
layout maths plus ~150 of JSX.

**2. `TimeChart.tsx` (22 lines) — `Chart` over a bucketed time axis.** Data: ascending bucket
starts + `bucketMs` + series. Same rendering complexity; it is a *wrapper*, not a new renderer.

**3. `Sparkline.tsx` (38 lines) — axis-free trend line.** Data: `values: number[]` (no nulls;
callers do `?? 0`). Renders an SVG polyline plus an optional area fill. Categorical
sparkline, fixed 96×22 or 80×20 in table cells. Trivial complexity.

**4. `BarList.tsx` (49 lines) — ranked horizontal bar list.** Data:
`{key, label, value, display?, color?}[]` + optional `max`. Renders each row as a percentage-
width tinted fill behind a label and value. Categorical bar list, trivial complexity.

**5. `ShareBar.tsx` (26 lines) — single proportional split bar.** Data:
`{key, label, value, color}[]`. `flexGrow: value/total` per segment; zero segments dropped.
Stacked-single-bar, trivial complexity.

**6. `Legend.tsx` (61 lines) — swatch/label/value rows with click-to-hide.** Not a chart; a
key + interactive series filter (`useHiddenSeries`). Trivial.

Per-screen chart usage (real call sites):
- overview: `TimeChart` (stacked bars) ×1, `ShareBar` ×2
- models: `TimeChart` ×2 (one stacked, one dual-axis line for TTFT/tok-s), `Sparkline` in a table cell, `Legend`
- providers: `TimeChart` ×1, `Chart` ×2 (24-slot hour-of-day stacked bars; multi-line utilization chart with a 100% reference line), `ShareBar` ×1
- costs: `Chart` ×1 (stacked bars, model-vs-component switch), `ShareBar` ×1, `Legend`
- requests: none (table + stats only)
- errors: `BarList` ×1
- tools: `TimeChart` ×1, `Sparkline` in a table cell
- frustration: `Chart` ×1 (stacked 100% categorical bars over model rows, hatched regex series, overlaid trend line)
- projects: `BarList` ×2
- gain: `Chart` ×1 (daily bars + cumulative right-axis line)
- traces: `traces/TimelineCanvas.tsx` (751) + `traces/Minimap.tsx` (168) + `time-scale.ts` (250) — not in `charts/` but the heaviest visual code in the app

## Portability assessment

| chart | verdict | reason |
|---|---|---|
| `Sparkline` | **(a) trivial** | 38 lines; a row of `▁▂▃▄▅▆▇█` or braille dots is a direct substitute |
| `BarList` | **(a) trivial** | it is already a text row with a background fill — `█`-padding or a shaded block is exactly the same idea |
| `ShareBar` | **(a) trivial** | one proportional bar; `█`/`░` split by percentage |
| `Legend` | **(a) trivial** | becomes a key line, or a `[k]`-toggled filter row |
| `TimeChart` (stacked bars) | **(b) with effort** | stacked buckets over up to ~200 slots need real downsampling (bucket → column, N columns → width) plus a legend for N series; doable, but it is the single most reused primitive and deserves a proper `renderBarChart()` |
| `Chart` stacked/grouped bars | **(b) with effort** | same as TimeChart plus grouping and per-series hatch (hatch → a distinct block glyph or colour) |
| `Chart` dual axis (TTFT/tok-s, gain cumulative) | **(b) with effort** | two scales on one plot is awkward in cells; realistically split into two stacked sub-charts |
| `Chart` multi-line utilization (providers) | **(b) with effort, borders on (c)** | N overlapping lines with forward-hold across gaps and a 100% reference line; braille or colour-separated lines get unreadable past ~4 series. It is doable but is the weakest port |
| `Chart` stacked 100% over categorical rows (frustration) | **(b) with effort** | many sparse series (one per model-family × layer) each non-null in a few slots; the sparse-series trick is the hard part, not the bars |
| `TimelineCanvas` + `Minimap` (traces) | **(c) not really portable** | 751+168+250 lines built around cursor-anchored wheel zoom, drag pan, a draggable/resizable viewport brush, hover hit-testing and double-click-to-zoom. A terminal equivalent would be a fundamentally different, much simpler tool (or it stays web-only) |

No chart needs smooth gradients, so nothing is un-portable for *rendering* reasons. The
un-portable thing is **interaction**, not drawing (see Gaps).

## Already covered in TUI

Cross-checked `pi-tui/src/overlays/usage-dashboard.ts` (1,406 lines,
`UsageDashboardComponent`) and `pi-tui/src/apps/`. The detail view is supplied by
`renderUsageReports()` in `pi-coding-agent/src/modes/controllers/command-controller.ts:2144`
(within that 2,404-line file), wired in at `selector-controller.ts:371`.

**Covered today:**
- The **provider subscriptions grid** (`buildProviderCards`, `usage-dashboard.ts:152`;
  `#renderCardsGrid`, mini-bars `█`/`░` per quota window with ok/warn/exhausted colouring) —
  this is the Providers screen's subscription-window half, already done.
- A **GitHub-style daily activity heatmap** (`buildHeatmapLayout`, 53 weeks, truecolor ramp
  `#heatRamp()`, `#renderHeatmap`) fed from the local stats DB (`loadDailyActivity`).
- A **quota/limit detail text view** (`renderUsageReports`) — per-account per-window limit
  lists, active-account labelling, notes.
- Existing `/usage` key toggles between overview and detail (`#view === "detail"`), plus a
  refresh action.

**Not covered at all:**
1. Overview screen (activity time-series + token mix + agent split + recent requests) — no
   equivalent; the heatmap is the only time dimension present.
2. Models (incl. per-row trend sparklines, TTFT/tokens-per-second dual axis).
3. Costs (daily stacked cost, component split, per-model table).
4. Requests log (sortable table, median/p95, status filter, row drill-down).
5. Errors (signature grouping, BarList of top failures).
6. Traces (nothing — and see portability above).
7. Tools (per-tool table with shares/error rate/avg result chars).
8. Frustration (including the paid judge job — the TUI has no equivalent action).
9. Projects / folders table.
10. Gain (snapcompact savings).
11. Providers' *data* half: burn TimeChart, hour-of-day chart, per-account utilization line
    chart. Only the subscription-limit grid is present.

So: **1 of 11 screens is partially covered** (providers — limits only), plus one feature the
web UI has no equivalent of (the year-long daily heatmap).

## Scope numbers

- `src/client/**/*.tsx`: **9,244 lines** (85 `.tsx` files incl. `traces/` and `ui/`).
- `src/client/charts/*` (all files, incl. types/barrel): **637 lines**.
- `src/client/charts/*.tsx` alone: 589 lines (388+22+38+49+26+61+… barrel).
- Route components only: **4,637 lines**.
- `src/client/traces/*.tsx|ts`: **2,126 lines** (TimelineCanvas 751, TraceView 389, time-scale 250, SpanDrawer 243, Minimap 168, TranscriptList 138, trace-colors 84, AggregatesPanel 69, SummaryStrip 34).
- `src/client/ui/*.tsx`: **1,030 lines**.
- `src/client/**/*.css`: **2,504 lines** (irrelevant to a port — it does not transfer).
- `src/client/api.ts` 199 + `data/*` 1,034 (of which `view-models.ts` 469 is pure logic that
  ports as-is) + `app/*` 318.
- Largest single screen component: **`src/client/routes/ProvidersRoute.tsx`, 1,050 lines**.
- Largest route by feature breadth: `FrustrationRoute.tsx`, 924 lines.

**Is "port the web UI to the TUI" a small job? No — it is large.** The 11 route components
alone are 4,637 lines of TSX; even a mechanically thin port lands in the 2,000–3,000 line
range once the chart renderers, tables, stat grids and per-screen formatting exist. The
*charts* are the cheap part (637 lines total, and `Chart.tsx`'s layout logic is the only
genuinely hard file). The screens are the expensive part, and Traces (2,126 lines) is a
different application that should be excluded rather than ported.

**Sensible v1 subset** — the four "usage" screens plus the data plumbing, which is where
the existing TUI `/usage` view already points:

- Overview, Models, Costs, Projects (projects covers folders/tools-style ranked bar lists)
- one shared `renderBarChart` / sparkline / barlist / sharebar module (~400–500 lines)
- one shared stat-grid + sortable-table renderer (~300 lines)
- reuse `data/view-models.ts` (469 lines) and `data/formatters.ts` (98 lines) unchanged
- `api.ts` client swapped for direct function calls into the server-side stats layer

Estimate: **~1,200–1,800 lines of new TUI code** for those four screens plus the shared
primitives. Drop Traces entirely (web-only), defer Providers' utilization chart, and
Frustration/Gain/Requests/Errors/Tools are each ~150–400 lines of mostly tables and can be
added incrementally after v1.

## Searches

Everything read directly; no inference from naming. Specifically:
- `wc -l` over every `src/client/**/*.{ts,tsx,css}`
- full read of all 6 `charts/*.tsx`, `charts/types.ts`, `charts/useWidth.ts`, `charts/index.ts`
- full read of `App.tsx`, `app/nav.ts`, `api.ts`, `data/query.ts`, `data/view-models.ts`
- `grep` of every `useQuery(` call in `routes/*.tsx` to map screen → endpoint (authoritative:
  each screen has exactly one primary `useQuery`, Providers has three)
- `grep` of chart component call sites in all routes to build the chart-usage table
- `grep` of `path === "/api/..."` in `src/server.ts` for the server dispatch list
- `usage-dashboard.ts` read: exported symbols, section markers, `#renderCardsGrid`,
  `#renderHeatmap`, `#heatRamp`, `#overviewLines`/`#detailLines`
- `command-controller.ts:2144+` read to see what the existing `/usage` detail view renders

## Gaps

- **Nothing a terminal can do at all:**
  - `TimelineCanvas` (751 lines) — wheel zoom anchored at the cursor, drag pan, WASD, fit/
    focus keys, hover hit-testing, double-click-to-zoom; plus `Minimap` (168) with a
    draggable/resizable viewport brush. This is the one genuinely web-bound surface.
  - **Hover tooltips.** `Chart.tsx` renders a floating tooltip on `pointermove` over the plot
    (value, share %, per-series totals, `tooltipExtra` rows). A terminal needs a *cursor
    column* readout instead — equivalent information, different affordance.
  - **SSE live streaming.** `data/live.tsx:52` opens `EventSource("/api/events")`; a version
    bump silently invalidates every cached query and all pages re-render. Terminal can poll the
    DB directly instead, so this is a different mechanism, not a lost capability.
  - **Multi-series overlapping line charts** (provider utilization, model TTFT) degrade in
    cells/braille past ~4 series. Colour separation is weaker than SVG strokes.
  - ResizeObserver-driven re-layout (`useWidth`) has no terminal analogue beyond recomputing
    on terminal resize — which pi-tui does anyway.
- **What a terminal does better:**
  - Instant key toggles — the web legend's click-to-hide series filter becomes a one-keypress
    toggle with zero fetch; `Segmented` metric switches become hotkeys.
  - No page reload, no skeletons: `useQuery`'s 128-entry cache / stale-while-revalidate dance
    (166 lines of client) collapses into "read the DB".
  - Fuzzy search over `Table`/`SearchInput` — `pi-tui/src/fuzzy.ts` already exists.
  - Row drill-down into a modal/drawer becomes a stack push/pop.
  - `draw.tsx` is dead weight for a port (mouse, hover, tooltips).
- **Open questions I did not resolve (would need reading, not guessing):**
  - Whether the TUI can call the `omp-stats` server-side stats layer directly (avoiding HTTP)
    or must shell out / spawn the server. This materially changes v1 effort. Not determined here.
  - `FrustrationRoute`'s judge job and `POST /api/sync` are *side-effecting* actions; a port
    must decide whether the TUI exposes paid operations at all. Recommend not in v1.