import type { ProviderAggregate, ProviderDashboardStats, ProviderWindowInsight, ProviderWindowStats, UsageWindowSeries } from "@oh-my-pi/omp-stats/shared-types";
import type { Range } from "../../data/ranges";
import { compactTokens, costWithUnpriced, formatCost, formatInteger, formatPercent } from "../format";
import { SERIES_COLORS } from "../palette";
import type { FeatureContext, FeatureController } from "./types";
import { accountNames, accountReadings, rangeAxis, rangeStep, resolveWindow, utilization, type AccountReadings, type WindowRef } from "./provider-gain-data";
import { boundLines, recordViewport, timeline } from "./provider-gain-chart";
import { densify, pivotSeries } from "@oh-my-pi/omp-stats/client/data/series";
import { renderSparkline } from "../charts/sparkline";

const VIEWS = ["Provider totals", "Burn by provider", "Peak local hours", "Subscription windows", "Account utilization"];
const METRICS = ["tokens", "output", "requests", "cost"] as const;
const TOTAL_SORTS = ["tokens", "provider", "requests", "errors", "models", "share", "output", "cost", "premium", "speed"];
const WINDOW_SORTS = ["consumed", "window", "accounts", "cycles", "capacity", "peak", "ideal", "exhausted"];
const ACCOUNT_SORTS = ["latest", "account", "window", "status", "peak", "samples", "recorded", "resets"];
type AccountRow = AccountReadings & { series: UsageWindowSeries; name: string };

