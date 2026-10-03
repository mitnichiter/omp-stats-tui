import { matchesKey, routeSgrMouseInput, type Component, type TUI } from "@oh-my-pi/pi-tui";
import { OverlayPanel, PanelDivider, PanelRows } from "@oh-my-pi/pi-tui/chrome";
import { truncateToWidth } from "@oh-my-pi/pi-tui/utils";
import {
	matchesSelectCancel,
	matchesSelectDown,
	matchesSelectPageDown,
	matchesSelectPageUp,
	matchesSelectUp,
} from "@oh-my-pi/pi-tui/keybinding-matchers";
import { ensureThemeSync, theme as activeTheme, type Theme, type ThemeColor } from "@oh-my-pi/pi-tui/theme";
import { bucketAxis } from "@oh-my-pi/omp-stats/client/data/range";

import { fetchFor, type DataNeed, type PanelData } from "../data/api";
import { DEFAULT_RANGE, nextRange, rangeLabel, type Range } from "../data/ranges";
import { describeSyncProgress, startIngest, type IngestHandle, type SyncEvent } from "../sync/client";
import { costsForBuckets, renderDailyBars } from "./charts/bars";
import { costWithUnpriced, formatInteger, formatPercent, tokenCells } from "./format";
import { glyphsFor, type SymbolPreset } from "./glyphs";
import { statsIcon } from "./icons";
import { LABEL_WIDTH, planLayout, type LayoutPlan } from "./layout";
import { SCREENS, screenById, type Screen, type ScreenContext, type ScreenId } from "./screens/types";

/**
 * THE MOUNT SEAM.
 *
 * Everything above the class is data, layout or charts. Everything below is the
 * part no unit test can reach, and the header comment of test/panel.test.ts
 * lists what a human has to check for it by hand.
 *
 * Three measured facts decide the shape of this file:
 *
 *  1. `render(width)` is a pure function of state, so the frame budget, the
 *     scroll clamp, the loading/error split and the whole keymap are testable
 *     without a terminal. Every invariant below is checked through that.
 *  2. Height comes from `tui.terminal.rows` on EVERY frame, because there is no
 *     resize hook. Scroll is therefore clamped inside `render` and never in the
 *     key handler, which makes shrink-on-resize automatic instead of a second
 *     code path that has to be remembered.
 *  3. `bun:sqlite` is synchronous and `initDb()` costs ~850 ms, so the load is
 *     fire-and-forget behind a loading state. The constructor never awaits it,
 *     because the constructor runs on the keystroke the user just typed.
 */

/**
 * Copied, not imported, from
 * `pi-coding-agent/src/extensibility/custom-commands/bundled/annotate/fullscreen.ts:13-20`.
 * Eight lines of constants; importing a private extension's constant couples
 * this project to that file's layout.
 *
 * `fullscreen: true` is NOT optional. It borrows the terminal's alternate screen
 * buffer — the same `?1049h` mechanism `btop` and `bottom` use — which is what
 * stops a full-height panel from fighting the transcript for the last row and
 * the last column. `mouseTracking: false` means the wheel arrives as SGR text
 * on stdin, which `routeSgrMouseInput` below understands and the editor behind
 * the overlay does not, so a click cannot leak through to it.
 */
export const STATS_OVERLAY_OPTIONS = {
	anchor: "top-left",
	width: "100%",
	maxHeight: "100%",
	margin: 0,
	fullscreen: true,
	mouseTracking: false,
} as const;

/**
 * Rows `OverlayPanel` actually draws around the body: top border, header,
 * divider, footer, bottom border. Counted from `OverlayPanel.render` rather
 * than from `layout.ts`'s advisory `CHROME_ROWS`, so the claim about the frame
 * and the frame itself cannot drift apart.
 */
const PANEL_CHROME_ROWS = 5;

/** The shortest terminal the panel will paint: the chrome plus one body row. */
export const MIN_PANEL_ROWS = PANEL_CHROME_ROWS + 1;

/**
 * Past this many dirty hours the host stops unioning dirty hours with the
 * facts and returns stale rows with holes in them, so the header stops calling
 * it merely pending. The number is the host's, quoted from the `RollupStatus`
 * doc in src/data/api.ts; it is a named constant here because a bare 96 in a
 * comparison reads as a typo the moment someone edits one side of it.
 */
export const EXACT_DIRTY_LIMIT = 96;

