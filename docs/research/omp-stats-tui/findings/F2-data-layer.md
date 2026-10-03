# Angle
The omp stats data layer: which aggregator/rollup functions an in-TUI panel must call, what they actually cost in wall-clock ms on the live 304MB/183k-row DB, and whether a read-only in-process handle is safe.

Scope: `~/.bun/install/global/node_modules/@oh-my-pi/omp-stats/src/{aggregator,rollup,db,types,shared-types}.ts` and
`~/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/stats/`.
All DB facts were read from a **copy** of `~/.omp/stats.db` (`PI_CONFIG_DIR` redirect, see Measurements). No project code was modified.

## Claims

### 1. `aggregator.ts` — every export, exact signature + what it calls

Every one of these `async` functions is a thin wrapper: it calls `await initDb()` (which must have run or the rollup layer sees `currentDb() === null` and **returns `[]` / a zeroed aggregate silently**), resolves a range window, then calls **synchronous** `rollup.ts` functions. There is no I/O in the query path itself.

| Export | Signature | Async | Returns | Calls |
|---|---|---|---|---|
| `getTimeRangeConfig` | `(range?: string \| null): RangeWindow` | no | `{ cutoff: number \| null; bucketMs: number }` | none (pure) |
| `getDashboardStats` | `(range?: string \| null): Promise<DashboardStats>` | yes | `DashboardStats` | `getOverallStats` + `getStatsByModel` + `getStatsByFolder(…, 2000)` + `getStatsByAgentType` + `getTimeSeries` + `getModelTimeSeries` + `getModelPerformanceSeries` + `getCostTimeSeries` — **8 rollup queries** |
| `getOverviewStats` | `(range?): Promise<Pick<DashboardStats,"overall"\|"byAgentType"\|"timeSeries">>` | yes | 3-field Pick | `getOverallStats` + `getStatsByAgentType` + `getTimeSeries` — **cheapest full panel** |
| `getModelDashboardStats` | `(range?): Promise<Pick<DashboardStats,"byModel"\|"modelSeries"\|"modelPerformanceSeries">>` | yes | 3-field Pick | `getStatsByModel` + `getModelTimeSeries` + `getModelPerformanceSeries` |
| `getCostDashboardStats` | `(range?): Promise<Pick<DashboardStats,"costSeries">>` | yes | 1-field Pick | `getCostTimeSeries` |
| `getFolderStats` | `(range?): Promise<FolderStats[]>` | yes | array | `getStatsByFolder(cutoff, 2000)` |
| `getRecentRequests` | `(limit?: number): Promise<MessageStats[]>` | yes | array | `db.getRecentRequests` — **raw `messages`** |
| `getRecentErrors` | `(range?, limit?): Promise<MessageStats[]>` | yes | array | `db.getRecentErrors` — **raw `messages`** |
| `getRequestDetails` | `(id: number): Promise<RequestDetails \| null>` | yes | obj/null | `db.getMessageById` + **reads the transcript JSONL file** via `parser.getSessionEntry` (async fs) |
| `getTotalMessageCount` | `(): Promise<number>` | yes | number | `db.getMessageCount` — `SELECT COUNT(*) FROM messages` |
| `getToolDashboardStats` | `(range?): Promise<ToolDashboardStats>` | yes | `{byTool,byToolModel,series}` | `getToolStats` + `getToolStatsByModel` + `getToolTimeSeries` |
| `getProviderDashboardStats` | `(range?): Promise<ProviderDashboardStats>` | yes | `{providers,hourly,series}` | `getStatsByProvider` + `getProviderHourlyBurn` + `getProviderTimeSeries` |
| `getProviderWindowStats` | `(range?, provider?): Promise<ProviderWindowStats>` | yes | `{windowInsights,usageSeries}` | **`usage-windows.fetchUsageData` → network broker fetch**, memoized 60s per hour-aligned cutoff |
| `syncAllSessions` | `(opts?: SyncOptions): Promise<{processed:number;files:number}>` | yes | counts | writes; takes `withStatsSyncLock` |
| `withStatsSyncLock` | `<T>(dbPath: string, fn: () => Promise<T>): Promise<T>` | yes | `T` | OS file lock only |
| `smokeTestSyncWorker` | `({timeoutMs?}?): Promise<void>` | yes | void | spawns a worker |

