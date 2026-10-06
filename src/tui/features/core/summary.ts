import { buildAgentTokenShare, buildFolderRows, sumConversationTokens, requestStatus, type FolderRowView, type FolderTableView } from "@oh-my-pi/omp-stats/client/data/view-models";
import { bucketAxis } from "@oh-my-pi/omp-stats/client/data/range";
import { densify } from "@oh-my-pi/omp-stats/client/data/series";
import { formatCompact, formatEstimatedCost, formatDurationMs, formatPercent, formatTokensPerSecond, formatMessageCost } from "@oh-my-pi/omp-stats/client/data/formatters";
import type { DailyActivityPoint } from "@oh-my-pi/omp-stats/shared-types";
import type { PanelData, RecentRequest as MessageStats } from "../../../data/api";
import type { Range } from "../../../data/ranges";
import type { FeatureContext, FeatureController } from "../types";
import { renderHeatmap, weeksForWidth } from "../../charts/heatmap";
import { calendarLayout } from "../../charts/calendar";
import { glyphsFor } from "../../glyphs";
import { heatRamp } from "../../palette";
import { ChartState, ListState, fields, wrap, type CoreSeries, type Sorters } from "./shared";
import { RequestDetails } from "./requests";

type SummaryId = "overview" | "projects" | "activity";
const PROJECT_SORT: Sorters<FolderRowView> = {
	folder: row => row.folder, cost: row => row.totalCost, requests: row => row.totalRequests,
	tokens: row => row.conversationTokens, cacheRate: row => row.cacheRate, errorRate: row => row.errorRate,
	duration: row => row.avgDuration, ttft: row => row.avgTtft, last: row => row.lastTimestamp,
};
const REQUEST_SORT: Sorters<MessageStats> = {
	time: row => row.timestamp, model: row => `${row.model} ${row.provider}`, project: row => row.folder,
	input: row => row.usage.input, cache: row => row.usage.cacheRead, output: row => row.usage.output,
	cost: row => row.usage.cost.total, duration: row => row.duration, ttft: row => row.ttft, status: requestStatus,
};
const DAY_SORT: Sorters<DailyActivityPoint> = { day: row => row.day, requests: row => row.requests, cost: row => row.cost, tokens: row => row.totalTokens };

export function createSummaryFeature(id: SummaryId, ctx: FeatureContext): FeatureController {
	return new SummaryFeature(id, ctx);
}

