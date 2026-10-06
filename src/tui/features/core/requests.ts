import type { MessageStats, RequestDetails as Payload } from "@oh-my-pi/omp-stats/client/types";
import { type ErrorGroupView, errorSignature, groupErrorsBySignature, requestStatus, summarizeRequests } from "@oh-my-pi/omp-stats/client/data/view-models";
import { modelKey } from "@oh-my-pi/omp-stats/client/data/colors";
import { formatDurationMs, formatMessageCost, formatTimestamp, formatTokensPerSecond } from "@oh-my-pi/omp-stats/client/data/formatters";
import type { Range } from "../../../data/ranges";
import type { FeatureContext, FeatureController } from "../types";
import { ListState, fields, wrap } from "./shared";

/** Lazy request inspector shared by the overview, request log and failures. */
export class RequestDetails {
	active = false;
	private disposed = false;
	private generation = 0;
	private row: MessageStats | null = null;
	private payload: Payload | null = null;
	private error: string | null = null;
	private notice: string | null = null;
	constructor(private readonly ctx: FeatureContext) {}
	async open(row: MessageStats): Promise<void> {
		if (this.disposed) return;
		const generation = ++this.generation;
		this.active = true;
		this.row = row;
		this.payload = null;
		this.error = null;
		this.notice = null;
		this.ctx.changed();
		if (row.id === undefined) { this.error = "Request has no stored id; full payload unavailable."; this.ctx.changed(); return; }
		try {
			const payload = await this.ctx.reader.api<Payload>(`/api/request/${row.id}`);
			if (this.disposed || !this.active || generation !== this.generation) return;
			this.payload = payload;
		} catch (error) {
			if (this.disposed || !this.active || generation !== this.generation) return;
			this.error = String(error);
		}
		this.ctx.changed();
	}
	render(width: number): string[] | null {
		if (!this.active) return null;
		const lines = [this.ctx.theme.fg("accent", `Request #${this.row?.id ?? "–"} · b/Esc back · c copy JSON · t trace`)];
		if (this.notice) lines.push(this.notice);
		if (!this.payload) return wrap([...lines, this.error ? `Error: ${this.error}` : "Loading request details…"], width);
		const d = this.payload;
		const { messages, output, ...stats } = d;
		lines.push(`${d.model} · ${d.provider} · ${requestStatus(d)}`, ...(d.errorMessage ? [`Error: ${d.errorMessage}`] : []),
			"Timing", `Started: ${formatTimestamp(d.timestamp)}`, `Duration: ${formatDurationMs(d.duration)}`, `Time to first token: ${formatDurationMs(d.ttft)}`,
			`Output tokens/s: ${formatTokensPerSecond(d.duration !== null && d.duration > 0 && d.usage.output > 0 ? d.usage.output * 1000 / d.duration : null)}`,
			"Tokens", ...fields({ uncachedInput: d.usage.input, cacheRead: d.usage.cacheRead, cacheWrite: d.usage.cacheWrite, output: d.usage.output, total: d.usage.totalTokens, premiumRequests: d.usage.premiumRequests ?? 0 }),
			`API-equivalent cost: ${formatMessageCost(d, 4)} · unpriced requests: ${Number(d.costUnpriced ?? false)}`,
			...Object.entries(d.usage.cost).map(([component, value]) => `${component}: ${d.costUnpriced ? "unpriced request; component estimate unavailable" : value}`),
			"Identity", ...fields({ requestId: d.id, entryId: d.entryId, stopReason: d.stopReason, api: d.api, project: d.folder, sessionFile: d.sessionFile }),
			"Output message", JSON.stringify(output, null, 2) ?? "null", "Session entry", JSON.stringify(messages, null, 2), "Stats row", JSON.stringify(stats, null, 2));
		return wrap(lines, width);
	}
	handleInput(data: string): boolean {
		if (!this.active || data === "q") return false;
		if (data === "b" || data === "\x1b") { this.close(); return true; }
		if (data === "t") {
			if (this.payload) { const d = this.payload; this.close(); this.ctx.openTrace(d.sessionFile, d.entryId); }
			return true;
		}
		if (data === "c") {
			if (this.payload) {
				const generation = this.generation;
				void this.ctx.copy(JSON.stringify(this.payload, null, 2)).then(() => this.copied(generation, "JSON copied successfully."), error => this.copied(generation, `Copy failed: ${String(error)}`));
			} else { this.notice = "Copy unavailable until request details load."; this.ctx.changed(); }
			return true;
		}
		return false;
	}
	private copied(generation: number, notice: string): void { if (!this.disposed && this.active && generation === this.generation) { this.notice = notice; this.ctx.changed(); } }
	close(): void { this.active = false; ++this.generation; this.payload = null; this.ctx.changed(); }
	dispose(): void { this.disposed = true; this.active = false; ++this.generation; this.payload = null; }
}

