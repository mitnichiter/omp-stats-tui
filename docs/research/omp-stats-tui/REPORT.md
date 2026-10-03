# Can an omp extension render local usage stats as a full-screen in-TUI panel at `/stats-tui`, without a webserver?

**Answer:** Yes, and the data layer should be reused rather than rebuilt. The JSON API is fully separable from `Bun.serve` — `handleApi(req: Request)` is a plain exported function with zero references to the server object, and all 23 routes were executed in-process with synthetic `Request` objects, zero sockets bound [1][11]. An extension cannot import `@oh-my-pi/omp-stats` by bare specifier out of the box, because the host resolver's seven-name allowlist omits it and resolution falls into Bun's flat install cache, which lacks the `pi_natives` native addon [15][20]. That is a solvable packaging problem, not a wall: declaring `"@oh-my-pi/omp-stats": "18.4.10"` and running `bun install` installs the missing sibling in 146 ms and makes the plain specifier work [44]. **Declare the dependency, reuse `handleApi`, the aggregators, the shared types and `syncAllSessions`; do not write our own SQL.** The one real constraint is execution, not import: `syncAllSessions` costs **7141 ms** [44] and `bun:sqlite` is synchronous, so any ingest must run out-of-band in a `SIGKILL`-able subprocess, as the first-party `/usage` already does [21][44].

**Confidence:** high on the seam, medium-high on the rest. The import question is settled by execution, not inference: all four strategies were run inside the real loader [44], `handleApi` was confirmed returning 200 with real data [44], and every per-range timing was measured on a copy of the live database [44]. Three measured gaps remain: the `1h` question that this revision closes for the query path is closed only warm [44], every timing came from a warm page cache on one machine [44], and the overlay has still never been painted in a real terminal [15]. Four findings-file claims were corrected against source rather than propagated: F7's route total and `.tsx` file count [41], F8's braille-absence claim [42], and F9's characterisation of the host allowlist as eight names when `PI_PACKAGE_NAMES` has seven [20].

## Why

The premise of the project is that `omp stats` forces a browser, and that a plugin therefore has no usable path to the data. Three independent investigations converge on the opposite: the API layer has no socket in it, the query layer sits over pre-aggregated rollup tables that read in under a millisecond, and the TUI host ships a documented full-screen overlay hook that first-party code already uses from an extension. What survives scrutiny is not "we can reuse the dashboard" — the dashboard's React client is a rewrite, not a port [18] — but "we can reuse the data layer and re-implement the view."

The resolution finding is what turns this from a design question into an import decision, and it is the part most likely to be got wrong. Source inspection says `@oh-my-pi/omp-stats` is absent from a seven-name host allowlist [20], which reads as "it will resolve anyway." Execution says otherwise. In the real extension loader a bare `@oh-my-pi/omp-stats/server` import fails with `Failed to load pi_natives native addon for darwin-arm64`: the shim declines the specifier, the generic bare-dependency resolver takes over, and its upward `node_modules` walk finds nothing, so it lands on Bun's global install cache — a flattened per-package copy with no sibling `pi-natives-darwin-arm64` beside it [15]. Declaring the package as a dependency *does* fix this, provided `bun install` is allowed to run and pull a complete tree (12 packages, 168 ms) [15]. The one thing that works with no install at all is `bun:sqlite`, which is a Bun builtin and therefore immune to the whole resolver [15].

## What would change this

- **An upstream resolution fix would simplify the packaging, not the seam.** If `omp-stats` joined `PI_PACKAGE_NAMES` [20], the bare specifier would resolve through the host's bundled virtual modules and the `bun install` step would disappear. Everything else in this report stands: the data layer was always worth reusing.
- **A cold-cache measurement.** Every timing here is warm [12][15][44]. The warm ordering — queries under 20 ms, ingest 7141 ms [44] — is unlikely to invert cold, but a cold first frame after `omp` launches could be hundreds of milliseconds. If that lands badly, the panel needs the subprocess pattern `/usage` already uses [21], which roughly doubles v1's complexity.
- **A version-skew failure mode.** The recommendation assumes the extension's pinned `@oh-my-pi/omp-stats` matches the host's install [44]. If a skew produces an unrecoverable load failure, Strategy 4 is not viable and Strategy 2 becomes primary. F9 did not test this [44]; question 10 is about characterising it.

## Considered and rejected

**Copy the route bodies into the plugin.** Rejected. It duplicates a 165-line dispatcher and re-implements upstream details that change without notice — the ETag format, the `X-Omp-Stats-Action` header semantics, the `ENOENT` mapping [11]. It would drift silently on the next `omp-stats` version bump, and the drift would be in the parts nobody re-tests.

**Write our own SQL on a read-only handle. Rejected — this was the previous recommendation and it was wrong.** Owning SQL is a real cost: it means owning the rollup union that stitches clean rollup hours, the partial start hour and dirty hours together, with the cutoff rounded up to the hour boundary [5]; the staleness rule above `EXACT_DIRTY_LIMIT = 96` dirty hours, past which reads silently return stale rows with not-yet-built hours missing [5]; the ~20-column `AGGREGATE_COLUMNS` list, which mixes `SUM()` for counts with `TOTAL()` for money [6]; and a schema-version assertion, because a `ROLLUP_VERSION` bump DROPs and rebuilds every rollup row [5]. Roughly 150–250 lines, then a version-skew check to maintain forever.

It was recommended on two grounds, and both have collapsed:

1. **"Owning SQL is faster."** It is — 0.1–1.0 ms against 1.2–31.5 ms through the package [12] — but F9 then measured the package's own `getDashboardStats` at **under 20 ms warm on every range**, 4.8 ms for `1h` and 12.9–13.4 ms for `all` [44]. A 13 ms frame is imperceptible. Buying a permanent maintenance liability to save 12 ms per query is a bad trade.
2. **"Owning SQL is the only zero-write option."** This was overstated. `initDb()` opens read-write and runs DDL [7], but it produced **no mutation in practice** — 866.9 ms with mtime and size byte-identical before and after [44], matching F2's independent measurement [12]. It is write-*intent*, not write-*effect*. And with Strategy 4 installed, `handleApi` is reachable anyway, so the read-only argument does not even get a vote.

What tipped it: owning SQL discards `syncAllSessions` entirely. If the panel ever wants to sync, reuse means calling a supported function; owning SQL means re-implementing session discovery and ingest. The 7141 ms measured cost [44] is a reason to put sync behind a subprocess, not a reason to reimplement it.

**Port the React dashboard to the TUI.** Rejected as a v1 goal, with numbers. The eleven route components are **5,348 lines** of `.tsx` [41] — measured directly, and larger than F7's stated 4,637, which does not match its own per-file table (§8). `src/client/**` is 9,244 lines across 41 `.tsx` files [41]. A mechanical port lands in the 2,000–3,000-line range once chart renderers, tables and per-screen formatting exist [34]. The charts are the cheap part — 637 lines total, and only `Chart.tsx` at 388 is genuinely hard [34]. The screens are the expensive part, and Traces (2,126 lines across nine files) is a cursor-anchored flamegraph app, not a dashboard; it should be excluded rather than ported [34]. The reusable part is the data layer and `data/view-models.ts` (469 lines of pure logic that ports as-is), not the view layer [34].

**Reuse `UsageDashboardComponent` directly.** Rejected for v1. It would be the cheapest path to a painted screen, but it couples the plugin to a private-ish component's constructor and option shape, which is not covered by any stability guarantee [18]. It is worth reading, not worth importing.

**Register the command as `/stats`.** Rejected. Built-in slash commands are dispatched before extension commands at `input-controller.ts:1060` [23], and `/stats` is a built-in that launches the browser [22]. The extension command would appear in the palette and never execute. `/stats-tui` avoids the collision.

**Own a first-party view via header/footer hooks.** Rejected. `setHeader` and `setFooter` are documented no-ops in interactive mode, and no view-registration hook exists [19]. An extension can occupy the editor area, an overlay, an editor-adjacent widget strip, or transcript rows — nothing else.

## Findings

### 1. The existing JSON API can be reused with no webserver [verified]

`handleApi` is exported from `@oh-my-pi/omp-stats/src/server.ts:165` as `export async function handleApi(req: Request): Promise<Response>` [1]. Its body spans lines 165–329 and contains zero references to the Bun server object. The only `server.*` call in the file — `server.timeout(req, 0)` at `server.ts:385` — lives in `createDashboardServer`'s `fetch`, in the `/api/events` SSE branch at `server.ts:383-387`, which is handled *outside* `handleApi` [2]. Every other request falls through the dispatch at `server.ts:392-396` to `handleApi` or `handleStatic` [2].

