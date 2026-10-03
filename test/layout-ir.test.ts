/**
 * The layout IR contract.
 *
 * The IR is only worth having if it can be WRONG in the ways a hand-written
 * screen gets wrong: a band that reads a field the payload does not have, a
 * band that reads data the screen never fetched, and an IR that quietly grows
 * a glyph, a colour or a preset. Each of those is a test below, not a review
 * note, because a review note is not what stops the fifth screen from
 * reinventing the visual grammar.
 */

import { test, expect } from "bun:test";
import {
	SCREEN_SPECS,
	NEED_BY_SOURCE,
	ALL_METRIC_REFS,
	metricRefsOf,
	type Band,
	type Column,
	type MetricRef,
	type MetricSource,
	type RowSource,
	type ScreenSpec,
} from "../src/layout/spec";
import { DATA_NEEDS, type DataNeed } from "../src/data/api";
import { SCREENS } from "../src/tui/screens/types";

// ─── fixtures: one realistic payload per source, shaped like the real route ───

const day = 86_400_000;
const now = 1_800_000_000_000;

const AGGREGATE = {
	totalRequests: 65_460,
	successfulRequests: 64_145,
	failedRequests: 1_315,
	errorRate: 0.0201,
	totalInputTokens: 47_100_000,
	totalOutputTokens: 9_400_000,
	totalCacheReadTokens: 1_204_000_000,
	totalCacheWriteTokens: 12_800_000,
	cacheRate: 0.9624,
	cacheSavings: 0.8142,
	totalCost: 112.36,
	unpricedRequests: 0,
	totalPremiumRequests: 1.5,
	avgDuration: 12_300,
	avgTtft: 430,
	avgTokensPerSecond: 61.2,
	firstTimestamp: now - 30 * day,
	lastTimestamp: now,
};

const MODEL = {
	...AGGREGATE,
	model: "gemini-3.8-flash",
	provider: "google-antigravity",
};

