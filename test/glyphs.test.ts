import { test, expect } from "bun:test";
import { ensureThemeSync, theme } from "@oh-my-pi/pi-tui/theme";
import { SYMBOL_PRESETS } from "@oh-my-pi/pi-tui/theme/symbols";
import {
	type GlyphSet,
	glyph,
	glyphsFor,
	HEAT_LEVELS,
	BAR_LEVELS,
	SPARK_LEVELS,
} from "../src/tui/glyphs";
import {
	STATS_ICONS,
	HOST_ICON_KEYS,
	NEW_ICON_ROLES,
	ICON_GUTTER,
	statsIcon,
} from "../src/tui/icons";

const PRESETS = ["unicode", "nerd", "ascii"] as const;

/** The one measured exception to the width-1 rule, keyed `preset/role`. */
const BLANK_BY_DESIGN: Record<string, boolean> = { "ascii/heatEmpty": true };

// ensureThemeSync() returns void, so the module-scope binding is only readable
// after the call. Fine in a test; forbidden in extension code (see AGENTS.md).
ensureThemeSync();

const liveTheme = theme;

test("every data-ink glyph in every preset is exactly one cell wide", () => {
	for (const preset of PRESETS) {
		const set = glyphsFor(preset);
		for (const [role, value] of Object.entries(set)) {
			const glyphs = typeof value === "string" ? [value] : value;
			for (const g of glyphs) {
			if (BLANK_BY_DESIGN[`${preset}/${role}`]) continue;
				expect(Bun.stringWidth(g), `${preset}/${role}/${g}`).toBe(1);
			}
		}
	}
});

test("nerd preset emits byte-identical data ink to unicode", () => {
	expect(glyphsFor("nerd")).toEqual(glyphsFor("unicode"));
});

test("every ramp has its declared length, so a typo cannot silently shorten one", () => {
	expect(glyphsFor("unicode").sparkRamp).toHaveLength(SPARK_LEVELS);
	expect(glyphsFor("ascii").sparkRamp).toHaveLength(SPARK_LEVELS);
	expect(glyphsFor("unicode").heatCell).toHaveLength(HEAT_LEVELS);
	expect(glyphsFor("ascii").heatCell).toHaveLength(HEAT_LEVELS);
});

test("sparkRamp is the eight vertical eighths, lowest first", () => {
	expect(glyph("unicode", "sparkRamp", 0)).toBe("▁");
	expect(glyph("unicode", "sparkRamp", 7)).toBe("█");
	expect(glyphsFor("unicode").sparkRamp).toHaveLength(8);
});

test("barFill is the full block, barEmpty the light shade — the daily-bar pair", () => {
	expect(glyph("unicode", "barFill")).toBe("█"); // U+2588
	expect(glyph("unicode", "barEmpty")).toBe("░"); // U+2591
});

test("heatCell is a RAMP, so the ladder is a one-line table edit, not a code change", () => {
	// The heatmap ladder is a deferred decision (see the plan's Global Constraints):
	// ■-plus-colour and the ░▒▓█ shade ramp are both admissible. Asserting the SHAPE
	// rather than a ladder is what keeps that swap free. Every level must still be
	// one cell wide, so swapping ladders can never break the row width below.
	for (const preset of PRESETS) {
		const value = glyphsFor(preset).heatCell;
		expect(Array.isArray(value), `${preset} heatCell must be a ramp`).toBe(true);
		for (let level = 0; level < HEAT_LEVELS; level++) {
			expect(Bun.stringWidth(glyph(preset, "heatCell", level)), `${preset} heat level ${level}`).toBe(1);
		}
	}
	// Distinct rungs: a ramp of four identical glyphs would carry no level at all.
	for (const preset of PRESETS) {
		const ramp = glyphsFor(preset).heatCell as readonly string[];
		expect(new Set(ramp).size, `${preset} heatCell rungs`).toBe(HEAT_LEVELS);
	}
});

