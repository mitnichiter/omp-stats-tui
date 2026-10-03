import { colorLuma, hexToRgb, rgbToHex } from "@oh-my-pi/pi-utils";
import { colorToAnsi } from "@oh-my-pi/pi-tui/theme/color";
import type { SymbolPreset } from "@oh-my-pi/pi-tui/theme/symbols";
import type { ThemeColor } from "@oh-my-pi/pi-tui/theme/schema";

/**
 * The colour layer.
 *
 * Every colour in the panel is a NAMED omp theme token, never a literal hex.
 * That is the whole point: the user asked for colours that "follow the omp
 * colour scheme", and a theme is a user's chosen set of hues. A hardcoded
 * `#f068c8` would look identical to the web dashboard today and wrong the moment
 * anyone switches theme — which is precisely the cohesion failure we are
 * avoiding. Resolving a token costs a lookup and inherits every future theme.
 *
 * The theme arrives INJECTED. The `theme` singleton throws when an extension
 * imports it at module scope, and reading it at import time would freeze the
 * colours of whichever theme happened to be active while this module loaded.
 */

/** The slice of omp's `Theme` this module needs. Narrow on purpose — it is the
 * whole dependency, and it makes tests injectable without building a Theme. */
export interface PaletteTheme {
	getColorHex(color: ThemeColor): string;
	getColorMode(): "truecolor" | "256color";
	getSymbolPreset(): SymbolPreset;
}

export type PaletteRole =
	| "primary"
	| "negative"
	| "positive"
	| "heading"
	| "label"
	| "meta"
	| "muted"
	| "dim"
	| "heat0"
	| "heat1"
	| "heat2"
	| "heat3";

/**
 * Role → theme token.
 *
 * Each entry cites the colour role it stands in for, taken from the omp stats
 * web dashboard's own CSS custom properties (`client/styles.css`:
 * `--accent`, `--ok`, `--warn`, and its error colour) or from the equivalent
 * role in the TUI's `/usage` dashboard.
 */
export const PALETTE = {
	/**
	 * `accent` — the one number a screen is about. Matches `--accent` in the web
	 * dashboard, and `theme.fg("accent", …)` in `/usage`'s Activity heading
	 * (`usage-dashboard.ts:847`), so the TUI and web views agree on what the
	 * important number looks like.
	 */
	primary: "accent",

	/**
	 * `error` — errors, failures and unpriced rows. The web dashboard paints
	 * failures with its error colour; omp already routes tool failures and error
	 * text through `theme.fg("error", …)`, so a failed request looks the same here
	 * as it does in a transcript.
	 */
	negative: "error",

	/**
	 * `success` — savings and successes. The web dashboard's `--ok`
	 * (`#3ecf8e` dark / `#12a36b` light). Distinct from `warning`, so a saving
	 * never reads as a caution.
	 */
	positive: "success",

	/** `mdHeading` — screen titles. Matches markdown headings in chat, so a
	 * titled stats screen reads as a heading by the same visual rule. */
	heading: "mdHeading",

	/** `text` — ordinary labels beside values. The default body colour, so a
	 * label is never dimmer than the number it describes. */
	label: "text",

	/** `muted` — secondary metadata: timestamps, "since", units. Present but
	 * deliberately not competing with the data. */
	meta: "muted",

	/** `muted` — chrome that should recede entirely (empty states, separators).
	 * Same token as `meta` on purpose: the distinction a designer would draw here
	 * is not one a user can see at terminal font sizes, and two names for one
	 * colour invites them to drift apart. */
	muted: "muted",

	/** `dim` — the quietest ink: hints, "no data", axis labels. Below `muted` so a
	 * hint is never mistaken for content. */
	dim: "dim",

	/**
	 * Heatmap ladder, `heat0` (least) → `heat3` (most). These tokens are the
	 * *semantic* level; the actual cell colour comes from {@link heatRamp}, which
	 * interpolates from the theme's background toward the accent exactly as
	 * `/usage` does. They exist so a level always resolves to a valid token even
	 * on a theme where the ramp collapses, and so screens can name a level
	 * without hardcoding an index.
	 */
	heat0: "borderMuted",
	heat1: "borderAccent",
	heat2: "mdLink",
	heat3: "accent",
} as const satisfies Record<PaletteRole, ThemeColor>;

