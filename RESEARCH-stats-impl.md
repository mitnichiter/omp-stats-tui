# `omp stats` — Implementation Research

**Scope:** read-only investigation of how `omp stats` actually works on this machine.
**Nothing was written or modified.** All commands run were `which`, `ls`, `cat`, `grep`, `find`,
`omp --version`, `omp --help`, `omp stats --help`, and read-only `sqlite3` queries.
**Date of investigation:** 2026-10-02. **omp version:** `omp/18.4.10`.

---

## 1. Installation facts

| Fact | Value |
|---|---|
| `command -v omp` | `/Users/yuzu/.bun/bin/omp` |
| Symlink target | `/Users/yuzu/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/dist/cli.js` |
| `file` output | `/usr/bin/env bun script text executable, ASCII text, with very long lines (29917)` |
| `omp --version` | `omp/18.4.10` |
| Install root | `/Users/yuzu/.bun/install/global/node_modules/@oh-my-pi/` |

`/Users/yuzu/.bun/bin/omp` is a **symlink**, and the target is a `bun` script — **not** a compiled
binary. There is no `~/.omp/plugins/node_modules` and no `/opt/homebrew/lib/node_modules`
involved; this is a Bun global install.

### Full TypeScript source ships with the package — this is the single most important fact

The package is not a minified blob. From `@oh-my-pi/pi-coding-agent/package.json`:

```json
"files": [
    "src",
    "dist/cli.js",
    "dist/docs-index.generated.txt",
    ...
    "dist/types"
],
"type": "module",
"main": "./src/index.ts",
"types": "./dist/types/index.d.ts",
```

`"main"` points at `./src/index.ts` and `"src"` is shipped in the tarball. On disk:

```
/Users/yuzu/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/
├── src/          <- real TypeScript, 735-line slash-command files, readable
├── dist/
│   ├── cli.js    26.9M   (the bun bundle actually executed)
│   ├── types/
│   └── template-*.html / template-*.js / tool-views.generated-*.js  (export/HTML rendering assets)
├── examples/
├── scripts/
├── CHANGELOG.md  255.1K
└── package.json
```

`dist/cli.js` exists only because `bun scripts/bundle-dist.ts` inlines it for the published npm
tarball. Everything below is quoted from the on-disk `src/` TypeScript, which is what Bun actually
executes in a global install. No reverse engineering was necessary.

### Workspace packages on disk

```
/Users/yuzu/.bun/install/global/node_modules/@oh-my-pi/
├── hashline/
├── omp-stats/          <- the stats dashboard package (see §3)
├── omptype/
├── pi-agent-core/
├── pi-ai/
├── pi-catalog/
├── pi-coding-agent/    <- the `omp` CLI + TUI host
├── pi-mnemopi/
├── pi-natives/
├── pi-natives-darwin-arm64/
├── pi-tui/             <- the TUI framework (see §6)
├── pi-utils/
├── pi-wire/
└── snapcompact/
```

Upstream repo: `github.com/can1357/oh-my-pi`, `packages/coding-agent` and `packages/stats`.

---

## 2. `omp stats` / `omp usage` CLI

### `omp stats --help` (verbatim)

```
View usage statistics

USAGE
  $ omp stats [FLAGS]

FLAGS
  -p, --port=<int>    Port for the dashboard server
      --host=<value>  Host to bind
  -j, --json          Output stats as JSON
  -s, --summary       Print summary to console
```

Two of the four flags are one-shot and **never start a server**: `--json` and `--summary`. They sync,
roll up, print, and exit.

### Registration

`pi-coding-agent/src/cli-commands.ts:235-239` — lazy-loaded so TUI startup stays fast:

```ts
	{
		name: "stats",
		load: () => import("./commands/stats").then(m => m.default),
		help: commandHelp.statsHelp,
	},
```

`pi-coding-agent/src/cli/stats-cli.ts` is the handler file. It declares its own tiny TTY progress
reporter so it can print a single-line bar:

```ts
/**
 * Single-line TTY progress bar. On a non-TTY stream we just stay quiet -
 * the final "Synced ..." summary still prints either way.
 */
function createSyncProgressReporter(): {
	onProgress: (event: { current: number; total: number; sessionFile: string }) => void;
	finish: () => void;
} {
```

### What the command actually does — `runStatsCommand`, `stats-cli.ts:70`

```ts
export async function runStatsCommand(cmd: StatsCommandArgs): Promise<void> {
	// Lazy import to avoid loading stats module when not needed
	const {
		closeDb,
		formatStatsDashboardUrl,
		getDashboardStats,
		getTotalMessageCount,
		printStatsSummary,
		refreshRollups,
		startServer,
		syncAllSessions,
	} = await import("@oh-my-pi/omp-stats");

	// One-shot reports need fully ingested, fully rolled-up data before printing.
	if (cmd.json || cmd.summary) {
		const progress = createSyncProgressReporter();
		process.stderr.write("Syncing session files...\n");
		const { processed, files } = await syncAllSessions({ onProgress: progress.onProgress });
		progress.finish();
		await refreshRollups();
		const total = await getTotalMessageCount();
		process.stderr.write(`Synced ${processed} new entries from ${files} files (${total} total)\n\n`);
		if (cmd.json) {
			console.log(JSON.stringify(await getDashboardStats(), null, 2));
		} else {
			await printStatsSummary();
		}
		return;
	}

	// The dashboard starts immediately and ingests sessions in the background,
	// streaming progress to the page. The judge (settings, auth, registry)
	// resolves on the first Frustration estimate/run and lives until exit.
	const cwd = process.cwd();
	const { hostname, port } = await startServer(cmd.port, cmd.host, {
		judge: async () => (await openStandaloneJudge(cwd, "stats_frustration")).judge,
	});
	const url = formatStatsDashboardUrl(hostname, port);
	console.log(chalk.green(`Dashboard available at: ${url}`));

	// Open browser
	openPath(url);

	console.log(`Press ${formatKeyHint("ctrl+c")} to stop\n`);

	// Keep process running
	process.on("SIGINT", () => {
		console.log("\nShutting down...");
		closeDb();
		process.exit(0);
	});

	// Keep the process alive
	await new Promise(() => {});
}
```

**Default mode (no `--json`/`--summary`) blocks forever** on `await new Promise(() => {})` and holds a
live HTTP server + DB write handle for the lifetime of the process.

### Port and host

- **Default port `3847`** — `omp-stats/src/server.ts:485-489`:
  ```ts
  export async function startServer(
  	port = 3847,
  	hostname = STATS_DASHBOARD_HOSTNAME,
  	options: StartServerOptions = {},
  ): Promise<StatsServerHandle> {
  ```
- **Default host `127.0.0.1`** — `omp-stats/src/port-conflict.ts:27`:
  ```ts
  export const STATS_DASHBOARD_HOSTNAME = "127.0.0.1";
  ```
- The TUI helper duplicates the constant — `pi-coding-agent/src/slash-commands/helpers/stats-dashboard.ts:4`:
  ```ts
  export const DEFAULT_STATS_DASHBOARD_PORT = 3847;
  ```
  with `let host = "127.0.0.1";` at line 37.

### Browser launch — yes, unconditionally, in both entry paths

- CLI: `stats-cli.ts:111` → `openPath(url)`
- TUI slash command: `slash-commands/helpers/stats-dashboard.ts:93` → `openUtils.openPath(url)`

### The HTTP server — `omp-stats/src/server.ts:364`

```ts
function createDashboardServer(port: number, hostname: string): Server<undefined> {
	const server = Bun.serve({
		port,
		hostname,
		async fetch(req, server) {
			const url = new URL(req.url);
			const path = url.pathname;

			// The identity header lets another omp session's reuse probe positively
			// recognize this dashboard without allowing cross-origin API reads.
			const dashboardHeaders: Record<string, string> = {
				[STATS_DASHBOARD_HEADER]: STATS_DASHBOARD_SECURITY_VERSION,
				[STATS_DASHBOARD_HOSTNAME_HEADER]: hostname,
			};

			if (req.method === "OPTIONS") {
				return new Response(null, { headers: dashboardHeaders });
			}

			if (path === "/api/events") {
				// Long-lived stream: exempt from the idle timeout.
				server.timeout(req, 0);
				return liveEventStream(dashboardHeaders);
			}

			try {
				let response: Response;

				if (path.startsWith("/api/")) {
					response = await handleApi(req);
				} else {
					response = await handleStatic(path);
				}
```

Port-conflict handling is a deliberate feature, not an accident — `server.ts:472-478`:

```ts
// Dashboards this process already bound, keyed by requested `hostname:port`.
// A second in-process start (e.g. `/trace` twice in one session) must return
// the live handle: probing our own port can time out under load and would
// then dead-end in the reclaim path's self-PID guard.
const activeServers = new Map<string, StatsServerHandle>();
/** Dashboards bound by this process (any port); background ingest stops when the last one does. */
let liveServers = 0;
```

with `EADDRINUSE` recovery at `server.ts:520-536`:

```ts
	try {
		return register(createDashboardServer(port, hostname));
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "EADDRINUSE")) throw error;

		const recovery = await recoverStatsPort(port, hostname);
		if (recovery === "reuse") {
			return { hostname, port, stop: () => {} };
		}

		try {
			return register(createDashboardServer(port, hostname));
		} catch (retryError) {
			throw new Error(`Failed to start stats dashboard on ${hostname}:${port} after reclaiming it.`, {
				cause: retryError,
			});
		}
```

### What it serves — HTML **and** JSON **and** SSE

Static SPA with fallback — `server.ts:334-356`:

```ts
async function handleStatic(requestPath: string): Promise<Response> {
	if (USE_EMBEDDED_CLIENT) {
		const files = await getEmbeddedClientFiles();
		const file = files.get(requestPath.slice(1)) ?? files.get("index.html");
		return file ? new Response(file) : new Response("Not Found", { status: 404 });
	}

	const filePath = requestPath === "/" ? "/index.html" : requestPath;
	const fullPath = path.join(STATIC_DIR, filePath);

	const file = Bun.file(fullPath);
	if (await file.exists()) {
		return new Response(file);
	}

	// SPA fallback
	const index = Bun.file(path.join(STATIC_DIR, "index.html"));
	if (await index.exists()) {
		return new Response(index);
	}

	return new Response("Not Found", { status: 404 });
}
```

JSON API — all of these are `if (path === ...)` branches inside `handleApi` (`server.ts:165`):

| Route | Line |
|---|---|
| `/api/status` | 172 |
| `/api/stats` | 176 |
| `/api/stats/overview` | 181 |
| `/api/stats/model-dashboard` | 186 |
| `/api/stats/costs` | 191 |
| `/api/stats/frustration` | 196 |
| `/api/frustration/estimate` | 201 |
| `/api/frustration/judge` \| `/api/frustration/cancel` | 206 |
| `/api/stats/tools` | 217 |
| `/api/stats/provider-windows` | 222 |
| `/api/stats/providers` | 226 |
| `/api/stats/recent` | 231 |
| `/api/stats/errors` | 237 |
| `/api/stats/models` | 243 |
| `/api/stats/folders` | 248 |
| `/api/stats/timeseries` | 253 |
| `/api/request/*` | 258 |
| `/api/sync` | 266 |
| `/api/stats/gain` | 272 |
| `/api/sessions` | 277 |
| `/api/session/trace` | 284 |
| `/api/session/entry` | 314 |