test("the shade-ramp alternative is admissible without any code change (deferred decision)", () => {
	// Proves the SWAP is cheap; it does not pick a winner. If someone changes
	// UNICODE_GLYPHS.heatCell to this ladder, everything here must keep passing.
	const SHADE = ["░", "▒", "▓", "█"] as const;
	expect(SHADE).toHaveLength(HEAT_LEVELS);
	for (const g of SHADE) expect(Bun.stringWidth(g)).toBe(1);
	expect(glyph("unicode", "heatCell", 1)).not.toBe(glyph("unicode", "heatCell", 2));
});

test("MEASUREMENT TRAP: sep.pipe is 3 cells under unicode but 1 under nerd — never a column separator", () => {
	// Using sep.pipe would triple the gap on two presets and leave the third correct:
	// an alignment bug invisible under `nerd`.
	expect(Bun.stringWidth(theme.symbol("sep.pipe"))).toBe(3);
	expect(Bun.stringWidth(SYMBOL_PRESETS.nerd["sep.pipe"])).toBe(1);
	for (const preset of PRESETS) {
		expect(Bun.stringWidth(glyph(preset, "columnGap")), `${preset} columnGap`).toBe(1);
		expect(glyph(preset, "columnGap"), `${preset} columnGap`).not.toBe(SYMBOL_PRESETS[preset]["sep.pipe"]);
	}
});

test("MEASUREMENT TRAP: bare ⚠ is 1 cell, ⚠️ with VS16 is 2 — the warning icon uses the bare form", () => {
	expect(Bun.stringWidth("⚠")).toBe(1);
	expect(Bun.stringWidth("⚠️")).toBe(2);
	expect(statsIcon("unicode", "warning")).toBe("⚠");
	expect(statsIcon("unicode", "warning")).not.toContain("️");
	for (const preset of PRESETS) {
		expect(statsIcon(preset, "warning")).not.toContain("️");
	}
});

test("icons: unicode preset uses emoji, nerd uses PUA, ascii uses plain ASCII labels", () => {
	expect(statsIcon("unicode", "cost")).toBe("💲");
	expect(statsIcon("nerd", "cost")).toBe("");
	expect(statsIcon("ascii", "cost")).toBe("$");
	for (const icon of Object.values(STATS_ICONS.ascii)) {
		expect(/^[\x20-\x7E]+$/.test(icon), `ascii icon must be ASCII: ${icon}`).toBe(true);
	}
});

test("icons: only four roles are new; twelve route through a host key", () => {
	expect([...NEW_ICON_ROLES].sort()).toEqual(["calendar", "gains", "trendDown", "trendUp"]);
	expect(Object.keys(STATS_ICONS.unicode)).toHaveLength(16);
	expect(Object.keys(HOST_ICON_KEYS)).toHaveLength(12);
});

test("icons: every role has a non-empty value in all three presets", () => {
	for (const preset of PRESETS) {
		for (const role of Object.keys(STATS_ICONS[preset]) as (keyof typeof STATS_ICONS.unicode)[]) {
			expect(STATS_ICONS[preset][role].length, `${preset}/${role}`).toBeGreaterThan(0);
		}
	}
});

test("icons: every unicode icon is one or two cells, and ICON_GUTTER matches the widest", () => {
	for (const [role, icon] of Object.entries(STATS_ICONS.unicode)) {
		expect([1, 2], `${role}=${icon}`).toContain(Bun.stringWidth(icon));
	}
	expect(ICON_GUTTER.unicode).toBe(2); // emoji are 2 cells; headings reserve the wider gutter
	expect(ICON_GUTTER.nerd).toBe(1);
	// The gutter must be wide enough for the icons actually shipped, or every
	// heading after the first misaligns.
	const widestUnicode = Math.max(...Object.values(STATS_ICONS.unicode).map(i => Bun.stringWidth(i)));
	expect(ICON_GUTTER.unicode).toBeGreaterThanOrEqual(widestUnicode);
	const widestNerd = Math.max(...Object.values(STATS_ICONS.nerd).map(i => Bun.stringWidth(i)));
	expect(ICON_GUTTER.nerd).toBeGreaterThanOrEqual(widestNerd);
});