// G5: no section rule is drawn here. This constant used to size one, drawn
// directly under the "Cost per bucket" heading — the exact `───` separator the
// band grammar exists to eliminate. The heading already carries icon, title
// and meta on one line (G2), so the rule added nothing but the regression.

const NO_ROWS: readonly string[] = [];

/**
 * Bucket width of `costSeries`, in ms. The costs route aggregates by DAY for
 * every range, which is why this is not `rangeMeta(range).bucketMs` — see
 * `#chartRows`, and the dashboard's own `CostsRoute.tsx:201`.
 */
const COST_BUCKET_MS = 24 * 60 * 60 * 1000;

/** The panel's own warm handle: a promise to join, never a trigger. */
export interface WarmHandle {
	/**
	 * Resolve once the process-wide warm has settled. Idempotent, and already
	 * running by the time a user can type `/stats-tui`, so calling this AWAITS
	 * the warm rather than starting it — see `statsDbWarm` in src/index.ts.
	 */
	start(): Promise<boolean>;
}

/** The fetch the panel drives, narrowed so a test can answer with fixtures. */
export type PanelFetch = (needs: readonly DataNeed[], range: Range) => Promise<PanelData>;

/** Which of the three states the panel is in. Never inferred from empty data. */
export type PanelPhase = "loading" | "ready" | "error";

export interface StatsPanelOptions {
	tui: TUI;
	theme: Theme;
	/** Resolves the mount's promise. At most once, only from the close path. */
	done: () => void;
	/** Defaults to `tui.requestRender()`. Injected so a test can count repaints. */
	requestRender?: () => void;
	/** Awaited before the first query. Never triggered from here. */
	warm?: WarmHandle;
	/** Defaults to `fetchFor`. */
	fetch?: PanelFetch;
	/** Defaults to `startIngest`. */
	startIngest?: (onEvent: (event: SyncEvent) => void, signal?: AbortSignal) => IngestHandle;
	/** Opening range. Defaults to the closed set's own default. */
	range?: Range;
	/** Opening screen. Defaults to the first selectable one. */
	screenId?: ScreenId;
	/** Test seam for terminal height; production reads `tui.terminal.rows`. */
	rows?: number;
	/** Test seam for the chart's time axis; production reads the wall clock. */
	now?: () => number;
}

/**
 * What one keystroke means. Exported and pure so the entire key surface is
 * testable without a terminal; `handleInput` below only applies the result.
 */
export type PanelAction =
	| { type: "close" }
	| { type: "scroll"; rows?: number; viewport?: 1 | -1 }
	| { type: "scrollTo"; edge: "top" | "bottom" }
	| { type: "screen"; by: 1 | -1 }
	| { type: "screenIndex"; index: number }
	| { type: "range"; by: 1 | -1 }
	| { type: "sync" };


/**
 * The screens a key can land on. `excluded` is deliberately absent: a tab that
 * says "excluded from the port" is a real answer, but arrowing onto it wastes a
 * keystroke and no number may ever select it.
 */
export const SELECTABLE_SCREENS: readonly Screen[] = SCREENS.filter(s => s.status !== "excluded");

/**
 * Translate one input into one action, or null for a key this panel does not
 * own. Null matters as much as any mapping: swallowing an unowned key would
 * silently eat typing the user expected to reach the editor behind.
 *
 * The ORDER is load-bearing and it is the order `usage-dashboard.ts:1367-1405`
 * uses. The mouse router first, because its escape prefix swallows real keys;
 * then cancel, so a remapped cancel still closes; then the literal letters;
 * then the arrows and tab; then the digits.
 *
 * `matchesKey` / `matchesSelect*` read the module-global singleton, which is the
 * user's configured `keybindings.yml`. The `keybindings` argument the mount hands
 * the factory is deliberately NOT used: it is `KeybindingsManager.inMemory()`,
 * the static defaults, so resolving through it would ignore every remap.
 */

/**
 * Screen shortcuts. `1`-`9` for the first nine, `0` for the tenth — the
 * convention every numbered overlay uses, because there is no eleventh digit.
 * An eleventh screen is simply not on the number row and is reached with the
 * arrows; test/panel.test.ts asserts `SELECTABLE_SCREENS.length` against this
 * list, so the gap becomes a test failure rather than a silently dead key.
 */
const DIGITS: readonly string[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];