Plus `/api/events`, a long-lived SSE stream with a keep-alive cadence — `server.ts:420-421`:

```ts
/** Keep-alive comment cadence so proxies and the browser keep the stream open. */
const EVENT_HEARTBEAT_MS = 15_000;
```

All `/api/stats/*` endpoints share a `range` query param — `server.ts:169-170`:

```ts
	// Stats reads are DB-only; ingest runs in the background (see `live.ts`).
	const range = url.searchParams.get("range");
```

### `omp usage` (CLI subcommand)

Exists as a **CLI subcommand** distinct from `omp stats`:

```
  usage             Show provider usage limits for every authenticated account
```

Note the semantic split: `omp usage` hits **provider rate-limit APIs** (live quota per account);
`omp stats` reads **the local `stats.db`** (historical local spend). They are different data sources.
The TUI `/usage` view (see §5) is the *provider-quota* one but already displays a *stats.db*-backed
heatmap.

---

## 3. The `@oh-my-pi/omp-stats` package

**Path:** `/Users/yuzu/.bun/install/global/node_modules/@oh-my-pi/omp-stats/`

```json
{
	"type": "module",
	"name": "@oh-my-pi/omp-stats",
	"version": "18.4.10",
	"description": "Local observability dashboard for omp AI usage statistics",
	"main": "./src/index.ts",
	"types": "./dist/types/index.d.ts",
	"bin": {
		"omp-stats": "./src/index.ts"
	},
	"dependencies": {
		"@oh-my-pi/pi-ai": "18.4.10",
		"@oh-my-pi/pi-catalog": "18.4.10",
		"@oh-my-pi/pi-utils": "18.4.10",
		"lucide-react": "^1.24.0",
		"react": "19.2.7",
		"react-dom": "19.2.7"
	}
}
```

It also declares its own `bin` (`omp-stats`), so it is runnable standalone.

### `src/` file list (server side)

```
src/aggregator.ts          22.4K   <- ingest orchestration + dashboard-shaped query facade
src/db.ts                  58.7K   <- schema DDL, raw SQL queries, the Bun SQLite handle
src/embedded-client.ts      1.0K   <- decode a prebuilt client archive for the bundled CLI
src/embedded-client.generated.txt  0B  <- EMPTY in this install (see "build caveat" below)
src/frustration.ts         17.2K   <- LLM-judge "how annoyed was the user" analytics
src/gain-aggregator.ts     10.0K
src/index.ts                7.3K   <- package entry / standalone `omp-stats` bin
src/live.ts                 8.1K   <- background ingest progress state machine
src/parser.ts              23.6K   <- session JSONL -> rows
src/port-conflict.ts       10.3K
src/rollup.ts              35.9K   <- hourly rollup tables + the SYNCHRONOUS query layer
src/server.ts              17.1K   <- Bun.serve, API routes, static
src/shared-types.ts        20.1K
src/sync-worker.ts          1.7K
src/trace.ts               41.5K   <- per-session trace building (read session files directly)
src/types.ts                6.9K
src/usage-windows.ts       13.7K
src/user-metrics.ts        18.7K
```

### `src/client/` — the web UI (~90 `.tsx` files)

Routes: `OverviewRoute`, `ModelsRoute`, `CostsRoute`, `ProvidersRoute`, `ToolsRoute`,
`ProjectsRoute`, `ErrorsRoute`, `RequestsRoute`, `TracesRoute`, `GainRoute`, `FrustrationRoute`.
Plus `client/charts/{BarList,Chart,Legend,ShareBar,Sparkline,TimeChart,useWidth}.tsx`,
`client/traces/{AggregatesPanel,Minimap,SpanDrawer,SummaryStrip,TimelineCanvas,TraceView,TranscriptList}.tsx`,
`client/ui/{Badge,Card,Drawer,JsonBlock,Modal,RequestDrawer,SearchInput,Segmented,Stat,Table}.tsx`.

**This is React 19 + lucide-react.** It is a completely separate rendering stack from the terminal
TUI in `pi-tui`. There is no shared renderer and no shared component model between them.

### Build caveat

`src/embedded-client.generated.txt` is **0 bytes** in this install, and `server.ts:145-149` shows it
shells out to build the client on demand:

```ts
	logger.debug("Building stats client");
	const packageRoot = path.join(import.meta.dir, "..");
	const buildResult = await $`bun run build.ts`.cwd(packageRoot).quiet().nothrow();
	if (buildResult.exitCode !== 0) {
		const output = buildResult.text().trim();
```

but `server.ts:51-52` points at prebuilt static assets:

```ts
const CLIENT_DIR = path.join(import.meta.dir, "client");
const STATIC_DIR = path.join(import.meta.dir, "..", "dist", "client");
```

and `dist/client/` (`index.css`, `index.html`, `index.js`) **is** present on disk. So the normal
(non-bundled) install path serves from `dist/client/` and does not need the build step.

### What `index.ts` exports — and, critically, what it does NOT

`omp-stats/src/index.ts:11-39`, the **entire public value surface**:

```ts
export {
	getDashboardStats,
	getToolDashboardStats,
	getTotalMessageCount,
	type SyncOptions,
	type SyncProgress,
	smokeTestSyncWorker,
	syncAllSessions,
} from "./aggregator";
export { closeDb } from "./db";
export { refreshRollups } from "./rollup";
export type { StatsJudge, StatsJudgeProvider } from "./frustration";
export { getGainDashboardStats } from "./gain-aggregator";
export { formatStatsDashboardUrl, type StartServerOptions, startServer } from "./server";
export type { GainDashboardStats, GainSource, GainSourceTotals, GainTimeSeriesPoint } from "./shared-types";
export type {
	AggregatedStats,
	DashboardStats,
	FolderStats,
	MessageStats,
	ModelPerformancePoint,
	ModelStats,
	ModelTimeSeriesPoint,
	TimeSeriesPoint,
	ToolDashboardStats,
	ToolModelStats,
	ToolTimeSeriesPoint,
	ToolUsageStats,
} from "./types";
```

Plus these three locally-defined exports:

```ts
/** Format an API-equivalent estimate in dollars, or N/A for unpriced usage. */
function formatCost(n: number, unpricedRequests = 0): string { … }

/**
 * Print the dashboard summary to the console. Shared by `omp stats --summary`
 * and the standalone `omp-stats --sync`.
 */
export async function printStatsSummary(): Promise<void> { … }

/** Parsed arguments for the standalone `omp-stats` entry point. */
export interface StandaloneStatsArgs { … }

/** Parse the standalone `omp-stats` arguments used by the production entry point. */
export function parseStandaloneStatsArgs(args: string[]): StandaloneStatsArgs { … }
```

**⚠️ ANSWER TO "is the stats query layer importable as a library?":**

**Not from the package root — but yes, via subpath exports, and the coding-agent already does it.**

`import { getDashboardStats } from "@oh-my-pi/omp-stats"` works. But **`getDailyActivity`,
`getOverallStats`, `getStatsByModel`, `getTimeSeries` and the rest are NOT on the root surface.**
They are reachable only via the package's wildcard subpath export. From `package.json`:

```json
	"exports": {
		".": { "types": "./dist/types/index.d.ts", "import": "./src/index.ts" },
		"./*": { "types": "./dist/types/*.d.ts", "import": "./src/*.ts" },
		"./client": { "types": "./dist/types/client/index.d.ts", "import": "./src/client/index.tsx" },
		"./client/*": { … },
		"./client/components/*": { … },
		"./*.js": "./src/*.ts"
	}
```

so `@oh-my-pi/omp-stats/db` → `src/db.ts`, `@oh-my-pi/omp-stats/rollup` → `src/rollup.ts`, etc.

**This is not theoretical — first-party code already does it:**

```
pi-coding-agent/src/cli/gc-cli.ts:7:   import { withStatsSyncLock } from "@oh-my-pi/omp-stats/aggregator";
pi-coding-agent/src/stats/activity-worker.ts:8:  import { syncAllSessions } from "@oh-my-pi/omp-stats/aggregator";
pi-coding-agent/src/stats/activity-worker.ts:9:  import { getDailyActivity } from "@oh-my-pi/omp-stats/db";
pi-coding-agent/src/cli/stats-cli.ts:81:  } = await import("@oh-my-pi/omp-stats");
pi-coding-agent/src/cli.ts:137: const { smokeTestSyncWorker, startServer } = await import("@oh-my-pi/omp-stats");
```

### `rollup.ts` — the synchronous query layer (the most useful surface for a TUI)

Every one of these is a plain synchronous function over the pre-aggregated rollup tables. No server,
no browser, no port:

```ts
export function ensureRollupSchema(database: Database): void {
export interface RollupStatus {
export function getRollupStatus(): RollupStatus {
export function refreshRollupBatch(limit: number): number {
export interface RefreshOptions {
export async function refreshRollups(opts?: RefreshOptions): Promise<void>;
export interface RangeWindow {
export function getOverallStats(cutoff: number | null = null): AggregatedStats {
export function getStatsByModel(cutoff: number | null = null): ModelStats[] {
export function getStatsByFolder(cutoff: number | null = null, limit = Number.MAX_SAFE_INTEGER): FolderStats[] {
export function getStatsByAgentType(cutoff: number | null = null): AgentTypeStats[] {
export function getTimeSeries({ cutoff, bucketMs }: RangeWindow): TimeSeriesPoint[] {
export function getModelTimeSeries({ cutoff, bucketMs }: RangeWindow): ModelTimeSeriesPoint[] {
export function getModelPerformanceSeries({ cutoff, bucketMs }: RangeWindow): ModelPerformancePoint[] {
export function getCostTimeSeries(cutoff: number | null = null): CostTimeSeriesPoint[] {
export function getStatsByProvider(cutoff: number | null = null): ProviderAggregate[] {
export function getProviderHourlyBurn(cutoff: number | null = null): ProviderHourlyPoint[] {
export function getProviderTimeSeries({ cutoff, bucketMs }: RangeWindow): ProviderTimeSeriesPoint[] {
export interface SessionRollupRow {
export function getSessionRollups(): SessionRollupRow[] {
export function getToolStats(cutoff: number | null = null): ToolUsageStats[] {
export function getToolStatsByModel(cutoff: number | null = null): ToolModelStats[] {
export function getToolTimeSeries({ cutoff, bucketMs }: RangeWindow): ToolTimeSeriesPoint[] {
```

### `db.ts` — raw query layer

```ts
export function unpricedRequestSql(prefix = ""): string {
export function currentDb(): Database | null {
export async function initDb(): Promise<Database> {
export function isScheduledCatalogModel(provider: string, modelId: string): boolean {
export interface FileOffset {
export function getFileOffset(sessionFile: string): FileOffset | null {
export function getFileOffsets(sessionFiles: string[]): Map<string, FileOffset> {
export function setFileOffset(…): …
export interface ParsedSession {
export function applySessionParseResults(sessions: ParsedSession[]): … {
export function prepareSessionSync(): boolean {
export function completeSessionSync(reconcile: boolean): void {
export function insertMessageStats(stats: Iterable<MessageStatsInput>): number {
export function getMessageCount(): number {
export function closeDb(): void {
export function getRecentRequests(limit = 100): MessageStats[] {
export function getRecentErrors(limit = 100, cutoff?: number | null): MessageStats[] {
export function getMessageById(id: number): MessageStats | null {
export async function getDailyActivity(days = 371): Promise<DailyActivityPoint[]> {
export function markSessionBackfillsComplete(): void {
export function insertUserMessageStats(stats: Iterable<UserMessageStats>): number {
export function updateUserMessageLinks(links: Iterable<UserMessageLink>): number {
export function upsertFrustrationVerdicts(verdicts: readonly FrustrationVerdict[]): void {
```