test("every role not in HOST_ICON_KEYS is genuinely absent from omp's SYMBOL_PRESETS", () => {
	// Guards the reuse direction. If a future omp release registers a key we could
	// have reused, this fails and the role should be moved into HOST_ICON_KEYS
	// rather than left shadowing the host's choice.
	const hostKeys = new Set(Object.keys(SYMBOL_PRESETS.unicode));
	for (const key of Object.values(HOST_ICON_KEYS)) {
		expect(hostKeys.has(key), `host key ${key} must exist`).toBe(true);
	}
	for (const role of NEW_ICON_ROLES) {
		const stem = role.replace(/[A-Z]/g, c => `.${c.toLowerCase()}`);
		const derived = [stem, stem.replace(".", ""), `icon.${role}`];
		for (const candidate of derived) {
			expect(hostKeys.has(candidate), `${role}: ${candidate} is now registered by the host`).toBe(false);
		}
	}
});

test("statsIcon prefers the host registry when a theme is supplied", () => {
	for (const [role, key] of Object.entries(HOST_ICON_KEYS)) {
		expect(statsIcon("unicode", role as never, liveTheme)).toBe(liveTheme.symbol(key));
	}
	// Without a theme the pure table is used — that is the load-order-safe path.
	expect(statsIcon("unicode", "calendar")).toBe(STATS_ICONS.unicode.calendar);
});

test("ascii heat ladder is . - + #, distinct per level", () => {
	const set = glyphsFor("ascii");
	expect(set.heatCell).toEqual([".", "-", "+", "#"]);
	expect(new Set(set.heatCell as readonly string[]).size).toBe(4);
	expect(set.heatEmpty).toBe(" ");
});

test("ascii sparkline is an eight-rung ranking ladder, all distinct", () => {
	const ramp = glyphsFor("ascii").sparkRamp as readonly string[];
	expect(ramp).toHaveLength(8);
	expect(new Set(ramp).size).toBe(8);
	for (const g of ramp) expect(Bun.stringWidth(g)).toBe(1);
});

test("glyph clamps the level into the ramp instead of returning undefined", () => {
	expect(glyph("unicode", "sparkRamp", 99)).toBe("█");
	expect(glyph("unicode", "sparkRamp", -5)).toBe("▁");
	expect(glyph("unicode", "heatCell", 7)).toBe(glyph("unicode", "heatCell", HEAT_LEVELS - 1));
});

test("a 7x53 heatmap is exactly 108 cells wide on every row, under both ladders", () => {
	// Review Focus line 5: an ASCII ladder that misaligns by one cell is worse
	// than the Unicode one. This is the reason the whole module exists.
	for (const preset of ["unicode", "ascii"] as const) {
		const set: GlyphSet = glyphsFor(preset);
		const gap = glyph(preset, "columnGap");
		const widths = new Set<number>();
		for (let day = 0; day < 7; day++) {
			const label = `${["M", "T", "W", "T", "F", "S", "S"][day]} `;
			let row = label;
			for (let week = 0; week < 53; week++) {
				const level = (day * 7 + week) % (HEAT_LEVELS + 1);
				row += (level === 0 ? glyph(preset, "heatEmpty") : glyph(preset, "heatCell", level - 1)) + gap;
			}
			widths.add(Bun.stringWidth(row));
		}
		expect([...widths], `${preset} heatmap row widths`).toEqual([108]);
		expect(set.heatCell).toBeDefined();
	}
});

test("BAR_LEVELS matches the eight vertical levels the daily bar chart downsamples into", () => {
	expect(BAR_LEVELS).toBe(8);
	expect(glyphsFor("unicode").sparkRamp).toHaveLength(BAR_LEVELS);
});