Inside `handleApi` the request is read only as: `new URL(req.url)` (`server.ts:166`), `req.method` (`server.ts:207`, `:267`), two `req.headers.get(...)` calls (`STATS_ACTION_HEADER` at `server.ts:208`, `if-none-match` at `server.ts:295`), and `url.searchParams` [1]. There is no `req.json()`, `req.text()`, `req.body`, or `req.signal` anywhere in the body [11]. A constructed `Request` satisfies all of it.

Importing the module starts nothing. `startServer` is not called at module scope; `ensureClientBuild` — which shells out to `bun run build.ts` at `server.ts:147` — is invoked only from `startServer` at `server.ts:496` [3]. Module-level work is a base64 sniff, two `path.join` calls, and reads of `PI_COMPILED` / `PI_BUNDLED` [3].

**The exact code** is a wrapper of roughly 15 lines:

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

Two things about that import. First, `handleApi` is **not** re-exported from the package root — `index.ts:11-39` exports `formatStatsDashboardUrl`, `startServer`, `getDashboardStats`, `syncAllSessions`, `refreshRollups`, `closeDb`, and types, but not `handleApi` [10]. The deep subpath is nonetheless legal: the package's `exports` map declares `"./*": { "import": "./src/*.ts" }` [10], and first-party code already deep-imports `@oh-my-pi/omp-stats/aggregator` and `@oh-my-pi/omp-stats/db` [21]. Second, that deep subpath does not load out of the box in an extension on this version [15] — which §2 solves with a declared dependency rather than a workaround [44]. F9 confirmed the import end to end: `handleApi ok: true status: 200`, with `GET /api/stats/overview?range=7d` returning the keys `byAgentType`, `overall`, `timeSeries` [44].

**One caveat, and it is smaller than it looks.** `initDb()` is not read-only: it opens the DB read-write, sets `PRAGMA busy_timeout = 5000` and `PRAGMA journal_mode = WAL`, then runs a `CREATE TABLE IF NOT EXISTS` block and backfill sentinels [7]. But it produced **no mutation** — 866.9 ms with mtime and size byte-identical before and after [44], independently confirmed by F2 [12]. It has write *intent*, not write *effect*, and the panel should load behind the loading state to cover the ~867 ms. Two things must still not be called from the panel's load path: `/api/sync`, which starts real background ingest writing to that file [1], and that ingest hub is the one piece of module state `handleApi` genuinely touches — `statsLive().requestSync()` [1], a lazily-constructed singleton [4] whose `start()` is only called from the SSE endpoint [1]. Reading `.status()` touches it without starting anything [11]. For explicit ingest, see §6.1.

### 2. Where the seam should go

**Recommendation: reuse the package. Strategy 4 (declared dependency) as primary, Strategy 2 (PATH discovery + absolute import) as fallback.** [44]

F5 established that a bare `@oh-my-pi/omp-stats/*` specifier fails in the loader [15]. That finding is correct but its conclusion was premature, and F9 closes it by running four import strategies in the real loader [44]:

| strategy | result |
|---|---|
| 1 — `Bun.plugin` `onResolve` hook | **structurally impossible** — Bun 1.4.2 never offers the hook a bare specifier, only post-resolution absolute paths; proven with a synthetic package [44] |
| 2 — discover host root by realpath-ing `omp` on `PATH`, then absolute-path import | **works**, portable, no install step [44] |
| 3 — subprocess worker with `NODE_PATH` set | **works** [44] |
| 4 — declare `"@oh-my-pi/omp-stats": "18.4.10"` + `bun install` | **works**, and makes the plain bare specifier work [44] |

Strategy 4 is the primary because it installs `pi-natives-darwin-arm64` — the exact sibling whose absence caused the original failure — so `loadNative()` succeeds where the flat-cache install does not [44]. The install is 12 packages in **146 ms** [44], verified from both a standalone directory and a subdirectory of `~/.omp/agent/extensions/` [44]. That keeps the extension source idiomatic: no absolute paths, no `NODE_PATH`, no plugin gymnastics.

Strategy 2 is the fallback because realpath-ing the `omp` shim on `PATH` works reliably and needs nothing installed [44]. Note that `Bun.resolveSync` is **not** usable for host discovery — it returns the same broken flat-cache path [44].

What this changes, concretely. Reusing the package keeps four things that owning SQL would have discarded:

- **`handleApi`**, verified returning HTTP 200 for `GET /api/stats/overview?range=7d` with top-level keys `byAgentType`, `overall`, `timeSeries` [44].
- **The aggregator and rollup functions** — 16 exports from `/aggregator` and 20 from `/rollup`, enumerated at runtime [44].
- **The shared types** — `/shared-types` and `/types` are pure type modules reachable via `import type` [44].
- **`syncAllSessions`** — reachable at all, which is the subject of §6.1.

The cost is an install step, a committed `bun.lock`, a `node_modules/` inside the extension directory (~180 MB for the native addon), and a version pin to match the host [44]. That is the correct trade for a reusable extension, and it is the price of upstream compatibility.

**Import surface, precisely.** `@oh-my-pi/pi-tui` resolves from a static import with 359 named exports, verified in the real loader [15] — that remains the cleanest surface. `@oh-my-pi/pi-tui/overlays/*` is a deep path outside the public barrel [18], so `buildHeatmapLayout` is importable today but uncurated, with no stability guarantee [18][38]. The `/usage` mount, load and key-handling idioms are ~40 and ~60 lines and are better copied than imported [38][33].

### 3. Measured performance, and what it means for an interactive panel [measured]

`bun:sqlite` is synchronous. That single fact drives everything: any query runs on the thread that paints the panel.

**Table A — the package's own getters, end-to-end, on a 304.5 MB / 183,845-row DB copy** [12]:

| query | 7d ms | 30d ms | 90d ms | all ms |
|---|---|---|---|---|
| overall | 18.9 | 10.7 | 23.1 | 17.9 |
| by model | 17.1 | 9.4 | 19.3 | 17.6 |
| by folder | 2.4 | 1.5 | 3.1 | 2.9 |
| time series (daily) | 7.1 | 2.7 | 5.3 | 4.7 |
| cost series (daily) | 2.1 | 1.2 | 2.6 | 2.6 |
| model performance series | 6.8 | 3.6 | 7.9 | **31.5** |
| tool stats | **22.7** | 9.8 | 21.8 | 21.5 |

Composite: `getDashboardStats("30d")` (all 8 queries) **10.0 ms**; `getToolDashboardStats("30d")` **6.7 ms**; `getRecentRequests(100)` **0.5 ms**; `getRecentErrors("30d", 100)` **0.7 ms**. One-time per process: `initDb()` **864.1 ms**. And `getDailyActivity(371)` — a `GROUP BY day` over every `messages` row — **195.6 ms** [12].

**Table B — the same logical queries, hand-written, on a `{ readonly: true }` handle** [12]:

| query | 7d ms | 30d ms | 90d ms | all ms |
|---|---|---|---|---|
| overall | 1.0 | 0.3 | 0.6 | 0.2 |
| by model | 1.0 | 0.4 | 1.0 | 0.4 |
| time series (daily) | 1.0 | 0.3 | 0.7 | 0.3 |
| tool stats | 0.1 | 0.3 | 1.0 | 0.8 |

F5 independently measured the read-only path inside the real loader process: open **0.1 ms**, `COUNT(*)` over `message_rollup` (1,907 rows) **0.3 ms**, a 5-row `GROUP BY` over `message_rollup` **8.8 ms** cold [15].

**The Table A / Table B discrepancy, and which is honest.** They disagree by roughly 10× on the same logical query — by model is 17.6 ms through `getStatsByModel` and 0.4 ms through equivalent hand-written SQL [12]. The cause is not data volume. Every package getter calls `dirtyIsSmall()`, a separate `SELECT COUNT(*) … FROM rollup_dirty` [5], and then re-`prepare()`s a fresh, large, non-cacheable UNION statement on each call; the hand-written probe ran its statement twice and timed only the warm one [12]. Both numbers are real. **Table A is the honest end-to-end cost if you call the package. Table B is the honest cost if you hand-roll.** Neither is a warm-statement best case — which is exactly the decision this section feeds.

**What it implies.** F9 then measured the package's own `getDashboardStats` on a copy of the live DB, three runs per range in a second process [44]:

