import { handleApi } from "@oh-my-pi/omp-stats/server";
import { currentDb, getDailyActivity } from "@oh-my-pi/omp-stats/db";
import { getRollupStatus } from "@oh-my-pi/omp-stats/rollup";
import type {
	AggregatedStats,
	DashboardStats,
	DailyActivityPoint,
	FolderStats,
	GainDashboardStats,
	ModelStats,
	ModelTimeSeriesPoint,
	ProviderDashboardStats,
	TimeSeriesPoint,
	ToolDashboardStats,
} from "@oh-my-pi/omp-stats/shared-types";
import type { Range } from "./ranges";
import catalog from "@oh-my-pi/pi-catalog/models.json";
import { rangeMeta } from "@oh-my-pi/omp-stats/client/data/range";

/**
 * THE DATA SEAM.
 *
 * `handleApi` is a plain `async (req: Request) => Promise<Response>` exported
 * from `@oh-my-pi/omp-stats/server`. Its body reads the request only through
 * `new URL(req.url)`, `req.method`, `req.headers.get(...)` and
 * `url.searchParams` — never `req.json()`, `req.body` or `req.signal` — and it
 * contains zero references to the Bun server object. The only `server.*` call in
 * that file lives in `createDashboardServer`'s SSE branch, outside `handleApi`.
 *
 * So `new Request("http://localhost/api/stats/overview")` is a complete input.
 * NO SOCKET IS BOUND AND NO SERVER IS STARTED: the host part of the URL is a
 * formality that makes the string a valid absolute URL, and nothing dials it.
 * Calling it in-process is what lets all the read routes run inside the panel
 * instead of behind a local webserver.
 */

/**
 * The reader is injected in tests to serve fixtures, so it may hand back either
 * an already-parsed body or a real `Response`. Both are accepted: the `Response`
 * branch is where a non-OK status becomes an error, and a fixture reader that
 * skips it would let a 404 parse into a body that renders as zeroes.
 */
export type Reader = (path: string, params: Record<string, string>) => Promise<unknown>;

const liveReader: Reader = async (path, params) => {
	const url = new URL("http://localhost" + path);
	for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
	return handleApi(new Request(url.toString()));
};

export async function apiGet<T>(
	path: string,
	params: Record<string, string> = {},
	read: Reader = liveReader,
): Promise<T> {
	const result = await read(path, params);
	if (result instanceof Response) {
		if (!result.ok) throw new Error(`${path} -> ${result.status}`);
		return (await result.json()) as T;
	}
	return result as T;
}

// --- Payload shapes, all derived from the host's own types ------------------
// Re-declaring these would be a silent-bug generator: a shape change upstream
// would surface as `undefined` painted into a cell rather than as an error.

/** `/api/stats/overview` — the three keys the host actually returns. */
export type OverviewPayload = Pick<DashboardStats, "overall" | "byAgentType" | "timeSeries">;
export type ModelDashboardPayload = Pick<
	DashboardStats,
	"byModel" | "modelSeries" | "modelPerformanceSeries"
>;
export type CostPayload = Pick<DashboardStats, "costSeries">;
export type RecentRequest = DashboardStats["timeSeries"][number] & Record<string, unknown>;

/**
 * Rollup freshness. Above 96 dirty hours the host stops unioning dirty hours
 * with the facts and returns stale rows with holes in them — so the panel must
 * show this count rather than presenting not-yet-built hours as zeroes.
 */
export interface RollupStatus {
	dirtyHours: number;
	dirtySessions: number;
}

/**
 * THE SILENT-EMPTY TRAP, and the reason this type exists.
 *
 * `getRollupStatus()` returns `{dirtyHours: 0, dirtySessions: 0}` when
 * `currentDb()` is null — byte-identical to a genuinely clean database. Every
 * rollup-backed getter likewise degrades to `[]` or a zeroed aggregate before
 * `initDb()` has run, with no error at all. Measured cost of `initDb()` is
 * 866.9 ms, so "query too early" is an ordinary race, not an exotic one.
 *
 * A discriminated union forces the distinction to be represented rather than
 * remembered: the uninitialised case has no counts to report, so it cannot be
 * mistaken for a report of zero.
 */
