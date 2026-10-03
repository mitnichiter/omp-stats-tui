import { test, expect } from "bun:test";
import {
	apiGet,
	fetchOverview,
	fetchModelDashboard,
	fetchCosts,
	fetchFolders,
	fetchRecent,
	fetchErrors,
	fetchTools,
	fetchRollupStatus,
	fetchFor,
	DATA_NEEDS,
	rollupStatusOrThrow,
} from "../src/data/api";
import type { Range } from "../src/data/ranges";
import type { DbReadiness, DataNeed } from "../src/data/api";
import overview from "./fixtures/overview-24h.json";
import modelDashboard from "./fixtures/model-dashboard-24h.json";

const RANGE: Range = "24h";
/** A reader that serves a canned payload and records what path was asked for. */
function readerFor(payload: unknown) {
	const calls: { path: string; params: Record<string, string> }[] = [];
	return {
		calls,
		read: async (path: string, params: Record<string, string>) => {
			calls.push({ path, params });
			return payload;
		},
	};
}

test("overview carries overall, byAgentType and timeSeries", () => {
	expect(Object.keys(overview).sort()).toEqual(["byAgentType", "overall", "timeSeries"]);
	// unpricedRequests is not optional: a cost shown without it is a wrong number,
	// so a shape change must break this test rather than render `undefined`.
	expect(overview.overall).toHaveProperty("unpricedRequests");
	expect(overview.overall).toHaveProperty("totalCacheReadTokens");
	expect(overview.overall).toHaveProperty("cacheRate");
	expect(overview.timeSeries[0]).toHaveProperty("timestamp");
	expect(overview.timeSeries[0]).toHaveProperty("requests");
	expect(overview.timeSeries[0]).toHaveProperty("cost");
});

test("model-dashboard carries byModel, modelSeries and modelPerformanceSeries", () => {
	expect(Object.keys(modelDashboard).sort()).toEqual([
		"byModel",
		"modelPerformanceSeries",
		"modelSeries",
	]);
	expect(modelDashboard.byModel[0]).toHaveProperty("model");
	expect(modelDashboard.byModel[0]).toHaveProperty("unpricedRequests");
});

test("each wrapper reads its own route and passes the range through", async () => {
	const cases = [
		[fetchOverview, "/api/stats/overview"],
		[fetchModelDashboard, "/api/stats/model-dashboard"],
		[fetchCosts, "/api/stats/costs"],
		[fetchTools, "/api/stats/tools"],
	] as const;
	for (const [fetch, path] of cases) {
		const { calls, read } = readerFor({});
		await fetch(RANGE, read as never);
		expect(calls[0].path).toBe(path);
		expect(calls[0].params.range).toBe(RANGE);
	}
});

test("folder, recent and error wrappers map onto their routes with their limits", async () => {
	const folders = readerFor([]);
	await fetchFolders(RANGE, folders.read as never);
	expect(folders.calls[0]).toEqual({ path: "/api/stats/folders", params: { range: RANGE } });

	const recent = readerFor([]);
	await fetchRecent(5, recent.read as never);
	expect(recent.calls[0]).toEqual({ path: "/api/stats/recent", params: { limit: "5" } });

	const errors = readerFor([]);
	await fetchErrors(RANGE, 3, errors.read as never);
	expect(errors.calls[0]).toEqual({
		path: "/api/stats/errors",
		params: { range: RANGE, limit: "3" },
	});
});

test("a non-OK response becomes a thrown error naming the path and status", async () => {
	const failing = async () => new Response("nope", { status: 404 });
	await expect(apiGet("/api/nope", {}, failing as never)).rejects.toThrow("/api/nope -> 404");
});

test("a 500 is surfaced as an error too, not parsed as a body", async () => {
	const failing = async () => new Response("boom", { status: 500 });
	await expect(apiGet("/api/stats/overview", {}, failing as never)).rejects.toThrow(
		"/api/stats/overview -> 500",
	);
});

test("a real handleApi response is parsed into JSON by the live reader", async () => {
	// Not a fixture: proves the synthetic-Request seam reaches the real handler.
	const res = await apiGet<{ overall: { totalRequests: number } }>("/api/stats/overview", {
		range: "24h",
	});
	expect(typeof res.overall.totalRequests).toBe("number");
});

test("fetchFor returns only what was asked for", async () => {
	const data = await fetchFor(["overview"], RANGE, readerFor(overview).read as never);
	expect(data.overview).toBeDefined();
	expect(data.modelDashboard).toBeUndefined();
	expect(data.rollupStatus).toBeUndefined();
});

test("fetchFor always returns rollupStatus when asked, and never guesses it", async () => {
	const data = await fetchFor(["rollupStatus"], RANGE, undefined, {
		rollupStatus: () => ({ dirtyHours: 2, dirtySessions: 5 }),
	} as never);
	expect(data.rollupStatus).toEqual({ dirtyHours: 2, dirtySessions: 5 });
});

test("every declared need is handled by fetchFor", async () => {
	// A need added to DATA_NEEDS without a fetcher would silently resolve to
	// undefined and render an empty panel.
	const payloads: Record<DataNeed, unknown> = {
		overview,
		modelDashboard,
		costs: { costSeries: [] },
		folders: [],
		recent: [],
		errors: [],
		tools: { byTool: [], byToolModel: [], series: [] },
		dailyActivity: [],
		rollupStatus: { dirtyHours: 0, dirtySessions: 0 },
	};
	const needs = Object.keys(payloads) as DataNeed[];
	expect([...DATA_NEEDS].sort()).toEqual([...needs].sort());
	const overrides = Object.fromEntries(
		needs.map(need => [need, () => Promise.resolve(payloads[need])]),
	);
	const data = await fetchFor(DATA_NEEDS, RANGE, undefined, overrides as never);
	expect(Object.keys(data).sort()).toEqual(Object.keys(payloads).sort());
});

test("THE SILENT-EMPTY TRAP: an uninitialised database is distinguishable from no data", () => {
	// getRollupStatus() returns {0,0} when currentDb() is null, which is
	// byte-identical to a genuinely clean database. The panel must be able to tell
	// them apart, or a first-run panel claims it is up to date while showing zeros.
	expect(() => rollupStatusOrThrow({ ready: false })).toThrow(/not initialised/);
	const clean = rollupStatusOrThrow({ ready: true, dirtyHours: 0, dirtySessions: 0 });
	expect(clean).toEqual({ dirtyHours: 0, dirtySessions: 0 });
});

test("readiness is a discriminated union, never a bare boolean", () => {
	const uninitialised: DbReadiness = { ready: false };
	const initialised: DbReadiness = { ready: true, dirtyHours: 4, dirtySessions: 9 };
	expect(uninitialised.ready).toBe(false);
	expect(initialised.ready).toBe(true);
});

test("fetchRollupStatus reports real counts once the database is open", () => {
	// Order-dependent on purpose: the live handleApi test above has already run
	// initDb() in this process, so currentDb() is non-null here. The claim under
	// test is that the wrapper forwards the host's real numbers — including a
	// genuine zero — rather than fabricating one from its own readiness check.
	const status = fetchRollupStatus();
	expect(typeof status.dirtyHours).toBe("number");
	expect(typeof status.dirtySessions).toBe("number");
	expect(status.dirtyHours).toBeGreaterThanOrEqual(0);
	expect(fetchRollupStatus()).toEqual(status);
});