| range | run0 | run1 | run2 | note |
|---|---|---|---|---|
| `1h` | 434.2 | **4.8** | **4.8** | run0 is first-query page-cache warmup, not rollup cost |
| `24h` | 1.2 | 1.2 | 1.2 | |
| `7d` | 6.4 | 6.1 | 5.8 | |
| `30d` | 9.9 | 9.5 | 9.5 | |
| `90d` | 14.1 | 13.8 | 14.0 | |
| `all` | 13.4 | 12.9 | 13.0 | |
| `365d` | 1.2 | — | — | **invalid key — silently falls back to the `24h` default** |

**This closes the `1h` question.** It bypasses the rollup tables exactly as suspected [5] and costs no more than the rollup-backed ranges — 4.8 ms warm against 12.9–13.4 ms for `all` [44]. Every range is under 20 ms warm [44], so no range needs a subprocess and no range needs to be dropped from a range picker.

**One bug to know about before wiring a picker.** `365d` is not a valid key and silently resolves to the `24h` default — `getTimeRangeConfig` falls through `TIME_RANGES[normalized] ?? TIME_RANGES[DEFAULT_TIME_RANGE]` [13], and confirmed live: the `365d` cutoff is bit-identical to the `24h` cutoff [44]. A picker offering "365 days" would show 24 hours of data with no error. The valid set is exactly `1h | 24h | 7d | 30d | 90d | all` [13].

Against Table B's 0.1–1.0 ms, a package-backed frame costs one to two orders of magnitude more — 12.9 ms for a full `all`-range dashboard payload [44]. That is not perceptible, and it buys `handleApi`, the aggregator projections, the shared types and `syncAllSessions` for nothing extra.

Three numbers still constrain the design:

- **866.9 ms `initDb()`** [44], matching F2's 864.1 ms [12]. A synchronous stall of most of a second on the TUI thread on first open. It produced **no file mutation** — mtime and size byte-identical before and after [44] — so this is write *intent*, not write *effect* [7]. It is an argument for loading behind the loading state, not for owning SQL.
- **195.6 ms `getDailyActivity`** [12]. This is the query that forced `/usage` to run SQLite in a `SIGKILL`-able subprocess — the author's stated reason is that `bun:sqlite` is synchronous and the scan "froze the TUI for the whole load when it ran inline" [21]. A rollup-backed panel does not call it.
- **`initDb()` returns `null` until first run, and every rollup getter then degrades silently** to `[]` or a zeroed aggregate [5]. A panel that queries before init shows an empty dashboard with no error. This is the one data-layer trap that survives the reversal, because it applies equally to the reused package.


Worth noting what is *not* a problem: concurrency. The DB is in WAL mode with `busy_timeout = 5000` on the package's handle, and a read-only reader completed `SELECT COUNT(*) FROM message_rollup` in **0.9 ms** and **0.1 ms** while another connection held an open `BEGIN IMMEDIATE` write transaction [12]. A write from a read-only handle fails immediately with `SQLITE_READONLY`, not `SQLITE_BUSY` [12] — read-only is a hard guarantee, not a convention. F5 confirmed the file's mtime and size are byte-identical before and after a read-only query session on the live DB [15].

### 4. TUI primitives and the reference implementation to copy [verified]

The mount point is `ctx.ui.custom<T>(factory, { overlay: true, overlayOptions })`. The factory signature is `(tui, theme, keybindings, done) => Component | Promise<Component>`, and the host calls it with the real `TUI` at `extension-ui-controller.ts:1196` [17]. With `overlay: true` the host calls `showOverlay(component, overlayOptions ?? { anchor: "bottom-center", width: "100%", maxHeight: "100%", margin: 0 })` at `extension-ui-controller.ts:1204-1213` [17] — so `overlayOptions` *replaces* the default, it does not merge.

The reference implementation is **`pi-tui/src/overlays/usage-dashboard.ts`**, which is the component `/usage` mounts full-screen via `#showFullscreenMenu` at `selector-controller.ts:181-192` and `:347-389` [24]. The copy-this object is the overlay options constant, read verbatim out of a shipped extension at `custom-commands/bundled/annotate/fullscreen.ts:13-20` [16]:

```ts
const STATS_OVERLAY_OPTIONS = {
    width: "100%", maxHeight: "100%", margin: 0,
    fullscreen: true, mouseTracking: false,
} as const;
```

`fullscreen: true` borrows the alternate screen buffer — the vim/less idiom — so the transcript stays untouched [25]. `git-tui.ts:1210-1228` is the second reference for the `try { await component.run() } finally { component.dispose(); overlay.hide() }` shape [26].

**What to copy from `usage-dashboard.ts` and what not to.** Its load idiom is right: a fire-and-forget constructor call, a push callback, an `AbortController`, and a dim one-line loading state rather than a spinner (`if (!points) return [theme.fg("dim", "Loading usage history…")]`) [11]. Its scrolling is right: a plain clamped integer, recomputed inside `render()`, with height read fresh from `process.stdout.rows` each frame because there is no resize hook [11]. Its key handling is right: `routeSgrMouseInput` for the wheel, then `matchesSelectCancel` for Esc, then raw `matchesKey` for literal letters, then `matchesSelect*` for arrows and paging [11].

Its *component usage* is wrong for this panel. It hand-rolls every row and instantiates only `OverlayPanel`, `PanelDivider`, `PanelRows` from `@oh-my-pi/pi-tui/chrome` [11] — because it wants byte-exact column geometry across multiple cards. A single-pane stats panel should use the kit instead. All of these construct and render inside the real loader process (F5 measured them live) [15], and the constructor signatures are listed in [31]:

| need | use | import |
|---|---|---|
| frame | `OverlayPanel` + `PanelRows` + `PanelDivider` | `@oh-my-pi/pi-tui/chrome` [27] |
| numbers table | `renderTableRow(cells, columns, maxWidth?, options?)` | `@oh-my-pi/pi-tui` — free function, not `Table` [15] |
| metric grid | `KeyValueList` (`setRows` for updates) | `@oh-my-pi/pi-tui` [15] |
| stat strip | `MetricRow` (a `value: undefined` omits the metric) | `@oh-my-pi/pi-tui` [15] |
| quota bars | `renderProgressBar(...)` — free function, 4 first-party call sites; the `ProgressBar` class has 0 [11] | `@oh-my-pi/pi-tui` [15] |
| scrolling pane | `ScrollView` (owns its offset, has `handleScrollKey`) | `@oh-my-pi/pi-tui` [15] |
| headers | `Section` | `@oh-my-pi/pi-tui` [15] |
| heatmap | `buildHeatmapLayout` + hand-written ANSI cells | `@oh-my-pi/pi-tui/overlays/usage-dashboard` [11] |

Three corrections to the task brief that would cost real time if carried into implementation [11][15]:

- **There is no `theme.colors`.** The API is `theme.fg(color, text)` / `theme.bg(color, text)` with a `ThemeColor` string union (`"accent" | "border" | "borderAccent" | "borderMuted" | "success" | "error" | "warning" | "muted" | "dim" | "text"`) [28].
- **The `keybindings` argument to the factory is useless for resolution.** It is `KeybindingsManager.inMemory()` at `extension-ui-controller.ts:1156` [17] — defaults, not the user's `keybindings.yml`. Use `matchesKey()` and `matchesSelectCancel()`, which read the module-global singleton [29].
- **`ScrollViewport` and `Metric` do not exist.** They are `ScrollView` and `MetricRow` [15].

Two runtime traps F5 hit for real [15]: `Table` cells must be `{ text, style? }` objects — passing raw strings throws `undefined is not an object (evaluating 'e.replaceAll')` — and importing the `theme` binding at module scope throws at extension load time, because theme init has not run. Use the `theme` passed to the factory. Do not import it.

Skip the native/TSP rendering backend for v1. `usage-dashboard` implements `describe(cx)` and `handleNativeEvent` with a capability probe and an ANSI fallback [11]; that is a second rendering backend, and the ANSI path is what we can rely on.

### 5. Packaging, dependency resolution, and the dev loop

**Packaging is small and unvalidated.** `PluginManifest` is a plain TypeScript interface at `plugins/types.ts:28-47` [32], not a schema; the complete key set is `name?`, `version`, `description?`, `tools?`, `hooks?`, `extensions?`, `commands?`, `features?`, `settings?` [32]. `omp.name`, `omp.commands`, `omp.agents`, `omp.rules`, `omp.mcp`, `omp.lsp`, `omp.skills` are **not** manifest keys — do nothing. Content belongs in conventional directories [14]. `extensions` paths are relative to the package root and authoritative when non-empty; `version` inside `omp` is overwritten from `package.json` [14]. The whole package is a `package.json` plus `src/index.ts`.