export type DbReadiness = { ready: false } | ({ ready: true } & RollupStatus);

export function rollupStatusOrThrow(readiness: DbReadiness): RollupStatus {
	if (!readiness.ready) {
		throw new Error(
			"rollup status: database is not initialised — call initDb() before querying",
		);
	}
	return { dirtyHours: readiness.dirtyHours, dirtySessions: readiness.dirtySessions };
}

// ─── WORKAROUND: no-catalog-card reads as unknown spend ──────────────────────
//
// ⚠ THIS BLOCK IS A WORKAROUND FOR AN UPSTREAM BUG AND MUST BE DELETED WHEN IT
// IS FIXED. It is not a policy, and it must not become folklore.
//
// THE BUG. `omp-stats/src/db.ts:49-51` states:
//
//   "Nothing else sets the marker: an explicit recorded zero, a free flat card,
//    and a model with no catalog card at all keep `cost_unpriced = 0` … because
//    their zero is a real price."
//
// The first two clauses are right. THE THIRD IS WRONG. A model with no catalog
// card does not have a price of zero; it has NO PRICE. Its zero is unmeasured,
// which is precisely what CONTEXT.md calls an "Unpriced request" — "a request
// whose recorded cost is zero because the price could not be determined — not
// because nothing was spent".
//
// CONSEQUENCE TODAY (2026-10-03, measured against ~/.omp/stats.db): 4,359
// requests across `gemini-3.7-flash-high` (4,197 requests / 571,773,459 tokens)
// and `agnes-2.5-flash` (162 requests) carry NO price card. The package's
// `unpricedRequests` reports 0 for them, so the panel renders `$0` beside spend
// whose cost is genuinely unknown. That is the one lie this panel is built not
// to tell.
//
// THE EXACT UPSTREAM CHANGE THAT REMOVES THIS BLOCK:
//
//   1. `db.ts` ingest: set `cost_unpriced = 1` when `getCatalogCost()` returns
//      null and the request carries tokens.
//   2. `db.ts:54` `unpricedRequestSql`: add the no-card case to the predicate so
//      rows written before the backfill are counted too.
//   3. A backfill for existing rows, alongside the existing
//      `messages_cost_unpriced_v1` meta key.
//
// When those land, `unpricedRequests` reports 4,359 on its own and this whole
// section goes. Report filed at
// docs/research/omp-stats-tui/UPSTREAM-ISSUE-no-catalog-card-reads-as-zero.md.
//
// WHY IT LIVES HERE AND NOT IN A SCREEN: this is a statement about what the
// DATA means, and CONTEXT.md's "unpriced request" is a data-layer distinction.
// A screen that second-guessed the payload's unpriced count would have to know
// about price cards, and every screen would have to know about price cards.
// `getCatalogCost` is not exported by the package, which is why this reads
// `@oh-my-pi/pi-catalog` directly — a second reason to fix it upstream instead.

/**
 * Does the price catalog carry a card for this model — ANY card, including one
 * whose rates are all zero?
 *
 * The distinction is the whole point. `space-bunny-free` has a card reading
 * `{input: 0, output: 0, cacheRead: 0, cacheWrite: 0}`: the price was determined
 * and it is zero, so its `$0` is a real price and must stay `$0`.
 * `gemini-3.7-flash-high` has no card at all, so there is no price to determine
 * and its zero is unknown. Both render as `$0` and mean opposite things.
 */
const PRICED = (() => {
	const priced = new Set<string>();
	for (const group of Object.values(catalog as Record<string, Record<string, { cost?: unknown }>>)) {
		for (const [id, model] of Object.entries(group)) {
			// A card exists iff it carries a `cost` key. Rates are NOT inspected:
			// an all-zero card is still a real price.
			if (model && typeof model === "object" && model.cost !== undefined) priced.add(id);
		}
	}
	return priced;
})();

/** True when the catalog can price this model at all. */
export function catalogPriceCard(model: string): boolean {
	return PRICED.has(model);
}