/** Every source the IR may name, with a value that has the shape the IR assumes. */
const FIXTURES: Record<string, unknown> = {
	overall: AGGREGATE,
	byAgentType: [
		{ agentType: "main", totalRequests: 60_000, totalInputTokens: 40e6, totalOutputTokens: 8e6, totalCacheReadTokens: 1.1e9, totalCacheWriteTokens: 12e6, totalCost: 100 },
		{ agentType: "subagent", totalRequests: 5_000, totalInputTokens: 7e6, totalOutputTokens: 1.4e6, totalCacheReadTokens: 100e6, totalCacheWriteTokens: 0.8e6, totalCost: 12 },
	],
	timeSeries: [{ timestamp: now - day, requests: 120, errors: 3, tokens: 90_000, cost: 4.2 }],
	byModel: [MODEL],
	modelSeries: [{ timestamp: now - day, model: "gemini-3.8-flash", provider: "google-antigravity", requests: 120 }],
	modelPerformanceSeries: [{ timestamp: now - day, model: "gemini-3.8-flash", provider: "google-antigravity", requests: 120, avgTtft: 430, avgTokensPerSecond: 61.2 }],
	costSeries: [{ timestamp: now - day, model: "gemini-3.8-flash", provider: "google-antigravity", cost: 4.2, unpricedRequests: 0, costInput: 1, costOutput: 2, costCacheRead: 1, costCacheWrite: 0, requests: 120 }],
	folders: [{ ...MODEL, folder: "~/code/omp" }],
	recentMessages: [
		{
			id: 1, sessionFile: "~/code/omp/a.jsonl", entryId: "e1", folder: "~/code/omp",
			model: "gemini-3.8-flash", provider: "google-antigravity", api: "anthropic",
			timestamp: now, duration: 4300, ttft: 380, stopReason: "stop", errorMessage: null,
			agentType: "main", costUnpriced: false,
			usage: {
				input: 1_200, output: 900, cacheRead: 40_000, cacheWrite: 0, totalTokens: 42_100,
				cost: { input: 0.001, output: 0.004, cacheRead: 0.004, cacheWrite: 0, total: 0.009 },
			},
		},
	],
	errorMessages: [
		{
			id: 2, sessionFile: "~/code/omp/b.jsonl", entryId: "e2", folder: "~/code/omp",
			model: "gemini-3.8-flash", provider: "google-antigravity", api: "anthropic",
			timestamp: now - 3600_000, duration: null, ttft: null, stopReason: "error",
			errorMessage: "429 rate limited", agentType: "main", costUnpriced: true,
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { total: 0 } },
		},
	],
	toolsByTool: [{ tool: "read", calls: 900, errors: 4, argsChars: 120_000, resultChars: 4_040_000, totalTokensShare: 1_200_000, outputTokensShare: 90_000, costShare: 1.2, unpricedRequestsShare: 0, lastUsed: now }],
	toolsByToolModel: [{ tool: "read", model: "gemini-3.8-flash", provider: "google-antigravity", calls: 900, errors: 4, argsChars: 120_000, resultChars: 4_040_000, totalTokensShare: 1_200_000, outputTokensShare: 90_000, costShare: 1.2, unpricedRequestsShare: 0, lastUsed: now }],
	toolsSeries: [{ timestamp: now - day, tool: "read", calls: 900, errors: 4 }],
	dailyActivity: [{ day: "2026-09-28", cost: 4.2, requests: 120, totalTokens: 90_000 }],
	rollupStatus: { dirtyHours: 0, staleRows: 0 },
	// The DB-backed aggregates. The NETWORK windows payload has no source:
	// the panel never fetches it, so the IR cannot name it either.
	providerStats: [{ provider: "openrouter", totalRequests: 1_280, failedRequests: 4, models: 1, totalInputTokens: 2_100_000, totalOutputTokens: 400_000, totalCacheReadTokens: 51_000_000, totalCacheWriteTokens: 500_000, totalTokens: 54_000_000, totalCost: 935.72, unpricedRequests: 0, totalPremiumRequests: 0, avgTokensPerSecond: 61.2 }],
};

function readPath(source: string, path: string): unknown {
	let node: unknown = FIXTURES[source];
	// An array source is indexed through its first element, which is what every
	// series/aggregate source in this IR means by naming it.
	if (Array.isArray(node)) node = node[0];
	if (node === undefined) return undefined;
	for (const key of path.split(".")) {
		if (node === null || typeof node !== "object") return undefined;
		node = (node as Record<string, unknown>)[key];
	}
	return node;
}

/** Every source a metric reads, following `derived` down to its base. */
function sourceOf(ref: MetricRef): MetricSource {
	return ref.kind === "derived" ? sourceOf(ref.of) : ref.source;
}

/**
 * The concrete field a reference bottoms out in. `derived` nests — "avg result
 * per call" is a share of a sum of a field — so walking to the innermost
 * aggregate/series/label is what makes the resolution test mean anything.
 */
function baseOf(
	ref: MetricRef,
): Extract<MetricRef, { kind: "aggregate" | "series" | "label" }> {
	return ref.kind === "derived" ? baseOf(ref.of) : ref;
}

/** Every metric reachable from a band: tiles, chart series, legend, columns. */
function refsInBand(band: Band): readonly MetricRef[] {
	switch (band.kind) {
		case "statRow":
			return band.stats.flatMap(t => metricRefsOf(t.metric));
		case "chart":
			return band.chart.series.flatMap(s => metricRefsOf(s.metric));
		case "legend":
			return band.items.flatMap(i => metricRefsOf(i.metric));
		case "table":
			return band.columns.flatMap((c: Column) => metricRefsOf(c.source));
		case "note":
		case "custom":
			return [];
	}
}

function refsInSpec(spec: ScreenSpec): readonly MetricRef[] {
	return spec.bands.flatMap(refsInBand);
}

// ─── identity ────────────────────────────────────────────────────────────────

