import { modelKey } from "@oh-my-pi/omp-stats/client/data/colors";
import { formatCost, formatDurationMs, formatEstimatedCost, formatInteger, formatPercent, formatTokensPerSecond } from "@oh-my-pi/omp-stats/client/data/formatters";
import { bucketAxis, rangeMeta } from "@oh-my-pi/omp-stats/client/data/range";
import { densify, pivotSeries } from "@oh-my-pi/omp-stats/client/data/series";
import { buildCostSummary, buildModelPerformanceLookup, buildToolRows, sumConversationTokens, type ModelPerformanceDataPoint, type ToolRowView } from "@oh-my-pi/omp-stats/client/data/view-models";
import type { ToolDashboardStats } from "@oh-my-pi/omp-stats/shared-types";
import type { CostPayload, ModelDashboardPayload } from "../../../data/api";
import type { Range } from "../../../data/ranges";
import { renderSeriesChart } from "../../charts/compose";
import type { FeatureContext, FeatureController } from "../types";
import { ChartState, ListState, fields, wrap, type CoreSeries, type Sorters } from "./shared";

type AnalyticsId = "models" | "costs" | "tools";
interface Row {
	key: string;
	label: string;
	values: Record<string, unknown>;
	display: Record<string, unknown>;
	tool?: string;
}
interface Table {
	state: ListState<Row>;
	rows: Row[];
	title: string;
}
const COMPONENTS = [
	{ key: "costInput", label: "Input" },
	{ key: "costOutput", label: "Output" },
	{ key: "costCacheRead", label: "Cache read" },
	{ key: "costCacheWrite", label: "Cache write" },
] as const;
const DAY_MS = 86_400_000;
const row = (key: string, label: string, values: Record<string, unknown>, display: Record<string, unknown> = values, tool?: string): Row => ({ key, label, values, display, tool });
const table = (title: string, sort: string, limit: number): Table => ({ title, state: new ListState<Row>(r => r.key, sort, limit), rows: [] });
const sorters = (rows: readonly Row[]): Sorters<Row> => {
	const keys = new Set(rows.flatMap(r => Object.keys(r.values)));
	return Object.fromEntries([...keys].map(key => [key, (r: Row) => {
		const value = r.values[key];
		return typeof value === "number" || typeof value === "string" ? value : null;
	}]));
};
const denseSeries = (series: readonly { key: string; label: string; values: readonly (number | null)[] }[]): CoreSeries[] => series.map(s => ({ key: s.key, label: s.label, values: s.values.map(v => v ?? 0) }));
const shares = (series: readonly CoreSeries[], totals: readonly number[]): CoreSeries[] => series.map(s => ({ ...s, values: s.values.map((v, i) => totals[i] > 0 ? v / totals[i] : 0) }));
const identity = (model: string, provider: string): string => `${model || "(unknown)"} · ${provider}`;

class AnalyticsFeature implements FeatureController {
	private closed = false;
	private generation = 0;
	private loading = false;
	private error: string | null = null;
	private range: Range = "24h";
	private focus = 0;
	private expanded: { table: number; key: string } | null = null;
	private readonly chart = new ChartState();
	private readonly performanceChart = new ChartState();
	private readonly tables: Table[];
	private buckets: number[] = [];
	private modes: { label: string; series: CoreSeries[]; unit: string }[] = [];
	private summary: string[] = [];
	private performance = new Map<string, ModelPerformanceDataPoint[]>();
	private unpriced: number[] = [];
	private costSeriesUnknown = new Map<string, number[]>();
	private costs: CostPayload | null = null;
	private toolFilter: string | null = null;
	private toolNames: string[] = [];

	constructor(private readonly id: AnalyticsId, private readonly ctx: FeatureContext) {
		this.tables = id === "models" ? [table("All models", "totalRequests", 25)] : id === "costs" ? [table("By model", "cost", 20), table("Billing components", "cost", 4)] : [table("By tool", "calls", 20), table("By tool and model", "calls", 25)];
	}

