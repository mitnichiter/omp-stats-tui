import type { ScreenContext } from "./types";
import { glyph } from "../glyphs";

/** The literal marker a human sees on a scaffolded screen. Pinned by test/screens.test.ts. */
export const PLACEHOLDER_MARKER = "placeholder data — not real usage";

/** Longest rule the marker line draws, so a wide terminal does not get a full-bleed divider. */
const RULE_WIDTH = 60;

/**
 * Render a scaffolded screen's sample rows behind the marker.
 * Deliberately never touches ctx.data: selecting a scaffold must issue no fetch.
 */
export function scaffold(
	ctx: ScreenContext,
	icon: string,
	label: string,
	rows: readonly string[],
): readonly string[] {
	const rule = "─".repeat(Math.max(0, Math.min(ctx.width, RULE_WIDTH)));
	return [
		`${icon} ${label}  ${ctx.theme.fg("dim", PLACEHOLDER_MARKER)}`,
		ctx.theme.fg("dim", rule),
		...rows,
	];
}

/**
 * The closing line of every stub. It is load-bearing, not decoration: a stub that
 * ends on its last sample row reads as a complete list, and the user concludes the
 * sample IS the data. This says, in the user's own words, that it is neither the
 * count nor the content.
 */
export function sampleFooter(ctx: ScreenContext, sampleRows: number): string {
	return ctx.theme.fg(
		"dim",
		`  ${sampleRows} sample rows above are an example layout — an unknown number of real rows would follow`,
	);
}

/**
 * A sample bar of a fixed cell count. Both glyphs measure 1 cell under every
 * preset (glyphs.ts owns that guarantee), so padding by character count is the
 * same as padding by cells.
 */
export function sampleBar(ctx: ScreenContext, share: number, cells = 20): string {
	const drawn = Math.max(0, Math.min(cells, Math.round(share * cells)));
	return glyph(ctx.preset, "barFill")
		.repeat(drawn)
		.padEnd(cells, glyph(ctx.preset, "barEmpty"));
}

/**
 * A screen that was deliberately not ported. It renders the reason and nothing
 * else: no marker (there is no fake data here to disclaim) and no fetch.
 */
export function excluded(
	ctx: ScreenContext,
	icon: string,
	label: string,
	reason: string,
): readonly string[] {
	const rule = "─".repeat(Math.max(0, Math.min(ctx.width, RULE_WIDTH)));
	return [
		`${icon} ${label}  ${ctx.theme.fg("dim", "excluded from the port")}`,
		ctx.theme.fg("dim", rule),
		`  ${reason}`,
	];
}