- **The three functions a minimal panel should not call**: `getProviderWindowStats` (network I/O, "the broker fetch takes seconds"), `syncAllSessions` (writes, seconds-to-minutes), `getRequestDetails` (reads transcript files).
- **The recommended minimal set** is `getOverviewStats(range)` — 3 rollup queries, measured 10–30 ms total.

Evidence: `aggregator.ts:498-660`.

### 2. `rollup.ts` — rollup tables vs raw tables

**The design is explicit.** Module doc, `rollup.ts:1-26`:

> "The raw tables hold millions of rows; grouping them per request made every range switch cost seconds. Instead, `message_rollup` / `tool_rollup` keep one row per (hour, dimensions) with additive sums, so a 90-day query reads a few thousand rows."
>
> "Reads never wait for a refresh and are exact: each query unions — clean rollup hours inside the range, raw rows for the partial hour at the range start, and raw rows for dirty hours (while few are dirty)"

Classification of every range-query export:

| Export | Signature | Returns | Tables scanned |
|---|---|---|---|
| `getOverallStats` | `(cutoff?: number\|null): AggregatedStats` | `AggregatedStats` | `message_rollup` + raw `messages` for the partial start hour |
| `getStatsByModel` | `(cutoff?): ModelStats[]` | array | same union, `GROUP BY model, provider` |
| `getStatsByFolder` | `(cutoff?, limit?): FolderStats[]` | array | same union, `GROUP BY folder` |
| `getStatsByAgentType` | `(cutoff?): AgentTypeStats[]` | array | same union, `GROUP BY agent_type` |
| `getTimeSeries` | `({cutoff,bucketMs}: RangeWindow): TimeSeriesPoint[]` | array | same union, bucketed |
| `getModelTimeSeries` | `({cutoff,bucketMs}): ModelTimeSeriesPoint[]` | array | same union |
| `getModelPerformanceSeries` | `({cutoff,bucketMs}): ModelPerformancePoint[]` | array | same union |
| `getCostTimeSeries` | `(cutoff?): CostTimeSeriesPoint[]` | array | same union, always **daily** buckets |
| `getStatsByProvider` | `(cutoff?): ProviderAggregate[]` | array | same union |
| `getProviderHourlyBurn` | `(cutoff?): ProviderHourlyPoint[]` | array | same union |
| `getProviderTimeSeries` | `({cutoff,bucketMs}): ProviderTimeSeriesPoint[]` | array | same union |
| `getSessionRollups` | `(): SessionRollupRow[]` | array | `session_rollup` + raw `messages` for dirty sessions |
| `getToolStats` | `(cutoff?): ToolUsageStats[]` | array | `tool_rollup` (+ raw `tool_calls` partial hour) |
| `getToolStatsByModel` | `(cutoff?): ToolModelStats[]` | array | `tool_rollup` union |
| `getToolTimeSeries` | `({cutoff,bucketMs}): ToolTimeSeriesPoint[]` | array | `tool_rollup` union |
| `ensureRollupSchema` | `(database: Database): void` | void | writes DDL |
| `getRollupStatus` | `(): RollupStatus` | `{dirtyHours,dirtySessions}` | `rollup_dirty`/`session_dirty` |
| `refreshRollupBatch` | `(limit: number): number` | number | writes |
| `refreshRollups` | `(opts?): Promise<void>` | void | writes |

**Key nuance for the TUI**: `queryMessages` picks the *raw* path when `bucketMs < HOUR_MS`. The `1h` range uses 5-minute buckets and therefore **aggregates the raw `messages` table directly** (`rollup.ts:432-437`, and the module doc: "The 1h range needs 5-minute buckets, so it aggregates raw rows directly"). For a `1h` panel the rollup advantage is gone — it is still fast (small window, indexed by `idx_messages_timestamp`) but it is NOT the sub-millisecond rollup path. Measured: **NOT MEASURED** for 1h (I did not include it in the probe; extrapolation is forbidden).

Second nuance: **exactness degrades under backlog.** `EXACT_DIRTY_LIMIT = 96` (`rollup.ts:62`): when more than 96 hours are dirty (e.g. right after a version bump, which DROPs and rebuilds every rollup row), reads stop unioning dirty hours and just read **stale rollup rows** — "stale-but-present; not-yet-built hours are missing". A panel could silently show holes. `getRollupStatus()` is the guard.

