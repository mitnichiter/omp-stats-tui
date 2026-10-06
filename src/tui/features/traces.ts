import { matchesKey, wrapTextWithAnsi } from "@oh-my-pi/pi-tui";
import { formatDurationMs, formatEstimatedCost, formatInteger } from "@oh-my-pi/omp-stats/client/data/formatters";
import type { SessionSummary, SessionTrace, TraceToolStat } from "@oh-my-pi/omp-stats/shared-types";
import type { Range } from "../../data/ranges";
import type { FeatureContext, FeatureController } from "./types";
import { ancestors, buildScale, clampViewport, fit, localWindow, remapViewport, revealSpan, rowForEntry, transcriptRows, zoomViewport, type AxisMode, type TraceRow, type TraceScale, type Viewport } from "./traces/model";
import { bounded, clean, COLORS, renderEntry, renderTimeline, rowLabel } from "./traces/render";

type Focus = "timeline" | "transcript" | "tools" | "children";
type SessionSort = "started" | "title" | "duration" | "requests" | "tools" | "agents" | "tokens" | "cost";
type ToolSort = "total" | "tool" | "calls" | "errors" | "average" | "max";
const SESSION_SORTS: readonly SessionSort[] = ["started", "title", "duration", "requests", "tools", "agents", "tokens", "cost"];
const TOOL_SORTS: readonly ToolSort[] = ["total", "tool", "calls", "errors", "average", "max"];
const FOCI: readonly Focus[] = ["timeline", "transcript", "tools", "children"];
interface ViewState {
	file: string; trace: SessionTrace | null; scale: TraceScale; viewport: Viewport; mode: AxisMode;
	compress: boolean; selected: string | null; collapsed: Set<string>; cursor: number; focus: Focus;
	search: string; toolFilter: string | null; toolSelected: string | null; childSelected: string | null;
}

