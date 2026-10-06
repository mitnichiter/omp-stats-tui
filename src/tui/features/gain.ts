import { wrapTextWithAnsi } from "@oh-my-pi/pi-tui";
import type { GainDashboardStats, GainSourceTotals } from "@oh-my-pi/omp-stats/shared-types";
import { compactTokens, formatBytes, formatInteger, formatPercent } from "../format";
import type { Range } from "../../data/ranges";
import type { FeatureContext, FeatureController } from "./types";
import { projectOptions, savingsHistory } from "./provider-gain-data";
import { boundLines, recordViewport } from "./provider-gain-chart";
import { renderTimeSeries } from "../charts/time-series";
import { dataTable, focusTabs, metricGrid, sectionHeading } from "./presentation";

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
	let selectedSource: string | null = null;
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
			const lines = [ctx.theme.bold(`Gain · ${range} · ${project ?? "All projects"}`)];
			if (error) lines.push(ctx.theme.fg("error", `Savings error: ${error}${data ? " · showing previous reading for this scope" : ""}`));
			if (data) {
				const t = data.overall;
				lines.push(...metricGrid(ctx, width, [
					{ label: "Saved tokens", value: compactTokens(t.savedTokens), emphasis: "primary" },
					{ label: "Saved bytes", value: formatBytes(t.savedBytes), hint: `${formatInteger(t.hits)} recorded hits` },
					{ label: "Reduction", value: t.reductionPercent === null ? "—" : formatPercent(t.reductionPercent), hint: t.reductionPercent === null ? "original size not recorded" : "recorded original bytes" },
				]));
			}
			lines.push(...focusTabs(ctx, width, ["Projects", "History", "Sources"], focus));
			const hint = focus === 0 ? "p/P project · j/k select" : focus === 1 ? "h/l UTC day · p/P project" : "j/k source · o sort · d direction · Enter detail · + reveal";
			lines.push(...wrapTextWithAnsi(ctx.theme.fg("dim", `Tab focus · ${hint}${loading ? " · loading" : ""}`), width));
			if (!data) { lines.push(loading ? "Loading scoped savings…" : "No savings payload available"); return boundLines(lines, width); }
			const t = data.overall;
			const history = savingsHistory(data.timeSeries, range, ctx.now());
			const empty = t.hits === 0 && data.timeSeries.length === 0;
			if (empty) lines.push(...wrapTextWithAnsi(ctx.theme.fg("muted", `No savings recorded for ${project ?? "all projects"} in ${range}. ${range === "all" ? "Savings appear when snapcompact compacts tool output." : "Try a longer range."}`), width));
			if (focus === 0) {
				const options = projectOptions(projects, project);
				const viewport = recordViewport(options, options.indexOf(project), Math.max(1, height - lines.length + 10), reveal);
				lines.push(...dataTable(ctx, width, "Projects", [{ key: "project", header: "Project", align: "left" }], viewport.rows.map(p => ({ project: p ?? "All projects" })), options.indexOf(project) - viewport.start));
			}
			if (!empty && focus === 1) {
				const i = Math.max(0, Math.min(history.axis.length - 1, point));
				lines.push(sectionHeading(ctx, width, "Saved per UTC day", history.axis.length ? new Date(history.axis[i]).toISOString().slice(0, 10) : "", true));
				if (history.axis.length) lines.push(`Day ${new Date(history.axis[i]).toISOString().slice(0, 10)} · saved ${formatInteger(history.daily[i])} · cumulative ${formatInteger(history.cumulative[i])}`);
				const chartHeight = Math.max(2, Math.min(4, Math.floor((height - lines.length - 10) / 2)));
				lines.push(...renderTimeSeries(ctx, history.axis, [{ key: "daily", label: "Saved per day", values: history.daily }], width, point, { format: compactTokens, unit: "tokens", height: chartHeight, legend: false }));
				lines.push(sectionHeading(ctx, width, "Cumulative saved tokens", "range-scoped", true));
				lines.push(...renderTimeSeries(ctx, history.axis, [{ key: "cumulative", label: "Cumulative", values: history.cumulative, colorIndex: 1 }], width, point, { cumulative: true, format: compactTokens, unit: "tokens", height: chartHeight, legend: false }));
			}
			const sourceRows = rows();
			const retained = sourceRows.findIndex(r => r.source === selectedSource);
			selected = retained >= 0 ? retained : Math.max(0, Math.min(selected, sourceRows.length - 1));
			const chosen = sourceRows[selected];
			if (chosen) selectedSource = chosen.source;
			if (chosen && expanded && !empty) {
				lines.push(sectionHeading(ctx, width, chosen.source, "recorded source detail", focus === 2));
				lines.push(...wrapTextWithAnsi(`Saved ${formatInteger(chosen.savedTokens)} tokens · ${formatBytes(chosen.savedBytes)} · ${formatInteger(chosen.hits)} hits · ${chosen.hits > 0 ? compactTokens(chosen.savedTokens / chosen.hits) : "—"} tokens/hit`, width));
				lines.push(...wrapTextWithAnsi(`Share ${formatPercent(chosen.share)} · reduction ${chosen.reductionPercent === null ? "— (original size unknown)" : formatPercent(chosen.reductionPercent)} · original ${formatBytes(chosen.originalBytes)} · output ${formatBytes(chosen.outputBytes)}`, width));
			}
			if (!empty && focus !== 1) {
				lines.push(sectionHeading(ctx, width, "By source", `${SORTS[sort]} ${descending ? "↓" : "↑"} · ${sourceRows.length} sources`, focus === 2));
				const viewport = recordViewport(sourceRows, selected, Math.max(1, height - lines.length + 10), reveal);
				lines.push(...dataTable(ctx, width, "", [
					{ key: "source", header: "Source", align: "left" },
					{ key: "tokens", header: "Saved tokens", align: "right" },
					{ key: "hits", header: "Hits", align: "right", priority: 1 },
					{ key: "bytes", header: "Bytes", align: "right", priority: 2 },
					{ key: "share", header: "Share", align: "right", priority: 3 },
					{ key: "reduction", header: "Reduction", align: "right", priority: 4 },
				], viewport.rows.map(r => ({ source: r.source, tokens: compactTokens(r.savedTokens), hits: formatInteger(r.hits), bytes: formatBytes(r.savedBytes), share: formatPercent(r.share), reduction: r.reductionPercent === null ? "—" : formatPercent(r.reductionPercent) })), selected - viewport.start));
			}
			return boundLines(lines, width);
		},
		handleInput(input) {
			if (closed || input === "q") return false;
			if (input === "\t" || input === "v" || input === "\x1b[Z") focus = (focus + (input === "\x1b[Z" ? 2 : 1)) % 3;
			else if (input === "p" || input === "P") {
				const options = projectOptions(projects, project);
				project = options[(options.indexOf(project) + (input === "p" ? 1 : options.length - 1)) % options.length];
				data = null; point = -1; selected = 0; selectedSource = null; void load(range);
			} else if (input === "h" || input === "l") {
				const count = data ? savingsHistory(data.timeSeries, range, ctx.now()).axis.length : 0;
				point = Math.max(0, Math.min(count - 1, point + (input === "l" ? 1 : -1)));
				focus = 1;
			} else if (input === "j" || input === "k" || input === "\x1b[A" || input === "\x1b[B") {
				if (focus === 0) return this.handleInput(input === "j" || input === "\x1b[B" ? "p" : "P");
				const sourceRows = rows();
				const retained = sourceRows.findIndex(r => r.source === selectedSource);
				selected = Math.max(0, Math.min(sourceRows.length - 1, (retained >= 0 ? retained : selected) + (input === "j" || input === "\x1b[B" ? 1 : -1)));
				selectedSource = sourceRows[selected]?.source ?? null; focus = 2;
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
