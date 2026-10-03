# F9 — Import strategies for reusing `@oh-my-pi/omp-stats` from an omp extension

Probe date: 2026-10-02. omp 18.4.10, Bun 1.4.2, darwin-arm64.
Host install root: `/Users/yuzu/.bun/install/global/node_modules/@oh-my-pi/`
Extension dir: `~/.omp/agent/extensions/`

# Angle

Determine a robust, portable (no hardcoded absolute user path) way for an `omp`
extension to import `@oh-my-pi/omp-stats` so we reuse `handleApi`, the
aggregator/rollup query functions, and `syncAllSessions` instead of writing our
own SQL — and, for the first strategy that works, measure real function against
a copy of `~/.omp/stats.db`.

# Strategy results

## Control (baseline, not one of the four)

`zz-f9-s0.ts` with a bare static `import { handleApi } from "@oh-my-pi/omp-stats/server"`:

```
Failed to load extension: /Users/yuzu/.omp/agent/extensions/zz-f9-s0.ts: Failed to load extension: Failed to load pi_natives native addon for darwin-arm64.

Tried:
- /Users/yuzu/.bun/install/cache/@oh-my-pi/pi-natives@18.4.10@@@1/native/pi_natives.darwin-arm64.node: Cannot find module '...'
Require stack:
- /Users/yuzu/.bun/install/cache/@oh-my-pi/pi-natives@18.4.10@@@1/native/loader-state.js
- /Users/yuzu/.bun/bin/pi_natives.darwin-arm64.node: Cannot find module '/Users/yuzu/.bun/bin/pi_natives.darwin-arm64.node'
```

Confirmed the prior finding. Note the failure is *not* "cannot resolve
`@oh-my-pi/omp-stats`" — Bun **does** resolve it, just into the flat install
cache:

```
$ bun zz-f9-disc.ts
shim: /Users/yuzu/.bun/install/cache/@oh-my-pi/pi-tui@18.4.10@@@1/src/index.ts
stats direct: /Users/yuzu/.bun/install/cache/@oh-my-pi/omp-stats@18.4.10@@@1/src/server.ts
execPath: /Users/yuzu/.bun/bin/bun
```

The cache copy of `pi-natives` ships `native/` without the platform `.node`
sibling, so `loadNative()` throws. The global install *does* have it:

```
$ ls ~/.bun/install/global/node_modules/@oh-my-pi/pi-natives-darwin-arm64/
pi_natives.darwin-arm64.node  166.9M
$ ls ~/.bun/install/cache/@oh-my-pi/pi-natives@18.4.10@@@1/native/
(no .node file)
```

## STRATEGY 1 — `Bun.plugin` resolve hook — **FAILED (structurally impossible)**

Extension registered the hook at module top level, then `await import()`ed a
sibling module holding a *static* bare import:

```ts
const HOST = /* realpath of `omp` on PATH, walk up to node_modules/@oh-my-pi */;
const STATS = path.join(HOST, "omp-stats", "src");
Bun.plugin({
	name: "stats-tui-resolve",
	setup(build) {
		build.onResolve({ filter: /^@oh-my-pi\/omp-stats(\/.*)?$/, namespace: "file" }, args => {
			const sub = args.path.replace("@oh-my-pi/omp-stats", "").replace(/^\//, "");
			return { path: path.join(STATS, `${sub || "index"}.ts`), namespace: "file" };
		});
	},
});
export default async function () {
	const m = await import("/tmp/f9/lib/consumer.ts"); // consumer.ts: import { handleApi } from "@oh-my-pi/omp-stats/server"
}
```

`omp models -e .../zz-f9-s1.ts`:

```
F9 host: /Users/yuzu/.bun/install/global/node_modules/@oh-my-pi
Failed to load extension: .../zz-f9-s1.ts: Failed to load extension: Failed to load pi_natives native addon for darwin-arm64.
```

Same error, unchanged. **The hook never fires for a bare specifier in Bun
1.4.2.** Isolated repro with a synthetic package proved it:

