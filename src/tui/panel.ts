import { matchesKey, routeSgrMouseInput, TabBar, type Component, type SgrMouseEvent, type TUI } from "@oh-my-pi/pi-tui";
import { OverlayPanel, PanelDivider, PanelRows } from "@oh-my-pi/pi-tui/chrome";
import { truncateToWidth, visibleWidth } from "@oh-my-pi/pi-tui/utils";
import {
	matchesSelectCancel,
	matchesSelectDown,
	matchesSelectPageDown,
	matchesSelectPageUp,
	matchesSelectUp,
} from "@oh-my-pi/pi-tui/keybinding-matchers";
import { ensureThemeSync, theme as activeTheme, type Theme, type ThemeColor } from "@oh-my-pi/pi-tui/theme";
import { node, text } from "@oh-my-pi/pi-tui/native/describe";
import { overlayCard } from "@oh-my-pi/pi-tui/native/overlay";
import { leafKey, type DescribeContext, type NativeNode, type NativeUiEvent } from "@oh-my-pi/pi-tui/native/node";
import { bucketAxis } from "@oh-my-pi/omp-stats/client/data/range";

import { fetchFor, type DataNeed, type PanelData } from "../data/api";
import { DEFAULT_RANGE, nextRange, rangeLabel, type Range } from "../data/ranges";
import { describeSyncProgress, startIngest, type IngestHandle, type SyncEvent } from "../sync/client";
import { costsForBuckets, renderDailyBars } from "./charts/bars";
import { costWithUnpriced, formatInteger, formatPercent, tokenCells } from "./format";
import { glyph, glyphsFor, type SymbolPreset } from "./glyphs";
import { statsIcon } from "./icons";
import { LABEL_WIDTH, planLayout, type LayoutPlan } from "./layout";
import { SCREENS, screenById, type Screen, type ScreenContext, type ScreenId } from "./screens/types";
import { SCREEN_SPECS } from "../layout/spec";
import { renderScreenWith } from "./render/screen";
import {
	JUMP_TIMEOUT_MS,
	chipFor,
	progressLineFor,
	screenForHotkey,
	sidebar,
	topbar,
	type ChromeSync,
} from "./chrome";
import { framePolicy } from "./responsive";
import { TAB_BAR_INDENT, buildTabs, tabBarTheme } from "./tabs";
import { MIN_PANEL_ROWS as FRAME_MIN_PANEL_ROWS, bodyRows } from "./frame";
import { footerHints, hintsFor, type HintMode } from "./footer";
import { hitTest, type MouseFrame } from "./mouse";

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
 * the last column. Mouse tracking stays on the host default: while a fullscreen
 * overlay holds the alt screen the engine emits `1000h/1003h/1006h`, so clicks,
 * wheel and motion arrive as SGR text on stdin, which `routeSgrMouseInput`
 * understands and the editor behind the overlay does not — a click cannot leak
 * through to it. `/settings` and `/usage` rely on the same default; opting out
 * would cost clicks and hover, not just the wheel.
 */
export const STATS_OVERLAY_OPTIONS = {
	anchor: "top-left",
	width: "100%",
	maxHeight: "100%",
	margin: 0,
	fullscreen: true,
} as const;

/**
 * Rows `OverlayPanel` actually draws around the body: top border, header,
 * divider, footer, bottom border. Counted from `OverlayPanel.render` rather
 * than from `layout.ts`'s advisory `CHROME_ROWS`, so the claim about the frame
 * and the frame itself cannot drift apart.
 */
const PANEL_CHROME_ROWS = 5;

/** The shortest terminal the panel will paint: the chrome plus one body row. */
export const MIN_PANEL_ROWS = FRAME_MIN_PANEL_ROWS;

/**
 * Shortest terminal that still gets the full grouped sidebar: its eleven nav
 * rows (three headings + eight screens) plus the topbar, the divider, the
 * footer, one body row and the two borders. Below this the sidebar degrades to
 * the one-row icon rail rather than overflowing the frame.
 */
