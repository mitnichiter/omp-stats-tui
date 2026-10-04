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

test("sidebar columns align: icon gutter, label column, and a right-aligned jump-key column", () => {
	// Defect 4. The web's `.nav-row` is `display: flex` with
	// `.nav-row-label { flex: 1 }` and the `kbd` after it
	// (styles.css:522-573) — so the jump hint is pushed to the ROW'S TRAILING
	// EDGE, right-aligned across every row. Ours appended `G <letter>` right
	// after a variable-length label, so the hints formed a ragged staircase and
	// the rows read as prose. These assertions pin the column geometry.
	const { width, lines } = sidebar(theme, "unicode", "overview");
	const plain = lines.map(strip);
	const bodyRows = plain.filter(row => /G [A-Z]$/.test(row));
	expect(bodyRows).toHaveLength(8);

	// Every jump key ends in the SAME cell — the trailing edge, as in the web
	// where `.nav-row-label { flex: 1 }` pushes the `kbd` to the row's end.
	expect(bodyRows.every(row => visibleWidth(row) === width)).toBe(true);

	// The ICON occupies one fixed gutter cell on every row, so every label
	// starts in one column regardless of which icon the preset drew. Scoped to
	// body rows because `Activity` is BOTH a group heading and a screen label —
	// a collision the web's own nav shares (nav.ts: `Usage`/`Activity`/`Insights`
	// headings with an `Activity` item in the second).
	// Measured in CELLS, not UTF-16 units: the emoji icons are surrogate pairs,
	// so `String.indexOf` reports different offsets for rows whose labels sit
	// in the same terminal column.
	const labelColumn = (label: string): number => {
		const row = bodyRows.find(candidate => candidate.includes(label))!;
		return visibleWidth(row.slice(0, row.indexOf(label)));
	};
	const labels = ["Overview", "Models", "Costs", "Activity", "Requests", "Errors", "Tools", "Projects"];
	const columns = labels.map(labelColumn);
	expect(new Set(columns).size).toBe(1);

	// Group headings carry no jump key, so structure never reads as content —
	// the web's `.nav-heading` is a plain 12px label (styles.css:515-520).
	const headings = plain.filter(row => /^\s*(Usage|Activity|Insights)\s*$/.test(row));
	expect(headings).toHaveLength(3);
	for (const heading of headings) expect(heading).not.toMatch(/G [A-Z]/);
});

test("sidebar rows stay within one cell of each other, so the column has no ragged edge", () => {
	// A ragged right edge is what made the block read as text rather than as a
	// control. Every body row is padded to the block's common width, and the
	// heading rows are padded to the same width, so the whole sidebar is one
	// rectangle.
	const { width, lines } = sidebar(theme, "unicode", "overview");
	for (const line of lines) expect(visibleWidth(line)).toBe(width);
	expect(width).toBeLessThanOrEqual(26);
});

