/**
 * The band grammar — the single place a screen body is composed.
 *
 * THE PROBLEM THIS FIXES. The panel read as a stack of text blocks with a
 * `───` rule above every section, which is what a terminal looks like when each
 * screen invented its own structure. `/usage` draws ZERO rules inside its body.
 * F21 found exactly four band shapes in the web dashboard; F23 turned them into
 * six invariants (G1–G6) that a renderer can follow without making a layout
 * decision. This module IS that renderer.
 *
 * ── The invariants, and why each exists ─────────────────────────────────────
 *
 * **G1 — a band is a heading line plus body lines.** The heading is omitted for
 * `statRow` and `note` (G3) and present for `chart`, `table`.
 *
 * **G2 — the heading is** `` `${icon} ${boldAccent(title)}` `` with, when meta
 * exists, `  ${dim(meta)}` appended on THE SAME LINE. Never a rule.
 *
 * **G3 — `statRow` and `note` have no heading and no icon.** They are the page's
 * first line and its inline caveat, mirroring F21's `StatGrid` sitting directly
 * under `PageHeader` and the web's prose caveats (`CostsRoute.tsx:77`).
 *
 * **G4 — exactly one blank line between consecutive bands.** No leading blank,
 * no trailing blank, no doubles. A band that renders nothing contributes
 * nothing and leaves no gap.
 *
 * **G5 — NO BAND BODY MAY EMIT A FULL-WIDTH RULE.** This is the invariant that
 * kills the complaint, and the reason this module exists at all. `─`, `━` or `═`
 * inside a band is a bug, full stop. F23 §2.2: "This is the single invariant
 * that kills the complaint." Do NOT reintroduce a rule as a section separator —
 * that is the exact regression being fixed. `test/band.test.ts` asserts it
 * literally against a rule-character pattern for every band kind and every
 * preset, so a rule cannot come back quietly.
 *
 * **G6 — the only rule in the whole panel is the `PanelDivider` between body and
 * footer**, exactly as `usage-dashboard.ts:573` has exactly one.
 *
 * `legend` is the deliberate exception to G4: in the web a legend lives INSIDE
 * the chart card, directly beneath it (`OverviewRoute.tsx:181-244`). So it is a
 * continuation — no heading, no blank line before, one after.
 *
 * ── Why `bands` is a parameter and not part of `ScreenContext` ──────────────
 * F23's seam is deliberate. Putting presentation on the data contract would let
 * any screen bypass the grammar by returning pre-rendered lines — which is the
 * exact failure being fixed. `ScreenContext` is deliberately NOT extended; bands
 * are passed in beside it.
 *
 * ── Why the types below are declared here and not imported ─────────────────
 * `src/layout/spec.ts` is owned by another agent and is in flux, so importing
 * from it would make this file's compilation depend on their schedule. The
 * shapes below are MINIMAL STRUCTURAL mirrors of the IR's union: same fields,
 * same discriminants, no extra constraint, so they are assignable in both
 * directions and the two definitions can be reconciled without churn.
 */

import type { ThemeColor } from "@oh-my-pi/pi-tui";
import { truncateToWidth, visibleWidth } from "@oh-my-pi/pi-tui/utils";
import { formatPercent } from "./format";
import { glyph, type GlyphSet, type SymbolPreset } from "./glyphs";
import { statsIcon, type IconRole } from "./icons";
import { PALETTE, SERIES_COLORS } from "./palette";

// ─── Minimal structural types (mirror the IR; see the header note) ───────────

export interface StatTile {
	label: string;
	/** Pre-formatted. Numbers become strings via the caller's `read`, never here. */
	value: string;
	/** Only when the whole hint fits; dropped rather than truncated (see below). */
	hint?: string;
	emphasis?: "primary" | "normal";
	/** Render a sparkline under the tile, only when columns <= 2. */
	spark?: readonly number[];
}

export interface ChartSpec {
	type: "bars" | "heatmap" | "sparkline" | "rankedBars" | "shareBar";
	/** Human bucket label; becomes the heading meta when `source` is absent. */
	axis?: string;
	render: () => readonly string[];
}
export interface Column {
	key: string;
	header: string;
	align: "left" | "right";
	cell?: "text" | "meter" | "badge";
}