Measured rollup sizes on the live DB: `message_rollup` = **1907 rows**, `tool_rollup` = **5608**, `session_rollup` = **4192**, `rollup_dirty` = **0**, `session_dirty` = **0**. So this DB is fully rolled up and clean.

### 3. `initDb()` on a steady-state DB does not mutate the file — but it is not read-only

`initDb` (`db.ts:115-125`) unconditionally opens **read-write** and sets pragmas:

```ts
db = new Database(getStatsDbPath());
// Install the busy handler BEFORE any lock-taking statement. See
// https://github.com/can1357/oh-my-pi/issues/2421.
db.run("PRAGMA busy_timeout = 5000");
db.run("PRAGMA journal_mode = WAL");
```

It then runs a long `CREATE TABLE IF NOT EXISTS` block, backfill sentinels, and `ensureRollupSchema`. `ensureRollupSchema` self-documents why steady state is safe (`rollup.ts:184-186`):

> "Steady state touches no schema: DDL on every open would contend with other omp processes writing the same database."

Confirmed empirically: `rollup_version=2`, `rollup_triggers_version=3` in `meta`, both matching the code constants — so `ensureRollupSchema` returns at its guard. Measured on the copy: **`initDb()` succeeded in 864 ms and the DB file was byte-identical and mtime-identical before and after** (`mutated=false`). So it is *safe in practice* but it is a **read-write handle with write intent**, which is the wrong shape for a TUI extension.

### 4. Concurrency is a non-issue for a read-only handle — WAL readers never block

- DB is in **WAL mode** (measured: `PRAGMA journal_mode` → `wal`; `stats.db-shm` and `stats.db-wal` exist on disk).
- `busy_timeout` on the **package's** handle = **5000 ms** (measured via the handle `initDb` returned).
- `busy_timeout` on a **hand-opened readonly** handle = **0** (measured) — a second's default, because we set nothing. It does not matter (see below), but if we ever want to open read-write we must set it ourselves.
- **A read-only second process never blocks and never corrupts.** Measured: with a writer holding an open `BEGIN IMMEDIATE` transaction on the same file, a readonly reader completed `SELECT COUNT(*) FROM message_rollup` in **0.9 ms**, and a second reader in **0.1 ms**. WAL permits exactly one writer and unlimited concurrent readers; readers see the last committed snapshot and never take a write lock.
- A write attempt from a readonly handle fails **immediately** with `SQLITE_READONLY: attempt to write a readonly database` (measured) — not `SQLITE_BUSY`, and not after a timeout. Read-only is a hard guarantee, not a convention.
- `withStatsSyncLock` is irrelevant to readers — it only serializes *writers*:

  > "Serialize stats ingestion and archive reconciliation across processes. The lock covers file discovery, parsing, and the final SQLite write so a parse result for a session moved by GC can never commit after cleanup. The native lock is owned by an operating-system primitive, so an interrupted owner is released automatically and a live owner is never displaced."
  > `aggregator.ts:68-81`

  It is `withFileLock(`${dbPath}.sync`, …)` with `retryDelayMs: 25` and `retries = ceil(3600000/25) = 144000` — i.e. **it waits up to one hour, polling every 25 ms, then throws** `Failed to acquire lock for … after 144000 attempts` (`pi-utils/src/file-lock.ts:52-65`). A TUI panel must never call `syncAllSessions`, or a contended lock would hang it for an hour.

### 5. There is NO way to get a read-only handle from the package

`db.ts:83` exposes `currentDb(): Database | null` — it returns the module-private `db` variable, which is only ever assigned by `initDb()`, which only ever assigns a **read-write** handle. `grep -rn "readonly" src/` finds zero SQLite read-only handles in the package (only TypeScript `readonly` array modifiers and a `readonly string[]` param type). There is no `openStatsDb({ readonly })`, no injection point, no setter. **`currentDb()` returns `null` until `initDb()` has run**, and every rollup getter silently degrades to `[]`/zeros in that case (`rollup.ts:508`, `:516`, `:856`: `if (!database) return []`).

**Conclusion: a TUI extension must open `bun:sqlite` directly with `{ readonly: true }`.** Importing the package's getters forces a read-write handle.

### 6. First-party TUI code already reads stats.db — via a subprocess, on purpose

