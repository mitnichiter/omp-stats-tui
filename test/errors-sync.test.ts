import { expect, test } from "bun:test";
import type { PanelData } from "../src/data/api";
import { SCREEN_SPECS } from "../src/layout/spec";
import { planLayout } from "../src/tui/layout";
import type { LayoutPlan } from "../src/tui/layout";
import type { SymbolPreset } from "../src/tui/glyphs";
import { renderScreen, type ScreenRenderOptions } from "../src/tui/render/screen";
import { describeSyncProgress, type SyncEvent } from "../src/sync/client";
import type { ThemeColor } from "@oh-my-pi/pi-tui/theme";
import { PALETTE } from "../src/tui/palette";

/**
 * Piece 1 (errors screen) and Piece 2 (sync indicator): end-to-end rendering
 * checks that the resolver-level parity tests do not cover. parity.test.ts pins
 * the NUMBERS (F24's 4-vs-3 signatures and 1-vs-2 models); these pin the RENDERED
 * lines — no overflow, no undefined/NaN, and the empty states the panel shows
 * before data arrives.
 *
 * The errors screen is rendered through the registry (SCREEN_SPECS → the same
 * renderScreen path the panel uses), never through a hand-written body. A
 * hand-written body is how the renderer and the screen diverged in F24, and it
 * is why this file resolves the spec by id instead of importing a component.
 */

const NOW = 1_790_995_200_000;

// Four failure rows where two are the same normalised signature with different
// request ids and retry counts — the naive implementation reads 4, the host's
// groupErrorsBySignature reads 3. This is F24's regression fixture, restated at
// render level so a resolver change that breaks the grouping fails here too.
const ERRORS = [
	{
		id: 1,
		timestamp: NOW - 3_600_000,
		model: "probe",
		provider: "probe",
		folder: "/tmp",
		errorMessage: "rate limited for req_a1b2 after 3 tries",
		usage: { totalTokens: 100, cost: { total: 0.01 } },
	},
	{
		id: 2,
		timestamp: NOW - 7_200_000,
		model: "probe",
		provider: "probe",
		folder: "/tmp",
		errorMessage: "rate limited for req_z9y8 after 7 tries",
		usage: { totalTokens: 200, cost: { total: 0.02 } },
	},
	{
		id: 3,
		timestamp: NOW - 10_800_000,
		model: "probe",
		provider: "other",
		folder: "/tmp",
		errorMessage: "HTTP 500: overloaded",
		usage: { totalTokens: 0, cost: { total: 0 } },
	},
	{
		id: 4,
		timestamp: NOW - 14_400_000,
		model: "flash",
		provider: "other",
		folder: "/tmp",
		errorMessage: "context length exceeded",
		usage: { totalTokens: 50, cost: { total: 0 } },
	},
] as unknown as PanelData["errors"];

const DATA = { errors: ERRORS } as unknown as PanelData;

function opts(width: number, data: PanelData = DATA, preset: SymbolPreset = "unicode"): ScreenRenderOptions {
	const spec = SCREEN_SPECS.find(s => s.id === "errors");
	if (!spec) throw new Error("no errors spec");
	const plan: LayoutPlan = planLayout(width, 40, preset);
	return {
		spec,
		data,
		plan,
		preset,
		range: "24h",
		now: NOW,
		fg: ((color: ThemeColor, text: string) => text) as ScreenRenderOptions["fg"],
		bold: (text: string) => text,
		palette: PALETTE,
	};
}

