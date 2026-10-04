/**
 * Web-shell chrome port: sidebar nav, topbar, live chip, progress line.
 *
 * Source of truth is the omp-stats web Shell (read-only host files, never
 * modified): `app/Shell.tsx` (topbar + sidebar + progress three-state),
 * `app/nav.ts` (NAV groups, hotkeys), `app/LiveChip.tsx` (chip branch order),
 * `client/data/range.ts` (TIME_RANGES order). Every behavior below cites the
 * web line it mirrors; deviations are marked OURS with reasoning.
 *
 * KEYMAP DECISION (the brief asks for it stated once):
 * - Web binds `1`-`6` to RANGES and `g then letter` to sections (Shell.tsx
 *   useShortcuts). We mirror `g then letter` for screens, but we do NOT mirror
 *   digits-as-range: our digits already select screens (`1`-`9`/`0`, pinned by
 *   test/panel.test.ts "every selectable screen is on the number row"), and a
 *   digit cannot pick both a range and a screen. Range stays on `r`/`R` cycle.
 * - So digits and `g`-letters are ALIASES for the same target (screen): `1`
 *   and `g o` both land on overview. No collision is possible because the two
 *   sequences share no prefix key: digits act immediately, letters act only
 *   while a `g` prefix is armed (1200 ms window, Shell.tsx parity).
 * - Consequence, mirrored exactly from the web: while the prefix is armed the
 *   next letter is CONSUMED even on no match — so `g r` jumps to requests and
 *   never cycles the range, `g s` does not start a sync, `g 1` does nothing.
 *   A stale prefix (>1200 ms) falls through to the normal keymap, exactly as
 *   the web's timestamp check does (no timer, no visual indicator, same as web).
 * - Hotkeys are the web's verbatim (nav.ts) except `activity`, which has no web
 *   section (OURS: `a`). Deferred/excluded screens (`providers`, `gain`,
 *   `traces`, `frustration`) have no sidebar row and no hotkey: a jump that
 *   paints a page the panel cannot honestly fill wastes the keystroke.
 */
import { expect, test } from "bun:test";
import { ensureThemeSync, setSymbolPreset, theme } from "@oh-my-pi/pi-tui/theme";
import { visibleWidth } from "@oh-my-pi/pi-tui/utils";

import { SCREEN_SPECS } from "../src/layout/spec";
import {
	JUMP_TIMEOUT_MS,
	NAV_GROUPS,
	ago,
	chipFor,
	progressLineFor,
	screenForHotkey,
	sidebar,
	topbar,
} from "../src/tui/chrome";
import { __testing } from "../src/tui/panel";
import type { SyncEvent } from "../src/sync/client";
import { liveData } from "./fixtures/panel";

ensureThemeSync();

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
/** The selectedBg escape prefix, without regex: strip the trailing bg reset. */
const _bg = theme.bg("selectedBg", "").split("x")[0] ?? "";
const ESC = String.fromCharCode(27);
const ACTIVE_BG = _bg.endsWith(ESC + "[49m") ? _bg.slice(0, -(ESC + "[49m").length) : _bg;

const idle = (over: Record<string, unknown> = {}) => ({
	syncing: false,
	current: 0,
	total: 0,
	determinate: false,
	error: null as string | null,
	dirtyHours: 0,
	lastSyncedAt: null as number | null,
	now: 1_000_000,
	...over,
});

// ─── nav groups: the web's NAV, minus screens we cannot draw ─────────────────

test("nav groups are Usage / Activity / Insights in web order, with the drawable subset", () => {
	expect(NAV_GROUPS.map(g => g.heading)).toEqual(["Usage", "Activity", "Insights"]);
	const ids = NAV_GROUPS.flatMap(g => g.items.map(i => i.id));
	expect(ids).toEqual(["overview", "models", "costs", "activity", "requests", "errors", "tools", "projects"]);
});

test("every nav label matches the layout IR, so the sidebar cannot drift from the strip", () => {
	for (const group of NAV_GROUPS) {
		for (const item of group.items) {
			const spec = SCREEN_SPECS.find(s => s.id === item.id);
			expect(spec, item.id).toBeDefined();
			expect(item.label, item.id).toBe(spec!.label);
		}
	}
});