`getDailyActivity` in full — `db.ts:985-1011`. **This is the one the TUI already calls:**

```ts
export async function getDailyActivity(days = 371): Promise<DailyActivityPoint[]> {
	const database = await initDb();
	const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
	const stmt = database.prepare(`
		SELECT
			date(timestamp / 1000, 'unixepoch', 'localtime') as day,
			SUM(cost_total) as cost,
			COUNT(*) as requests,
			SUM(total_tokens) as total_tokens
		FROM messages
		WHERE timestamp >= ?
		GROUP BY day
		ORDER BY day ASC
	`);
	const rows = stmt.all(cutoff) as Array<{
		day: string;
		cost: number | null;
		requests: number;
		total_tokens: number | null;
	}>;
	return rows.map(row => ({
		day: row.day,
		cost: row.cost ?? 0,
		requests: row.requests,
		totalTokens: row.total_tokens ?? 0,
	}));
}
```

### `aggregator.ts` — dashboard-shaped async facade

```ts
export async function withStatsSyncLock<T>(dbPath: string, fn: () => Promise<T>): Promise<T> {
export interface SyncProgress {
export interface SyncOptions {
export async function smokeTestSyncWorker({ timeoutMs = 5_000 }: { timeoutMs?: number }): Promise<void> {
export async function syncAllSessions(opts?: SyncOptions): Promise<{ processed: number; files: number }> {
export function getTimeRangeConfig(range?: string | null): RangeWindow {
export async function getDashboardStats(range?: string | null): Promise<DashboardStats> {
export async function getOverviewStats(…): …
export async function getModelDashboardStats(…): …
export async function getCostDashboardStats(range?: string | null): Promise<Pick<DashboardStats, "costSeries">> {
export async function getFolderStats(range?: string | null): Promise<FolderStats[]> {
export async function getRecentRequests(limit?: number): Promise<MessageStats[]> {
export async function getRecentErrors(range?: string | null, limit?: number): Promise<MessageStats[]> {
export async function getRequestDetails(id: number): Promise<RequestDetails | null> {
export async function getTotalMessageCount(): Promise<number> {
export async function getToolDashboardStats(range?: string | null): Promise<ToolDashboardStats> {
export async function getProviderDashboardStats(range?: string | null): Promise<ProviderDashboardStats> {
export async function getProviderWindowStats(…): …
```

### Other modules

```
server.ts          export async function handleApi(req: Request): Promise<Response>
                   export function formatStatsDashboardUrl(hostname: string, port: number): string
                   export interface StatsServerHandle { hostname: string; port: number; stop: () => void; }
                   export interface StartServerOptions { judge?: StatsJudgeProvider; }
                   export async function startServer(port?, hostname?, options?): Promise<StatsServerHandle>

live.ts            export class StatsLive { … }
                   export function statsLive(): StatsLive

frustration.ts     export interface StatsJudge extends Judge
                   export type StatsJudgeProvider = () => Promise<StatsJudge>
                   export function setStatsJudgeProvider(provider: StatsJudgeProvider | undefined): void
                   export function getFrustrationJobStatus(): FrustrationJobStatus
                   export function mergeFrustrationRows(…): FrustrationModelStats[]
                   export async function getFrustrationDashboardStats(range?): Promise<FrustrationDashboardStats>
                   export async function estimateFrustrationRun(range?): Promise<FrustrationEstimate>
                   export async function startFrustrationRun(range?): Promise<StartFrustrationRunResult>
                   export function cancelFrustrationRun(): FrustrationJobStatus

gain-aggregator.ts export function normalizeProjectPath(p: string): string | null
                   export function dedupeProjects(rawPaths: Set<string>): string[]
                   export async function getGainDashboardStats(…): …

trace.ts           export class TracePathError extends Error {}
                   export const TRACE_ETAG_VERSION = 3;
                   export async function traceFingerprintForEtag(fileParam: string): Promise<string | undefined>
                   export function traceMemoForTests(): { file: string; mtimeMs: number } | undefined
                   export async function buildSessionTrace(fileParam: string): Promise<SessionTrace>
                   export async function getTraceEntry(fileParam: string, entryId: string): Promise<SessionEntry | null>
                   export async function listSessionSummaries(limit = 100, q?: string): Promise<SessionSummary[]>

port-conflict.ts   export const STATS_DASHBOARD_HEADER = "x-omp-stats-dashboard";
                   export const STATS_DASHBOARD_HOSTNAME_HEADER = "x-omp-stats-hostname";
                   export const STATS_DASHBOARD_SECURITY_VERSION = "3";
                   export const STATS_DASHBOARD_HOSTNAME = "127.0.0.1";
                   export async function prepareStatsPort(port, hostname = STATS_DASHBOARD_HOSTNAME): Promise<"retry" | "reuse"> {
                   export async function recoverStatsPort(port, hostname = STATS_DASHBOARD_HOSTNAME): Promise<"retry" | "reuse"> {

parser.ts          export function classifyAgentType(sessionPath: string): AgentType
                   export function extractFolderFromPath(sessionPath: string): string
                   export interface UsageBucketView
                   export function resolveUsageTotal(usage: UsageBucketView | null | undefined): number
                   export function parseAllSessionEntries(bytes: Uint8Array): SessionEntry[]
                   export interface SessionParserState
                   export interface ParseSessionResult
                   export function matchesSessionFile(state, info): boolean
                   export async function parseSessionFile(…): …
                   export async function listSessionFolders(): Promise<string[]>
                   export async function listSessionFiles(folderPath: string): Promise<string[]>
                   export async function listAllSessionFiles(): Promise<string[]>
                   export async function getSessionEntry(sessionPath, entryId): Promise<SessionEntry | null>

user-metrics.ts    export interface UserMessageMetrics
                   export const PROSE_MAX_CHARS = 4000;
                   export function judgeProse(text: string): string
                   export function computeUserMessageMetrics(text: string): UserMessageMetrics
                   export const EMPTY_USER_METRICS: UserMessageMetrics = Object.freeze({…})

usage-windows.ts   export interface UsageSnapshotRow
                   export interface UsageWindowStats
                   export interface UsageDataSnapshot
                   export function readUsageSnapshots(sinceMs, dbPath = getAgentDbPath()): UsageSnapshotRow[]
                   export async function fetchUsageData(sinceMs: number): Promise<UsageDataSnapshot>
                   export function sumFleetTokens(…): Map<string, number> | null
                   export function computeUsageWindowStats(…): …

embedded-client.ts export function decodeEmbeddedClientArchive(txt: string): Buffer | null
sync-worker.ts     export type SyncWorkerRequest / SyncWorkerResponse
```

### What `db.ts` reads — DB path and connection

`db.ts:11` imports the path resolver from pi-utils; `db.ts:115-125`:

```ts
export async function initDb(): Promise<Database> {
	if (db) return db;

	// Ensure directory exists
	await fs.mkdir(getConfigRootDir(), { recursive: true });

	db = new Database(getStatsDbPath());
	// Install the busy handler BEFORE any lock-taking statement. See
	// https://github.com/can1357/oh-my-pi/issues/2421.
	db.run("PRAGMA busy_timeout = 5000");
	db.run("PRAGMA journal_mode = WAL");
```

Path resolution — `pi-utils/src/dirs.ts:847-849`:

```ts
export function getStatsDbPath(): string {
	return dirs.rootSubdir("stats.db", "data");
}
```

→ **`~/.omp/stats.db`** (overridable via `--profile` / `OMP_PROFILE`, which swap the whole root dir).

**Note: `initDb()` is not read-only.** It runs the full DDL block (`CREATE TABLE IF NOT EXISTS …`,
`PRAGMA table_info` migrations, `ALTER TABLE`, backfills) on every open. Any in-process consumer that
calls it is a *writer*, not a reader.

---

## 4. `stats.db` — schema, counts, range

**File:** `/Users/yuzu/.omp/stats.db`, **270.7 MB** (plus `-shm` 64.0K, `-wal` 293.7K,
`stats.db.sync.lock` 0B).

**Accessed read-only** via `sqlite3 "file:$HOME/.omp/stats.db?mode=ro"`. No INSERT/UPDATE/DELETE was
ever run. The `-wal` and `-shm` files exist because a live omp process holds the DB open with WAL.

### Full schema (verbatim `.schema` output)

