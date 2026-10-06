import { expect, test } from "bun:test";
import { stripTerminalSequences, visibleWidth } from "@oh-my-pi/pi-tui";
import { ensureThemeSync, theme } from "@oh-my-pi/pi-tui/theme";
import type { SessionTrace, TraceSpan, TraceTrack } from "@oh-my-pi/omp-stats/shared-types";
import { createTracesFeature } from "../src/tui/features/traces";
import type { FeatureContext } from "../src/tui/features/types";
import { ancestors, buildLanes, buildScale, fit, remapViewport, rowForEntry, spanCells, transcriptRows, visibleTracks, zoomViewport } from "../src/tui/features/traces/model";

ensureThemeSync();
const START = 1_700_000_000_000;
const ROOT = "/isolated/sessions/root.jsonl", CHILD = "/isolated/sessions/alpha.jsonl", GRANDCHILD = "/isolated/sessions/nested.jsonl";
function span(id: string, kind: TraceSpan["kind"], start: number, end: number, label: string, extra: Partial<TraceSpan> = {}): TraceSpan {
	return { id, kind, start: START + start, end: START + end, label, ...extra };
}
function track(id: string, parentId: string | null, file: string, spans: TraceSpan[]): TraceTrack {
	return { id, parentId, label: id, agent: parentId ? "worker" : null, model: "recorded-model", file, spans, markers: [] };
}
function nestedTrace(): SessionTrace {
	return {
		file: ROOT, title: "Recorded nested trace", cwd: "/isolated/project", startedAt: START, endedAt: START + 110_000,
		mtimeMs: START + 110_000, etag: "fixture",
		tracks: [
			track("main", null, ROOT, [
				span("main:turn", "turn", 0, 0, "First prompt", { entryId: "prompt" }),
				span("main:shared", "model", 100, 900, "Root response", { entryId: "shared", model: "recorded-model", tokens: 100 }),
				span("main:spawn", "subagent", 1000, 6000, "Agent alpha", { entryId: "spawn", childTrackId: "alpha", detail: "inspect nested work" }),
				span("main:bash1", "tool", 6000, 6500, "bash", { entryId: "bash1" }),
				span("main:bash2", "tool", 6200, 6800, "bash", { entryId: "bash2", isError: true }),
				span("main:turn2", "turn", 100_000, 100_000, "Second prompt"),
				span("main:later", "model", 100_000, 110_000, "Later response", { entryId: "later" }),
			]),
			track("alpha", "main", CHILD, [
				span("alpha:shared", "model", 1200, 2500, "Child response", { entryId: "shared" }),
				span("alpha:nested", "subagent", 3000, 5000, "Nested task", { entryId: "spawn", childTrackId: "alpha/nested" }),
			]),
			track("alpha/nested", "alpha", GRANDCHILD, [span("alpha/nested:shared", "model", 3200, 3900, "Grandchild response", { entryId: "shared" })]),
		],
		summary: { wallMs: 110_000, modelMs: 10_800, toolMs: 1100, idleMs: 90_000, turns: 2, requests: 4,
			toolCalls: 2, subagents: 2, totalTokens: 100, costTotal: 0.002, unpricedRequests: 0,
			toolStats: [{ tool: "bash", calls: 2, errors: 1, totalMs: 1100, maxMs: 600 }] },
	};
}
function childTrace(file: string): SessionTrace {
	const root = nestedTrace();
	const source = root.tracks.find(item => item.file === file)!;
	return { ...root, file, title: source.label, tracks: [{ ...source, id: "main", parentId: null, spans: source.spans.map(item => ({ ...item, id: `main:${item.entryId ?? item.id}` })) }] };
}
function context(entryReader?: (file: string, id: string) => Promise<unknown>): FeatureContext {
	return {
		theme, now: () => START + 110_000, changed() {}, copy: async () => {}, openTrace() {}, openScreen() {},
		reader: {
			fetch: async () => ({}),
			async api<T>(path: string, params?: Record<string, string>): Promise<T> {
				if (path === "/api/session/trace") return (params?.file === ROOT ? nestedTrace() : childTrace(params!.file!)) as T;
				if (path === "/api/session/entry") {
					const entry = entryReader ? await entryReader(params!.file!, params!.id!) : { message: { role: "assistant", content: [{ type: "text", text: `Entry ${params!.id} in ${params!.file}` }] } };
					return { entry } as T;
				}
				if (path === "/api/sessions") return [] as T;
				throw new Error(`Unexpected fixture query ${path}`);
			},
		},
	};
}
async function settle(): Promise<void> {
	for (let i = 0; i < 8; i++) await Promise.resolve();
}

// Consumer-visible arithmetic: no parent-relative stretching of nested calls.
test("root-child-grandchild spans share wall-time coordinates and retain their actual durations", () => {
	const trace = nestedTrace(), scale = buildScale(trace.tracks, "time", false), viewport = fit(scale);
	const parent = trace.tracks[0]!.spans.find(item => item.id === "main:spawn")!;
	const child = trace.tracks[1]!.spans[0]!, grandchild = trace.tracks[2]!.spans[0]!;
	expect(spanCells(scale, viewport, parent, 1100)).toEqual([10, 60]);
	expect(spanCells(scale, viewport, child, 1100)).toEqual([12, 25]);
	expect(spanCells(scale, viewport, grandchild, 1100)).toEqual([32, 39]);
	expect(scale.toT(scale.toU(grandchild.start))).toBe(grandchild.start);
	expect(grandchild.end - grandchild.start).toBe(700);
});