test("hotkeys are the web's verbatim; tools takes l because t is traces'", () => {
	const seen: Record<string, string> = {};
	for (const group of NAV_GROUPS) {
		for (const item of group.items) {
			expect(item.hotkey, item.id).toMatch(/^[a-z]$/);
			expect(seen[item.hotkey], `${item.id} collides on ${item.hotkey}`).toBeUndefined();
			seen[item.hotkey] = item.id;
		}
	}
	expect(seen["o"]).toBe("overview");
	expect(seen["m"]).toBe("models");
	expect(seen["c"]).toBe("costs");
	expect(seen["r"]).toBe("requests");
	expect(seen["e"]).toBe("errors");
	expect(seen["l"]).toBe("tools");
	expect(seen["j"]).toBe("projects");
	// OURS: activity has no web section, so it takes the free initial.
	expect(seen["a"]).toBe("activity");
});

test("screenForHotkey resolves case-insensitively; undrawable screens have no hotkey", () => {
	expect(screenForHotkey("o")).toBe("overview");
	expect(screenForHotkey("O")).toBe("overview");
	expect(screenForHotkey("r")).toBe("requests");
	expect(screenForHotkey("l")).toBe("tools");
	expect(screenForHotkey("g")).toBeNull();
	expect(screenForHotkey("p")).toBeNull();
	expect(screenForHotkey("1")).toBeNull();
	expect(screenForHotkey("")).toBeNull();
});

test("the jump window matches the web's 1200 ms", () => {
	expect(JUMP_TIMEOUT_MS).toBe(1200);
});

// ─── sidebar ─────────────────────────────────────────────────────────────────

test("sidebar has one row per screen under its group heading, with a G-letter hint", () => {
	const { width, lines } = sidebar(theme, "unicode", "overview");
	const plain = lines.map(strip);
	expect(plain).toHaveLength(3 + 8);
	// Every row carries the host's 2-column prefix slot: cursor + space when
	// selected, two spaces otherwise (settings-list.ts:939-940).
	expect(plain[0]!.trim()).toBe("Usage");
	expect(plain[4]!.trim()).toBe("Activity");
	expect(plain[8]!.trim()).toBe("Insights");
	expect(plain[1]).toMatch(/Overview/);
	expect(plain[1]).toMatch(/G O/);
	expect(plain[6]).toMatch(/Requests/);
	expect(plain[6]).toMatch(/G R/);
	for (const line of plain) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
	expect(width).toBeLessThanOrEqual(26);
});

test("the active sidebar row is host section style: accent text plus cursor, never a pill", () => {
	// /settings marks selection with cursor + accent and reserves the
	// selectedBg pill for the tab strip (tui-adapters.ts:336-350,
	// chrome/shared.ts:18-27). A pill in the sidebar is a second active style.
	const { lines } = sidebar(theme, "unicode", "costs");
	const active = lines.find(l => strip(l).includes("Costs"));
	expect(active).toBeDefined();
	expect(strip(active!)).toStartWith(`${theme.nav.cursor} `);
	// The cursor slot is accent-tinted (settings-list.ts:939, tui-adapters.ts:344).
	expect(active!).toContain(theme.fg("accent", `${theme.nav.cursor} `));
	for (const line of lines) {
		if (line === active) continue;
		expect(line).not.toContain(ACTIVE_BG);
	}
	expect(active!).not.toContain(ACTIVE_BG);
});

test("sidebar headings follow the host section style: active group accent+bold, rest muted", () => {
	// getSettingsListTheme().section: active accent+bold, inactive muted
	// (tui-adapters.ts:348-349). Headings are group names, not rows: no cursor.
	const { lines } = sidebar(theme, "unicode", "overview");
	const usage = lines[0]!;
	expect(strip(usage).trim()).toBe("Usage");
	expect(usage).toContain(theme.bold(theme.fg("accent", "Usage")));
	const activity = lines[4]!;
	expect(strip(activity).trim()).toBe("Activity");
	expect(activity).toContain(theme.fg("muted", "Activity"));
	expect(activity).not.toContain(theme.nav.cursor);
});