test("every screen id is unique", () => {
	const ids = SCREEN_SPECS.map(s => s.id);
	expect(new Set(ids).size).toBe(ids.length);
});

test("every IR screen corresponds to a screen the registry already knows", () => {
	const registered = new Set(SCREENS.map(s => s.id));
	for (const spec of SCREEN_SPECS) {
		expect(registered.has(spec.id as never), spec.id).toBe(true);
	}
});

test("every IR screen carries a source citation naming a real route file", () => {
	for (const spec of SCREEN_SPECS) {
		expect(spec.source.file, spec.id).toMatch(/^@oh-my-pi\/.+\.tsx?$/);
		expect(spec.source.lines, spec.id).toMatch(/^\d/);
	}
});

// ─── the valuable test: a band that reads something the screen never fetched ─

test("every band references a metric its screen's needs actually fetch", () => {
	for (const spec of SCREEN_SPECS) {
		// A deferred screen is allowed to name a source nothing fetches — that is
		// precisely what deferred means, and the separate resolution test below
		// is where it has to be declared.
		if (spec.deferred) continue;
		for (const ref of refsInSpec(spec)) {
			const need = NEED_BY_SOURCE[sourceOf(ref)];
			// Asserting this BEFORE the `toContain` is the point: a null need is a
			// screen band that can never be filled, and the test must say which.
			expect(need, `${spec.id}: source "${sourceOf(ref)}" has no declared need`).toBeTruthy();
			if (need === null) continue;
			expect([...spec.needs], `${spec.id} reads ${sourceOf(ref)} but fetches only ${spec.needs.join(",")}`).toContain(need);
		}
	}
});

test("every fetchable source maps to a real DataNeed", () => {
	for (const [source, need] of Object.entries(NEED_BY_SOURCE)) {
		// Every source the IR names is fetchable: `providerStats` reads the
		// DB-backed `/api/stats/providers` aggregates, and the network-only
		// windows payload has no source because the panel never fetches it.
		expect(need, `${source} has no declared need`).toBeTruthy();
		if (need === null) continue;
		expect(DATA_NEEDS as readonly string[], `${source} -> ${need}`).toContain(need);
	}
});

test("a deferred screen says why it cannot be filled yet", () => {
	for (const spec of SCREEN_SPECS) {
		if (!spec.deferred) continue;
		expect(spec.deferredReason, spec.id).toBeTruthy();
		expect(spec.deferredReason!.length, spec.id).toBeGreaterThan(20);
	}
});

// ─── the other valuable test: a metric naming a field that does not exist ───

test("every MetricRef resolves to a real field on a real payload", () => {
	// Computed pseudo-fields never appear on the payload: the resolver derives
	// them from sibling fields (OverviewRoute.tsx:77 — Succeeded is
	// requests-minus-errors per bucket). They resolve through dedicated
	// branches, not through the field path, so the fixture cannot carry them.
	const COMPUTED = new Set(["timeSeries.succeededRequests"]);
	for (const spec of SCREEN_SPECS) {
		for (const ref of refsInSpec(spec)) {
			const source = sourceOf(ref);
			if (FIXTURES[source] === undefined) {
				expect(spec.deferred, `${spec.id} reads unfetchable "${source}" but is not deferred`).toBe(true);
				continue;
			}
			if (COMPUTED.has(`${source}.${baseOf(ref).field}`)) continue;
			expect(readPath(sourceOf(ref), baseOf(ref).field), `${spec.id}: ${source}.${baseOf(ref).field} does not exist`).toBeDefined();
			if (ref.kind === "derived") {
				// A derivation is a NAMED computation, so it must carry a name
				// and an operation; `share` is meaningless without what it is a
				// share of, and that is exactly the kind of gap the IR exists to
				// make impossible to hide.
				expect(ref.name.length, `${spec.id}: unnamed derivation`).toBeGreaterThan(0);
				expect(["sum", "share", "count", "max"], `${spec.id}/${ref.name}`).toContain(ref.op);
				if (ref.op === "share") expect(ref.against, `${spec.id}/${ref.name} is a share of nothing`).toBeTruthy();
			}
		}
	}
});

