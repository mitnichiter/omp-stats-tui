# Repository Guidelines

## Project Overview

`omp-stats-tui` is a distributable **extension** (shipped inside a **plugin**) that adds a `/stats-tui` slash command to omp 18.4.10. The command renders local usage statistics read from `~/.omp/stats.db` as a **fullscreen overlay** drawn inside the terminal, replacing the browser-launch behaviour of the built-in `/stats` (which becomes the **stats dashboard** — a separate multi-screen browser application over the same records).

This repository is a working extension: source under `src/`, tests under `test/`, the implementation plan under `docs/plans/`. Screens render through the IR now — a `ScreenSpec` declares `Band[]` (`src/layout/spec.ts`) and `renderScreen` (`src/tui/render/screen.ts`) renders them via the band grammar (`src/tui/band.ts`). `LOCAL_BODIES` and `LOCAL_NEEDS` are DELETED (verified absent from `src/`, `test/` and `scripts/`); `overview`, `models`, `costs`, `errors`, `tools`, `requests`, `providers` and `gain` are thin registry entries whose `render` defers to the pipeline. `activity` still carries a hand-written body (the heatmap, its summary line and its loading/empty/error branches); `traces`/`frustration` are excluded.

Vocabulary is load-bearing. `CONTEXT.md` is the glossary; use its terms (request, turn, fact table, rollup table, dirty hour, range, bucket, cache rate, unpriced request, data ink, seam, symbol preset — and, for layout work, band, ScreenSpec, MetricRef, resolve, parity). Where a looser word is already in use and wrong — "message" for a request, "granularity" for bucket, "stale" for dirty hour — do not reintroduce it.

## Architecture & Data Flow

Settled design, in order:

1. The extension registers the command `/stats-tui`.
2. The command calls `ctx.ui.custom(factory, { overlay: true, overlayOptions })`.
3. With `overlay: true` the host mounts a fullscreen overlay (`fullscreen: true` borrows the terminal's alternate screen buffer; the transcript stays untouched).
4. `fetchFor` in `src/data/api.ts` fetches exactly what the screen declared (`ScreenSpec.needs`), through an injected `Reader` in tests. No socket is bound; all 23 routes execute in-process.

The adapter shape (from `docs/research/omp-stats-tui/REPORT.md` §1):

```ts
import { handleApi } from "@oh-my-pi/omp-stats/server";

async function api<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL("http://localhost" + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await handleApi(new Request(url));
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return (await res.json()) as T;
}
```

**There is NO webserver.** `handleApi` is a plain exported function with zero references to the server object; the only `server.*` call in the file lives in `createDashboardServer`'s SSE branch, outside `handleApi`.

**There is NO SQL of our own.** Queries go through the package's aggregator and rollup functions, which read pre-aggregated rollup tables.

**There is ALMOST NO React port.** The dashboard's `src/client/**` is 9,244 lines of `.tsx` across 41 files; the eleven route components are 5,348 lines. We do not translate components. We reuse the host's pure data layer (`@oh-my-pi/omp-stats/client/data/*` — `pivotSeries`, `densify`, `buildCostSummary` and friends, asserted identical by `test/parity.test.ts`) and render terminal-native views over the same data. The traces view (2,126 lines, wheel-zoomed flamegraph) is excluded. One deliberate exception: `src/data/api.ts` runs one narrow SQL query for the marked no-catalog-card workaround; see the WORKAROUND block in that file and the upstream issue it names.

### Measured latencies

`bun:sqlite` is synchronous, so every number below lands on the thread that paints the panel. All are warm page-cache, one machine (M-series darwin-arm64).

| Operation | Measured | Note |
|---|---|---|
| `handleApi(GET /api/stats/overview?range=7d)` | HTTP 200 | keys: `byAgentType`, `overall`, `timeSeries` |
| `getDashboardStats` per range (warm, steady state) | `1h` 4.8 ms · `24h` 1.2 ms · `7d` 5.8–6.4 ms · `30d` 9.5 ms · `90d` 13.8–14.1 ms · `all` 12.9–13.4 ms | every range under 20 ms; no range needs a subprocess |
| first query in a fresh process (`1h` run0) | 434.2 ms | page-cache warmup, **not** rollup cost |
| `initDb()` | 866.9 ms (also measured 864.1 ms) | one-time per process; **no file mutation** — mtime and size byte-identical before/after. Load behind the loading state. |
| `syncAllSessions()` | **7141 ms**, 3401 files / 151,107 rows | genuinely writes (DB grew 305.6 MB → 307.1 MB). Blocks the TUI event loop. Never call it inline. |
| `getDailyActivity(371)` | 195.6 ms | the query that forced `/usage` to use a subprocess. A rollup-backed panel does not call it. |
| `bun install` for `@oh-my-pi/omp-stats` | **84 ms**, 12 packages | also measured at 146 ms in a second run |

**Three numbers constrain the design:** the 866.9 ms `initDb()` must sit behind the loading state; the 7141 ms sync must be out-of-band or absent; and `initDb()` returns `null` until first run, after which every rollup getter degrades **silently** to `[]` or a zeroed aggregate — a panel that queries before init shows an empty dashboard with no error.

## Key Directories

| Path | State | Contents |
|---|---|---|
| `CONTEXT.md` | **exists** | The glossary. Source of truth for vocabulary. |
| `AGENTS.md` | **exists** | This file. |
| `docs/research/omp-stats-tui/REPORT.md` | **exists** | The synthesis. Read this first after `CONTEXT.md`. |
| `docs/research/omp-stats-tui/findings/` | **exists** | F1–F11, one file per investigation. F9 (import strategies), F10 (glyph system, numeric formatting) and F11 (zero-install paths) are the load-bearing ones for implementation. |
| `docs/adr/0001…0006` | **exists** | Six settled decisions. See §Settled Decisions. |
| `docs/plans/` | **exists** | `2026-10-03-stats-tui-panel.md` — the implementation plan. |
| `src/` | **exists** | Real modules. `src/index.ts` (extension entry), `src/data/api.ts` (the data seam: injected reader, typed fetchers, `fetchFor`), `src/data/ranges.ts` (the closed range set), `src/layout/spec.ts` (the IR — `ScreenSpec`, bands, `MetricRef`, `SCREEN_SPECS`), `src/layout/resolve.ts` (`resolveCell` / `resolveNumber` / `resolveLabel` — where a ref meets data), `src/tui/panel.ts` (`SELECTABLE_SCREENS`, the frame), `src/tui/band.ts` (`renderBands`, the G1–G6 grammar), `src/tui/charts/` (`bars.ts`, `heatmap.ts`, `sparkline.ts`, `compose.ts`), `src/tui/screens/` (one module per screen; spec'd screens carry identity and defer `render` to the pipeline), `src/tui/palette.ts` (`PALETTE`, `SERIES_COLORS`), `src/tui/tabs.ts` (`TAB_SHORT`, `tabBarTheme`), `src/tui/footer.ts` (`hintsFor`), `src/tui/layout.ts` (`planLayout`), `src/tui/format.ts`, `src/tui/glyphs.ts`, `src/tui/icons.ts`, `src/sync/` (the ingest subprocess). |
| `src/tui/chrome.ts` | **exists** | The one nav grammar: `NAV_GROUPS`, `screenForHotkey`, `ago`, `chipFor`, `progressLineFor`, `sidebar`, `topbar`. The sidebar column appears when the frame band allows it; the tab strip stands in as the drawer below that. |
| `src/tui/responsive.ts` | **exists** | `framePolicy(width)` — the frame band (`wide`/`medium`/`narrow`/`tiny`) and the chrome each band gets, derived from `BREAKPOINTS` in `src/tui/layout.ts`. Pure: no theme, no terminal, no data. |
| `test/` | **exists** | `bun test` — 619 tests across 42 files. Pure-function tests plus `test/parity.test.ts` (resolver vs the web's own functions on one fixture), `test/band.test.ts` (the G5 invariant, asserted literally), `test/chrome.test.ts`, `test/responsive-frame.test.ts` (frame policy vs `planLayout` at widths 1–200), and one `*-screen.test.ts` per spec'd screen. |
| `scripts/` | **exists** | `probe-render.ts` (render any screen to stdout at any width), `probe-data.ts`, `probe-glyphs.ts`, `sync-worker.ts`. |

There is a `package.json`, a `bun.lock`, `node_modules`, and a `.gitignore`. All four exist.

## Development Commands

### Usable today (verified on this machine)

```sh
# Fast feedback loop: loads extensions, prints load errors to stderr,
# no interactive TUI, no LLM call. Exit code is 0 either way —
# read stderr, do not check $?.
omp models -e /abs/path/to/src/index.ts
```

**`-e` must come AFTER the subcommand.** `omp -e /abs/path.ts models` silently ignores the extension — verified: a probe extension that prints to stderr under `omp models -e` prints nothing under `omp -e ... models`. Same for `omp --no-extensions -e /abs/path.ts`, which is the form to use when debugging a single module in isolation (explicit `-e` paths still work with `--no-extensions`).

**Do not use `omp --help` to check a build.** It does not load extensions — verified: the same probe prints under `omp models -e` and prints nothing under `omp --help -e`.

```sh
# List installed plugins
omp plugin

# Install or link a plugin directory persistently
omp plugin link <dir>      # `omp install <dir>` is an alias for plugin install|link

# Isolate auth, sessions, settings and caches while debugging
omp --profile <name> -e /abs/path/to/src/index.ts

# Read the extension error log
ls -t ~/.omp/logs/ | head          # files are named omp.<DATE>.<PID>.log, e.g. omp.2026-09-29.3585.log
```

**Nothing is ever printed to stdout from extension code.** stdout is the TUI's; writing to it corrupts the display. Extension diagnostics go to stderr and to `~/.omp/logs/omp.<DATE>.<PID>.log`. There is no hot reload and no watcher — modules are never unloaded or re-evaluated, so a newly added or changed extension file requires a restart.

### Installed (verified on this machine)

```sh
bun install

# The test runner. omp ships no extension test harness; tests are pure
# functions exported from non-entry modules.
bun test

# Render any screen to stdout at any width, without launching a terminal.
# This is how a screen gets reviewed.
bun scripts/probe-render.ts [screenId] [--width N] [--range 24h] [--preset P]
```

`bun test` is verified to work as a runner today — it reports **619 pass / 0 fail across 42 files**. Screens render through the IR, so a screen test asserts its bands and resolved refs, not hand-written rows.

## Code Conventions & Common Patterns

These are the non-obvious ones. Each has already cost a future agent time once.

**Static imports only for `@oh-my-pi/*`.** Dynamic `import()` of *any* `@oh-my-pi/*` fails inside the extension loader, including `pi-tui` and `pi-coding-agent`, which work fine as static imports. The loader's resolve hook rewrites the specifier for static imports only; the dynamic path re-enters resolution into Bun's flat install cache.

**The theme API is `theme.fg(color, text)` and `theme.bg(color, text)`.** There is no `theme.colors` property. `ThemeColor` is a string union: `"accent" | "border" | "borderAccent" | "borderMuted" | "success" | "error" | "warning" | "muted" | "dim" | "text"`. Also on the class: `theme.symbol(key)`, `theme.getSymbolPreset()`, `theme.getColorHex(color)`.

**Never import the `theme` binding at module scope.** It is declared as `export var theme: Theme;` — undefined until theme init runs, so reading it before init is a crash at extension load time. Use the `theme` passed to the `custom()` factory.

**The `keybindings` argument passed to a `custom()` factory is useless for resolution.** It is `KeybindingsManager.inMemory()` — defaults, not the user's `keybindings.yml`. Use `matchesKey()`, which is in the root barrel, and `matchesSelectCancel()`, which is **not** in the root barrel and must come from `@oh-my-pi/pi-tui/keybinding-matchers`.

**Component names.** `ScrollView`, not `ScrollViewport`. `MetricRow`, not `Metric`. `OverlayPanel`, `PanelRows` and `PanelDivider` are not in the root barrel either — they come from `@oh-my-pi/pi-tui/chrome`.

**`Table` cells must be `{ text, style? }` objects.** Passing raw strings throws `undefined is not an object (evaluating 'e.replaceAll')`. For a numbers table prefer `renderTableRow(cells, columns, maxWidth?, options?)`, a free function.

**`bun:sqlite` is synchronous.** Any DB work longer than a few ms stalls the TUI render loop. This is why the panel must load behind a loading state (the 866.9 ms `initDb()`) and why `syncAllSessions` (7141 ms) must run out-of-band if it runs at all.

**Emoji cannot be data ink.** `Bun.stringWidth("🪙") === 2` and `Bun.stringWidth("⬛") === 2` — verified. Any repeated emoji cell destroys the column grid. Emoji are fine as a single label where the label column is measured with the same function; they are categorically forbidden as a ramp step or heat cell. `Bun.stringWidth` is exactly what pi-tui measures with, so it is the function to check candidates against.

**Free functions over classes, where the evidence says so.** `renderProgressBar(...)` has 4 first-party call sites; the `ProgressBar` class has 0.

**Screens render through the IR; add `Band[]` to the spec, not rows to a screen.** A spec'd screen's registry entry (`src/tui/screens/<id>.ts`) carries identity and contract and defers `render` to `renderScreen` (`src/tui/render/screen.ts`) via `renderSpecScreen` (`src/tui/screens/render.ts`). A hand-written `render` body in a screen module is a second grammar for that screen; see `src/tui/screens/costs.ts` for the one-paragraph shape. The three legacy bodies (`overview`, `activity`, `models`) and the `custom` band are under migration, not examples to copy.

**Scroll clamping happens in `render()`, never in the key handler.** The handler adds and calls `requestRender`; the clamp to `maxScroll` happens during render, which makes shrink-on-resize automatic.

**Guard the mount.** `ctx.hasUI` is `false` in print/headless/RPC/ACP modes, and RPC can report `hasUI === true` while still not supporting `custom()`. Check `ctx.mode === "tui"` before mounting. `done(...)` must be called exactly once and `dispose()` must be idempotent — the host also calls `component.dispose?.()` in its own cleanup.

**Cache the heatmap layout.** `buildHeatmapLayout` rebuilds the entire grid on every call and its cost is unmeasured. Cache it per `(points, weeks)`.

**A value that cannot be resolved is `null`, never `undefined`, never `NaN`, never `"undefined"`.** `src/layout/resolve.ts` returns null explicitly from `resolveCell` / `resolveNumber` / `resolveLabel`; `test/resolve.test.ts` walks every ref in every spec against a route-shaped fixture, and `test/parity.test.ts` walks the same fixture against the web's own functions. An unresolvable ref is a test failure naming the screen and the path, not a blank cell a human has to notice.

**Band order is panel order.** `Band[]` in the spec *is* the vertical order (`src/tui/band.ts` G4: exactly one blank line between consecutive bands, none leading or trailing). Reordering a screen is reordering its bands, not editing a render body.

**One nav grammar, two shapes.** `src/tui/chrome.ts` owns the sidebar, the topbar, the live/sync chip and the hotkey map (`NAV_GROUPS`, `screenForHotkey`, `chipFor`, `progressLineFor`). The panel shows the sidebar column when `framePolicy(width)` says the band affords one and falls back to the tab strip as the drawer below that — so the width decision belongs to `src/tui/responsive.ts` and nowhere else. Never re-derive a width threshold in a chrome module.

**Loading, empty and error are three states, never merged.** On the activity calendar: a payload that
has not arrived prints "Usage history unavailable." plus why, a fetched-but-empty range prints "No
activity recorded.", and a failed fetch reaches the panel's own error phase (`fetchFor` throws rather
than degrading). **We deliberately deviate from `/usage` here**: it renders a fetched-but-empty range as
a zero-filled grid, and a field of empty cells is a claim about someone's usage that happens to be
wrong. Do not "restore parity" on this one without that argument.

## Important Files

Absolute paths, all verified present on disk. **These are read-only host files. Do not modify them.**

| Path | Why it matters |
|---|---|
| `/Users/yuzu/.bun/install/global/node_modules/@oh-my-pi/omp-stats/src/server.ts:165` | `export async function handleApi(req: Request): Promise<Response>` — the data seam. Not re-exported from the package root, but the `exports` map declares `"./*": {"import": "./src/*.ts"}`, so the deep subpath `@oh-my-pi/omp-stats/server` is legal. |
| `/Users/yuzu/.bun/install/global/node_modules/@oh-my-pi/omp-stats/src/shared-types.ts` | The aggregate types: `AggregatedStats`, `ModelStats`, `TimeSeriesPoint`, `DailyActivityPoint`, `DashboardStats` and 14 others. A pure type module — zero runtime exports, `import type` only. |
| `/Users/yuzu/.bun/install/global/node_modules/@oh-my-pi/pi-tui/src/overlays/usage-dashboard.ts:533` | `export class UsageDashboardComponent implements Component` — the structural template. Data-heavy, read-only, async-loaded with distinct loading and error states, self-scrolling, frame-composed via `OverlayPanel` regions. **Read it, do not import it** — it couples us to an uncovered constructor and option shape. |
| `/Users/yuzu/.bun/install/global/node_modules/@oh-my-pi/pi-tui/src/overlays/usage-dashboard.ts:313` | `export function buildHeatmapLayout(points, weeks, today)` — genuinely reusable. Its input type `DailyActivityPoint` already comes from omp-stats. Importable today via `@oh-my-pi/pi-tui/overlays/usage-dashboard`, but outside the public barrel and with no stability guarantee. |
| `/Users/yuzu/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/stats/activity-worker.ts` | The subprocess pattern for background ingest — the shape to copy if a sync is ever needed. Spawn a worker, stream over a pipe, parent `SIGKILL`s the child on `done`, so synchronous SQLite never runs on the TUI thread. |
| `/Users/yuzu/.bun/install/global/node_modules/@oh-my-pi/pi-tui/src/theme/symbols.ts` | The three symbol presets (`unicode`, `nerd`, `ascii`) and the 269 registered symbol keys. `theme.symbol()` is a plain map read and **none** of the keys is a data-ink ramp — which is why data ink is hardcoded (ADR 0005). |

Supporting source worth knowing:

- `/Users/yuzu/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/modes/controllers/extension-ui-controller.ts` — `custom()` host implementation. `KeybindingsManager.inMemory()` at `:1156`; `showOverlay` at `:1206`.
- `/Users/yuzu/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/modes/controllers/selector-controller.ts` — `#showFullscreenMenu` at `:181`, the `fullscreen: true` overlay options verbatim at `:187`.
- `/Users/yuzu/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/modes/controllers/input-controller.ts` — built-in slash commands are dispatched before extension commands here. The reason `/stats` can never be overridden.
- `/Users/yuzu/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/commands/stats.ts` and `src/cli/stats-cli.ts` — the built-in `/stats` browser path, and the complete flag set (`port`, `host`, `json`, `summary`). There is no sync-free JSON mode.
- `/Users/yuzu/.bun/install/global/node_modules/@oh-my-pi/pi-tui/src/theme/theme.ts:93` — `export var theme: Theme;`, the mutable binding that is undefined until init.
- `/Users/yuzu/.bun/install/global/node_modules/@oh-my-pi/pi-tui/src/keybinding-matchers.ts:32` — `matchesSelectCancel`.

## Runtime & Tooling Constraints

- **Bun, never Node.** Verified Bun 1.4.2, omp 18.4.10 (`omp/18.4.10`), darwin-arm64.
- **Host root:** `/Users/yuzu/.bun/install/global/node_modules/@oh-my-pi/`. All three packages are pinned at `18.4.10`; the extension's `@oh-my-pi/omp-stats` must be pinned to match the host.
- **`@oh-my-pi/pi-tui` and `@oh-my-pi/pi-coding-agent` resolve bare from an extension with no install step.** Verified: a probe extension importing both by bare specifier loads and enumerates them inside the real loader.
- **`@oh-my-pi/omp-stats` does NOT resolve bare.** It is absent from the host's `PI_PACKAGE_NAMES` allowlist, so the host shim declines it, the generic bare-dependency resolver walks `node_modules` upward from the extension's own directory, finds nothing, and falls through to Bun's flat install cache — a flattened per-package copy with no sibling `pi-natives-darwin-arm64` beside it. The failure is **not** "cannot resolve the package"; Bun resolves it fine and the transitive `pi-natives` load is what dies.

  Two ways out, both verified working in the real loader:
  1. **Primary** — declare `"@oh-my-pi/omp-stats": "18.4.10"` as a dependency and run `bun install` in the plugin directory (84 ms, 12 packages). This installs the platform sibling that causes the failure, so the plain bare specifier works and the source stays idiomatic.
  2. **Fallback** — discover the host root by realpath-ing the `omp` shim on `PATH` and import by absolute path. Portable, no install step, but machine-specific and version-coupled.

- **`Bun.plugin`'s `onResolve` CANNOT fix bare-specifier resolution on Bun 1.4.2.** Proven structurally impossible: Bun's `onResolve` sees only post-resolution absolute paths, never the bare specifier, so no filter can intercept `@oh-my-pi/omp-stats/server` before Bun's resolver runs. An isolated repro with a synthetic package confirmed it. Do not retry this.

- **`Bun.resolveSync` is unusable for host discovery.** It returns the same broken flat-cache path.

- **No hot reload, no watcher.** `ctx.reload()` re-runs discovery but does not re-evaluate modules.

- **Concurrency is not a concern.** The DB is in WAL mode with `busy_timeout = 5000`; a read-only reader completes `SELECT COUNT(*) FROM message_rollup` in 0.1–0.9 ms while another connection holds an open `BEGIN IMMEDIATE` write transaction. Read-only is a hard guarantee (`SQLITE_READONLY`, not `SQLITE_BUSY`), not a convention.

- **`HOME` is the DB redirect knob; `PI_CONFIG_DIR` is not.** `PI_CONFIG_DIR` is a *name* joined onto homedir, so passing an absolute path doubles it.

## Testing & QA

**Runner: `bun test`.** omp ships no extension test harness, so keep tests to pure functions exported from non-entry modules.

**Unit-testable:**

- The glyph ramp and the preset resolution — one `switch`, no branches in render code. Assert per-role codepoints and per-level indices; assert `Bun.stringWidth === 1` for every data-ink candidate.
- Numeric formatters — compact vs integer split, the cache-split rule, unpriced surfacing, the `formatDurationMs`/`formatElapsed` switch at 60 s, the cache-rate denominator (cache **writes** are excluded).
- Range → bucket mapping, and range validation. `365d` is **not** a valid key and silently falls back to the `24h` default — a range picker offering "365 days" would show 24 hours of data with no error. The valid set is exactly `1h | 24h | 7d | 30d | 90d | all`.
- The data seam against recorded fixtures — freeze the `handleApi` JSON shapes (`/api/stats` gives 8 top-level keys; `/api/stats/overview` gives `byAgentType`, `overall`, `timeSeries`). The injected `Reader` serves the fixtures, so no test touches the database.
- The IR against a route-shaped fixture: every `MetricRef` in every spec resolves (`test/resolve.test.ts`), and the resolver answers identically to the web's own functions on the same input (`test/parity.test.ts`).
- Layout grammar invariants: every band at widths 20/40/80/120 stays within `innerWidth`, no rendered line contains a rule character (the G5 invariant, asserted literally in `test/band.test.ts`), band order is preserved, and N bands yield exactly N−1 blank lines (G4).
- Multi-series composition by equality: with labels off, `renderSeriesChart(...)` must equal the hand-rolled per-series `renderDailyBars` calls byte for byte (`test/chart-primitives.test.ts`), so a second rendering path fails instead of shipping beside the first.
- Colour and tabs by measurement: every `PALETTE` role resolves to a real token and every `TAB_SHORT` entry is one cell on all three presets (`test/palette.test.ts`, `test/tabs.test.ts`).
- Layout functions, given a fixed width and a `process.stdout.rows`.

**Not unit-testable: the fullscreen overlay itself.** It needs a human running `/stats-tui` in a real omp session. Budget for this — the overlay has never yet been painted in a real terminal. Mount, scroll, resize and dismiss are all manual checks.

**Correctness traps that tests should cover:**

- There is no `cachedTokens` field. `cacheRate = totalCacheReadTokens / (totalInputTokens + totalCacheReadTokens)` — writes are excluded from the denominator, so the rate can read low while the cache is doing most of the work.
- `totalCost` silently under-reports by the unpriced requests. **Render `unpricedRequests` beside cost, always.** A cost figure shown without it is a wrong number, not a rounded one.
- `cacheSavings` is a dollar-savings ratio, not a token count, and can be negative.
- Rollup staleness: above 96 dirty hours (`EXACT_DIRTY_LIMIT`) reads stop unioning dirty hours and return stale rows with not-yet-built hours missing. Show the dirty-hour count rather than presenting the gaps as zeroes. A `ROLLUP_VERSION` bump DROPs and rebuilds every rollup row, so a panel without `getRollupStatus()` shows holes as zeroes — a lie about money.

## Settled Decisions

Each is an ADR. Do not relitigate without new measurement.

| ADR | Decision | Why |
|---|---|---|
| 0001 | Reuse the `@oh-my-pi/omp-stats` package — **superseded in outcome by later research**: the package resolves via a declared dependency, so we do not write our own SQL. | Owning SQL means owning the rollup union, the dirty-hour staleness rule above 96 hours, the ~20-column aggregate list that mixes `SUM()` for counts with `TOTAL()` for money, and a mandatory schema-version assertion. ~150–250 lines plus a version-skew check to maintain forever, to save ~12 ms per query. Reuse also keeps `handleApi`, the aggregator projections, the shared types and `syncAllSessions` reachable. One deliberate exception: `src/data/api.ts` runs one narrow query for the marked no-catalog-card workaround. |
| 0002 | The command is `/stats-tui`, not `/stats`. | Built-in slash commands dispatch before extension commands. An extension registering `/stats` appears in the palette and never executes — the worst kind of bug, because it looks like it works. |
| 0003 | The panel is read-only, except the background ingest ADR 0006 adds. | Ingest takes an OS file lock that polls every 25 ms for up to one hour before giving up. Freshness the panel does not need to be useful is not worth a possible one-hour hang. The panel can be stale, and the user must never mistake stale for zero — so the dirty-hour count is part of what the panel says about itself. See ADR 0006 for the one clause this no longer covers. |
| 0004 | Render terminal-native views through the IR; do not port the React dashboard. | 9,244 lines of `.tsx`, 5,348 of them in the eleven route components. The rendering path is `ScreenSpec` → `renderScreen` (`src/tui/render/screen.ts`) → `renderBands` over the G1–G6 grammar (`src/tui/band.ts`). F21 reduced the web to four band shapes and the IR carries them as `Band` (`src/layout/spec.ts`); porting a component means expressing it in that union. The traces view (2,126 lines, wheel-zoomed flamegraph) is excluded. |
| 0005 | Hardcode plain Unicode for data ink; route only chrome through the symbol preset. | `theme.symbol()` only resolves keys the host registers, and neither the eighth-block ramp nor the shade ramp is among them — so "route everything through the preset" is not implementable without patching a package we do not own. Presets are opt-in settings, never detections. |
| 0006 | Ingest runs in the background, in a subprocess the panel SIGKILLs. | Supersedes ADR 0003 on the sync clause only. The panel paints from what the database holds, then syncs out-of-band (`src/sync/`, `scripts/sync-worker.ts`) so it agrees with `/stats` about what it shows. The panel itself never writes; the dirty-hour count stays visible. |

## Do Not

Dead ends already disproven by experiment. Re-testing any of these wastes hours.

- **Do not write our own SQL** over `~/.omp/stats.db`. Reuse the package. Owning SQL requires re-implementing the rollup union, the staleness rule, the aggregate column list and the schema-version check, and it discards `syncAllSessions` entirely. ADR 0001 is the only argument for it and research superseded it.
- **Do not use `Bun.plugin` `onResolve`** to intercept `@oh-my-pi/omp-stats/server`. Bun 1.4.2 never offers the hook a bare specifier — only post-resolution absolute paths. Structurally impossible, proven with a synthetic package.
- **Do not use `Bun.resolveSync` for host discovery.** It returns the same broken flat-cache path that causes the original failure. Realpath the `omp` shim on `PATH` instead.
- **Do not use dynamic `import()` of `@oh-my-pi/*`.** It fails in the extension loader even for packages that work fine as static imports. The loader's resolve hook rewrites static specifiers only.
- **Do not use braille for data ink.** One foreground colour per character cell, so per-day and per-level heatmap colour is impossible — it destroys exactly the channel a heatmap depends on. It also has the wrong aspect without a 2:1 fudge that breaks on resize, and renders as tofu rather than degrading gracefully. omp uses braille only for the decorative title spinner.
- **Do not use emoji for data ink.** `Bun.stringWidth` reports them as 2 cells (verified for `🪙` and `⬛`). Any repeated emoji cell destroys the column grid.
- **Do not use Nerd Font codepoints for chart marks.** There is no Nerd glyph whose semantics is magnitude; the candidates are powerline separators and icon glyphs meaning something unrelated. Under the `nerd` preset, emit byte-identical characters to `unicode`.
- **Do not scale bars by token count — scale by cost.** This project's own database proves it: `deepseek-v4-flash` reads 4.04 B cache tokens for $22.85 while `gpt-5.6-terra` reads 2.39 B for $935.72 — a 41× price spread at comparable volume. A token-scaled bar chart across models is actively misleading. Cost is what the user pays.
- **Do not print a bare token total.** The user is 95.13% cache-read by token, so a single "24.4B tokens" figure is true and useless. Show cache-read and fresh as separate columns, dim the cached portion, and print the cache share as a number.
- **Do not render `$0.00` for unknown spend.** A request whose `cost_total` is 0 *and* whose model has no catalog price card is unpriced, not free — `db.ts:49-51` notwithstanding. `src/data/api.ts` adds those counts to `unpricedRequests` in the marked WORKAROUND block (delete it when upstream fixes the marker); `costWithUnpriced` prints `N/A`. A `$0` row must mean an explicit all-zero price card.
- **Do not call `syncAllSessions` on the TUI thread.** 7141 ms of synchronous SQLite holds the event loop for the whole duration. Ingest runs in the background subprocess (`src/sync/`, `scripts/sync-worker.ts`), SIGKILLed on close — see ADR 0006.
- **Do not offer `365d` in a range picker.** It is not a valid key and silently falls back to `24h`.
- **Do not query before `initDb()` has run.** Every rollup getter then degrades silently to `[]` or a zeroed aggregate — an empty dashboard with no error.
- **Do not call `/api/sync` or `getProviderWindowStats`** from the panel's load path. The first starts real background ingest; the second does network I/O to a broker fetch. `getRequestDetails` reads transcript files off disk.
- **Do not port the React dashboard**, and do not reuse `UsageDashboardComponent` directly — read it, do not import it.
- **Do not take the native/TSP rendering backend.** `usage-dashboard` implements a second rendering backend behind a capability probe; the ANSI path is the one we can rely on.
- **Do not print to stdout from extension code.** It corrupts the TUI.
- **Do not hand-write a multi-series chart.** `src/tui/charts/compose.ts` has no geometry of its own: every mark comes out of `renderDailyBars` called once per series, with band heights sized by each series' peak relative to the shared maximum. `test/chart-primitives.test.ts` asserts this by byte equality, so a second rendering path fails the suite rather than shipping beside the first.
- **Do not emit a full-width rule in any body.** `src/tui/band.ts` G5: `─`, `━` or `═` inside a band is a bug, full stop. The only rule in the whole panel is the `PanelDivider` between body and footer (G6). `test/band.test.ts` asserts G5 literally for every band kind and every preset.
- **Do not hardcode a colour or a glyph.** Every colour is a named omp theme token from `src/tui/palette.ts` (`PALETTE`, plus `SERIES_COLORS` for chart series); the theme arrives injected, never from the module-scope singleton. Every heading glyph comes from `statsIcon` in `src/tui/icons.ts` — no screen module may hand-write one, which `test/overview-screen.test.ts` asserts by scanning the source for emoji literals.
- **Do not reimplement `pivotSeries`, `densify`, or `buildCostSummary`.** Import them from `@oh-my-pi/omp-stats/client/data/*` and call the host's function on the same input. `test/parity.test.ts` calls the web's own functions and asserts our resolver answers identically, so a second implementation of the arithmetic fails rather than drifting.