`pi-coding-agent/src/stats/activity-protocol.ts:1-11` is the design statement, in the author's words:

> "Wire types between the `/usage` dashboard and the one-shot stats activity subprocess. `bun:sqlite` is synchronous, so the daily-activity aggregate (a scan over every `messages` row in the heatmap window) and the session sync that precedes its refresh run in a child process — on a multi-GB stats database each query stalls the event loop for seconds, which froze the TUI for the whole load when it ran inline. See `activity-client.ts` for the spawn/kill glue."

`activity-worker.ts:1-6`:

> "Stats activity worker. Loaded inside the subprocess spawned by `activity-client.ts` (re-entered through the agent CLI's hidden `__omp_worker_stats_activity` selector). Owns the stats DB handle for the `/usage` heatmap load so the synchronous SQLite work never runs on the TUI thread; the parent SIGKILLs the child once `done` arrives."

**Why a subprocess, in the author's own terms:** `bun:sqlite` is synchronous, so *any* stats query blocks the event loop; on a multi-GB DB each query stalls for seconds and "froze the TUI for the whole load when it ran inline". The first-party path therefore (a) isolates the blocking work in a child that the parent `SIGKILL`s, (b) pushes cached DB rows first so the panel paints immediately, then pushes refreshed rows after `syncAllSessions()`, and (c) degrades gracefully — `spawnWorkerOrUnavailable(…, "stats activity worker spawn failed; usage history unavailable")` yields a stub worker rather than throwing.

**Implication for a lighter panel:** the subprocess exists because `/usage` calls `syncAllSessions()` (write) plus `getDailyActivity()`, a **full raw-table scan** (measured **195.6 ms**). A read-only panel over `message_rollup` — worst measured query **31.5 ms**, typical **1–25 ms** — is a different order of magnitude and does not inherit that justification. The author already anticipated the cheap path: `db.getDailyActivity`'s doc (`db.ts:981-985`) says it is "Self-initializing (opens the stats DB on first use) **so the coding-agent TUI can query without the dashboard server's init flow**" — i.e. an in-process TUI query was considered acceptable for that function.

### 7. Types: verbatim field names for panel rendering

**`AggregatedStats` — `shared-types.ts:11-52`:**

```ts
export interface AggregatedStats {
	totalRequests: number;
	successfulRequests: number;
	failedRequests: number;
	errorRate: number;            // 0-1
	totalInputTokens: number;
	totalOutputTokens: number;
	totalCacheReadTokens: number;
	totalCacheWriteTokens: number;
	cacheRate: number;            // "Percentage of prompt input tokens served from cache (0-1)."
	cacheSavings: number;         // "Prompt-input cost saved relative to billing the same tokens uncached
	                              //  (0-1; negative when cache writes cost more than reads save)."
	totalCost: number;
	unpricedRequests: number;     // "Requests with token usage but no public-equivalent subscription price."
	totalPremiumRequests: number;
	avgDuration: number | null;   // ms
	avgTtft: number | null;       // ms
	avgTokensPerSecond: number | null; // "output tokens / duration"
	firstTimestamp: number;
	lastTimestamp: number;
}
```

**Cached vs fresh tokens:** there is no `cachedTokens` field. Fresh input is `totalInputTokens`; cached input is split into `totalCacheReadTokens` and `totalCacheWriteTokens`. `cacheRate = totalCacheReadTokens / (totalInputTokens + totalCacheReadTokens)` — cache **writes are excluded from the rate denominator** (`rollup.ts:587-590`). `cacheSavings` is a dollar-savings ratio, not a token count.

**`ModelStats` / `FolderStats` — `shared-types.ts:55-66`:** both are `AggregatedStats` plus one discriminator:
```ts
export interface ModelStats extends AggregatedStats { model: string; provider: string; }
export interface FolderStats extends AggregatedStats { folder: string; }
```

**`DashboardStats` — `shared-types.ts:156-165`:**
```ts
export interface DashboardStats {
	overall: AggregatedStats;
	byModel: ModelStats[];
	byFolder: FolderStats[];
	byAgentType: AgentTypeStats[];
	timeSeries: TimeSeriesPoint[];
	modelSeries: ModelTimeSeriesPoint[];
	modelPerformanceSeries: ModelPerformancePoint[];
	costSeries: CostTimeSeriesPoint[];
}
```