```
$ cd /tmp/f9/nmtest   # node_modules/tinypkg installed locally
$ bun t.ts            # onResolve filter /^tinypkg$/
(no output; import succeeded)
$ bun t2.ts           # onResolve filter /.*/
HOOK {"path":"/private/tmp/f9/nmtest/node_modules/tinypkg/i.js","importer":""}
HOOK {"path":"/private/tmp/f9/nmtest/node_modules/tinypkg/i.js","importer":""}
$ bun t3.ts           # onResolve filter /^tinypkg$/, namespace "file"
(no output)
```

Bun's `onResolve` sees only **post-resolution absolute paths** (`i.js`), never the
bare specifier (`tinypkg`). So no `onResolve` filter can intercept
`@oh-my-pi/omp-stats/server` before Bun's resolver runs. Sequencing
(dynamic vs. static import, plugin file ordering) is irrelevant — there is no
ordering that helps, because the hook is never offered the bare specifier at all.
Recording the sequencing question as answered: **the separate-module +
dynamic-import shape is not the problem; the hook API is.**

## STRATEGY 2 — Runtime root discovery + absolute-path import — **LOADED**

Portable discovery via the `omp` bin on `PATH`:

```ts
const HOST = (() => {
	for (const dir of (process.env.PATH || "").split(path.delimiter)) {
		try {
			const real = fs.realpathSync(path.join(dir, "omp"));
			const idx = real.lastIndexOf(`${path.sep}node_modules${path.sep}@oh-my-pi${path.sep}`);
			if (idx !== -1) return real.slice(0, idx + "/node_modules/@oh-my-pi".length);
		} catch {}
	}
	throw new Error("host root not found");
})();
const STATS = path.join(HOST, "omp-stats", "src");
export default async function () {
	const server = await import(`${STATS}/server.ts`);
}
```

`omp models -e .../zz-f9-s2.ts`:

```
F9 s2 host: /Users/yuzu/.bun/install/global/node_modules/@oh-my-pi
F9 s2 handleApi: function
```

No load error. Discovered path correct; import succeeds. `Bun.resolveSync` is
**not** usable for discovery here — it returns the broken flat-cache path (see
Control above). `realpath` of the `omp` shim is the portable route.

## STRATEGY 3 — Subprocess worker — **LOADED**

```ts
const proc = Bun.spawnSync({
	cmd: [process.execPath, workerFile],
	env: { ...process.env, NODE_PATH: `${HOST}/..` },  // = .../install/global/node_modules
	cwd: import.meta.dir,
});
```

`omp models -e .../zz-f9-s3.ts`:

```
F9 s3 stdout: {"ok":true,"status":200} stderr:  rc: 0
```

Resolution matrix for a subprocess running a script that statically imports
`@oh-my-pi/omp-stats/server`:

| Invocation | Result |
|---|---|
| `bun worker.ts`, cwd `/tmp/f9` (bare) | FAILED — `pi_natives` addon |
| cwd `/Users/yuzu/.bun/install/global/node_modules` | FAILED — `pi_natives` addon |
| cwd `/Users/yuzu/.bun/install/global` | FAILED — `pi_natives` addon |
| `NODE_PATH=/Users/yuzu/.bun/install/global/node_modules bun worker.ts` | **OK** `{"ok":true,"status":200}` |
| absolute path import of `.../omp-stats/src/server.ts` | **OK** `{"ok":true,"status":200}` |
| local `node_modules/@oh-my-pi` symlink → global install, bare import | **OK** `{"ok":true,"status":200}` |

Bun keys bare resolution off the **importing file's** directory, not `cwd`, which
is why the `cwd` variants all fail.

## STRATEGY 4 — Declared dependency — **LOADED**

`/tmp/f9/s4/package.json` + completed `bun install`:

```json
{"name":"f9-s4","type":"module","dependencies":{"@oh-my-pi/omp-stats":"18.4.10"}}
```

```
$ bun install
Saved lockfile

+ @oh-my-pi/omp-stats@18.4.10

12 packages installed [146.00ms]
```

Exact tree produced:

```
node_modules/
  @oh-my-pi/
    omp-stats  omptype  pi-ai  pi-catalog  pi-natives
    pi-natives-darwin-arm64  pi-utils  pi-wire
  lucide-react/  react/  react-dom/  scheduler/
```

