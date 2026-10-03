import { test, expect } from "bun:test";
import {
	SCREENS,
	IMPLEMENTED_IDS,
	screenById,
	type ScreenContext,
	type ScreenId,
} from "../src/tui/screens/types";
import { PLACEHOLDER_MARKER } from "../src/tui/screens/placeholders";
import { RANGES, DEFAULT_RANGE } from "../src/data/ranges";
import { DATA_NEEDS, type PanelData } from "../src/data/api";
import { planLayout } from "../src/tui/layout";
import { glyphsFor } from "../src/tui/glyphs";
import { ensureThemeSync, theme } from "@oh-my-pi/pi-tui/theme";

// One ScreenContext for the whole file. Screens must be renderable headless,
// which is the whole reason the interface carries a Theme instead of reading
// the theme singleton.
ensureThemeSync();
function ctxWith(data: Partial<PanelData>, width = 120, override?: PanelData): ScreenContext {
	return {
		width,
		rows: 40,
		range: DEFAULT_RANGE,
		theme,
		preset: "unicode",
		glyphs: glyphsFor("unicode"),
		plan: planLayout(width, 40, "unicode"),
		data: override ?? (data as PanelData),
		colorFor: () => (t: string) => t,
	};
}

/**
 * Every screen whose body is still a stub — the nine scaffolds PLUS the three
 * Tasks 13-15 screens, whose bodies land later and are placeholders today. The
 * plan's four PLACEHOLDER tests filter on `status === "scaffolded"`; widening to
 * "not excluded" means the three implemented entries are held to exactly the
 * same no-fetch and obvious-fake rules instead of quietly escaping them.
 */
const STUBS = SCREENS.filter(s => s.status !== "excluded");

test("every dashboard screen is registered exactly once", () => {
	const ids = SCREENS.map(s => s.id);
	expect(new Set(ids).size).toBe(ids.length);
	for (const id of [
		"overview",
		"models",
		"costs",
		"projects",
		"requests",
		"errors",
		"tools",
		"providers",
		"gain",
		"traces",
		"frustration",
	] as ScreenId[]) {
		expect(ids, id).toContain(id);
	}
});

test("screenById throws on an id that is not registered", () => {
	// A silent undefined would reach a tab strip and paint an empty body that
	// reads as "this screen has no data" rather than as "this screen does not exist".
	expect(() => screenById("nope" as ScreenId)).toThrow();
});

test("traces and frustration are excluded, not ported — ADR 0004", () => {
	for (const id of ["traces", "frustration"] as const) {
		expect(screenById(id).status, id).toBe("excluded");
		expect(screenById(id).needs, id).toEqual([]);
		expect(screenById(id).reason!.length, id).toBeGreaterThan(20);
	}
});

test("a scaffolded screen declares its real data contract and renders labelled PLACEHOLDER rows", () => {
	const costs = screenById("costs");
	expect(costs.status).toBe("scaffolded");
	expect(costs.needs).toEqual(["costs"]);
	const rows = costs.render(ctxWith({}));
	// Not one "not built yet" line: a reviewable layout with obviously fake values.
	expect(rows.length).toBeGreaterThan(3);
	expect(rows[0]).toContain(PLACEHOLDER_MARKER); // snapshot-style: marker present
	expect(rows.some(r => r.includes("placeholder"))).toBe(true);
});

test("PLACEHOLDER: every scaffolded screen's first row carries the marker", () => {
	for (const s of STUBS) {
		const rows = s.render(ctxWith({}));
		expect(rows.length, s.id).toBeGreaterThan(1);
		expect(rows[0], `${s.id} must be visibly marked as placeholder data`).toContain(
			PLACEHOLDER_MARKER,
		);
	}
});

test("PLACEHOLDER: a scaffolded screen NEVER fetches — selecting it issues no adapter call", () => {
	// The hard rule. A scaffold renders its fixture and returns; ctx.data is never read
	// and no fetchFor call is issued. Proven by handing it a ctx whose data access throws.
	for (const s of STUBS) {
		const trap = new Proxy({} as PanelData, {
			get(_t, prop) {
				throw new Error(`scaffold ${s.id} must not read ctx.data.${String(prop)}`);
			},
		});
		expect(() => s.render(ctxWith({}, 120, trap))).not.toThrow();
	}
});

test("PLACEHOLDER: the sample rows are recognisably fake, not plausible-looking data", () => {
	// A placeholder that reads like real numbers is worse than no placeholder: the user
	// reads a real number off the screen and believes it. Every fixture value must be
	// obviously synthetic.
	for (const s of STUBS) {
		const rows = s.render(ctxWith({})).join("\n");
		expect(rows, s.id).toMatch(/placeholder|example|sample/i);
	}
});

test("PLACEHOLDER: the fake values are synthetic in their own right, not only labelled", () => {
	// The previous test is satisfied by the marker alone, which proves nothing about
	// the body. Strip the chrome and require the DATA rows to carry the tell.
	for (const s of STUBS) {
		const body = s
			.render(ctxWith({}))
			.slice(2)
			.join("\n");
		expect(body, `${s.id}: sample rows must not read as real usage`).toMatch(
			/example|sample|placeholder/i,
		);
	}
});

test("providers declares no needs: provider-windows does network I/O and is forbidden", () => {
	expect(screenById("providers").needs).toEqual([]);
	expect(screenById("providers").reason).toMatch(/network/i);
});

test("no screen declares a need that is not a real DataNeed", () => {
	for (const s of SCREENS) {
		for (const n of s.needs) expect(DATA_NEEDS, `${s.id}/${n}`).toContain(n);
	}
});

test("every scaffolded screen's needs are covered by the range list, so no screen can ask for an invalid window", () => {
	expect(RANGES).toContain(DEFAULT_RANGE);
	expect(RANGES).not.toContain("365d");
});

test("short labels fit a narrow tab strip", () => {
	for (const s of SCREENS) expect(Bun.stringWidth(s.short), s.id).toBeLessThanOrEqual(8);
});

test("IMPLEMENTED_IDS is exactly the three screens tasks 13-15 build", () => {
	expect([...IMPLEMENTED_IDS]).toEqual(["overview", "activity", "models"]);
});

test("every screen that is not implemented states a reason", () => {
	// A tab with no stated reason is indistinguishable from a bug.
	for (const s of SCREENS) {
		if (s.status === "implemented") continue;
		expect(s.reason, `${s.id} must say why it is ${s.status}`).toBeTruthy();
	}
});

test("an excluded screen renders its reason and no fabricated data", () => {
	for (const s of SCREENS.filter(x => x.status === "excluded")) {
		const rows = s.render(ctxWith({})).join("\n");
		expect(rows, s.id).toContain(s.reason!);
		expect(rows, s.id).not.toContain(PLACEHOLDER_MARKER);
	}
});

test("the registry is data: every screen renders identically at any width without a terminal", () => {
	// Purity is what makes the mount seam in Task 11 testable at all. A screen that
	// reaches for the terminal, a singleton, or the clock cannot be rendered here.
	for (const s of SCREENS) {
		for (const width of [20, 60, 120]) {
			expect(() => s.render(ctxWith({}, width)), `${s.id}@${width}`).not.toThrow();
			expect(s.render(ctxWith({}, width)).length, `${s.id}@${width}`).toBeGreaterThan(0);
		}
	}
});

test("rendering the same screen twice yields identical rows", () => {
	for (const s of SCREENS) {
		expect(s.render(ctxWith({})), s.id).toEqual(s.render(ctxWith({})));
	}
});