**Dependency resolution — three findings files disagree, and the progression matters.** F4 concluded that `@oh-my-pi/omp-stats` resolves, reporting a stub extension that got past both imports and failed only on a fabricated export name [14]. F5 ran the decisive in-loader test and found it **does not** load as a bare specifier [15]. F9 then established that the problem is solvable rather than structural, and that F5's control — the bare specifier — is the only one of four strategies that fails for an unfixable reason [44]. F5 was right about the symptom and wrong about the conclusion; F9 supersedes it.

The reason F4 read the evidence optimistically is visible in its own quoted path: that *is* the wrong resolution root. `PI_PACKAGE_NAMES` lists exactly seven host-resolved basenames — `pi-agent-core`, `pi-ai`, `pi-catalog`, `pi-coding-agent`, `pi-natives`, `pi-tui`, `pi-utils` [20] — and `omp-stats` is not among them. The shim declines it, the generic bare-dependency resolver takes over, walks `node_modules` upward from the extension's own directory [20], falls through to Bun's **global install cache**, and lands on a flattened per-package copy that has no sibling `pi-natives-darwin-arm64` next to it — the native `.node` file lives in the sibling package, not in the cache entry [15]. **F5 supersedes F4.** F4's own gap list flagged the cache path as accidental and the "harness run" as degraded; F5 is the controlled, in-loader retest.

**What F9 adds is the fix, not a confirmation.** The allowlist is not the wall: declaring the dependency installs the missing sibling alongside `pi-natives`, so `loadNative()` succeeds [44]. One detail worth recording — the failure is *not* "cannot resolve `@oh-my-pi/omp-stats`". Bun resolves it fine, into the flat cache; it is the transitive `pi-natives` load that dies [44]. That is why Strategy 3's subprocess also failed without `NODE_PATH`, and why `Bun.resolveSync` is useless for host discovery — it returns that same broken path [44].

F5 also found that **dynamic `import()` of any `@oh-my-pi/*` fails in the loader, even for `pi-tui` and `pi-coding-agent`**, which work fine as static imports (359 and 698 named exports respectively). F5's reading is that the loader's resolve hook rewrites the specifier for static imports only, and the dynamic path re-enters resolution into the flat cache instead [15]. The mechanism is inferred from the observed split, not traced to a source line. **Static imports only** [15].

F5's workaround table, all measured in the real loader [15]:

| approach | result |
|---|---|
| bare `@oh-my-pi/omp-stats/*` | **fails** — pi_natives |
| absolute path `…/omp-stats/src/server.ts` | works, `handleApi=function` — machine-specific, version-coupled |
| relative path from the extension file | works |
| runtime-computed absolute path + dynamic `import()` | works |
| local `node_modules` with a complete tree (`bun install` in a plugin dir) | works — 12 packages, 168 ms |
| `bun:sqlite` direct, no `omp-stats` import | works — open 0.1 ms, queries 0.3–8.8 ms |

F9 re-tested the same territory with the host-root discovery walk added, and the ordering of preference is now settled [44]: **declared dependency first** (12 packages, 146 ms, makes the bare specifier work), **host-root realpath second** (no install), and `bun:sqlite` direct is no longer on the table because the last row of the problem — reusing the package — is no longer in question.

**Dev loop.** There is no hot reload and no watcher. Modules are never unloaded or re-evaluated; a newly added extension file requires a restart [14]. `ctx.reload()` re-runs discovery but does not re-evaluate modules [14]. Logs go to `~/.omp/logs/omp.<DATE>.<PID>.log`, never to the console [14]. Load failures appear as TUI notifications and stderr lines [14] [15].

The lowest-friction loop is `omp --extension /abs/path/to/src/index.ts` with `tail -f ~/.omp/logs/…` — no install step, one file to watch [14]. For a persistent install, `omp plugin link <dir>`; to isolate from other plugins and config, `omp --profile <name>`; to suppress ambient extensions while debugging a single module, `omp --no-extensions -e /abs/path/src/index.ts` [14]. Note the flag-ordering trap: with `omp models -e <file>` the extension loads, but `omp -e <file> models` silently ignores it — `-e` must follow the subcommand [15]. omp ships no extension test harness; the installed package contains one `*.test.ts` total, none under `src/extensibility/` [14]. Use plain `bun test` on pure functions exported from a non-entry module, and the non-interactive `omp models` probe for anything that must be exercised inside the real loader process [15].

### 6. Correctness traps

**(a) Cached vs fresh tokens.** There is no `cachedTokens` field on `AggregatedStats` [8]. Fresh input is `totalInputTokens`; cached input is split into `totalCacheReadTokens` and `totalCacheWriteTokens`, and `cacheRate = totalCacheReadTokens / (totalInputTokens + totalCacheReadTokens)` — cache **writes are excluded from the rate denominator** [6]. `cacheSavings` is a dollar-savings *ratio*, not a token count [6]. The trap is magnitude: one model on this DB shows 4.3 **billion** total tokens, almost entirely `cache_read_tokens` [18]. A panel that prints total tokens without splitting them is useless and actively misleading.

**(b) Unpriced requests.** There is no `cost_unpriced` amount on the aggregate types. `unpriced` is a **count** — `unpricedRequests: number` on `AggregatedStats`, `ProviderAggregate`, and `CostTimeSeriesPoint`, and a *fraction* (`unpricedRequestsShare`) on tools [12]. Semantics, verbatim: "Ingest refused to price this request: a scheduled (time-based) card with no recoverable request timestamp, so `usage.cost.total` of 0 is unknown spend rather than a free request" [9]. **Panel rule: `totalCost` silently under-reports by the unpriced requests.** Several top models price at exactly `$0.00` [18]. A truthful panel renders `unpricedRequests` beside cost, always.

**(c) Rollup staleness.** Above 96 dirty hours (`EXACT_DIRTY_LIMIT`) reads stop unioning dirty hours and read stale rollup rows — "stale-but-present; not-yet-built hours are missing" [5]. On the measured DB `rollup_dirty = 0` and `session_dirty = 0`, so this was never exercised [12]. `getRollupStatus()` returns `{ dirtyHours, dirtySessions }` [6] and is the guard; a panel that omits it will show holes as zeroes after a `ROLLUP_VERSION` bump, which DROPs and rebuilds every rollup row [5].

**(d) Write intent vs write effect.** `initDb()` opens the DB read-write and runs `CREATE TABLE IF NOT EXISTS` plus pragmas [7] — it has write *intent*. In practice it produced **no mutation**: 866.9 ms with mtime and size byte-identical before and after [44], independently matched by F2's byte-identical result [12]. So the earlier framing in this report — that a TUI "must" open `bun:sqlite` read-only — was overstated. The real, surviving hazard is different: `currentDb()` at `db.ts:83-86` returns `null` until `initDb()` has run [7], and every rollup getter then degrades **silently** to `[]` or a zeroed aggregate (`if (!database) return []` at `rollup.ts:508`, `:516`, `:856`) [5] — a panel showing an empty dashboard with no error. There is no `readonly` option and no injection point in the package [12], so *if* we want a hard write guarantee we still open our own read-only handle, but that is now a preference, not a requirement.

**(e) Mode guards.** `ctx.hasUI` is `false` in print/headless/RPC/ACP modes, and `custom()` is implemented as unsupported UI in RPC, returning `undefined as never` [19]. RPC can report `hasUI === true` while still not supporting `custom()`, so `hasUI` alone is not a sufficient guard [19]. Use `ctx.mode === "tui"` before mounting [18]. Separately, `done(...)` must be called exactly once [19], and `dispose()` must be idempotent — the host also calls `component.dispose?.()` in its own cleanup at `extension-ui-controller.ts:1161-1176`, after the overlay is hidden [17].

**(f) Functions to keep off the load path.** `getProviderWindowStats` does network I/O to a broker fetch [11]; `getRequestDetails` reads transcript files off disk [11]. Neither belongs in a panel's initial load. `syncAllSessions` is the interesting case and gets its own subsection below — it is now *reachable*, which it was not before.

#### 6.1 The sync decision [measured]

Reusing the package makes `syncAllSessions` callable, and F9 measured exactly what that costs [44]:

```
syncAllSessions: {"processed":151107,"files":3401} ms: 7141.3
AFTER sync: {"mtimeMs":1790949787842.1973,"size":321871872}
```