	async load(range: Range): Promise<void> {
		if (this.closed) return;
		const generation = ++this.generation;
		this.range = range;
		this.loading = true;
		this.error = null;
		this.ctx.changed();
		try {
			// Build and commit only the response belonging to this screen's latest load.
			if (this.id === "models") {
				const data = await this.ctx.reader.api<ModelDashboardPayload>("/api/stats/model-dashboard", { range });
				if (this.closed || generation !== this.generation) return;
				this.setModels(data, range);
			} else if (this.id === "costs") {
				const data = await this.ctx.reader.api<CostPayload>("/api/stats/costs", { range });
				if (this.closed || generation !== this.generation) return;
				this.setCosts(data, range);
			} else {
				const data = await this.ctx.reader.api<ToolDashboardStats>("/api/stats/tools", { range });
				if (this.closed || generation !== this.generation) return;
				this.setTools(data, range);
			}
			for (let i = 0; i < this.tables.length; i++) {
				const t = this.tables[i];
				if (t.state.selected === null) t.state.selected = this.rows(i)[0]?.key ?? null;
			}
		} catch (error) {
			if (!this.closed && generation === this.generation) this.error = error instanceof Error ? error.message : String(error);
		} finally {
			if (!this.closed && generation === this.generation) {
				this.loading = false;
				this.ctx.changed();
			}
		}
	}

	private axis(range: Range, timestamps: Iterable<number>, bucketMs = rangeMeta(range).bucketMs): number[] {
		return bucketAxis(range, timestamps, bucketMs, this.ctx.now());
	}

	private setModels(data: ModelDashboardPayload, range: Range): void {
		this.buckets = this.axis(range, data.modelSeries.map(p => p.timestamp));
		const counts = denseSeries(pivotSeries(data.modelSeries, { buckets: this.buckets, key: p => modelKey(p.model, p.provider), label: key => {
			const m = data.byModel.find(m => modelKey(m.model, m.provider) === key);
			return m ? identity(m.model, m.provider) : key;
		}, value: p => p.requests, limit: 6 }));
		const totals = densify(data.modelSeries, this.buckets, p => p.requests);
		this.modes = [{ label: "Request share", series: shares(counts, totals), unit: "share" }, { label: "Request counts", series: counts, unit: "requests" }];
		this.performance = buildModelPerformanceLookup(data.modelPerformanceSeries);
		this.tables[0].rows = data.byModel.map(m => row(modelKey(m.model, m.provider), identity(m.model, m.provider), { ...m, conversationTokens: sumConversationTokens(m) }, {
			...m, totalCost: formatEstimatedCost(m.totalCost, m.unpricedRequests), errorRate: formatPercent(m.errorRate), cacheRate: formatPercent(m.cacheRate), cacheSavings: formatPercent(m.cacheSavings),
			avgDuration: formatDurationMs(m.avgDuration), avgTtft: formatDurationMs(m.avgTtft), avgTokensPerSecond: `${formatTokensPerSecond(m.avgTokensPerSecond)} tok/s`, conversationTokens: sumConversationTokens(m),
		}));
		const sum = (key: "totalRequests" | "failedRequests" | "totalCost" | "unpricedRequests") => data.byModel.reduce((total, m) => total + m[key], 0);
		this.summary = [`Models: ${data.byModel.length} · Providers: ${new Set(data.byModel.map(m => m.provider)).size} · Requests: ${formatInteger(sum("totalRequests"))} · Failed: ${formatInteger(sum("failedRequests"))}`, `API-equivalent estimate: ${formatEstimatedCost(sum("totalCost"), sum("unpricedRequests"))} · Unpriced requests: ${formatInteger(sum("unpricedRequests"))}`];
	}

