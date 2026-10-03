/**
 * heatmap-ink — the calendar-heatmap cell decision, rendered so a human can
 * look at it instead of argue about it.
 *
 * WHY: F19 argued from ink-coverage measurements that U+2588 FULL BLOCK beats
 * U+25A0 BLACK SQUARE for the filled cell, because a square covers roughly 60%
 * of its cell and the uncovered part becomes a gutter between neighbours. That
 * argument is only worth anything if the eye agrees, so this module renders the
 * SAME week grid under each candidate and lets the terminal be the judge.
 *
 * Pure: no colour-capability probing, no terminal query, no I/O. Colour is an
 * injected boolean, matching `glyph-width.ts`'s injected measurer, so a test can
 * assert the rendered text without depending on the machine's SGR support.
 */

/** Three-letter month names, sized to the label row. */
export const MONTHS = [
	"Jan", "Feb", "Mar", "Apr", "May", "Jun",
	"Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/**
 * One cell of activity. `null` is ABSENT (a future date) and is deliberately
 * distinct from `0` (a real day with no activity) — collapsing the two would
 * report unspent money as spent.
 */
export type HeatCell = number | null;

/** Seven weekday rows, each holding one entry per week column. */
export type HeatMatrix = readonly (readonly HeatCell[])[];

/**
 * The glyph.ts role this variant plugs into. Every candidate writes the same two
 * roles, which is the entire point: the swap is a table edit, not a code change.
 */
export const HEAT_ROLES = {
	ladder: "heatCell",
	empty: "heatEmpty",
} as const;

export interface HeatVariant {
	/** Stable key, used for lookup and for naming the probe flag. */
	id: string;
	/** Human label printed above the grid. */
	label: string;
	/** Role in `src/tui/glyphs.ts` that this variant's ladder replaces. */
	glyphsRole: string;
	/** Role that supplies the zero-activity cell. */
	emptyRole: string;
	/** Level 1..4 glyphs. */
	ladder: readonly string[];
	/** Level 0 glyph — a present day with no activity. */
	empty: string;
	/**
	 * Exactly what has to change in `src/tui/glyphs.ts` to adopt this variant.
	 * Rendered verbatim, so the probe cannot overstate how easy the swap is.
	 */
	switchNote: string;
}

/**
 * The three candidates, in the order F19 discusses them.
 *
 * `unicode-square` and `unicode-block` are the SAME encoding — one glyph, level
 * carried by truecolor foreground — differing only in which glyph that is. That
 * is the F19 claim under test: full-bleed U+2588 versus ~60%-coverage U+25A0.
 * `unicode-shade` is the fallback F17 recommends keeping, where the glyph
 * itself carries the level and colour is decoration.
 */
export const HEAT_VARIANTS: readonly HeatVariant[] = [
	{
		id: "unicode-square",
		label: "A  ■  U+25A0 BLACK SQUARE  + colour",
		glyphsRole: HEAT_ROLES.ladder,
		emptyRole: HEAT_ROLES.empty,
		ladder: ["■", "■", "■", "■"],
		empty: "·",
		switchNote: 'heatCell: ["■", "■", "■", "■"],   // U+25A0 ×4',
	},
	{
		id: "unicode-block",
		label: "B  █  U+2588 FULL BLOCK   + colour",
		glyphsRole: HEAT_ROLES.ladder,
		emptyRole: HEAT_ROLES.empty,
		ladder: ["█", "█", "█", "█"],
		empty: "·",
		switchNote: 'heatCell: ["█", "█", "█", "█"],   // U+2588 ×4',
	},
	{
		id: "unicode-shade",
		label: "C  ░▒▓█  shade ramp, colour optional",
		glyphsRole: HEAT_ROLES.ladder,
		emptyRole: HEAT_ROLES.empty,
		ladder: ["░", "▒", "▓", "█"],
		empty: "·",
		switchNote: 'heatCell: ["░", "▒", "▓", "█"],   // U+2591 U+2592 U+2593 U+2588  (ALREADY SHIPPED)',
	},
] as const;

/**
 * Lookup by id. Static string keys, so this is a plain Record rather than a
 * Map — nothing here is inserted or deleted at runtime.
 */
export const HEAT_VARIANT_BY_ID: Record<string, HeatVariant> = Object.fromEntries(
	HEAT_VARIANTS.map((v) => [v.id, v]),
);

/** Remove CSI/SGR escapes so text can be compared to its painted form. */
export function stripAnsi(text: string): string {
	// eslint-disable-next-line no-control-regex
	return text.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Width in terminal cells, ignoring the escapes that carry no width. */
export function visibleWidth(text: string): number {
	return Bun.stringWidth(stripAnsi(text));
}

/**
 * Grid width: a label gutter plus two cells per week column.
 *
 * Two, not one, because `heatmap.ts` sets `columnWidth = 2` — one glyph plus a
 * trailing space — so the rows line up in a proportional-ish font. Matching that
 * here matters: a probe that renders cells edge to edge would be judging a
 * layout the panel does not actually use.
 */
export function gridWidth(weeks: number, labelWidth: number): number {
	return Math.max(0, labelWidth) + Math.max(0, weeks) * 2;
}

/**
 * Column-major flat cells (week 0 days 0-6, then week 1) into seven weekday
 * rows, matching `buildHeatmapLayout`'s `cells[dayIndex][weekIndex]` order.
 */
export function buildMatrix(cells: readonly HeatCell[], weeks: number): HeatMatrix {
	const width = Math.max(0, weeks);
	return Array.from({ length: 7 }, (_, day) =>
		Array.from({ length: width }, (_, week) => {
			const index = week * 7 + day;
			return index < cells.length ? (cells[index] ?? null) : null;
		}),
	);
}

/**
 * GitHub-style green ramp, one colour per level.
 *
 * Deliberately NOT derived from the theme: the probe has to compare GLYPHS, and
 * a theme-derived palette would change every time the theme does. These are the
 * four steps that ship in most contribution graphs, so what you see is the
 * density a reader is used to seeing.
 */
const LEVEL_COLOURS: readonly string[] = [
	"\x1b[38;2;14;68;41m",  // level 1 — #0e4429
	"\x1b[38;2;0;109;50m",  // level 2 — #006d32
	"\x1b[38;2;38;166;65m", // level 3 — #26a641
	"\x1b[38;2;57;211;83m", // level 4 — #39d353
];

/** The zero-activity cell: drawn, but never in a level colour. */
const EMPTY_COLOUR = "\x1b[38;2;110;118;129m"; // #6e7681

const FG_RESET = "\x1b[0m";

/** Monday-first, blank on alternate rows so the columns read as pairs. */
export const ROW_LABELS = ["M", "", "W", "", "F", "", ""] as const;

export interface RenderGridOptions {
	variant: HeatVariant;
	/** Width of the weekday-label gutter. */
	labelWidth?: number;
	/** Emit truecolor escapes. Off means the text is directly comparable. */
	colour?: boolean;
	/**
	 * Month label per column; `null` leaves that column's header blank. Written
	 * into a character buffer rather than appended, because a three-character
	 * label in a two-cell column overhangs and would drift every later label one
	 * cell right of the column it names.
	 */
	months?: readonly (string | null)[];
}

/** Render the grid: one month-label row, then seven weekday rows. */
export function renderGrid(matrix: HeatMatrix, opts: RenderGridOptions): string[] {
	const labelWidth = Math.max(0, opts.labelWidth ?? 0);
	const colour = opts.colour ?? false;
	const weeks = matrix[0]?.length ?? 0;
	const width = gridWidth(weeks, labelWidth);

	const header = " ".repeat(Math.max(labelWidth, width)).split("");
	for (const [week, label] of (opts.months ?? []).slice(0, weeks).entries()) {
		if (label == null) continue;
		const at = labelWidth + week * 2;
		for (const [offset, char] of [...label].entries()) {
			if (at + offset < header.length) header[at + offset] = char;
		}
	}

	const body = matrix.map((weekRow, day) => {
		const label = (ROW_LABELS[day] ?? "").padEnd(labelWidth, " ");
		const cells = weekRow.map((cell) => {
			// ABSENT — blank, and deliberately not the empty glyph.
			if (cell == null) return "  ";
			if (cell === 0) {
				const glyph = opts.variant.empty;
				return colour ? `${EMPTY_COLOUR}${glyph}${FG_RESET} ` : `${glyph} `;
			}
			const glyph = opts.variant.ladder[Math.min(cell, opts.variant.ladder.length) - 1] ?? "";
			return colour
				? `${LEVEL_COLOURS[Math.min(cell, LEVEL_COLOURS.length) - 1]}${glyph}${FG_RESET} `
				: `${glyph} `;
		});
		return label + cells.join("");
	});

	return [header.join("").slice(0, width), ...body].map((row) =>
		visibleWidth(row) > width ? row.slice(0, width) : row,
	);
}