**7141 ms** for 3401 files and 151,107 rows on a warm page cache, and it genuinely writes — the DB copy grew 305.6 MB → 307.1 MB, with mtime and size both changed [44]. Because `bun:sqlite` is synchronous, running it inline freezes the TUI for seven seconds.

**Lock contention is a block, not a hang — this corrects an earlier overstatement.** `withStatsSyncLock` at `aggregator.ts:75` [30] is `withFileLock` with `retryDelayMs: 25` and `retries = 144000` [30]. A test that held the lock for 4 s saw `syncAllSessions` acquire after **3660 ms** [44]. The wait is `await`-based, so the extension's async continuations keep running and it acquires as soon as the holder releases [44]. The hazard is therefore not deadlock and not the one-hour timeout — it is that a multi-second stall sits on the caller's promise with no cancellation, while the work itself is synchronous SQLite holding the lock on the main thread [44].

**Consequence: any sync must be out-of-band.** The first-party `/usage` view already solves exactly this — it spawns a worker, streams results over a pipe, and the parent `SIGKILL`s the child once `done` arrives, specifically because "the synchronous SQLite work never runs on the TUI thread" [21]. That is the shape to copy, and it composes cleanly with Strategy 4's install (the worker resolves the same way) [44]. Queries themselves need no subprocess: every range is under 20 ms warm [44].

Prefer not to sync from the panel at all unless the host has not already synced — whether the host syncs before an extension runs was **not determined** [44], and that is worth checking before building the button.

### 7. Anatomy of `/settings` and `/usage` — the two templates [verified]

These two are siblings, and that is the most useful structural fact available to us. Both mount through one helper, `SelectorController.#showFullscreenMenu` at `selector-controller.ts:181-192` [24][36], with the options object verbatim [24]:

```ts
{ anchor: "bottom-center", width: "100%", maxHeight: "100%", margin: 0, fullscreen: true }
```

`fullscreen: true` borrows the alternate screen buffer, so the transcript stays untouched [25]. `mouseTracking` is **omitted** in both, which means it defaults to on [36] — which is why `SettingsSelectorComponent` parses SGR mouse reports in `handleInput` [36]. Our mount from `ctx.ui.custom` should pass `mouseTracking: false` explicitly unless we implement clicks; the shipped extension template at `annotate/fullscreen.ts:13-20` does exactly that [16].

The two components:

- **`UsageDashboardComponent`** — `pi-tui/src/overlays/usage-dashboard.ts:533` [38]. Data-heavy, read-only, async-loaded, self-scrolling, frame-composed as `OverlayPanel` + header/body/`PanelDivider`/footer `PanelRows` regions [38].
- **`SettingsSelectorComponent`** — `pi-tui/src/overlays/settings-selector.ts:615` [36]. A settings form: mutating config, search-driven, mouse hit-tested against absolute screen rows, and composing its frame manually from `topBorder`/`row`/`divider`/`bottomBorder` [36][37].

**Recommendation: `UsageDashboardComponent` is the structural template.** It wins on every criterion that matters for a read-only stats panel — it is data-heavy, read-only, has a streaming loader with distinct loading and error states, manages its own scroll offset, and uses the `OverlayPanel` region abstraction rather than hand-assembling borders [33]. `SettingsSelectorComponent`'s manual frame composition and its full mouse hit-testing are the parts we do not need [33]. What is worth taking from `/settings` is narrower and specific: the **frame composition** — title border with an inset title, tab strip, dividers, and a footer hint pinned above the bottom border, with fixed chrome rows computed first and the remainder given to content [36]. Its footer-hint idiom is the better one, because the hints follow the user's real keybindings via `editorKey`/`editorKeys`/`formatKeyHint`, joined with `·` [36]. `/usage` does this too [38], so either source works.

Three idioms from `/usage` that are worth copying verbatim, all verified in source [38]:

1. **Scroll clamping happens in `render`, never in the key handler.** `#scrollBy` just adds and calls `requestRender`; the clamp to `maxScroll` happens during render, which makes shrink-on-resize automatic for free [38].
2. **Escape is two-level** — detail → overview → close, with `q` aliased to cancel, and Enter/Tab/`d` all toggling into detail [38].
3. **The footer hint is conditionally composed.** The scroll hint appears only when `maxScroll > 0`, the refresh hint only when a `refresh` callback exists [38]. The title is mutated per view (`"Usage"` → `"Usage · Details"`) and the header row carries a live freshness stamp [38].

**`buildHeatmapLayout` is a genuinely reusable export.** It is `export`ed from `usage-dashboard.ts:313` [38], so it is importable, and its input type is already ours — `DailyActivityPoint` is defined in `@oh-my-pi/omp-stats/shared-types`, not in pi-tui [38].

```ts
export function buildHeatmapLayout(
  points: DailyActivityPoint[],   // { day: string; cost: number; requests: number }
  weeks: number,
  today = new Date(),
): HeatmapLayout
```

where `HeatmapLayout` is `{ monthLabels: (string | undefined)[]; cells: (number | null)[][]; totalCost: number; totalRequests: number; start: Date }`, with `cells` indexed `[day][week]`, Monday-first, levels 0–4, and `null` for future days [38]. Its design decisions are worth stealing regardless of whether we import it: intensity is **magnitude**, not rank quartile (`ceil(sqrt(value/max) * 4)` clamped 1–4); the metric falls back from `cost` to `requests` when nothing in range has priced usage; all date maths is local-timezone and day keys are `YYYY-MM-DD` strings, which is why the range filter is a plain string compare [38]. `totalCost`/`totalRequests` are summed over the in-range subset only, so the header number matches the grid [38].

One caveat from F6: `buildHeatmapLayout` rebuilds the entire grid on every call and its cost is **unmeasured**; at 53×7 = 371 cells per frame it is probably fine, but cache it per `(points, weeks)` the way `#detailLines` caches per width [33].

### 8. Scope of the web dashboard [measured]

This answers the "I just want to port the web UI" position directly, with line counts.

The dashboard is an 11-screen React 19 SPA. Measured on this install [41]:

| measure | lines |
|---|---|
| `src/client/**/*.tsx` (41 files) | **9,244** |
| the 11 route components | **5,348** |
| `src/client/charts/*` (all files) | **637** |
| `src/client/traces/*` (9 files) | **2,126** |
| `src/client/ui/*.tsx` | **1,030** |
| `src/client/**/*.css` (does not transfer) | 2,504 |

Largest single screen is `ProvidersRoute.tsx` at **1,050 lines**; largest by feature breadth is `FrustrationRoute.tsx` at 924 [34][41]. The per-file route counts, measured [41]: Providers 1,050 · Frustration 924 · Models 576 · Tools 572 · Costs 424 · Errors 421 · Projects 319 · Overview 314 · Requests 311 · Gain 229 · Traces 208.

**Three corrections to F7's own numbers**, all found by re-measuring [41]:

- F7 states the route total as **4,637** [34]. The actual sum is **5,348**, which is also what `wc -l routes/*.tsx` reports [41]. F7's own per-file table sums to 5,348, so its headline total is an arithmetic slip and the table is right. Use 5,348.
- F7 states 85 `.tsx` files [34]. There are **41** [41]. The 9,244-line total is correct [41], so the line count is right and only the file count is wrong.
- F7 states `charts/*.tsx` alone is 589 [34]. Measured: **584** [41]. The 637 figure — all files in the directory, including `types.ts` and the barrel — is correct [34][41].

**The chart layer is cheap; the screens are not.** Six chart components totalling 637 lines, of which `Chart.tsx` (388) is the only genuinely hard file [34]. `Sparkline` (38), `BarList` (49), `ShareBar` (26) and `Legend` (61) are all trivial text-renderable substitutes [34]. `TimeChart` (22) is a wrapper, not a renderer [34]. No chart needs gradients, so nothing is un-portable for rendering reasons — the un-portable thing is **interaction**: hover tooltips have no terminal affordance, and the Traces timeline is built around cursor-anchored wheel zoom, drag pan and a draggable viewport brush [34].

**Verdict: porting all 11 is a large rewrite, not a task.** 5,348 lines of routes, 2,000–3,000 lines for a mechanical port, and Traces (2,126 lines) is a different application that should be excluded rather than ported [34].

**Sensible v1 subset:** Overview, Models, Costs, Projects — plus one shared `renderBarChart`/sparkline/barlist/sharebar module (~400–500 lines), one shared stat-grid and sortable-table renderer (~300 lines), `data/view-models.ts` reused unchanged at 469 lines and `data/formatters.ts` at 98 [34][41]. Estimated **~1,200–1,800 lines** of new TUI code for those four screens plus the shared primitives [34].