test("sidebar hover paints the host hover band on a non-active row only", () => {
	// settings-list.ts:778,792-796: hover is a full-row selectedBg band behind
	// the row; the keyboard cursor stays where it is.
	const { lines } = sidebar(theme, "unicode", "overview", "models");
	const hovered = lines.find(l => strip(l).includes("Models"));
	const active = lines.find(l => strip(l).includes("Overview"));
	expect(hovered).toBeDefined();
	expect(hovered!).toContain(ACTIVE_BG);
	expect(hovered!).not.toContain("\x1b[1m");
	expect(active!).not.toContain(ACTIVE_BG);
	const { lines: plain } = sidebar(theme, "unicode", "overview", "Usage");
	for (const line of plain) expect(line).not.toContain(ACTIVE_BG);
});

test("an omitted hover id paints byte-identical output to the 3-arg call", () => {
	expect(sidebar(theme, "unicode", "overview")).toEqual(sidebar(theme, "unicode", "overview", undefined));
	expect(sidebar(theme, "unicode", "overview")).toEqual(sidebar(theme, "unicode", "overview", null));
});

test("the sidebar gutter is the dim column bar, settings split-layout parity", () => {
	// settings-list.ts:989: the split column separator is theme.hint("│ ").
	// panel.ts zips sidebar and body with the same dim bar between them.
	const panel = __testing.makePanel({ data: liveData(), rows: 40 });
	return __testing.settled(panel).then(() => {
		const frame = panel.render(100).map(strip);
		const navRow = frame.find(row => row.includes("Overview") && row.includes("G O"));
		expect(navRow).toBeDefined();
		expect(navRow!).toMatch(/│/);
	});
});

test("the sidebar gutter follows the preset: │ under unicode, | under ascii", async () => {
	// Follow-up to the gutter commit: `#bodyLines` hardcoded "│", so ascii
	// rendered a unicode bar in an ascii frame. The gutter is data ink, so it
	// comes from glyph(preset, "columnGap") like every other mark. Asserted
	// by ABSENCE under ascii: the frame borders are "|" and "+" there, so any
	// remaining "│" is the hardcoded gutter leaking through.
	const current = theme.getSymbolPreset();
	await setSymbolPreset("unicode");
	const upanel = __testing.makePanel({ data: liveData(), rows: 40 });
	await __testing.settled(upanel);
	const urow = upanel.render(100).map(strip).find(row => row.includes("Overview") && row.includes("G O"));
	expect(urow).toBeDefined();
	expect(urow!).toContain("│");
	await setSymbolPreset("ascii");
	const apanel = __testing.makePanel({ data: liveData(), rows: 40 });
	await __testing.settled(apanel);
	const arow = apanel.render(100).map(strip).find(row => row.includes("Overview") && row.includes("G O"));
	expect(arow).toBeDefined();
	expect(arow!).not.toContain("│");
	expect(arow!).toContain("|");
	await setSymbolPreset(current);
});
// ─── live chip: LiveChip.tsx branch order, minus connected ────────────────────

test("chip shows Live only when settled: syncing, error and backlog all override it", () => {
	expect(strip(chipFor(theme, idle()))).toMatch(/Live/);
	expect(strip(chipFor(theme, idle({ syncing: true })))).toMatch(/Syncing/);
	expect(strip(chipFor(theme, idle({ error: "boom" })))).toMatch(/Sync failed/);
	expect(strip(chipFor(theme, idle({ dirtyHours: 30 })))).toMatch(/Indexing/);
	expect(strip(chipFor(theme, idle({ dirtyHours: 30 })))).toMatch(/30h left/);
	// A handful of dirty hours is normal churn (LiveChip.tsx INDEXING_VISIBLE_HOURS = 24).
	expect(strip(chipFor(theme, idle({ dirtyHours: 24 })))).toMatch(/Live/);
});

test("chip shows the count only when the total is known, mirroring total > 0", () => {
	expect(strip(chipFor(theme, idle({ syncing: true, current: 25, total: 100, determinate: true })))).toMatch(
		/25\/100/,
	);
	const bare = strip(chipFor(theme, idle({ syncing: true })));
	expect(bare).toMatch(/Syncing/);
	expect(bare).not.toMatch(/\d/);
});

