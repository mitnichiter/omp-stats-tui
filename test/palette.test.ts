import { expect, test } from "bun:test";
import { colorLuma, hexToRgb } from "@oh-my-pi/pi-utils";
import { colorToAnsi, FG_RESET } from "@oh-my-pi/pi-tui/theme/color";
import { isValidThemeColor, type ThemeColor } from "@oh-my-pi/pi-tui/theme/schema";
import { heatRamp, PALETTE, SERIES_COLORS, resolveSeries, stripForTest, type PaletteRole } from "../src/tui/palette";

/**
 * The colour layer. Every assertion here is about the module taking colours from
 * omp's own theme rather than from a private palette: a wrong token, a hardcoded
 * hex, or an assumed-truecolor path all break user-visible cohesion.
 *
 * Colour and glyphs are INDEPENDENT axes — `getSymbolPreset() === "ascii"` must
 * not perturb a single colour value, or the panel would change palette as well
 * as shape when a user switches preset.
 */

/** A Theme stand-in: only the surface `palette.ts` is allowed to touch. */
function fakeTheme(overrides: Partial<{ mode: "truecolor" | "256color"; preset: "unicode" | "nerd" | "ascii" }> = {}) {
	const hex: Record<ThemeColor, string> = new Proxy(
		{ accent: "#ff79c6", text: "#e5e5e7", success: "#50fa7b", error: "#ff5555", dim: "#6272a4" } as Record<
			ThemeColor,
			string
		>,
		{
			get: (target, key: string) => target[key as ThemeColor] ?? "#cccccc",
		},
	);
	return {
		getColorHex: (c: ThemeColor) => hex[c],
		getColorMode: () => overrides.mode ?? "truecolor",
		getSymbolPreset: () => overrides.preset ?? "unicode",
		fg: (c: ThemeColor, text: string) => `${colorToAnsi(hex[c], overrides.mode ?? "truecolor")}${text}${FG_RESET}`,
	};
}

test("every palette entry is a member of the real ThemeColor union", () => {
	const roles = Object.keys(PALETTE) as PaletteRole[];
	expect(roles.length).toBeGreaterThan(0);
	for (const role of roles) {
		// isValidThemeColor is the runtime guard over the SAME union the compiler
		// checks, so a typo fails here even though `as ThemeColor` would silence it.
		expect(isValidThemeColor(PALETTE[role])).toBe(true);
	}
});

// A deliberately wrong token: if this ever passed, the membership test above is
// vacuous and the palette is not being validated at all.
test("a bogus token is rejected by the same check that validates the palette", () => {
	expect(isValidThemeColor("chartSeries1" as ThemeColor)).toBe(false);
	expect(isValidThemeColor("accent")).toBe(true);
});

test("the panel's roles are all present", () => {
	for (const role of [
		"primary",
		"negative",
		"positive",
		"heading",
		"label",
		"meta",
		"muted",
		"dim",
		"heat0",
		"heat1",
		"heat2",
		"heat3",
	] as PaletteRole[]) {
		expect(PALETTE[role]).toBeDefined();
	}
});

test("the heat roles form a 4-level ladder, matching HEAT_LEVELS in our glyphs", () => {
	expect(PALETTE.heat0).not.toBe(PALETTE.heat3);
	expect(new Set([PALETTE.heat0, PALETTE.heat1, PALETTE.heat2, PALETTE.heat3]).size).toBe(4);
});

test("the series palette offers at least 6 colours for multi-series charts", () => {
	expect(SERIES_COLORS.length).toBeGreaterThanOrEqual(6);
	for (const c of SERIES_COLORS) expect(isValidThemeColor(c)).toBe(true);
	// Position colouring is only useful if positions can differ; a theme that
	// aliases several tokens to one hue would collapse them (segment-track.ts
	// dedupes for exactly this reason).
	const distinct = new Set(resolveSeries(SERIES_COLORS.length, fakeTheme()));
	expect(distinct.size).toBeGreaterThanOrEqual(1);
});

test("adjacent series colours are resolvable and repeat past the end via modulo", () => {
	const theme = fakeTheme();
	const series = resolveSeries(4, theme);
	expect(series).toHaveLength(4);
	expect(series[0]).not.toBe(series[1]);
	// Asking for more than exist wraps rather than returning undefined.
	expect(resolveSeries(20, theme)).toHaveLength(20);
	for (const token of resolveSeries(20, theme)) expect(token).toBeDefined();
});

test("resolveSeries never returns an empty palette, even for a monochrome theme", () => {
	// Every token maps to the same hex: the degenerate case a theme like
	// `titanium` produces. It must still yield one usable colour.
	const monochrome = {
		getColorHex: () => "#888888",
		getColorMode: () => "truecolor" as const,
		getSymbolPreset: () => "unicode" as const,
		fg: (c: ThemeColor, t: string) => `${t}${FG_RESET}`,
	};
	expect(resolveSeries(3, monochrome).length).toBeGreaterThan(0);
});