/**
 * Categorical series colours, in preference order.
 *
 * This is deliberately omp's OWN ordering, taken from
 * `pi-tui/src/chrome/segment-track.ts` (`SEGMENT_COLOR_CANDIDATES`), which is
 * the closest thing the TUI has to a chart palette: the plan-mode model-tier
 * slider and the ctrl+p role cycle both colour by position from this list, so
 * reusing it means a chart series and a status segment share a hue identity.
 * Inventing a private palette here is exactly the divergence the user is
 * objecting to.
 *
 * `segment-track.ts` notes that themes alias many of these to one hue (its
 * `titanium` theme maps most of the syntax set onto its accent), which is why
 * {@link resolveSeries} dedupes by resolved colour rather than trusting the list.
 */
export const SERIES_COLORS: readonly ThemeColor[] = [
	"accent",
	"success",
	"warning",
	"error",
	"mdCode",
	"mdLink",
	"syntaxString",
	"syntaxKeyword",
	"syntaxFunction",
	"syntaxNumber",
	"syntaxOperator",
	"syntaxVariable",
];

/**
 * Resolve `count` series colours under the active theme, deduping by the colour
 * actually rendered so adjacent series stay distinguishable on themes that alias
 * tokens together. Wraps by modulo when more series are requested than the theme
 * can distinguish, and never returns an empty palette — `accent` always resolves.
 * Mirrors `resolveSegmentPalette` in `chrome/segment-track.ts`.
 */
export function resolveSeries(count: number, theme: PaletteTheme): ThemeColor[] {
	const palette: ThemeColor[] = [];
	const seen = new Set<string>();
	for (const color of SERIES_COLORS) {
		const key = theme.getColorHex(color);
		if (seen.has(key)) continue;
		seen.add(key);
		palette.push(color);
		if (palette.length >= count) break;
	}
	if (palette.length === 0) palette.push("accent");
	// Modulo-wrap so a 12-series chart is answerable even on a monochrome theme.
	while (palette.length < count) palette.push(palette[palette.length % palette.length]);
	return palette.slice(0, count);
}

/**
 * Fractional stops for the four heat levels, lowest first. Copied from
 * `/usage`'s `#heatRamp` (`overlays/usage-dashboard.ts:812`), where level 1 sits
 * near-invisible against the background and level 4 is the full accent, so cell
 * brightness reads as amount of work.
 */
const HEAT_STOPS = [0.3, 0.5, 0.72, 1] as const;

/**
 * The foreground colour for heatmap level `level` (0–3), as an ANSI escape.
 *
 * Ported from `/usage`'s `#heatRamp`: blend a near-background anchor toward the
 * theme accent at four fixed stops. The anchor is chosen by the luma of the
 * theme's `text` colour so the ramp keeps its direction on light themes — a
 * ramp that always starts from dark would run "up" into a white background and
 * invert the meaning of every cell.
 *
 * Always routed through `colorToAnsi(hex, theme.getColorMode())`. `detectColorMode`
 * returns `"256color"` on any terminal without truecolor, and never a 16-colour
 * mode, so the terminal's own palette quantises our blend. Assuming truecolor
 * here would emit `38;2;…` sequences that render as garbage on those terminals.
 */
export function heatRamp(theme: PaletteTheme, level: number): string {
	const t = HEAT_STOPS[Math.max(0, Math.min(HEAT_STOPS.length - 1, Math.round(level)))];
	// `(colorLuma(...) ?? 1)` mirrors `/usage`: an unresolvable text colour is
	// assumed to sit on a dark background, the common case.
	const darkBackground = (colorLuma(theme.getColorHex("text")) ?? 1) > 0.5;
	const from = darkBackground ? { r: 20, g: 20, b: 24 } : { r: 244, g: 244, b: 246 };
	const to = hexToRgb(theme.getColorHex("accent"));
	return colorToAnsi(
		rgbToHex({
			r: Math.round(from.r + (to.r - from.r) * t),
			g: Math.round(from.g + (to.g - from.g) * t),
			b: Math.round(from.b + (to.b - from.b) * t),
		}),
		theme.getColorMode(),
	);
}

/**
 * Remove ANSI SGR sequences so a test can assert on glyphs independently of
 * colour. Matches CSI sequences ending in a letter, which covers every SGR
 * (`38;5;n`, `38;2;r;g;b`, `39`) without swallowing the printable text between
 * them.
 */
export function stripForTest(text: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: matching SGR is the point
	return text.replace(/\x1b\[[0-9;]*m/g, "");
}
