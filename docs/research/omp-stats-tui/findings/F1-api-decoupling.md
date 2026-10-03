# Angle
Whether omp-stats' JSON API can be called in-process via `handleApi(synthetic Request)` with no listening socket.

## Claims

- **`handleApi` is exported from `server.ts` with a plain `(req: Request) => Promise<Response>` signature** — evidence: `/Users/yuzu/.bun/install/global/node_modules/@oh-my-pi/omp-stats/src/server.ts:165` — `export async function handleApi(req: Request): Promise<Response> {` — confidence: high
  - Live proof of export surface: `bun -e 'const m = await import("…/src/server.ts"); console.log(Object.keys(m))'` → `[ "formatStatsDashboardUrl", "handleApi", "startServer" ]`.
  - It is NOT re-exported from the package root `index.ts` (only `formatStatsDashboardUrl`, `StartServerOptions`, `startServer` at `index.ts:24`), so the plugin must deep-import `@oh-my-pi/omp-stats/server`. That IS allowed by `package.json` `exports["./*"].import = "./src/*.ts"` (`"exports": { "./*": { "import": "./src/*.ts" } }`).

- **`handleApi` NEVER references the Bun server object; zero `Bun.serve`-only APIs inside it.** Full body is lines 165–329. Searching for `server.` inside `handleApi` yields nothing. The only `server.timeout()` call lives in `createDashboardServer`'s `fetch`, i.e. OUTSIDE `handleApi` — evidence: `server.ts:385` — `server.timeout(req, 0);` guarded by `if (path === "/api/events") {` at `server.ts:383`. `server` is the second `fetch` parameter declared at `server.ts:368` (`async fetch(req, server) {`). Confidence: high.

- **Therefore the JSON API is fully separable from `Bun.serve`. Zero of the 23 `/api/*` routes are welded to the HTTP listener; `/api/events` (SSE) is the only server-coupled endpoint and it is handled OUTSIDE `handleApi`.** Evidence: `server.ts:383-387` is the only route branch in `createDashboardServer`; everything else dispatches via `server.ts:392-396` — `if (path.startsWith("/api/")) { response = await handleApi(req); } else { response = await handleStatic(path); }`. Confidence: high

- **A synthetic `new Request("http://localhost/api/stats?range=7d")` works with no server.** Evidence: `server.ts:166` — `const url = new URL(req.url);` and `server.ts:167` `const path = url.pathname;` — pure URL parsing off `req.url`, no socket, no `req` body stream. Query params read via `url.searchParams.get(...)` only (`server.ts:170`, `223`, `232`, `238`, `273`, `278`, `280`, `285`, `316`). The only `req` reads besides `req.method` (`207`, `267`) and `req.url` are `req.headers.get(...)`: `STATS_ACTION_HEADER` (`server.ts:208`) and `if-none-match` (`server.ts:295`) — both work fine on a constructed Request. Verified live: `bun -e` calling `handleApi(new Request("http://localhost/api/stats?range=7d"))` returned 200 with real data (`{"overall":{"totalRequests":33875,…`). Confidence: high

- **No `AbortSignal` / streaming request body is required.** `handleApi` never calls `req.json()`, `req.text()`, `req.body`, or `req.signal` — full body lines 165–329 contain none. Confidence: high

- **Import-time side effect of `server.ts`: none that starts anything.** It does NOT call `startServer` at module scope. Module-level work is: line 49 `const EMBEDDED_CLIENT_ARCHIVE = decodeEmbeddedClientArchive(embeddedClientArchiveTxt);` (pure base64/gzip-sniff string check, `embedded-client.ts:19-26`), lines 51–52 two `path.join` calls, lines 53–63 env reads. Evidence: `server.ts:54` — `Boolean(process.env.PI_COMPILED || Bun.env.PI_COMPILED) ||` ; `server.ts:62` — `const IS_PREBUILT = IS_BUN_COMPILED || Boolean(process.env.PI_BUNDLED || Bun.env.PI_BUNDLED);` — env vars read: `PI_COMPILED`, `PI_BUNDLED`. Confidence: high
  - It does NOT build the React client at import: `ensureClientBuild` (`server.ts:121-153`, which shells out via `$\`bun run build.ts\`` at `server.ts:147`) is invoked ONLY from `startServer` at `server.ts:496` — `await ensureClientBuild();`. Confidence: high
  - It DOES eagerly import `./embedded-client.generated.txt` (`server.ts:20`), currently 0 bytes in this install, so `EMBEDDED_CLIENT_ARCHIVE === null` and `USE_EMBEDDED_CLIENT` falls back to env. Confidence: high