test("idle compression preserves active nested durations and round-trips selection times", () => {
	const trace = nestedTrace(), scale = buildScale(trace.tracks, "time", true);
	expect(scale.gaps).toHaveLength(1);
	for (const track of trace.tracks) for (const item of track.spans) {
		expect(scale.toT(scale.toU(item.start))).toBeCloseTo(item.start, 3);
		expect(scale.toU(item.end) - scale.toU(item.start)).toBeCloseTo(item.end - item.start, 3);
	}
	expect(scale.domain[1] - scale.domain[0]).toBeLessThan(110_000);
});

test("axis transitions preserve visible wall-time endpoints and nested identity", () => {
	const trace = nestedTrace();
	let scale = buildScale(trace.tracks, "time", true);
	let viewport = { u0: scale.toU(START + 1100), u1: scale.toU(START + 7000) };
	for (const mode of ["turns", "calls", "time"] as const) {
		const next = buildScale(trace.tracks, mode, true);
		viewport = remapViewport(scale, next, viewport);
		expect(next.toT(viewport.u0)).toBeCloseTo(START + 1100, 3);
		expect(next.toT(viewport.u1)).toBeCloseTo(START + 7000, 3);
		expect(rowForEntry(trace, GRANDCHILD, "shared")?.key).toBe("alpha/nested:shared");
		scale = next;
	}
});

test("keyboard zoom anchors a moved cursor instead of assuming the center", () => {
	const trace = nestedTrace(), scale = buildScale(trace.tracks, "calls", false), viewport = fit(scale);
	for (const cursor of [0.2, 0.8]) {
		const anchor = scale.toT(viewport.u0 + cursor * (viewport.u1 - viewport.u0));
		const zoomed = zoomViewport(scale, viewport, 0.5, cursor);
		expect(scale.toT(zoomed.u0 + cursor * (zoomed.u1 - zoomed.u0))).toBeCloseTo(anchor, 3);
	}
});

test("concurrent calls do not overwrite each other's lane and ancestor expansion is recursive", () => {
	const tracks = nestedTrace().tracks;
	const toolLanes = buildLanes(tracks, new Set()).filter(lane => lane.track.id === "main" && lane.kind === "tool");
	expect(toolLanes).toHaveLength(2);
	expect(toolLanes.flatMap(lane => lane.spans).map(item => item.id)).toEqual(["main:bash1", "main:bash2"]);
	expect(ancestors(tracks, "alpha/nested")).toEqual(["alpha", "main"]);
	const collapsed = new Set(["alpha"]);
	expect(visibleTracks(tracks, collapsed).map(item => item.id)).toEqual(["main", "alpha"]);
	for (const id of ancestors(tracks, "alpha/nested")) collapsed.delete(id);
	expect(visibleTracks(tracks, collapsed)).toHaveLength(3);
	expect(transcriptRows(tracks).find(row => row.span?.entryId === "shared")?.track.file).toBe(ROOT);
	expect(rowForEntry(nestedTrace(), CHILD, "shared")?.span?.label).toBe("Child response");
});

test("nested navigation, search, axis changes and file back preserve selected-span meaning", async () => {
	const controller = createTracesFeature(context());
	await controller.openTrace!(ROOT, "spawn");
	await settle();
	controller.handleInput("\x1b"); // close entry drawer
	controller.handleInput("o"); // reveal child track
	expect(stripTerminalSequences(controller.render(100, 36).join("\n"))).toContain("Selected: alpha · model · Child response");
	controller.handleInput("/");
	controller.handleInput("Nested task");
	controller.handleInput("\r");
	controller.handleInput("o"); // child -> grandchild
	for (const key of ["v", "v", "i", "+", "\x1b[C", "f", "v", "0"]) controller.handleInput(key);
	let lines = controller.render(100, 36);
	expect(stripTerminalSequences(lines.join("\n"))).toContain("Selected: alpha/nested · model · Grandchild response");
	for (const width of [12, 40, 80]) expect(controller.render(width, 24).every(line => visibleWidth(line) <= width)).toBe(true);
	controller.handleInput("O"); // own transcript
	await settle();
	expect(stripTerminalSequences(controller.render(100, 36).join("\n"))).toContain("Selected: main · model · Grandchild response");
	controller.handleInput("b");
	expect(stripTerminalSequences(controller.render(100, 36).join("\n"))).toContain("Selected: alpha/nested · model · Grandchild response");
	controller.handleInput("\r");
	await settle();
	lines = controller.render(100, 36);
	expect(stripTerminalSequences(lines.join("\n"))).toContain(`Entry shared in ${GRANDCHILD}`);
	expect(controller.handleInput("q")).toBe(false);
	expect(controller.handleInput("]")).toBe(false);
	controller.dispose();
});

test("late entry payload cannot replace a newer selected span's journal entry", async () => {
	let resolveOld!: (entry: unknown) => void;
	const old = new Promise<unknown>(resolve => { resolveOld = resolve; });
	const controller = createTracesFeature(context(async (_file, id) => id === "shared" ? old : { message: { content: "CURRENT selected task entry" } }));
	await controller.openTrace!(ROOT, "shared");
	await controller.openTrace!(ROOT, "spawn");
	await settle();
	resolveOld({ message: { content: "OBSOLETE model entry" } });
	await settle();
	const text = stripTerminalSequences(controller.render(100, 36).join("\n"));
	expect(text).toContain("Selected: main · subagent · Agent alpha");
	expect(text).toContain("CURRENT selected task entry");
	expect(text).not.toContain("OBSOLETE model entry");
	controller.dispose();
});