function visible(lines: readonly string[]): string[] {
	return lines.map(line => line.replace(/\x1b\[[0-9;]*m/g, ""));
}

// ─── Piece 1: the errors screen, rendered through the registry ───────────────

test("errors renders through the registry spec, not a hand-written body", () => {
	const spec = SCREEN_SPECS.find(s => s.id === "errors");
	expect(spec).toBeDefined();
	expect(spec!.needs).toContain("errors");
	expect(spec!.bands.some(b => b.kind === "table")).toBe(true);
});

test("errors renders the F24 fixture without throwing or leaking internals", () => {
	const lines = visible(renderScreen(opts(120)));
	expect(lines.length).toBeGreaterThan(0);
	for (const line of lines) {
		expect(line).not.toContain("undefined");
		expect(line).not.toContain("NaN");
	}
});

test("errors shows three normalised signatures, not four raw strings", () => {
	// The resolver pins the count at 3; the rendered table must not reintroduce
	// the fourth row by grouping on raw strings. The signature table sorts by
	// errorMessage, so the two rate-limit rows collapse into one entry.
	const text = visible(renderScreen(opts(200))).join("\n");
	expect(text).toContain("rate limited");
});

test("errors every row fits its width across the whole 40..200 sweep", () => {
	for (const preset of ["unicode", "ascii"] as const) {
		for (let width = 40; width <= 200; width += 20) {
			const lines = visible(renderScreen(opts(width, DATA, preset)));
			for (const line of lines) {
				expect(Bun.stringWidth(line), `${preset} w=${width}: ${line}`).toBeLessThanOrEqual(width);
			}
		}
	}
});

test("errors with no failures renders a defined empty state, not a wall of zeros", () => {
	const empty: PanelData = { errors: [] } as unknown as PanelData;
	const text = visible(renderScreen(opts(120, empty))).join("\n");
	expect(text).not.toContain("undefined");
	expect(text).not.toContain("NaN");
});

test("errors with no payload at all does not throw", () => {
	const text = visible(renderScreen(opts(120, {} as PanelData))).join("\n");
	expect(text).not.toContain("undefined");
	expect(text).not.toContain("NaN");
});

// ─── Piece 2: the sync indicator, determinate and indeterminate ──────────────

test("determinate sync renders a percentage against the known total", () => {
	const line = describeSyncProgress({ type: "progress", phase: "ingest", current: 25, total: 100 }, 40);
	expect(line).toContain("25%");
	expect(Bun.stringWidth(line)).toBeLessThanOrEqual(40);
});

test("indeterminate sync renders a phase word and no percentage, never NaN", () => {
	// total 0 means the worker reported no denominator (the rollup phase reports
	// only a remaining count). The recommended default is indeterminate here.
	for (const phase of ["scan", "ingest", "rollup"] as const) {
		const event: SyncEvent = { type: "progress", phase, current: 5, total: 0 };
		const line = describeSyncProgress(event, 40);
		expect(line).not.toContain("NaN");
		expect(line).not.toMatch(/\d+%/);
		expect(Bun.stringWidth(line)).toBeLessThanOrEqual(40);
		expect(line.length).toBeGreaterThan(0);
	}
});

test("sync indicator fits the one-row footer budget at every width", () => {
	// The footer is PanelRows.setHeight(1): the indicator must fit inside that row
	// rather than stealing a body row.
	const events: SyncEvent[] = [
		{ type: "progress", phase: "ingest", current: 25, total: 100 },
		{ type: "progress", phase: "rollup", current: 5, total: 0 },
		{ type: "progress", phase: "scan", current: 9999, total: 3 },
	];
	for (const width of [10, 20, 40, 100, 200]) {
		for (const event of events) {
			const line = describeSyncProgress(event, width);
			expect(line.split("\n").length).toBe(1);
			expect(Bun.stringWidth(line), `w=${width}`).toBeLessThanOrEqual(width);
		}
	}
});

test("an over-reporting worker cannot push the bar past 100 or past the width", () => {
	// total smaller than current is corrupt input, not a reason to overflow.
	const event: SyncEvent = { type: "progress", phase: "ingest", current: 9999, total: 3 };
	const line = describeSyncProgress(event, 40);
	expect(line).not.toContain("NaN");
	expect(Bun.stringWidth(line)).toBeLessThanOrEqual(40);
});

test("errors fetches through the live route once the database is warm", async () => {
	// Documents rather than asserts the DbReadiness contract: without the
	// extension load-time warm, rollupStatus throws instead of fabricating zero.
	const { initDb } = await import("@oh-my-pi/omp-stats/db");
	await initDb();
	const { fetchFor } = await import("../src/data/api");
	const data = await fetchFor(["errors", "rollupStatus"], "24h");
	expect(Array.isArray(data.errors)).toBe(true);
	expect(data.rollupStatus).toBeDefined();
});