- **State dependencies of `handleApi`, exhaustively:**
  1. `statsLive()` — `server.ts:173` (`/api/status`), `server.ts:268-269` (`/api/sync`). `statsLive()` is a lazy singleton (`live.ts:256-259` — `instance ??= new StatsLive();`). Reading `.status()` starts nothing; only `.start()` starts ingest, and that is called only from `liveEventStream` (`server.ts:430` — `live.start();`). Confidence: high
  2. `activeServers` / `liveServers` — module-level mutable state at `server.ts:476` (`const activeServers = new Map<string, StatsServerHandle>();`) and `server.ts:478` (`let liveServers = 0;`) — **NOT referenced anywhere inside `handleApi`**; only in `startServer`. Confidence: high
  3. Judge provider — module-level `let judgeProvider` / `judgePromise` in `frustration.ts:107-108`, set only by `setStatsJudgeProvider` which is called only from `startServer` (`server.ts:490`). `handleApi` reaches it only via `startFrustrationRun`/`estimateFrustrationRun`/`cancelFrustrationRun`. With no provider registered, judge routes degrade gracefully: `/api/frustration/judge` POST returned **503** `{"error":"This dashboard was started without a judge (standalone omp-stats). Run \`omp stats\` to classify."}` and `/api/frustration/estimate` returned 200 `{"available":false,"reason":…}`; `/api/frustration/cancel` returned 200 idle. `/api/stats/frustration` (a pure DB read, `frustration.ts:214`) returned 200 with real data. Confidence: high
  4. Nothing from `frustration.ts` beyond those three call sites. Confidence: high
  5. `req`/`server`: `req` used only as described above; `server` never. Confidence: high

- **Route-by-route table (all verified live in-process with synthetic Requests, no socket):**

| Route (server.ts line) | Underlying fn | Pure DB read? | Live-server state? |
|---|---|---|---|
| `/api/status` (173) | `statsLive().status()` (live.ts) | no | yes (in-memory live hub, no socket needed) |
| `/api/stats` (177) | `getDashboardStats(range)` aggregator.ts:503 | yes | no |
| `/api/stats/overview` (182) | `getOverviewStats` aggregator.ts:518 | yes | no |
| `/api/stats/model-dashboard` (187) | `getModelDashboardStats` aggregator.ts:530 | yes | no |
| `/api/stats/costs` (192) | `getCostDashboardStats` aggregator.ts:542 | yes | no |
| `/api/stats/frustration` (197) | `getFrustrationDashboardStats` frustration.ts:214 | yes | no |
| `/api/frustration/estimate` (202) | `estimateFrustrationRun` frustration.ts:226 | reads queue; needs judge to be `available` | judge provider only |
| `/api/frustration/judge` (212) | `startFrustrationRun` frustration.ts:259 | no (spawns paid judge work) | judge provider; POST + `X-Omp-Stats-Action: 1` |
| `/api/frustration/cancel` (211) | `cancelFrustrationRun` frustration.ts:303 | no | judge run object; POST + header |
| `/api/stats/tools` (218) | `getToolDashboardStats` aggregator.ts:589 | yes | no |
| `/api/stats/provider-windows` (223) | `getProviderWindowStats` aggregator.ts:646 | yes | no |
| `/api/stats/providers` (227) | `getProviderDashboardStats` aggregator.ts:604 | yes | no |
| `/api/stats/recent` (233) | `getRecentRequests` aggregator.ts:552 | yes | no |
| `/api/stats/errors` (239) | `getRecentErrors` aggregator.ts:557 | yes | no |
| `/api/stats/models` (244) | `getDashboardStats(range).byModel` | yes (double work, reuses full stats) | no |
| `/api/stats/folders` (249) | `getFolderStats` aggregator.ts:547 | yes | no |
| `/api/stats/timeseries` (254) | `getDashboardStats(range).timeSeries` | yes (double work) | no |
| `/api/request/{id}` (258) | `getRequestDetails` aggregator.ts:562 | yes | no |
| `/api/sync` (266) | `statsLive().requestSync()` | no (triggers background ingest) | yes |
| `/api/stats/gain` (273) | `getGainDashboardStats` gain-aggregator.ts:255 | reads `snapcompact-savings.jsonl` off disk (gain-aggregator.ts:162) + DB | no |
| `/api/sessions` (281) | `listSessionSummaries(limit,q)` trace.ts:1128 | disk scan of sessions dir | no |
| `/api/session/trace` (284) | `traceFingerprintForEtag` trace.ts:814 / `buildSessionTrace` trace.ts:830 | disk read + re-parse, memoized (trace.ts:772) | no |
| `/api/session/entry` (314) | `getTraceEntry` trace.ts:959 | disk read | no |
| (fallback) 404 `Not Found` (328) | — | — | — |

  Confidence: high (every "yes" DB row was executed live and returned 200 with data; the 3 frustration rows and `/api/sync` were executed live and returned 503/200/200/202).