test("ago reads like the web's relative age", () => {
	expect(ago(1_000_000, 1_000_000 - 10_000)).toBe("just now");
	expect(ago(1_000_000, 1_000_000 - 5 * 60_000)).toBe("5m ago");
	expect(ago(1_000_000, 1_000_000 - 3 * 3_600_000)).toBe("3h ago");
	expect(ago(1_000_000, 1_000_000 - 2 * 86_400_000)).toBe("2d ago");
});

// ─── progress line: Shell.tsx three-state, indeterminate by phase ────────────

test("progress line is determinate only for ingest with a known total", () => {
	const ingest: SyncEvent = { type: "progress", phase: "ingest", current: 25, total: 100 };
	expect(progressLineFor(ingest, 60)).toContain("25%");
	const scan: SyncEvent = { type: "progress", phase: "scan", current: 0, total: 0 };
	const scanLine = progressLineFor(scan, 60);
	expect(scanLine).not.toContain("NaN");
	expect(scanLine).not.toMatch(/\d+%/);
	// Rollup carries a remaining count, not a denominator: indeterminate by phase.
	const rollup: SyncEvent = { type: "progress", phase: "rollup", current: 0, total: 50 };
	const rollupLine = progressLineFor(rollup, 60);
	expect(rollupLine).not.toMatch(/\d+%/);
	expect(rollupLine).toMatch(/[a-z]/i);
});

test("progress line is hidden for settled states and always fits", () => {
	expect(progressLineFor(null, 60)).toBe("");
	expect(progressLineFor({ type: "done", rollup: { dirtyHours: 0, dirtySessions: 0 } }, 60)).toBe("");
	expect(progressLineFor({ type: "error", error: "x" }, 60)).toBe("");
	for (const width of [10, 20, 60, 100]) {
		const line = progressLineFor({ type: "progress", phase: "ingest", current: 1, total: 2 }, width);
		expect(visibleWidth(strip(line)), `w=${width}`).toBeLessThanOrEqual(width);
	}
});

// ─── topbar: brand + chip + range segment in one row ──────────────────────────

test("topbar at 100 holds brand, live chip and all six ranges in one row", () => {
	const row = topbar(theme, { range: "24h", chip: chipFor(theme, idle()), freshness: "", innerWidth: 96 });
	const plain = strip(row);
	expect(plain).toContain("omp/stats");
	expect(plain).toContain("Live");
	for (const label of ["1h", "24h", "7d", "30d", "90d", "All"]) expect(plain).toContain(label);
	expect(visibleWidth(row)).toBeLessThanOrEqual(96);
	expect(row).toContain(ACTIVE_BG);
});

test("topbar at 60 keeps brand and range but drops the chip, mirroring topbar-hide-narrow", () => {
	const row = topbar(theme, { range: "24h", chip: chipFor(theme, idle()), freshness: "", innerWidth: 56 });
	const plain = strip(row);
	expect(plain).toContain("omp/stats");
	expect(plain).toContain("24h");
	expect(plain).not.toContain("Live");
	expect(visibleWidth(row)).toBeLessThanOrEqual(56);
});

test("topbar carries the dirty-hour freshness on the right when it fits", () => {
	const row = topbar(theme, { range: "24h", chip: chipFor(theme, idle()), freshness: "3 dirty hours", innerWidth: 96 });
	expect(strip(row)).toMatch(/3 dirty hours/);
});

// ─── frame: sidebar + topbar + body + footer, one divider ─────────────────────

