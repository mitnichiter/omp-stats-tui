import { expect, test } from "bun:test";
import { ensureThemeSync, theme } from "@oh-my-pi/pi-tui/theme";
import type { PanelData } from "../src/data/api";
import type { FeatureContext } from "../src/tui/features/types";
import { createSummaryFeature } from "../src/tui/features/core/summary";
import { ListState } from "../src/tui/features/core/shared";
import { stripForTest } from "../src/tui/palette";
import { AGGREGATE, FIXTURE_NOW, liveData, messageRow } from "./fixtures/panel";

ensureThemeSync();

interface Fixture { ctx: FeatureContext; screens: string[]; detailIds: string[]; set(data: PanelData): void; }
function fixture(initial: PanelData): Fixture {
	let data = initial;
	const screens: string[] = [], detailIds: string[] = [];
	return { screens, detailIds, set(next) { data = next; }, ctx: {
		theme, now: () => FIXTURE_NOW, changed() {}, copy: async () => {}, openTrace() {}, openScreen(id) { screens.push(id); },
		reader: { fetch: async () => data, async api<T>(path: string): Promise<T> {
			if (path === "/api/stats/recent") return (data.recent ?? []) as T;
			detailIds.push(path);
			const id = Number(path.split("/").at(-1));
			return { ...messageRow({ id, model: `detail-${id}` }), messages: [], output: { text: `output-${id}` } } as T;
		} },
	} };
}

test("overview selected request survives refresh, details are lazy, and all requests navigation is explicit", async () => {
	const f = fixture(liveData({ recent: [messageRow({ id: 1, timestamp: FIXTURE_NOW - 1000 }), messageRow({ id: 2, timestamp: FIXTURE_NOW - 2000 })] }));
	const feature = createSummaryFeature("overview", f.ctx);
	await feature.load("24h");
	expect(f.detailIds).toEqual([]);
	feature.handleInput("j");
	feature.handleInput("\r");
	await Promise.resolve(); await Promise.resolve();
	expect(f.detailIds).toEqual(["/api/request/2"]);
	expect(stripForTest(feature.render(40, 24).join("\n"))).toContain("detail-2");
	feature.handleInput("b");
	await feature.load("7d");
	feature.handleInput("\r");
	expect(f.detailIds).toEqual(["/api/request/2", "/api/request/2"]);
	feature.handleInput("\x1b");
	feature.handleInput("A");
	expect(f.screens).toEqual(["requests"]);
	expect(feature.handleInput("q")).toBe(false);
	feature.dispose();
});

test("overview tokens mode does not reset hidden request series and search owns mode letters until committed", async () => {
	const f = fixture(liveData());
	const feature = createSummaryFeature("overview", f.ctx);
	await feature.load("24h");
	feature.handleInput("\t");
	feature.handleInput("v");
	feature.handleInput("m");
	expect(stripForTest(feature.render(100, 24).join("\n"))).toContain("Activity · tokens");
	feature.handleInput("m"); feature.handleInput("m");
	expect(stripForTest(feature.render(100, 24).join("\n"))).toContain("off Succeeded");
	feature.handleInput("\t"); feature.handleInput("/"); feature.handleInput("m");
	expect(stripForTest(feature.render(100, 24).join("\n"))).toContain("Search input: m");
	expect(feature.handleInput("\x1b[C")).toBe(false);
	expect(feature.handleInput("]")).toBe(true);
	expect(stripForTest(feature.render(100, 24).join("\n"))).toContain("m]");
	feature.handleInput("\r"); feature.handleInput("\x1b");
	expect(stripForTest(feature.render(100, 24).join("\n"))).toContain("Activity · requests");
	feature.dispose();
});

test("projects temporary exclusion and search do not change unfiltered totals; ranking selection filters and back clears", async () => {
	const folders = [
		{ ...AGGREGATE, folder: "/tmp-benchmark/", totalRequests: 9, totalCost: 100 },
		{ ...AGGREGATE, folder: "/work-alpha/", totalRequests: 3, totalCost: 2 },
		{ ...AGGREGATE, folder: "/work-beta/", totalRequests: 4, totalCost: 1 },
	];
	const f = fixture(liveData({ folders }));
	const feature = createSummaryFeature("projects", f.ctx);
	await feature.load("24h");
	let text = stripForTest(feature.render(100, 28).join("\n"));
	expect(text).toContain("Unfiltered totals: 3 folders (1 temporary) · 16 requests");
	expect(text).not.toContain("/tmp-benchmark/");
	feature.handleInput("\t"); feature.handleInput("\r");
	text = stripForTest(feature.render(100, 28).join("\n"));
	expect(text).toContain("/ search: /work-alpha/");
	expect(text).toContain("Unfiltered totals: 3 folders (1 temporary) · 16 requests");
	feature.handleInput("\x1b"); feature.handleInput("t");
	text = stripForTest(feature.render(100, 28).join("\n"));
	expect(text).toContain("[temp]");
	feature.handleInput("\r");
	text = stripForTest(feature.render(30, 28).join("\n"));
	expect(text).toContain("Project details");
	expect(text).toContain("totalCacheWriteTokens");
	expect(feature.handleInput("q")).toBe(false);
	feature.handleInput("b");
	feature.dispose();
});