**What `/usage` already covers, which is more than it looks like.** One of the 11 screens is *partially* covered — the provider subscriptions grid with per-window mini-bars and ok/warn/exhausted colouring is the Providers screen's subscription-window half [34] — plus two features the web UI does **not** have: a year-long daily activity heatmap fed from the local stats DB, and a quota/limit detail text view [34]. Not covered at all: overview activity series, models, costs, the requests log, errors, traces, tools, frustration, projects, gain, and Providers' data half (burn chart, hour-of-day, per-account utilization) [34].

### 9. Glyph and visual language [measured]

Recommendation per visual type, each grounded in a measured call site rather than taste.

| visual | use | why |
|---|---|---|
| bars, sparklines | eighth blocks `▁▂▃▄▅▆▇█` (U+2581–U+2588), one column each | The `SPECTRUM_BLOCKS` idiom already exists at `live-visualizer.ts:41` [39]; 8 sub-cell levels per cell, exactly one column wide so layout maths never breaks [35] |
| calendar heatmap | `■` U+25A0 cell + `·` U+00B7 empty, exactly as `/usage` `#renderHeatmap` does; colour carries the buckets via `#heatRamp` | Already proven at `usage-dashboard.ts:822-872` [38]; the ramp is four truecolor stops at t = 0.3/0.5/0.72/1.0 interpolated from a background anchor to the theme accent, so it degrades to 256-colour automatically via `colorToAnsi(hex, theme.getColorMode())` [38] |
| per-model comparison | `renderProgressBar` with `theme.symbol("progress.filled")` / `theme.symbol("progress.empty")` | This is verbatim what `pi-tui/src/tools/find.ts:120-126` does for its score gauge [43]; reusing the free function inherits theming, width clamping and truncation for free |
| box drawing | pi-tui's `OverlayPanel`/`Box` + `theme.boxRound` | U+2500–U+257F is `East_Asian_Width=A` — narrow in a Western terminal, possibly wide in a CJK one — so a hand-rolled frame tears [35]. The ascii preset maps it to `+ - |` [33][39] |
| emoji for data ink | never | Width instability, and omp already confines emoji to icon slots [35] |

**Braille: no.** Direct answer, for both cases asked about.

- **It is a 2×4 raster, not a bar chart.** U+2800–U+28FF is an 8-dot bitmask over 2 columns × 4 rows. There is no column height in it; every braille terminal plot is doing point/line rasterisation [35].
- **Per-cell colour is impossible.** Points sharing a character cell share one foreground colour [35]. A heatmap *is* per-cell colour — braille destroys exactly the channel the heatmap needs, and also prevents tinting day N differently from day N+1 [35].
- **Aspect is wrong without a 2:1 fudge**, because cells are taller than wide, so a braille calendar must be hand-tuned per terminal — bad for a panel that reflows on resize [35].
- **Worse tofu fallback.** A terminal without braille coverage renders replacement glyphs; eighth blocks have effectively universal UTF-8 coverage [35].
- **Unreadable at our size.** A calendar cell is one to three columns; a 2×4 dot matrix inside a one-column cell loses half its horizontal resolution for no gain [35].
- **Not suitable for a daily-bucket bar chart either** — eighth blocks give 8 vertical levels per cell, are trivially per-column colourable and share a baseline, which is strictly better for magnitude-from-zero data [35].

The only defensible later use is a dense single-colour cumulative line plot over 100+ samples, and it would be a per-series opt-in gated on `theme.getSymbolPreset() !== "ascii"` [35].

**One correction to F8's claim that braille is NOT FOUND in first-party code.** It is found — but only as terminal-title spinner frames: `tui.titleSpinner` offers `["braille", "pulse", "dots", "line"]` with braille the default, described in-source as "Classic ⠋⠙⠹ sweep", and the `line` option is explicitly "ASCII `- \ | /` for fonts without braille coverage" [42]. So the precedent is stronger than "absent": omp already treats braille as a decorative spinner glyph and *ships an ASCII-safe alternative for it*. It is still never used as a data mark [42]. That supports the verdict, but the report should not claim braille is unknown to the codebase.

**Nerd Fonts: the icons are real, but the preset is opt-in and never detected.**

- omp's icons are genuine Nerd Font codepoints, but **only in the `nerd` preset**. Measured from `SYMBOL_PRESETS` [39]: `cmd.stats` is `📊` U+1F4CA under `unicode`, `\uf080` U+F080 under `nerd` — annotated in-source as `nf-fa-bar_chart` at `symbols.ts:953` — and `""` (disabled) under `ascii` [39][40]. `icon.throughput` is `⚡` U+26A1 / `\uf0e4` U+F0E4 (`nf-fa-tachometer`, `symbols.ts:877`) / `tok/s:` [39][40].
- There are **three** presets — `SymbolPreset = "unicode" | "nerd" | "ascii"` [39] — chosen by a user setting, applied via `setSymbolPreset` [33]. There is **no Nerd Font probe**, no `TERM=dumb` handling anywhere (grep: zero hits), and `NO_COLOR` gates only hyperlinks, not `theme.fg` or symbol selection [35].
- There is no 16-colour mode. `ColorMode = "truecolor" | "256color"` only, and `detectColorMode` is the runtime accessor [40].

**Therefore: data ink must be plain Unicode, and every decorative glyph must go through the theme** — `theme.symbol(key)` at `theme-class.ts:463`, `theme.styledSymbol(key, color)` at `:470`, `theme.getSymbolPreset()` at `:477` [36]. Hardcoding a PUA codepoint breaks the `unicode` preset with a tofu box [35].

**Note that `/usage` itself violates this.** `#miniBar`'s `█`/`░` and the heatmap's `■`/`·` are hardcoded string literals, not theme symbols, so they bypass the ascii preset entirely [38][33]. That is a pre-existing inconsistency in first-party code, not a pattern to copy — and it is cheap for us to do better, since `theme.progress.filled`/`empty` already fall back to `=`/`-` under ascii [33][39].

## Open questions

Each of these needs an answer before implementation starts.

**1. Dependency and version strategy — now the only packaging decision left.**
Options: (A) Strategy 4, declared dependency + `bun install`, with Strategy 2 as fallback [44] · (B) Strategy 2 only, realpath discovery, no install · (C) both, with Strategy 2 attempted first and Strategy 4 as the documented install path.
Why it matters: (A) makes the bare specifier work and keeps the source idiomatic, at the cost of a committed `bun.lock` and a `node_modules/` of roughly 180 MB in the extension directory [44]; (B) needs no install but hardcodes the discovery walk and couples us to the `omp` shim's location [44]. The version pin matters twice over: a skew between our pin and the host's install silently breaks things.
Evidence that would settle it: F9 verified (A) from both a standalone directory and a subdirectory of `~/.omp/agent/extensions/` [44]. It was **not** tested on a machine lacking the global install, nor under `bun install --frozen-lockfile` in CI [44].
Recommended default: **(C)** — declare the dependency so `bun install` is the normal path, and keep the Strategy 2 realpath walk as a runtime fallback for users who cannot run it. Pin `@oh-my-pi/omp-stats` to the host version exactly, and read the host's version at load and warn on mismatch rather than failing silently.

**2. Which screens for v1?** Options, with the web-dashboard line counts they are ported from [34][41]:

| screen | web lines | v1 TUI estimate |
|---|---|---|
| Overview | 314 | ~150–250 |
| Models | 576 | ~200–300 |
| Costs | 424 | ~150–250 |
| Projects | 319 | ~100–150 |
| Errors | 421 | ~100–200 (table + BarList) |
| Requests | 311 | ~100–150 (table only) |
| Tools | 572 | ~200–300 |
| Providers | 1,050 | defer; limits half already exists in `/usage` [34] |
| Gain | 229 | ~100–150 |
| Frustration | 924 | exclude — paid judge job, no TUI equivalent [34] |
| Traces | 208 (+2,126 in `traces/`) | exclude — cursor-anchored flamegraph, not a dashboard [34] |

Plus shared primitives: one `renderBarChart`/sparkline/barlist/sharebar module (~400–500), one stat-grid + sortable-table renderer (~300) [34].

Why it matters: the four-screen subset is estimated at **~1,200–1,800 lines**; all eleven is a 5,348-line rewrite [34][41].
Evidence that would settle it: which numbers the user actually opens the panel for.
Recommended default: **Overview + Models + Costs + Projects**, matching the v1 subset [34]. That is ~1,200–1,800 lines including shared primitives. If only one screen ships, make it Overview.