export type RowSource =
	| { kind: "inline"; rows: readonly Record<string, string>[] }
	| { kind: "series"; series: readonly Record<string, string>[] };

export interface LegendItem {
	label: string;
	share: number;
}

export type Band =
	| { kind: "statRow"; stats: readonly StatTile[] }
	| { kind: "chart"; title: string; chart: ChartSpec; source?: string; preset?: SymbolPreset }
	| { kind: "table"; title: string; columns: readonly Column[]; rows: RowSource; source?: string }
	| { kind: "legend"; items: readonly LegendItem[]; source?: string }
	| { kind: "note"; text: string }
	| {
			kind: "custom";
			id: string;
			/** The screen's own render, treated as one band's body. Temporary. */
			render: (ctx: BandRenderOptions) => readonly string[];
	  };

// ─── Colour ──────────────────────────────────────────────────────────────────

/**
 * Colour comes from `palette.ts`, never from tokens chosen here.
 *
 * `PALETTE` is the one place that decides what a colour ROLE means, and each of
 * its entries already cites the web dashboard CSS variable or the `/usage`
 * equivalent it stands in for. A screen that hardcodes its own tokens is the
 * drift this whole refactor exists to prevent — so `band.ts` names roles
 * ("primary", "meta", "dim") and never tokens.
 *
 * Note the deliberate collapse inside `PALETTE`: `meta` and `muted` both
 * resolve to the `muted` token. Do NOT "fix" that. Two names for one colour
 * invite them to drift apart, and at terminal font sizes the distinction a
 * designer would draw is invisible.
 */

/**
 * The colour of the Nth chart series. Cycling `SERIES_COLORS` means a chart
 * series and an omp status segment share a hue identity, because both are drawn
 * from the same list.
 */
function seriesToken(ctx: BandRenderOptions, index: number): ThemeColor {
	return ctx.seriesColorFor?.(index) ?? SERIES_COLORS[index % SERIES_COLORS.length];
}

export interface BandRenderOptions {
	/** Outer width. No rendered row may exceed it. */
	width: number;
	/** Content width after the panel's side insets. Charts size against this. */
	innerWidth: number;
	preset: SymbolPreset;
	glyphs: GlyphSet;
	/**
	 * The theme's own `fg`, passed in rather than read from the singleton —
	 * `theme` is undefined until theme init runs (AGENTS.md), so importing it at
	 * module scope crashes at extension load. Every colour this module emits
	 * goes through here with a NAMED `ThemeColor` token.
	 *
	 * NEVER a raw hex and never a hand-written escape sequence: hardcoding a
	 * colour would break every user theme and the panel would stop looking like
	 * part of omp. `test/band.test.ts` asserts no literal colour escapes.
	 */
	fg: (color: ThemeColor, text: string) => string;
	/** The theme's `bold`. Weight is an emphasis, not a colour. */
	bold: (text: string) => string;
	/**
	 * Series colours for multi-series charts, already resolved to theme tokens
	 * by the caller. Web parity: the dashboard assigns hues by RANK
	 * (`buildColorLookup`), so the same key keeps the same hue across charts.
	 */
	seriesColorFor?: (index: number) => ThemeColor;
	barHeight: number;
	/** Max data rows in a table before rows are dropped and counted. */
	tableLimit: number;
	labelWidth: number;
	valueWidth: number;
	/**
	 * `renderSparkline`, injected rather than imported. F23 §2.3 asks for a trend
	 * line under a tile and the grammar must own WHERE it goes; importing the
	 * chart here would make the band layer depend on the chart layer, which is the
	 * dependency direction the whole refactor exists to remove.
	 */
	sparkline?: (values: readonly number[], width: number) => string;
}