export function panelAction(data: string): PanelAction | null {
	let wheel: number | null = null;
	if (
		routeSgrMouseInput(data, event => {
			if (event.wheel === null) return false;
			wheel = event.wheel;
			return true;
		})
	) {
		return wheel === null || wheel === 0 ? null : { type: "scroll", rows: wheel * 2 };
	}
	if (matchesSelectCancel(data) || matchesKey(data, "q")) return { type: "close" };
	if (matchesKey(data, "r")) return { type: "range", by: 1 };
	if (matchesKey(data, "shift+r")) return { type: "range", by: -1 };
	if (matchesKey(data, "s")) return { type: "sync" };
	if (matchesKey(data, "left") || matchesKey(data, "shift+tab")) return { type: "screen", by: -1 };
	if (matchesKey(data, "right") || matchesKey(data, "tab")) return { type: "screen", by: 1 };
	const digit = DIGITS.indexOf(data);
	if (digit !== -1) return { type: "screenIndex", index: digit };
	if (matchesSelectUp(data)) return { type: "scroll", rows: -1 };
	if (matchesSelectDown(data)) return { type: "scroll", rows: 1 };
	if (matchesSelectPageUp(data)) return { type: "scroll", viewport: -1 };
	if (matchesSelectPageDown(data)) return { type: "scroll", viewport: 1 };
	if (matchesKey(data, "home")) return { type: "scrollTo", edge: "top" };
	if (matchesKey(data, "end")) return { type: "scrollTo", edge: "bottom" };
	return null;
}

// ---------------------------------------------------------------------------
// The panel's own body for `overview`, pending Task 13
// ---------------------------------------------------------------------------

/**
 * Needs and body for the screens the panel paints ITSELF.
 *
 * `overview` is here because the registry's `overviewScreen` still draws
 * labelled sample numbers, and Task 13 owns the real body. Opening `/stats-tui`
 * onto a page of fiction would defeat the only thing this file is for. When
 * Task 13 lands, delete both maps: the body then comes from `screenById` like
 * every other screen, and nothing else here changes.
 */
const LOCAL_NEEDS: Partial<Record<ScreenId, readonly DataNeed[]>> = {
	overview: ["overview", "costs", "rollupStatus"],
};

const LOCAL_BODIES: Partial<Record<ScreenId, (ctx: ScreenContext, chart: readonly string[]) => readonly string[]>> =
	{ overview: overviewBody };

/**
 * Panel state, held in a module-level WeakMap rather than in `#private` fields.
 *
 * This is the test seam, and it is deliberately not a set of public getters:
 * a debugger surface invites production code to read it. The class reaches
 * state through `STATE.get(this)` exactly as `__testing` does, so the two can
 * never disagree about what "the current range" means.
 */
interface PanelState {
	range: Range;
	screenId: ScreenId;
	scroll: number;
	maxScroll: number;
	data: PanelData | null;
	error: string | null;
	identity: string;
	generation: number;
	closed: boolean;
	done: boolean;
	syncEvent: SyncEvent | null;
	syncError: string | null;
	ingest: IngestHandle | null;
	/** `done()` calls so far. The mount promise must resolve exactly once. */
	doneCalls: number;
	/** Last frame's outputs, untruncated, so a test reads what was composed. */
	source: readonly string[];
	chart: readonly string[];
	header: string;
	title: string;
}