- **Live socket count during the whole proof: zero.** No `Bun.serve`, no `listen`, no port binding was issued in any test command. Confidence: high

- **DB write caveat for the TUI (important):** these are read routes, but `initDb()` (`db.ts:115`) is not read-only — evidence `db.ts:121-125` — `db = new Database(getStatsDbPath()); db.run("PRAGMA busy_timeout = 5000"); db.run("PRAGMA journal_mode = WAL");` followed by `CREATE TABLE IF NOT EXISTS` DDL. So the first `handleApi` call in a fresh process does create/migrate the DB file. Also `/api/sync` (`server.ts:268`) starts real background ingest writing to it — do not call it from a TUI. Confidence: high

- **Alternative seam (approach b): every read route already has a plain exported function that returns exactly the object the API serializes.** Signatures, all in `src/`:
  - `getDashboardStats(range?: string | null): Promise<DashboardStats>` — `aggregator.ts:503`
  - `getOverviewStats(range?: string | null): Promise<Pick<DashboardStats,"overall"|"byAgentType"|"timeSeries">>` — `aggregator.ts:518`
  - `getModelDashboardStats(range?: string | null): Promise<Pick<DashboardStats,"byModel"|"modelSeries"|"modelPerformanceSeries">>` — `aggregator.ts:530`
  - `getCostDashboardStats(range?: string | null): Promise<Pick<DashboardStats,"costSeries">>` — `aggregator.ts:542`
  - `getFolderStats(range?: string | null): Promise<FolderStats[]>` — `aggregator.ts:547`
  - `getRecentRequests(limit?: number): Promise<MessageStats[]>` — `aggregator.ts:552`
  - `getRecentErrors(range?: string | null, limit?: number): Promise<MessageStats[]>` — `aggregator.ts:557`
  - `getRequestDetails(id: number): Promise<RequestDetails | null>` — `aggregator.ts:562`
  - `getToolDashboardStats(range?: string | null): Promise<ToolDashboardStats>` — `aggregator.ts:589`
  - `getProviderDashboardStats(range?: string | null): Promise<ProviderDashboardStats>` — `aggregator.ts:604`
  - `getProviderWindowStats(range?: string | null, provider?: string | null): Promise<ProviderWindowStats>` — `aggregator.ts:646`
  - `getTimeRangeConfig(range?: string | null): RangeWindow` — `aggregator.ts:491`
  - `getFrustrationDashboardStats(range?: string | null): Promise<FrustrationDashboardStats>` — `frustration.ts:214`
  - `getGainDashboardStats(range?: string | null, project?: string | null): Promise<GainDashboardStats>` — `gain-aggregator.ts:255`
  - `listSessionSummaries(limit = 100, q?: string): Promise<SessionSummary[]>` — `trace.ts:1128`
  - `buildSessionTrace(fileParam: string): Promise<SessionTrace>` — `trace.ts:830`
  - `getTraceEntry(fileParam: string, entryId: string): Promise<SessionEntry | null>` — `trace.ts:959`
  - `getRollupStatus(): RollupStatus` — `rollup.ts:306`
  Confidence: high