export function createTracesFeature(ctx: FeatureContext): FeatureController {
	let closed = false, generation = 0, entryGeneration = 0;
	let loading = false, error: string | null = null, notice = "";
	let sessions: SessionSummary[] = [], listSearch = "", sessionSelected: string | null = null;
	let listLimit = 200, revealed = 50, listSort: SessionSort = "started", listDescending = true;
	let toolSort: ToolSort = "total", toolDescending = true;
	let state: ViewState | null = null;
	const history: ViewState[] = [];
	let editing: "sessions" | "spans" | null = null, draft = "";
	let detail = false, raw = false, entry: unknown = null, entryLoading = false, entryError: string | null = null;
	let unmappedTarget: { file: string; id: string } | null = null;

	function changed(): void { if (!closed) ctx.changed(); }
	function rows(): TraceRow[] {
		if (!state?.trace) return [];
		const needle = state.search.trim().toLowerCase();
		return transcriptRows(state.trace.tracks).filter(row =>
			(!needle || `${row.span?.label ?? row.marker?.label} ${row.span?.detail ?? ""} ${row.track.label}`.toLowerCase().includes(needle)) &&
			(!state?.toolFilter || row.span?.kind === "tool" && row.span.label === state.toolFilter));
	}
	function selectedRow(): TraceRow | undefined {
		return state?.trace ? transcriptRows(state.trace.tracks).find(row => row.key === state?.selected) : undefined;
	}
	function sortedSessions(): SessionSummary[] {
		const needle = listSearch.trim().toLowerCase();
		const value = (row: SessionSummary): string | number => {
			switch (listSort) {
				case "title": return (row.title ?? row.file).toLowerCase();
				case "duration": return row.endedAt - row.startedAt;
				case "requests": return row.requests;
				case "tools": return row.toolCalls;
				case "agents": return row.subagents;
				case "tokens": return row.totalTokens;
				case "cost": return row.costTotal;
				default: return row.startedAt;
			}
		};
		return sessions.filter(row => !needle || `${row.title ?? ""} ${row.folder} ${row.file.split("/").pop()} ${row.models.join(" ")}`.toLowerCase().includes(needle))
			.sort((a, b) => {
				const av = value(a), bv = value(b);
				const result = typeof av === "string" && typeof bv === "string" ? av.localeCompare(bv) : Number(av) - Number(bv);
				return (listDescending ? -result : result) || a.file.localeCompare(b.file);
			});
	}
	function sortedTools(): TraceToolStat[] {
		const value = (row: TraceToolStat): string | number => {
			switch (toolSort) {
				case "tool": return row.tool;
				case "calls": return row.calls;
				case "errors": return row.errors;
				case "average": return row.calls ? row.totalMs / row.calls : 0;
				case "max": return row.maxMs;
				default: return row.totalMs;
			}
		};
		return [...(state?.trace?.summary.toolStats ?? [])].sort((a, b) => {
			const av = value(a), bv = value(b);
			const result = typeof av === "string" && typeof bv === "string" ? av.localeCompare(bv) : Number(av) - Number(bv);
			return (toolDescending ? -result : result) || a.tool.localeCompare(b.tool);
		});
	}
	function resetEntry(): void {
		entryGeneration++;
		entry = null;
		entryLoading = false;
		entryError = null;
		raw = false;
	}
	async function loadEntry(row: TraceRow | null, target?: { file: string; id: string }): Promise<void> {
		resetEntry();
		const request = target ?? (row?.span?.entryId ? { file: row.track.file, id: row.span.entryId } : null);
		if (!request) { changed(); return; }
		const id = ++entryGeneration, view = state, selection = state?.selected;
		entryLoading = true;
		changed();
		try {
			const response = await ctx.reader.api<{ entry: unknown }>("/api/session/entry", request);
			if (closed || id !== entryGeneration || state !== view || state?.selected !== selection) return;
			entry = response.entry;
		} catch (cause) {
			if (closed || id !== entryGeneration || state !== view) return;
			entryError = cause instanceof Error ? cause.message : String(cause);
		} finally {
			if (!closed && id === entryGeneration && state === view) { entryLoading = false; changed(); }
		}
	}
	function select(row: TraceRow, open = false): void {
		if (!state?.trace) return;
		unmappedTarget = null;
		state.selected = row.key;
		for (const id of ancestors(state.trace.tracks, row.track.id)) state.collapsed.delete(id);
		if (row.span) state.viewport = revealSpan(state.scale, state.viewport, row.span);
		else {
			const u = state.scale.toU(row.time), size = state.viewport.u1 - state.viewport.u0;
			if (u < state.viewport.u0 || u > state.viewport.u1) state.viewport = clampViewport(state.scale, { u0: u - size / 2, u1: u + size / 2 });
		}
		const u = state.scale.toU(row.span ? (row.span.start + row.span.end) / 2 : row.time);
		state.cursor = Math.max(0, Math.min(1, (u - state.viewport.u0) / (state.viewport.u1 - state.viewport.u0)));
		resetEntry();
		detail = open;
		if (open) void loadEntry(row);
		changed();
	}
	async function loadSessions(): Promise<void> {
		const id = ++generation;
		loading = true; error = null; changed();
		try {
			// Upstream q omits model names; retain unfiltered candidates for the web's model search.
			const queries = [ctx.reader.api<SessionSummary[]>("/api/sessions", { limit: String(listLimit) })];
			if (listSearch) queries.push(ctx.reader.api<SessionSummary[]>("/api/sessions", { limit: String(listLimit), q: listSearch }));
			const responses = await Promise.all(queries);
			if (closed || id !== generation || state) return;
			const byFile = new Map<string, SessionSummary>();
			for (const response of responses) for (const row of response) byFile.set(row.file, row);
			sessions = [...byFile.values()];
			const visible = sortedSessions();
			if (!visible.some(row => row.file === sessionSelected)) sessionSelected = visible[0]?.file ?? null;
		} catch (cause) {
			if (!closed && id === generation) error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			if (!closed && id === generation) { loading = false; changed(); }
		}
	}
	async function loadTrace(view: ViewState, entryId?: string, requestedFile = view.file): Promise<void> {
		const id = ++generation;
		loading = true; error = null; changed();
		try {
			const trace = await ctx.reader.api<SessionTrace>("/api/session/trace", { file: view.file });
			if (closed || id !== generation || state !== view) return;
			const previous = view.scale;
			view.scale = buildScale(trace.tracks, view.mode, view.compress);
			view.viewport = view.trace ? remapViewport(previous, view.scale, view.viewport) : fit(view.scale);
			const firstLoad = !view.trace;
			view.trace = trace;
			if (firstLoad) for (const track of trace.tracks) if (track.parentId) view.collapsed.add(track.id);
			const all = transcriptRows(trace.tracks);
			const requested = entryId ? rowForEntry(trace, requestedFile, entryId) : undefined;
			const retained = all.find(row => row.key === view.selected);
			if (requested) select(requested, true);
			else if (!retained) {
				view.selected = all[0]?.key ?? null;
				resetEntry(); detail = false;
			}
			if (entryId && !requested) {
				notice = `Entry ${entryId} has no assembled span; timing is unavailable.`;
				unmappedTarget = { file: requestedFile, id: entryId };
				detail = true;
				await loadEntry(null, unmappedTarget);
			} else if (unmappedTarget && detail && !entryId) {
				void loadEntry(null, unmappedTarget);
			} else if (retained && detail && !entryId) void loadEntry(retained);
			view.toolSelected ??= trace.summary.toolStats[0]?.tool ?? null;
			view.childSelected ??= trace.tracks.find(track => track.parentId)?.id ?? trace.tracks[0]?.id ?? null;
		} catch (cause) {
			if (!closed && id === generation && state === view) error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			if (!closed && id === generation && state === view) { loading = false; changed(); }
		}
	}
	async function openTrace(file: string, entryId?: string): Promise<void> {
		if (closed) return;
		if (state?.file === file) { await loadTrace(state, entryId, file); return; }
		if (state) history.push({ ...state, collapsed: new Set(state.collapsed) });
		resetEntry(); detail = false; notice = ""; editing = null; unmappedTarget = null;
		const scale = buildScale([], "time", true);
		state = { file, trace: null, scale, viewport: fit(scale), mode: "time", compress: true, selected: null,
			collapsed: new Set(), cursor: 0.5, focus: "timeline", search: "", toolFilter: null, toolSelected: null, childSelected: null };
		await loadTrace(state, entryId, file);
	}
	function back(): void {
		generation++; loading = false; error = null; resetEntry(); detail = false; notice = ""; unmappedTarget = null;
		state = history.pop() ?? null;
		if (!state && !sessions.length) void loadSessions();
		changed();
	}
	function cycleMatch(direction: number): void {
		const matches = rows().filter(row => row.span);
		if (!matches.length) { notice = "No matching spans."; changed(); return; }
		const current = matches.findIndex(row => row.key === state?.selected);
		select(matches[(current + direction + matches.length) % matches.length]!);
	}
	function changeAxis(mode: AxisMode, compress: boolean): void {
		if (!state?.trace) return;
		const next = buildScale(state.trace.tracks, mode, compress);
		const cursorTime = state.scale.toT(state.viewport.u0 + state.cursor * (state.viewport.u1 - state.viewport.u0));
		state.viewport = remapViewport(state.scale, next, state.viewport);
		state.scale = next; state.mode = mode; state.compress = compress;
		state.cursor = Math.max(0, Math.min(1, (next.toU(cursorTime) - state.viewport.u0) / (state.viewport.u1 - state.viewport.u0)));
		changed();
	}
	function childAction(openFile: boolean): void {
		if (!state?.trace) return;
		const selected = selectedRow();
		const id = state.focus === "children" ? state.childSelected : selected?.span?.childTrackId ?? selected?.track.id;
		const track = state.trace.tracks.find(item => item.id === id);
		if (!track) { notice = "Select a child track or agent span first."; changed(); return; }
		if (openFile) { void openTrace(track.file); return; }
		const first = transcriptRows([track])[0];
		if (first) { state.toolFilter = null; state.search = ""; state.focus = "timeline"; select(first); }
		else { notice = "This child has no recorded spans or markers."; changed(); }
	}
	async function copySelection(): Promise<void> {
		const id = entryGeneration, view = state;
		const row = selectedRow();
		const value = detail ? entry ?? (unmappedTarget ? undefined : row?.span ?? row?.marker) : row?.span ?? row?.marker ?? state?.trace ?? sessions.find(item => item.file === sessionSelected);
		if (!value) { notice = "Nothing selected to copy."; changed(); return; }
		if (entryLoading) { notice = "Entry is still loading; wait before copying its JSON."; changed(); return; }
		try {
			await ctx.copy(JSON.stringify(value, null, 2));
			if (!closed && state === view && id === entryGeneration) notice = "Copied JSON.";
		} catch (cause) {
			if (!closed && state === view && id === entryGeneration) notice = `Clipboard failed: ${cause instanceof Error ? cause.message : String(cause)}`;
		}
		changed();
	}

	return {
		async load(_range: Range) { if (closed) return; if (state) await loadTrace(state); else await loadSessions(); },
		get inputMode() { return editing ? "text" as const : "navigation" as const; },
		openTrace,
		dispose() { closed = true; generation++; entryGeneration++; history.length = 0; },
		render(width, height) {
			const w = Math.max(1, width), capacity = Math.max(3, height - 9);
			const lines: string[] = [];
			if (notice) lines.push(ctx.theme.fg("warning", clean(notice)));
			if (error) lines.push(ctx.theme.fg("error", `Trace read failed: ${clean(error)} · u retry`));
			if (loading) lines.push(ctx.theme.fg("dim", state?.trace || sessions.length ? "Refreshing recorded data…" : "Loading recorded data…"));
			if (editing) lines.push(ctx.theme.fg("accent", `Search: ${clean(draft)}_ · Enter apply · Esc cancel · Ctrl+C close`));
			if (!state) {
				const all = sortedSessions();
				const selectedIndex = all.findIndex(row => row.file === sessionSelected);
				if (selectedIndex >= revealed) revealed = Math.ceil((selectedIndex + 1) / 50) * 50;
				const shown = all.slice(0, revealed);
				let index = shown.findIndex(row => row.file === sessionSelected);
				if (index < 0 && shown.length) { sessionSelected = shown[0]!.file; index = 0; }
				lines.push(ctx.theme.bold("Root sessions · child activity folded in"));
				lines.push(`${all.length} matching / ${sessions.length} fetched · ${Math.min(revealed, all.length)} revealed · sort ${listSort} ${listDescending ? "↓" : "↑"} · all recorded dates`);
				lines.push(...wrapTextWithAnsi(`Upstream considers at most 300 recent root candidates, not full session history.${listLimit < 300 ? " + fetches the remaining candidates." : ""}`, w));
				lines.push(...wrapTextWithAnsi("↑/↓ select · Enter open · / search · o sort · D reverse · l reveal 50 · + fetch more · y copy · u refresh", w));
				if (listSearch) lines.push(`Filter: ${clean(listSearch)} · x clear`);
				const window = localWindow(shown, Math.max(0, index), capacity);
				for (const row of window.rows) {
					const selected = row.file === sessionSelected;
					const text = `${selected ? "▶" : " "} ${row.title ?? row.file.split("/").pop()} · ${formatDurationMs(row.endedAt - row.startedAt)} · ${row.requests} req · ${row.subagents} children · ${formatEstimatedCost(row.costTotal, row.unpricedRequests)}`;
					lines.push(selected ? ctx.theme.fg("accent", clean(text)) : clean(text));
				}
				const selected = all.find(row => row.file === sessionSelected);
				if (selected) lines.push(...wrapTextWithAnsi(clean(`Session: ${selected.title ?? selected.file}\nProject: ${selected.folder}\nModels: ${selected.models.join(", ") || "none"}\nStarted: ${new Date(selected.startedAt).toISOString()} · Duration: ${formatDurationMs(selected.endedAt - selected.startedAt)}\n${selected.requests} requests · ${selected.toolCalls} tools · ${formatInteger(selected.totalTokens)} tokens · Cost: ${formatEstimatedCost(selected.costTotal, selected.unpricedRequests)}\n${selected.subagents} child transcripts (included in totals) · ${selected.unpricedRequests} unpriced requests\nFile: ${selected.file}`), w));
				if (!all.length && !loading && !error) lines.push(listSearch ? "No matching sessions; x clears the search." : "No indexed root sessions; s syncs recorded transcripts.");
				return bounded(lines, w);
			}
			lines.push(ctx.theme.bold(clean(state.trace?.title ?? state.file.split("/").pop())));
			lines.push(...wrapTextWithAnsi(`b back · Tab pane (${state.focus}) · / span search · n/N matches · Enter details · y JSON · u refresh`, w));
			const trace = state.trace;
			if (!trace) return bounded(lines, w);
			const summary = trace.summary;
			lines.push(`Wall ${formatDurationMs(summary.wallMs)} · Model ${formatDurationMs(summary.modelMs)} · Tool ${formatDurationMs(summary.toolMs)} · Idle ${formatDurationMs(summary.idleMs)}`);
			lines.push(`${summary.turns} turns · ${summary.requests} requests · ${summary.toolCalls} tools · ${summary.subagents} children · ${formatInteger(summary.totalTokens)} tokens · ${formatEstimatedCost(summary.costTotal, summary.unpricedRequests)}`);
			const selected = selectedRow();
			if (selected) lines.push(...wrapTextWithAnsi(ctx.theme.fg(selected.span?.isError ? "error" : "accent", clean(`Selected: ${rowLabel(selected, trace.startedAt)}`)), w));
			if (state.search || state.toolFilter) lines.push(`Search: ${clean(state.search) || "all"} · ${rows().filter(row => row.span).length} spans · Tool: ${clean(state.toolFilter) || "all"} · x clear`);
			if (detail && (selected || unmappedTarget)) {
				lines.push(...wrapTextWithAnsi("Esc back to trace · j toggle raw JSON · y copy entry · o child · O open child file", w));
				if (unmappedTarget) lines.push(...wrapTextWithAnsi(clean(`Journal entry ${unmappedTarget.id} · ${unmappedTarget.file} · no recorded span timing`), w));
				lines.push(...renderEntry(unmappedTarget ? null : selected ?? null, entry, entryLoading, entryError, raw, w));
				return bounded(lines, w);
			}
			if (state.focus === "timeline") {
				lines.push(...wrapTextWithAnsi(`v axis ${state.mode} · i idle ${state.compress ? "compressed" : "real"} · +/- zoom · ←/→ or a/d pan · h/l cursor · Space pick · 0 fit · f focus · c track · C collapse all · E expand all · o child`, w));
				lines.push(...renderTimeline({ trace, scale: state.scale, viewport: state.viewport, collapsed: state.collapsed, selected: state.selected, cursor: state.cursor, width: w, height: Math.max(8, height - lines.length), search: state.search, theme: ctx.theme }));
			} else if (state.focus === "transcript") {
				const all = rows();
				const index = all.findIndex(row => row.key === state?.selected);
				const window = localWindow(all, Math.max(0, index), capacity);
				lines.push(`Linked transcript + markers · ${all.length} events · ↑/↓ select · Enter inspect · o child`);
				for (const row of window.rows) lines.push(ctx.theme.fg(row.span?.isError ? "error" : row.span ? COLORS[row.span.kind] : "muted", clean(`${row.key === state.selected ? "▶" : " "} ${rowLabel(row, trace.startedAt)}${row.span?.detail ? ` · ${row.span.detail}` : ""}`)));
				if (!all.length) lines.push("No matching transcript events.");
			} else if (state.focus === "tools") {
				const tools = sortedTools();
				if (!tools.some(tool => tool.tool === state?.toolSelected)) state.toolSelected = tools[0]?.tool ?? null;
				const window = localWindow(tools, tools.findIndex(tool => tool.tool === state?.toolSelected), capacity);
				lines.push(`Per-tool duration · sort ${toolSort} ${toolDescending ? "↓" : "↑"} · o sort · D reverse · Enter linked calls`);
				for (const tool of window.rows) lines.push(clean(`${tool.tool === state.toolSelected ? "▶" : " "} ${tool.tool} · ${tool.calls} calls · ${tool.errors} errors · total ${formatDurationMs(tool.totalMs)} · avg ${formatDurationMs(tool.calls ? tool.totalMs / tool.calls : 0)} · max ${formatDurationMs(tool.maxMs)}`));
				const tool = tools.find(item => item.tool === state?.toolSelected);
				if (tool) lines.push(...wrapTextWithAnsi(clean(`Selected tool: ${tool.tool}\nCalls: ${tool.calls} · Errors: ${tool.errors}\nTotal duration: ${formatDurationMs(tool.totalMs)} · Average: ${formatDurationMs(tool.calls ? tool.totalMs / tool.calls : 0)} · Maximum: ${formatDurationMs(tool.maxMs)}`), w));
				if (!tools.length) lines.push("No recorded tool calls.");
			} else {
				const tracks = trace.tracks;
				if (!tracks.some(track => track.id === state?.childSelected)) state.childSelected = tracks.find(track => track.parentId)?.id ?? tracks[0]?.id ?? null;
				const window = localWindow(tracks, tracks.findIndex(track => track.id === state?.childSelected), capacity);
				lines.push("Track tree · ↑/↓ select · Enter reveal · O open transcript · c collapse/expand");
				for (const track of window.rows) {
					const depth = ancestors(tracks, track.id).length;
					const tools = track.spans.filter(span => span.kind === "tool");
					const model = track.spans.filter(span => span.kind === "model");
					lines.push(clean(`${track.id === state.childSelected ? "▶" : " "}${"  ".repeat(depth)}${state.collapsed.has(track.id) ? "+" : "−"} ${track.label} [${track.id}] · ${model.length} requests · ${tools.length} tools · ${formatDurationMs(track.spans.reduce((sum, span) => sum + span.end - span.start, 0))} summed span time`));
				}
				const track = tracks.find(item => item.id === state?.childSelected);
				if (track) lines.push(...wrapTextWithAnsi(clean(`Agent: ${track.agent ?? "main"} · Model: ${track.model ?? "unknown"}\nFile: ${track.file}\n${track.spans.filter(span => span.isError).length} failed spans · ${track.markers.length} markers · ${tracks.filter(item => item.parentId === track.id).length} direct children`), w));
			}
			return bounded(lines, w);
		},
		handleInput(data) {
			// Printable query characters belong to search; control navigation still passes through.
			if (closed || !editing && (data === "q" || data === "[" || data === "]") ||
				data === "\x0e" || data === "\x10") return false;
			if (editing) {
				if (matchesKey(data, "escape")) { editing = null; changed(); return true; }
				if (matchesKey(data, "enter")) {
					if (editing === "sessions") { listSearch = draft.trim(); revealed = 50; sessionSelected = null; editing = null; void loadSessions(); }
					else { if (state) { state.search = draft.trim(); state.toolFilter = null; } editing = null; cycleMatch(1); }
					return true;
				}
				if (matchesKey(data, "backspace")) draft = Array.from(draft).slice(0, -1).join("");
				else if (data === "\x15") draft = "";
				else if (!/[\x00-\x1f\x7f]/.test(data)) draft += clean(data);
				else return false;
				changed(); return true;
			}
			if (data === "r" || data === "R" || data === "s") return false;
			if (data === "/") { editing = state ? "spans" : "sessions"; draft = state?.search ?? listSearch; changed(); return true; }
			if (data === "u") { if (state) void loadTrace(state); else void loadSessions(); return true; }
			if (data === "y") { void copySelection(); return true; }
			if (!state) {
				const all = sortedSessions().slice(0, revealed);
				if (matchesKey(data, "up") || matchesKey(data, "down")) {
					const index = all.findIndex(row => row.file === sessionSelected);
					sessionSelected = all[Math.max(0, Math.min(all.length - 1, index + (matchesKey(data, "up") ? -1 : 1)))]?.file ?? null;
				} else if (matchesKey(data, "enter")) { if (sessionSelected) void openTrace(sessionSelected); }
				else if (data === "o") listSort = SESSION_SORTS[(SESSION_SORTS.indexOf(listSort) + 1) % SESSION_SORTS.length]!;
				else if (data === "D") listDescending = !listDescending;
				else if (data === "l") revealed += 50;
				else if (data === "+" || data === "=") { listLimit = 300; revealed = listLimit; void loadSessions(); }
				else if (data === "x") { listSearch = ""; void loadSessions(); }
				else return false;
				changed(); return true;
			}
			if (matchesKey(data, "escape")) {
				if (detail) { detail = false; resetEntry(); unmappedTarget = null; }
				else if (state.search || state.toolFilter) { state.search = ""; state.toolFilter = null; }
				else back();
				changed(); return true;
			}
			if (data === "b") { back(); return true; }
			if (data === "x") { state.search = ""; state.toolFilter = null; changed(); return true; }
			if (data === "n" || data === "N") { cycleMatch(data === "n" ? 1 : -1); return true; }
			if (data === "o" && (detail || state.focus !== "tools")) { childAction(false); return true; }
			if (data === "O") { childAction(true); return true; }
			if (detail) {
				if (data === "j") { raw = !raw; changed(); return true; }
				return false;
			}
			if (matchesKey(data, "tab") || data === "\x1b[Z") {
				const direction = data === "\x1b[Z" ? -1 : 1;
				state.focus = FOCI[(FOCI.indexOf(state.focus) + direction + FOCI.length) % FOCI.length]!;
				changed(); return true;
			}
			if (data === "c" || data === "C" || data === "E") {
				if (data === "E") state.collapsed.clear();
				else if (data === "C") state.collapsed = new Set(state.trace?.tracks.filter(track => track.parentId).map(track => track.id));
				else {
					const id = state.focus === "children" ? state.childSelected : selectedRow()?.track.id;
					if (id) { if (state.collapsed.has(id)) state.collapsed.delete(id); else state.collapsed.add(id); }
				}
				changed(); return true;
			}
			if (matchesKey(data, "up") || matchesKey(data, "down")) {
				const direction = matchesKey(data, "up") ? -1 : 1;
				if (state.focus === "tools") {
					const tools = sortedTools(), index = tools.findIndex(tool => tool.tool === state?.toolSelected);
					state.toolSelected = tools[Math.max(0, Math.min(tools.length - 1, index + direction))]?.tool ?? null;
				} else if (state.focus === "children") {
					const tracks = state.trace?.tracks ?? [], index = tracks.findIndex(track => track.id === state?.childSelected);
					state.childSelected = tracks[Math.max(0, Math.min(tracks.length - 1, index + direction))]?.id ?? null;
				} else {
					const all = rows().filter(row => state?.focus === "transcript" || row.span), index = all.findIndex(row => row.key === state?.selected);
					const next = all[Math.max(0, Math.min(all.length - 1, index + direction))];
					if (next) select(next);
				}
				changed(); return true;
			}
			if (matchesKey(data, "enter")) {
				if (state.focus === "tools") {
					state.toolFilter = state.toolSelected ?? sortedTools()[0]?.tool ?? null; state.search = ""; state.focus = "transcript";
					const first = rows()[0]; if (first) select(first);
				} else if (state.focus === "children") childAction(false);
				else { const selected = selectedRow(); if (selected) select(selected, true); }
				changed(); return true;
			}
			if (state.focus === "tools") {
				if (data === "o") toolSort = TOOL_SORTS[(TOOL_SORTS.indexOf(toolSort) + 1) % TOOL_SORTS.length]!;
				else if (data === "D") toolDescending = !toolDescending;
				else return false;
				changed(); return true;
			}
			if (state.focus !== "timeline") return false;
			if (data === "v") { const modes: readonly AxisMode[] = ["time", "turns", "calls"]; changeAxis(modes[(modes.indexOf(state.mode) + 1) % modes.length]!, state.compress); return true; }
			if (data === "i") { changeAxis(state.mode, !state.compress); return true; }
			if (data === "+" || data === "=" || data === "w" || data === "-" || data === "S") state.viewport = zoomViewport(state.scale, state.viewport, data === "-" || data === "S" ? 1.5 : 1 / 1.5, state.cursor);
			else if (matchesKey(data, "left") || matchesKey(data, "right") || data === "a" || data === "d") {
				const shift = (state.viewport.u1 - state.viewport.u0) * 0.2 * (matchesKey(data, "left") || data === "a" ? -1 : 1);
				state.viewport = clampViewport(state.scale, { u0: state.viewport.u0 + shift, u1: state.viewport.u1 + shift });
			} else if (data === "h" || data === "l") state.cursor = Math.max(0, Math.min(1, state.cursor + (data === "h" ? -0.05 : 0.05)));
			else if (data === "0") state.viewport = fit(state.scale);
			else if (data === "f") { const selected = selectedRow(); if (selected?.span) state.viewport = revealSpan(state.scale, state.viewport, selected.span, true); }
			else if (data === " ") {
				const time = state.scale.toT(state.viewport.u0 + state.cursor * (state.viewport.u1 - state.viewport.u0));
				const track = selectedRow()?.track.id;
				const candidates = rows().filter(row => row.span && row.span.start <= time && row.span.end >= time);
				const selected = candidates.find(row => row.track.id === track) ?? candidates[0];
				if (selected) select(selected); else { notice = "No span under the keyboard cursor; ↑/↓ selects neighbouring spans."; }
			} else return false;
			changed(); return true;
		},
	};
}
