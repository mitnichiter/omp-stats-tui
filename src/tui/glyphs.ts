import type { SymbolPreset } from "@oh-my-pi/pi-tui";

// Re-exported so every consumer imports the one type from one place; render code
// should never have to reach into pi-tui for the vocabulary of this module.
export type { SymbolPreset };

/**
 * Roles this module owns. Everything that carries a magnitude in a rendered cell
 * is a GlyphRole; nothing else may branch on the symbol preset.
 */
export type GlyphRole =
	| "barFill"
	| "barEmpty"
	| "sparkRamp"
	| "heatCell"
	| "heatEmpty"
	| "heatMarker"
	| "columnGap"
	| "axisLine"
	| "trendUp"
	| "trendFlat"
	| "trendDown";

/**
 * A role resolves to either a single glyph or, for a ramp, an ordered ladder
 * indexed by level. `glyph()` hides the difference from render code.
 */
export type GlyphValue = string | readonly string[];
export type GlyphSet = Readonly<Record<GlyphRole, GlyphValue>>;

/** Ramp lengths, exported so charts can size a level domain without hardcoding numbers. */
export const HEAT_LEVELS = 4;
export const SPARK_LEVELS = 8;
export const BAR_LEVELS = 8;

/**
 * The unicode ladder. Block elements are font-independent rather than
 * Nerd-specific, so `nerd` reuses this exact object — see SETS below.
 *
 * Every value must measure `Bun.stringWidth === 1`. That is the whole reason
 * this module exists rather than a `theme.symbol()` call: the host registry is a
 * flat `Record<SymbolKey, string>` of 269 keys, none of which is a data-ink
 * ramp, so "the fourth of eight block fills" is inexpressible through it.
 */
const UNICODE_GLYPHS = {
	barFill: "█", // U+2588
	barEmpty: "░", // U+2591
	sparkRamp: ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"], // U+2581..U+2588
// heatCell is ONE square at every level: `/usage` renders levels 1..4 as the
// same ■ with the level carried by the colour alone
// (usage-dashboard.ts:867). A shade ramp here would double-encode the level
// beside the colour and read as a different calendar next to the real one.
heatCell: ["■", "■", "■", "■"], // U+25A0 ×4 — every rung is BLACK SQUARE
	heatEmpty: "·", // U+00B7 — byte-identical to the host's own /usage heatmap
	heatMarker: "□", // U+25A1
	// Bare U+2502, never `theme.symbol("sep.pipe")`: sep.pipe measures 3 cells
	// under unicode/ascii and 1 under nerd, so it would triple the gap on two
	// presets and look correct on the third.
	columnGap: "│", // U+2502 — matches boxRound.vertical
	// The chart baseline, as a MARK rather than a rule.
	//
	// DIVERGENCE FROM THE WEB, deliberate: the web strokes a real `<line>` at
	// y(0) in `--line-3` (Chart.tsx:304). G5 and /usage's zero-rules body forbid
	// a full-width rule here, so we MARK the floor instead of drawing one — and a
	// mark is the better terminal translation anyway, because a rule cannot be
	// distinguished from a section separator. `─`/`━`/`═` would also trip G5's
	// RULE_RUN, and this is deliberately not `sparkRamp[0]`: a floor mark and a
	// sparkline rung are different meanings and should be able to move apart.
	//
	// `_` in EVERY preset, and that is the whole reason it is `_` and not `·`.
	// A baseline belongs at the BOTTOM of the cell; `·` is vertically centred and
	// would float in the middle of the plot. The same argument made ascii `_`
	// rather than a dot, and unicode was simply inconsistent until this line was
	// made to match. It also makes the mark distinct from `heatEmpty` on every
	// preset, which it did not before.
	axisLine: "_", // U+005F
	trendUp: "▲", // U+25B2
	trendFlat: "─", // U+2500
	trendDown: "▼", // U+25BC
} as const satisfies GlyphSet;

/**
 * The ascii ladder. ASCII has no vertical shading, so the spark ramp here is a
 * *ranking* ladder (distinct characters in a fixed order) rather than a density
 * one — an ascii chart gains resolution by stacking rows, never by inventing
 * sub-cell glyphs. heatEmpty is a real blank, which is why the width-1 test
 * carries exactly one documented exception for it.
 */
const ASCII_GLYPHS = {
	barFill: "#", // U+0023 — also omp's own ascii choice for sep.block
	barEmpty: ".",
	sparkRamp: [".", ":", "-", "=", "+", "*", "#", "@"], // 8 distinct rungs
	// Level 1 is "." rather than ":" so the zero cell (heatEmpty, a blank) stays
	// visually distinct from the faintest recorded day.
	heatCell: [".", "-", "+", "#"],
	heatEmpty: " ",
	heatMarker: "o",
	columnGap: "|",
	// The same `_` the unicode set uses, for the same reason: a baseline sits at
	// the bottom of the cell. It is never a blank, or the floor would vanish under
	// ascii entirely.
	axisLine: "_", // U+005F
	trendUp: "^",
	trendFlat: "-",
	trendDown: "v",
} as const satisfies GlyphSet;

/**
 * One lookup, no branching — the module's contract is that this is the ONLY
 * place the symbol preset is consulted. `nerd` is the *same object* as
 * `unicode`, not a copy: no Nerd Font codepoint's semantics is magnitude, so
 * data ink must be byte-identical between the two presets, and sharing the
 * object makes that structural rather than a promise.
 */
const SETS: Record<SymbolPreset, GlyphSet> = {
	unicode: UNICODE_GLYPHS,
	nerd: UNICODE_GLYPHS,
	ascii: ASCII_GLYPHS,
};

export function glyphsFor(preset: SymbolPreset): GlyphSet {
	return SETS[preset];
}

/**
 * Resolve one glyph, clamping `level` into the ramp.
 *
 * Clamping rather than throwing is deliberate: a level is computed from a ratio
 * over live data, so an out-of-range value is an ordinary edge case (a first-ever
 * run, a degenerate bucket) and must not be able to crash a render pass.
 */
export function glyph(preset: SymbolPreset, role: GlyphRole, level = 0): string {
	const value = glyphsFor(preset)[role];
	if (typeof value === "string") return value;
	const clamped = Math.max(0, Math.min(value.length - 1, Math.round(level)));
	return value[clamped] ?? value[0];
}