**Supporting shapes** (`shared-types.ts`): `TimeSeriesPoint {timestamp, requests, errors, tokens, cost}` (70-78); `ModelTimeSeriesPoint {timestamp, model, provider, requests}` (86-95); `CostTimeSeriesPoint {timestamp, model, provider, cost, unpricedRequests, costInput, costOutput, costCacheRead, costCacheWrite, requests}` (118-134); `AgentTypeStats {agentType:"main"|"subagent"|"advisor", totalRequests, totalInputTokens, totalOutputTokens, totalCacheReadTokens, totalCacheWriteTokens, totalCost}` (180-198); `ToolUsageStats {tool, calls, errors, argsChars, resultChars, totalTokensShare, outputTokensShare, costShare, unpricedRequestsShare, lastUsed}` (334-355); `ToolDashboardStats {byTool, byToolModel, series}` (372-376); `ProviderAggregate {provider, totalRequests, failedRequests, models, totalInputTokens, totalOutputTokens, totalCacheReadTokens, totalCacheWriteTokens, totalTokens, totalCost, unpricedRequests, totalPremiumRequests, avgTokensPerSecond}` (381-395); `ProviderDashboardStats {providers, hourly, series}` (513-517); `ProviderWindowStats {windowInsights, usageSeries}` (526-529).

**`MessageStats` — `types.ts:9-46`:** `id?, sessionFile, entryId, folder, model, provider, api, timestamp, duration, ttft, stopReason, errorMessage, usage: Usage, agentType, costUnpriced?`.

**How unpriced spend is represented — this is subtle and matters for a money panel.** There is no `cost_unpriced` field on the aggregate types; instead `unpriced` is a **count**, not a flag or an amount:
- In SQL, the source column is `messages.cost_unpriced INTEGER` (0/1) (`db.ts:139`). `MessageStats.costUnpriced?: boolean` is the per-row boolean, written by `rowToMessageStats` as `row.cost_unpriced === 1` (`db.ts:944`).
- Rolled up as `SUM(unpriced)` → surfaced as `unpricedRequests: number` on `AggregatedStats`, `ProviderAggregate`, and `CostTimeSeriesPoint.unpricedRequests`; on tools it is a **fraction**: `unpricedRequestsShare` (`TOTAL(unpriced_share)` = per-call `unpriced / calls_in_turn`).
- Semantics, verbatim (`types.ts:31-35`): *"Ingest refused to price this request: a scheduled (time-based) card with no recoverable request timestamp, so `usage.cost.total` of 0 is unknown spend rather than a free request."*
- **Panel rule: `totalCost` silently under-reports by the unpriced requests. A truthful panel must render `unpricedRequests` alongside cost.** Same on `SessionSummary.unpricedRequests` ("Requests whose zero cost is unknown spend (scheduled card, no timestamp)").

Also note the mixed aggregate function usage in `AGGREGATE_COLUMNS` (`rollup.ts:534-550`): `SUM()` for counts/tokens and `TOTAL()` for money. `TOTAL()` treats NULL as 0 and returns 0.0 on an empty set, which is why a zero-request range reports cost `0` rather than null.

## Measurements

**Setup.** All queries ran against a **byte copy** of the live DB at `/tmp/f2/omp/.omp/stats.db` (304.5 MB, plus its `-wal`/`-shm`), with `HOME=/tmp/f2/omp PI_CONFIG_DIR=.omp` so the package's `getStatsDbPath()` (`pi-utils/src/dirs.ts:308`, `process.env.PI_CONFIG_DIR || ".omp"`) resolved to the copy. The live `~/.omp/stats.db` was never opened for write.

Machine state at measurement: macOS 27.0.0 (darwin/arm64). `messages` = 183,845 rows; `tool_calls` = 173,647; `message_rollup` = 1907; `tool_rollup` = 5608; `session_rollup` = 4192; `rollup_dirty` = 0; `session_dirty` = 0. Timestamp span 1784107384868 → 1790946656254 (≈79 days). Warm page cache: every query was run once to warm, then timed.

**Table A — the real package getters** (`PROBE_MODE=pkg`, importing `@oh-my-pi/omp-stats/src/aggregator.ts` and `db.ts`, calling the exported functions, `performance.now()` wall clock).