/** Stat tiles are laid out in fixed columns this wide (F23 §2.3). */
const TILE_WIDTH = 34;
/** The icon each headed band kind carries (F23 §2.3). */
const BAND_ICONS: Record<"chart" | "table", IconRole> = { chart: "time", table: "requests" };

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Clamp to a width, measured — never by `.length`, which is wrong for ANSI. */
function clamp(text: string, width: number): string {
	if (width <= 0) return "";
	return visibleWidth(text) > width ? truncateToWidth(text, width) : text;
}

/** Pad on the right to exactly `width` cells, where the text is short enough. */
function padEndTo(text: string, width: number): string {
	const gap = width - visibleWidth(text);
	return gap > 0 ? text + " ".repeat(gap) : text;
}

function padStartTo(text: string, width: number): string {
	const gap = width - visibleWidth(text);
	return gap > 0 ? " ".repeat(gap) + text : text;
}

// ─── Per-kind layout, as F23 §2.3 determines it ──────────────────────────────

/**
 * `statRow` — tiles in fixed columns, each tile STACKED.
 *
 * F23 §2.3 fixes the column maths: `columns = clamp(floor(innerWidth / 34), 1, 3)`.
 * The LAYOUT within a tile is the web's, not F23's, and F23's `label.padEnd +
 * value` is what produced the defect a reader can see in the probe: a label
 * longer than the pad width ran straight into its value, printing
 * `API-equivalent cost$112.36` as one word.
 *
 * The web's `Stat` puts the label on its own line above the value
 * (`Stat.tsx`: `.stat-label`, `.stat-value`, `.stat-foot`). That is the shape
 * copied here, and it fixes THREE things at once:
 *
 *  1. **D1, the gutter.** A label can be any length and still never touch its
 *     value, because they are on different rows. No pad width can promise that
 *     — `LABEL_WIDTH` is 12 and "API-equivalent cost" is 18.
 *  2. **D2, one value per tile.** The hint was being appended INLINE, so a tile
 *     read `Requests 65,460 1,315`: two figures, one cell, and nothing in the
 *     layout to say which was the measurement and which was the caveat. On its
 *     own row the hint is unambiguously secondary — exactly as `.stat-foot` is.
 *  3. **Room for a sparkline.** F23 §2.3 asks for `renderSparkline` under the
 *     tile when `columns <= 2`; it had nowhere to go.
 *
 * The F23 rules that survive unchanged, and are still load-bearing:
 *   - a hint is DROPPED rather than truncated ("a half-printed '34,870 unpr' is
 *     a worse claim than no hint", F23 §2.3 rule 2);
 *   - the VALUE is truncated and the LABEL never is ("a truncated label is
 *     still a label", F23 §2.3 rule 3);
 *   - `emphasis: "primary"` is bold + accent, the web's larger first tile.
 */
function renderStatRow(stats: readonly StatTile[], ctx: BandRenderOptions): readonly string[] {
	if (stats.length === 0) return [];

	const inner = Math.max(1, ctx.innerWidth);
	const columns = Math.max(1, Math.min(3, Math.floor(inner / TILE_WIDTH)));
	const tileWidth = Math.floor(inner / columns);
	const sparkWidth = Math.max(0, tileWidth - 1);
	const sparkVisible = columns <= 2;
	const lines: string[] = [];

	for (let start = 0; start < stats.length; start += columns) {
		const tiles = stats.slice(start, start + columns);
		// One row of slots PER TILE ROW. A shared set of slots across every tile row
		// would append each row's tiles onto the previous row's, so a five-tile
		// statRow rendered three tiles and silently dropped the other two.
		const slots: string[][] = [[], [], [], []];

		for (const tile of tiles) {
			// Rule 3: the LABEL is never truncated — "a truncated label is still a
			// label" (F23 §2.3). On its own row it cannot collide with the value,
			// which is what D1 was.
			slots[0].push(padEndTo(clamp(ctx.fg(PALETTE.label, tile.label), tileWidth), tileWidth));

			let value = ctx.fg(PALETTE.label, tile.value);
			if (tile.emphasis === "primary") value = ctx.bold(ctx.fg(PALETTE.primary, value));
			// The VALUE truncates, because it is the thing that can lose precision
			// least legibly.
			slots[1].push(padEndTo(clamp(value, tileWidth), tileWidth));

			// Rule 2: the whole hint or nothing. A hint is prose, so `dim`, and it
			// lives on its OWN row — inline it read as a second value (D2).
			const hint = tile.hint ? ctx.fg(PALETTE.dim, tile.hint) : "";
			slots[2].push(padEndTo(visibleWidth(hint) <= tileWidth ? hint : "", tileWidth));

			// F23 §2.3: a sparkline under the tile, only when it will not be a
			// 34-cell smear. Injected, so this module keeps no chart dependency.
			slots[3].push(
				padEndTo(
					tile.spark && sparkVisible && sparkWidth > 0
						? (ctx.sparkline ?? (() => ""))(tile.spark, sparkWidth)
						: "",
					tileWidth,
				),
			);
		}

		const rows = slots.map(cells => clamp(cells.join("  "), ctx.width).trimEnd());
		// Drop ALL trailing blank slot-rows, never an interior one. Dropping only
		// the last left the hint row blank when there was no hint, and G4 then
		// added its own separator — two consecutive blanks, reading as a section
		// break that is not there.
		let end = rows.length;
		while (end > 0 && rows[end - 1].trim() === "") end--;
		lines.push(...rows.slice(0, end));
	}
	return lines;
}