```sql
CREATE TABLE messages (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			session_file TEXT NOT NULL,
			entry_id TEXT NOT NULL,
			folder TEXT NOT NULL,
			model TEXT NOT NULL,
			provider TEXT NOT NULL,
			api TEXT NOT NULL,
			timestamp INTEGER NOT NULL,
			duration INTEGER,
			ttft INTEGER,
			stop_reason TEXT NOT NULL,
			error_message TEXT,
			input_tokens INTEGER NOT NULL,
			output_tokens INTEGER NOT NULL,
			cache_read_tokens INTEGER NOT NULL,
			cache_write_tokens INTEGER NOT NULL,
			total_tokens INTEGER NOT NULL,
			premium_requests REAL NOT NULL,
			cost_input REAL NOT NULL,
			cost_output REAL NOT NULL,
			cost_cache_read REAL NOT NULL,
			cost_cache_write REAL NOT NULL,
			cost_total REAL NOT NULL,
			agent_type TEXT NOT NULL DEFAULT 'main', cost_no_cache_input REAL, cost_unpriced INTEGER NOT NULL DEFAULT 0,
			UNIQUE(session_file, entry_id)
		);
CREATE TABLE sqlite_sequence(name,seq);
CREATE INDEX idx_messages_timestamp ON messages(timestamp);
CREATE INDEX idx_messages_model ON messages(model);
CREATE INDEX idx_messages_folder ON messages(folder);
CREATE INDEX idx_messages_session ON messages(session_file);
CREATE INDEX idx_messages_timestamp_model_provider ON messages(timestamp, model, provider);
CREATE INDEX idx_messages_timestamp_folder ON messages(timestamp, folder);
CREATE INDEX idx_messages_stop_reason_timestamp ON messages(stop_reason, timestamp);
CREATE TABLE file_offsets (
			session_file TEXT PRIMARY KEY,
			offset INTEGER NOT NULL,
			last_modified INTEGER NOT NULL
		, parser_state TEXT);
CREATE TABLE user_messages (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			session_file TEXT NOT NULL,
			entry_id TEXT NOT NULL,
			folder TEXT NOT NULL,
			timestamp INTEGER NOT NULL,
			model TEXT,
			provider TEXT,
			chars INTEGER NOT NULL,
			words INTEGER NOT NULL,
			yelling INTEGER NOT NULL,
			profanity INTEGER NOT NULL,
			anguish INTEGER NOT NULL,
			negation INTEGER NOT NULL DEFAULT 0,
			repetition INTEGER NOT NULL DEFAULT 0,
			blame INTEGER NOT NULL DEFAULT 0, prose TEXT NOT NULL DEFAULT '', prose_hash TEXT NOT NULL DEFAULT '',
			UNIQUE(session_file, entry_id)
		);
CREATE INDEX idx_user_messages_timestamp ON user_messages(timestamp);
CREATE INDEX idx_user_messages_timestamp_model ON user_messages(timestamp, model, provider);
CREATE TABLE tool_calls (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			session_file TEXT NOT NULL,
			entry_id TEXT NOT NULL,
			tool_call_id TEXT NOT NULL,
			folder TEXT NOT NULL,
			tool_name TEXT NOT NULL,
			model TEXT NOT NULL,
			provider TEXT NOT NULL,
			timestamp INTEGER NOT NULL,
			agent_type TEXT NOT NULL DEFAULT 'main',
			calls_in_turn INTEGER NOT NULL DEFAULT 1,
			args_chars INTEGER NOT NULL DEFAULT 0,
			result_chars INTEGER,
			is_error INTEGER,
			UNIQUE(session_file, tool_call_id)
		);
CREATE INDEX idx_tool_calls_timestamp ON tool_calls(timestamp);
CREATE INDEX idx_tool_calls_tool_timestamp ON tool_calls(tool_name, timestamp);
CREATE TABLE meta (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL
		);
CREATE INDEX idx_messages_timestamp_agent_type ON messages(timestamp, agent_type);
CREATE INDEX idx_messages_entry_timestamp ON messages(entry_id, timestamp);
CREATE INDEX idx_user_messages_entry_timestamp ON user_messages(entry_id, timestamp);
CREATE INDEX idx_tool_calls_entry_timestamp ON tool_calls(entry_id, timestamp);
CREATE TABLE frustration_verdicts (
			prose_hash TEXT PRIMARY KEY,
			p_annoyed REAL NOT NULL,
			p_angry REAL NOT NULL,
			target TEXT NOT NULL,
			judge TEXT NOT NULL,
			judged_at INTEGER NOT NULL
		);
CREATE INDEX idx_user_messages_prose_hash ON user_messages(prose_hash);
CREATE TABLE message_rollup (
				bucket INTEGER NOT NULL,
				model TEXT NOT NULL,
				provider TEXT NOT NULL,
				folder TEXT NOT NULL,
				agent_type TEXT NOT NULL,
				requests INTEGER NOT NULL,
				failed INTEGER NOT NULL,
				input_tokens INTEGER NOT NULL,
				output_tokens INTEGER NOT NULL,
				cache_read_tokens INTEGER NOT NULL,
				cache_write_tokens INTEGER NOT NULL,
				total_tokens INTEGER NOT NULL,
				premium_requests REAL NOT NULL,
				cost_total REAL NOT NULL,
				cost_input REAL NOT NULL,
				cost_output REAL NOT NULL,
				cost_cache_read REAL NOT NULL,
				cost_cache_write REAL NOT NULL,
				unpriced INTEGER NOT NULL,
				cached_prompt_cost REAL NOT NULL,
				no_cache_input_cost REAL NOT NULL,
				duration_sum REAL NOT NULL,
				duration_n INTEGER NOT NULL,
				ttft_sum REAL NOT NULL,
				ttft_n INTEGER NOT NULL,
				tps_sum REAL NOT NULL,
				tps_n INTEGER NOT NULL,
				first_ts INTEGER NOT NULL,
				last_ts INTEGER NOT NULL
			);
CREATE INDEX idx_message_rollup_bucket ON message_rollup(bucket);
CREATE TABLE tool_rollup (
				bucket INTEGER NOT NULL,
				tool_name TEXT NOT NULL,
				model TEXT NOT NULL,
				provider TEXT NOT NULL,
				calls INTEGER NOT NULL,
				errors INTEGER NOT NULL,
				args_chars INTEGER NOT NULL,
				result_chars INTEGER NOT NULL,
				total_tokens_share REAL NOT NULL,
				output_tokens_share REAL NOT NULL,
				cost_share REAL NOT NULL,
				unpriced_share REAL NOT NULL,
				last_used INTEGER NOT NULL
			);
CREATE INDEX idx_tool_rollup_bucket ON tool_rollup(bucket);
CREATE TABLE rollup_dirty (bucket INTEGER PRIMARY KEY) WITHOUT ROWID;
CREATE TABLE session_rollup (
				session_file TEXT PRIMARY KEY,
				requests INTEGER NOT NULL,
				started_at INTEGER NOT NULL,
				ended_at INTEGER NOT NULL,
				total_tokens INTEGER NOT NULL,
				cost_total REAL NOT NULL,
				unpriced INTEGER NOT NULL,
				models TEXT,
				tool_calls INTEGER NOT NULL
			) WITHOUT ROWID;
CREATE TABLE session_dirty (session_file TEXT PRIMARY KEY) WITHOUT ROWID;
CREATE TRIGGER rollup_dirty_messages_insert AFTER INSERT ON messages BEGIN INSERT INTO rollup_dirty (bucket)
		SELECT h FROM (SELECT ((NEW.timestamp) / 3600000) * 3600000 AS h) WHERE h NOT IN (SELECT bucket FROM rollup_dirty);
	INSERT INTO session_dirty (session_file)
		SELECT NEW.session_file WHERE NEW.session_file NOT IN (SELECT session_file FROM session_dirty); END;
CREATE TRIGGER rollup_dirty_messages_delete AFTER DELETE ON messages BEGIN INSERT INTO rollup_dirty (bucket)
		SELECT h FROM (SELECT ((OLD.timestamp) / 3600000) * 3600000 AS h) WHERE h NOT IN (SELECT bucket FROM rollup_dirty);
	INSERT INTO session_dirty (session_file)
		SELECT OLD.session_file WHERE OLD.session_file NOT IN (SELECT session_file FROM session_dirty); END;
CREATE TRIGGER rollup_dirty_messages_update AFTER UPDATE ON messages BEGIN INSERT INTO rollup_dirty (bucket)
		SELECT h FROM (SELECT ((OLD.timestamp) / 3600000) * 3600000 AS h) WHERE h NOT IN (SELECT bucket FROM rollup_dirty);
	INSERT INTO session_dirty (session_file)
		SELECT OLD.session_file WHERE OLD.session_file NOT IN (SELECT session_file FROM session_dirty); INSERT INTO rollup_dirty (bucket)
		SELECT h FROM (SELECT ((NEW.timestamp) / 3600000) * 3600000 AS h) WHERE h NOT IN (SELECT bucket FROM rollup_dirty);
	INSERT INTO session_dirty (session_file)
		SELECT NEW.session_file WHERE NEW.session_file NOT IN (SELECT session_file FROM session_dirty); END;
CREATE TRIGGER rollup_dirty_tool_calls_insert AFTER INSERT ON tool_calls BEGIN INSERT INTO rollup_dirty (bucket)
		SELECT h FROM (SELECT ((NEW.timestamp) / 3600000) * 3600000 AS h) WHERE h NOT IN (SELECT bucket FROM rollup_dirty);
	INSERT INTO session_dirty (session_file)
		SELECT NEW.session_file WHERE NEW.session_file NOT IN (SELECT session_file FROM session_dirty); END;
CREATE TRIGGER rollup_dirty_tool_calls_delete AFTER DELETE ON tool_calls BEGIN INSERT INTO rollup_dirty (bucket)
		SELECT h FROM (SELECT ((OLD.timestamp) / 3600000) * 3600000 AS h) WHERE h NOT IN (SELECT bucket FROM rollup_dirty);
	INSERT INTO session_dirty (session_file)
		SELECT OLD.session_file WHERE OLD.session_file NOT IN (SELECT session_file FROM session_dirty); END;
CREATE TRIGGER rollup_dirty_tool_calls_update AFTER UPDATE ON tool_calls BEGIN INSERT INTO rollup_dirty (bucket)
		SELECT h FROM (SELECT ((OLD.timestamp) / 3600000) * 3600000 AS h) WHERE h NOT IN (SELECT bucket FROM rollup_dirty);
	INSERT INTO session_dirty (session_file)
		SELECT OLD.session_file WHERE OLD.session_file NOT IN (SELECT session_file FROM session_dirty); INSERT INTO rollup_dirty (bucket)
		SELECT h FROM (SELECT ((NEW.timestamp) / 3600000) * 3600000 AS h) WHERE h NOT IN (SELECT bucket FROM rollup_dirty);
	INSERT INTO session_dirty (session_file)
		SELECT NEW.session_file WHERE NEW.session_file NOT IN (SELECT session_file FROM session_dirty); END;
```

Note the triggers: every `INSERT`/`UPDATE`/`DELETE` on `messages` and `tool_calls` marks an **hourly
bucket** dirty (`(timestamp/3600000)*3600000`) and a session dirty, so rollups stay current
incrementally. `message_rollup` / `tool_rollup` are the pre-aggregated tables `rollup.ts` queries.

### Row counts

| Table | Rows | Kind |
|---|---|---|
| `messages` | **182,783** | fact table, one row per API request |
| `tool_calls` | **115,141** | fact table, one row per tool invocation |
| `session_rollup` | 4,178 | rollup (WITHOUT ROWID) |
| `tool_rollup` | 4,137 | rollup |
| `user_messages` | 4,123 | fact table + behavioral metrics |
| `file_offsets` | 1,979 | ingest bookkeeping |
| `message_rollup` | 1,873 | rollup |
| `meta` | 12 | backfill sentinels |
| `frustration_verdicts` | 0 | judge verdicts — **never populated on this machine** |
| `rollup_dirty` | 0 | clean |
| `session_dirty` | 0 | clean |

`sqlite_sequence` also exists (AUTOINCREMENT bookkeeping).

### Date range and cardinality

```sql
select datetime(min(timestamp)/1000,'unixepoch','localtime'),
       datetime(max(timestamp)/1000,'unixepoch','localtime'),
       count(distinct folder), count(distinct session_file) from messages;
```

```
2026-07-15 17:23:04 | 2026-10-02 20:45:20 | 57 | 4178
```

**~80 days of data, 57 distinct folders, 4,178 session files.**

### Sample: top models by request count

```sql
select provider, model, count(*) c, sum(total_tokens) t, round(sum(cost_total),2)
from messages group by provider, model order by c desc limit 12;
```

| provider | model | requests | total_tokens | cost |
|---|---|---|---|---|
| opencode-go | space-bunny-free | 33,500 | 4,311,697,497 | 0.00 |
| opencode-go | deepseek-v4-flash | 27,090 | 4,152,166,232 | 22.85 |
| openai | gpt-5.6-terra | 25,039 | 2,513,255,367 | 935.72 |
| opencode-go | muse-spark-1.2-contributor | 15,832 | 3,023,846,380 | 24.52 |
| opencode-go | muse-spark-1.3-contributor | 12,953 | 2,094,554,288 | 15.48 |
| openai | gpt-5.6-sol | 9,981 | 1,702,208,825 | 1,292.85 |
| opencode-zen | muse-spark-1.2-contributor-free | 7,590 | 573,386,939 | 0.00 |
| opencode-zen | muse-spark-1.3-contributor-free | 7,236 | 573,299,065 | 0.00 |
| openai | gpt-5.6-luna | 7,085 | 848,752,703 | 76.80 |
| opencode-zen | deepseek-v4-flash-free | 4,870 | 333,032,502 | 0.00 |
| openai | gemini-3.7-flash-high | 4,205 | 571,773,459 | 0.00 |
| openrouter | meta/muse-spark-1.3-contributor | 3,455 | 500,534,097 | 2.92 |