	private setCosts(data: CostPayload, range: Range): void {
		this.costs = data;
		const summary = buildCostSummary(data.costSeries);
		this.buckets = this.axis(range, data.costSeries.map(p => p.timestamp), DAY_MS);
		this.unpriced = densify(data.costSeries, this.buckets, p => p.unpricedRequests);
		const byKey = new Map(summary.models.map(m => [m.key, m]));
		const models = denseSeries(pivotSeries(data.costSeries, { buckets: this.buckets, key: p => modelKey(p.model, p.provider), label: key => {
			const m = byKey.get(key);
			return m ? identity(m.model, m.provider) : key;
		}, value: p => p.cost, limit: 6 }));
		const individualKeys = new Set(models.filter(s => s.key !== "__other__").map(s => s.key));
		this.costSeriesUnknown = new Map(models.map(s => [s.key, densify(data.costSeries, this.buckets, p => {
			const key = modelKey(p.model, p.provider);
			return (s.key === "__other__" ? !individualKeys.has(key) : key === s.key) ? p.unpricedRequests : 0;
		})]));
		this.modes = [{ label: "Daily estimate by model (UTC)", series: models, unit: "USD" }, { label: "Daily estimate by component (UTC)", series: COMPONENTS.map(c => ({ ...c, values: densify(data.costSeries, this.buckets, p => p[c.key]) })), unit: "USD" }];
		this.tables[0].rows = summary.models.map(m => {
			const perPricedRequest = m.requests > m.unpricedRequests ? m.cost / (m.requests - m.unpricedRequests) : null;
			return row(m.key, identity(m.model, m.provider), { ...m, perPricedRequest }, { ...m, cost: `${formatEstimatedCost(m.cost, m.unpricedRequests)} · Unknown requests: ${formatInteger(m.unpricedRequests)}`, share: m.cost === 0 && m.unpricedRequests > 0 ? "N/A" : `${formatPercent(m.share)} of priced estimate`, ...Object.fromEntries(COMPONENTS.map(c => [c.key, `${formatEstimatedCost(m[c.key], m.unpricedRequests)} · Unknown requests: ${formatInteger(m.unpricedRequests)}`])), perPricedRequest: `${perPricedRequest === null ? "N/A" : perPricedRequest > 0 && perPricedRequest < 0.0001 ? "<$0.0001" : formatCost(perPricedRequest)} · Unknown requests excluded: ${formatInteger(m.unpricedRequests)}` });
		});
		this.tables[1].rows = COMPONENTS.map(c => {
			const values = { component: c.label, cost: summary[c.key], share: summary.totalCost > 0 ? summary[c.key] / summary.totalCost : 0, unpricedRequests: summary.unpricedRequests };
			return row(c.key, c.label, values, { ...values, cost: `${formatEstimatedCost(values.cost, summary.unpricedRequests)} · Unknown requests: ${formatInteger(summary.unpricedRequests)}`, share: summary.totalCost > 0 ? `${formatPercent(values.share)} of priced estimate` : "N/A" });
		});
		const priced = summary.requests - summary.unpricedRequests;
		this.summary = [`API-equivalent estimate: ${formatEstimatedCost(summary.totalCost, summary.unpricedRequests)} · Requests: ${formatInteger(summary.requests)} · Unpriced requests: ${formatInteger(summary.unpricedRequests)}`, `Average per active day: ${formatEstimatedCost(summary.avgDailyCost, summary.unpricedRequests)} · Unknown requests: ${formatInteger(summary.unpricedRequests)} · Active days: ${summary.activeDays} · Per priced request: ${priced > 0 ? formatCost(summary.totalCost / priced) : "N/A"} · Unknown requests excluded: ${formatInteger(summary.unpricedRequests)}`, "Unpriced subscription usage is excluded, not free. Estimates use public API rates."];
	}