test("activity lookback is honest and recorded days outside narrow calendar remain reachable", async () => {
	const f = fixture(liveData({ dailyActivity: Array.from({ length: 120 }, (_, index) => ({ day: new Date(FIXTURE_NOW - index * 86400000).toISOString().slice(0, 10), cost: index, requests: index + 1, totalTokens: index * 10 })) }));
	const feature = createSummaryFeature("activity", f.ctx);
	await feature.load("1h");
	expect(stripForTest(feature.render(35, 20).join("\n")).replace(/\s+/g, " ")).toContain("independently of the stats");
	for (let index = 0; index < 119; index++) feature.handleInput("j");
	feature.handleInput("\r");
	const text = stripForTest(feature.render(35, 20).join("\n"));
	expect(text).toContain("requests: 120");
	expect(text).toContain("totalTokens: 1190");
	feature.handleInput("b");
	await feature.load("all");
	feature.handleInput("\r");
	expect(stripForTest(feature.render(35, 20).join("\n"))).toContain("requests: 120");
	feature.dispose();
});

test("sorting a retained selected row beyond initial reveal still keeps it in local viewport", () => {
	const f = fixture(liveData());
	const rows = Array.from({ length: 180 }, (_, id) => ({ id, value: id }));
	const list = new ListState<{ id: number; value: number }>(row => String(row.id), "value", 10);
	list.selected = "179";
	list.descending = false;
	const sorted = list.rows(rows, { value: row => row.value });
	const text = stripForTest(list.render(sorted, 40, 20, row => `row ${row.id}`, f.ctx).join("\n"));
	expect(text).toContain("> row 179");
	expect(text).toContain("selected 180");
});

test("summary newer range wins and disposed late payload cannot publish", async () => {
	const f = fixture(liveData());
	const pending: Array<(data: PanelData) => void> = [];
	f.ctx.reader.fetch = () => {
		const { promise, resolve } = Promise.withResolvers<PanelData>();
		pending.push(resolve);
		return promise;
	};
	const feature = createSummaryFeature("projects", f.ctx);
	const old = feature.load("24h"), newer = feature.load("7d");
	pending[1](liveData({ folders: [{ ...AGGREGATE, folder: "newer-range" }] }));
	await newer;
	pending[0](liveData({ folders: [{ ...AGGREGATE, folder: "old-range" }] }));
	await old;
	expect(stripForTest(feature.render(100, 24).join("\n"))).toContain("newer-range");
	expect(stripForTest(feature.render(100, 24).join("\n"))).not.toContain("old-range");
	const late = feature.load("30d"); feature.dispose();
	pending[2](liveData({ folders: [{ ...AGGREGATE, folder: "closed-range" }] }));
	await late;
	expect(stripForTest(feature.render(100, 24).join("\n"))).not.toContain("closed-range");
});

test("overview unknown-only cost mode is not zero spend or an empty activity chart", async () => {
	const f = fixture(liveData({ overview: {
		overall: { ...AGGREGATE, totalCost: 0, unpricedRequests: 1, totalRequests: 1 },
		byAgentType: [],
		timeSeries: [{ timestamp: Math.floor(FIXTURE_NOW / 3600000) * 3600000, requests: 1, errors: 0, tokens: 100, cost: 0 }],
	} }));
	const feature = createSummaryFeature("overview", f.ctx);
	await feature.load("24h");
	feature.handleInput("\t"); feature.handleInput("m"); feature.handleInput("m");
	const text = stripForTest(feature.render(100, 24).join("\n"));
	expect(text).toContain("No priced cost / unknown 1");
	expect(text).toContain("Selected point is known-priced cost only");
	expect(text).not.toContain("No activity recorded");
	feature.dispose();
});