**3. Range picker or cycling key — the range *values* are settled, the UI is not.**
Options: (a) cycling key through the six valid ranges · (b) a `SelectList` picker · (c) fixed ranges plus free-form start/end.
Settled: every range is viable, `1h` included at **4.8 ms** warm [44], and the valid set is exactly `1h | 24h | 7d | 30d | 90d | all` [13]. Not settled: whether `1h` should ship first or whether a picker is worth the `SelectList` plus re-query cost.
Why it matters: `365d` silently resolves to `24h` [13][44], so a picker offering "365 days" shows 24 hours with no error. That is a bug waiting to be written, and it is the main reason to constrain the option list explicitly.
Recommended default: **(a), a cycling key**, default `24h`, with the option list hardcoded to the six valid values and no free-form entry. Reserve (b) for v2.

**4. Sync: not at all, an explicit out-of-band action, or on open?**
Options: (A) never sync from the panel · (B) explicit key binding running a `SIGKILL`-able subprocess with a progress line · (C) sync automatically on open.
Why it matters: `syncAllSessions` costs **7141 ms** for 3401 files / 151,107 rows and genuinely writes [44]; inline, it freezes the TUI for seven seconds because `bun:sqlite` is synchronous [21][44]. Lock contention blocks rather than deadlocks — a 4-second holder saw the waiter acquire after 3660 ms [44] — so the hazard is a multi-second uncancellable stall on the main thread, not the one-hour timeout.
Evidence that would settle it: **whether the host already runs `syncAllSessions` before an extension executes** — that was explicitly not determined [44]. If it does, option (A) is correct and the button is dead weight.
Recommended default: **(A) for v1**, with `getRollupStatus()` [6] in the footer so staleness is visible. If a sync action is wanted, it must be (B) — subprocess, streamed progress, killed on close — never (C), never awaited during mount.

**5. Glyph policy — hardcode plain Unicode like `/usage`, or route through the theme?**
Options: (A) hardcode `█ ░ ■ · ▁▂▃▄▅▆▇█` as `/usage` does [38] · (B) route every decorative glyph through `theme.symbol()` / `theme.styledSymbol()` / `theme.getSymbolPreset()` [36] · (C) mixed — theme for chrome, hardcoded for dense data marks.
Why it matters: there is **no Nerd Font probe, no `TERM=dumb` handling, and no `NO_COLOR` glyph path** — `NO_COLOR` gates only hyperlinks [35]. The ascii preset maps box drawing to `+ - |` and `progress.filled`/`empty` to `=`/`-` [33][39], but it does **not** rescue `/usage`'s hardcoded `█`/`░`/`■`, which bypass the preset entirely [38][33].
Evidence that would settle it: nothing further — this is a policy call about which precedent to follow.
Recommended default: **(C)**. Use `theme.boxRound`/`OverlayPanel` for all chrome, `theme.symbol("progress.filled")`/`empty` for every bar that can afford it, and reserve hardcoded eighth blocks / `■` for dense marks only — with one explicit `getSymbolPreset() === "ascii"` branch that swaps in `=`/`-` and `#`. This is a small amount of extra code and it makes the panel correct under a preset `/usage` itself is not.

**6. Braille — confirm the recommendation is no?**
Options: (A) no braille anywhere · (B) braille for a dense cumulative line plot only · (C) braille for the daily bar chart.
Why it matters: braille is a 2×4 raster with no column height, per-cell colour is impossible, aspect needs a 2:1 fudge, and the tofu fallback is worse than eighth blocks [35]. It would break both the heatmap (which *is* per-cell colour) and the daily bars (where eighth blocks are strictly better) [35].
Evidence that would settle it: only a terminal-specific trial could change this, and it would have to be hand-tuned per terminal anyway [35].
Recommended default: **(A)**, with (B) as a possible v2 per-series opt-in gated on `getSymbolPreset() !== "ascii"` [35]. Worth knowing: braille is not unknown to omp — `tui.titleSpinner` defaults to a braille sweep and ships an ASCII-safe `line` alternative [42], which is precedent for treating it as decorative only, never as data.

**7. `buildHeatmapLayout` — import by deep path, or reimplement?**
Options: (A) `import { buildHeatmapLayout } from "@oh-my-pi/pi-tui/overlays/usage-dashboard"` · (B) reimplement the Monday-first week grid, ~40 lines.
Why it matters: the deep path is outside the public barrel [18], so it is uncurated with no stability guarantee [18][38]. The algorithm is small: Monday offset `(today0.getDay() + 6) % 7`, intensity `ceil(sqrt(value/max) * 4)` clamped 1–4, `cost` falling back to `requests`, local-timezone date maths, `YYYY-MM-DD` string keys [38].
Evidence that would settle it: whether the panel needs a heatmap at all in v1 — it does not, if v1 is Overview/Models/Costs/Projects (§2). If the heatmap is deferred, this question is moot for v1.
Recommended default: **(B), reimplement, ~40 lines** — and cache the result per `(points, weeks)`, since the function rebuilds the whole grid on every call and its cost is unmeasured [33]. Its input type is already ours: `DailyActivityPoint` lives in `@oh-my-pi/omp-stats/shared-types` [38][44], so we own the type regardless.

**8. What does "cached vs fresh" mean in the default view?**
Options: show `cacheRate` only · show fresh / cache-read / cache-write as three numbers · show tokens and cost separately for cached vs uncached.
Why it matters: the rate excludes cache writes from its denominator [6], so a panel showing only the rate understates the write cost, and `cacheSavings` can be negative [6].
Recommended default: **three separate token counts plus the rate**, with a footnote on the denominator, and `unpricedRequests` printed beside every cost figure.

**9. Does the host already sync before an extension runs?**
Options: yes, so the panel never needs to · no, so the subprocess sync is required · unknown, ship read-only and find out.
Why it matters: F9 flagged this as undetermined [44]. If the host syncs, a sync button is dead weight; if it does not, a panel that silently does not sync shows numbers that look stale right after a busy session [18].
Evidence that would settle it: read the extension/session bootstrap path for a `syncAllSessions` call, or run `/stats-tui` immediately after a heavy session and compare `getRollupStatus()` [6] against the freshest session file mtime.
Recommended default: **(C), read-only for v1**, then answer it empirically before building the button.

**10. How should the extension handle a host version skew?**
Options: pin exactly and fail loudly on mismatch · pin exactly and warn · use a caret range and let it float.
Why it matters: F9 verified Strategy 4 on a machine whose global install matched the pin [44], and did not test a skew [44]. A version mismatch between the extension's `@oh-my-pi/omp-stats` and the host's is the failure mode most likely to bite a real user, and it manifests as an obscure load failure rather than a clear error [15].
Evidence that would settle it: a deliberate skew test — pin `18.4.9` against a `18.4.10` host and record the failure mode.
Recommended default: **pin exactly, warn on mismatch, degrade to Strategy 2** rather than refusing to load. A panel that still opens with the host's own copy beats one that refuses to mount.

## Sources

All sources are on-disk files in the omp installation at `/Users/yuzu/.bun/install/global/node_modules/@oh-my-pi/`, the project's own research documents, or `omp://` documentation. Line numbers are from the versions read on 2026-10-02, omp 18.4.10.