/** One row per model: zero-cost requests that carried tokens. */
export interface ZeroCostModelRow {
	model: string;
	requests: number;
}

/**
 * Keep only the rows whose model has NO price card.
 *
 * Takes rows already narrowed to `cost_total = 0 AND total_tokens > 0` so this
 * function is pure filtering and is testable without a database. Models that DO
 * have a card are dropped: their zero was a real price.
 */
export function noCatalogCardCounts(rows: readonly ZeroCostModelRow[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const row of rows) {
		if (catalogPriceCard(row.model)) continue;
		counts.set(row.model, (counts.get(row.model) ?? 0) + row.requests);
	}
	return counts;
}

/**
 * Read the no-card unpriced counts for a range, or an empty map when the
 * database is not initialised.
 *
 * Reads the FACTS table rather than the rollup on purpose: the rollup's
 * `unpriced` column carries the same defect as the payload, so asking it would
 * return the number we are correcting. Excludes rows the package already counts
 * (`cost_unpriced = 1` or `xai-oauth`) so the two populations do not double up.
 */
function readNoCardUnpriced(range: Range): Map<string, number> {
	const db = currentDb();
	if (!db) return new Map();
	const { spanMs } = rangeMeta(range);
	const since = spanMs === null ? 0 : Date.now() - spanMs;
	const rows = db
		.query<ZeroCostModelRow, [number]>(
			`SELECT model, COUNT(*) AS requests FROM messages
			 WHERE total_tokens > 0 AND cost_total = 0 AND timestamp >= ?
			   AND cost_unpriced = 0 AND provider != 'xai-oauth'
			 GROUP BY model`,
		)
		.all(since);
	return noCatalogCardCounts(rows);
}

/**
 * Add the no-card counts to a payload's `unpricedRequests`, overall and per
 * model. The package's own count is ADDED TO, never replaced, so its
 * xai-oauth and `cost_unpriced` populations survive. Pure: returns a new object.
 */
export function withHonestUnpriced<T extends object>(payload: T, counts: ReadonlyMap<string, number>): T {
	if (counts.size === 0) return payload;
	const patched = { ...payload } as Record<string, unknown>;

	// The map is already scoped to the range by `readNoCardUnpriced`, and
	// `overall` is the range TOTAL, so its delta is the sum of the whole map — not
	// a re-derivation from `byModel`, which may be absent or hold a subset.
	let total = 0;
	for (const n of counts.values()) total += n;
	const overall = patched.overall;
	if (total > 0 && overall && typeof overall === "object") {
		patched.overall = {
			...(overall as Record<string, unknown>),
			unpricedRequests: ((overall as { unpricedRequests?: number }).unpricedRequests ?? 0) + total,
		};
	}

	if (Array.isArray(patched.byModel)) {
		patched.byModel = patched.byModel.map(row => {
			if (!row || typeof row !== "object") return row;
			const named = counts.get((row as { model?: unknown }).model as string);
			if (!named) return row;
			return {
				...(row as Record<string, unknown>),
				unpricedRequests: ((row as { unpricedRequests?: number }).unpricedRequests ?? 0) + named,
			};
		});
	}
	// `costSeries` rows are per (day, model, provider) while the counts map is
	// per model, so each model's total lands on its FIRST row and the payload's
	// sum stays exact. The daily/provider split is approximate until the upstream
	// fix prices these rows for real; the range totals are not. Never invent a
	// row for a model with no series row: a new timestamp would corrupt the
	// active-day denominator behind `avgDailyCost`.
	const series = patched.costSeries;
	if (Array.isArray(series)) {
		const claimed = new Set<string>();
		patched.costSeries = series.map(row => {
			if (!row || typeof row !== "object") return row;
			if (!("model" in row)) return row;
			const model = row.model;
			if (typeof model !== "string") return row;
			if (claimed.has(model)) return row;
			const delta = counts.get(model);
			if (!delta) return row;
			claimed.add(model);
			if (!("unpricedRequests" in row)) return { ...row, unpricedRequests: delta };
			const current = row.unpricedRequests;
			const base = typeof current === "number" ? current : 0;
			return { ...row, unpricedRequests: base + delta };
		});
	}

	return patched as T;
}