export function createProvidersFeature(ctx: FeatureContext): FeatureController {
	let range: Range = "24h";
	let data: ProviderDashboardStats | null = null;
	let insights: ProviderWindowInsight[] | null = null;
	let accountData: ProviderWindowStats | null = null;
	let picked: WindowRef | null = null;
	let accountProvider: string | null = null;
	let localGeneration = 0;
	let windowsGeneration = 0;
	let accountsGeneration = 0;
	let closed = false;
	let localLoading = false;
	let windowsLoading = false;
	let accountsLoading = false;
	let localError: string | null = null;
	let windowsError: string | null = null;
	let accountsError: string | null = null;
	let view = 0;
	let row = 0;
	let providerRow = 0;
	let expanded: string | null = null;
	let metric = 0;
	let point = -1;
	let utilPoint = -1;
	let hour = 0;
	let peakProvider: string | null = null;
	let legend = 0;
	let reveal = 12;
	let totalSort = 0;
	let windowSort = 0;
	let accountSort = 0;
	let descending = true;
	let selectedAccount: string | null = null;
	const hiddenBurn = new Set<string>();
	const hiddenAccounts = new Set<string>();

	function sortedTotals(): ProviderAggregate[] {
		const key = TOTAL_SORTS[totalSort];
		const value = (p: ProviderAggregate): string | number => key === "provider" ? p.provider : key === "requests" ? p.totalRequests : key === "errors" ? p.totalRequests > 0 ? p.failedRequests / p.totalRequests : 0 : key === "models" ? p.models : key === "output" ? p.totalOutputTokens : key === "cost" ? p.totalCost : key === "premium" ? p.totalPremiumRequests : key === "speed" ? p.avgTokensPerSecond ?? -1 : p.totalTokens;
		return [...data?.providers ?? []].sort((a, b) => {
			const av = value(a), bv = value(b);
			return (typeof av === "string" && typeof bv === "string" ? av.localeCompare(bv) : Number(av) - Number(bv)) * (descending ? -1 : 1);
		});
	}
	function sortedWindows(): ProviderWindowInsight[] {
		const key = WINDOW_SORTS[windowSort];
		const value = (i: ProviderWindowInsight): string | number => key === "window" ? `${i.provider} ${i.windowLabel}` : key === "accounts" ? i.accounts : key === "cycles" ? i.cycles : key === "capacity" ? i.estTokensPerWindow ?? -1 : key === "peak" ? i.peakConcurrentFraction : key === "ideal" ? i.idealAccounts - i.accounts : key === "exhausted" ? i.exhaustedEvents : i.fractionConsumed;
		return [...insights ?? []].sort((a, b) => {
			const av = value(a), bv = value(b);
			return (typeof av === "string" && typeof bv === "string" ? av.localeCompare(bv) : Number(av) - Number(bv)) * (descending ? -1 : 1);
		});
	}
	function accountRows(): AccountRow[] {
		const series = (accountData?.usageSeries ?? []).filter(s => s.provider === picked?.provider && accountProvider === picked?.provider);
		const names = accountNames(series);
		const key = ACCOUNT_SORTS[accountSort];
		const value = (r: AccountRow): string | number => key === "account" ? r.name : key === "window" ? r.series.windowLabel : key === "status" ? r.latest?.exhausted ? 2 : (r.latest?.fraction ?? 0) >= 0.8 ? 1 : 0 : key === "peak" ? r.peak ?? -1 : key === "samples" ? r.samples : key === "recorded" ? r.latest?.timestamp ?? 0 : key === "resets" ? r.resets : r.latest?.fraction ?? -1;
		return series.map(s => ({ ...accountReadings(s), series: s, name: names.get(s.accountKey) ?? s.accountLabel })).sort((a, b) => {
			const av = value(a), bv = value(b);
			return (typeof av === "string" && typeof bv === "string" ? av.localeCompare(bv) : Number(av) - Number(bv)) * (descending ? -1 : 1);
		});
	}
	function burn() {
		const axis = rangeAxis(range, (data?.series ?? []).map(p => p.timestamp), ctx.now());
		const step = rangeStep(range);
		const metricName = METRICS[metric];
		const value = (p: ProviderDashboardStats["series"][number]): number | null => metricName === "tokens" ? p.totalTokens : metricName === "requests" ? p.requests : metricName === "cost" ? p.cost : (p as typeof p & { outputTokens?: number }).outputTokens ?? null;
		const rows = pivotSeries((data?.series ?? []).filter(p => value(p) !== null), {
			buckets: axis,
			key: p => `provider:${p.provider}`,
			label: key => key.slice("provider:".length),
			value: p => value(p)!,
			limit: 6,
		}).map(s => ({ key: s.key, label: s.label, values: s.values.map(v => v || null) }));
		return { axis, rows, step, metricName, value };
	}
	async function loadAccounts(provider: string): Promise<void> {
		const request = ++accountsGeneration;
		const requestedRange = range;
		if (accountProvider !== provider) { accountData = null; selectedAccount = null; row = 0; }
		accountProvider = provider; accountsLoading = true; accountsError = null; ctx.changed();
		try {
			const next = await ctx.reader.api<ProviderWindowStats>("/api/stats/provider-windows", { range: requestedRange, provider });
			if (closed || request !== accountsGeneration || picked?.provider !== provider || range !== requestedRange) return;
			accountData = next;
			const rows = accountRows();
			const retained = rows.findIndex(r => JSON.stringify([r.series.windowKey, r.series.accountKey]) === selectedAccount);
			row = retained >= 0 ? retained : Math.max(0, rows.findIndex(r => r.series.windowKey === picked?.windowKey));
			utilPoint = -1;
		} catch (cause) {
			if (closed || request !== accountsGeneration) return;
			accountsError = cause instanceof Error ? cause.message : String(cause);
		} finally { if (!closed && request === accountsGeneration) { accountsLoading = false; ctx.changed(); } }
	}
	function selectWindow(next: WindowRef): void {
		const changedProvider = next.provider !== picked?.provider;
		picked = next; utilPoint = -1;
		if (changedProvider || accountProvider !== next.provider || (!accountData && !accountsLoading)) void loadAccounts(next.provider);
	}
	async function loadWindows(): Promise<void> {
		const request = ++windowsGeneration;
		const requestedRange = range;
		windowsLoading = true; windowsError = null; ctx.changed();
		try {
			const next = await ctx.reader.api<ProviderWindowStats>("/api/stats/provider-windows", { range: requestedRange });
			if (closed || request !== windowsGeneration || range !== requestedRange) return;
			insights = next.windowInsights;
			const resolved = resolveWindow(insights, picked);
			if (resolved) { selectWindow(resolved); if (!accountsLoading) void loadAccounts(resolved.provider); }
			else { picked = null; accountData = null; accountProvider = null; accountsGeneration++; accountsLoading = false; }
		} catch (cause) {
			if (closed || request !== windowsGeneration) return;
			windowsError = cause instanceof Error ? cause.message : String(cause);
		} finally { if (!closed && request === windowsGeneration) { windowsLoading = false; ctx.changed(); } }
	}
	async function load(nextRange: Range): Promise<void> {
		if (closed) return;
		if (range !== nextRange) {
			data = null; insights = null; accountData = null; accountsGeneration++; accountsLoading = false; point = -1; utilPoint = -1;
		}
		range = nextRange;
		const request = ++localGeneration;
		localLoading = true; localError = null;
		try {
			const localRead = ctx.reader.api<ProviderDashboardStats>("/api/stats/providers", { range });
			void loadWindows();
			const next = await localRead;
			if (closed || request !== localGeneration) return;
			data = next;
			const axis = rangeAxis(range, next.series.map(p => p.timestamp), ctx.now());
			point = point < 0 ? axis.length - 1 : Math.min(point, axis.length - 1);
			if (peakProvider && !next.providers.some(p => p.provider === peakProvider)) peakProvider = null;
			providerRow = Math.min(providerRow, Math.max(0, next.providers.length - 1));
		} catch (cause) {
			if (closed || request !== localGeneration) return;
			localError = cause instanceof Error ? cause.message : String(cause);
		} finally { if (!closed && request === localGeneration) { localLoading = false; ctx.changed(); } }
	}

	return {
		load,
		render(width, height) {
			const lines = [ctx.theme.bold(`Providers · ${range} · ${VIEWS[view]}`), ctx.theme.fg("dim", "Tab/v view · j/k select · Enter expand/select · m metric · h/l point · p/P provider · w/W window"), ctx.theme.fg("dim", "o sort · d direction · + reveal · n/N legend · Space hide/show · u retry windows")];
			lines.push(`Local ${localLoading ? "loading" : localError ? "error" : "ready"} · windows ${windowsLoading ? "loading independently" : windowsError ? "error" : insights === null ? "not loaded" : "ready"} · accounts ${accountsLoading ? "loading independently" : accountsError ? "error" : accountData ? "ready" : "not loaded"}`);
			if (localError) lines.push(ctx.theme.fg("error", `Local usage: ${localError}`));
			if (windowsError) lines.push(ctx.theme.fg("warning", `Subscription snapshots: ${windowsError} (local usage remains available)`));
			if (accountsError && view === 4) lines.push(ctx.theme.fg("warning", `Account snapshots: ${accountsError}`));
			if (data) {
				const totals = data.providers.reduce((t, p) => ({ tokens: t.tokens + p.totalTokens, requests: t.requests + p.totalRequests, failed: t.failed + p.failedRequests, cost: t.cost + p.totalCost, unpriced: t.unpriced + p.unpricedRequests }), { tokens: 0, requests: 0, failed: 0, cost: 0, unpriced: 0 });
				lines.push(`${data.providers.length} providers · ${compactTokens(totals.tokens)} tokens · ${formatInteger(totals.requests)} requests · ${formatPercent(totals.requests > 0 ? totals.failed / totals.requests : 0)} errors`, `API-equivalent cost ${costWithUnpriced(totals.cost, totals.unpriced)} (not subscription billing)`);
				const top = data.providers.reduce<ProviderAggregate | null>((best, p) => !best || p.totalTokens > best.totalTokens ? p : best, null);
				lines.push(`Most tokens: ${top?.provider ?? "—"} · ${formatInteger(totals.failed)} failed · ${formatInteger(totals.requests - totals.failed)} succeeded`);
				if (view === 1) {
					const axis = rangeAxis(range, data.series.map(p => p.timestamp), ctx.now());
					const values = [densify(data.series, axis, p => p.requests), densify(data.series, axis, p => p.totalTokens), densify(data.series, axis, p => p.cost)];
					lines.push(...values.map((v, i) => `${["Requests", "Tokens", "API-equivalent cost"][i]} ${renderSparkline(v, {
						width: Math.max(1, Math.min(30, width - 22)), preset: ctx.theme.getSymbolPreset(),
						accent: cell => ctx.theme.fg(SERIES_COLORS[i % SERIES_COLORS.length], cell),
					})}`));
				}
			}
			if (view <= 2 && !data) { lines.push(localLoading ? "Loading local usage…" : "No local usage payload available"); return boundLines(lines, width); }
			if (view === 0) {
				const rows = sortedTotals(); providerRow = Math.max(0, Math.min(providerRow, rows.length - 1));
				const p = rows[providerRow];
				if (p) {
					lines.push(ctx.theme.bold(`Selected ${p.provider}`), `${formatInteger(p.totalRequests)} requests · ${formatInteger(p.failedRequests)} failed · ${p.models} models · ${formatInteger(p.totalPremiumRequests)} premium · ${p.avgTokensPerSecond === null ? "—" : p.avgTokensPerSecond.toFixed(1)} tok/s`);
					const totalTokens = data!.providers.reduce((sum, provider) => sum + provider.totalTokens, 0);
					lines.push(`${formatInteger(p.totalTokens)} tokens · share ${formatPercent(totalTokens > 0 ? p.totalTokens / totalTokens : 0)} · errors ${formatPercent(p.totalRequests > 0 ? p.failedRequests / p.totalRequests : 0)}`, `Output ${formatInteger(p.totalOutputTokens)} · API-equivalent cost ${costWithUnpriced(p.totalCost, p.unpricedRequests)}`);
					if (expanded === p.provider) {
						const mix = [["Uncached input", p.totalInputTokens], ["Cache read", p.totalCacheReadTokens], ["Cache write", p.totalCacheWriteTokens], ["Output", p.totalOutputTokens]] as const;
						let cells = 0;
						const track = Math.max(1, Math.min(48, width - 2));
						lines.push(mix.map(([_, value], i) => { const next = Math.round(mix.slice(0, i + 1).reduce((sum, [, n]) => sum + n, 0) / Math.max(1, p.totalTokens) * track); const text = ctx.theme.fg(SERIES_COLORS[i % SERIES_COLORS.length], "█".repeat(Math.max(0, next - cells))); cells = next; return text; }).join(""));
						mix.forEach(([label, value], i) => lines.push(`${ctx.theme.fg(SERIES_COLORS[i % SERIES_COLORS.length], "■")} ${label}: ${formatInteger(value)} · ${p.totalTokens > 0 ? formatPercent(value / p.totalTokens) : "—"}`));
					}
				}
				lines.push(`Sort ${TOTAL_SORTS[totalSort]} ${descending ? "↓" : "↑"} · ${Math.min(reveal, rows.length)}/${rows.length}`, "Provider | Requests | Tokens | Output | API-equivalent cost");
				const viewport = recordViewport(rows, providerRow, height, reveal);
				lines.push(...viewport.rows.map((p, i) => `${viewport.start + i === providerRow ? "▶" : " "} ${p.provider} | ${formatInteger(p.totalRequests)} | ${compactTokens(p.totalTokens)} | ${compactTokens(p.totalOutputTokens)} | ${costWithUnpriced(p.totalCost, p.unpricedRequests)}`));
				if (!rows.length) lines.push("No provider activity in this range");
			} else if (view === 1) {
				const chart = burn(); point = Math.max(0, Math.min(chart.axis.length - 1, point));
				lines.push(`Metric ${chart.metricName} · ${chart.step < 3_600_000 ? "5 minutes" : chart.step < 86_400_000 ? "hour" : "day"} · top six + Other`);
				if (chart.metricName === "output" && data!.series.some(p => (p as typeof p & { outputTokens?: number }).outputTokens === undefined)) lines.push("Output burn unavailable for older payload points (gaps, not zero).");
				const ts = chart.axis[point];
				lines.push(`Point ${new Date(ts).toISOString()} · legend ${chart.rows[legend % Math.max(1, chart.rows.length)]?.label ?? "none"}`);
				for (const p of data!.series.filter(p => Math.floor(p.timestamp / chart.step) * chart.step === ts)) {
					const value = chart.value(p);
					lines.push(`${p.provider}: ${chart.metricName === "cost" ? costWithUnpriced(p.cost, p.unpricedRequests) : value === null ? "No reading" : formatInteger(value)} ${chart.metricName === "cost" ? "API-equivalent" : chart.metricName}`);
				}
				lines.push(...timeline(ctx, chart.axis, chart.rows, width, point, { hidden: hiddenBurn, stacked: true, format: chart.metricName === "cost" ? formatCost : undefined }));
			} else if (view === 2) {
				const hours = Array.from({ length: 24 }, () => ({ tokens: 0, output: 0, requests: 0 }));
				for (const p of data!.hourly) if (peakProvider === null || p.provider === peakProvider) { hours[p.hour].tokens += p.totalTokens; hours[p.hour].output += p.outputTokens; hours[p.hour].requests += p.requests; }
				const peak = hours.reduce((best, p, i) => p.tokens > hours[best].tokens ? i : best, 0);
				lines.push(`Provider ${peakProvider ?? "All providers"} · peak ${hours[peak].tokens > 0 ? `${String(peak).padStart(2, "0")}:00` : "none"}`, `Hour ${String(hour).padStart(2, "0")}:00 local · ${formatInteger(hours[hour].tokens)} tokens · ${formatInteger(hours[hour].output)} output · ${formatInteger(hours[hour].requests)} requests`);
				const max = Math.max(0, ...hours.map(p => p.tokens));
				const track = Math.max(1, Math.min(36, width - 25));
				for (let i = Math.max(0, hour - 4); i < Math.min(24, Math.max(9, hour + 5)); i++) lines.push(`${i === hour ? "▶" : " "} ${String(i).padStart(2, "0")} ${ctx.theme.fg(i === peak ? "warning" : "success", "█".repeat(Math.max(1, max > 0 ? Math.round(hours[i].tokens / max * track) : 1)))} ${compactTokens(hours[i].tokens)}`);
				lines.push("h/l selects all 24 local hours; p/P changes provider. Peak mark uses warning ink.");
			} else if (view === 3) {
				if (insights === null) lines.push(windowsLoading ? "Loading subscription windows (you can still switch views)…" : "Subscription window payload unavailable");
				const rows = sortedWindows();
				const selected = rows.findIndex(i => i.provider === picked?.provider && i.windowKey === picked?.windowKey);
				const i = rows[selected];
				if (i) lines.push(ctx.theme.bold(`${i.provider} · ${i.windowLabel}`), `Windows burned ${i.fractionConsumed.toFixed(2)} · resets ${i.cycles} · capacity ${i.estTokensPerWindow === null ? "— (too little consumed to estimate)" : `${compactTokens(i.estTokensPerWindow)} tokens/window`}`, `Peak ${formatPercent(i.peakConcurrentFraction)} summed · fleet ${i.accounts} accounts · fleet load ${i.accounts ? formatPercent(i.peakConcurrentFraction / i.accounts) : "—"}`, `Accounts needed ${i.idealAccounts} at <90% · have ${i.accounts} · ${i.idealAccounts > i.accounts ? `short ${i.idealAccounts - i.accounts}` : `headroom ${i.accounts - i.idealAccounts}`} · exhaustions ${i.exhaustedEvents}`);
				lines.push(`Sort ${WINDOW_SORTS[windowSort]} ${descending ? "↓" : "↑"} · ${Math.min(reveal, rows.length)}/${rows.length}`, "Provider / window | Accounts | Burned | Capacity | Exhaustions");
				const viewport = recordViewport(rows, Math.max(0, selected), height, reveal);
				lines.push(...viewport.rows.map((i, n) => `${viewport.start + n === selected ? "▶" : " "} ${i.provider} / ${i.windowLabel} | ${i.accounts} | ${i.fractionConsumed.toFixed(2)} | ${i.estTokensPerWindow === null ? "—" : compactTokens(i.estTokensPerWindow)} | ${i.exhaustedEvents}`));
				if (insights && !insights.length) lines.push("No usage snapshots in this range. Snapshots accumulate when limits are fetched (footer, /usage, omp usage).");
				lines.push("Capacity uses upstream broker fleet tokens when present, otherwise local provider tokens; it is an estimate, not billing.");
			} else {
				lines.push(`Provider ${picked?.provider ?? "—"} · window ${insights?.find(i => i.provider === picked?.provider && i.windowKey === picked?.windowKey)?.windowLabel ?? "—"}`);
				if (!picked) lines.push(insights?.length === 0 ? "No usage snapshots in this range" : "Waiting for subscription windows");
				else if (!accountData) lines.push(accountsLoading ? "Loading account histories (input remains active)…" : "No account-history payload available");
				const rows = accountRows();
				const retained = rows.findIndex(r => JSON.stringify([r.series.windowKey, r.series.accountKey]) === selectedAccount);
				row = retained >= 0 ? retained : Math.max(0, Math.min(row, rows.length - 1));
				const current = rows[row];
				if (current) {
					selectedAccount = JSON.stringify([current.series.windowKey, current.series.accountKey]);
					lines.push(ctx.theme.bold(`${current.name} · ${current.series.windowLabel}`), `Account key ${current.series.accountKey}`, `Latest ${current.latest ? `${formatPercent(current.latest.fraction)} · ${new Date(current.latest.timestamp).toISOString()} · ${current.latest.exhausted ? "EXHAUSTED" : current.latest.fraction >= 0.8 ? "HIGH" : "OK"}` : "No numeric reading"}`, `Peak ${current.peak === null ? "—" : formatPercent(current.peak)} · headroom ${current.latest ? formatPercent(1 - current.latest.fraction) : "—"} · resets ${current.resets} · snapshots ${current.samples}`);
				}
				const matching = rows.filter(r => r.series.windowKey === picked?.windowKey).sort((a, b) => a.name.localeCompare(b.name));
				const chart = utilization(matching.map(r => r.series));
				utilPoint = utilPoint < 0 ? chart.axis.length - 1 : Math.min(utilPoint, chart.axis.length - 1);
				const chartRows = chart.rows.map(r => ({ ...r, label: matching.find(a => a.series.accountKey === r.key)?.name ?? r.key }));
				if (chart.axis.length) {
					lines.push(`Utilization ${new Date(chart.axis[Math.max(0, utilPoint)]).toISOString()} · legend ${chartRows[legend % Math.max(1, chartRows.length)]?.label ?? "none"} · 100% = exhausted capacity`);
					for (const r of chartRows) lines.push(`${r.label}: ${r.values[utilPoint] === null ? "No reading (gap)" : formatPercent(r.values[utilPoint]!, 1)}${chart.exhausted[utilPoint]?.includes(r.key) ? " · EXHAUSTED" : ""}`);
					lines.push(...timeline(ctx, chart.axis, chartRows, width, utilPoint, { hidden: hiddenAccounts, percent: true }));
				} else if (accountData) lines.push("No utilization readings for this window");
				lines.push("Readings hold at most six hours; longer silence is a gap, not zero.", `Accounts / all provider windows · sort ${ACCOUNT_SORTS[accountSort]} ${descending ? "↓" : "↑"} · ${Math.min(reveal, rows.length)}/${rows.length}`, "Account / window | Latest | Peak | Snapshots | Resets");
				const viewport = recordViewport(rows, row, height, reveal);
				lines.push(...viewport.rows.map((r, i) => `${viewport.start + i === row ? "▶" : " "} ${r.name} / ${r.series.windowLabel} | ${r.latest ? formatPercent(r.latest.fraction) : "—"}${r.latest?.exhausted ? " exhausted" : ""} | ${r.peak === null ? "—" : formatPercent(r.peak)} | ${r.samples} | ${r.resets}`));
			}
			return boundLines(lines, width);
		},
		handleInput(input) {
			if (closed || input === "q") return false;
			if (input === "\t" || input === "v") { view = (view + 1) % VIEWS.length; legend = 0; }
			else if (input === "m") metric = (metric + 1) % METRICS.length;
			else if (input === "o") { if (view === 0) totalSort = (totalSort + 1) % TOTAL_SORTS.length; else if (view === 3) windowSort = (windowSort + 1) % WINDOW_SORTS.length; else if (view === 4) accountSort = (accountSort + 1) % ACCOUNT_SORTS.length; else return false; }
			else if (input === "d") descending = !descending;
			else if (input === "+" || input === "=") reveal += view === 4 ? 16 : 12;
			else if (input === "u") { void loadWindows(); if (picked) void loadAccounts(picked.provider); }
			else if (input === "p" || input === "P") {
				const choices: (string | null)[] = view === 2 ? [null, ...(data?.providers.map(p => p.provider) ?? [])] : [...new Set((insights ?? []).map(i => i.provider))];
				if (choices.length) {
					const current = view === 2 ? peakProvider : picked?.provider ?? null;
					const next = choices[(Math.max(0, choices.indexOf(current)) + (input === "p" ? 1 : choices.length - 1)) % choices.length];
					if (view === 2) peakProvider = next;
					else { const i = insights?.find(i => i.provider === next); if (i) selectWindow(i); }
				}
			} else if (input === "w" || input === "W") {
				const choices = (insights ?? []).filter(i => i.provider === picked?.provider);
				if (choices.length) { const index = choices.findIndex(i => i.windowKey === picked?.windowKey); selectWindow(choices[(Math.max(0, index) + (input === "w" ? 1 : choices.length - 1)) % choices.length]); }
			} else if (input === "h" || input === "l") {
				const delta = input === "l" ? 1 : -1;
				if (view === 1) point = Math.max(0, Math.min(burn().axis.length - 1, point + delta));
				else if (view === 2) hour = (hour + delta + 24) % 24;
				else if (view === 4) { const chart = utilization(accountRows().filter(r => r.series.windowKey === picked?.windowKey).map(r => r.series)); utilPoint = Math.max(0, Math.min(chart.axis.length - 1, (utilPoint < 0 ? chart.axis.length - 1 : utilPoint) + delta)); }
				else return false;
			} else if (input === "j" || input === "k" || input === "\x1b[A" || input === "\x1b[B") {
				const delta = input === "j" || input === "\x1b[B" ? 1 : -1;
				if (view === 0) providerRow = Math.max(0, Math.min(sortedTotals().length - 1, providerRow + delta));
				else if (view === 2) hour = (hour + delta + 24) % 24;
				else if (view === 3) { const rows = sortedWindows(); const index = rows.findIndex(i => i.provider === picked?.provider && i.windowKey === picked?.windowKey); const next = rows[Math.max(0, Math.min(rows.length - 1, index + delta))]; if (next) selectWindow(next); }
				else if (view === 4) { const rows = accountRows(); row = Math.max(0, Math.min(rows.length - 1, row + delta)); const r = rows[row]; if (r) selectedAccount = JSON.stringify([r.series.windowKey, r.series.accountKey]); }
				else return this.handleInput(delta > 0 ? "l" : "h");
			} else if (input === "n" || input === "N") { const count = view === 1 ? burn().rows.length : accountRows().filter(r => r.series.windowKey === picked?.windowKey).length; legend = (legend + (input === "n" ? 1 : Math.max(0, count - 1))) % Math.max(1, count); }
			else if (input === " ") {
				const rows = view === 1 ? burn().rows : accountRows().filter(r => r.series.windowKey === picked?.windowKey).sort((a, b) => a.name.localeCompare(b.name)).map(r => ({ key: r.series.accountKey }));
				const r = rows[legend % Math.max(1, rows.length)]; const hidden = view === 1 ? hiddenBurn : hiddenAccounts;
				if (r) { if (hidden.has(r.key)) hidden.delete(r.key); else hidden.add(r.key); }
			} else if (input === "\r" || input === "\n") {
				if (view === 0) { const p = sortedTotals()[providerRow]; if (p) expanded = expanded === p.provider ? null : p.provider; }
				else if (view === 3) view = 4;
				else if (view === 4) { const r = accountRows()[row]; if (r) selectWindow(r.series); }
				else return false;
			} else if (input === "\x1b" && expanded && view === 0) expanded = null;
			else return false;
			ctx.changed(); return true;
		},
		dispose() { closed = true; localGeneration++; windowsGeneration++; accountsGeneration++; },
	};
}