/**
 * `chart` — heading, then the chart's own rows verbatim. Zero rows of overhead:
 * the chart contributes only its marks (F23 §2.3).
 */
function renderChart(band: Extract<Band, { kind: "chart" }>, ctx: BandRenderOptions): readonly string[] {
	const preset = band.preset ?? ctx.preset;
	// `source` wins; otherwise state the axis, which is what the web puts in
	// the card description ("Per hour", "Per UTC day"). Stating it beats a chart
	// that silently picks one (F23 §2.3).
	const meta = band.source ?? band.chart.axis ?? "";
	const body = band.chart.render().map((row) => clamp(row, ctx.innerWidth));
	return body.length === 0 ? [] : [heading(BAND_ICONS.chart, band.title, meta, preset, ctx), ...body];
}

/** `table` — heading, header row, data rows, count note when rows were dropped. */
function renderTable(band: Extract<Band, { kind: "table" }>, ctx: BandRenderOptions): readonly string[] {
	const all = band.rows.kind === "inline" ? band.rows.rows : band.rows.series;
	if (band.columns.length === 0 || all.length === 0) return [];

	const shown = all.slice(0, ctx.tableLimit);
	const labelCol = Math.min(
		Math.max(...band.columns.map((c) => c.header.length)),
		Math.max(0, ctx.innerWidth - 4),
	);

	const line = (cells: readonly string[], style: (t: string) => string): string =>
		clamp(
			cells
				.map((cell, i) => {
					if (!band.columns[i]) return cell ?? "";
					// The label column is padded; numeric columns are right-aligned
					// so their digits line up down the table. `style` is applied to
					// the TEXT only, never to the padding — padding inside a colour
					// span would tint the whole column gutter.
					const text = style(cell ?? "");
					return i === 0 ? padEndTo(text, labelCol) : padStartTo(text, ctx.valueWidth);
				})
				.join(" "),
			ctx.width,
		);

	const header = line(
		band.columns.map((c) => c.header),
		(t) => ctx.fg(PALETTE.muted, t),
	);
	// Data cells take DEFAULT TEXT explicitly rather than being left uncoloured:
	// the rule is "not dimmed", and naming the token keeps the table inside the
	// user's theme instead of inheriting whatever the terminal happens to
	// default to.
	const body = shown.map((r) =>
		line(
			band.columns.map((c) => String(r[c.key] ?? "")),
			(t) => ctx.fg(PALETTE.label, t),
		),
	);

	const note =
		shown.length < all.length
			? [clamp(ctx.fg(PALETTE.dim, `${shown.length} of ${all.length}`), ctx.width)]
			: [];

	return [
		heading(BAND_ICONS.table, band.title, band.source ?? "", ctx.preset, ctx),
		header,
		...body,
		...note,
	];
}