// `withHonestUnpriced` is applied here, not in a screen — see the WORKAROUND
// block above for why this belongs at the data seam.
export async function fetchOverview(
	range: Range,
	read: Reader = liveReader,
): Promise<OverviewPayload> {
	const payload = await apiGet<OverviewPayload>("/api/stats/overview", { range }, read);
	return withHonestUnpriced(payload, readNoCardUnpriced(range));
}

export async function fetchModelDashboard(
	range: Range,
	read: Reader = liveReader,
): Promise<ModelDashboardPayload> {
	const payload = await apiGet<ModelDashboardPayload>("/api/stats/model-dashboard", { range }, read);
	return withHonestUnpriced(payload, readNoCardUnpriced(range));
}
export async function fetchCosts(
	range: Range,
	read: Reader = liveReader,
): Promise<CostPayload> {
	const payload = await apiGet<CostPayload>("/api/stats/costs", { range }, read);
	return withHonestUnpriced(payload, readNoCardUnpriced(range));
}

export function fetchFolders(range: Range, read: Reader = liveReader): Promise<FolderStats[]> {
	return apiGet<FolderStats[]>("/api/stats/folders", { range }, read);
}

export function fetchRecent(limit: number, read: Reader = liveReader): Promise<RecentRequest[]> {
	return apiGet<RecentRequest[]>("/api/stats/recent", { limit: String(limit) }, read);
}

export function fetchErrors(
	range: Range,
	limit: number,
	read: Reader = liveReader,
): Promise<RecentRequest[]> {
	return apiGet<RecentRequest[]>("/api/stats/errors", { range, limit: String(limit) }, read);
}

export function fetchTools(range: Range, read: Reader = liveReader): Promise<ToolDashboardStats> {
	return apiGet<ToolDashboardStats>("/api/stats/tools", { range }, read);
}

/**
 * DB-backed provider aggregates: per-provider totals, the hourly burn
 * histogram, and the per-provider time series. This is the ONLY provider
 * payload the panel reads — `/api/stats/provider-windows` does broker
 * network I/O per load (see `getProviderWindowStats`), so it stays out of
 * the load path and the windows sections stay deferred.
 */
export function fetchProviders(range: Range, read: Reader = liveReader): Promise<ProviderDashboardStats> {
	return apiGet<ProviderDashboardStats>("/api/stats/providers", { range }, read);
}

/**
 * Token savings from the snapcompact jsonl beside the database. Missing files
 * read as zero records, never an error — so an empty gain payload is a real
 * answer, and the screen's empty state names the range rather than a failure.
 */
export function fetchGain(
	range: Range,
	read: Reader = liveReader,
	project: string | null = null,
): Promise<GainDashboardStats> {
	return apiGet<GainDashboardStats>(
		"/api/stats/gain",
		project === null ? { range } : { range, project },
		read,
	);
}

/**
 * No route exposes daily activity, so this reads the package directly. Static
 * import only: dynamic `import()` of any `@oh-my-pi/*` fails inside the
 * extension loader, which rewrites specifiers for static imports alone.
 *
 * Measured 195.6 ms — the query that forced `/usage` into a subprocess. A
 * rollup-backed panel does not call it on the hot path; see the calendar
 * screen's note before wiring it into a first paint.
 */
export function fetchDailyActivity(days = 371): Promise<DailyActivityPoint[]> {
	return getDailyActivity(days);
}

/**
 * Dirty-hour counts for the freshness line. Reads `currentDb()` rather than
 * calling `getRollupStatus()` blindly, so an uninitialised database raises
 * instead of reporting a fabricated zero.
 */
export function fetchRollupStatus(): RollupStatus {
	return rollupStatusOrThrow(currentDb() ? { ready: true, ...getRollupStatus() } : { ready: false });
}

// --- Screen contract ---------------------------------------------------------