const MIN_SIDEBAR_ROWS = 20;
/**
 * Past this many dirty hours the host stops unioning dirty hours with the
 * facts and returns stale rows with holes in them, so the chrome escalates from
 * "pending" to a warning. The number is the host's, quoted from the
 * `RollupStatus` doc in src/data/api.ts; it is a named constant because a bare
 * 96 in a comparison reads as a typo the moment someone edits one side of it.
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
	| { type: "screenId"; id: string }
	| { type: "armJump" }
	| { type: "noop" }
	| { type: "range"; by: 1 | -1 }
	| { type: "sync" };


/** The IR spec for a screen id, or `undefined` when the registry has no spec. */
export function specById(id: ScreenId) {
	return SCREEN_SPECS.find(spec => spec.id === id);
}

/**
 * The screens a key can land on. `excluded` is deliberately absent: a tab that
 * says "excluded from the port" is a real answer, but arrowing onto it wastes a
 * keystroke and no number may ever select it.
 */
export const SELECTABLE_SCREENS: readonly Screen[] = SCREENS.filter(screen => {
	const spec = specById(screen.id);
	// A screen is selectable only if the layout IR DESCRIBES it and can be FILLED.
	// `deferred` means described but unfillable; a screen with no spec at all
	// has no body to draw either. Either way, arrowing onto it would spend a
	// keystroke painting a page the panel cannot honestly fill.
	return spec !== undefined && !spec.deferred && screen.status !== "excluded";
});

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

/**
 * THE `tab` DECISION, stated once so it never goes ambiguous again.
 *
 * F23 §1.4 argued `tab` should fall through to next-screen only when a screen
 * had ≤ 1 band, reserving it for landmark jumping otherwise. F23's own key
 * table in the same section lists `tab` → "next screen" in BOTH rows, and
 * closer to the point, this panel has no landmark-focus model at all: there is
 * no `landmark` action, no section-focus state, and no jump to reserve `tab`
 * for. A key that is "reserved" for a jump that does not exist is a dead key,
 * and a dead key is worse than either behaviour — the reader presses it and
 * the panel silently does nothing.
 *
 * So `tab` switches screens everywhere, exactly like `→`. The brief's
 * `tab`-falls-through rule is closed as CONTRADICTED by F23's own table, and
 * this comment is the record: should a real landmark model ever land, THAT is
 * the commit that reclaims `tab`, and it reclaims it by adding an action, not
 * by re-reading this mapping.
 */
const TAB_SWITCHES_SCREENS = true;