const STATE = new WeakMap<StatsPanel, PanelState>();

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export class StatsPanel implements Component {
	readonly #options: StatsPanelOptions;
	readonly #tui: TUI;
	readonly #theme: Theme;
	readonly #panel: OverlayPanel;
	readonly #header: PanelRows;
	readonly #body: PanelRows;
	readonly #footer: PanelRows;
	readonly #closeController = new AbortController();
	readonly #state: PanelState;

	constructor(options: StatsPanelOptions) {
		this.#options = options;
		this.#tui = options.tui;
		this.#theme = options.theme;
		this.#state = {
			range: options.range ?? DEFAULT_RANGE,
			screenId: options.screenId ?? (SELECTABLE_SCREENS[0]?.id ?? "overview"),
			scroll: 0,
			maxScroll: 0,
			data: null,
			error: null,
			identity: "",
			generation: 0,
			closed: false,
			done: false,
			syncEvent: null,
			syncError: null,
			ingest: null,
			doneCalls: 0,
			source: NO_ROWS,
			chart: NO_ROWS,
			header: "",
			title: "Stats",
		};
		STATE.set(this, this.#state);

		this.#panel = new OverlayPanel("Stats", "omp.overlay.stats");
		this.#header = new PanelRows();
		this.#header.setHeight(1);
		this.#body = new PanelRows();
		this.#footer = new PanelRows();
		this.#footer.setHeight(1);
		this.#panel.addChild(this.#header);
		this.#panel.addChild(this.#body);
		this.#panel.addChild(new PanelDivider());
		this.#panel.addChild(this.#footer);

		// Fire-and-forget, never awaited: `initDb()` is ~850 ms of synchronous
		// work and this constructor runs on the keystroke the user just typed.
		this.#load();
	}

	// --- load ----------------------------------------------------------------

	/**
	 * `rollupStatus` is requested on EVERY load, whatever the screen declares.
	 * It is the only read that refuses to answer when the database was never
	 * initialised, and that refusal is the whole difference between "no usage
	 * in this window" and "the panel has no idea". Every other read degrades to
	 * `[]` or to zeroes silently, which is why the panel must never be allowed
	 * to reach that state unannounced.
	 */
	#needs(): readonly DataNeed[] {
		const declared = LOCAL_NEEDS[this.#state.screenId] ?? screenById(this.#state.screenId).needs;
		return declared.includes("rollupStatus") ? declared : [...declared, "rollupStatus"];
	}

	#load(): void {
		const state = this.#state;
		if (state.closed) return;
		const identity = `${state.screenId}:${state.range}`;
		// A different question invalidates the old answer, so the panel says
		// "loading" rather than painting one window's numbers under another's
		// heading. A reload of the SAME question keeps the last frame up instead
		// of flashing empty at the user.
		if (identity !== state.identity) {
			state.identity = identity;
			state.data = null;
			state.error = null;
			state.scroll = 0;
		}
		state.generation++;
		const generation = state.generation;
		LOADS.set(
			this,
			(async () => {
				try {
					// Awaited, never started: `start()` is memoised and was
					// already called at extension load, so this joins it.
					await (this.#options.warm ?? NO_WARM).start();
					if (this.#superseded(generation)) return;
					const fetch = this.#options.fetch ?? fetchFor;
					const data = await fetch(this.#needs(), state.range);
					if (this.#superseded(generation)) return;
					state.data = data;
					state.error = null;
				} catch (error) {
					if (this.#superseded(generation)) return;
					// Not zeroes, not an empty list: the panel says what it could
					// not read. `fetchRollupStatus` throws when `currentDb()` is
					// null, so this is the ordinary outcome of a failed warm.
					state.data = null;
					state.error = error instanceof Error ? error.message : String(error);
				} finally {
					if (!this.#superseded(generation)) this.#changed();
				}
			})(),
		);
	}

	/** A superseded load must not write state, repaint, or move the phase. */
	#superseded(generation: number): boolean {
		return this.#state.closed || generation !== this.#state.generation;
	}

	#changed(): void {
		(this.#options.requestRender ?? (() => this.#tui.requestRender()))();
	}

	// --- background ingest (Task 12's client) --------------------------------

	#beginSync(): void {
		const state = this.#state;
		if (state.closed || state.ingest) return;
		state.syncEvent = null;
		state.syncError = null;
		const spawn = this.#options.startIngest ?? startIngest;
		let handle: IngestHandle;
		try {
			handle = spawn(event => this.#onSyncEvent(event), this.#closeController.signal);
		} catch (error) {
			state.syncError = error instanceof Error ? error.message : String(error);
			this.#changed();
			return;
		}
		state.ingest = handle;
		// The child reports failure through a rejected promise that nothing else
		// observes, and an unobserved rejection is a crash in Bun.
		void handle.settled
			.catch(() => {})
			.finally(() => {
				if (state.ingest === handle) state.ingest = null;
			});
		this.#changed();
	}

	#onSyncEvent(event: SyncEvent): void {
		const state = this.#state;
		if (state.closed) return;
		if (event.type === "done") {
			state.syncEvent = null;
			state.syncError = null;
			// The rollup moved underneath us, so every number on screen is one
			// sync out of date until the reload lands.
			this.#load();
			return;
		}
		if (event.type === "error") {
			state.syncEvent = null;
			state.syncError = event.error;
		} else {
			state.syncEvent = event;
		}
		this.#changed();
	}

	// --- render --------------------------------------------------------------

	render(width: number): readonly string[] {
		const state = this.#state;
		const rows = this.#options.rows ?? this.#tui.terminal.rows ?? 40;
		const height = Math.max(MIN_PANEL_ROWS, Number.isFinite(rows) ? Math.trunc(rows) : MIN_PANEL_ROWS);
		// The one and only `getSymbolPreset()` read in this feature. Every path
		// below receives the preset; none of them branch on it.
		const preset = this.#theme.getSymbolPreset();
		const plan = planLayout(width, height, preset);

		state.source = this.#bodyLines(plan, preset);
		state.maxScroll = Math.max(0, state.source.length - plan.bodyRows);
		// Clamped HERE, not in the key handler, so a terminal that shrank
		// between two keypresses cannot leave the view scrolled past its end.
		state.scroll = Math.max(0, Math.min(state.scroll, state.maxScroll));

		state.title = `Stats · ${rangeLabel(state.range)} · ${screenById(state.screenId).label}`;
		this.#panel.title = state.title;
		state.header = this.#headerLine(plan, preset);
		this.#header.setLines([state.header]);
		this.#body.setLines(state.source.slice(state.scroll, state.scroll + plan.bodyRows));
		this.#body.setHeight(plan.bodyRows);
		this.#footer.setLines([this.#footerLine(plan)]);
		return this.#panel.render(width);
	}

	#phase(): PanelPhase {
		const state = this.#state;
		if (state.error !== null) return "error";
		return state.data !== null ? "ready" : "loading";
	}

	#bodyLines(plan: LayoutPlan, preset: SymbolPreset): readonly string[] {
		const state = this.#state;
		const phase = this.#phase();
		state.chart = NO_ROWS;
		if (phase === "loading") return loadingLines(this.#theme);
		if (phase === "error") return errorLines(this.#theme, preset, state.error ?? "", state.syncError);

		const data = state.data as PanelData;
		const context = this.#screenContext(plan, preset, data);
		const chart = this.#chartRows(context);
		state.chart = chart;
		try {
			const screen = screenById(state.screenId);
			return LOCAL_BODIES[screen.id]?.(context, chart) ?? screen.render(context);
		} catch (error) {
			// A registry that throws must not blank the panel. The overview is
			// composed here from bars and formatters and depends on no screen
			// module at all, so this is a real answer rather than an error where
			// an answer should be.
			return overviewBody(context, chart, error instanceof Error ? error.message : String(error));
		}
	}

	#screenContext(plan: LayoutPlan, preset: SymbolPreset, data: PanelData): ScreenContext {
		const theme = this.#theme;
		return {
			width: plan.innerWidth,
			rows: plan.bodyRows,
			range: this.#state.range,
			theme,
			preset,
			glyphs: glyphsFor(preset),
			plan,
			data,
			colorFor: index => text =>
				theme.fg(SERIES_COLORS[((index % SERIES_COLORS.length) + SERIES_COLORS.length) % SERIES_COLORS.length], text),
		};
	}

	/**
	 * Bars over COST, bucketed onto the host's own axis for the active range.
	 *
	 * Cost, not tokens: the measured price spread across this database is 41x at
	 * comparable token volume, so a token-scaled chart ranks sessions by volume
	 * and then calls the most expensive one the smallest.
	 *
	 * The axis comes from the host's own `bucketAxis` rather than a hand-built
	 * loop, because `densify` matches bucket timestamps EXACTLY and a chart on a
	 * different alignment silently drops every point that misses.
	 *
	 * The bucket width is DAY for every range, because `costSeries` is
	 * day-bucketed regardless of the range asked for — the dashboard's own costs
	 * page passes `DAY_MS` explicitly for exactly this reason
	 * (`omp-stats/src/client/routes/CostsRoute.tsx:201`). Deriving it from
	 * `rangeMeta` instead would put an hourly axis under midnight-aligned rows
	 * for `24h`, and the chart would be silently empty.
	 *
	 * An axis longer than the panel is wide is truncated from the FRONT: a time
	 * series that has run out of room should lose its oldest column, not its
	 * newest.
	 */
	#chartRows(ctx: ScreenContext): readonly string[] {
		const series = ctx.data.costs?.costSeries ?? [];
		if (series.length === 0) return NO_ROWS;
		const width = Math.max(1, ctx.plan.innerWidth);
		const axis = bucketAxis(ctx.range, series.map(point => point.timestamp), COST_BUCKET_MS, this.#options.now?.());
		const buckets = axis.length > width ? axis.slice(-width) : axis;
		return renderDailyBars(costsForBuckets(series, buckets), {
			width,
			height: ctx.plan.barHeight,
			glyphs: ctx.glyphs,
			accent: text => ctx.theme.fg("accent", text),
			dim: text => ctx.theme.fg("dim", text),
		});
	}

	#headerLine(plan: LayoutPlan, preset: SymbolPreset): string {
		const state = this.#state;
		if (state.syncEvent) return describeSyncProgress(state.syncEvent, plan.innerWidth);
		const dirty = state.data?.rollupStatus?.dirtyHours ?? 0;
		if (dirty <= 0) return "";
		// Above the host's exact limit the union stops happening, so this is no
		// longer "pending" — it is holes in the numbers below.
		return this.#theme.fg(dirty > EXACT_DIRTY_LIMIT ? "warning" : "dim", `${dirty} dirty ${dirty === 1 ? "hour" : "hours"}`);
	}

	#footerLine(plan: LayoutPlan): string {
		const state = this.#state;
		const parts = ["←→ screen", `${rangeLabel(state.range)} · r range`, "esc close"];
		if (state.maxScroll > 0) parts.unshift("↑↓ scroll");
		if (state.syncEvent || state.ingest) parts.splice(2, 0, "syncing…");
		else if (state.syncError) parts.splice(2, 0, "sync failed");
		else parts.splice(2, 0, "s sync");
		// The chrome already truncates every row it wraps, but a hint that ends
		// mid-word is worse than a shorter one, so the parts are dropped from the
		// RIGHT until the row fits. `truncateToWidth` rather than `slice` because
		// the row is styled: slicing a styled string can cut an escape sequence in
	// half and leak the remainder as literal text.
		let hint = parts.join(" · ");
		while (parts.length > 1 && Bun.stringWidth(hint) > plan.innerWidth) {
			parts.pop();
			hint = parts.join(" · ");
		}
		return this.#theme.fg("dim", truncateToWidth(hint, plan.innerWidth));
	}

	// --- input ---------------------------------------------------------------

	handleInput(data: string): void {
		const state = this.#state;
		if (state.closed) return;
		const action = panelAction(data);
		if (!action) return;
		switch (action.type) {
			case "close":
				this.#finish();
				return;
			case "scroll":
				this.#scrollBy(action.viewport ? action.viewport * Math.max(1, state.maxScroll) : (action.rows ?? 0));
				return;
			case "scrollTo":
				state.scroll = action.edge === "top" ? 0 : state.maxScroll;
				this.#changed();
				return;
			case "screen":
				this.#selectScreen(this.#indexOf(state.screenId) + action.by);
				return;
			case "screenIndex":
				this.#selectScreen(action.index);
				return;
			case "range":
				state.range = nextRange(state.range, action.by);
				this.#load();
				return;
			case "sync":
				this.#beginSync();
				return;
		}
	}


	#indexOf(id: ScreenId): number {
		return SELECTABLE_SCREENS.findIndex(screen => screen.id === id);
	}
	#selectScreen(index: number): void {
		const state = this.#state;
		const count = SELECTABLE_SCREENS.length;
		if (count === 0) return;
		const screen = SELECTABLE_SCREENS[((index % count) + count) % count];
		if (screen.id === state.screenId) return;
		state.screenId = screen.id;
		state.scroll = 0;
		this.#load();
	}

	#scrollBy(delta: number): void {
		this.#state.scroll = Math.max(0, Math.min(this.#state.scroll + delta, this.#state.maxScroll));
		this.#changed();
	}

	// --- teardown ------------------------------------------------------------

	/** Close from the keyboard. `done()` runs at most once, whatever the host does. */
	#finish(): void {
		const state = this.#state;
		if (state.done) return;
		state.done = true;
		this.dispose();
		state.doneCalls++;
		this.#options.done();
	}

	/**
	 * Idempotent by contract, because the host ALSO calls `component.dispose()`
	 * in its own cleanup after hiding the overlay. It deliberately does not call
	 * `done()`: teardown and "the user asked to leave" are different events, and
	 * conflating them resolves the mount's promise from a path the user never
	 * took.
	 */
	dispose(): void {
		const state = this.#state;
		if (state.closed) return;
		state.closed = true;
		this.#closeController.abort();
		// The child may be inside `withStatsSyncLock`, which has no cancellation,
		// so it is SIGKILLed rather than asked nicely. Per-file writes are
		// transactional and the OS releases the lock when the process dies.
		state.ingest?.kill();
		state.ingest = null;
		this.#panel.dispose();
	}
}

