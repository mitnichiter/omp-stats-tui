import type { FrustrationDashboardStats, FrustrationEstimate, FrustrationJobStatus } from "@oh-my-pi/omp-stats/shared-types";
import { truncateToWidth, wrapTextWithAnsi } from "@oh-my-pi/pi-tui";
import type { Range } from "../../data/ranges";
import { formatCost, formatElapsed, formatInteger, formatPercent } from "../format";
import { resolveSeries } from "../palette";
import { activeModelClass, classTotals, familyKey, filterFrustrationRows, fraction, FRUSTRATION_SORTS, layerFraction, mostlyRegex, sortFrustrationRows, type FrustrationLayer, type FrustrationSort } from "./frustration-data";
import type { FeatureContext, FeatureController } from "./types";

// Upstream's server.ts and client/api.ts require this exact explicit-action header.
const ACTION_OPTIONS = { method: "POST" as const, headers: { "X-Omp-Stats-Action": "1" } };
const LAYERS: readonly FrustrationLayer[] = ["angry", "assistant", "other"];
const LAYER_LABELS: Record<FrustrationLayer, string> = { angry: "Angry at assistant", assistant: "At assistant, not angry", other: "Annoyed at other targets" };
type QuoteState = { state: "closed" } | { state: "loading"; range: Range } | { state: "error"; range: Range; error: string } | { state: "ready"; range: Range; estimate: FrustrationEstimate };