test("every source the IR names is one NEED_BY_SOURCE knows", () => {
	for (const ref of ALL_METRIC_REFS) {
		expect(Object.keys(NEED_BY_SOURCE), `unknown source "${sourceOf(ref)}"`).toContain(sourceOf(ref));
	}
	expect(ALL_METRIC_REFS.length).toBeGreaterThan(50);
});

// ─── structural soundness ────────────────────────────────────────────────────

test("every screen has at least one band and at least one stat tile", () => {
	for (const spec of SCREEN_SPECS) {
		expect(spec.bands.length, spec.id).toBeGreaterThan(0);
		expect(
			spec.bands.filter(b => b.kind === "statRow").flatMap(b => b.stats).length,
			spec.id,
		).toBeGreaterThan(0);
	}
});

test("stat tile labels are unique within a screen", () => {
	for (const spec of SCREEN_SPECS) {
		for (const band of spec.bands) {
			if (band.kind !== "statRow") continue;
			const labels = band.stats.map(t => t.label);
			expect(new Set(labels).size, `${spec.id}: ${labels.join(", ")}`).toBe(labels.length);
		}
	}
});

test("every table row source resolves to a real source", () => {
	for (const spec of SCREEN_SPECS) {
		for (const band of spec.bands) {
			if (band.kind !== "table") continue;
			const rows: RowSource = band.rows;
			expect(Object.keys(NEED_BY_SOURCE), `${spec.id}/${band.title}: ${rows.source}`).toContain(rows.source);
		}
	}
});

test("every table column has a header, an alignment and a source", () => {
	for (const spec of SCREEN_SPECS) {
		for (const band of spec.bands) {
			if (band.kind !== "table") continue;
			expect(band.columns.length, `${spec.id}/${band.title}`).toBeGreaterThan(0);
			for (const col of band.columns) {
				expect(col.header.length, `${spec.id}/${band.title}`).toBeGreaterThan(0);
				expect(["left", "right"], `${spec.id}/${band.title}/${col.header}`).toContain(col.align);
				expect(col.source, `${spec.id}/${band.title}/${col.header}`).toBeTruthy();
			}
		}
	}
});

test("every chart names a metric and a type, and never both a metric and nothing else", () => {
	for (const spec of SCREEN_SPECS) {
		for (const band of spec.bands) {
			if (band.kind !== "chart") continue;
			expect(["bars", "sparkline", "heatmap", "rankedBars", "shareBar"], `${spec.id}/${band.title}`).toContain(band.chart.type);
			expect(band.chart.series.length, `${spec.id}/${band.title}`).toBeGreaterThan(0);
		}
	}
});