	private setTools(data: ToolDashboardStats, range: Range): void {
		this.buckets = this.axis(range, data.series.map(p => p.timestamp));
		const calls = denseSeries(pivotSeries(data.series, { buckets: this.buckets, key: p => p.tool, value: p => p.calls, limit: 6 }));
		const errors = denseSeries(pivotSeries(data.series, { buckets: this.buckets, key: p => p.tool, value: p => p.errors, limit: 6 }));
		this.modes = [{ label: "Tool call counts (all tools)", series: calls, unit: "calls" }, { label: "Tool error counts (all tools)", series: errors, unit: "errors" }, { label: "Tool call share (all tools)", series: shares(calls, densify(data.series, this.buckets, p => p.calls)), unit: "share" }, { label: "Tool error share (all tools)", series: shares(errors, densify(data.series, this.buckets, p => p.errors)), unit: "share" }];
		const display = (t: ToolRowView): Record<string, unknown> => ({ ...t, costShare: formatEstimatedCost(t.costShare, t.unpricedRequestsShare), errorRate: formatPercent(t.errorRate), callFraction: formatPercent(t.callFraction), tokenFraction: formatPercent(t.tokenFraction), costFraction: formatPercent(t.costFraction) });
		this.tables[0].rows = buildToolRows(data.byTool).map(t => row(t.tool, t.tool, { ...t }, display(t), t.tool));
		// Reuse upstream rates/shares, retaining each tool/provider/model identity.
		this.tables[1].rows = buildToolRows(data.byToolModel).map((t, i) => {
			const m = data.byToolModel[i];
			return row(JSON.stringify([m.tool, modelKey(m.model, m.provider)]), `${m.tool} · ${identity(m.model, m.provider)}`, { ...m, ...t }, { ...m, ...display(t) }, m.tool);
		});
		this.toolNames = data.byTool.map(t => t.tool).sort((a, b) => a.localeCompare(b));
		const totals = data.byTool.reduce((s, t) => ({ calls: s.calls + t.calls, errors: s.errors + t.errors, tokens: s.tokens + t.totalTokensShare, output: s.output + t.outputTokensShare, cost: s.cost + t.costShare, unpriced: s.unpriced + t.unpricedRequestsShare, result: s.result + t.resultChars, args: s.args + t.argsChars }), { calls: 0, errors: 0, tokens: 0, output: 0, cost: 0, unpriced: 0, result: 0, args: 0 });
		this.summary = [`Tool calls: ${formatInteger(totals.calls)} · Errors: ${formatInteger(totals.errors)} · Error rate: ${formatPercent(totals.calls > 0 ? totals.errors / totals.calls : 0)} · Distinct tools: ${data.byTool.length}`, `Attributed tokens: ${formatInteger(totals.tokens)} · Output: ${formatInteger(totals.output)} · API-equivalent cost: ${formatEstimatedCost(totals.cost, totals.unpriced)} · Unpriced: ${formatInteger(totals.unpriced)}`, `Result text: ${formatInteger(totals.result)} chars · Call arguments: ${formatInteger(totals.args)} chars · Result/call: ${formatInteger(totals.calls > 0 ? Math.round(totals.result / totals.calls) : 0)} chars · Arguments/call: ${formatInteger(totals.calls > 0 ? Math.round(totals.args / totals.calls) : 0)} chars`, "Attribution: invoking-turn tokens and cost split evenly across that turn's tool calls."];
	}

	private rows(index: number): Row[] {
		const t = this.tables[index];
		const search = t.state.search.toLocaleLowerCase();
		// Preserve the pick across ranges, but apply it only while that tool exists.
		const filter = this.toolFilter !== null && this.toolNames.includes(this.toolFilter) ? this.toolFilter : null;
		return t.state.rows(t.rows.filter(r => (this.id !== "tools" || index !== 1 || filter === null || r.tool === filter) && (!search || `${r.label} ${fields(r.values).join(" ")}`.toLocaleLowerCase().includes(search))), sorters(t.rows));
	}

	private mode() { return this.modes[this.chart.mode % Math.max(1, this.modes.length)]; }