export function panelAction(data: string, jumpArmed = false): PanelAction | null {
	// Wheel-only: clicks and motion route through `#routeMouse`, which needs
	// the last frame's geometry. The wheel needs none — it scrolls the body
	// from anywhere, exactly like `usage-dashboard.ts:1369-1373` (`wheel * 2`).
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
	// The `g` prefix (Shell.tsx parity): while armed, a single letter is
	// CONSUMED — a jump on match, a no-op otherwise — so `g r` jumps and never
	// cycles the range and `g s` never syncs. Resolution lives in chrome.ts.
	if (jumpArmed && data.length === 1) {
		const id = screenForHotkey(data);
		return id === null ? { type: "noop" } : { type: "screenId", id };
	}
	if (matchesSelectCancel(data) || matchesKey(data, "q")) return { type: "close" };
	if (data === "g" || data === "G") return { type: "armJump" };
	if (matchesKey(data, "r")) return { type: "range", by: 1 };
	if (matchesKey(data, "shift+r")) return { type: "range", by: -1 };
	if (matchesKey(data, "s")) return { type: "sync" };
	if (matchesKey(data, "left") || matchesKey(data, "shift+tab")) return { type: "screen", by: -1 };
	if (matchesKey(data, "right")) return { type: "screen", by: 1 };
	if (TAB_SWITCHES_SCREENS && matchesKey(data, "tab")) return { type: "screen", by: 1 };
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
	/** `Date.now()` when `g` armed the section jump, else 0 (Shell.tsx `pendingG` parity). */
	jumpArmedAt: number;
	scroll: number;
	maxScroll: number;
	data: PanelData | null;
	error: string | null;
	identity: string;
	generation: number;
	closed: boolean;
	done: boolean;
	syncEvent: SyncEvent | null;
	/** Wall clock of the last settled sync, for the Live chip's relative age (`s`/`done`). */
	lastSyncedAt: number | null;
	syncError: string | null;
	ingest: IngestHandle | null;
	/** `done()` calls so far. The mount promise must resolve exactly once. */
	doneCalls: number;
	/** Screen id under the pointer, or null. Painted with the host's `hoverTab` token. */
	hoveredSidebarId: string | null;
	/** Strip tab under the pointer, mirrored from the TabBar (which keeps its own private). */
	hoveredStripId: string | null;
	/** Last frame's geometry for the mouse router. Null until the first render. */
	mouse: MouseFrame | null;
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
	/**
	 * TERN PROBE (F2 experiment, scratch — additive only). The terminal draws
	 * the sheet: a large glass overlay titled Stats. `render()` is untouched
	 * and stays the universal path; these methods only speak when a TSP
	 * terminal is listening.
	 */
	readonly nativeOverlay = { role: "omp.overlay.stats", size: "lg", anchor: "center", head: "Stats" } as const;

	readonly #options: StatsPanelOptions;
	readonly #tui: TUI;
	readonly #theme: Theme;
	readonly #panel: OverlayPanel;
	readonly #tabBar: TabBar;
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
			jumpArmedAt: 0,
			scroll: 0,
			maxScroll: 0,
			data: null,
			error: null,
			identity: "",
			generation: 0,
			closed: false,
			done: false,
			syncEvent: null,
			lastSyncedAt: null,
			syncError: null,
			ingest: null,
			doneCalls: 0,
			hoveredSidebarId: null,
			hoveredStripId: null,
			mouse: null,
			source: NO_ROWS,
			chart: NO_ROWS,
			header: "",
			title: "Stats",
		};
		STATE.set(this, this.#state);

		this.#panel = new OverlayPanel("Stats", "omp.overlay.stats");
		this.#tabBar = new TabBar("", [], tabBarTheme(this.#theme));
		// The strip folds its own hints into the footer, so it must not spend a
		// cell on `(tab to cycle)`.
		this.#tabBar.showHint = false;
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
		// The SPEC's needs, or the registry's when no spec exists — never a
		// hand-maintained map beside them, which is the shim this replaced.
		const declared = specById(this.#state.screenId)?.needs ?? screenById(this.#state.screenId).needs;
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
			// The settled moment the web stamps `lastSyncedAt` (live.ts): the age
			// the Live chip reads comes from here. Clock is injected for tests.
			state.lastSyncedAt = this.#options.now?.() ?? Date.now();
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

	/**
	 * What the topbar's live chip reads. DERIVED per frame from the same
	 * `SyncEvent` the progress line reads, so the chip and the bar can never
	 * disagree about whether a sync is running (LiveChip.tsx's `sync.phase`).
	 */
	#chromeSync(): ChromeSync {
		const state = this.#state;
		const event = state.syncEvent;
		const progress = event?.type === "progress" ? event : null;
		return {
			syncing: progress !== null || state.ingest !== null,
			current: progress?.current ?? 0,
			total: progress?.total ?? 0,
			// Only ingest reports a denominator; scan and rollup are indeterminate
			// by phase, exactly as progressLineFor treats them.
			determinate: progress?.phase === "ingest" && progress.total > 0,
			error: state.syncError,
			dirtyHours: state.data?.rollupStatus?.dirtyHours ?? 0,
			lastSyncedAt: state.lastSyncedAt,
			now: this.#options.now?.() ?? Date.now(),
		};
	}

	render(width: number): readonly string[] {
		const state = this.#state;
		const rows = this.#options.rows ?? this.#tui.terminal.rows ?? 40;
		// The one and only `getSymbolPreset()` read in this feature. Every path
		// below receives the preset; none of them branch on it.
		const preset = this.#theme.getSymbolPreset();
		const policy = framePolicy(width);
		const innerWidth = Math.max(1, width - 4);

		const dirty = state.data?.rollupStatus?.dirtyHours ?? 0;
		// Above the host's exact limit the union stops happening, so this is no
		// longer "pending" — it is holes in the numbers below.
		const freshness =
			dirty > 0
				? this.#theme.fg(
						dirty > EXACT_DIRTY_LIMIT ? "warning" : "dim",
						`${dirty} dirty ${dirty === 1 ? "hour" : "hours"}`,
					)
				: "";
		state.header = freshness;

		// THE TOPBAR is the chrome's first row (web parity: Shell.tsx's fixed
		// topbar), plus the thin progress line while a sync streams — the bar the
		// web paints under that topbar. The tab strip is NOT gone: below the
		// sidebar's width it becomes the nav row (see below).
		const chip = chipFor(this.#theme, this.#chromeSync());
		const top = topbar(this.#theme, { range: state.range, chip, freshness, innerWidth });
		const progress = progressLineFor(state.syncEvent, innerWidth);
		const topLines = progress === "" ? [top] : [top, progress];

		// WIDE GETS THE SIDEBAR COLUMN; EVERYTHING NARROWER GETS THE STRIP.
		// The web's medium band keeps a 64px icon rail beside the panel, but in a
		// terminal that rail is a whole column of width spent on one row of
		// glyphs, and the strip ALREADY collapses itself to those same one-cell
		// `TAB_SHORT` forms when the width runs out (`TabBar`'s collapse order,
		// measured by `TAB_ROWS`). One rule, no second nav grammar.
		//
		// A terminal shorter than the chrome keeps NO nav row at all: a row the
		// frame cannot afford pushes the bottom border off the screen, which is
		// the one failure a `render(width)`-only assertion never catches.
		const spec = specById(state.screenId);
		const column = policy.sidebar === "full" && rows >= MIN_SIDEBAR_ROWS;
		let strip: readonly string[] = NO_ROWS;
		if (!column && spec !== undefined && rows > MIN_PANEL_ROWS) {
			const tabs = buildTabs(preset, this.#theme, spec.id);
			this.#tabBar.setTabs(tabs, spec.id);
			strip = this.#tabBar.render(Math.max(1, width - TAB_BAR_INDENT));
		}
		const nav = column ? sidebar(this.#theme, preset, state.screenId, state.hoveredSidebarId) : null;
		const sidebarWidth = nav?.width ?? 0;
		// The routers hit-test against THIS frame, exactly as `/settings` reads
		// its `#tabRowStart` bookkeeping: strip zones come from the `TabBar`'s
		// own last render, sidebar rows from `NAV_GROUPS`, range segments from
		// the stripped topbar row.
		const tabBar = this.#tabBar;
		state.mouse = {
			topbarRows: topLines.length,
			stripRows: strip.length,
			sidebarWidth: column ? sidebarWidth : 0,
			sidebarRows: column ? (nav?.lines.length ?? 0) : 0,
			topbar: stripAnsi(top),
			tabAt: (line, col) => tabBar.tabAt(line, col)?.id,
		};

		// `bodyRows` is the same one row arithmetic `/settings` uses: one for the
		// chrome row that replaced the header, one more per wrap.
		const headerLines = [...topLines, ...strip];
		const body = bodyRows(rows, headerLines.length);
		const plan = { ...planLayout(width, rows, preset), bodyRows: body };

		state.source = this.#bodyLines(plan, preset, nav?.lines ?? null, sidebarWidth);
		state.maxScroll = Math.max(0, state.source.length - plan.bodyRows);
		// Clamped HERE, not in the key handler, so a terminal that shrank
		// between two keypresses cannot leave the view scrolled past its end.
		state.scroll = Math.max(0, Math.min(state.scroll, state.maxScroll));

		state.title = `Stats · ${rangeLabel(state.range)}`;
		this.#panel.title = state.title;
		this.#header.setLines(headerLines);
		this.#header.setHeight(headerLines.length);
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

	#bodyLines(
		plan: LayoutPlan,
		preset: SymbolPreset,
		sidebarLines: readonly string[] | null,
		sidebarWidth: number,
	): readonly string[] {
		const state = this.#state;
		const phase = this.#phase();
		state.chart = NO_ROWS;
		if (phase === "loading") return loadingLines(this.#theme);
		if (phase === "error") return errorLines(this.#theme, preset, state.error ?? "", state.syncError);

		const data = state.data as PanelData;
		const spec = specById(state.screenId);
		// ONE rendering path. There is no `?? screen.render()` fallback: a fallback
		// is how the panel got two grammars in the first place, and a screen the
		// IR does not describe is a screen this panel cannot draw honestly.
		if (!spec) return [this.#theme.fg("muted", `No layout spec for "${state.screenId}".`)];
		const rendered = renderScreenWith({
			spec,
			data,
			plan,
			preset,
			range: state.range,
			now: this.#options.now?.() ?? Date.now(),
			fg: (color, text) => this.#theme.fg(color, text),
			bold: text => this.#theme.bold(text),
			palette: this.#theme,
			seriesColorFor: index => this.#seriesColor(index),
			glyphs: glyphsFor(preset),
		});
		// The chart rows the IR composed, kept for the tests that assert cost
		// scaling against the REAL frame. The charts are the IR's now, so this
		// captures what the screen drew rather than keeping a second local chart.
		state.chart = rendered.chart;
		if (sidebarLines === null) return rendered.lines;
		// The sidebar zips beside the body, not above it: sidebar row first,
		// a DIM column bar between them, body row after. The bar copies the
		// split layout's `theme.hint("│ ")` (settings-list.ts:989): it is the
		// one vertical in the body, and G5 bans full-width rules, not columns.
		// DIVERGENCE (deliberate, noted): the host draws no gutters around the
		// outer frame — OverlayPanel's `row()` already insets both sides — so
		// only this inner column carries the bar. The mark comes from
		// glyph(preset, "columnGap") — "│" under unicode/nerd, "|" under ascii
		// (glyphs.ts:58,80; never theme.symbol("sep.pipe"), which measures 3
		// cells) — so the gutter matches the frame it sits in on every preset.
		const gutter = this.#theme.fg("dim", glyph(preset, "columnGap"));
		return rendered.lines.map((line, index) => {
			const side = index < sidebarLines.length ? sidebarLines[index]! : " ".repeat(sidebarWidth);
			return `${side} ${gutter} ${line}`;
		});
	}

	/** Series hue by rank, matching the web's `buildColorLookup`. */
	#seriesColor(index: number): ThemeColor {
		return SERIES_COLORS[((index % SERIES_COLORS.length) + SERIES_COLORS.length) % SERIES_COLORS.length];
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

	#footerLine(plan: LayoutPlan): string {
		const state = this.#state;
		// DERIVED, never stored (F23 §3.2): an error shows a retry and a close
		// rather than a range switch that would only discard the message the user
		// has not read yet.
		const mode: HintMode =
			state.error !== null
				? "error"
				: state.syncEvent || state.ingest
					? "syncing"
					: state.maxScroll > 0
						? "scrollable"
						: "idle";
		const [row] = footerHints(hintsFor(mode), this.#theme, plan.innerWidth);
		return row ?? "";
	}

	// --- tern probe (F2 experiment, scratch) -----------------------------------

	/**
	 * The probe description: the screen strip as a `tabs` node inside the
	 * overlay card, plus one `text` leaf proving the mount. Screen switches
	 * reuse `#selectScreen` — never a second keymap. `render()` output is
	 * untouched; see the probe-render parity check.
	 */
	describe(_cx: DescribeContext): NativeNode {
		return overlayCard("omp.overlay.stats", "Stats", [
			node(
				"tabs",
				{
					items: SELECTABLE_SCREENS.map(screen => ({ id: screen.id, label: screen.label })),
					active: this.#state.screenId,
				},
				undefined,
				"tabs",
			),
			text("probe"),
		]);
	}

	/** Tab select/activate routes to the same screen index path as the keys. */
	handleNativeEvent(event: NativeUiEvent): void {
		if (event.type !== "select" && event.type !== "activate") return;
		if (leafKey(event.key) !== "tabs") return;
		const index = SELECTABLE_SCREENS.findIndex(screen => screen.id === event.item);
		if (index !== -1) this.#selectScreen(index);
	}

	// --- input ---------------------------------------------------------------

	handleInput(data: string): void {
		const state = this.#state;
		if (state.closed) return;
		// The mouse router first, because its escape prefix swallows real keys —
		// the same ORDER `usage-dashboard.ts:1367-1405` uses. Keyboard handling
		// below is untouched: the mouse is additive, never required.
		if (routeSgrMouseInput(data, event => this.#routeMouse(event))) return;
		// The `g` prefix expires on TIME, not on a timer (Shell.tsx parity: the
		// web compares timestamps on the next keypress and never clears).
		const armed =
			state.jumpArmedAt !== 0 && (this.#options.now?.() ?? Date.now()) - state.jumpArmedAt < JUMP_TIMEOUT_MS;
		const action = panelAction(data, armed);
		if (action === null) return;
		state.jumpArmedAt = 0;
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
			case "screenId": {
				const index = SELECTABLE_SCREENS.findIndex(screen => screen.id === action.id);
				// A jump only ever lands on a drawable screen: NAV_GROUPS filters
				// deferred and excluded screens out, so an unknown id is inert.
				if (index !== -1) this.#selectScreen(index);
				return;
			}
			case "armJump":
				state.jumpArmedAt = this.#options.now?.() ?? Date.now();
				return;
			case "noop":
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

	/**
	 * The mouse router: clicks, wheel and motion over the last frame.
	 *
	 * Shape copied from `settings-selector.ts:1224-1275`: wheel scrolls the
	 * body from anywhere; motion arms hover (strip tab via the TabBar's own
	 * `setHoverTab`, sidebar row via state both painted on the next render);
	 * a left click on a hit selects it through the SAME `#selectScreen` and
	 * range paths the keys use. Releases and non-left buttons are consumed
	 * and ignored — swallowing a click the panel does not own would eat it,
	 * but every SGR report IS owned here, and returning false would hand a
	 * click prefix to the keymap. Anything off every hit area is inert.
	 */
	#routeMouse(event: SgrMouseEvent): boolean {
		const state = this.#state;
		if (event.wheel !== null) {
			this.#scrollBy(event.wheel * 2);
			return true;
		}
		const frame = state.mouse;
		if (frame === null) return true;
		if (event.motion) {
			const hit = hitTest(frame, event.row, event.col);
			if (hit.type === "screen" && hit.via === "strip") {
				this.#tabBar.setHoverTab(hit.id);
				state.hoveredStripId = hit.id;
				state.hoveredSidebarId = null;
			} else {
				this.#tabBar.setHoverTab(null);
				state.hoveredStripId = null;
				state.hoveredSidebarId = hit.type === "screen" && hit.via === "sidebar" ? hit.id : null;
			}
			this.#changed();
			return true;
		}
		if (!event.leftClick) return true;
		const hit = hitTest(frame, event.row, event.col);
		if (hit.type === "screen") {
			const index = SELECTABLE_SCREENS.findIndex(screen => screen.id === hit.id);
			if (index !== -1) this.#selectScreen(index);
		} else if (hit.type === "range" && hit.id !== state.range) {
			state.range = hit.id;
			this.#load();
		}
		return true;
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
		// The pointer no longer points at what the old highlight meant, so a
		// hover pill left on the old tab would lie — `/settings` clears on
		// select the same way.
		this.#tabBar.setHoverTab(null);
		state.hoveredStripId = null;
		state.hoveredSidebarId = null;
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
	debugFrame: (panel: StatsPanel) => STATE.get(panel)!.mouse,
	debugHoverTab: (panel: StatsPanel) => STATE.get(panel)!.hoveredStripId,
	debugHoverSidebar: (panel: StatsPanel) => STATE.get(panel)!.hoveredSidebarId,
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
