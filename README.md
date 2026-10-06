# omp-stats-tui

Fullscreen local usage-stats panel for [omp](https://github.com/can1357/oh-my-pi), rendered terminal-natively inside your session.

`/stats-tui` opens an alternate-screen panel over the same upstream stats records as the browser dashboard (`/stats`). Twelve interactive screen controllers provide terminal workflows without React or an HTTP listener. Dismissal restores the underlying transcript; built-in `/stats` is unchanged.

> [!NOTE]
> All twelve screens are implemented. The local compiled-host workflows, installation and theme matrix are verified; credentialed broker and paid-judge execution remain unverified. See the [execution roadmap](docs/plans/2026-10-05-dashboard-parity.md) for exact evidence and external prerequisites.

## Install

Prerequisites: [Bun](https://bun.sh) ≥ 1.4.2 and supported compiled omp **18.6.1** on `PATH`. Stats reads and live ingestion require a standalone `bun` executable even when omp itself is compiled.

For the PR checkout commands, manual acceptance checklist, safety limits and troubleshooting, see the [testing guide](docs/TESTING.md).

```sh
git clone https://github.com/yuzu-octopus/omp-stats-tui.git
cd omp-stats-tui
bun install
bun run build
omp plugin link .
```

> [!IMPORTANT]
> Both install and build are required. The manifest loads `dist/index.js`; the build bundles locally owned stats/private modules, keeps supported host APIs external, and emits `dist/data-worker.js`. Bun applies the committed `patchedDependencies` patch for stats 18.6.1 through `bun.lock`; the corrected dependency is included in the shipped bundle, not repaired at runtime.

The runtime `pi-coding-agent` dependency supplies real standalone judging to the worker. Its judge/auth resources are opened lazily only when a judging action requests them; passive statistics do not start paid work. Keep runtime dependencies installed alongside the distribution.

Verify extension loading (no TUI or LLM call):

```sh
omp models -e /abs/path/to/omp-stats-tui/dist/index.js
```

> [!WARNING]
> `-e` must come **after** the subcommand. `omp -e … models` silently ignores the extension, and `omp --help` never loads extensions. Read stderr, not just the exit code.

```sh
omp plugin
omp --profile <name> -e /abs/path/to/omp-stats-tui/dist/index.js
```

## Use

```
/stats-tui
```

Headless / print / RPC modes decline with `/stats-tui needs an interactive terminal` instead of hanging.

### Global keys

| Key | Action |
|---|---|
| `[` / `]` outside text entry, `Ctrl+P` / `Ctrl+N` everywhere | Previous / next screen; explicit host selector binding overrides take precedence |
| `g` then letter | Jump to any screen: `o` overview, `m` models, `c` costs, `v` providers, `a` activity, `r` requests, `e` errors, `t` traces, `l` tools, `j` projects, `n` gain, `f` frustration. Use outside text entry; the armed prefix consumes the next letter, expires after 1200 ms |
| `Tab` | Cycle route focus/view; focused analytics tables precede charts. Single-area routes may fall through to next-screen navigation |
| `r` / `R` | Cycle range forward / back outside text entry |
| `s` | Request sync from the existing live worker (not a second one-shot ingest) |
| `q` outside text entry, `Ctrl+C` everywhere | Close and restore the transcript; literal `q` and brackets remain searchable |
| `Esc` | Leave search/details, clear a route filter or go back; close when the route has no back action |
| `PgUp` / `PgDn`, `Home` / `End`, mouse wheel | Scroll the body when not consumed by a route |

Arrow keys select rows or inspect/pan route content where handled; otherwise left/right navigate screens and up/down scroll. Digits `1`–`9`, `0` select the first ten registry positions only when a controller does not own them (Frustration uses `1`–`4` for layers, Traces uses `0` to fit). Use `g` jumps for all twelve screens without that ambiguity.

### Route controls

These are controller keys, not universal aliases. Focus the relevant table/chart first; in search, ordinary letters edit text. The route's visible hints describe the active context.

| Route | Keyboard workflow |
|---|---|
| Overview | `Tab` latest requests/chart; list `/` search, `o`/`O` sort, arrows or `j`/`k` select, `+`/`a` reveal, `Enter` request detail; `A` all requests; chart `m` mode, `n` series, `v` visibility, `,`/`.` point |
| Requests | `/` search model/provider/project, `Enter`/`Esc` leave input; `↑`/`↓` or `j`/`k` select; `f` status; `o` sort column, `O` direction; `+` reveal, `a` reveal loaded rows, `l` load 500 → 2,000 → 10,000; `Enter` details |
| Errors | `Tab` signatures/models/requests; `Enter` select signature/model or open request; `/` search failures; `f` clear both filters, `x`/`X` clear signature/model independently; `u` latest request; `o`/`O` sort focused panel independently; `+`/`a` reveal; `l` load 50 → 200 → 1,000 |
| Request detail | `t` associated trace (back returns to this retained inspector), `c` copy full JSON, `n` select JSON section, `v` expand/collapse selected section, `C` copy section, `e` retry failed read, `b`/`Esc` back. Timing/TTFT/throughput, token categories/premium, component costs, status/error, output, entry and raw stats are lazy-loaded |
| Models / Costs / Tools | `Tab` chart/tables (`Shift+Tab` reverses); `m` mode; chart `n` series, `v` visibility, `,`/`.` point; table `/` search, `o`/`O` sort, `↑`/`↓` or `j`/`k` select, `+`/`a` reveal, `Enter` expand; `b`/`Esc` back/clear. Model detail `m` switches performance/request trend; all model/tool identities retain individual trends even if grouped into Other. Tools `f` cycles model filter, `x` resets, `d` opens full by-tool details without changing that filter |
| Projects | `Tab` table/cost ranking/request ranking; `/` search; `t` include/exclude temporary folders; `o`/`O` sort; arrows or `j`/`k` select, `+`/`a` reveal; `Enter` details or scope table from ranking; `b`/`Esc` back; aggregates remain unfiltered |
| Activity | `Tab` recorded days/calendar; recorded days `/` search, `o`/`O` sort, arrows or `j`/`k` select, `+`/`a` reveal, `Enter` details. Calendar `j`/`k` or down/up move a local day, `h`/`l` a week, `t` returns to today, `Enter` details even for quiet days. `b`/`Esc` back. Selected cells use the active theme; historical navigation shifts narrower calendar windows. Lookback is 371 local days, independent of global range |
| Providers | `Tab`/`Shift+Tab` or `v` totals/burn/peak/windows/accounts; burn `m` metric; `p`/`P` provider, `w`/`W` window where applicable; `h`/`l` point/hour; `↑`/`↓` or `j`/`k` selection; `n`/`N` legend, `Space` visibility; `o` sort, `d` direction, `+` reveal; `Enter` token mix or accounts; `u` refresh quota reads. Sorting retains selected provider/account identity; hidden series are excluded from point details |
| Gain | `Tab`/`Shift+Tab` or `v` project/history/sources; `p`/`P` project; `h`/`l` daily/cumulative point; `↑`/`↓` or `j`/`k` select; `o` sort, `d` direction, `+` reveal; `Enter` source details. Long project selectors keep the selected project visible |
| Traces | Root list `/` search, `o` sort, `D` direction, `l` reveal, `+` load up to 300 candidates, `Enter` open. Inside: `Tab`/`Shift+Tab` timeline/minimap/transcript/tools/children; `↑`/`↓` select events, `Enter` inspect; `v` time/turn/call axis, `i` idle compression, `+`/`-` zoom, arrows or `a`/`d` pan, `h`/`l` cursor, `Space` pick event, `0` fit, `f` focus span; `c` track collapse, `C` collapse children, `E` expand; `/` span search, `n`/`N` matches, `x` clear; `o` reveal child, `O` open child transcript, `y` copy JSON, `u` refresh, `b`/`Esc` back; detail `j` raw entry. `m` minimap: arrows/Home/End move cursor, Space starts a range, Enter applies range/seeks, `h`/`l` resize start/end, `a`/`d` move brush, `+`/`-` zoom, `0` fit, Esc cancels range. Exhausting child history returns to the originating request inspector |
| Frustration | `Tab` versions/families; `c` class, `m` small samples, `h` mostly-regex filter; `Space` family visibility; `1`–`3` rate layers, `4` trend; `o`/`O` sort, `v` reveal, arrows select; `Enter` raw model IDs/details, `p` copy detail; `j` obtain estimate, `y` explicitly confirm paid start, `n`/`Esc` dismiss estimate, `x` cancel running job |

Ranges: `1h | 24h | 7d | 30d | 90d | all` (default `24h`). No `365d`: upstream resolves unknown ranges to its 24-hour default.

## Screens and data boundaries

Overview, Activity, Models, Costs, Projects, Requests, Errors, Tools, Providers, Gain, Traces and Frustration are all selectable. Controllers retain focus, selection, search, sort and chart controls when returning to a route. Requests show the loaded population and completeness separately from complete-range totals. Traces provides nested tracks, a minimap, linked transcript/markers, tool duration/errors and child navigation; upstream root-session discovery is limited to **300 candidates**, not exhaustive history.

Provider local usage loads independently of subscription windows/account quota. Missing broker credentials, absent readings or quota-network failures do not mean no local usage; those sections report their own state. Gain's remembered project selector scopes totals, daily savings, cumulative history and source breakdown.

Frustration's cached/regex metrics and coverage are passive. Paid judging requires a configured `judge` model role, provider credentials and explicit user authorization via the estimate/confirmation flow. No paid smoke has been verified. Missing credentials block that external scenario, not the implemented UI.

Running judge state is independent of passive-read success: progress and cancellation remain reachable if metrics fail to load. A newly observed external run dismisses obsolete estimates; failed quote/cancel actions remain retryable. None of these controls authorizes a paid start implicitly.

> [!CAUTION]
> Unknown spend is `N/A`, not free. The patched upstream pricing-v2 replay and rollup-v3 invalidation distinguish absent provider/model price cards from explicit free cards and recorded zero charges. Priced totals containing unpriced requests are floors and show their unpriced count.

## Develop

```sh
bun test
bun run build
bun scripts/probe-render.ts all --width 100 --width 60
omp models -e /abs/path/to/omp-stats-tui/dist/index.js
```

`probe-render` renders the pure chart/layout IR, not the interactive controller workflow. It accepts `--range` from the six keys and `--preset unicode|nerd|ascii`. Controller acceptance needs a mounted host in addition to fixture/render tests. Other probes: `bun run scripts/probe-data.ts`, `bun run scripts/probe-glyphs.ts`.

Source-mode development uses standalone Bun and installed dependencies. `StatsReadClient` resolves `scripts/data-worker.ts` relative to its source module; the production build's `__STATS_READ_WORKER__` macro instead resolves `./data-worker.js` relative to `dist/index.js`. Workers use absolute paths, inherit the host working directory for project/judge configuration, and receive the active agent directory plus `OMP_PROFILE`/`PI_PROFILE`; `PI_BUNDLED` is cleared. Launching compiled omp from another directory does not relocate the worker. Directly loading `src/index.ts` in compiled omp is not the supported distribution entry.

## Architecture

- `src/index.ts` registers `/stats-tui`; it does **not** initialize the database on the host thread.
- `src/tui/panel.ts` mounts twelve `FeatureController`s from `src/tui/features/`, owns global navigation/scroll/disposal and injects the reader/theme/clipboard/open-trace context.
- `src/data/client.ts` owns one persistent isolated `StatsReadClient` per mounted panel. `scripts/data-worker.ts` initializes the upstream DB, runs synchronous queries/transcript reads and owns patched upstream `StatsLive({ workers: 1 })` with initial ingest and transcript watching. Request/reply and unsolicited live status use NDJSON pipes. `s` calls this same live owner's `requestSync()`; committed-data updates refresh active queries without replacing controller state.
- `src/data/api.ts` reuses upstream `handleApi(Request)` and data helpers inside the worker. Synthetic localhost requests open no socket; there is no plugin SQL workaround or independent backend.
- `src/layout/spec.ts`, `src/layout/resolve.ts`, `src/tui/render/screen.ts` and `src/tui/band.ts` remain the pure chart/probe renderer (`ScreenSpec → renderScreen → renderBands`), not a substitute for interactive controllers.
- `src/tui/charts/` and feature timelines colour sparkline/bar/calendar/timeline characters from the active omp theme. The panel refreshes the mutable injected feature theme each render; primitives receive theme/paint arguments, not an eagerly read singleton. Series/legend identity is shared; each terminal cell has one colour, not independently coloured braille dots.
- `src/tui/chrome.ts`, `tabs.ts`, `footer.ts` and `responsive.ts` own navigation and responsive frame policy. Close disposes controllers/watchers and kills/reaps the child; late payloads cannot replace newer selections.

Contributor references: **AGENTS.md**, **CONTEXT.md**, [roadmap](docs/plans/2026-10-05-dashboard-parity.md), and **docs/adr/** (historical superseded decisions are labeled).