/** What a screen declares it needs. A scaffolded screen declares none. */
export const DATA_NEEDS = [
	"overview",
	"modelDashboard",
	"costs",
	"folders",
	"recent",
	"errors",
	"tools",
	"providers",
	"gain",
	"dailyActivity",
	"rollupStatus",
] as const;

export type DataNeed = (typeof DATA_NEEDS)[number];

export interface PanelData {
	overview?: OverviewPayload;
	modelDashboard?: ModelDashboardPayload;
	costs?: CostPayload;
	folders?: FolderStats[];
	recent?: RecentRequest[];
	errors?: RecentRequest[];
	tools?: ToolDashboardStats;
	providers?: ProviderDashboardStats;
	gain?: GainDashboardStats;
	dailyActivity?: DailyActivityPoint[];
	rollupStatus?: RollupStatus;
}

/**
 * `rollupStatus` and `dailyActivity` are not route-backed, so they are resolved
 * directly rather than through the reader; the override parameter exists so a
 * test can exercise the mapping without a 321 MB database. Production passes
 * nothing and gets the real fetcher.
 */
type Fetcher = (range: Range) => Promise<unknown>;

const ROUTE_FETCHERS: Record<DataNeed, Fetcher> = {
	overview: range => fetchOverview(range),
	modelDashboard: range => fetchModelDashboard(range),
	costs: range => fetchCosts(range),
	folders: range => fetchFolders(range),
	// The recent/errors routes take a limit rather than a range; 50 is the
	// host's own default window for a "latest records" list.
	recent: () => fetchRecent(50),
	errors: range => fetchErrors(range, 50),
	tools: range => fetchTools(range),
	providers: range => fetchProviders(range),
	gain: range => fetchGain(range),
	dailyActivity: () => fetchDailyActivity(),
	rollupStatus: async () => fetchRollupStatus(),
};

/**
 * Fetch exactly what a screen declared. Every need goes out concurrently, so a
 * first paint is one wall-clock round of rollup-backed queries rather than a
 * sequence — the reads are cheap (measured under 20 ms warm) and the panel is
 * bound by paint, not by query count.
 *
 * A scaffolded screen declares no needs and this returns `{}` without issuing a
 * single query: a fetch whose result the user cannot see reads as a hang.
 */
export async function fetchFor(
	needs: readonly DataNeed[],
	range: Range,
	read: Reader = liveReader,
	overrides: Partial<Record<DataNeed, Fetcher>> = {},
): Promise<PanelData> {
	const routes = { ...ROUTE_FETCHERS };
	for (const [need, fetcher] of Object.entries(overrides) as [DataNeed, Fetcher][]) {
		routes[need] = fetcher;
	}
	// A reader only redirects the route-backed reads; the two direct calls have
	// no HTTP shape to redirect.
	if (read !== liveReader) {
		routes.overview = r => fetchOverview(r, read);
		routes.modelDashboard = r => fetchModelDashboard(r, read);
		routes.costs = r => fetchCosts(r, read);
		routes.folders = r => fetchFolders(r, read);
		routes.recent = () => fetchRecent(50, read);
		routes.errors = r => fetchErrors(r, 50, read);
		routes.tools = r => fetchTools(r, read);
		routes.providers = r => fetchProviders(r, read);
		routes.gain = r => fetchGain(r, read);
	}

	const entries = await Promise.all(
		needs.map(async need => [need, await routes[need](range)] as const),
	);
	return Object.fromEntries(entries) as PanelData;
}

// Deliberately absent, and each absence is load-bearing:
//   /api/stats/provider-windows — getProviderWindowStats does network I/O.
//   /api/sync                   — starts real background ingest; 7141 ms of
//                                  synchronous SQLite that must never run on
//                                  the TUI thread. Task 12 owns it, in a child.
//   /api/request/{id}           — getRequestDetails parses session transcripts
//                                  off disk; it is not a load-path read.
// If a screen ever needs one of these, it needs the sync worker, not a wrapper
// here. Types re-exported for consumers: AggregatedStats, ModelStats,
// TimeSeriesPoint, ModelTimeSeriesPoint.
export type { AggregatedStats, ModelStats, TimeSeriesPoint, ModelTimeSeriesPoint };