**⚠️ Rendering caveat:** `total_tokens` is in the **billions** per model. These are dominated by
`cache_read_tokens` on long sessions. Any TUI must format/abstract these (billions of cached tokens
for a few hundred thousand uncached output tokens) — printing raw totals would be meaningless.

Also note several rows show `cost = 0.00`: subscription/free models are priced at zero, which is why
the schema carries a `cost_unpriced` / `messages.cost_unpriced` flag
(`export function unpricedRequestSql(prefix = ""): string`).

### Sample: top folders

```sql
select folder, count(*) from messages group by folder order by 2 desc limit 8;
```

| folder | requests |
|---|---|
| `-Documents-Projects-Kaggriculture` | 28,410 |
| `-Documents-Projects-glimpse` | 26,541 |
| `-Documents-Projects-dash` | 24,035 |
| `-Documents-Projects-astryx-dracula` | 16,114 |
| `-Documents-Study` | 11,750 |
| `home-Codebreaker_MCP-71b9b94d…` | 11,322 |
| `-Documents-Projects-Peek` | 9,543 |
| `-Documents-Projects-RsaWebTool` | 8,189 |

`folder` is a mangled absolute path produced by
`parser.ts: export function extractFolderFromPath(sessionPath: string): string`.

---

## 5. The EXISTING `/stats` and `/usage` slash commands

**Both exist as first-party slash commands.** Neither is CLI-only.

Both are registered in the same file:
**`/Users/yuzu/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/slash-commands/builtin-session.ts`**

The full slash-commands directory:

```
pi-coding-agent/src/slash-commands/
├── helpers/                      (incl. stats-dashboard.ts)
├── acp-builtins.ts               3.0K
├── available-commands.ts         4.3K
├── builtin-collaboration.ts     23.1K   <- /trace, /join
├── builtin-completions.ts       12.3K
├── builtin-control.ts            2.9K
├── builtin-lifecycle.ts         32.4K   <- /memory (incl. "stats"/"diagnose" subverbs)
├── builtin-marketplace.ts       21.9K
├── builtin-modes.ts             37.0K
├── builtin-registry.ts           7.4K
├── builtin-session.ts           26.5K   <- /usage AND /stats live here
├── builtin-skills.ts             4.7K
├── marketplace-install-parser.ts 3.1K
└── types.ts                      7.5K
```

### 5a. `/usage` — CONFIRMED as a slash command

`builtin-session.ts:384-430`, verbatim:

```ts
	{
		name: "usage",
		icon: "gauge",
		description: "Show provider usage and limits",
		acpDescription: "Show token usage",
		acpInputHint: "[show|reset [provider/credential-id|provider/active]]",
		subcommands: [
			{ name: "show", description: "Show provider usage and limits" },
			{
				name: "reset",
				description: "Spend a saved provider rate-limit reset",
				usage: "[provider/credential-id|provider/active]",
			},
		],
		allowArgs: true,
		handle: async (command, runtime) => {
			const { verb, rest } = parseSubcommand(command.args);
			if (!verb || (verb === "show" && !rest)) {
				await runtime.output(await buildUsageReportText(runtime));
				return commandConsumed();
			}
			if (verb === "reset") {
				await handleUsageResetCommand(rest, runtime.session, runtime.output);
				return commandConsumed();
			}
			return usage("Usage: /usage [show|reset [provider/credential-id|provider/active]]", runtime);
		},
		handleTui: async (command, runtime) => {
			const { verb, rest } = parseSubcommand(command.args);
			if (!verb || (verb === "show" && !rest)) {
				await runtime.ctx.handleUsageCommand();
				clearSubmittedText(runtime);
				return;
			}
			if (verb === "reset") {
				if (rest) {
					await handleUsageResetCommand(rest, runtime.ctx.session, text => runtime.ctx.showStatus(text));
				} else {
					await runtime.ctx.showResetUsageSelector();
				}
				clearSubmittedText(runtime);
				return;
			}
			runtime.ctx.showStatus("Usage: /usage [show|reset [provider/credential-id|provider/active]]");
			clearSubmittedText(runtime);
		},
	},
```

**Call chain:**

```
builtin-session.ts:414  await runtime.ctx.handleUsageCommand()
  └─ modes/controllers/command-controller.ts:655  async handleUsageCommand(reports?)
       └─ :670  this.ctx.showUsageDashboard(usageReports ?? [])
            └─ modes/interactive-mode.ts:7874  showUsageDashboard(reports)
                 └─ this.#selectorController.showUsageDashboard(reports)
                      └─ modes/controllers/selector-controller.ts:347
                           └─ new UsageDashboardComponent({ … })
```

`command-controller.ts:655-671`:

```ts
	async handleUsageCommand(reports?: UsageReport[] | null): Promise<void> {
		let usageReports = reports ?? null;
		if (!usageReports) {
			const provider = this.ctx.session as { fetchUsageReports?: () => Promise<UsageReport[] | null> };
			if (!provider.fetchUsageReports) {
				this.ctx.showWarning("Usage reporting is not configured for this session.");
				return;
			}
			try {
				usageReports = await provider.fetchUsageReports();
			} catch (error) {
				this.ctx.showError(`Failed to fetch usage data: ${error instanceof Error ? error.message : String(error)}`);
			}
		}

		this.ctx.showUsageDashboard(usageReports ?? []);
	}
```

**The UI it renders** — `selector-controller.ts:342-347`, whose doc comment is the clearest
statement of the idiom to copy:

```ts
	/**
	 * Fullscreen `/usage` dashboard on the alternate screen (the /settings
	 * idiom): compact subscriptions grid + daily activity heatmap, with the
	 * classic full report one keypress away. Takes no transcript space.
	 */
	showUsageDashboard(reports: UsageReport[]): void {
```

and the component itself, `pi-tui/src/overlays/usage-dashboard.ts:1-6`:

```ts
/**
 * Fullscreen `/usage` dashboard (the /settings idiom): mounted as an overlay
 * on the alternate screen so it takes no transcript space. Shows a compact
 * subscriptions grid (one card per provider, worst window per quota bucket)
 * above a GitHub-style daily activity heatmap fed by the local stats DB.
 * Enter flips into the classic full per-account report, scrollable in place.
 */
```

**What data it reads — the critical finding.** Two sources:

1. **Live provider quota** via `ctx.session.fetchUsageReports()` → `UsageReport[]` from `@oh-my-pi/pi-ai`.
2. **The local `stats.db`** — for the heatmap only. Wired through a dedicated worker trio in
   `pi-coding-agent/src/stats/`:

   **`src/stats/activity-worker.ts:1-9`** — the header explains the design:
   ```ts
   /**
    * Stats activity worker. Loaded inside the subprocess spawned by
    * `activity-client.ts` (re-entered through the agent CLI's hidden
    * `__omp_worker_stats_activity` selector). Owns the stats DB handle for the
    * `/usage` heatmap load so the synchronous SQLite work never runs on the TUI
    * thread; the parent SIGKILLs the child once `done` arrives.
    */
   import { syncAllSessions } from "@oh-my-pi/omp-stats/aggregator";
   import { getDailyActivity } from "@oh-my-pi/omp-stats/db";
   ```

   **`src/stats/activity-worker.ts:12-31`** — streams twice, cached first then post-sync:
   ```ts
   async function handleLoad(
   	transport: StatsActivityTransport,
   	message: Extract<StatsActivityWorkerInbound, { type: "load" }>,
   ): Promise<void> {
   	try {
   		// Whatever the DB already has paints first; the incremental sync then
   		// converges the heatmap on fresh session data.
   		transport.send({ type: "activity", id: message.id, points: await getDailyActivity() });
   		await syncAllSessions();
   		transport.send({ type: "activity", id: message.id, points: await getDailyActivity() });
   		transport.send({ type: "done", id: message.id });
   	} catch (error) {
   		transport.send({
   			type: "error",
   			id: message.id,
   			error: error instanceof Error ? error.message : String(error),
   		});
   	}
   }
   ```

   **`src/stats/activity-client.ts:56-63`** — the rationale is documented on the client:
   ```ts
   /**
    * Stream daily activity for the `/usage` heatmap from a one-shot subprocess:
    * `push` receives the cached DB rows first, then the refreshed rows after an
    * incremental session sync. Resolves once the sync settles and rejects when
    * the worker fails or dies; the child is SIGKILLed either way, and aborting
    * `signal` (dashboard closed) kills it mid-sync — per-file writes are
    * transactional and the OS-owned sync lock is released with the process.
    */
   ```

   The heatmap is rendered from `DailyActivityPoint[]`; `usage-dashboard.ts:49` declares
   `export interface DailyActivityPoint { day: string; cost: number; requests: number }` and
   `usage-dashboard.ts:313` `export function buildHeatmapLayout(points, weeks)` produces a
   Monday-first week grid, rendered as a native describe-tree node with
   `role: "omp.usage.activity"` (`usage-dashboard.ts:1148`).

**Summary: `/usage` is a first-party, full-screen, alternate-screen TUI overlay that already reads
`stats.db`.** This already exists and already works.

### 5b. `/stats` — CONFIRMED as a slash command, and it still just opens the browser

`builtin-session.ts:431-465`, verbatim:

```ts
	{
		name: "stats",
		icon: "stats",
		description: "Launch the local stats dashboard",
		inlineHint: "[--port <port>] [--host <host>]",
		allowArgs: true,
		handle: async (command, runtime) => {
			const parsed = parseStatsDashboardArgs(command.args);
			if ("error" in parsed) return usage(parsed.error, runtime);

			await runtime.output("Syncing session files...");
			try {
				const result = await launchSessionStatsDashboard(parsed, runtime);
				await runtime.output(result.message);
			} catch (error) {
				await runtime.output(`Stats dashboard failed: ${errorMessage(error)}`);
			}
			return commandConsumed();
		},
		handleTui: async (command, runtime) => {
			const ctx = runtime.ctx;
			ctx.editor.setText("");
			const parsed = parseStatsDashboardArgs(command.args);
			if ("error" in parsed) {
				ctx.showStatus(parsed.error);
				return;
			}
			try {
				const result = await launchSessionStatsDashboard(parsed, ctx);
				ctx.presentCommandOutput(new StatsNotice(result.message, result.url));
			} catch (error) {
				ctx.showError(`Stats dashboard failed: ${errorMessage(error)}`);
			}
		},
	},
```

**What UI it renders:** NOT a dashboard. It renders
`ctx.presentCommandOutput(new StatsNotice(result.message, result.url))` — a small notice block
(imported at `builtin-session.ts:29`:
`import { StatsNotice } from "@oh-my-pi/pi-tui/overlays/stats-notice";`) telling you the URL, after
**having already launched a server and popped your browser open.**

**How it launches:** `builtin-session.ts:190-204`:

```ts
function launchSessionStatsDashboard(
	args: StatsDashboardArgs,
	owner: Pick<SlashCommandRuntime, "settings" | "session" | "sessionManager">,
): Promise<StatsDashboardLaunchResult> {
	const judge = resolveJudge({
		settings: owner.settings,
		registry: owner.session.modelRegistry,
		sessionId: owner.session.sessionId,
		purpose: "stats_frustration",
		onUsage: journalJudgmentUsage(owner.sessionManager),
		telemetry: owner.session.agent.telemetry,
		cache: sharedJudgmentCache(),
	});
	return launchStatsDashboard(args, async () => judge);
}
```

→ `pi-coding-agent/src/slash-commands/helpers/stats-dashboard.ts:78-100`, verbatim:

```ts
export async function launchStatsDashboard(
	args: StatsDashboardArgs,
	judge?: stats.StatsJudgeProvider,
): Promise<StatsDashboardLaunchResult> {
	let requestedAddressIgnored = false;

	if (!activeStatsServer) {
		activeStatsServer = await stats.startServer(args.port, args.host, { judge });
	} else {
		requestedAddressIgnored = args.port !== activeStatsServer.port || args.host !== activeStatsServer.hostname;
		// Resolves to the live in-process server; only re-registers the judge.
		if (judge) await stats.startServer(activeStatsServer.port, activeStatsServer.hostname, { judge });
	}

	const url = stats.formatStatsDashboardUrl(activeStatsServer.hostname, activeStatsServer.port);
	openUtils.openPath(url);

	const serverLine = requestedAddressIgnored
		? `Dashboard already running at: ${url} (requested ${args.host}:${args.port} ignored)`
		: `Dashboard available at: ${url}`;

	return { url, message: `${serverLine} (sessions sync in the background)` };
}
```

Arg parsing — `helpers/stats-dashboard.ts:4`, `:24`, `:34-37`:

```ts
export const DEFAULT_STATS_DASHBOARD_PORT = 3847;
const STATS_DASHBOARD_USAGE = "Usage: /stats [--port <port>] [--host <host>]";
export function parseStatsDashboardArgs(args: string): StatsDashboardArgs | { error: string } {
	const tokens = args.split(/\s+/).filter(Boolean);
	let port = DEFAULT_STATS_DASHBOARD_PORT;
	let host = "127.0.0.1";
```

Teardown — `helpers/stats-dashboard.ts:102-107`:

```ts
export function stopStatsDashboard(): void {
	if (!activeStatsServer) return;
	activeStatsServer.stop();
	activeStatsServer = undefined;
	stats.closeDb();
}
```

### 5c. `/trace` — a third entry into the same dashboard

`slash-commands/builtin-collaboration.ts:203-218`:

```ts
		name: "trace",
		icon: "stats",
		description: "Open this session's trace in the stats dashboard",
		handle: async (_command, runtime) => {
			const sessionFile = runtime.session.sessionFile;
			…
				// matching src/cli/stats-cli.ts, to keep CLI startup fast.
				const { formatStatsDashboardUrl, startServer } = await import("@oh-my-pi/omp-stats");
				const { hostname, port } = await startServer();
				const url = `${formatStatsDashboardUrl(hostname, port)}/#/traces?s=${encodeURIComponent(sessionFile)}`;
				await runtime.output(url);
```

`command-controller.ts:194` does the same for an in-session action.

### 5d. `/memory stats` — unrelated, a different "stats"

`builtin-lifecycle.ts:549-551` and `:610-615` register a `/memory stats` subverb that calls a
backend-provided `stats` hook and renders markdown:

```ts
			{ name: "stats", description: "Show memory backend statistics" },
```

```ts
				case "stats":
				case "diagnose": {
					const verb = action === "stats" ? "stats" : "diagnose";
					const payload = await hook?.(runtime.settings.getAgentDir(), runtime.cwd, runtime.session);
					await runtime.output(payload ?? memoryStatsUnavailableMessage(backend.id, verb));
					return commandConsumed();
```

This is memory-backend diagnostics, **not** usage stats. Do not confuse it.

---

## 6. API for mounting a full-screen TUI view / overlay

### 6a. The overlay classes on disk

`/Users/yuzu/.bun/install/global/node_modules/@oh-my-pi/pi-tui/src/overlays/` (51 entries):

```
advisor-config.ts          53.6K     model-hub.ts               139.3K
agent-activity.ts           3.3K     move-overlay.ts              7.8K
agent-hub-projection.ts     9.9K     oauth-selector.ts            21.7K
agent-hub-renderer.ts      16.0K     omfg-panel.ts                 6.4K
agent-hub-types.ts          2.6K     pause-screen.ts               8.8K
agents-hub.ts              64.8K     plan-review-overlay.ts       63.9K
annotation-overlay.ts      53.4K     plan-save-overlay.ts          4.3K
annotation-types.ts         3.8K     plan-toc.ts                   5.3K
ask-dialog.ts              57.4K     plugin-selector.ts            3.9K
bordered-loader.ts          1.6K     plugin-settings.ts           34.6K
btw-history-panel.ts       28.1K     queue-mode-selector.ts        2.1K
btw-history.ts              1.0K     reset-usage-selector.ts      10.9K
btw-panel.ts                8.2K     rewind-selector.ts           38.0K
cleanse-panel.ts            9.1K     running-subagent-badge.ts     0.6K
codex-reset-fireworks.ts    14.4K     session-account-selector.ts   2.2K
composer-shape-preview.ts   2.5K     stats-notice.ts                —
composer-shape-registry.ts  2.5K     usage-dashboard.ts             —
copy-selector.ts           41.3K     usage-display.ts              —
copy-targets.ts             3.2K     usage-row.ts                  —
disclosure.ts                   …     worker-hud.ts                 …
errors.ts                        …     + 15 more
```

**There is no `packages/tui/` directory on this machine.** The TUI package is `@oh-my-pi/pi-tui`.

### 6b. Are overlays exported from the PUBLIC entrypoint? — NO.

`grep -n "overlay" pi-tui/src/index.ts` returns **nothing**. The public entrypoint
`@oh-my-pi/pi-tui` (`src/index.ts`) exports:

```ts
// Core TUI interfaces and classes

// Autocomplete support
export * from "./autocomplete";
// Components
export * from "./chat/transcript-browser";
export * from "./components/box";
export * from "./components/cancellable-loader";
export * from "./components/composer";
export * from "./components/disclosure";
export * from "./components/editor";
export * from "./components/form";
export * from "./components/image";
export * from "./components/input";
export * from "./components/key-value-list";
export * from "./components/layout/geometry";
export * from "./components/layout/row";
export * from "./components/layout/split-pane";
export * from "./components/layout/stack";
export * from "./components/loader";
export * from "./components/markdown";
export * from "./components/menu-selection";
export * from "./components/metric";
export * from "./components/progress-bar";
export * from "./components/scroll-view";
export * from "./components/scroll-viewport";
export * from "./components/section";
export * from "./components/select-list";
export * from "./components/settings-list";
export * from "./components/spacer";
export * from "./components/tab-bar";
export * from "./components/table";
export * from "./components/text";
export * from "./components/tree-view";
export * from "./components/truncated-text";
export * from "./components/wizard-step";
…
export * from "./tui";
// Utilities
export * from "./utils";
```

**`./overlays/*` is deliberately absent from that list.**

### 6c. …but they ARE reachable through the wildcard subpath export

`pi-tui/package.json`:

```json
	"exports": {
		".":            { "types": "./dist/types/index.d.ts", "import": "./src/index.ts" },
		"./theme":      { … },
		"./render":     { … },
		"./chrome":     { … },
		"./tools":      { … },
		"./status-line":{ … },
		"./*":          { "types": "./dist/types/*.d.ts", "import": "./src/*.ts" },
		"./components/*": { "types": "./dist/types/components/*.d.ts", "import": "./src/components/*.ts" },
		"./*.js":       "./src/*.ts"
	}
```

The `"./*"` → `./src/*.ts` mapping means `@oh-my-pi/pi-tui/overlays/usage-dashboard` is a **valid,
resolved, type-backed import specifier**. It is not in the curated root barrel, but it is not
private either — there is no `exports` restriction blocking it and no `package.json` `files`/`.npmignore`
barrier (types are emitted for it under `dist/types/`).

**Proof this is the normal, blessed usage pattern — 178 deep overlay imports across 75 first-party
files:**

```
pi-coding-agent/src/activity/index.ts:1: …yOneLine, compareActivityRows } from "@oh-my-pi/pi-tui/overlays/agent-activity";
pi-coding-agent/src/activity/index.ts:10:} from "@oh-my-pi/pi-tui/overlays/agent-activity";
pi-coding-agent/src/advisor/config.ts:16:} from "@oh-my-pi/pi-tui/overlays/advisor-config";
pi-coding-agent/src/advisor/config.ts:18:… S_ADVISOR_SYNC_BACKLOG_MODES } from "@oh-my-pi/pi-tui/overlays/advisor-config";
…
pi-coding-agent/src/slash-commands/builtin-session.ts:29: import { StatsNotice } from "@oh-my-pi/pi-tui/overlays/stats-notice";
pi-coding-agent/src/modes/controllers/selector-controller.ts:  … UsageDashboardComponent from "@oh-my-pi/pi-tui/overlays/usage-dashboard"
```

### 6d. What IS public and stable

`ui.showOverlay` and `OverlayOptions` are on the public root export — `pi-tui/src/tui.ts:1188`:

```ts
	showOverlay(component: Component, options?: OverlayOptions): OverlayHandle {
		component.setIgnoreTight?.(true);
		const entry = { component, options, preFocus: this.#focusedComponent, hidden: false, released: false };
		this.overlayStack.push(entry);
		// Only focus if overlay is actually visible
		if (this.#isOverlayVisible(entry)) {
			this.setFocus(component);
		}
		this.terminal.hideCursor();
		this.#recordHardwareCursorHidden();
		this.requestRender();

		// Return handle for controlling this overlay
		return {
			hide: () => {
```

`OverlayHandle`, `pi-tui/src/tui.ts:479-486`:

```ts
export interface OverlayHandle {
	/** Permanently remove the overlay (cannot be shown again) */
	hide(): void;
	/** Temporarily hide or show the overlay */
	setHidden(hidden: boolean): void;
	/** Check if overlay is temporarily hidden */
	isHidden(): boolean;
}
```

`OverlayOptions`, `pi-tui/src/tui.ts:424` onward — full definition:

```ts
export interface OverlayOptions {
	// === Sizing ===
	/** Width in columns, or percentage of terminal width (e.g., "50%") */
	width?: SizeValue;
	/** Minimum width in columns */
	minWidth?: number;
	/** Maximum height in rows, or percentage of terminal height (e.g., "50%") */
	maxHeight?: SizeValue;

	// === Positioning - anchor-based ===
	/** Anchor point for positioning (default: 'center') */
	anchor?: OverlayAnchor;
	/** Horizontal offset from anchor position (positive = right) */
	offsetX?: number;
	/** Vertical offset from anchor position (positive = down) */
	offsetY?: number;

	// === Positioning - percentage or absolute ===
	/** Row position: absolute number, or percentage (e.g., "25%" = 25% from top) */
	row?: SizeValue;
	/** Column position: absolute number, or percentage (e.g., "50%" = 50% = centered horizontally) */
	col?: SizeValue;

	// === Margin from terminal edges ===
	/** Margin from terminal edges. Number applies to all sides. */
	margin?: OverlayMargin | number;

	// === Visibility ===
	/**
	 * Control overlay visibility based on terminal dimensions.
	 * If provided, overlay is only rendered when this returns true.
	 * Called each render cycle with current terminal dimensions.
	 */
	visible?: (termWidth: number, termHeight: number) => boolean;