/** Passive reads never start judging. A fresh quote and a separate y input authorize a paid run. */
export function createFrustrationFeature(ctx: FeatureContext): FeatureController {
	let range: Range = "24h";
	let data: FrustrationDashboardStats | undefined;
	let dataRange: Range | undefined;
	let error: string | undefined;
	let actionError: string | undefined;
	let copyNotice: string | undefined;
	let loading = false;
	let disposed = false;
	let readGeneration = 0;
	let quoteGeneration = 0;
	let actionGeneration = 0;
	let timer: Timer | undefined;
	let quote: QuoteState = { state: "closed" };
	let starting = false;
	let cancelling = false;
	let modelClass: string | null = null;
	const hiddenFamilies = new Set<string>();
	let familyCursor = 0;
	let showSmall = false;
	let hideRegex = false;
	const hiddenLayers = new Set<FrustrationLayer>();
	let trend = true;
	let sort: FrustrationSort = "version";
	let descending = false;
	let selectedKey: string | undefined;
	let selectedIndex = 0;
	let revealed = 20;
	let details = false;
	let focus: "versions" | "families" = "versions";

	function stopPoll(): void {
		clearTimeout(timer);
		timer = undefined;
	}
	function schedulePoll(): void {
		stopPoll();
		if (!disposed && data?.job.state === "running") {
			timer = setTimeout(() => { timer = undefined; void readStats(); }, 1_000);
		}
	}
	async function readStats(): Promise<void> {
		if (disposed) return;
		const generation = ++readGeneration;
		const requestedRange = range;
		loading = true;
		ctx.changed();
		try {
			const result = await ctx.reader.api<FrustrationDashboardStats>("/api/stats/frustration", { range: requestedRange });
			if (disposed || generation !== readGeneration) return;
			data = result;
			dataRange = requestedRange;
			error = undefined;
		} catch (err) {
			if (disposed || generation !== readGeneration) return;
			error = err instanceof Error ? err.message : String(err);
		} finally {
			if (!disposed && generation === readGeneration) {
				loading = false;
				schedulePoll();
				ctx.changed();
			}
		}
	}
	async function openQuote(): Promise<void> {
		if (disposed || starting || data?.job.state === "running") return;
		const generation = ++quoteGeneration;
		const quotedRange = range;
		quote = { state: "loading", range: quotedRange };
		actionError = undefined;
		ctx.changed();
		try {
			const estimate = await ctx.reader.api<FrustrationEstimate>("/api/frustration/estimate", { range: quotedRange });
			if (disposed || generation !== quoteGeneration) return;
			quote = { state: "ready", range: quotedRange, estimate };
		} catch (err) {
			if (disposed || generation !== quoteGeneration) return;
			quote = { state: "error", range: quotedRange, error: err instanceof Error ? err.message : String(err) };
		}
		if (!disposed) ctx.changed();
	}
	async function startRun(): Promise<void> {
		if (disposed || starting || quote.state !== "ready" || !quote.estimate.available || quote.estimate.messages === 0 || data?.job.state === "running") return;
		const quotedRange = quote.range;
		const generation = ++actionGeneration;
		starting = true;
		actionError = undefined;
		++readGeneration;
		stopPoll();
		ctx.changed();
		try {
			const job = await ctx.reader.api<FrustrationJobStatus>("/api/frustration/judge", { range: quotedRange }, ACTION_OPTIONS);
			if (disposed) {
				// Closing while the server resolves the judge must not leave a newly started paid run behind.
				if (job.state === "running") await ctx.reader.api("/api/frustration/cancel", undefined, ACTION_OPTIONS).catch(() => undefined);
				return;
			}
			if (generation !== actionGeneration) return;
			if (data) data = { ...data, job };
			quote = { state: "closed" };
			++quoteGeneration;
			await readStats();
		} catch (err) {
			if (!disposed && generation === actionGeneration) actionError = err instanceof Error ? err.message : String(err);
		} finally {
			if (!disposed && generation === actionGeneration) {
				starting = false;
				schedulePoll();
				ctx.changed();
			}
		}
	}
	async function cancelRun(): Promise<void> {
		if (disposed || cancelling || data?.job.state !== "running") return;
		const generation = ++actionGeneration;
		cancelling = true;
		actionError = undefined;
		++readGeneration;
		stopPoll();
		ctx.changed();
		try {
			const job = await ctx.reader.api<FrustrationJobStatus>("/api/frustration/cancel", undefined, ACTION_OPTIONS);
			if (disposed || generation !== actionGeneration) return;
			if (data) data = { ...data, job };
			await readStats();
		} catch (err) {
			if (!disposed && generation === actionGeneration) actionError = err instanceof Error ? err.message : String(err);
		} finally {
			if (!disposed && generation === actionGeneration) {
				cancelling = false;
				schedulePoll();
				ctx.changed();
			}
		}
	}
	function population() {
		const models = data?.byModel ?? [];
		const active = activeModelClass(models, modelClass);
		const families = [...new Set(models.filter(row => active === "*" || row.modelClass === active).map(familyKey))];
		const chartRows = filterFrustrationRows(models, { modelClass, hiddenFamilies, showSmall, hideRegex });
		const rows = sortFrustrationRows(chartRows, sort, descending);
		const rememberedIndex = rows.findIndex(row => row.key === selectedKey);
		selectedIndex = rememberedIndex >= 0 ? rememberedIndex : Math.min(selectedIndex, Math.max(0, rows.length - 1));
		selectedKey = rows[selectedIndex]?.key;
		revealed = Math.max(revealed, selectedIndex + 1);
		familyCursor = Math.min(familyCursor, Math.max(0, families.length - 1));
		return { active, families, chartRows, rows };
	}

	return {
		async load(nextRange) {
			if (disposed) return;
			if (range !== nextRange) {
				range = nextRange;
				quote = { state: "closed" };
				++quoteGeneration;
			}
			stopPoll();
			await readStats();
		},
		render(width, height) {
			const w = Math.max(1, Math.floor(width));
			const lines: string[] = [];
			const add = (text: string) => { lines.push(...wrapTextWithAnsi(text, w)); };
			const fg = ctx.theme.fg.bind(ctx.theme);
			// Confirmation is rendered first and captures input before every filter/control.
			if (quote.state !== "closed") {
				add(fg("warning", `CLASSIFY WITH JUDGE · quoted range ${quote.range}`));
				if (quote.state === "loading") add("Loading prerequisites and cost quote… Nothing has been spent.");
				else if (quote.state === "error") add(fg("error", quote.error));
				else if (!quote.estimate.available) add(fg("warning", quote.estimate.reason));
				else {
					const estimate = quote.estimate;
					add(`Judge ${estimate.judge}`);
					add(`${formatInteger(estimate.messages)} unique unjudged messages · ${formatInteger(estimate.chars)} prose characters`);
					add(`Estimated input ${formatInteger(estimate.inputTokens)} tokens · cost ≈ ${formatCost(estimate.cost)}`);
					add("Concurrency: upstream adaptive scheduler (not configurable in the quote); actual in-flight count appears during the run.");
					add("Identical messages share cached verdicts. Estimate is not a spending cap; retries can cost more.");
					add(estimate.messages === 0 ? "Everything in this range is already judged; nothing to classify." : fg("warning", starting ? "Starting the confirmed run…" : "Press y to confirm paid judging. Enter does NOT spend. Esc/n backs out; q closes."));
				}
				if (actionError) add(fg("error", actionError));
				add("Esc/n dismiss · q close");
				return lines;
			}
			add(fg("text", "FRUSTRATION · cached judge verdicts + regex fallback"));
			if (loading) add(fg("dim", data ? "Refreshing cached metrics…" : "Loading cached metrics…"));
			if (error) add(fg("error", `${data ? "Cached data retained; refresh failed: " : "Unable to read metrics: "}${error}`));
			if (dataRange && dataRange !== range) add(fg("warning", `Showing stale ${dataRange} metrics while ${range} loads.`));
			if (!data) { add("j quote prerequisites · no paid calls occur on load"); return lines; }
			const overall = data.overall;
			const rate = (part: number, whole: number) => whole > 0 ? formatPercent(fraction(part, whole)) : "–";
			add(`${formatInteger(overall.messages)} user messages · judged ${rate(overall.judged, overall.messages)} (${formatInteger(overall.judged)}) · regex ${formatInteger(overall.messages - overall.judged)}`);
			add(`Annoyed ${rate(overall.annoyed, overall.messages)} · at assistant ${rate(overall.atAssistant, overall.messages)} · angry ${rate(overall.angry, overall.messages)}`);
			const job = data.job;
			const elapsed = job.startedAt === null ? "" : ` · ${formatElapsed((job.finishedAt ?? ctx.now()) - job.startedAt)}`;
			add(fg(job.state === "failed" ? "error" : job.state === "running" ? "success" : "muted", `Judge ${job.state} · ${job.done}/${job.total} judged · ${job.failed} failed · cost ${formatCost(job.cost)}${elapsed}`));
			if (job.judge) add(`Judge model ${job.judge}`);
			if (job.state === "running") {
				const completed = Math.min(1, fraction(job.done + job.failed, job.total));
				const cells = Math.max(1, Math.min(30, w - 10));
				add(Array.from({ length: cells }, (_, i) => fg(i < completed * cells ? "success" : "dim", i < completed * cells ? "#" : ".")).join("") + ` ${formatPercent(completed)}`);
				add(`${job.concurrency} in flight${job.startedAt !== null && job.done > 0 ? ` · ${(job.done / Math.max(1, (ctx.now() - job.startedAt) / 1000)).toFixed(1)}/s` : ""} · x ${cancelling ? "cancelling…" : "cancel run"}`);
			} else add("j quote/confirm classification (never starts on load)");
			if (!data.judgeAvailable) add(fg("warning", "Regex + cached results only: judge is not registered. j shows the actual prerequisite."));
			if (job.error) add(fg("error", job.error));
			if (actionError) add(fg("error", actionError));
			if (copyNotice) add(fg("success", copyNotice));
			const { active, families, chartRows, rows } = population();
			const selected = rows[selectedIndex];
			// Selected point is before the plot/table so moving selection is visible without parent scroll bookkeeping.
			if (selected) {
				add(fg("accent", `Point ${selectedIndex + 1}/${rows.length}: ${selected.label} · ${selected.messages} messages${mostlyRegex(selected) ? " · mostly regex" : ""}`));
				add(`Judged ${rate(selected.judged, selected.messages)} · annoyed ${rate(selected.annoyed, selected.messages)} · assistant ${rate(selected.atAssistant, selected.messages)} · angry ${rate(selected.angry, selected.messages)}`);
				add(`Layers: angry ${rate(selected.angry, selected.messages)} · assistant-not-angry ${rate(selected.atAssistant - selected.angry, selected.messages)} · other ${rate(selected.annoyed - selected.atAssistant, selected.messages)}`);
				if (details) {
					add(`Identity ${selected.key} · class ${selected.modelClass} · family ${selected.family ?? "unclassified"} · revision ${selected.revision ?? "unclassified"}`);
					add(`Counts: judged ${selected.judged}; annoyed ${selected.annoyed}; assistant ${selected.atAssistant}; angry ${selected.angry}`);
					for (const id of selected.models) add(`Raw model ID: ${id}`);
					add(`First seen ${new Date(selected.firstSeen).toISOString()} · p copy this row JSON`);
				}
			}
			add(`Class ${active} [c] · ${showSmall ? "including" : "excluding"} <50 messages [m] · mostly regex ${hideRegex ? "hidden" : "shown"} [h]`);
			add(`Focus ${focus} [Tab] · versions ↑/↓ · family ↑/↓ + Space · sort ${sort} ${descending ? "↓" : "↑"} [o/O] · reveal [v] · raw IDs [Enter]`);
			add("Layers 1 angry · 2 assistant-not-angry · 3 other · 4 assistant trend (toggle)");
			const colors = resolveSeries(Math.max(1, families.length), ctx.theme);
			const familyStart = Math.max(0, familyCursor - 2);
			add(`Families ${families.length ? familyStart + 1 : 0}–${Math.min(families.length, familyStart + 5)}/${families.length} · Tab + ↑/↓ reaches every family`);
			for (let i = familyStart; i < Math.min(families.length, familyStart + 5); i++) add(`${focus === "families" && i === familyCursor ? ">" : " "} ${hiddenFamilies.has(families[i]) ? "[ ]" : "[x]"} ${fg(colors[i % colors.length], families[i])}`);
			if (!rows.length) { add(data.byModel.length ? "No model versions match the filters. c/m/h and family Space change filters." : "No user messages with prose in this range. Try a longer range."); return lines; }
			add(fg("dim", "Rates by version (upstream catalog order), NOT time. # angry; + assistant; . other; / mostly regex; * assistant trend."));
			const chartIndex = Math.max(0, chartRows.findIndex(row => row.key === selectedKey));
			const slots = Math.max(1, Math.min(chartRows.length, Math.floor(Math.max(2, w - 7) / 2)));
			const chartStart = Math.max(0, Math.min(chartRows.length - slots, chartIndex - Math.floor(slots / 2)));
			const plot = chartRows.slice(chartStart, chartStart + slots);
			const plotHeight = Math.max(3, Math.min(8, Math.floor(height / 5)));
			const peak = Math.max(0.01, ...plot.map(row => LAYERS.reduce((sum, layer) => sum + (hiddenLayers.has(layer) ? 0 : layerFraction(row, layer)), 0)), ...(trend ? plot.map(row => fraction(row.atAssistant, row.messages)) : []));
			for (let y = plotHeight - 1; y >= 0; y--) {
				const threshold = ((y + 0.5) / plotHeight) * peak;
				let marks = "";
				for (const [index, row] of plot.entries()) {
					let top = 0;
					let mark = " ";
					let layerToken: "error" | "warning" | "muted" = "muted";
					for (const layer of LAYERS) {
						if (hiddenLayers.has(layer)) continue;
						top += layerFraction(row, layer);
						if (mark === " " && threshold <= top) { mark = layer === "angry" ? "#" : layer === "assistant" ? "+" : "."; layerToken = layer === "angry" ? "error" : layer === "assistant" ? "warning" : "muted"; }
					}
					const familyIndex = families.indexOf(familyKey(row));
					if (mostlyRegex(row) && mark !== " " && y % 2 === 0) mark = "/";
					const trendY = Math.min(plotHeight - 1, Math.floor(fraction(row.atAssistant, row.messages) / peak * plotHeight));
					marks += trend && y === trendY ? fg("text", "*") : fg(layerToken, mark);
					const next = plot[index + 1];
					const connectorY = next ? Math.min(plotHeight - 1, Math.floor((fraction(row.atAssistant, row.messages) + fraction(next.atAssistant, next.messages)) / (2 * peak) * plotHeight)) : -1;
					marks += trend && y === connectorY ? fg("text", "-") : fg(colors[Math.max(0, familyIndex) % colors.length], row.key === selectedKey ? "|" : y === 0 ? "." : " ");
				}
				lines.push(truncateToWidth(`${Math.round(((y + 1) / plotHeight) * peak * 100).toString().padStart(3)}% | ${marks}`, w));
			}
			lines.push(truncateToWidth(`  0% + ${"-".repeat(plot.length * 2)}`, w));
			add(`Version slots ${chartStart + 1}–${chartStart + plot.length}/${chartRows.length}: ${plot[0].label} → ${plot[plot.length - 1].label}`);
			add(LAYERS.map(layer => `${hiddenLayers.has(layer) ? "off" : "on"} ${LAYER_LABELS[layer]}`).join(" · ") + ` · trend ${trend ? "on" : "off"}`);
			const reachable = Math.min(rows.length, revealed);
			const pageSize = Math.max(3, Math.min(15, Math.floor(height / 3)));
			const tableStart = Math.max(0, Math.min(Math.max(0, reachable - pageSize), selectedIndex - Math.floor(pageSize / 2)));
			add(`VERSIONS · ${reachable}/${rows.length} revealed · viewport ${tableStart + 1}–${Math.min(reachable, tableStart + pageSize)} · v reveal more`);
			for (let i = tableStart; i < Math.min(reachable, tableStart + pageSize); i++) {
				const row = rows[i];
				add(`${i === selectedIndex ? ">" : " "} ${row.label} · ${row.messages} msgs · judged ${rate(row.judged, row.messages)}${mostlyRegex(row) ? " regex" : ""}`);
				add(`  annoyed ${rate(row.annoyed, row.messages)} · assistant ${rate(row.atAssistant, row.messages)} · angry ${rate(row.angry, row.messages)}`);
			}
			return lines;
		},
		handleInput(input) {
			if (disposed || input === "q") return false;
			if (quote.state !== "closed") {
				if (input === "\x1b" || input === "n") {
					if (!starting) { quote = { state: "closed" }; ++quoteGeneration; ctx.changed(); }
				} else if (input === "y") void startRun();
				return true;
			}
			const { families, rows } = population();
			if (input === "j") { void openQuote(); return true; }
			if (input === "x" && data?.job.state === "running") { void cancelRun(); return true; }
			if (input === "\t") focus = focus === "versions" ? "families" : "versions";
			else if (input === "c") {
				const options = ["*", ...classTotals(data?.byModel ?? []).keys()];
				modelClass = options[(options.indexOf(activeModelClass(data?.byModel ?? [], modelClass)) + 1) % options.length];
				selectedIndex = 0; selectedKey = undefined;
			} else if (input === "m") showSmall = !showSmall;
			else if (input === "h") hideRegex = !hideRegex;
			else if (input === "o") sort = FRUSTRATION_SORTS[(FRUSTRATION_SORTS.indexOf(sort) + 1) % FRUSTRATION_SORTS.length];
			else if (input === "O") descending = !descending;
			else if (input === "v") revealed = Math.min(rows.length, Math.max(20, revealed * 2));
			else if (input === "1" || input === "2" || input === "3") {
				const layer = LAYERS[Number(input) - 1];
				if (hiddenLayers.has(layer)) hiddenLayers.delete(layer); else hiddenLayers.add(layer);
			} else if (input === "4") trend = !trend;
			else if (input === " " && focus === "families" && families[familyCursor]) {
				const key = families[familyCursor];
				if (hiddenFamilies.has(key)) hiddenFamilies.delete(key); else hiddenFamilies.add(key);
			} else if (input === "\x1b[A" || input === "\x1b[B") {
				const delta = input === "\x1b[A" ? -1 : 1;
				if (focus === "families") familyCursor = Math.max(0, Math.min(families.length - 1, familyCursor + delta));
				else {
					selectedIndex = Math.max(0, Math.min(Math.min(rows.length, revealed) - 1, selectedIndex + delta));
					selectedKey = rows[selectedIndex]?.key;
				}
			} else if (input === "\r" || input === "\n") details = !details;
			else if (input === "\x1b" && details) details = false;
			else if (input === "p" && details && rows[selectedIndex]) {
				void ctx.copy(JSON.stringify(rows[selectedIndex], null, 2)).then(() => {
					if (!disposed) { actionError = undefined; copyNotice = "Selected model row copied."; ctx.changed(); }
				}, err => { if (!disposed) { copyNotice = undefined; actionError = `Clipboard failed: ${err instanceof Error ? err.message : String(err)}`; ctx.changed(); } });
			} else return false;
			ctx.changed();
			return true;
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			++readGeneration; ++quoteGeneration; ++actionGeneration;
			stopPoll();
			if (data?.job.state === "running" || starting) void ctx.reader.api("/api/frustration/cancel", undefined, ACTION_OPTIONS).catch(() => undefined);
		},
	};
}