// ---------------------------------------------------------------------------
// Bodies
// ---------------------------------------------------------------------------

function loadingLines(theme: Theme): readonly string[] {
	return [
		theme.fg("dim", "Loading usage…"),
		"",
		theme.fg("dim", "Waiting on the database warm that ran at startup. The panel never starts one:"),
		theme.fg("dim", "initDb() is ~850 ms of synchronous work, and this runs on the keystroke you typed."),
	];
}

function errorLines(theme: Theme, preset: SymbolPreset, error: string, syncError: string | null): readonly string[] {
	const lines = [
		`${statsIcon(preset, "warning", theme)} Usage could not be read`,
		"",
		`  ${error}`,
		"",
		// The distinction the whole data seam exists for. An unreadable answer
		// is not a zero, and a panel that painted zeros here would be lying
		// about spend rather than merely silent about it.
		theme.fg("dim", "  This is not a zero. An uninitialised database answers every read with"),
		theme.fg("dim", "  empty rows, so the panel refuses to paint a number it could not measure."),
	];
	if (syncError) lines.push("", `  background sync: ${syncError}`);
	lines.push("", theme.fg("dim", "  s retry a background sync · esc close"));
	return lines;
}

/**
 * The overview body: a cost-per-bucket chart over the active range, then the
 * figures that make it legible.
 *
 * Three rules are load-bearing in the rows below, and each one already cost this
 * project a lie:
 *
 *  - `costWithUnpriced`, never `formatCost`. A `$0.00` beside 34,870 unpriced
 *    requests reads as "this was free", which the data cannot support.
 *  - `tokenCells`, never a combined total. One number summing fresh, output,
 *    cache-read and cache-write tokens is dominated by cache reads and hides
 *    the rest, so output gets its own cell and cache read its own rate.
 *  - Bars scale by cost, in `#chartRows`, for the 41x price spread.
 */