	// === Fullscreen ===
	/**
	 * Borrow the terminal's alternate screen buffer for this overlay's lifetime
	 * (vim/less idiom). While the topmost visible overlay sets this, the engine
	 * paints only the modal on the alt screen and emits no ED3 / scrollback
	 * bytes, so the transcript on the normal screen stays untouched and is not
	 * scrollable behind the modal. Defaults off — all other overlays are
	 * unchanged and still draw over the transcript on the normal screen.
	 */
	fullscreen?: boolean;
	/**
	 * Enable terminal mouse reporting while fullscreen. Defaults on; disable it
	 * when native terminal text selection takes precedence over pointer events.
	 */
	mouseTracking?: boolean;
}
```

**`fullscreen: true` is exactly the "genuine full-screen TUI panel" switch the user is asking about**,
and it is public API.

`Component`, `pi-tui/src/tui.ts:229-271`:

```ts
export interface Component {
	/** Stable identifier surfaced in the debug tree as kind#id. */
	debugId?: string;
	/** Override for the tree node kind (default: constructor.name). */
	debugKind?: string;
	/** Widget state for the debug `values`/`tree` ops. JSON-serializable. */
	debugState?(): Record<string, unknown>;
	/** Children for the debug tree when not already exposed as a public `children` array. */
	debugChildren?: readonly Component[];

	/**
	 * Render the component to an array of physical rows at the given width.
	 * The result is component-owned and `readonly` to the caller; an unchanged
	 * component may (and should) return the same array reference it returned
	 * last time.
	 */
	render(width: number): readonly string[];

	/**
	 * Describe the component semantically for a Tern Surface Protocol
	 * terminal (see `native/node.ts`). Called instead of `render()` when the
	 * native backend is active. Return the same node object while nothing
	 * changed; return null to fall back to `render()` rows.
	 */
	describe?(cx: DescribeContext): NativeNode | null;