class SummaryFeature implements FeatureController {
	private range: Range = "24h";
	private data: PanelData | null = null;
	private loading = false;
	private error: string | null = null;
	private generation = 0;
	private closed = false;
	private focus = 0;
	private hideTemporary = true;
	private expanded: FolderRowView | DailyActivityPoint | null = null;
	private readonly chart = new ChartState();
	private readonly requests = new ListState<MessageStats>(row => String(row.id ?? `${row.sessionFile}:${row.entryId}`), "time", 12);
	private readonly projects = new ListState<FolderRowView>(row => row.folder, "cost", 100);
	private readonly costRanking = new ListState<FolderRowView>(row => row.folder, "cost", 8);
	private readonly requestRanking = new ListState<FolderRowView>(row => row.folder, "requests", 8);
	private readonly days = new ListState<DailyActivityPoint>(row => row.day, "day", 30);
	private readonly details: RequestDetails;
	constructor(private readonly id: SummaryId, private readonly ctx: FeatureContext) { this.details = new RequestDetails(ctx); }
	async load(range: Range): Promise<void> {
		if (this.closed) return;
		this.range = range;
		const generation = ++this.generation;
		this.loading = true;
		this.error = null;
		this.ctx.changed();
		try {
			let data: PanelData;
			if (this.id === "overview") {
				const [overview, recent] = await Promise.all([
					this.ctx.reader.fetch(["overview"], range),
					this.ctx.reader.api<MessageStats[]>("/api/stats/recent", { range, limit: "12" }),
				]);
				data = { ...overview, recent };
			} else data = await this.ctx.reader.fetch([this.id === "projects" ? "folders" : "dailyActivity"], range);
			if (this.closed || generation !== this.generation) return;
			this.data = data;
		} catch (error) {
			if (this.closed || generation !== this.generation) return;
			this.error = error instanceof Error ? error.message : String(error);
		} finally {
			if (!this.closed && generation === this.generation) { this.loading = false; this.ctx.changed(); }
		}
	}
	private overviewChart(): { buckets: number[]; series: CoreSeries[]; mode: string } {
		const points = this.data?.overview?.timeSeries ?? [];
		const buckets = bucketAxis(this.range, points.map(point => point.timestamp), undefined, this.ctx.now());
		const mode = ["requests", "tokens", "cost"][this.chart.mode % 3];
		const series = mode === "requests" ? [
			{ key: "ok", label: "Succeeded", values: densify(points, buckets, point => point.requests - point.errors) },
			{ key: "err", label: "Failed", values: densify(points, buckets, point => point.errors) },
		] : [{ key: mode, label: mode === "cost" ? "API-equivalent cost" : "Tokens", values: densify(points, buckets, point => mode === "cost" ? point.cost : point.tokens) }];
		return { buckets, series, mode };
	}
	private projectRows(): { view: FolderTableView; scoped: FolderRowView[]; matching: FolderRowView[] } {
		const view = buildFolderRows(this.data?.folders ?? []);
		const scoped = this.hideTemporary ? view.rows.filter(row => !row.temporary) : view.rows;
		const needle = this.projects.search.trim().toLowerCase();
		const matching = this.projects.rows(scoped.filter(row => !needle || row.folder.toLowerCase().includes(needle)), PROJECT_SORT);
		return { view, scoped, matching };
	}
	render(width: number, height: number): readonly string[] {
		const detail = this.details.render(width);
		if (detail) return detail;
		if (this.expanded) return wrap([this.ctx.theme.bold(this.id === "projects" ? "Project details" : "Day details"), "b/Esc back · all narrow-table columns below", ...fields(this.expanded)], width);
		const prefix = [this.ctx.theme.bold(`${this.id[0].toUpperCase()}${this.id.slice(1)} · ${this.range}`),
			...(this.loading ? [this.data ? "Refreshing… existing observations are stale." : "Loading… no observations yet."] : []),
			...(this.error ? [this.ctx.theme.fg("error", `Read failed: ${this.error}${this.data ? " · showing stale observations" : ""}`)] : [])];
		if (!this.data) return wrap(prefix, width);
		if (this.id === "overview") {
			const payload = this.data.overview;
			if (!payload) return wrap([...prefix, "Overview payload unavailable."], width);
			const overall = payload.overall;
			const chart = this.overviewChart();
			const needle = this.requests.search.trim().toLowerCase();
			const rows = this.requests.rows((this.data.recent ?? []).filter(row => !needle || `${row.model} ${row.provider} ${row.folder}`.toLowerCase().includes(needle)), REQUEST_SORT);
			const list = [this.ctx.theme.bold("Latest requests · A all requests"), ...this.requests.render(rows, width, height, row => `${row.model} · ${row.provider} · ${requestStatus(row)} · ${formatMessageCost(row, 4)} · ${formatCompact(row.usage.totalTokens)} tok`, this.ctx)];
			const graph = [this.ctx.theme.bold(`Activity · ${chart.mode}`),
				...(chart.mode === "cost" ? [
					`Range cost: ${formatEstimatedCost(overall.totalCost, overall.unpricedRequests)} · unknown ${overall.unpricedRequests} requests`,
					...(overall.unpricedRequests > 0 ? [
						overall.totalCost === 0 ? `No priced cost / unknown ${overall.unpricedRequests}` : "Chart contains only known-priced cost; total usage cost is incomplete.",
						"Selected point is known-priced cost only. Per-bucket unknown counts are not exposed by the overview query.",
					] : []),
				] : []),
				...this.chart.render(this.ctx, width, chart.buckets, chart.series)];
			const total = sumConversationTokens(overall);
			const mix = [["Uncached input", overall.totalInputTokens], ["Cache read", overall.totalCacheReadTokens], ["Cache write", overall.totalCacheWriteTokens], ["Output", overall.totalOutputTokens]] as const;
			const agents = buildAgentTokenShare(payload.byAgentType);
			return wrap([...prefix, `Tab focus: ${this.focus === 0 ? "latest requests" : "activity chart"}`,
				...(this.focus === 0 ? list : graph), "",
				`Requests ${overall.totalRequests} · ${overall.successfulRequests} succeeded · ${overall.failedRequests} failed`,
				`API-equivalent ${formatEstimatedCost(overall.totalCost, overall.unpricedRequests)} · ${overall.unpricedRequests} unpriced`,
				`Conversation tokens ${formatCompact(total)} · Premium requests ${overall.totalPremiumRequests}`,
				`Cache ${formatPercent(overall.cacheRate)} · savings ${formatPercent(overall.cacheSavings)} · error ${formatPercent(overall.errorRate)}`,
				`Latency ${formatDurationMs(overall.avgDuration)} · TTFT ${formatDurationMs(overall.avgTtft)} · ${formatTokensPerSecond(overall.avgTokensPerSecond)}`,
				"Token mix (all four conversation-token categories)", ...mix.map(([label, value]) => `${label}: ${formatCompact(value)} · ${total > 0 ? formatPercent(value / total) : "—"}`),
				"Agent token shares (not request shares)", ...agents.segments.map(agent => `${agent.agentType}: ${formatCompact(agent.tokens)} tok · ${formatPercent(agent.share)} · ${agent.requests} requests`),
				"", ...(this.focus === 0 ? graph : list)], width);
		}
		if (this.id === "projects") {
			const { view, scoped, matching } = this.projectRows();
			const cost = this.costRanking.rows(scoped, PROJECT_SORT).slice(0, 8);
			const requests = this.requestRanking.rows(scoped, PROJECT_SORT).slice(0, 8);
			const label = (row: FolderRowView): string => `${row.folder || "(root)"}${row.temporary ? " [temp]" : ""} · ${row.totalRequests} req · ${formatEstimatedCost(row.totalCost, row.unpricedRequests)} · ${formatCompact(row.conversationTokens)} tok`;
			const sections = [
				[this.ctx.theme.bold("Folders"), ...this.projects.render(matching, width, height, label, this.ctx)],
				[this.ctx.theme.bold("Top by cost · Enter filters folders"), ...this.costRanking.render(cost, width, Math.min(height, 16), row => `${row.folder} · ${formatEstimatedCost(row.totalCost, row.unpricedRequests)} · ${formatPercent(row.costShare)}`, this.ctx)],
				[this.ctx.theme.bold("Top by requests · Enter filters folders"), ...this.requestRanking.render(requests, width, Math.min(height, 16), row => `${row.folder} · ${row.totalRequests} req · ${formatPercent(row.requestShare)}`, this.ctx)],
			];
			return wrap([...prefix, `Tab focus: ${["folders", "cost ranking", "request ranking"][this.focus]} · t ${this.hideTemporary ? "show" : "hide"} temporary folders`,
				`Unfiltered totals: ${view.rows.length} folders (${view.temporaryCount} temporary) · ${view.totalRequests} requests · ${view.failedRequests} failed`,
				`Unfiltered cost ${formatEstimatedCost(view.totalCost, view.unpricedRequests)} · ${view.unpricedRequests} unpriced · ${formatCompact(view.conversationTokens)} tokens · cache ${formatPercent(view.cacheRate)}`,
				...sections[this.focus], ...sections.filter((_, index) => index !== this.focus).flatMap(section => ["", ...section])], width);
		}
		const points = this.data.dailyActivity ?? [];
		const weeks = weeksForWidth(2, width);
		const today = new Date(this.ctx.now());
		const layout = calendarLayout(points, weeks, today);
		const needle = this.days.search.trim().toLowerCase();
		const rows = this.days.rows(points.filter(point => !needle || point.day.includes(needle)), DAY_SORT);
		const list = [this.ctx.theme.bold("Recorded calendar days"), ...this.days.render(rows, width, height, point => `${point.day} · ${point.requests} req · ${formatEstimatedCost(point.cost, 0)} · ${formatCompact(point.totalTokens)} tok`, this.ctx)];
		const calendar = [this.ctx.theme.bold("Local-day activity calendar"),
			...renderHeatmap(points, { innerWidth: width, labelWidth: 2, weeks, glyphs: glyphsFor(this.ctx.theme.getSymbolPreset()), ramp: [1, 2, 3, 4].map(level => heatRamp(this.ctx.theme, level)), dim: text => this.ctx.theme.fg("dim", text), today }),
			`Visible ${weeks} weeks: ${layout.totalRequests} requests · ${formatEstimatedCost(layout.totalCost, 0)}`];
		return wrap([...prefix, "Calendar reads the latest 371 local days, independently of the stats range selector.",
			"Narrow calendars show fewer weeks; every fetched recorded day remains reachable below.",
			`Tab focus: ${this.focus === 0 ? "recorded days" : "calendar"}`,
			...(points.length === 0 ? ["No recorded daily activity in the calendar lookback."] : []),
			...(this.focus === 0 ? list : calendar), "", ...(this.focus === 0 ? calendar : list)], width);
	}
	get inputMode(): "text" | "navigation" {
		return (this.id === "overview" ? this.requests.editing : this.id === "projects" ? this.projects.editing : this.days.editing)
			? "text" : "navigation";
	}
	handleInput(data: string): boolean {
		if (this.closed || data === "q" && this.inputMode !== "text") return false;
		if (this.details.active) return this.details.handleInput(data);
		if (this.expanded) {
			if (data === "b" || data === "\x1b") { this.expanded = null; this.ctx.changed(); return true; }
			return false;
		}
		let handled = false;
		if (this.id === "overview") {
			const needle = this.requests.search.trim().toLowerCase();
			const rows = this.requests.rows((this.data?.recent ?? []).filter(row => !needle || `${row.model} ${row.provider} ${row.folder}`.toLowerCase().includes(needle)), REQUEST_SORT);
			if (this.requests.editing) handled = this.requests.input(data, rows);
			else if (data === "A") { this.ctx.openScreen("requests"); handled = true; }
			else if (data === "\t") { this.focus = (this.focus + 1) % 2; handled = true; }
			else if (this.focus === 1 && data === "m") { this.chart.mode = (this.chart.mode + 1) % 3; handled = true; }
			else if (this.focus === 1) handled = this.chart.input(data, this.overviewChart().series.map(series => series.key));
			else if (data === "\r" || data === "\n") { const row = this.requests.current(rows); if (row) void this.details.open(row); handled = true; }
			else if (data === "o" || data === "O") {
				if (data === "O") this.requests.descending = !this.requests.descending;
				else { const sorts = Object.keys(REQUEST_SORT); this.requests.sort = sorts[(sorts.indexOf(this.requests.sort) + 1) % sorts.length]; }
				handled = true;
			} else handled = this.requests.input(data, rows);
		} else if (this.id === "projects") {
			const { scoped, matching } = this.projectRows();
			const list = [this.projects, this.costRanking, this.requestRanking][this.focus];
			const rows = this.focus === 0 ? matching : list.rows(scoped, PROJECT_SORT).slice(0, 8);
			if (this.projects.editing) handled = this.projects.input(data, matching);
			else if (data === "\t") { this.focus = (this.focus + 1) % 3; handled = true; }
			else if (data === "t") { this.hideTemporary = !this.hideTemporary; handled = true; }
			else if (data === "/") { this.focus = 0; handled = this.projects.input(data, matching); }
			else if (data === "\r" || data === "\n") {
				const row = list.current(rows);
				if (row) { if (this.focus === 0) this.expanded = row; else { this.projects.search = row.folder; this.projects.selected = row.folder; this.focus = 0; } }
				handled = true;
			} else if (data === "o" || data === "O") {
				if (data === "O") list.descending = !list.descending;
				else { const sorts = Object.keys(PROJECT_SORT); list.sort = sorts[(sorts.indexOf(list.sort) + 1) % sorts.length]; }
				handled = true;
			} else if (data === "\x1b" && this.projects.search) { this.projects.search = ""; handled = true; }
			else handled = list.input(data, rows);
		} else {
			const points = this.data?.dailyActivity ?? [];
			const rows = this.days.rows(points.filter(point => !this.days.search || point.day.includes(this.days.search.trim())), DAY_SORT);
			if (this.days.editing) handled = this.days.input(data, rows);
			else if (data === "\t") { this.focus = (this.focus + 1) % 2; handled = true; }
			else if (data === "/") { this.focus = 0; handled = this.days.input(data, rows); }
			else if (this.focus === 0 && (data === "\r" || data === "\n")) { this.expanded = this.days.current(rows) ?? null; handled = true; }
			else if (this.focus === 0 && (data === "o" || data === "O")) {
				if (data === "O") this.days.descending = !this.days.descending;
				else { const sorts = Object.keys(DAY_SORT); this.days.sort = sorts[(sorts.indexOf(this.days.sort) + 1) % sorts.length]; }
				handled = true;
			} else if (this.focus === 0) handled = this.days.input(data, rows);
		}
		if (handled) this.ctx.changed();
		return handled;
	}
	dispose(): void { this.closed = true; this.generation++; this.details.dispose(); }
}