test("the IR is data, not branches: no screen id is branched on anywhere", async () => {
	const src = await Bun.file(new URL("../src/layout/spec.ts", import.meta.url)).text();
	// A switch over screen ids would reintroduce exactly the problem the IR
	// exists to remove: a second place that has to learn about a new screen.
	expect(src).not.toMatch(/\bswitch\s*\(\s*(spec|screen|id)\b/);
	expect(src).not.toMatch(/if\s*\(\s*(spec|screen)\.id\b/);
});

// ─── the architectural test: the IR stays free of presentation ───────────────

test("the IR carries no glyphs, colours, widths or presets in its DATA", () => {
	const data = JSON.stringify(SCREEN_SPECS);
	// Block/shade/box glyphs.
	expect(data).not.toMatch(/[▀-▟░-▓]/);
	// CSS custom properties and hex colours.
	expect(data).not.toMatch(/var\(--|#[0-9a-f]{3,8}\b/i);
	// Preset names.
	expect(data).not.toMatch(/"(unicode|nerd|ascii)"/);
	// Layout primitives the renderer owns.
	expect(data).not.toMatch(/"(width|height|color|colour|glyph|padding|indent|preset|maxWidth|minWidth)":/);
});

test("the IR imports nothing that knows how to draw", async () => {
	const src = await Bun.file(new URL("../src/layout/spec.ts", import.meta.url)).text();
	// Only the IMPORT STATEMENTS matter: the source citations legitimately name
	// `@oh-my-pi/pi-tui/...`, because the usage dashboard we ported the calendar
	// from lives there.
	const imports = [...src.matchAll(/^import[\s\S]*?from\s+"[^"]+";$/gm)].map(m => m[0]);
	expect(imports.length).toBeGreaterThan(0);
	for (const statement of imports) {
		for (const forbidden of ["@oh-my-pi/pi-tui", "../tui/", "glyphs", "icons", "format", "charts"]) {
			expect(statement, `spec.ts must not import ${forbidden}`).not.toContain(forbidden);
		}
		// Every import must be `import type` — this module has no runtime surface
		// beyond its own data, so it cannot acquire behaviour by accident.
		expect(statement, `not a type-only import: ${statement}`).toMatch(/^import type\b/);
	}
});

// ─── the port, not a redesign ────────────────────────────────────────────────

test("the ported screens mirror the route's band order", () => {
	const overview = SCREEN_SPECS.find(s => s.id === "overview")!;
	// OverviewRoute.tsx renders: PageHeader, StatGrid (big), StatGrid (small),
	// then a grid of [Activity chart, Token mix], then Latest requests.
	expect(overview.bands.map(b => b.kind)).toEqual([
		"statRow",
		"statRow",
		"chart",
		"chart",
		"legend",
		"table",
		"note",
	]);

	const models = SCREEN_SPECS.find(s => s.id === "models")!;
	// ModelsRoute.tsx renders: StatGrid, "Request share" Card, "All models"
	// Table. The card's per-series Legend is togglable UI chrome the terminal
	// cannot host (no pointer, no per-row toggle); the shares live on the
	// chart readouts instead, so the IR carries no legend band here.
	expect(models.bands.map(b => b.kind)).toEqual(["statRow", "chart", "table", "note"]);
});

test("the activity screen derives from the usage dashboard, not a route", () => {
	const activity = SCREEN_SPECS.find(s => s.id === "activity")!;
	// The web dashboard has no activity route; the calendar lives in omp's own
	// /usage overlay. The citation must say so, or the port is unauditable.
	expect(activity.source.file).toContain("usage-dashboard");
	expect(activity.source.note).toMatch(/no activity route|usage/i);
	expect(activity.bands.some(b => b.kind === "chart" && b.chart.type === "heatmap")).toBe(true);
});

test("every screen that fetches nothing is deferred, and vice versa", () => {
	for (const spec of SCREEN_SPECS) {
		if (spec.needs.length === 0) expect(spec.deferred, spec.id).toBe(true);
		if (spec.deferred) expect(spec.needs.length, spec.id).toBe(0);
	}
});

test("providers is fillable from the local aggregates; only the windows sections stay out", () => {
	// `/api/stats/providers` is DB-backed rollup; `/api/stats/provider-windows`
	// does broker network I/O per load and the panel never calls it. So the
	// spec carries needs and the windows boundary lives in a note band, not a
	// deferred flag.
	const providers = SCREEN_SPECS.find(s => s.id === "providers")!;
	expect(providers.deferred).toBeUndefined();
	expect([...providers.needs]).toEqual(["providers", "rollupStatus"]);
	const kinds = providers.bands.map(b => b.kind);
	expect(kinds).toContain("note");
	expect(providers.bands.some(b => b.kind === "custom")).toBe(false);
});

test("every screen declares its needs as real DataNeeds", () => {
	for (const spec of SCREEN_SPECS) {
		for (const need of spec.needs as readonly DataNeed[]) {
			expect(DATA_NEEDS as readonly string[], `${spec.id}/${need}`).toContain(need);
		}
	}
});
