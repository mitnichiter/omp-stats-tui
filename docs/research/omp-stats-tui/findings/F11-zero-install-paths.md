# F11 — Zero-install paths to omp-stats

## Angle

Can an omp extension obtain dashboard stats with **no `bun install` at all**? Five tests:
public re-exports of `@oh-my-pi/pi-coding-agent` (Test 1), `@oh-my-pi/pi-tui` overlays (Test 2),
a live module registry on `globalThis` (Test 3), the `omp stats --json` CLI (Test 4), and the
hidden `__omp_worker_*` selectors (Test 5).

**Verdict up front: there is no zero-install path that yields the stats API. `bun install` is
unavoidable — but it is cheaper than assumed (84 ms with a single dependency), and two
non-install alternatives exist for *data* only (raw `bun:sqlite` read of `~/.omp/stats.db`,
and the already-running dashboard's HTTP API).**

---

## Test 1 — pi-coding-agent public stats exports

**Verdict: nothing stats-related is public. Nothing usable.**

Runtime enumeration from a real extension process (`omp -p -e <ext> --no-extensions`):

```
@oh-my-pi/pi-coding-agent: OK keys=652 buildHeatmapLayout=undefined getDashboardStats=undefined
```

Static enumeration of the full `.d.ts` export graph (43 barrel lines → 1191 named exports,
including everything transitively re-exported from `pi-tui`) yields **zero** matches for
`getDashboardStats`, `syncAllSessions`, `refreshRollups`, `buildHeatmapLayout`,
`UsageDashboardComponent`, `DailyActivityPoint`, `aggregat*`, `sqlite*`.

Regex hits over all 652 live exports for `stat|dashboard|heatmap|rollup|usage|activit|aggregat|sqlite`:

```
STATUS_LINE_PRESETS, SqliteAuthCredentialStore, StatusLineComponent, TODO_HUD_STATE_CUSTOM_TYPE,
__resetAutoQaFlushStateForTests, createTodoHudStateData, createXdevState, getLspStatus,
githubIssueJsonWithStateReasonFallback, groupedReadUsageCallIds, reportIssueDeviceUsage,
resetYieldTurnState, resolutionDeviceUsage, statusSegmentPriority
```

Every hit is unrelated (`SessionStats`, `ModelUsageEntry`, `UsageStatistics` are *session
metadata* types; `SqliteAuthCredentialStore` is auth storage, not the stats DB; the
`StatusLine*` family is status-bar rendering). Note `STATUS_LINE_PRESETS` and
`StatusLineComponent` come from `@oh-my-pi/pi-tui/status-line`, pulled in transitively.

The barrel (`src/index.ts`) has no stats line at all. The stats surface is confined to
`src/stats/*`, `src/cli/stats-cli.ts`, `src/slash-commands/helpers/stats-dashboard.ts` — none
of which are in the public graph. `pi-coding-agent` itself does **not** re-export omp-stats;
it only *consumes* it via deep dynamic imports (`await import("@oh-my-pi/omp-stats")` in
`src/cli/stats-cli.ts`, `@oh-my-pi/omp-stats/aggregator` / `/db` in `src/stats/activity-worker.ts`).

Also confirmed: `bun:sqlite` is always available inside an extension —
`bun:sqlite: OK keys=6`, no install required (relevant to Test 3's alternative).

---

## Test 2 — pi-tui overlay re-exports

**Verdict: confirmed NOT in the public barrel. Overlays are deep-import-only.**

```
@oh-my-pi/pi-tui: OK keys=355
### @oh-my-pi/pi-tui exports=355
(no matches)   # regex: stat|dashboard|heatmap|rollup|usage|activit|aggregat|sqlite
has buildHeatmapLayout: undefined | UsageDashboardComponent: undefined | DailyActivityPoint: undefined
```

`dist/types/index.d.ts` has 57 `export *` lines; none references `./overlays/*`. The symbols
exist but only under subpaths:

```
pi-tui/dist/types/overlays/usage-dashboard.d.ts:79:
  export declare function buildHeatmapLayout(points: DailyActivityPoint[], weeks: number, today?: Date): HeatmapLayout;
pi-tui/src/overlays/usage-dashboard.ts:313:
  export function buildHeatmapLayout(points: DailyActivityPoint[], weeks: number, today = new Date()): HeatmapLayout {
```

Critically, `pi-tui`'s `package.json` `exports` map is permissive — `"./*"` and `"./components/*"`
are both listed — so `@oh-my-pi/pi-tui/overlays/usage-dashboard` **is** reachable by specifier
*once pi-tui is installed*. Proven empirically (same extension process):

```
@oh-my-pi/pi-tui/overlays/usage-dashboard: OK keys=5 buildHeatmapLayout=function getDashboardStats=undefined
```

So Test 2's answer is: the barrel omits them, but the deep path works and gives
`buildHeatmapLayout`. `UsageDashboardComponent` is a class in the same module. `DailyActivityPoint`
is a **type** (from `@oh-my-pi/omp-stats/shared-types`), so it is erased at runtime — it cannot be
read off any module namespace, only imported as a type from the omp-stats package.

---

## Test 3 — live module registry

**Verdict: no. There is no global registry, symbol, or globalThis entry holding loaded modules.**

Enumerated every `globalThis.*` assignment in `pi-coding-agent/src` matching
`globalThis.(__(omp|pi)*|Symbol.*)`. The complete set of globals an extension can observe at
runtime:

```
globals:prompt,CompressionStream,DecompressionStream,__ompLegacyPiRequireGraphModule
```

- `__ompLegacyPiRequireGraphModule` — the only interesting one. Defined at
  `src/extensibility/plugins/legacy-pi-compat.ts:2005` (`COMMONJS_REQUIRE_GLOBAL`). It backs
  `globalThis.__omp_get_require__(path)` for graph-owned CommonJS in the *extension's own* import
  graph (`legacy-pi-compat.ts:362`). It is a `require` factory for extension CJS deps — **not**
  a cache of host-loaded ESM modules. It holds no `omp-stats` handle.
- All other `globalThis.__omp_*` hits are the eval-kernel prelude surface
  (`__omp_call_tool__`, `__omp_prelude__`, `__omp_helpers__`, `__omp_tools__`,
  `__omp_display__`, `__omp_emit_status__`), the ratchet/browser/computer `prelude.js`
  bridges, and *page-side* browser globals (`__ompConsoleCapture`, `__ompBrowserVitals`,
  `__ompTernKit`, `__ompCmuxResponses`, `__ompMousePoint`) which live in Chromium, not in Bun.
- `omp-stats/src` contains **zero** `globalThis` occurrences.

There is also no host-side module cache reachable by name: the host path used for extension
specifier resolution is `installLegacyPiSpecifierShim()` → `onResolve` →
`resolveCanonicalPiSpecifier` → `Bun.resolveSync` (`legacy-pi-compat.ts:2436-2760`), which
returns a *path*, not a live namespace. The `omp-legacy-pi-host:` virtual namespace
(`BUNDLED_HOST_NAMESPACE`) exists only for compiled-binary `/$bunfs/root` mode and is reachable
only for legacy `@mariozechner/*` remaps.

**Why the live-handle idea cannot work even in principle:** omp's own stats code
(`stats-cli.ts`) lazy-imports omp-stats *only inside the `stats` command process*. In a normal
interactive omp session, the `omp-stats` module is never evaluated in the parent process at all
(the `/usage` heatmap deliberately runs in a `__omp_worker_stats_activity` **subprocess**, see
Test 5). So in the very process an extension runs in, there is no live omp-stats instance to
reach — the module is never loaded. This is not an access-control problem, it is an absence.

**Alternative that does need no omp-stats package at all:** `~/.omp/stats.db` is a plain SQLite
file, and `bun:sqlite` is always available. Read-only open measured at **1.6 ms**:

```ts
import { Database } from "bun:sqlite";
const db = new Database(process.env.HOME + "/.omp/stats.db", { readonly: true });
// open+list ms: 1.6
// tables: file_offsets, frustration_verdicts, message_rollup, messages, meta, rollup_dirty,
//         session_dirty, session_rollup, sqlite_sequence, tool_calls, tool_rollup, user_messages
```

Schema-level only — you get raw rows and must re-implement `getDashboardStats` aggregation
(`rollup.ts` is 35.9 KB, `aggregator.ts` 22.4 KB). Viable for a narrow widget, not for parity.

---

## Test 4 — `omp stats --json` CLI path (real timings + real JSON keys)

**Verdict: it works, is fast (~0.5 s cold), and prints the full dashboard payload. But there is
NO sync-free flag.**

```
$ time omp stats --json > /tmp/f11_stats.json
real	0m0.612s
user	0m0.455s
sys	0m0.178s
exit=0

stderr:
Syncing session files...
Synced 31 new entries from 4 files (184579 total)

$ wc -c /tmp/f11_stats.json
12856 /tmp/f11_stats.json
```

Warm second run: `real 0m0.529s`. `omp stats --summary`: `real 0m0.439s`, human-readable text
(Overall / By Model / By Folder).

**Exact top-level JSON shape** (keys in emission order, with sizes from this DB):

```
overall                object
byModel                array(3)
byFolder               array(3)
byAgentType            array(2)
timeSeries             array(8)
modelSeries            array(16)
modelPerformanceSeries array(16)
costSeries             array(3)
```

`overall` sample:

```json
{
 "totalRequests": 1950, "successfulRequests": 1897, "failedRequests": 53,
 "errorRate": 0.02717948717948718,
 "totalInputTokens": 19474176, "totalOutputTokens": 1323127,
 "totalCacheReadTokens": 248382678, "totalCacheWriteTokens": 0,
 "cacheRate": 0.9272963311963636, "cacheSavings": 0,
 "totalCost": 0, "unpricedRequests": 0, "totalPremiumRequests": 0,
 "avgDuration": 15134.028985412146, "avgTtft": 7613.033918600421,
 "avgTokensPerSecond": 39.92360925227318,
 "firstTimestamp": 1790927700418, "lastTimestamp": 1790950639258
}
```

**Flag enumeration — the complete, exhaustive set.** `src/commands/stats.ts`:

```ts
static flags = {
  port:    Flags.integer({ char: "p", description: "Port for the dashboard server", default: 3847 }),
  host:    Flags.string({ description: "Host to bind", default: "127.0.0.1" }),
  json:    Flags.boolean({ char: "j", description: "Output stats as JSON", default: false }),
  summary: Flags.boolean({ char: "s", description: "Print summary to console", default: false }),
};
```

That is all four. `src/cli/stats-cli.ts` branches on exactly one condition:

```ts
if (cmd.json || cmd.summary) {
  ... await syncAllSessions(...); await refreshRollups();
  ... if (cmd.json) { console.log(JSON.stringify(await getDashboardStats(), null, 2)); }
      else { await printStatsSummary(); }
  return;
}
// else: startServer(...) + open browser + block forever
```

**No sync-free JSON mode exists.** `--json` and `--summary` are hard-wired to the same
`syncAllSessions() + refreshRollups()` prelude; there is no `--no-sync`, no `--range`, and no
read-only subcommand. `syncAllSessions` is incremental and cheap when clean — hence the
0.44–0.61 s totals, of which process startup + `refreshRollups()` dominate, not the scan. The
harm is that it **writes** to `~/.omp/stats.db` (see manifest below).

Note also the standalone binary `omp-stats` (`packages/stats/src/index.ts`, `bin` entry) has a
*different* flag set — `--port/--host/--json/--sync/--help` — where `-s` means **sync+summary**,
not summary. Same code path, same no-sync-free conclusion.

**Alternative: the running dashboard's HTTP API, zero import, ~2–6 ms.** If the dashboard is
already up (`omp stats`), `GET /api/stats` returns the *identical* 8-key payload, and — unlike
the CLI — **accepts a `range` query param**:

```
$ curl -s -m 20 -o api.json  -w "http=%{http_code} time=%{time_total}\n" "http://127.0.0.1:3931/api/stats"
http=200 time=0.002119
$ curl -s -m 20 "http://127.0.0.1:3931/api/stats?range=7d" -w "http=%{http_code} time=%{time_total}\n"
http=200 time=0.005718
same as default: false
```

`handleApi` (`omp-stats/src/server.ts:165`) exposes far more than the CLI does:
`/api/status`, `/api/stats`, `/api/stats/overview`, `/api/stats/model-dashboard`,
`/api/stats/costs`, `/api/stats/frustration`, `/api/stats/tools`, `/api/stats/providers`,
`/api/stats/provider-windows`, `/api/stats/recent`, `/api/stats/errors`, gain + trace routes.
Caveat: requires a live server (the extension would have to spawn one, and `omp stats`
auto-opens a browser), and it is the whole dashboard server, not a library.

---

## Test 5 — hidden worker subcommands

All 16 `__omp_worker_*` selectors (`src/cli/worker-selectors.ts`, `src/cli.ts:182-189`, plus
`embed-client.ts`, `asr-client.ts`, `tts-client.ts`, `title-protocol.ts`):

| Selector | What it does | Reusable as a stats query service? |
|---|---|---|
| `__omp_worker_stats_activity` | **Stats-related.** One-shot subprocess owning the stats DB handle for the `/usage` heatmap. Wire: `{type:"load"}` → `activity` (cached rows) → `sync` → `activity` (refreshed) → `done`; or `error`. | **Closest thing to a service, but no.** It is deliberately one-shot: the parent SIGKILLs the child once `done` arrives, and an abort (dashboard closed) kills it mid-sync. Each `/usage` open pays a fresh spawn. Spawning it directly from an extension needs the private `spawnCommand` (`resolveWorkerSpawnCmd`) — `@oh-my-pi/omp-stats/aggregator` is imported for the *type* only, and spawning `omp __omp_worker_stats_activity` by hand means hand-rolling the IPC and losing the SIGKILL cleanup contract. It also **does** write to the DB. |
| `__omp_worker_stats_sync` | Stateless *parse* worker for `syncAllSessions`. Requests: `{kind:"parse", sessionFile, fromOffset, parserState?, replay?}` or `{kind:"ping"}`. Runs `parseSessionFile` — pure I/O+CPU, **no DB**. | No. It is a worker-thread entry (`self.onmessage`), it parses session files, it never answers queries. |
| `__omp_worker_tiny_inference` | ONNX tiny-model title/completion inference, socket-driven via `OMP_TINY_WORKER_SOCKET`. | No. |
| `__omp_worker_text_predict` | Machine-global text-prediction daemon; keeps predictors over `history.db`. | No. |
| `__omp_worker_mnemopi_embed` | fastembed/onnxruntime embeddings, isolated for NAPI destructor reasons. | No. |
| `__omp_worker_stt` / `__omp_worker_tts` | Speech-to-text / text-to-speech workers. | No. |
| `__omp_worker_js_eval` / `__omp_worker_js_eval_process` | JS eval kernel (thread and subprocess variants). | No. |
| `__omp_worker_tab` | Browser tab supervisor. | No. |
| `__omp_worker_computer` | Computer-use worker. | No. |
| `__omp_worker_blob_broker` | Project-shared blob daemon over a Unix socket. | No. |
| `__omp_worker_daemon_broker` | Daemon broker. | No. |
| `__omp_worker_ida_host` | IDA integration host. | No. |
| `__omp_worker_lsp_mux` | LSP multiplexer. | No. |
| `__omp_worker_terminal_output` | Terminal output capture. | No. |

They are all dispatched by `runWorkerEntrypoint(arg)` (`src/cli.ts:191`), keyed off
`process.argv` in a fresh `omp` subprocess. There is no request/response query contract that
any of them expose as a general RPC.

---

## Comparison table

| Path | Install step needed? | Latency (measured) | What you get | Verdict |
|---|---|---|---|---|
| `bun install @oh-my-pi/omp-stats` + `import { getDashboardStats }` | **Yes** — 84 ms, 12 packages | 924.9 ms first `getDashboardStats()` (incl. lazy DB open + rollup read); ~0.5 s amortized vs CLI | Full typed API: `getDashboardStats`, `getToolDashboardStats`, `getGainDashboardStats`, `syncAllSessions`, `refreshRollups`, `startServer`; deep `handleApi` via `/server` | **RECOMMENDED.** Cheapest real answer. |
| `bun install` all three + `pi-tui/overlays/usage-dashboard` | **Yes** — 1.51 s, 112 packages | same + module load | Adds `buildHeatmapLayout`, `UsageDashboardComponent` | Use when a heatmap is actually needed. Note `DailyActivityPoint` is a *type* — still needs omp-stats. |
| `omp stats --json` subprocess from an extension | No | 612 ms cold / 529 ms warm | Same 8-key JSON, untyped | Works, but spawns a process, **writes the DB**, and no `range` param. |
| `curl http://127.0.0.1:<port>/api/stats` | No | 2.1 ms (`/api/stats`), 5.7 ms (`?range=7d`) | Same 8 keys **plus** `range`; 10+ other endpoints | Best *latency*; needs a live server. |
| `new Database("~/.omp/stats.db", {readonly:true})` | No | 1.6 ms to open + list tables | Raw tables only | Viable for one narrow widget; you re-implement `aggregator.ts` + `rollup.ts` (58 KB combined). |
| `pi-coding-agent` public exports | No | — | Nothing stats-related (0/652 hits) | Dead end. |
| `pi-tui` public barrel | No | — | No overlays | Dead end (deep import needs install anyway). |
| `globalThis` module registry | No | — | Nothing | Dead end — and omp-stats isn't even loaded in the extension's process. |
| `__omp_worker_stats_activity` | No | spawn-per-query | `DailyActivityPoint[]`, then SIGKILL | Not a service; private IPC; writes the DB. |

---

## Recommendation

1. **Ship `bun install @oh-my-pi/omp-stats` in the extension.** Measured at **84 ms / 12 packages**
   for the single-dependency manifest — that is the entire "ceremony". Drop the other two
   dependencies; add `@oh-my-pi/pi-tui` only if the heatmap lands, and it already comes as
   omp-stats' transitive tree in that case.
2. **Import the barrel** `@oh-my-pi/omp-stats` (12 exports, incl. `getDashboardStats`). Use
   `@oh-my-pi/omp-stats/server` (`handleApi`) only if you want the HTTP surface without
   `startServer`. Verify the deep paths stay exported across versions — they are package-exports
   entries, not accidental file access.
3. **Cache aggressively.** The first `getDashboardStats()` cost 925 ms; the CLI does the same work
   in ~500 ms total including startup, so subsequent reads are far cheaper. Render from a
   background cache, never inline on the TUI thread — that is precisely why upstream moved this
   into `__omp_worker_stats_activity` in the first place (`activity-protocol.ts`: "on a multi-GB
   stats database each query stalls the event loop for seconds, which froze the TUI").
4. **Do not shell out to `omp stats --json` as the primary path.** It is fast and gives the same
   payload, but it re-syncs (a DB *write*), gives no `range`, is untyped, and spawns a full CLI.
   Keep it as a debug/fallback assertion in tests.
5. **Copy the rollup tables, not the raw one.** With `@oh-my-pi/omp-stats` installed you can call
   `refreshRollups()` yourself and query `message_rollup` / `session_rollup` / `tool_rollup`
   via `bun:sqlite` cheaply, instead of paying `getDashboardStats()`'s full aggregation each read.

---

## Searches

```
grep -rn "omp-stats" pi-coding-agent/src/            -> 8 files, all deep dynamic imports
grep -n  "stat|dashboard|..." pi-coding-agent/src/index.ts   -> 0 barrel hits
grep -n  "overlay|heatmap|usage-dashboard" pi-tui/dist/types/index.d.ts -> exit 1 (absent)
grep -rn "globalThis\.(__(omp|pi)|Symbol\.)" pi-coding-agent/src/       -> full global census
grep -rn "globalThis" omp-stats/src/                -> no matches
grep -rn "__omp_worker_[a-z_]+" pi-coding-agent/src/ -> 16 selectors
sed -n '181,260p' pi-coding-agent/src/cli.ts        -> runWorkerEntrypoint dispatch
cat  pi-coding-agent/src/commands/stats.ts          -> exhaustive flag list
cat  pi-coding-agent/src/cli/stats-cli.ts           -> the json/summary branch
sed -n '165,240p' omp-stats/src/server.ts           -> handleApi routes
```

Empirical runs: `bun run` probes under `~/.omp/agent/extensions/_probe_f11{,.b}` driven by
`omp -p -e <ext> --no-extensions --no-skills --no-rules "hi"` (all removed — see manifest).

---

## Gaps

- **Not tested:** `omp stats --json` piped into a real dashboard render (shape compatibility is
  assumed from the identical `getDashboardStats()` return, which I verified key-for-key against
  `/api/stats`).
- **Not tested:** whether the ~84 ms `bun install` holds offline/cold-cache. Measured warm, with
  all three packages already in Bun's cache. A truly cold first install would be slower.
- **Not tested:** `omp-stats` version pinning. Extension and host are both `18.4.10` here; a
  skew would surface as a missing deep export, not a load failure.
- **Uncertain:** whether an extension may legitimately *spawn* `omp __omp_worker_stats_activity`
  by hand. The selector is reachable (`omp` accepts it in argv) but the IPC contract, the
  SIGKILL-on-`done` cleanup, and the DB-write side effects all live in private client code. I
  did not attempt a hand-rolled spawn.
- **Not tested:** concurrency — two processes reading `~/.omp/stats.db` while `omp stats`
  syncs. `stats.db.sync.lock` exists (0 bytes at session start), suggesting an OS-owned sync
  lock; I did not probe its semantics under contention.
- **Version drift:** the host at `~/.bun/install/global/node_modules/@oh-my-pi/*` is `18.4.10`.
  All "public export" conclusions are as-of that version.

## Change manifest

### Files created (then deleted)

All probe files were created under `~/.omp/agent/extensions/` and `/tmp/`, and every one is gone.

| Path | Why | Deletion evidence |
|---|---|---|
| `~/.omp/agent/extensions/_probe_f11/` (pkg.json, probe.ts, enum.ts, enum2.ts, ext.ts, node_modules/) | Test 1/2/3 enum + import probe | `ls -la ~/.omp/agent/extensions/` → only `herdr-omp-agent-state.ts`, `rtk.ts` |
| `~/.omp/agent/extensions/_probe_f11b/` (pkg.json, ext.ts, node_modules/) | Test 4b minimal-install probe | same |
| `/tmp/f11_stats.json`, `/tmp/f11_stats.err` | Test 4 CLI output | `ls /tmp/f11*` → `No such file or directory` |
| `/tmp/f11_ext.txt`, `/tmp/f11_extb.txt`, `/tmp/f11_run.log`, `/tmp/f11_run2.log`, `/tmp/f11_runb.log` | extension probe results | same |
| `/tmp/f11_srv.log`, `/tmp/f11_api.json`, `/tmp/f11_api7.json` | dashboard server log + curl output | same |

### Files modified or deleted (persisting)

**Nothing.** No pre-existing file was edited, moved, or deleted.

### Installs / package trees

Yes — `bun install` ran twice, both inside probe dirs that have since been removed.

| Run | Command | Result | Dir now |
|---|---|---|---|
| `_probe_f11` | `bun install` with `pi-coding-agent` + `pi-tui` + `omp-stats` | `112 packages installed [1.51s]` | removed |
| `_probe_f11b` | `bun install` with `omp-stats` only | `12 packages installed [60.00ms]` (`real 0m0.084s`) | removed |

`find ~/.omp/agent -maxdepth 2 \( -name node_modules -o -name package.json -o -name bun.lock -o -name bun.lockb \)` → **no output**. No stray `package.json`, `bun.lock`, or `node_modules/` survives under `~/.omp/agent/`.

### Under ~/.omp

`~/.omp/agent/extensions/` before → contained the user's two extensions **plus** my two probe
dirs; after → the user's two only:

```
644  herdr-omp-agent-state.ts  12.1K
600  rtk.ts  2.6K
```

`~/.omp/agent/` otherwise untouched: no `config.yml`, `mcp.json`, `agent.db`, `history.db`,
`models.db`, or `RULES.md` modification. `~/.omp/plugins/` was never accessed.

### Under ~/.bun

**Nothing written by me.** `bun install` populated the shared Bun cache under
`~/.bun/install/cache/` — but both dependency sets were already cached at the pinned
`18.4.10` (this is the same version the global omp install uses), so the installs resolved
from cache and created no new cache entries I am aware of. **Uncertain:** I did not diff
`~/.bun/install/cache/` before and after, so I cannot prove zero new cache entries. I did
verify `~/.bun/install/global/node_modules/@oh-my-pi/` still contains exactly the original 14
packages with no new entry for a probe dir.

### Database state

```
$ stat -f '%m %z %N' ~/.omp/stats.db
1790950952 320831488 /Users/yuzu/.omp/stats.db
$ date +%s
1790951238
$ sqlite3 "file:$HOME/.omp/stats.db?mode=ro" "PRAGMA integrity_check;"
ok
```

Size at the first check: 320,831,488 bytes (305.8 MiB), mtime 1790950952 — consistent with my
last `omp stats` invocation. A final check at the end of the session read
`1790951269 320905216` — i.e. ~74 KB larger, ~5 min newer. **That growth is my own live omp
session being logged** (this agent's transcript and the sibling agents' runs keep appending to
`messages`), not a probe artifact. Either way `PRAGMA integrity_check` still returns `ok`.

**Yes, Test 4's `omp stats --json` wrote to this DB.** Its stderr said
`Synced 31 new entries from 4 files (184579 total)`, and `stats-cli.ts` unconditionally calls
`syncAllSessions()` + `refreshRollups()` before printing. Four session files produced 31 new
message rows. **This was unavoidable** — the documented behaviour of the command under test, and
the task brief flagged it in advance. **No corruption:** `PRAGMA integrity_check` returns `ok`.
My `bun:sqlite` opens were all `{ readonly: true }`.

### /tmp

Created and deleted: the 10 `/tmp/f11*` files in the table above (`ls /tmp/f11*` →
`No such file or directory`).

Sibling-agent scratch also released and deleted, after both owners confirmed they were finished
with it (`glyph-design`: "Data-gathering is done, they can go now. Not touching them; treat as
free to delete." `glyph-system2`: "Safe to trash all five."): `/tmp/g3.ts`, `/tmp/g4.ts`,
`/tmp/g6.ts`, `/tmp/glyphtest.ts`, `/tmp/glyphtest2.ts` — all confirmed gone by `ls`.
`/tmp/f9` and `/tmp/ompext-probe` never existed.

### Processes

**None left.** The one background dashboard (`omp stats --port 3931`, started for the Test 4 HTTP
probe) was killed with `pkill -f "omp stats --port 3931"`; `pgrep -fl "omp stats"` →
`no omp stats procs`. `~/.omp/stats.db.sync.lock` is 0 bytes (lock released).

---

## Test 4 result, stated plainly

- **`omp stats --json` works.** Exit 0, 12,856 bytes on stdout.
- **Top-level keys, in order:** `overall`, `byModel`, `byFolder`, `byAgentType`, `timeSeries`,
  `modelSeries`, `modelPerformanceSeries`, `costSeries`.
- **Timing:** 612 ms cold, 529 ms warm (measured with `time`, not estimated).
- **Sync-free JSON: does not exist.** The only flags are `--port/-p`, `--host`, `--json/-j`,
  `--summary/-s`; `--json` and `--summary` share one unconditional
  `syncAllSessions() + refreshRollups()` prelude.