test("frame composes topbar, sidebar, body and footer with exactly one divider at 60 and 100", async () => {
	for (const width of [60, 100]) {
		const panel = __testing.makePanel({ data: liveData(), rows: 40 });
		await __testing.settled(panel);
		const frame = panel.render(width);
		const plain = frame.map(strip);
		expect(frame.length, `width=${width}`).toBe(40);
		// Exactly one divider row: split at 100, plain at 60. Borders use
		// corners, never tees, and no body emits a rule (G5), so one is exact.
		expect(plain.filter(r => /[├┤┬┴┼]/.test(r)), `width=${width}`).toHaveLength(1);
		for (const row of frame) expect(visibleWidth(row), `width=${width}`).toBeLessThanOrEqual(width);
		expect(plain.slice(0, 3).join("\n"), `width=${width}`).toContain("omp/stats");
		expect(plain[plain.length - 2]).toContain("close");
	}
	// Wide gets the grouped sidebar COLUMN; below that width the nav is the
	// strip row, which TabBar collapses to one-cell shorts on its own.
	const wide = __testing.makePanel({ data: liveData(), rows: 40 });
	await __testing.settled(wide);
	const widePlain = wide.render(100).map(strip);
	// The nav is a COLUMN, so each heading/row starts its own frame row.
	expect(widePlain.some(r => r.replace(/^│ /, "").trimStart().startsWith("Usage"))).toBe(true);
	expect(widePlain.some(r => /Overview/.test(r) && /G O/.test(r))).toBe(true);
	const medium = __testing.makePanel({ data: liveData(), rows: 40 });
	await __testing.settled(medium);
	const mediumPlain = medium.render(60).map(strip);
	// The active tab keeps its full label; its neighbours collapse to shorts.
	expect(mediumPlain.some(r => /Overview/.test(r))).toBe(true);
	expect(mediumPlain.some(r => /Models/.test(r))).toBe(false);
});

// ─── g-prefix keymap ──────────────────────────────────────────────────────────

test("g arms a jump: the next letter selects the screen and is consumed", async () => {
	const panel = __testing.makePanel({ data: liveData(), screenId: "overview" });
	await __testing.settled(panel);
	panel.handleInput("g");
	panel.handleInput("r");
	await __testing.settled(panel);
	expect(__testing.debugScreenId(panel)).toBe("requests");
	// The range the web would have cycled on a bare r is untouched.
	expect(__testing.debugRange(panel)).toBe("24h");
});

test("g then an undrawable letter is swallowed, never a range cycle or a sync", async () => {
	let calls = 0;
	const panel = __testing.makePanel({
		data: liveData(),
		startIngest: () => {
			calls++;
			return { kill: () => {}, settled: Promise.resolve() };
		},
	});
	await __testing.settled(panel);
	panel.handleInput("g");
	panel.handleInput("s");
	await __testing.settled(panel);
	expect(calls).toBe(0);
	expect(__testing.debugRange(panel)).toBe("24h");
});

test("a stale g prefix falls through to the normal keymap", async () => {
	let now = 5_000_000;
	const panel = __testing.makePanel({ data: liveData(), now: () => now });
	await __testing.settled(panel);
	panel.handleInput("g");
	now += 2000;
	panel.handleInput("r");
	await __testing.settled(panel);
	expect(__testing.debugRange(panel)).toBe("7d");
});

// ─── sync wiring into the chrome ──────────────────────────────────────────────

test("progress events paint Syncing plus a progress row; done settles back to Live", async () => {
	let onEvent!: (e: SyncEvent) => void;
	const panel = __testing.makePanel({
		data: liveData(),
		startIngest: fn => {
			onEvent = fn;
			return { kill: () => {}, settled: Promise.resolve() };
		},
	});
	await __testing.settled(panel);
	panel.handleInput("s");
	onEvent({ type: "progress", phase: "ingest", current: 1, total: 2 });
	const syncing = panel.render(100).map(strip).join("\n");
	expect(syncing).toMatch(/Syncing/);
	expect(syncing).toMatch(/50%/);
	onEvent({ type: "done", rollup: { dirtyHours: 0, dirtySessions: 0 } });
	await __testing.settled(panel);
	const live = panel.render(100).map(strip).join("\n");
	expect(live).toMatch(/Live/);
	expect(live).not.toMatch(/Syncing/);
});

test("an error event paints Sync failed and hides the progress row", async () => {
	let onEvent!: (e: SyncEvent) => void;
	const panel = __testing.makePanel({
		data: liveData(),
		startIngest: fn => {
			onEvent = fn;
			return { kill: () => {}, settled: Promise.resolve() };
		},
	});
	await __testing.settled(panel);
	panel.handleInput("s");
	onEvent({ type: "progress", phase: "ingest", current: 1, total: 2 });
	onEvent({ type: "error", error: "lock busy" });
	const frame = panel.render(100).map(strip).join("\n");
	expect(frame).toMatch(/Sync failed/);
	expect(frame).not.toMatch(/50%/);
});