function overviewBody(ctx: ScreenContext, chart: readonly string[], notice?: string): readonly string[] {
	const { theme, plan } = ctx;
	const overall = ctx.data.overview?.overall;
	const series = ctx.data.costs?.costSeries ?? [];
	const rows: string[] = [
		`${statsIcon(ctx.preset, "cost", theme)} Cost per bucket  ${theme.fg("dim", rangeLabel(ctx.range))}`,
	];
	if (notice) rows.push(theme.fg("warning", notice));
	if (chart.length === 0 || series.length === 0) {
		// Reachable only once `rollupStatus` has ANSWERED, so this is an honest
		// "nothing happened in this window" rather than the silent-empty trap.
		rows.push("", theme.fg("dim", "No activity recorded in this range."));
		return rows;
	}
	rows.push(...chart);

	// The peak is quoted with the same unpriced caveat as the total, so a window
	// whose only activity was unpriced cannot claim a free tallest bar. The count
	// beside it is REQUESTS, not buckets: `costSeries` is one row per model per
	// day, so a bucket count here would be a count of model-runs dressed up as
	// calendar days.
	const peak = Math.max(...series.map(point => point.cost));
	const activity = series.reduce((total, point) => total + point.requests, 0);
	rows.push("", theme.fg("dim", `  tallest bucket ${costWithUnpriced(peak, 0)} · ${formatInteger(activity)} requests`));

	if (!overall) {
		rows.push("", theme.fg("warning", "  The range loaded but carried no aggregate; nothing is invented here."));
		return rows;
	}
	const cells = tokenCells({
		totalInputTokens: overall.totalInputTokens,
		totalOutputTokens: overall.totalOutputTokens,
		totalCacheReadTokens: overall.totalCacheReadTokens,
		totalCacheWriteTokens: overall.totalCacheWriteTokens,
		cacheRate: overall.cacheRate,
	});
	rows.push(
		"",
		row(theme, "cost", costWithUnpriced(overall.totalCost, overall.unpricedRequests)),
		row(theme, "requests", `${formatInteger(overall.totalRequests)} · ${formatInteger(overall.failedRequests)} failed`),
		row(theme, "tokens", `fresh ${cells.fresh} · read ${cells.cacheRead} · written ${cells.cacheWrite} · ${cells.rate}`),
		row(theme, "output", formatInteger(overall.totalOutputTokens)),
	);
	if (overall.errorRate > 0) rows.push(row(theme, "errors", formatPercent(overall.errorRate)));
	return rows;
}

