import { truncateToWidth, visibleWidth } from "@oh-my-pi/pi-tui";
import type { FeatureContext } from "./types";
import { resolveSeries } from "../palette";
import { compactTokens, formatPercent } from "../format";

export interface TimelineRow { key: string; label: string; values: readonly (number | null)[]; legendValue?: string; colorIndex?: number }
/** Focused local slice: real timestamps, no downsampled/imputed readings. */
export function timeline(ctx: FeatureContext, axis: readonly number[], rows: readonly TimelineRow[], width: number, selected: number, options: { percent?: boolean; cumulative?: boolean; hidden?: ReadonlySet<string>; stacked?: boolean; format?: (value: number) => string } = {}): string[] {
	if (axis.length === 0 || rows.length === 0) return [ctx.theme.fg("dim", "No recorded points")];
	const columns = Math.max(1, Math.min(axis.length, Math.floor(width) - 12));
	selected = Math.max(0, Math.min(axis.length - 1, selected));
	const start = Math.max(0, Math.min(axis.length - columns, selected - Math.floor(columns / 2)));
	const active = rows.filter(r => !options.hidden?.has(r.key));
	const colors = resolveSeries(Math.max(rows.length, ...rows.map(r => (r.colorIndex ?? 0) + 1)), ctx.theme);
	const ranked = active.map(row => ({ row, color: colors[row.colorIndex ?? rows.indexOf(row)] }));
	let max = options.percent ? 1 : 0;
	for (let i = 0; i < axis.length; i++) {
		let sum = 0;
		for (const r of active) { const v = r.values[i] ?? 0; sum += v; max = Math.max(max, v); }
		if (options.stacked) max = Math.max(max, sum);
	}
	const grid: string[][] = Array.from({ length: 5 }, () => Array.from({ length: columns }, () => " "));
	const referenceRow = options.percent ? 4 - Math.round(4 / max) : -1;
	if (referenceRow >= 0) grid[referenceRow].fill(ctx.theme.fg("dim", "┄"));
	for (let x = 0; x < columns; x++) {
		let base = 0;
		for (const { row: r, color } of ranked) {
			const value = r.values[start + x];
			if (value === null || value === undefined) continue;
			const level = max > 0 ? Math.max(0, Math.min(4, Math.round(((options.stacked ? base + value : value) / max) * 4))) : 0;
			if (options.stacked) {
				const bottom = max > 0 ? Math.max(0, Math.min(4, Math.round(base / max * 4))) : 0;
				if (value > 0) for (let y = bottom; y <= level; y++) grid[4 - y][x] = ctx.theme.fg(color, "█");
				base += value;
			} else grid[4 - level][x] = ctx.theme.fg(color, options.cumulative ? "●" : "•");
		}
	}
	const scale = options.percent ? formatPercent(max, 0) : (options.format ?? compactTokens)(max);
	const lines = [`Scale 0–${scale} · buckets ${start + 1}–${start + columns}/${axis.length}`];
	lines.push(...grid.map((cells, y) => `  │${cells.join("")}${y === referenceRow ? " 100%" : ""}`));
	lines.push(`  └${"─".repeat(columns)}`, `   ${" ".repeat(selected - start)}${ctx.theme.fg("accent", "▲")}`);
	const first = new Date(axis[start]).toISOString().slice(0, 16).replace("T", " ");
	const last = new Date(axis[start + columns - 1]).toISOString().slice(0, 16).replace("T", " ");
	lines.push(`${first} → ${last} UTC`);
	for (let i = 0; i < rows.length; i++) {
		const r = rows[i];
		lines.push(`${ctx.theme.fg(colors[r.colorIndex ?? i], "■")} ${options.hidden?.has(r.key) ? "[hidden] " : ""}${r.label}${r.legendValue === undefined ? "" : ` · ${r.legendValue}`}`);
	}
	return lines.map(line => truncateToWidth(line, Math.max(0, width)));
}
/** Keep the selected record visible without borrowing the panel's global scroll. */
export function recordViewport<T>(rows: readonly T[], selected: number, height: number, reveal: number): { rows: readonly T[]; start: number } {
	const count = Math.max(1, Math.min(reveal, Math.max(3, height - 13)));
	const start = Math.max(0, Math.min(rows.length - count, selected - Math.floor(count / 2)));
	return { rows: rows.slice(start, start + count), start };
}
export function boundLines(lines: readonly string[], width: number): string[] {
	return lines.map(line => visibleWidth(line) > width ? truncateToWidth(line, Math.max(0, width)) : line);
}