	/**
	 * Props for the native `overlay` wrapper when this component is shown as
	 * an overlay: the sheet's `role` (Tern styles `omp.overlay.*` roles as
	 * glass sheets, so the component's own root must not draw a second frame),
	 * `head` spans for the sheet's title row, and `size`/`anchor` overriding
	 * the ones derived from the overlay options.
	 */
	nativeOverlay?: {
		role?: string;
		head?: TspText;
		size?: "sm" | "md" | "lg" | "full";
```

### 6e. The first-party precedent for a full-screen overlay: `showGitOverlay`

`pi-tui/src/apps/git/git-tui.ts:1210-1240` — **this is the template to copy**:

```ts
export async function showGitOverlay(ui: TUI, host: GitTuiHost): Promise<void> {
	const component = new GitTuiComponent(ui, host);
	const overlay = ui.showOverlay(component, {
		anchor: "top-left",
		width: "100%",
		maxHeight: "100%",
		margin: 0,
		fullscreen: true,
		mouseTracking: true,
	});
	ui.setFocus(component);
	ui.requestRender();
	try {
		…
	} finally {
		…
	}
}

export async function runGitTui(host: GitTuiHost): Promise<void> {
	const ui = new TUI(new ProcessTerminal());
	ui.start();
	try {
		await showGitOverlay(ui, host);
	} finally {
		ui.stop();
	}
}
```

Note the **`runView` / `showOverlay` split** — the same component serves both the standalone
subcommand (`omp git`, creating its own `TUI` over `ProcessTerminal`) and an in-session overlay.
`pi-coding-agent/src/cli/git-tui.ts` is the thin host adapter:

```ts
import { type GitTuiHost, runGitTui as runView, showGitOverlay as showOverlay } from "@oh-my-pi/pi-tui/apps/git/git-tui";

/** Open repository review on an existing interactive session. */
export async function showGitOverlay(ui: TUI, options: GitTuiOptions = {}): Promise<void> {
	await showOverlay(ui, await createHost(options));
}

/** Run standalone repository review with application-owned capabilities. */
export async function runGitTui(options: GitTuiOptions = {}): Promise<void> {
	await runView(await createHost(options));
}
```

`omp git --help` describes itself as *"Interactive fullscreen git UI: split diff viewer, staging
sidebar, and commit composer"* — the same product shape the user wants for stats.

---

## 7. `ctx.ui` — full method list

**Type file:** `/Users/yuzu/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/extensibility/extensions/types.ts`
**Interface:** `ExtensionUIContext`, **declared at line 266**.

Declared on `ExtensionContext` at `types.ts:483-485`:

```ts
export interface ExtensionContext {
	/** UI methods for user interaction */
	ui: ExtensionUIContext;
	/** Current run mode. Use `"tui"` to guard terminal-only UI such as custom components. */
	mode: ExtensionMode;
```

### ⚠️ `ctx.ui` is NOT the raw `TUI`

This is the single most important thing to know for this task. `ctx.ui` is a **narrow, curated
facade**. It does **not** expose `showOverlay`. It exposes `custom()`, which internally calls
`showOverlay` on the real `TUI` (`this.ctx.ui` inside the controller IS a `TUI`). The raw `TUI` is
handed to you as the first argument of the `custom` factory.

### Complete `ExtensionUIContext` (types.ts:266-381, verbatim)

```ts
export interface ExtensionUIContext {
	/** True when selector timeouts start only after the dialog is presented. */
	timeoutStartsOnPresentation?: boolean;
	/** Show a selector and return the selected label, even when an option also includes a description. */
	select(
		title: string,
		options: ExtensionUISelectItem[],
		dialogOptions?: ExtensionUIDialogOptions,
	): Promise<string | undefined>;

	/** Show a confirmation dialog. */
	confirm(title: string, message: string, dialogOptions?: ExtensionUIDialogOptions): Promise<boolean>;

	/** Show a text input dialog. */
	input(title: string, placeholder?: string, dialogOptions?: ExtensionUIDialogOptions): Promise<string | undefined>;

	/** Show the rich ask dialog when the interactive TUI surface is available. */
	askDialog?(
		questions: ExtensionAskDialogQuestion[],
		dialogOptions?: ExtensionUIDialogOptions,
	): Promise<ExtensionAskDialogResult | undefined>;

	/** Show a notification to the user. */
	notify(message: string, type?: "info" | "warning" | "error"): void;

	/** Listen to raw terminal input (interactive mode only). Returns an unsubscribe function. */
	onTerminalInput(handler: TerminalInputHandler): () => void;

	/** Set status text in the footer/status bar. Pass undefined to clear. */
	setStatus(key: string, text: string | undefined): void;

	/** Set the working/loading message shown during streaming. Call with no argument to restore default. */
	setWorkingMessage(message?: string): void;

	/** Set a widget to display above or below the editor. Accepts string array or component factory. */
	setWidget(key: string, content: ExtensionWidgetContent, options?: ExtensionWidgetOptions): void;

	/** Set a custom footer component, or undefined to restore the built-in footer. */
	setFooter(factory: ExtensionUiComponentFactory | undefined): void;

	/** Set a custom header component, or undefined to restore the built-in header. */
	setHeader(factory: ExtensionUiComponentFactory | undefined): void;

	/** Set the terminal window/tab title. */
	setTitle(title: string): void;

	/** Show a custom component with keyboard focus. */
	custom<T>(
		factory: (
			tui: TUI,
			theme: Theme,
			keybindings: KeybindingsManager,
			done: (result: T) => void,
		) => ExtensionUiComponent | Promise<ExtensionUiComponent>,
		options?: ExtensionCustomOptions,
	): Promise<T>;

	/** Set the text in the core input editor. */
	setEditorText(text: string): void;

	/**
	 * Paste text into the core input editor.
	 *
	 * Interactive mode should route through the editor's paste handling (e.g. large paste markers).
	 * Non-interactive modes may fall back to replacing the editor text.
	 */
	pasteToEditor(text: string): void;

	/** Get the current text from the core input editor. */
	getEditorText(): string;

	/** Show a multi-line editor for text editing. */
	editor(
		title: string,
		prefill?: string,
		dialogOptions?: ExtensionUIDialogOptions,
		editorOptions?: { promptStyle?: boolean },
	): Promise<string | undefined>;

	/**
	 * Stack additional autocomplete behavior on top of the built-in provider
	 * (pi-compatible). Interactive mode rebuilds the editor's provider through
	 * every registered factory, in registration order; headless modes (print,
	 * RPC, ACP, subagents) accept and ignore the factory.
	 */
	addAutocompleteProvider(factory: AutocompleteProviderFactory): void;

	/**
	 * Set a custom editor component via factory function, or `undefined` to restore the default editor.
	 *
	 * The factory must return a {@link CustomEditor} subclass. Plain `EditorComponent`/`Editor`
	 * instances do not implement the action-keys, escape callbacks, and custom-key-handler surface
	 * required by interactive mode.
	 */
	setEditorComponent(
		factory: ((tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => CustomEditor) | undefined,
	): void;

	/** Get the current theme for styling. */
	readonly theme: Theme;

	/** Get all available themes with names and paths. */
	getAllThemes(): Promise<{ name: string; path: string | undefined }[]>;

	/** Load a theme by name without switching to it. */
	getTheme(name: string): Promise<Theme | undefined>;

	/** Set the current theme by name or Theme object. */
	setTheme(theme: string | Theme): Promise<{ success: boolean; error?: string }>;

	/** Get current tool output expansion state. */
	getToolsExpanded(): boolean;

	/** Set tool output expansion state. */
	setToolsExpanded(expanded: boolean): void;
}
```

**26 members.** Only one of them — `custom()` — can mount a custom rendered component.

### `ExtensionCustomOptions` (types.ts:243-252) — the overlay knobs

```ts
/** Options for `ExtensionUIContext.custom()` (overlay rendering of a custom component). */
export interface ExtensionCustomOptions {
	/** Render the component as an overlay over the transcript instead of replacing the editor area. */
	overlay?: boolean;
	/** Static or lazily resolved overlay positioning/sizing options forwarded to `showOverlay`. */
	overlayOptions?: OverlayOptions | (() => OverlayOptions);
	/** Invoked with the overlay handle once the overlay is created (overlay mode only). */
	onHandle?: (handle: OverlayHandle) => void;
	/** Abort the custom UI and reject its promise. */
	signal?: AbortSignal;
}
```

**`overlayOptions` is typed as the public `OverlayOptions`** — which includes `fullscreen?: boolean`.
So a full-screen extension panel is expressible through the sanctioned extension API.

### Supporting types

```ts
// types.ts:153
export type ExtensionUISelectItem = string | ExtensionUISelectOption;
// types.ts:197
export interface ExtensionUIDialogOptions { … }
// types.ts:234
export type TerminalInputHandler = (data: string) => { consume?: boolean; data?: string } | undefined;
// types.ts:236
export type WidgetPlacement = "aboveEditor" | "belowEditor";
// types.ts:238
export interface ExtensionWidgetOptions {
	placement?: WidgetPlacement;
}
// types.ts:257
export type AutocompleteProviderFactory = (current: AutocompleteProvider) => AutocompleteProvider;
```

### `ExtensionCommandContext` (types.ts:603) — adds session control on top

```ts
// fallow-ignore-next-line code-duplication
// Parallel to HookCommandContext: same method names, different invariants —
// extension commands additionally permit `switchSession` and `reload`,
// which hooks must not call to avoid deadlocking the agent loop.
export interface ExtensionCommandContext extends ExtensionContext {
	/** Get current context usage for the active model. */
	getContextUsage(): ContextUsage | undefined;

	/** Wait for the agent to finish streaming */
	waitForIdle(): Promise<void>;

	/** Start a new session, optionally with initialization. */
	newSession(options?: {
		parentSession?: string;
		setup?: (sessionManager: SessionManager) => Promise<void>;
	}): Promise<{ cancelled: boolean }>;

	/** Branch from a specific entry, creating a new session file. */
	branch(entryId: string): Promise<{ cancelled: boolean }>;

	/** Navigate to a different point in the session tree. */
	navigateTree(targetId: string, options?: { summarize?: boolean }): Promise<{ cancelled: boolean }>;

	/** Switch to a different session file. */
	switchSession(sessionPath: string): Promise<{ cancelled: boolean }>;

	/** Reload the current session/runtime state. */
	reload(): Promise<void>;

	/** Compact the session context (interactive mode shows UI). */
	compact(instructionsOrOptions?: string | CompactOptions): Promise<void>;
}
```

### How a slash command gets registered — `types.ts:1516-1524`

```ts
	/** Register a custom command. */
	registerCommand(
		name: string,
		options: {
			description?: string;
			getArgumentCompletions?: RegisteredCommand["getArgumentCompletions"];
			handler: RegisteredCommand["handler"];
		},
	): void;
```

with `types.ts:1327-1332`:

```ts
// `getArgumentCompletions` and bind handlers to ExtensionCommandContext.
	handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
```

### The implementation that proves `custom({overlay:true})` reaches `showOverlay`

`pi-coding-agent/src/modes/controllers/extension-ui-controller.ts:137` wires it:

```ts
			custom: (factory, options) => this.showHookCustom(factory, options),
```

and `showHookCustom` (`extension-ui-controller.ts:1144-1224`) — the decisive block:

```ts
		Promise.try(() => factory(this.ctx.ui, theme, keybindings, close))
			.then(c => {
				if (closed) {
					c.dispose?.();
					return;
				}
				component = c;
				if (options?.overlay) {
					const overlayOptions =
						typeof options.overlayOptions === "function" ? options.overlayOptions() : options.overlayOptions;
					overlayHandle = this.ctx.ui.showOverlay(
						component,
						overlayOptions ?? {
							anchor: "bottom-center",
							width: "100%",
							maxHeight: "100%",
							margin: 0,
						},
					);
					options.onHandle?.(overlayHandle);
					return;
				}
				editorReplaced = true;
				this.ctx.editorContainer.clear();
				this.ctx.editorContainer.addChild(component);
				this.ctx.ui.setFocus(component);
				this.ctx.ui.requestRender();
			})
			.catch(fail);
		return promise;
```

Note `factory(this.ctx.ui, …)` — `this.ctx.ui` is the real `TUI`, passed straight into your factory
as the `tui` parameter. And `options.overlayOptions` is forwarded verbatim to `ui.showOverlay`, so
`{ fullscreen: true }` flows through untouched.

Cleanup/teardown is handled for you:

```ts
		const cleanup = () => {
			component?.dispose?.();
			overlayHandle?.hide();
			overlayHandle = undefined;
			if (editorReplaced) {
				this.ctx.editorContainer.clear();
				this.ctx.editorContainer.addChild(this.ctx.editor);
				this.ctx.editor.setText(savedText);
			}
			this.ctx.ui.setFocus(this.ctx.editor);
			this.ctx.ui.requestRender();
		};
```

---

## 8. Verdict

### Can a third-party extension render a genuine in-TUI panel at `/stats-tui`? — **YES.**

Exact API, in order:

```ts
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

export default function activate(api: ExtensionAPI) {
	api.registerCommand("stats-tui", {
		description: "Local usage stats, rendered in-TUI",
		handler: async (args, ctx) => {
			// 1. Guard: ctx.mode === "tui" (hasUI is false in print/RPC/ACP)
			// 2. Query stats.db — see §3 for the data sources
			// 3. Mount the panel:
			await ctx.ui.custom(
				(tui, theme, keybindings, done) => new StatsTuiPanel({ /* data */ }),
				{
					overlay: true,
					overlayOptions: {
						anchor: "top-left",
						width: "100%",
						maxHeight: "100%",
						margin: 0,
						fullscreen: true,          // <-- alternate-screen, no transcript space
						mouseTracking: true,
					},
					signal: abortController.signal,
				},
			);
		},
	});
}
```

**Verified facts behind that verdict:**

1. `registerCommand(name, { description, handler })` is public — `types.ts:1517`.
2. `handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>` — `types.ts:1332`.
3. `ExtensionCommandContext extends ExtensionContext` — `types.ts:603`.
4. `ExtensionContext.ui: ExtensionUIContext` — `types.ts:485`.
5. `ctx.ui.custom<T>(factory, options)` — `types.ts:313`, and `custom` is wired at
   `extension-ui-controller.ts:137`.
6. The factory receives the real `TUI` as its first arg — `factory(this.ctx.ui, theme, keybindings, close)`
   at `extension-ui-controller.ts:1196`.
7. `options.overlay: true` → `this.ctx.ui.showOverlay(component, overlayOptions)` —
   `extension-ui-controller.ts:1203-1212`.
8. `overlayOptions` is typed `OverlayOptions`, which has `fullscreen?: boolean` — `tui.ts:424, 459`.
9. `showOverlay` and `OverlayOptions`/`OverlayHandle` are exported from the public
   `@oh-my-pi/pi-tui` root barrel via `export * from "./tui"` — `pi-tui/src/index.ts`.
10. `Component` is public — `export * from "./tui"` — `tui.ts:229`.
11. Component primitives (`Table`, `ScrollViewport`, `Text`, `Markdown`, `Metric`, `SelectList`,
    `TabBar`, `TreeView`, `KeyValueList`, `SplitPane`, …) are all public —
    `pi-tui/src/index.ts` `export * from "./components/…"`.
12. Theme is passed into the factory and is public — `pi-tui/src/index.ts` `export * from "./theme"`.
13. A first-party full-screen overlay using exactly this shape already exists and ships:
    `pi-tui/src/apps/git/git-tui.ts:1210` `showGitOverlay` with `fullscreen: true, mouseTracking: true`.

**Data access is available without any server or browser:**

```ts
import { syncAllSessions } from "@oh-my-pi/omp-stats/aggregator";
import { getDailyActivity }   from "@oh-my-pi/omp-stats/db";
import { getOverallStats, getStatsByModel, getTimeSeries, getToolStats }
                            from "@oh-my-pi/omp-stats/rollup";
```

These are deep subpath imports outside the curated `@oh-my-pi/omp-stats` root barrel, **but they are
resolved by the package's `"./*": "./src/*.ts"` exports map and are already used by first-party
`pi-coding-agent` code** (`src/stats/activity-worker.ts:8-9`, `src/cli/gc-cli.ts:7`). Precedent
exists; it is not an unsupported hack.

### Hard limits

1. **No shared renderer between the web dashboard and the TUI.** `omp-stats/src/client/` is React 19 +
   lucide-react; the TUI is hand-rolled `Component`/`render(width) => readonly string[]` in `pi-tui`.
   **Every one of the 11 dashboard routes must be rewritten**, not ported. The reusable part is the
   *data layer* (`rollup.ts`, `aggregator.ts`), not the *view layer*.

2. **`stats.db` is not a read-only artifact, and `initDb()` is a writer.** `initDb()`
   (`db.ts:115`) runs `CREATE TABLE IF NOT EXISTS`, `PRAGMA table_info` migrations, `ALTER TABLE`, and
   backfills on every open — *any* import of the query layer opens it read-write. You cannot get a
   pristine read-only handle from the package's own helpers. Mitigation, and the precedent to copy:
   run SQLite in a **subprocess** exactly as `stats/activity-worker.ts` does, so synchronous queries
   never block the TUI render thread, and rely on `PRAGMA busy_timeout = 5000` + WAL for concurrent
   access. (A direct `bun:sqlite` open with `{ readonly: true }` is also possible and sidesteps the DDL
   entirely — the schema in §4 is fully known and stable.)

3. **Blocking the TUI thread is a real hazard at this data volume.** 182,783 message rows across
   57 folders / 4,178 sessions in a 270 MB DB. `getDailyActivity` alone scans `messages` with a
   `timestamp >= ?` filter. Prefer the pre-aggregated rollup tables (`message_rollup` 1,873 rows,
   `tool_rollup` 4,137, `session_rollup` 4,178) over raw `messages` for any non-trivial view.

4. **Token numbers are misleading if rendered raw.** A single model shows 4.3 **billion** total
   tokens, almost entirely `cache_read_tokens`. Any panel must distinguish cached vs. fresh, and the
   schema's `cost_unpriced` flag must be surfaced — several top models price at exactly `0.00`, and
   silently summing them understates spend.

5. **`ctx.ui` is a narrow facade; `showOverlay` is NOT on it.** Only `custom()` mounts components, and
   only with `{ overlay: true }`; otherwise your component **replaces the editor area** rather than
   overlaying. You get `tui`, `theme`, `keybindings` and a `done()` callback — no other host services.

6. **Mode guard is mandatory.** `ctx.hasUI` is `false` in print/RPC/ACP modes and `ctx.mode` exists
   precisely for this: *"Use `"tui"` to guard terminal-only UI such as custom components."*
   (`types.ts:486-487`).

7. **`ExtensionUiComponent` is not literally `Component`.** The declared return type is
   `ExtensionUiComponent`; the impl accepts `(Component & { dispose?(): void })`. Return the optional
   `dispose()` for clean teardown — `cleanup()` calls `component?.dispose?.()`.

8. **Overlays are deep-import-only.** `@oh-my-pi/pi-tui/overlays/*` is *not* in the root barrel.
   The `"./*"` exports map makes it work (178 first-party uses prove it), but it is an uncurated path
   with no stability guarantee across upgrades. Importing `UsageDashboardComponent` itself and reusing
   it would work today but couples you to a private-ish component's constructor.

9. **Background ingest has a sync lock.** `withStatsSyncLock(dbPath, fn)`
   (`aggregator.ts:75`) plus the on-disk `~/.omp/stats.db.sync.lock` mean a concurrent
   `syncAllSessions` can block or be blocked. The activity worker's documented pattern — *"per-file
   writes are transactional and the OS-owned sync lock is released with the process"* — is the safe way
   to ride along.

### Recommendation

Do **not** attempt "move the stats dashboard into the TUI." Instead:

- **Reuse the data layer** — `getDailyActivity`, and especially the synchronous `rollup.ts` getters
  (`getOverallStats`, `getStatsByModel`, `getStatsByFolder`, `getStatsByProvider`, `getToolStats`,
  `getTimeSeries`) which already sit over pre-aggregated tables and need no server.
- **Copy the `/usage` shell** — `pi-tui/src/overlays/usage-dashboard.ts` already demonstrates the
  subscriptions-grid + heatmap full-screen alternate-screen idiom in exactly the visual language the
  user wants.
- **Copy the `activity-worker.ts` subprocess pattern** — it is the blessed way to read `stats.db`
  without stalling the TUI.
- **Copy `showGitOverlay`'s `runView`/`showOverlay` split** if you want both an `omp stats-tui`
  subcommand and an in-session `/stats-tui`.

This yields a genuine in-TUI panel built from components that already exist, rather than a React
port.

---

### NOT FOUND / not established

- No `packages/tui/` directory exists on this machine; the TUI package is `@oh-my-pi/pi-tui`.
- `src/embedded-client.generated.txt` is 0 bytes in this install (static assets come from
  `dist/client/`, which is present).
- `frustration_verdicts` is empty on this machine, so the Frustration route has no data here.
- No `.omp/plugins/node_modules` and no Homebrew node_modules for omp; it is a pure Bun global install.