The key line is `pi-natives-darwin-arm64` — the platform sibling that the flat
cache omits is installed as a real directory here, so `loadNative()` finds the
`.node`. Works both as a standalone dir and as a subdirectory of
`~/.omp/agent/extensions/`:

```
$ omp models -e /tmp/f9/s4/ext.ts
F9 s4 handleApi: function
$ omp models -e ~/.omp/agent/extensions/zz-f9-s4/ext.ts
F9 s4 handleApi: function
```

# Verified function

Run with `HOME=/tmp/f9/dbhome` (the redirection knob — see below) against a copy
of `~/.omp/stats.db` (+ `-wal`, `-shm`) at `/tmp/f9/dbhome/.omp/stats.db`, with
`~/.omp/agent/sessions` symlinked in so ingest had real work.

**Env var:** `HOME` is the knob. `PI_CONFIG_DIR` is *not* usable as an absolute
path — it is joined onto homedir:

```
$ HOME=/tmp/f9/dbhome bun probe-env.ts
PI_CONFIG_DIR= undefined HOME= /tmp/f9/dbhome
getStatsDbPath: /tmp/f9/dbhome/.omp/stats.db
getConfigRootDir: /tmp/f9/dbhome/.omp

$ HOME=/tmp/f9/dbhome PI_CONFIG_DIR=/tmp/f9/dbhome/.omp bun probe-env.ts
getStatsDbPath: /tmp/f9/dbhome/tmp/f9/dbhome/.omp/stats.db     <-- doubled, wrong
```

## 1. `handleApi`

```
handleApi ok: true status: 200
overview keys: byAgentType,overall,timeSeries
```

Top-level keys for `GET /api/stats/overview?range=7d`: **`byAgentType`,
`overall`, `timeSeries`**.

## 2. `initDb()` file mutation

```
BEFORE initDb: {"mtimeMs":1790949743974.192,"size":320413696}
initDb ms: 866.9 AFTER: {"mtimeMs":1790949743974.192,"size":320413696}
```

`initDb()` does **not** mutate the file (identical mtime and size; the 866.9 ms
is schema/pragma setup only).

## 3. `syncAllSessions()`

```
syncAllSessions: {"processed":151107,"files":3401} ms: 7141.3
AFTER sync: {"mtimeMs":1790949787842.1973,"size":321871872}
```

**7.14 s wall clock** for 3401 files / 151107 rows on a warm OS page cache. The
copy grew 305.6 MB → 307.1 MB (mtime and size both changed — the write).

Warm follow-up `getDashboardStats("7d")` on the now-warm copy: **6.4 ms** first
call in that process, **~5.8–6.1 ms** steady state.

## 4. Per-range `getDashboardStats` timings

First process (immediately post-sync):

| range | ms |
|---|---|
| `1h` | 8.3 |
| `24h` | 1.5 |
| `7d` | 11.1 |
| `30d` | 11.8 |
| `90d` | 18.5 |
| `all` | 13.1 |
| `365d` | 1.2 (invalid key → falls back to the `24h` default) |

Second process, three runs each:

| range | run0 | run1 | run2 |
|---|---|---|---|
| `1h` | 434.2 | 4.8 | 4.8 |
| `24h` | 1.2 | 1.2 | 1.2 |
| `7d` | 6.4 | 6.1 | 5.8 |
| `30d` | 9.9 | 9.5 | 9.5 |
| `90d` | 14.1 | 13.8 | 14.0 |
| `all` | 13.4 | 12.9 | 13.0 |

```
rollupStatus: {"dirtyHours":2,"dirtySessions":5}
```

**Open question closed: `1h` is cheap.** The 434.2 ms `run0` for `1h` is
first-query-in-process page-cache warmup, not rollup cost — runs 1 and 2 are
4.8 ms. `1h` bypasses the rollup tables exactly as suspected and costs no more
than the rollup-backed ranges. Every range is under 20 ms warm, so no range
needs a subprocess for query latency.

## 5. `syncAllSessions` under lock contention — TUI-safety

`withStatsSyncLock` (`aggregator.ts:75`) is `withFileLock` with
`retryDelayMs: 25` and `retries: Math.ceil(3_600_000 / 25) = 144000`.

Empirical contention test — held the lock for 4 s, then called `syncAllSessions`:

```
holder acquired, sleeping 4s
holder releasing
syncAllSessions acquired after 3660 ms
```

It **blocks**, but not as a hard hang: the wait is `await`-based on the timer
loop, so the extension's async continuations keep running and it acquires as soon
as the holder releases. The hazard is not deadlock, it is that a 3.6 s (or up to
60-minute) stall sits on the caller's promise with no cancellation — and because
the *work itself* is synchronous `bun:sqlite` inside the lock, holding the lock
from the TUI's main thread blocks the whole TUI event loop for the 7.14 s the
sync actually took. Safe only if either (a) called off the main thread, or
(b) accepted a multi-second UI freeze, or (c) never called at all because the
host already syncs.

# Recommendation

**Strategy 4 (declared dependency) as primary; Strategy 2 as fallback.**

Strategy 4 is the only strategy that makes the bare specifier `@oh-my-pi/omp-stats`
work, which means the extension source stays idiomatic — no absolute paths, no
`Bun.plugin` gymnastics, no `NODE_PATH` plumbing. It also self-heals the actual
root cause: it installs `pi-natives-darwin-arm64` next to `pi-natives`, so
`loadNative()` succeeds where the flat-cache install fails. Cost is a committed
`bun.lock` plus a `node_modules/` (~180 MB for the native addon) inside the
extension dir, which is the correct tradeoff for a reusable extension. Confirmed
working from both a standalone dir and a subdirectory of `extensions/`.

Strategy 2 is the portable fallback because discovery via `realpath` of the `omp`
bin on `PATH` is robust and needs no install step. Keep it as the escape hatch
if a user cannot run `bun install`.

Strategy 3 (subprocess) is not needed for *import* resolution, but is likely
still needed for *execution*: `syncAllSessions` blocks the TUI event loop for
7.14 s, and `bun:sqlite` is synchronous. The first-party `/usage` view's pattern
— spawn a worker, stream results over a pipe — is the right shape for ingest,
independently of how the module got resolved. Queries themselves need no
subprocess: every range is <20 ms warm.

On ingest specifically: prefer **not** calling `syncAllSessions` from the TUI at
all unless the host has not already synced. If it is needed, run it in a
subprocess (Strategy 3's spawn, with Strategy 4's `NODE_PATH`/abs-path resolution
in the worker) rather than in the extension's main thread.

# Export surface

Runtime `Object.keys()` of each entry point (values only; types are erased):

**`index` (root)** — 12 names:
`closeDb, formatStatsDashboardUrl, getDashboardStats, getGainDashboardStats, getToolDashboardStats, getTotalMessageCount, parseStandaloneStatsArgs, printStatsSummary, refreshRollups, smokeTestSyncWorker, startServer, syncAllSessions`

**`/server`** — 3: `formatStatsDashboardUrl, handleApi, startServer`

**`/aggregator`** — 16:
`getCostDashboardStats, getDashboardStats, getFolderStats, getModelDashboardStats, getOverviewStats, getProviderDashboardStats, getProviderWindowStats, getRecentErrors, getRecentRequests, getRequestDetails, getTimeRangeConfig, getToolDashboardStats, getTotalMessageCount, smokeTestSyncWorker, syncAllSessions, withStatsSyncLock`

**`/rollup`** — 20:
`ensureRollupSchema, getCostTimeSeries, getModelPerformanceSeries, getModelTimeSeries, getOverallStats, getProviderHourlyBurn, getProviderTimeSeries, getRollupStatus, getSessionRollups, getStatsByAgentType, getStatsByFolder, getStatsByModel, getStatsByProvider, getTimeSeries, getToolStats, getToolStatsByModel, getToolTimeSeries, refreshRollupBatch, refreshRollups`

**`/db`** — 25:
`applySessionParseResults, closeDb, completeSessionSync, currentDb, getDailyActivity, getFileOffset, getFileOffsets, getFrustrationByModel, getFrustrationOverall, getMessageById, getMessageCount, getPendingFrustrationProse, getPendingFrustrationTotals, getRecentErrors, getRecentRequests, initDb, insertMessageStats, insertToolCalls, insertUserMessageStats, isScheduledCatalogModel, markSessionBackfillsComplete, prepareSessionSync, setFileOffset, unpricedRequestSql, updateToolResults, updateUserMessageLinks, upsertFrustrationVerdicts`