	render(width: number, height: number): readonly string[] {
		const lines = [`${this.id.toUpperCase()} · ${this.range} · Focus: ${this.focus === 0 ? "chart" : this.tables[this.focus - 1].title}`, ...this.summary];
		const filter = this.toolFilter !== null && this.toolNames.includes(this.toolFilter) ? this.toolFilter : null;
		if (this.loading) lines.push(this.ctx.theme.fg("dim", "Loading… Previous observations remain visible."));
		if (this.error) lines.push(this.ctx.theme.fg("error", this.error));
		if (this.expanded) {
			const selected = this.rows(this.expanded.table).find(r => r.key === this.expanded?.key);
			if (selected) {
				lines.push(`Details: ${selected.label}`, ...fields(selected.display));
				if (this.id === "models") lines.push(...this.renderPerformance(selected.key, width));
				lines.push("b/Esc back · Tab focus · q close");
				return wrap(lines, width);
			}
		}
		const mode = this.mode();
		if (mode) {
			lines.push(mode.label);
			const unknown = this.unpriced.reduce((total, count) => total + count, 0);
			if (this.id === "costs" && unknown > 0 && mode.series.every(s => s.values.every(value => value === 0))) {
				lines.push(`No priced cost / unknown ${formatInteger(unknown)} requests. Unpriced usage is not zero spend.`);
				lines.push(...mode.series.map((s, i) => `${i === this.chart.seriesIndex % mode.series.length ? ">" : " "} ${this.chart.hidden.has(s.key) ? "off" : "on"} ${s.label}`));
			} else lines.push(...this.chart.render(this.ctx, width, this.buckets, mode.series));
			this.chart.point = Math.min(this.chart.point, Math.max(0, this.buckets.length - 1));
			const point = this.chart.point;
			lines.push(...mode.series.map(s => {
				const unpriced = this.chart.mode % 2 === 0 ? this.costSeriesUnknown.get(s.key)?.[point] ?? 0 : this.unpriced[point] ?? 0;
				return `${s.label}: ${mode.unit === "share" ? formatPercent(s.values[point] ?? 0) : mode.unit === "USD" ? `${formatEstimatedCost(s.values[point] ?? 0, unpriced)} · Unknown requests: ${formatInteger(unpriced)}` : `${formatInteger(s.values[point] ?? 0)} ${mode.unit}`}`;
			}));
			if (this.id === "costs" && this.buckets.length) {
				const timestamp = this.buckets[point];
				lines.push(`UTC bucket: ${new Date(timestamp).toISOString()} · Unpriced requests: ${formatInteger(this.unpriced[point] ?? 0)}`);
				// Include unpriced-only identities even when pivotSeries omits zero-cost models.
				for (const p of this.costs?.costSeries ?? []) if (p.timestamp === timestamp) lines.push(`${identity(p.model, p.provider)} · Estimate: ${formatEstimatedCost(p.cost, p.unpricedRequests)} · Requests: ${formatInteger(p.requests)} · Unpriced requests: ${formatInteger(p.unpricedRequests)}`);
			}
		}
		for (let i = 0; i < this.tables.length; i++) {
			const t = this.tables[i];
			lines.push(`${this.focus === i + 1 ? "> " : ""}${t.title}${this.id === "tools" && i === 1 ? ` · Tool filter: ${filter ?? "All tools"}` : ""}`);
			lines.push(...t.state.render(this.rows(i), width, Math.max(12, Math.floor(height / this.tables.length)), r => `${r.label} · ${Object.entries(r.display).filter(([key]) => !["model", "provider", "tool", "key"].includes(key)).map(([key, value]) => `${key}: ${value}`).join(" · ")}`, this.ctx));
		}
		lines.push(`Tab focus · m mode · n/v legend · ,/. point · Enter ${this.id === "tools" ? "select tool/details" : "details"}${this.id === "tools" ? " · f cycle tool filter · x reset" : ""} · b/Esc back/clear · q close`);
		return wrap(lines, width);
	}