1. `omp-stats/src/server.ts:165-329` — `handleApi` export, signature, route dispatch, request reads. [primary]
2. `omp-stats/src/server.ts:364-396` — `createDashboardServer`, `fetch(req, server)`, `/api/events` at `:383-387`, dispatch at `:392-396`. [primary]
3. `omp-stats/src/server.ts:20-63, 115-153, 485-496` — import-time work, `ensureClientBuild`, `startServer`. [primary]
4. `omp-stats/src/live.ts:256-259` — `statsLive()` lazy singleton; `server.ts:430` — `.start()` call site. [primary]
5. `omp-stats/src/rollup.ts:1-26, 63, 421-427, 430-445, 467-470, 508-520, 854-858` — module doc, `EXACT_DIRTY_LIMIT`, `dirtyIsSmall`, `messageSource`/`toolSource` fine path, null-db guards. [primary]
6. `omp-stats/src/rollup.ts:304-312, 534-550, 587-590` — `getRollupStatus`, `AGGREGATE_COLUMNS`, `cacheRate`. [primary]
7. `omp-stats/src/db.ts:83-86, 113-126` — `currentDb()`, `initDb()` read-write open with pragmas. [primary]
8. `omp-stats/src/shared-types.ts:11-52, 55-66, 70-78, 156-165` — `AggregatedStats`, `ModelStats`, `FolderStats`, `TimeSeriesPoint`, `DashboardStats`. [primary]
9. `omp-stats/src/types.ts:9-46` — `MessageStats`, `costUnpriced` semantics verbatim. [primary]
10. `omp-stats/package.json` — `exports` map (`"./*": "./src/*.ts"`); `omp-stats/src/index.ts:11-39` — root export surface. [primary]
11. `docs/research/omp-stats-tui/findings/F1-api-decoupling.md` — live route-by-route proof with synthetic `Request`s, zero sockets; export surface; `handleApi` state dependencies. [primary]
12. `docs/research/omp-stats-tui/findings/F2-data-layer.md` — Tables A/B/C measurements, read-only concurrency probes, type verbatim, Table A vs Table B reconciliation. [primary]
13. `omp-stats/src/aggregator.ts:473-499` — `TimeRange` union, `DEFAULT_TIME_RANGE = "24h"`, `TIME_RANGES` spans and buckets, `getTimeRangeConfig`. [primary]
14. `docs/research/omp-stats-tui/findings/F4-extension-packaging.md` — manifest, resolver architecture, dev loop, distribution, testing. Superseded by [15] on the resolution question. [primary]
15. `docs/research/omp-stats-tui/findings/F5-resolution-probe.md` — in-loader resolution matrix, `pi_natives` failure, four workarounds, `bun:sqlite` timings, component construction results. [primary]
16. `pi-coding-agent/src/extensibility/custom-commands/bundled/annotate/fullscreen.ts:13-20, 36-45, 60` — `ANNOTATION_OVERLAY_OPTIONS` and the mount call. [primary]
17. `pi-coding-agent/src/modes/controllers/extension-ui-controller.ts:1150-1215` — factory signature, `KeybindingsManager.inMemory()` at `:1156`, factory invocation at `:1196`, `showOverlay` at `:1204-1213`, cleanup at `:1161-1176`. [primary]
18. `docs/research/omp-stats-tui/findings/F2-data-layer.md` — schema, rollup tables and row counts, `initDb()` write behaviour, measured latencies. [primary] / `docs/research/omp-stats-tui/findings/F11-zero-install-paths.md` and `docs/research/omp-stats-tui/findings/F4-extension-packaging.md` — install layout, `omp stats --json` CLI behaviour, manifest and resolver. [primary]
19. `docs/research/omp-stats-tui/findings/F3-tui-rendering.md` — `ctx.ui.custom()` semantics by mode, component lifecycle and `dispose()` contract. [primary] / `docs/research/omp-stats-tui/findings/F6-builtin-views.md` — `/settings` and `/usage` anatomy, dismissal discipline, architecture verdict. [primary] / `omp://extensions.md`, `omp://tui.md`, `omp://tui-runtime-internals.md`, `omp://tui-core-renderer.md`. [primary]
20. `pi-coding-agent/src/extensibility/plugins/legacy-pi-compat.ts:806-814, 850-874, 1492-1517, 1716-1726, 2735-2750` — `PI_PACKAGE_NAMES`, resolution caches, `findNodePackageRootUncached`, `validateResolvedBarePackagePath`, `Bun.plugin` hook install. [primary]
21. `pi-coding-agent/src/stats/activity-protocol.ts:1-11` and `activity-worker.ts:1-6` — the author's stated reason for the subprocess. [primary]
22. `pi-coding-agent/src/slash-commands/builtin-session.ts:431-465` — the `/stats` built-in; `acp-builtins.ts:8-30` — documented shadowing semantics. [primary]
23. `pi-coding-agent/src/modes/controllers/input-controller.ts:1053-1085` — built-in dispatch precedes extension commands. [primary]
24. `pi-coding-agent/src/modes/controllers/selector-controller.ts:181-192, 347-389` — `#showFullscreenMenu` and the `/usage` dashboard mount. [primary]
25. `pi-tui/src/tui.ts:424-470` — `OverlayOptions`, `fullscreen` doc comment. [primary]
26. `pi-tui/src/apps/git/git-tui.ts:1210-1228` — `showGitOverlay`. [primary]
27. `pi-tui/src/chrome/overlay-box.ts:123, 178, 218` — `PanelRows`, `PanelDivider`, `OverlayPanel`. [primary]
28. `pi-tui/src/theme/theme-class.ts:325, 343` — `fg` / `bg`; `pi-tui/src/theme/schema.ts:44-` — `ThemeColor`. [primary]
29. `pi-tui/src/keybinding-matchers.ts:31-57` — `matchesSelectCancel` and siblings; `pi-tui/src/keys.ts:189, 549` — `KeyId`, `matchesKey`; `pi-tui/src/keybindings.ts:130-142` — `tui.select.*` defaults. [primary]
30. `omp-stats/src/aggregator.ts:60-81` — sync lock constants and `withStatsSyncLock`; `pi-utils/src/file-lock.ts:48-61` — retry loop. [primary]
31. `pi-tui/src/components/{table,metric,key-value-list,scroll-view,select-list,text,section,spacer}.ts` — constructor signatures and option types as listed in [15]. [primary]
32. `pi-coding-agent/src/extensibility/plugins/types.ts:28-47` — `PluginManifest` interface verbatim. [primary]
33. `docs/research/omp-stats-tui/findings/F6-builtin-views.md` — `/settings` and `/usage` anatomy, terminal capability detection, codepoint measurement, template verdict. [primary]
34. `docs/research/omp-stats-tui/findings/F7-web-dashboard.md` — route inventory, chart layer, portability assessment, v1 subset. Route total and `.tsx` file count corrected against source in §8. [primary]
35. `docs/research/omp-stats-tui/findings/F8-terminal-graphics.md` — glyph set research, capability detection, Nerd Font finding, braille assessment. Braille-absence claim corrected in §9. [primary]
36. `pi-tui/src/overlays/settings-selector.ts:611-783, 685-699, 1886-1941` — `SettingsSelectorComponent`, its `render()` frame composition and footer-hint idiom, `handleInput` cascade. [primary]
37. `pi-tui/src/chrome/overlay-box.ts:17-49, 123, 178, 218, 309-342` — `topBorder`, `divider`, `bottomBorder`, `row`, `PanelRows`, `PanelDivider`, `OverlayPanel`. [primary]
38. `pi-tui/src/overlays/usage-dashboard.ts:49-53, 281-362, 482-500, 533-560, 574-602, 615-630, 799-872, 896-927, 1351-1405` — `DailyActivityPoint`, `HeatmapLayout`, `buildHeatmapLayout`, `UsageDashboardOptions`, the class, `#loadActivity`, `#miniBar`, `#heatRamp`, `#renderHeatmap`, `render`, `handleInput`. [primary]
39. `pi-tui/src/theme/symbols.ts:5, 415-419, 476-490, 529, 558, 800, 877-954, 1194-1226` — `SymbolPreset` union and `SYMBOL_PRESETS` codepoints per preset; measured directly via `bun -e`. [primary]
40. `pi-tui/src/theme/color.ts:14-19, 33`, `pi-tui/src/theme/schema.ts:201`, `pi-tui/src/terminal-capabilities.ts:718-799, 855` — `detectColorMode`, `ColorMode`, `TerminalInfo`, `setTerminalGlyphProtocol`. [primary]
41. `omp-stats/src/client/**` — line counts re-measured directly with `wc -l`: 11 route components totalling 5,348; 41 `.tsx` files totalling 9,244; `charts/*` 637; `charts/*.tsx` 584; `traces/*` 2,126; `ui/*.tsx` 1,030; `data/view-models.ts` 469; `data/formatters.ts` 98. [primary]
42. `pi-coding-agent/src/utils/title-generator.ts:726-738, 792, 816-930` — `TerminalTitleSpinnerStyle` incl. the braille/pulse/dots/line styles, `SPINNER_FRAMES.unicode.activity`, and the ASCII-safe `line` alternative. [primary]
43. `pi-tui/src/tools/find.ts:105-126` — `gauge()` using `renderProgressBar` with `theme.symbol("progress.filled")` / `theme.symbol("progress.empty")`. [primary]
44. `docs/research/omp-stats-tui/findings/F9-import-strategies.md` — four import strategies run in the real loader, `handleApi` 200 verification, `initDb()` non-mutation, `syncAllSessions` at 7141 ms, per-range timings, lock-contention test, runtime export surface. Allowlist size corrected against source in the Confidence paragraph. [primary]