test("sidebar rows are one rectangle on every preset, even though the block width follows the icon gutter", () => {
	// The gutter is data ink, so the block width legitimately tracks the
	// preset's icon width (1 cell nerd, 2 unicode, up to 4 ascii). What must
	// hold on every preset is INTERNAL consistency: all rows, headings
	// included, are padded to one common width, so the sidebar never reads as a
	// ragged block of text.
	for (const preset of ["unicode", "nerd", "ascii"] as const) {
		const { width, lines } = sidebar(theme, preset, "costs");
		expect(width, preset).toBeGreaterThan(0);
		expect(width, preset).toBeLessThanOrEqual(26);
		for (const line of lines) expect(visibleWidth(line), preset).toBe(width);
	}
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

// ─── topbar: the web's three-region topbar ────────────────────────────────────
//
// Shell.tsx's `<header class="topbar">` is THREE regions, not one run of
// words: `.topbar-brand`, a `flex: 1` `.topbar-spacer`, then
// `.topbar-actions` holding the LiveChip and the `Segmented` range control.
// The spacer is the whole mechanism — it is what stops the chip reading as
// part of the wordmark. In a terminal there is no flexbox, so the spacer has
// to be PAINTED: the brand sits left, the action cluster sits right, and the
// gap between them is what separates the two. Every test below is about that
// gap and about the cluster reading as two widgets rather than one sentence.

test("topbar at 96 paints the brand left and the action cluster right, with a real gap between", () => {
	// The bug this fixes: `omp/stats  ● Live   1h  24h …` — one left-aligned
	// run, so the chip reads as the tail of the wordmark. The web separates them
	// with `flex: 1` (styles.css:453-455); the terminal has to spend real cells
	// on the same gap.
	const row = topbar(theme, { range: "24h", chip: chipFor(theme, idle()), freshness: "", innerWidth: 96 });
	const plain = strip(row);
	expect(plain).toContain("omp/stats");
	expect(plain).toContain("Live");
	for (const label of ["1h", "24h", "7d", "30d", "90d", "All"]) expect(plain).toContain(label);
	// Brand flush left, and the chip is nowhere near it: the gap between the
	// wordmark and the cluster is at least three cells, which is what the web's
	// 12px topbar gap buys on screen.
	expect(plain.startsWith("omp/stats")).toBe(true);
	const gap = visibleWidth(plain.slice(plain.indexOf("omp/stats") + "omp/stats".length).split("●")[0] ?? "");
	expect(gap).toBeGreaterThanOrEqual(3);
	expect(visibleWidth(row)).toBeLessThanOrEqual(96);
});

test("the action cluster is right-aligned, so it ends at the row's right edge", () => {
	// `topbar-actions` is the last child of a flex row, so in the web it hugs
	// the right edge and the spacer eats everything left over. Without this the
	// row could drift back to a single left-aligned sentence.
	const row = topbar(theme, { range: "24h", chip: chipFor(theme, idle()), freshness: "", innerWidth: 96 });
	const plain = strip(row);
	// The row fills its width exactly, and the only slack left at the trailing
	// edge is the range control's own one-cell segment padding — never a gap
	// that would mean the cluster is floating in the middle of the bar.
	expect(visibleWidth(row)).toBe(96);
	expect(plain.length).toBe(96);
	expect(96 - plain.trimEnd().length).toBeLessThanOrEqual(1);
});

test("the live chip is an enclosed surface and the brand is naked text", () => {
	// The web's own rule for what makes a control read as a control: the brand
	// has NO enclosure, while `.live-chip` is filled + bordered + full-pill
	// radius (styles.css:1596-1598). A terminal has no border-radius, so the
	// faithful form of "this is a surface" is a BACKGROUND. Before the fix both
	// were plain foreground runs, which is exactly why the chip read as the
	// tail of the wordmark.
	const row = topbar(theme, { range: "24h", chip: chipFor(theme, idle()), freshness: "", innerWidth: 96 });
	const chipBg = row.indexOf("\x1b[48;");
	expect(chipBg).toBeGreaterThan(-1);
	// Everything before the chip's surface is the wordmark and its spacer, and
	// carries no background at all.
	expect(row.slice(0, chipBg)).not.toContain("\x1b[48;");
	expect(strip(row.slice(0, chipBg))).toMatch(/^omp\/stats\s+$/);
	// The chip's surface is the chip's OWN padding, so it is a box rather than a
	// coloured word: one cell of background on each side of the label.
	expect(row).toContain(theme.bg("selectedBg", ` ${chipFor(theme, idle())} `));
	// And the wordmark itself is the brightest thing on the bar, with only the
	// slash dropped a step (styles.css:432, :441-445).
	expect(row).toContain(theme.bold(theme.fg("accent", "omp")));
	expect(row).toContain(theme.fg("dim", "/"));
	expect(row).toContain(theme.bold(theme.fg("accent", "stats")));
});

test("the range control reads as ONE control: uniform inactive styling and a single active pill", () => {
	// Defect 3. Before: the active pill was the only thing that looked
	// different, so the six labels read as five words plus one button. The
	// web's `Segmented` (styles.css:1057-1103) is a container with a shared
	// background and one raised thumb — in a terminal, the honest equivalent is
	// a uniform inactive style on every segment plus exactly one filled pill,
	// with the segments packed tight enough to read as a group.
	const row = topbar(theme, { range: "24h", chip: chipFor(theme, idle()), freshness: "", innerWidth: 96 });
	const plain = strip(row);
	// Exactly one selectedBg pill belongs to the RANGE control. The chip has its
	// own surface now, so the pill count is asserted against the segment run
	// alone by asking for the row with no chip.
	const bare = topbar(theme, { range: "24h", chip: "", freshness: "", innerWidth: 96 });
	const pills = bare.split(ACTIVE_BG).length - 1;
	expect(pills).toBe(1);
	// Every inactive segment is styled identically — one style, applied to all
	// five, never a per-segment special case.
	const inactive = ["1h", "7d", "30d", "90d", "All"].map(label => theme.fg("muted", ` ${label} `));
	for (const styled of inactive) expect(bare, styled).toContain(styled);
	// The active one is the pill, and it carries its label.
	expect(plain).toContain(" 24h ");
	// Tight packing: the six segments are one run, not six space-separated
	// words. A single space separates them and nothing else.
	expect(plain).toMatch(/ 1h\s+24h\s+7d\s+30d\s+90d\s+All /);
});

test("the chip drops before the range control when width runs out, mirroring topbar-hide-narrow", () => {
	// The web hides `.live-chip` (styles.css:455 wraps it in
	// `.topbar-hide-narrow`) but keeps the range control, because the range IS
	// the window you are looking at. Order of sacrifice is therefore fixed:
	// freshness, then chip, then segments — never the reverse.
	const full = topbar(theme, { range: "24h", chip: chipFor(theme, idle()), freshness: "3 dirty hours", innerWidth: 96 });
	expect(strip(full)).toMatch(/3 dirty hours/);
	expect(strip(full)).toMatch(/Live/);
	// Squeeze until the chip cannot fit: the range control survives.
	for (const width of [70, 60, 56, 50, 44, 40]) {
		const row = topbar(theme, { range: "24h", chip: chipFor(theme, idle()), freshness: "", innerWidth: width });
		const plain = strip(row);
		expect(visibleWidth(row), `w=${width}`).toBeLessThanOrEqual(width);
		expect(plain, `w=${width}`).toContain("omp/stats");
		expect(plain, `w=${width}`).toMatch(/1h|24h|7d|30d|90d|All/);
	}
	// And at 56 the chip is gone while the brand and the control remain.
	const narrow = topbar(theme, { range: "24h", chip: chipFor(theme, idle()), freshness: "", innerWidth: 56 });
	expect(strip(narrow)).not.toContain("Live");
	expect(strip(narrow)).toContain("24h");
	expect(strip(narrow)).toContain("omp/stats");
});

test("the topbar never clips at any width from 1 to 200", async () => {
	// The acceptance criterion, stated as a sweep rather than four samples: a
	// row that overflows is torn by `OverlayPanel.row`'s padToWidth and the
	// right-hand control is the thing that disappears.
	for (let width = 1; width <= 200; width++) {
		for (const range of ["1h", "24h", "7d", "30d", "90d", "all"] as const) {
			for (const chip of [chipFor(theme, idle()), chipFor(theme, idle({ syncing: true, current: 25, total: 100, determinate: true })), ""]) {
				for (const freshness of ["", "96 dirty hours"]) {
					const row = topbar(theme, { range, chip, freshness, innerWidth: width });
					expect(visibleWidth(row), `w=${width} range=${range}`).toBeLessThanOrEqual(width);
				}
			}
		}
	}
	// The real frame at the four widths the brief names, with a chip, a sync in
	// flight, and a large freshness string all at once.
	for (const width of [40, 60, 100, 150]) {
		const panel = __testing.makePanel({ data: liveData(), rows: 40 });
		await __testing.settled(panel);
		for (const row of panel.render(width)) {
			expect(visibleWidth(row), `w=${width}`).toBeLessThanOrEqual(width);
		}
	}
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