| query (package function) | 7d ms | 30d ms | 90d ms | all ms |
|---|---|---|---|---|
| overall (`getDashboardStats().overall`) | 18.9 | 10.7 | 23.1 | 17.9 |
| by model (`getDashboardStats().byModel`) | 17.1 | 9.4 | 19.3 | 17.6 |
| by folder (`getFolderStats`) | 2.4 | 1.5 | 3.1 | 2.9 |
| time series daily (`getOverviewStats().timeSeries`) | 7.1 | 2.7 | 5.3 | 4.7 |
| by agent type (`getOverviewStats().byAgentType`) | 6.0 | 2.7 | 5.4 | 4.8 |
| cost series daily (`getCostDashboardStats`) | 2.1 | 1.2 | 2.6 | 2.6 |
| model series (`getModelDashboardStats().modelSeries`) | 6.5 | 3.7 | 8.2 | 8.9 |
| model perf series | 6.8 | 3.6 | 7.9 | **31.5** |
| tool stats (`getToolDashboardStats().byTool`) | **22.7** | 9.8 | 21.8 | 21.5 |
| by provider (`getProviderDashboardStats().providers`) | 6.7 | 3.7 | 8.5 | 7.9 |

Note: the 7d numbers are the first touched after `initDb()` and include per-`Database` prepare-compile cost; 30d is the best case. **All are under 32 ms; nothing exceeded 200 ms; nothing is flagged SLOW.**

| composite call | ms | shape |
|---|---|---|
| `getDashboardStats("30d")` (all 8 queries) | **10.0** | full dashboard payload |
| `getToolDashboardStats("30d")` (all 3 queries) | **6.7** | full tools payload |
| `getRecentRequests(100)` — raw `messages` | 0.5 | 100 rows |
| `getRecentErrors("30d", 100)` — raw `messages` | 0.7 | 100 rows |
| `getTotalMessageCount()` — `SELECT COUNT(*) FROM messages` | 22.9 | scalar |
| `initDb()` (first call, includes DDL parse + backfill checks) | **864.1** | one-time per process |
| **`getDailyActivity(371)`** — raw `messages` GROUP BY day | **195.6** | 71 rows — the only query near 200 ms, and the one that forced the subprocess design |

**Table B — hand-written equivalent SQL on a `{ readonly: true }` handle** (`PROBE_MODE=ro`), replicating `messageSource`/`toolSource`'s union shape (rollup rows `WHERE bucket >= hi`, plus the raw partial start hour). This is what a TUI that opens `bun:sqlite` itself will actually cost:

| query | 7d ms | 30d ms | 90d ms | all ms | rows (all) |
|---|---|---|---|---|---|
| overall | 1.0 | 0.3 | 0.6 | 0.2 | 1 |
| by model | 1.0 | 0.4 | 1.0 | 0.4 | 38 |
| time series (daily) | 1.0 | 0.3 | 0.7 | 0.3 | 69 |
| by agent type | 0.9 | 0.4 | 0.7 | 0.2 | 3 |
| by provider | 0.9 | 0.4 | 0.8 | 0.3 | 11 |
| tool stats | 0.1 | 0.3 | 1.0 | 0.8 | 57 |
| cost series (daily) | 0.9 | 0.4 | 1.0 | 0.5 | 220 |
| **RAW `SELECT COUNT(*) FROM messages`** | 0.1 | 0.0 | 0.0 | 0.0 | 183,845 |

**Reading of Table B:** the raw full-table `COUNT(*)` is as fast as the rollup queries (0.0–0.1 ms) because it is answered from a covering index/rowid B-tree without touching table rows; it is *not* a valid cost proxy for a `GROUP BY` over raw rows. The honest raw-vs-rollup contrast is `getDailyActivity` (**195.6 ms**, `GROUP BY day` over all 183,845 rows) against the equivalent daily-bucketed rollup query `time series (daily)` (**0.3 ms all-time**) — a ~650× gap, which is exactly the gap the rollup tables exist to close.

**Table C — concurrency probes** (script `/tmp/f2/conc.ts`):