	private renderPerformance(key: string, width: number): string[] {
		const points = this.performance.get(key) ?? [];
		if (!points.length) return ["No performance samples. Timing is recorded for streamed responses."];
		this.performanceChart.point = Math.min(this.performanceChart.point, points.length - 1);
		const p = points[this.performanceChart.point];
		const series = [{ key: "tps", label: "Throughput (tok/s)", values: points.map(p => p.avgTokensPerSecond ?? 0) }, { key: "ttft", label: "TTFT (seconds)", values: points.map(p => p.avgTtftSeconds ?? 0) }];
		const lines = [`Performance point ${this.performanceChart.point + 1}/${points.length} · ${new Date(p.timestamp).toISOString()} · Requests: ${formatInteger(p.requests)}`, `Throughput: ${formatTokensPerSecond(p.avgTokensPerSecond)} tok/s · TTFT: ${p.avgTtftSeconds === null ? "—" : `${p.avgTtftSeconds}s`}`, ...series.map((s, i) => `${i === this.performanceChart.seriesIndex % series.length ? ">" : " "} ${this.performanceChart.hidden.has(s.key) ? "off" : "on"} ${s.label}`)];
		// Different units need independent scales, not one mixed tok/s-and-seconds axis.
		for (const s of series) if (!this.performanceChart.hidden.has(s.key)) lines.push(...renderSeriesChart([s], { width: Math.max(1, width), height: 8, preset: this.ctx.theme.getSymbolPreset(), theme: this.ctx.theme, paint: (color, text) => this.ctx.theme.fg(color, text), dim: text => this.ctx.theme.fg("dim", text) }));
		lines.push("n select performance series · v toggle · ,/. inspect performance point");
		return lines;
	}

	get inputMode(): "text" | "navigation" {
		return this.tables[this.focus - 1]?.state.editing ? "text" : "navigation";
	}
	handleInput(data: string): boolean {
		if (this.closed || this.inputMode !== "text" && (data === "q" || data === "[" || data === "]") ||
			data === "\x1b[C" || data === "\x1b[D") return false;
		const active = this.focus > 0 ? this.tables[this.focus - 1] : null;
		let consumed = false;
		if (active?.state.editing && data !== "\t" && data !== "\x1b[Z") consumed = active.state.input(data, this.rows(this.focus - 1));
		else if (data === "\t" || data === "\x1b[Z") {
			if (active) active.state.editing = false;
			this.focus = (this.focus + (data === "\t" ? 1 : this.tables.length)) % (this.tables.length + 1);
			consumed = true;
		} else if (data === "b" || data === "\x1b") {
			if (this.expanded) { this.expanded = null; consumed = true; }
			else if (active?.state.search) { active.state.search = ""; consumed = true; }
			else if (this.toolFilter !== null) { this.toolFilter = null; consumed = true; }
			else if (this.focus !== 0) { this.focus = 0; consumed = true; }
		} else if (this.id === "tools" && (data === "f" || data === "x")) {
			if (data === "x") this.toolFilter = null;
			else this.toolFilter = this.toolNames[this.toolFilter === null ? 0 : this.toolNames.indexOf(this.toolFilter) + 1] ?? null;
			this.expanded = null;
			consumed = true;
		} else if (this.expanded && this.id === "models" && this.performanceChart.input(data, ["tps", "ttft"])) consumed = true;
		else if (data === "m") { this.chart.mode = (this.chart.mode + 1) % Math.max(1, this.modes.length); consumed = true; }
		else if (this.focus === 0) consumed = this.chart.input(data, this.mode()?.series.map(s => s.key) ?? []);
		else if (active) {
			const rows = this.rows(this.focus - 1);
			if (data === "o" || data === "O") {
				if (data === "O") active.state.descending = !active.state.descending;
				else { const keys = Object.keys(sorters(active.rows)); active.state.sort = keys[(keys.indexOf(active.state.sort) + 1) % Math.max(1, keys.length)] ?? active.state.sort; }
				consumed = true;
			} else if (data === "\r" || data === "\n") {
				const selected = active.state.current(rows);
				if (selected) {
					active.state.selected = selected.key;
					if (this.id === "tools" && this.focus === 1) { this.toolFilter = this.toolFilter === selected.tool ? null : selected.tool ?? null; this.expanded = null; }
					else this.expanded = this.expanded?.table === this.focus - 1 && this.expanded.key === selected.key ? null : { table: this.focus - 1, key: selected.key };
				}
				consumed = true;
			} else consumed = active.state.input(data, rows);
		}
		if (consumed) this.ctx.changed();
		return consumed;
	}

	dispose(): void { this.closed = true; this.generation++; }
}

export function createAnalyticsFeature(id: AnalyticsId, ctx: FeatureContext): FeatureController {
	return new AnalyticsFeature(id, ctx);
}
