import { truncateToWidth, wrapTextWithAnsi } from "@oh-my-pi/pi-tui";
import type { FeatureContext } from "../types";
import { renderSeriesChart } from "../../charts/compose";

/** Wrap prose/details; chart and list rows should be clipped instead. */
export function wrap(lines: readonly string[], width: number): string[] {
	const w = Math.max(1, Math.floor(width));
	return lines.flatMap(line => wrapTextWithAnsi(line, w).map(part => truncateToWidth(part, w)));
}

/** Scalar-labelled details keep every omitted narrow-table column accessible. */
export function fields(value: unknown, prefix = ""): string[] {
	if (value === null || value === undefined) return [`${prefix || "Value"}: —`];
	if (typeof value !== "object") return [`${prefix || "Value"}: ${String(value)}`];
	return Object.entries(value).flatMap(([key, item]) => fields(item, prefix ? `${prefix}.${key}` : key));
}

export type SortValue = string | number | null | undefined;
export type Sorters<T> = Record<string, (row: T) => SortValue>;
export class ListState<T> {
	search = "";
	editing = false;
	sort: string;
	descending = true;
	reveal: number;
	selected: string | null = null;
	constructor(readonly key: (row: T) => string, initialSort: string, readonly initialLimit = 100) {
		this.sort = initialSort;
		this.reveal = initialLimit;
	}
	rows(rows: readonly T[], sorters: Sorters<T>): T[] {
		const getter = sorters[this.sort];
		if (!getter) return [...rows];
		return [...rows].sort((a, b) => {
			const av = getter(a) ?? -Infinity, bv = getter(b) ?? -Infinity;
			const order = typeof av === "string" && typeof bv === "string" ? av.localeCompare(bv) : av < bv ? -1 : av > bv ? 1 : 0;
			return (this.descending ? -order : order) || this.key(a).localeCompare(this.key(b));
		});
	}
	current(rows: readonly T[]): T | undefined { return rows.find(row => this.key(row) === this.selected) ?? rows[0]; }
	move(rows: readonly T[], delta: number): void {
		if (!rows.length) return;
		const current = rows.findIndex(row => this.key(row) === this.selected);
		const next = Math.max(0, Math.min(rows.length - 1, (current < 0 ? 0 : current) + delta));
		this.selected = this.key(rows[next]);
		this.reveal = Math.max(this.reveal, next + 1);
	}
	input(data: string, rows: readonly T[]): boolean {
		if (data === "\x0e" || data === "\x10" || data === "\x1b[C" || data === "\x1b[D" ||
			data === "\x1b[5~" || data === "\x1b[6~" || data === "\x1b[H" || data === "\x1b[F" ||
			data === "\x1b[1~" || data === "\x1b[4~") return false;
		if (this.editing) {
			if (data === "\x1b" || data === "\r" || data === "\n") this.editing = false;
			else if (data === "\x7f" || data === "\b") this.search = [...this.search].slice(0, -1).join("");
			else if (!/[\x00-\x1f\x7f]/.test(data)) this.search += data;
			return true;
		}
		if (data === "q" || data === "[" || data === "]") return false;
		if (data === "/") { this.editing = true; return true; }
		if (data === "\x1b" && this.search) { this.search = ""; return true; }
		if (data === "j" || data === "\x1b[B") { this.move(rows, 1); return true; }
		if (data === "k" || data === "\x1b[A") { this.move(rows, -1); return true; }
		if (data === "+") { this.reveal += this.initialLimit; return true; }
		if (data === "a") { this.reveal = Infinity; return true; }
		return false;
	}
	render(rows: readonly T[], width: number, height: number, label: (row: T) => string, ctx: FeatureContext): string[] {
		const searchLine = `${this.editing ? "Search input" : "/ search"}: ${this.search || "—"}${this.editing ? " ▏ (Enter finish, Esc cancel)" : ""}`;
		if (!rows.length) return [ctx.theme.fg("dim", "No rows match. Clear filters or change the range."), searchLine]
			.map(line => truncateToWidth(line, Math.max(1, width)));
		const current = this.current(rows)!;
		const index = rows.indexOf(current);
		this.reveal = Math.max(this.reveal, index + 1);
		const count = Math.max(1, Math.min(Math.max(3, height - 8), this.reveal, rows.length));
		const start = Math.max(0, Math.min(index - Math.floor(count / 2), Math.min(rows.length, this.reveal) - count));
		const result = rows.slice(start, start + count).map(row => {
			const selected = this.key(row) === this.key(current);
			const line = truncateToWidth(`${selected ? ">" : " "} ${label(row)}`, Math.max(1, width));
			return selected ? ctx.theme.fg("accent", line) : line;
		});
		return [`Rows ${start + 1}–${start + count} / ${rows.length} · selected ${index + 1} · ${this.sort} ${this.descending ? "↓" : "↑"}`, ...result,
			"j/k move (all rows reachable) · + reveal more · a reveal all · Enter details · o/O sort/reverse",
			searchLine].map(line => truncateToWidth(line, Math.max(1, width)));
	}
}

export interface CoreSeries { key: string; label: string; values: readonly number[]; }
export class ChartState {
	mode = 0;
	seriesIndex = 0;
	point = 0;
	readonly hidden = new Set<string>();
	input(data: string, keys: readonly string[]): boolean {
		if (data === "n") { this.seriesIndex = (this.seriesIndex + 1) % Math.max(1, keys.length); return true; }
		if (data === "v") {
			const key = keys[this.seriesIndex % Math.max(1, keys.length)];
			if (key) this.hidden.has(key) ? this.hidden.delete(key) : this.hidden.add(key);
			return true;
		}
		if (data === ",") { this.point = Math.max(0, this.point - 1); return true; }
		if (data === ".") { this.point++; return true; }
		return false;
	}
	render(ctx: FeatureContext, width: number, buckets: readonly number[], series: readonly CoreSeries[]): string[] {
		if (!buckets.length || !series.length) return ["No chart observations in this range."];
		this.point = Math.max(0, Math.min(this.point, buckets.length - 1));
		this.seriesIndex %= Math.max(1, series.length);
		const active = series.filter(row => !this.hidden.has(row.key));
		const selected = series[this.seriesIndex];
		const inspection = [`Point ${this.point + 1}/${buckets.length} · ${new Date(buckets[this.point]).toISOString()}`,
			...series.map(row => `${row.key === selected?.key ? ">" : " "} ${this.hidden.has(row.key) ? "off" : "on"} ${row.label}: ${row.values[this.point] ?? "—"}`)];
		return [...wrap([inspection[0]], width), ...wrap(inspection.slice(1), width),
			...(active.length === 0 ? wrap(["All chart series are hidden; n/v restores a series."], width)
				: active.every(row => row.values.every(value => value <= 0)) ? wrap(["No positive measured values in the visible series."], width)
				: renderSeriesChart(active, { width: Math.max(1, width), height: Math.max(8, active.length * 2),
					preset: ctx.theme.getSymbolPreset(), theme: ctx.theme, paint: (color, text) => ctx.theme.fg(color, text), dim: text => ctx.theme.fg("dim", text) })),
			...wrap(["m mode · n select series · v toggle selected · ,/. inspect previous/next point"], width)];
	}
}