/**
 * `legend` — a CONTINUATION, not a band: no heading and no blank line before it
 * (G4's one deliberate exception), because in the web a legend lives inside the
 * chart card, directly beneath it (`OverviewRoute.tsx:181-244`). A terminal that
 * put a gap there would be reading the source less carefully than the browser
 * did (F23 §2.2).
 *
 * Shares sit in a fixed right-hand column so the decimal points line up.
 *
 * The swatch is ONE glyph. Two was a bar, not a key: the reader saw a magnitude
 * where the web's `.swatch` shows a single coloured square, and the extra cell
 * pushed the label one column right of where the chart's own row put it. The
 * COLOUR is what identifies the series; the glyph only has to exist.
 */
function renderLegend(band: Extract<Band, { kind: "legend" }>, ctx: BandRenderOptions): readonly string[] {
	if (band.items.length === 0) return [];
	const labelWidth = Math.max(...band.items.map((i) => i.label.length));
	const SHARE_COL = 7;

	return band.items.map((item, index) => {
		// Each swatch wears its OWN series colour, so a legend key is the same
		// hue as its series elsewhere on the page — the web's `Legend` and ours
		// are the same object for exactly this reason.
		const swatch = ctx.fg(seriesToken(ctx, index), glyph(ctx.preset, "barFill"));
		const label = ctx.fg(PALETTE.muted, padEndTo(item.label, labelWidth));
		const share = padStartTo(formatPercent(item.share), SHARE_COL);
		return clamp(`${swatch} ${label} ${share}`, ctx.width).trimEnd();
	});
}

/** `note` — one dim line. Where "this is not a zero" and the unpriced caveat go. */
function renderNote(band: Extract<Band, { kind: "note" }>, ctx: BandRenderOptions): readonly string[] {
	if (band.text === "") return [];
	return [clamp(ctx.fg(PALETTE.dim, band.text), ctx.width)];
}

/**
 * `custom` — the escape hatch that makes migration incremental: the screen's
 * own `render(ctx)` becomes one band's body. Temporary; its removal is a
 * milestone (F23 §2.3).
 */
function renderCustom(band: Extract<Band, { kind: "custom" }>, ctx: BandRenderOptions): readonly string[] {
	return band.render(ctx).map((row) => clamp(row, ctx.width));
}

/** G2: `${icon} ${boldAccent(title)}` plus `  ${dim(meta)}` on the same line. */
function heading(
	icon: IconRole,
	title: string,
	meta: string,
	preset: SymbolPreset,
	ctx: BandRenderOptions,
): string {
	const parts = [statsIcon(preset, icon), ctx.bold(ctx.fg(PALETTE.heading, title))];
	if (meta !== "") parts.push(ctx.fg(PALETTE.meta, meta));
	return clamp(parts.join(" "), ctx.width);
}

// ─── The grammar ─────────────────────────────────────────────────────────────

/**
 * Compose band bodies into panel lines. Every layout decision was made above;
 * this function only sequences them.
 *
 * G4 lives here and nowhere else: exactly one blank line between consecutive
 * bands, none leading, none trailing, none doubled. An empty band contributes
 * nothing and leaves no gap — so the blank line is attached to the END of a
 * non-empty band rather than inserted before the next one.
 */
export function renderBands(bands: readonly Band[], ctx: BandRenderOptions): readonly string[] {
	const lines: string[] = [];

	for (const band of bands) {
		const body =
			band.kind === "statRow"
				? renderStatRow(band.stats, ctx)
				: band.kind === "chart"
					? renderChart(band, ctx)
					: band.kind === "table"
						? renderTable(band, ctx)
						: band.kind === "legend"
							? renderLegend(band, ctx)
							: band.kind === "note"
								? renderNote(band, ctx)
								: renderCustom(band, ctx);

		if (body.length === 0) continue;

		// G4: a continuation (legend) follows its chart directly; every other
		// band is separated by one blank line.
		const isContinuation = band.kind === "legend";
		if (!isContinuation && lines.length > 0) lines.push("");
		lines.push(...body);
	}

	return lines;
}