**`/shared-types`** — 0 runtime exports (pure type module; all declarations are
interfaces/types: `AggregatedStats, ModelStats, FolderStats, TimeSeriesPoint,
ModelTimeSeriesPoint, ModelPerformancePoint, CostTimeSeriesPoint,
DailyActivityPoint, DashboardStats, AgentType, AgentTypeStats, FrustrationCounts,
FrustrationModelStats, FrustrationJobState, FrustrationJobStatus,
FrustrationDashboardStats, FrustrationEstimate, GainSourceTotals, GainSource,
GainTimeSeriesPoint`).

**`/types`** — 0 runtime exports (pure type module: `MessageStats,
MessageStatsInput, RequestDetails, SessionHeader, SessionMessageEntry,
SessionServiceTierChangeEntry, SessionModelUsageEntry, SessionCustomEntry,
SessionTypedEntry, SessionEntry, UserMessageStats, UserMessageLink,
ToolCallStats, ToolResultLink`).

The two type-only subpaths are reachable only for `import type` — nothing to
enumerate at runtime, but nothing blocking either.

# Searches

- `grep "getStatsDbPath"` → `pi-utils/src/dirs.ts:847`, `dirs.rootSubdir("stats.db", "data")`
- `grep "PI_CONFIG_DIR"` → `pi-utils/src/dirs.ts:308`, `process.env.PI_CONFIG_DIR || CONFIG_DIR_NAME` — a *name* relative to homedir, hence `HOME` is the redirect knob
- `grep "Failed to load extension"` → `pi-coding-agent/src/extensibility/extensions/loader.ts:434`, `loader.ts:457`, `models-cli.ts:353`
- `grep "function loadLegacyPiModule"` → `pi-coding-agent/src/extensibility/plugins/legacy-pi-compat.ts:2618`
- `grep "LEGACY_PI_SPECIFIER_FILTER"` → `legacy-pi-compat.ts:846` — the host's own hook matches `@oh-my-pi/<pi-package>` for a hardcoded 8-name allowlist (`pi-agent-core, pi-ai, pi-catalog, pi-coding-agent, pi-natives, pi-tui, pi-utils`, `omptype` via `pi-wire`). **`omp-stats` is not in that list**, which is precisely why the host declines it and Bun falls through to the flat cache. This is the upstream mechanism behind the original bug.
- `grep "withStatsSyncLock"` → `omp-stats/src/aggregator.ts:75`, constants at `:60-61`

# Gaps

1. **The real `~/.omp/stats.db` was mutated by this probe — disclosure.** The
   Strategy 3 subprocess matrix ran `worker.ts` with the inherited environment
   (no `HOME` override), so `handleApi` ran against the real DB. WAL was
   checkpointed and the main file grew:

   | | before | after |
   |---|---|---|
   | `stats.db` | mtime 1790948427, 320200704 B | mtime 1790949725, 320413696 B |
   | `stats.db-wal` | mtime 1790949430, 2249552 B | 0 B (checkpointed) |
   | `stats.db-shm` | mtime 1790946718, 65536 B | mtime 1790949743, 65536 B |

   This is a normal SQLite WAL checkpoint, not corruption — the data is intact
   and now consolidated into the main file. It was not intended; the DB-redirect
   measurement should have run before the subprocess matrix. All later work used
   the copy.

2. Timings come from a warm page cache on one machine (M-series darwin-arm64,
   SSD). Cold-cache numbers will be worse; the ordering (queries ≪ sync) holds.

3. `syncAllSessions` was measured against a sessions tree symlinked from the
   real `~/.omp/agent/sessions` (3401 files, 151107 rows). A different session
   corpus scales roughly linearly in file count.

4. Strategy 4 was not tested on a machine where the global install is missing,
   or under `bun install --frozen-lockfile` in CI.

5. `365d` is not a valid key and silently falls back to the `24h` default — worth
   knowing before wiring a range picker.

6. Whether the host performs its own `syncAllSessions` before the extension runs
   (which would make our ingest call redundant) was not determined.