function row(theme: Theme, label: string, value: string): string {
	return `  ${theme.fg("dim", label.padEnd(LABEL_WIDTH))}${value}`;
}

/** Theme colour names, so a theme switch restyles the series without a code change. */
const SERIES_COLORS: readonly ThemeColor[] = ["accent", "success", "warning", "error", "muted", "borderAccent"];

const NO_WARM: WarmHandle = { start: () => Promise.resolve(true) };

/** The in-flight load per panel, so a test can await a settle without a timer. */
const LOADS = new WeakMap<StatsPanel, Promise<void>>();

// ---------------------------------------------------------------------------
// Test seam
// ---------------------------------------------------------------------------

export interface PanelTestState {
	data?: PanelData;
	fetch?: PanelFetch;
	warm?: WarmHandle;
	startIngest?: (onEvent: (event: SyncEvent) => void, signal?: AbortSignal) => IngestHandle;
	range?: Range;
	screenId?: ScreenId;
	rows?: number;
	now?: () => number;
}

const ANSI = /\x1b\[[0-9;]*m/g;
const stripAnsi = (text: string) => text.replace(ANSI, "");
/**
 * The interface the tests assert against — the invariants a terminal would
 * otherwise be needed to check. `makePanel` builds a real `StatsPanel` with a
 * stub `tui` and the live theme, so `render(width)` keeps its production
 * signature and stays a pure function of state.
 */
export const __testing = {
	makePanel(state: PanelTestState = {}): StatsPanel {
		ensureThemeSync();
		const panel = new StatsPanel({
			// A TUI with no terminal behind it: nothing here reads it, because
			// `rows` is supplied and the frame size comes from state.
			tui: { terminal: { rows: state.rows ?? 40 }, requestRender: () => {} } as unknown as TUI,
			theme: activeTheme,
			done: () => {},
			requestRender: () => {},
			warm: state.warm ?? { start: () => Promise.resolve(true) },
			fetch: state.fetch ?? (async () => state.data as PanelData),
			startIngest: state.startIngest,
			range: state.range,
			screenId: state.screenId,
			rows: state.rows ?? 40,
			now: state.now,
		});
		return panel;
	},

	/** Resolves when the panel's current load settles, however it settled. */
	async settled(panel: StatsPanel): Promise<StatsPanel> {
		await (LOADS.get(panel) ?? Promise.resolve());
		return panel;
	},

	debugState: (panel: StatsPanel) => STATE.get(panel) as PanelState,
	debugPhase: (panel: StatsPanel) => phaseOf(panel),
	debugRange: (panel: StatsPanel) => STATE.get(panel)!.range,
	debugScreenId: (panel: StatsPanel) => STATE.get(panel)!.screenId,
	debugScreenIds: () => SELECTABLE_SCREENS.map(screen => screen.id),
	debugScroll: (panel: StatsPanel) => STATE.get(panel)!.scroll,
	debugMaxScroll: (panel: StatsPanel) => STATE.get(panel)!.maxScroll,
	debugClosed: (panel: StatsPanel) => STATE.get(panel)!.closed,
	debugDoneCalls: (panel: StatsPanel) => STATE.get(panel)!.doneCalls,
	debugChartRows: (panel: StatsPanel, width = 120): readonly string[] => {
		panel.render(width);
		return STATE.get(panel)!.chart;
	},
	debugBody: (panel: StatsPanel): readonly string[] => {
		panel.render(120);
		return STATE.get(panel)!.source.map(stripAnsi);
	},
	debugHeader: (panel: StatsPanel) => {
		panel.render(120);
		return stripAnsi(STATE.get(panel)!.header);
	},
	debugTitle: (panel: StatsPanel) => {
		panel.render(120);
		return stripAnsi(STATE.get(panel)!.title);
	},
};

function phaseOf(panel: StatsPanel): PanelPhase {
	const state = STATE.get(panel) as PanelState;
	if (state.error !== null) return "error";
	return state.data !== null ? "ready" : "loading";
}
