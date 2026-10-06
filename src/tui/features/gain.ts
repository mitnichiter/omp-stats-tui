import { wrapTextWithAnsi } from "@oh-my-pi/pi-tui";
import type { GainDashboardStats, GainSourceTotals } from "@oh-my-pi/omp-stats/shared-types";
import { compactTokens, formatBytes, formatInteger, formatPercent } from "../format";
import type { Range } from "../../data/ranges";
import type { FeatureContext, FeatureController } from "./types";
import { projectOptions, savingsHistory } from "./provider-gain-data";
import { boundLines, recordViewport, timeline } from "./provider-gain-chart";
import { renderSparkline } from "../charts/sparkline";
import { glyph } from "../glyphs";

const SORTS = ["tokens", "source", "share", "bytes", "hits", "reduction"] as const;
type SourceRow = GainSourceTotals & { source: string; share: number };
export function createGainFeature(ctx: FeatureContext): FeatureController {
	let range: Range = "24h";
	let project: string | null = null;
	let projects: string[] = [];
	let data: GainDashboardStats | null = null;
	let generation = 0;
	let closed = false;
	let loading = false;
	let error: string | null = null;
	let focus = 0;
	let point = -1;
	let selected = 0;
	let sort = 0;
	let descending = true;
	let reveal = 12;
	let expanded = false;
	const rows = (): SourceRow[] => {
		if (!data) return [];
		const result = Object.entries(data.bySource).map(([source, totals]) => ({ ...totals, source, share: data!.overall.savedTokens > 0 ? totals.savedTokens / data!.overall.savedTokens : 0 }));
		const key = SORTS[sort];
		return result.sort((a, b) => {
			const av = key === "source" ? a.source : key === "tokens" ? a.savedTokens : key === "bytes" ? a.savedBytes : key === "hits" ? a.hits : key === "share" ? a.share : a.reductionPercent ?? -1;
			const bv = key === "source" ? b.source : key === "tokens" ? b.savedTokens : key === "bytes" ? b.savedBytes : key === "hits" ? b.hits : key === "share" ? b.share : b.reductionPercent ?? -1;
			return (typeof av === "string" && typeof bv === "string" ? av.localeCompare(bv) : Number(av) - Number(bv)) * (descending ? -1 : 1);
		});
	};
	async function load(nextRange: Range): Promise<void> {
		if (closed) return;
		if (range !== nextRange) { data = null; point = -1; }
		range = nextRange;
		const request = ++generation;
		const requestedProject = project;
		loading = true; error = null; ctx.changed();
		try {
			const next = await ctx.reader.api<GainDashboardStats>("/api/stats/gain", project === null ? { range } : { range, project });
			if (closed || request !== generation || requestedProject !== project) return;
			data = next; projects = [...next.projects];
			const history = savingsHistory(next.timeSeries, range, ctx.now());
			point = point < 0 ? history.axis.length - 1 : Math.min(point, history.axis.length - 1);
			selected = Math.min(selected, Math.max(0, rows().length - 1));
		} catch (cause) {
			if (closed || request !== generation) return;
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			if (!closed && request === generation) { loading = false; ctx.changed(); }
		}
	}
	return {
		load,
		render(width, height) {
			// The ONE `getSymbolPreset()` read for this screen, so every data-ink
			// mark below answers to the preset instead of being hardcoded.
			const preset = ctx.theme.getSymbolPreset();
			const lines = [
				ctx.theme.bold(`Gain · ${range} · ${project ?? "All projects"}`),
				...wrapTextWithAnsi(ctx.theme.fg("dim", "Tab/Shift-Tab focus · p/P project · h/l day · j/k source · o sort · d direction · Enter detail · + reveal"), width),
			];
			lines.push(`Focus: ${["Project", "Savings history", "Sources"][focus]}${loading ? " · Loading scoped savings…" : ""}`);
			if (error) lines.push(ctx.theme.fg("error", `Savings error: ${error}${data ? " · showing previous reading for this scope" : ""}`));
			if (focus === 0) {
				const options = projectOptions(projects, project);
				const viewport = recordViewport(options, options.indexOf(project), height, reveal);
			lines.push(...viewport.rows.map(p => `${p === project ? glyph(preset, "rowCursor") : " "} ${p ?? "All projects"}`));
				if (viewport.rows.length < options.length) lines.push(`Projects ${viewport.start + 1}–${viewport.start + viewport.rows.length}/${options.length} · p/P selects`);
			}
			if (!data) { lines.push(loading ? "Loading savings…" : "No savings payload available"); return boundLines(lines, width); }
			const t = data.overall;
			lines.push(`Saved tokens ${formatInteger(t.savedTokens)} · bytes ${formatBytes(t.savedBytes)} · hits ${formatInteger(t.hits)}`,
				`Reduction ${t.reductionPercent === null ? "— (original size not recorded)" : formatPercent(t.reductionPercent)} · tokens/hit ${t.hits > 0 ? compactTokens(t.savedTokens / t.hits) : "—"}`);
			const history = savingsHistory(data.timeSeries, range, ctx.now());
			if (t.hits === 0 && data.timeSeries.length === 0) lines.push(`No savings recorded for ${project ?? "all projects"} in ${range}. ${range === "all" ? "Savings appear when snapcompact compacts tool output." : "Try a longer range."}`);
			if (focus === 1) {
				lines.push(ctx.theme.bold("Saved per UTC day"), ...timeline(ctx, history.axis, [{ key: "daily", label: "Saved per day", values: history.daily }], width, point));
				lines.push(ctx.theme.bold("Cumulative saved tokens (range-scoped)"), ...timeline(ctx, history.axis, [{ key: "cumulative", label: "Cumulative", values: history.cumulative, colorIndex: 1 }], width, point, { cumulative: true }));
				const i = Math.max(0, Math.min(history.axis.length - 1, point));
				if (history.axis.length) lines.splice(3, 0, `Day ${new Date(history.axis[i]).toISOString().slice(0, 10)} · saved ${formatInteger(history.daily[i])} · cumulative ${formatInteger(history.cumulative[i])}`);
				lines.push(`Daily spark (newest ${Math.min(history.daily.length, Math.max(1, width - 15))} days)`, renderSparkline(history.daily, {
					width: Math.max(1, width - 15), preset: ctx.theme.getSymbolPreset(), accent: cell => ctx.theme.fg("success", cell),
				}));
			}
			const sourceRows = rows();
			lines.push(ctx.theme.bold(`By source · ${SORTS[sort]} ${descending ? "↓" : "↑"} · ${Math.min(reveal, sourceRows.length)}/${sourceRows.length}`));
			const chosen = sourceRows[selected];
			if (chosen && expanded) lines.splice(3, 0, `Source ${chosen.source} · saved ${formatInteger(chosen.savedTokens)} tokens · ${formatBytes(chosen.savedBytes)} bytes · ${formatInteger(chosen.hits)} hits`, `Share ${formatPercent(chosen.share)} · reduction ${chosen.reductionPercent === null ? "— (original size unknown)" : formatPercent(chosen.reductionPercent)} · original ${formatBytes(chosen.originalBytes)} · output ${formatBytes(chosen.outputBytes)}`);
			const view = recordViewport(sourceRows, selected, height, reveal);
			lines.push("Source | Saved tokens | Share | Bytes | Hits | Reduction");
		lines.push(...view.rows.map((r, i) => `${i + view.start === selected ? glyph(preset, "rowCursor") : " "} ${r.source} | ${compactTokens(r.savedTokens)} | ${formatPercent(r.share)} | ${formatBytes(r.savedBytes)} | ${formatInteger(r.hits)} | ${r.reductionPercent === null ? "—" : formatPercent(r.reductionPercent)}`));
			return boundLines(lines, width);
		},
		handleInput(input) {
			if (closed || input === "q") return false;
			if (input === "\t" || input === "v" || input === "\x1b[Z") focus = (focus + (input === "\x1b[Z" ? 2 : 1)) % 3;
			else if (input === "p" || input === "P") {
				const options = projectOptions(projects, project);
				project = options[(options.indexOf(project) + (input === "p" ? 1 : options.length - 1)) % options.length];
				data = null; point = -1; selected = 0; void load(range);
			} else if (input === "h" || input === "l") {
				const count = data ? savingsHistory(data.timeSeries, range, ctx.now()).axis.length : 0;
				point = Math.max(0, Math.min(count - 1, point + (input === "l" ? 1 : -1)));
				focus = 1;
			} else if (input === "j" || input === "k" || input === "\x1b[A" || input === "\x1b[B") {
				if (focus === 0) return this.handleInput(input === "j" || input === "\x1b[B" ? "p" : "P");
				selected = Math.max(0, Math.min(rows().length - 1, selected + (input === "j" || input === "\x1b[B" ? 1 : -1))); focus = 2;
			} else if (input === "o") sort = (sort + 1) % SORTS.length;
			else if (input === "d") descending = !descending;
			else if (input === "+" || input === "=") reveal += 12;
			else if (input === "\r" || input === "\n") { expanded = !expanded; focus = 2; }
			else if (input === "\x1b" && expanded) expanded = false;
			else return false;
			ctx.changed(); return true;
		},
		dispose() { closed = true; generation++; },
	};
}
