/**
 * Cell-width measurement and assertion for glyph candidates.
 *
 * WHY: pi-tui lays rows out by `Bun.stringWidth`, and any candidate that
 * measures 2 in a repeated data position silently doubles that cell and
 * misaligns the whole row — the failure looks like a rendering bug, not a glyph
 * bug. Emoji are the measured offenders (`🪙` U+1FA99 = 2, `⬛` U+2B1B = 2)
 * while block/shade/box characters are all 1.
 *
 * Pure: the measuring function takes an injected measurer, so tests can assert
 * the *reporting* logic without depending on this machine's terminal tables.
 */

/** A glyph the caller intends to place in some cell position. */
export interface GlyphSample {
	preset: string;
	/** Dot-separated role path, e.g. `sparkRamp[3]` or `sep.pipe`. */
	role: string;
	glyph: string;
	/**
	 * True when the glyph is repeated across a row or column. Data ink always
	 * is; a section-heading icon never is, which is why icons may be 2 cells.
	 */
	dataInk: boolean;
}

export interface WidthViolation {
	sample: GlyphSample;
	width: number;
	reason: string;
}

export type Measurer = (glyph: string) => number;

/** Lowercase hex codepoints, so `⚠` and `⚠️` are visibly different rows. */
export function codepoints(glyph: string): string {
	return [...glyph]
		.map((ch) => (ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0"))
		.join(" ");
}

/**
 * Every data-ink sample that is not exactly one cell wide.
 *
 * A single space measures 1 — it occupies a cell even though it carries no
 * magnitude — so the ASCII `heatEmpty` blank passes this check. A zero width
 * only happens for the empty string, which is caught here because an empty
 * ramp step shrinks every row it appears in.
 */
export function findWidthViolations(samples: readonly GlyphSample[], measure: Measurer): readonly WidthViolation[] {
	return samples
		.filter((s) => s.dataInk)
		.map((s) => ({ sample: s, width: measure(s.glyph) }))
		.filter(({ width }) => width !== 1)
		.map(({ sample, width }) => ({
			sample,
			width,
			reason:
				width === 0
					? "data ink measured 0 cells — a blank cannot carry a magnitude"
					: `data ink measured ${width} cells — repeat it and the row misaligns by ${width - 1}`,
		}));
}

/**
 * The two traps F14 measured, encoded so a future edit that reintroduces them
 * fails loudly instead of shipping as a one-cell misalignment.
 */
export const KNOWN_TRAPS = {
	/** `" │ "` is 3 cells under unicode/ascii and only 1 under nerd. */
	sepPipe: { padded: " │ ", bare: "│" },
	/** `⚠️` (U+26A0 + VS16) is 2 cells; bare `⚠` (U+26A0) is 1. */
	warningWithVariationSelector: "⚠️",
	warningBare: "⚠",
} as const;


function padEnd(value: string, width: number): string {
	return value.length >= width ? value : value + " ".repeat(width - value.length);
}

export function formatGlyphTable(samples: readonly GlyphSample[], measure: Measurer): readonly string[] {
	const rows = samples.map((s) => [
		s.preset,
		s.role,
		s.glyph,
		codepoints(s.glyph),
		String(measure(s.glyph)),
		s.dataInk ? "data" : "chrome",
	]);

	const headers = ["preset", "role", "glyph", "codepoint", "width", "kind"];
	const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));

	return [
		headers.map((h, i) => padEnd(h, widths[i])).join("  ").trimEnd(),
		widths.map((w) => "-".repeat(w)).join("  "),
		...rows.map((r) => r.map((c, i) => padEnd(c, widths[i])).join("  ").trimEnd()),
	];
}