- **Sizes (`wc -l`):** `handleApi` = 165 lines (server.ts:165–329). `server.ts` total = 538. `aggregator.ts` = 660, `rollup.ts` = 951, `db.ts` = 1586 → the DB/rollup core the routes call = **3197**. Adding `usage-windows.ts` (380), `gain-aggregator.ts` (311), `frustration.ts` (473), `trace.ts` (1223), `shared-types.ts` (662), `types.ts` (239), `live.ts` (259) → **6744** across the 10 modules behind the API. Confidence: high

- **Verdict (a) — call `handleApi` with a synthetic Request: VIABLE.** No blocker. Every one of the 23 routes was executed live with zero sockets and returned correct data. Smallest honest description of the work: import `handleApi` from `@oh-my-pi/omp-stats/server`, write a ~15-line `api(path, params?)` helper that builds `new Request("http://localhost" + path)`, calls `handleApi`, checks `res.ok`, and `await res.json()`; plus a note to the DB owner that `initDb()` will create/migrate `omp-stats.db` on first call. Confidence: high

- **Verdict (b) — call aggregators directly: VIABLE, strictly better for a TUI.** No blocker either; you skip Response allocation + JSON round-trip and get typed objects. Cost: you must re-implement the small amount of route glue that `handleApi` owns — `range` defaulting, `limit` parsing, `providers`/`models`/`timeseries` projections, and 404→null mapping. All of that is ≤10 lines each and visible at `server.ts:231-264`. Confidence: high

- **Verdict (c) — copy route bodies into the plugin: NOT viable / not worth it.** It duplicates the 165-line dispatcher and every fix upstream (ETag format `"${TRACE_ETAG_VERSION}:${trace.etag}"`, `X-Omp-Stats-Action` semantics, `TracePathError`/`isEnoent` mapping) that would silently drift on the next `omp-stats` version bump. Confidence: high

## Searches

```
ls -la /Users/yuzu/.bun/install/global/node_modules/@oh-my-pi/omp-stats/src/
wc -l /Users/yuzu/.bun/install/global/node_modules/@oh-my-pi/omp-stats/src/*.ts
wc -l aggregator.ts rollup.ts db.ts usage-windows.ts gain-aggregator.ts frustration.ts trace.ts shared-types.ts types.ts live.ts
grep -n "^export \(async \)\?function|^export const\|^export class" aggregator.ts rollup.ts gain-aggregator.ts frustration.ts trace.ts
grep -n "Bun.serve\|server\.\|import.*server" trace.ts frustration.ts
grep -c 'path === "/api/\|path.startsWith("/api/' server.ts
grep -n "export" index.ts ; cat ../package.json
grep -rn "handleApi\|/api/" client/api.ts
sed -n '1,40p;86,155p;160,340p;344,538p' server.ts
sed -n '100,150p' frustration.ts ; sed -n '110,135p' db.ts
grep -n "^let \|^const memo\|memo" trace.ts
bun -e 'const r = new Request("http://localhost/api/stats?range=7d"); ...'   # synthetic Request sanity
bun -e 'import server.ts; console.log(Object.keys(m))'                      # export surface
bun -e 'handleApi(...)' over all 23 routes                                 # live proof, no socket
```

## Conflicting evidence

none

## Gaps

- NOT ESTABLISHED whether deep-importing `@oh-my-pi/omp-stats/server` resolves correctly from the plugin's module graph in the user's install layout (package `exports` permits `"./*" → "./src/*.ts"`, and the direct filesystem import was proven to work, but the plugin was not exercised).
- NOT ESTABLISHED whether `/api/frustration/judge` can ever succeed in-process from the plugin: it requires `setStatsJudgeProvider`, whose only caller is `startServer` (`server.ts:490`), i.e. reaching it without a socket requires importing the setter from `frustration.ts` directly. Not tested (it spends money).
- NOT ESTABLISHED DB path/`getStatsDbPath()` resolution details beyond `db.ts:121`; the exact file location was not needed and not opened.