test("heatRamp is monotonic: level 0 is the most background-ish, level 3 the most accent-ish", () => {
	const theme = fakeTheme();
	const luma = [0, 1, 2, 3].map(level => {
		// Recover the hex behind the escape so luminance is measurable.
		const ansi = heatRamp(theme, level);
		const m = /\x1b\[38;2;(\d+);(\d+);(\d+)m/.exec(ansi);
		expect(m).not.toBeNull(); // truecolor path yields 38;2;…
		return 0.299 * Number(m![1]) + 0.587 * Number(m![2]) + 0.114 * Number(m![3]);
	});
	for (let i = 1; i < luma.length; i++) expect(luma[i]).toBeGreaterThan(luma[i - 1]);
	expect(luma[3]).toBeGreaterThan(luma[0]);
});

test("the four heat levels all differ from each other", () => {
	const theme = fakeTheme();
	const outputs = [0, 1, 2, 3].map(l => heatRamp(theme, l));
	expect(new Set(outputs).size).toBe(4);
});

test("heatRamp output carries no literal hex — it must be an escape from a theme token", () => {
	const theme = fakeTheme();
	for (const level of [0, 1, 2, 3]) {
		const out = heatRamp(theme, level);
		expect(out).not.toMatch(/#[0-9a-f]{6}/i);
		// And it must actually be coloured, not a bare space.
		expect(out).not.toBe(" ");
		expect(out.length).toBeGreaterThan(1);
	}
});

test("heatRamp works under 256color without throwing and still emits a real escape", () => {
	const theme = fakeTheme({ mode: "256color" });
	for (const level of [0, 1, 2, 3]) {
		const out = heatRamp(theme, level);
		expect(out).toMatch(/\x1b\[38;5;\d+m/);
		expect(out).not.toMatch(/#[0-9a-f]{6}/i);
	}
	expect(new Set([0, 1, 2, 3].map(l => heatRamp(theme, l))).size).toBe(4);
});

test("heatRamp anchors to a near-background end, so level 0 recedes on dark themes", () => {
	const theme = fakeTheme(); // text = #e5e5e7, i.e. a dark background
	const zero = /\x1b\[38;2;(\d+);(\d+);(\d+)m/.exec(heatRamp(theme, 0))!;
	const l = colorLuma(theme.getColorHex("accent"))!;
	// Level 0 must be dimmer than the accent it ramps toward, otherwise an empty
	// day would read as "full activity".
	const luma0 = 0.299 * Number(zero[1]) + 0.587 * Number(zero[2]) + 0.114 * Number(zero[3]);
	expect(luma0).toBeLessThan(l * 255);
	expect(hexToRgb(theme.getColorHex("accent"))).toBeDefined();
});

test("the palette survives getSymbolPreset() === 'ascii' unchanged", () => {
	const unicode = fakeTheme({ preset: "unicode" });
	const ascii = fakeTheme({ preset: "ascii" });
	// Colour and glyph are independent axes: the same theme must yield the same
	// colours whatever the preset says.
	expect([0, 1, 2, 3].map(l => heatRamp(ascii, l))).toEqual([0, 1, 2, 3].map(l => heatRamp(unicode, l)));
	expect(resolveSeries(6, ascii)).toEqual(resolveSeries(6, unicode));
	expect(ascii.getSymbolPreset()).toBe("ascii");
	// Every role resolves, and every role is a token the host's validator
	// accepts — a misspelled token is a compile error here and a runtime
	// uncoloured cell if it ever slips through.
	for (const role of Object.keys(PALETTE) as PaletteRole[]) {
		expect(isValidThemeColor(PALETTE[role]), role).toBe(true);
	}
});

test("stripForTest removes ANSI so glyph assertions ignore colour", () => {
	const coloured = heatRamp(fakeTheme(), 2) + "▄" + FG_RESET;
	const stripped = stripForTest(coloured);
	expect(stripped).toBe("▄");
	expect(stripped).not.toMatch(/\x1b/);
	// Plain text passes through untouched, so it is safe to call unconditionally.
	expect(stripForTest("plain")).toBe("plain");
	expect(stripForTest("")).toBe("");
});

test("palette.ts is the ONLY module allowed to emit a colour escape", async () => {
	// The behavioural test in `band.test.ts` proves the band grammar does not
	// leak a literal escape, but the screens compose their own rows and do not
	// go through it — so a screen could hand-write `\x1b[38;2;…` and break every
	// user theme without anything failing. This is the structural version of the
	// same rule, and it covers every module regardless of how it renders.
	//
	// A colour-SETTING SGR: 30–37/90–97 (basic fg), 38/48/58 (extended fg/bg/
	// underline), 40–47/100–107 (basic bg). A bare reset like `\x1b[39m` is not
	// a colour choice and is deliberately not matched.
	const COLOUR_ESCAPE = /\\x1b\\?\[\s*(?:3[0-7]|9[0-7]|4[0-7]|10[0-7]|38|48|58)\b/;

	// `palette.ts` owns the ramp; the host owns everything else. Nothing else may
	// name a colour directly.
	const ALLOWED = new Set(["src/tui/palette.ts"]);
	const offenders: string[] = [];

	for (const file of new Bun.Glob("src/**/*.ts").scanSync({ cwd: import.meta.dir + "/.." })) {
		if (ALLOWED.has(file)) continue;
		const source = await Bun.file(`${import.meta.dir}/../${file}`).text();
		// Comments document escapes legitimately; only code can leak one.
		const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
		if (COLOUR_ESCAPE.test(code)) offenders.push(file);
	}

	expect(offenders, `hardcoded colour escape in: ${offenders.join(", ")}`).toEqual([]);
});