const rowKey = (row: MessageStats) => String(row.id ?? `${row.sessionFile}:${row.entryId}`);
const statuses = ["all", "ok", "aborted", "failed"] as const;
const sorters: Record<string, (row: MessageStats) => string | number> = {
	time: r => r.timestamp, model: r => r.model, provider: r => r.provider, project: r => r.folder,
	input: r => r.usage.input, cacheRead: r => r.usage.cacheRead, cacheWrite: r => r.usage.cacheWrite,
	output: r => r.usage.output, total: r => r.usage.totalTokens, premium: r => r.usage.premiumRequests ?? 0,
	cost: r => r.usage.cost.total, inputCost: r => r.usage.cost.input, outputCost: r => r.usage.cost.output,
	cacheReadCost: r => r.usage.cost.cacheRead, cacheWriteCost: r => r.usage.cost.cacheWrite,
	duration: r => r.duration ?? -1, ttft: r => r.ttft ?? -1, status: requestStatus, error: r => r.errorMessage ?? "",
	id: r => r.id ?? -1, entry: r => r.entryId, session: r => r.sessionFile, api: r => r.api, stop: r => r.stopReason,
	unpriced: r => Number(r.costUnpriced ?? false),
};

export function createRequestsFeature(id: "requests" | "errors", ctx: FeatureContext): FeatureController {
	const details = new RequestDetails(ctx);
	const list = new ListState<MessageStats>(rowKey, "time");
	list.descending = true;
	const signatures = new ListState<ErrorGroupView>(g => g.signature, "count", 12);
	signatures.descending = true;
	const models = new ListState<{ key: string; model: string; provider: string; count: number }>(m => m.key, "count", 12);
	models.descending = true;
	const steps = id === "requests" ? [500, 2000, 10000] : [50, 200, 1000];
	let rows: MessageStats[] = [], range: Range = "24h", step = 0, generation = 0, closed = false, loading = false, error: string | null = null;
	let status = 0, focus = 0, signature: string | null = null, model: string | null = null;
	const groups = () => groupErrorsBySignature(rows);
	const modelRows = () => {
		const map = new Map<string, { key: string; model: string; provider: string; count: number }>();
		for (const row of rows) { const key = modelKey(row.model, row.provider); const found = map.get(key); if (found) found.count++; else map.set(key, { key, model: row.model, provider: row.provider, count: 1 }); }
		return models.rows([...map.values()], { count: m => m.count, model: m => m.model });
	};
	const visible = () => {
		const needle = list.search.trim().toLowerCase();
		const effectiveSignature = groups().some(g => g.signature === signature) ? signature : null;
		const effectiveModel = modelRows().some(m => m.key === model) ? model : null;
		return list.rows(rows.filter(r => (id !== "requests" || status === 0 || requestStatus(r) === statuses[status]) &&
			(id !== "errors" || ((!effectiveSignature || errorSignature(r.errorMessage) === effectiveSignature) && (!effectiveModel || modelKey(r.model, r.provider) === effectiveModel))) &&
			(!needle || [r.model, r.provider, r.folder, ...(id === "errors" ? [r.errorMessage ?? ""] : [])].some(value => value.toLowerCase().includes(needle)))), sorters);
	};
	const load = async (nextRange: Range) => {
		if (closed) return;
		range = nextRange; const request = ++generation; loading = true; error = null; ctx.changed();
		try { const result = await ctx.reader.api<MessageStats[]>(id === "requests" ? "/api/stats/recent" : "/api/stats/errors", { range, limit: String(steps[step]) }); if (closed || request !== generation) return; rows = result; }
		catch (caught) { if (closed || request !== generation) return; error = String(caught); }
		loading = false; ctx.changed();
	};
	return {
		load,
		get inputMode() { return list.editing ? "text" as const : "navigation" as const; },
		render(width, height) {
			const detail = details.render(width); if (detail) return detail;
			const filtered = visible();
			const counts = { all: rows.length, ok: 0, aborted: 0, failed: 0 }; for (const row of rows) counts[requestStatus(row)]++;
			const complete = !loading && !error && rows.length < steps[step];
			const lines = [ctx.theme.fg("accent", `${id === "requests" ? "Requests" : "Errors"} · ${range}`),
				`Loaded ${rows.length} · matching ${filtered.length} · ${complete ? `Complete range: all ${id === "errors" ? "failures" : "requests"} loaded` : `Latest ${rows.length} only; older ${id === "errors" ? "failures" : "requests"} are not loaded`}`,
				`l load ${steps[Math.min(step + 1, steps.length - 1)]} · / search · Esc clear · o sort · O reverse · + reveal · a all · Enter details`,
				`Search: ${list.search}${list.editing ? " ▏" : ""} · sort ${list.sort} ${list.descending ? "descending" : "ascending"}`];
			if (loading) lines.push("Loading… (previous rows retained)"); if (error) lines.push(ctx.theme.fg("error", error));
			const panelHeight = Math.max(3, height - lines.length - 3);
			const failurePanel = [id === "errors" ? "Failures" : "Request log", ...list.render(filtered, width, panelHeight, r => `${formatTimestamp(r.timestamp)} · #${r.id ?? "–"} ${r.model} · ${r.provider} · ${r.folder} · ${requestStatus(r)} · tokens ${r.usage.totalTokens} · ${formatMessageCost(r)} · duration ${formatDurationMs(r.duration)} · TTFT ${formatDurationMs(r.ttft)}${id === "errors" ? ` · ${r.errorMessage ?? ""}` : ""}`, ctx)];
			if (id === "requests") {
				lines.push(`f status: ${statuses[status]} · all ${counts.all} · ok ${counts.ok} · aborted ${counts.aborted} · failed ${counts.failed}`, ...failurePanel, "Loaded request summary", ...fields(summarizeRequests(rows)));
			} else {
				lines.push(`Tab focus: ${["signatures", "models", "failures"][focus]} · Enter select/open · u latest request · f clear filters`, `Signature: ${signature ?? "all"} · model: ${model ?? "all"}`);
				const gs = signatures.rows(groups(), { count: g => g.count });
				const panels = [
					["Error signatures", ...signatures.render(gs, width, panelHeight, g => `${g.count} · ${g.signature} · first ${formatTimestamp(g.firstSeen)} · latest ${formatTimestamp(g.lastSeen)}`, ctx)],
					["Affected models", ...models.render(modelRows(), width, panelHeight, m => `${m.count} · ${m.model} · ${m.provider}`, ctx)],
					failurePanel,
				];
				lines.push(...panels[focus]);
				const expanded = gs.find(group => group.signature === signature);
				if (expanded) {
					lines.push(`Expanded signature: ${expanded.signature}`, `Members: ${expanded.count} · first ${formatTimestamp(expanded.firstSeen)} · last ${formatTimestamp(expanded.lastSeen)}`,
						`Latest error: ${expanded.latest.errorMessage ?? "—"}`,
						...expanded.models.map(member => `${member.model} · ${member.provider}: ${member.count} failures`));
					if (focus !== 2) lines.push(...failurePanel);
				}
				for (let index = 0; index < panels.length; index++) if (index !== focus && !(expanded && index === 2)) lines.push(...panels[index]);
			}
			return wrap(lines, width);
		},
		handleInput(data) {
			if (closed || !list.editing && (data === "q" || data === "[" || data === "]") ||
				data === "\x1b[D" || data === "\x1b[C") return false;
			if (details.active) return details.handleInput(data);
			const filtered = visible();
			if (list.editing) { const consumed = list.input(data, filtered); if (consumed) ctx.changed(); return consumed; }
			if (data === "l") { if (step + 1 < steps.length) { step++; void load(range); } return true; }
			if (data === "f") { if (id === "requests") status = (status + 1) % statuses.length; else { signature = null; model = null; list.search = ""; } ctx.changed(); return true; }
			if (data === "\x1b" && id === "errors" && (signature || model)) { signature = null; model = null; list.search = ""; ctx.changed(); return true; }
			if (data === "o" || data === "O") { if (data === "O") list.descending = !list.descending; else { const keys = Object.keys(sorters); list.sort = keys[(keys.indexOf(list.sort) + 1) % keys.length]; } ctx.changed(); return true; }
			if (id === "errors" && data === "\t") { focus = (focus + 1) % 3; ctx.changed(); return true; }
			if (id === "errors" && data === "u") { const latest = signature ? groups().find(g => g.signature === signature)?.latest : rows.reduce<MessageStats | undefined>((best, r) => !best || r.timestamp > best.timestamp ? r : best, undefined); if (latest) void details.open(latest); return true; }
			if (data === "\r" || data === "\n") {
				if (id === "errors" && focus === 0) { const selected = signatures.current(signatures.rows(groups(), { count: g => g.count })); if (selected) signature = signature === selected.signature ? null : selected.signature; }
				else if (id === "errors" && focus === 1) { const selected = models.current(modelRows()); if (selected) model = model === selected.key ? null : selected.key; }
				else { const selected = list.current(filtered); if (selected) void details.open(selected); }
				ctx.changed(); return true;
			}
			// Search belongs to the failure list regardless of current panel focus.
			const consumed = data === "/" || data === "\x1b" || id === "requests" || focus === 2 ? list.input(data, filtered)
				: focus === 0 ? signatures.input(data, signatures.rows(groups(), { count: g => g.count })) : models.input(data, modelRows());
			if (consumed) ctx.changed(); return consumed;
		},
		dispose() { closed = true; ++generation; details.dispose(); },
	};
}
