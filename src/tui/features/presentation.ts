import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@oh-my-pi/pi-tui";
import { renderBands, type BandRenderOptions, type Column, type StatTile } from "../band";
import { glyphsFor } from "../glyphs";
import { renderSparkline } from "../charts/sparkline";
import { SELECTION_BG } from "../palette";
import type { FeatureContext } from "./types";

function options(ctx: FeatureContext, width: number): BandRenderOptions {
	const preset = ctx.theme.getSymbolPreset();
	return {
		width, innerWidth: width, preset, glyphs: glyphsFor(preset),
		fg: (color, text) => ctx.theme.fg(color, text), bold: text => ctx.theme.bold(text),
		barHeight: 4, labelWidth: 14, valueWidth: 12,
		identityWidth: Math.max(8, Math.floor(width * 0.42)),
		sparkline: (values, columns) => renderSparkline(values, { width: columns, preset, accent: cell => ctx.theme.fg("accent", cell) }),
		selected: text => ctx.theme.bg(SELECTION_BG.band, text + " ".repeat(Math.max(0, width - visibleWidth(text)))),
	};
}

/** Production controllers use the same measured tile grammar as the pure renderer. */
export function metricGrid(ctx: FeatureContext, width: number, tiles: readonly StatTile[]): string[] {
	return [...renderBands([{ kind: "statRow", stats: tiles }], options(ctx, width))];
}

/** Aligned identity-first tables; selected rows retain a marker even without color. */
export function dataTable(ctx: FeatureContext, width: number, title: string, columns: readonly Column[], rows: readonly Record<string, string>[], selectedRow?: number): string[] {
	return [...renderBands([{ kind: "table", title, columns, rows: { kind: "inline", rows }, selectedRow }], options(ctx, width))];
}

export function sectionHeading(ctx: FeatureContext, width: number, title: string, meta = "", active = false): string {
	return truncateToWidth(ctx.theme.bold(ctx.theme.fg(active ? "accent" : "muted", title)) + (meta ? ctx.theme.fg("dim", `  ${meta}`) : ""), Math.max(1, width));
}

/** Short, wrapping focus pills use the host's selection background rather than custom colors. */
export function focusTabs(ctx: FeatureContext, width: number, labels: readonly string[], selected: number): string[] {
	const line = labels.map((label, index) => index === selected
		? ctx.theme.bg(SELECTION_BG.band, ctx.theme.bold(ctx.theme.fg("accent", ` ${label} `)))
		: ctx.theme.fg("dim", ` ${label} `)).join("  ");
	return wrapTextWithAnsi(line, Math.max(1, width));
}