| probe | result |
|---|---|
| `PRAGMA journal_mode` on live DB | `wal` |
| `PRAGMA busy_timeout` on package handle (post-`initDb`) | `5000` |
| `PRAGMA busy_timeout` on `{readonly:true}` handle | `0` |
| write attempt from readonly handle | **immediately** `SQLITE_READONLY: attempt to write a readonly database` |
| readonly read while another connection holds open `BEGIN IMMEDIATE` write tx | **OK, 0.9 ms**, correct data |
| second concurrent readonly read during same write tx | **OK, 0.1 ms** |

**Scripts used.** `/tmp/probe-stats.ts` (the throwaway probe: `PROBE_MODE=pkg|ro`, `PROBE_DB` env) and `/tmp/f2/conc.ts` (concurrency). **Both deleted after the run, along with the 304 MB sandbox copy `/tmp/f2/`.** Nothing left behind; no project file was modified. The probe is reproducible by re-creating `/tmp/probe-stats.ts` from this file's description, or more simply by opening the DB read-only and running the Table B queries directly.

## Searches

```
ls -la ~/.omp/stats.db*                                  # 304.5M db, -wal 161K, -shm 64K, .sync.lock 0B
wc -l ~/.bun/.../omp-stats/src/*.ts                       # aggregator 660, rollup 951, db 1586, shared-types 662, types 239
grep -n "^export function|^export async function|^export const|^export type|^export interface" rollup.ts
grep -n "busy_timeout|journal_mode|currentDb|initDb|getRecentRequests|getRecentErrors" db.ts
grep -rn "export async function withFileLock" -A 40 pi-utils/src/file-lock.ts
grep -rn "readonly" omp-stats/src/                        # zero SQLite readonly handles
cat pi-coding-agent/src/stats/{activity-worker,activity-client,activity-protocol}.ts
PROBE_MODE=ro|pkg bun /tmp/probe-stats.ts ; bun /tmp/f2/conc.ts
```

## Conflicting evidence

- **Table A vs Table B disagree by ~10× on the same logical queries** (e.g. by-model: 17.6 ms via `getStatsByModel` vs 0.4 ms for my equivalent SQL). Cause: `queryMessages` calls `dirtyIsSmall(database)` — a separate `SELECT COUNT(*) … FROM rollup_dirty` — and every getter re-`prepare()`s a fresh, large, non-cacheable UNION statement; my probe ran the same statement twice and timed only the warm one. **Both numbers are real; the delta is per-call statement preparation, not data volume.** Take Table A as the honest end-to-end cost if you call the package, Table B as the cost if you hand-roll. Neither is a warm-statement best case.
- `withStatsSyncLock`'s comment says the lock is released automatically "if an interrupted owner" and "a live owner is never displaced" — consistent with the measured OS-primitive behavior, no contradiction found.
- `getDailyActivity`'s 195.6 ms is on a 79-day DB, while `activity-protocol.ts` says "multi-GB" and "seconds". Not a contradiction — different DB sizes — but the TUI-freeze claim is **not** reproduced by this query on this data at this size.

## Gaps

- **The `1h` range (5-minute raw buckets) is NOT MEASURED.** This is the one range that bypasses the rollup tables entirely and is the most likely to be slow for a panel default. Measure before shipping a 1h view.
- **Cold-cache timings NOT MEASURED.** Every number came from a warm page cache; a TUI's first open after boot, or a panel opened cold, will be slower. The 864 ms `initDb()` is a cold-ish number and is the best available proxy for one-time cold cost.
- **`getProviderWindowStats`, `syncAllSessions`, `getRequestDetails` NOT MEASURED** — each performs network I/O, writes, or transcript-file reads respectively; timing them would have required mutating the DB or hitting the live broker. Their cost is unbounded from local measurement and they are excluded from the recommended panel path on that basis.
- **Concurrency was measured single-writer, not at scale.** I tested one writer + two readers. Behavior under many concurrent `omp` writers, and under a WAL checkpoint storm (the live `-wal` was 161 KB), is untested.
- **Whether a readonly handle can read a WAL that is being actively written by a *different* process** was not tested — all writes in my concurrency probe happened in the same process. WAL's reader/writer isolation is a documented SQLite property, but I did not verify it here with two OS processes.
- The `EXACT_DIRTY_LIMIT = 96` / `EXACT_DIRTY_SESSIONS = 512` staleness threshold was not exercised (this DB has `rollup_dirty = 0`). Worst-case degraded-read timings during a rollup rebuild are **NOT MEASURED** and could be much worse.