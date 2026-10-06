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
import { visibleWidth } from "@oh-my-pi/pi-tui";

import { SCREEN_SPECS } from "../src/layout/spec";
import {
	JUMP_TIMEOUT_MS,
	NAV_GROUPS,
	ago,
	chipFor,
	progressLineFor,
	TOPBAR_SPACER_MIN,
	screenForHotkey,
	sidebar,
	topbar,
} from "../src/tui/chrome";
import { SIDEBAR_INK, TAB_INK } from "../src/tui/palette";
import { __testing, SELECTABLE_SCREENS, panelAction } from "../src/tui/panel";
import type { SyncEvent } from "../src/sync/client";
import { liveData } from "./fixtures/panel";

ensureThemeSync();

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
/** The selectedBg escape prefix, without regex: strip the trailing bg reset. */
const _bg = theme.bg("selectedBg", "").split("x")[0] ?? "";
const ESC = String.fromCharCode(27);
const ACTIVE_BG = _bg.endsWith(ESC + "[49m") ? _bg.slice(0, -(ESC + "[49m").length) : _bg;

const SGR = /\x1b\[([0-9;]*)m/g;
const DEFAULT_FG = theme.getColorHex("text").toLowerCase();

/**
 * The EFFECTIVE foreground colour of every visible run in `line`, in order,
 * resolved the way a terminal resolves it rather than by scanning for the
 * escapes we happened to write.
 *
 * This exists because the escape-based approach cannot see the `text` token at
 * all: `text` IS the terminal's default foreground, so `theme.fg("text", …)`
 * emits NO colour SGR at all. A test looking for `\x1b[38;2;…` would therefore
 * report the ink-1 heading as "has no colour", which is exactly backwards — and
 * it is why `SIDEBAR_INK.headingActive` is `text`: the web's `--ink-1` IS the
 * default text colour, so the faithful terminal rendering of it is no escape.
 *
 * Each SGR is applied to a running foreground state; the gaps between SGRs that
 * contain visible characters become entries. Background and weight sequences
 * leave the foreground alone.
 */
const inksIn = (line: string): string[] => {
	const runs: string[] = [];
	let current = DEFAULT_FG;
	let cursor = 0;
	for (const match of line.matchAll(SGR)) {
		if (line.slice(cursor, match.index).trim() !== "") runs.push(current);
		const params = match[1] ?? "";
		if (params === "39") current = DEFAULT_FG;
		else if (params.startsWith("38;2;")) {
			// `"38;2;"` is FIVE characters — slice(6) silently drops the red
			// channel's first digit and every colour comes back wrong.
			const [r, g, b] = params.slice(5).split(";").map(Number);
			current = `#${[r, g, b].map(v => (v ?? 0).toString(16).padStart(2, "0")).join("")}`;
		}
		cursor = match.index + match[0].length;
	}
	if (line.slice(cursor).trim() !== "") runs.push(current);
	return runs;
};


/**
 * The hex a run of `colour` ACTUALLY renders as on this terminal.
 *
 * Not `getColorHex`. Under `256color` the host quantises on the way out, so
 * `getColorHex("dim")` says `#5f6673` while the escape on the wire carries
 * `#056673` — and a test comparing the two fails on every level at once while
 * saying nothing about the palette. This reads the quantised value back out of
 * a real escape, which is the only number a reader's terminal ever sees.
 *
 * `text` emits NO colour SGR at all, because it IS the default foreground, so
 * it resolves to the same default {@link inksIn} starts from.
 */
const hexOf = (colour: Parameters<typeof theme.fg>[0]): string => {
	const sgr = /\x1b\[38;2;(\d+);(\d+);(\d+)m/.exec(theme.fg(colour, ""));
	if (!sgr) return DEFAULT_FG;
	const [, r, g, b] = sgr;
	return `#${[r, g, b].map(v => Number(v).toString(16).padStart(2, "0")).join("")}`;
};

/** Frame row index of a nav GROUP HEADING, derived from NAV_GROUPS. These used
 * to be the literals 4 and 8, which shifted the moment `providers` joined Usage
 * and silently moved the thing these tests are about. */
const headingRowOf = (heading: string): number => {
	let row = 0;
	for (const g of NAV_GROUPS) {
		if (g.heading === heading) return row;
		row += 1 + g.items.length;
	}
	throw new Error(`no nav heading ${heading}`);
};
/** Frame row index of a nav ROW, derived the same way. */
const navRowOf = (id: string): number => {
	let row = 0;
	for (const g of NAV_GROUPS) {
		row += 1;
		const hit = g.items.findIndex(i => i.id === id);
		if (hit !== -1) return row + hit;
		row += g.items.length;
	}
	throw new Error(`no nav row for ${id}`);
};

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
	// Derived from SELECTABLE_SCREENS, never restated: every screen the arrow
	// keys can land on has a nav row, in nav-group order. This used to be a
	// literal eight-id list, which is how `providers` and `gain` came to be
	// reachable with no row to show them on.
	expect(ids).toEqual(SELECTABLE_SCREENS.map(s => s.id).sort(
		(a, b) => ids.indexOf(a) - ids.indexOf(b),
	));
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
	// Derived from NAV_GROUPS, never restated: one heading row per group plus one
	// row per screen. This was `3 + 8` and went stale when `providers` and `gain`
	// gained nav rows.
	expect(plain).toHaveLength(NAV_GROUPS.reduce((n, g) => n + 1 + g.items.length, 0));
	// Every row carries the host's 2-column prefix slot: cursor + space when
	// selected, two spaces otherwise (settings-list.ts:939-940).
	expect(plain[0]!.trim()).toBe("Usage");
	expect(plain[headingRowOf("Activity")]!.trim()).toBe("Activity");
	expect(plain[headingRowOf("Insights")]!.trim()).toBe("Insights");
	expect(plain[1]).toMatch(/Overview/);
	expect(plain[1]).toMatch(/G O/);
	expect(plain[navRowOf("requests")]).toMatch(/Requests/);
	expect(plain[navRowOf("requests")]).toMatch(/G R/);
	for (const line of plain) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
	expect(width).toBeLessThanOrEqual(26);
});

test("the active sidebar row wears the web's selected fill, with the accent ONLY on its icon", () => {
	// `.nav-row[data-active="true"]` is `background: var(--selected); color:
	// var(--ink-1)` (styles.css:547-550) and only its `svg` takes the accent
	// (:557-559). So the ACTIVE NAV ROW IS A FILLED ROW with an ink-1 label —
	// ours painted accent TEXT on no fill, which is why the nav read as a list of
	// coloured words instead of a control with a position in it.
	//
	// The 2-cell cursor prefix stays (settings-list.ts:939-940): the web tells
	// active from hover with background ALPHA, which no terminal can render.
	const { lines } = sidebar(theme, "unicode", "costs");
	const active = lines.find(l => strip(l).includes("Costs"));
	expect(active).toBeDefined();
	expect(strip(active!)).toStartWith(`${theme.nav.cursor} `);
	expect(active!).toContain(ACTIVE_BG);
	// Exactly ONE accent run on the row: the icon. Label and cursor are ink-1,
	// and the jump hint is ink-4 — the web's own three rungs for that row.
	expect(inksIn(active!).filter(hex => hex === hexOf(SIDEBAR_INK.iconActive))).toHaveLength(1);
	expect(inksIn(active!)).toContain(hexOf(SIDEBAR_INK.rowActive));
	expect(inksIn(active!).at(-1)).toBe(hexOf(SIDEBAR_INK.jumpKey));
	// No other row gets the fill: one selected row per panel.
	for (const line of lines) {
		if (line === active) continue;
		expect(line).not.toContain(ACTIVE_BG);
	}
});

test("the group headings are two different levels, not one colour repeated three times", () => {
	// THE REPORTED DEFECT: "the sidebar group headings are all the same colour".
	// Two of the three were `muted`, so the only heading that differed was the
	// one in the active group — and it differed by HUE, the same hue the active
	// ROW's icon uses, so the heading stopped being structure and became another
	// selection marker.
	//
	// `.nav-heading` is `--ink-3` @500 (styles.css:515-520) for every group and
	// the web has NO active-group variant. The active group's heading stepping up
	// one ink is OURS, and it borrows the web's own selection rule — `.nav-row`
	// ink-2 → `[data-active]` ink-1 (styles.css:547-550) — rather than inventing
	// one.
	const { lines } = sidebar(theme, "unicode", "overview");
	expect(strip(lines[0]!).trim()).toBe("Usage");
	expect(strip(lines[headingRowOf("Activity")]!).trim()).toBe("Activity");
	expect(inksIn(lines[0]!)).toEqual([hexOf(SIDEBAR_INK.headingActive)]);
	expect(inksIn(lines[headingRowOf("Activity")]!)).toEqual([hexOf(SIDEBAR_INK.headingInactive)]);
	// Two different colours, not merely different weights.
	expect(hexOf(SIDEBAR_INK.headingActive)).not.toBe(hexOf(SIDEBAR_INK.headingInactive));
	expect(lines[0]!).not.toBe(lines[4]!);
	// A heading is never a row: no cursor, no jump key.
	expect(lines[headingRowOf("Activity")]!).not.toContain(theme.nav.cursor);
	expect(strip(lines[headingRowOf("Activity")])).not.toMatch(/G [A-Z]/);
});

test("the four sidebar levels are four different renderings, each tied to its own token", () => {
	// The acceptance test for the hierarchy. Four levels — heading-active,
	// heading-inactive, active row, inactive row — that must not be textually
	// identical and must each paint with the token its role names.
	const { lines } = sidebar(theme, "unicode", "overview");
	const headingActive = lines[0]!; // "Usage"
	const rowActive = lines[1]!; // Overview
	const rowInactive = lines[navRowOf("models")]!;
	const headingInactive = lines[headingRowOf("Activity")]!;
	const four = [headingActive, headingInactive, rowActive, rowInactive];
	expect(new Set(four).size, "two sidebar levels rendered byte-identically").toBe(4);

	expect(inksIn(headingActive)).toEqual([hexOf(SIDEBAR_INK.headingActive)]);
	expect(inksIn(headingInactive)).toEqual([hexOf(SIDEBAR_INK.headingInactive)]);
	// An inactive row is exactly three runs: icon, label, jump hint — one level
	// each, which is the whole claim that a row is not a flat line of text.
	expect(inksIn(rowInactive)).toEqual([
		hexOf(SIDEBAR_INK.iconInactive),
		hexOf(SIDEBAR_INK.rowInactive),
		hexOf(SIDEBAR_INK.jumpKey),
	]);
	// The active row is the same three runs with the icon stepped to the accent,
	// plus the cursor in the label's ink — so no heading level leaks into it.
	expect(inksIn(rowActive)).toEqual([
		hexOf(SIDEBAR_INK.rowActive),
		hexOf(SIDEBAR_INK.iconActive),
		hexOf(SIDEBAR_INK.rowActive),
		hexOf(SIDEBAR_INK.jumpKey),
	]);
});

test("a row's jump hint is the faintest run on that row", () => {
	// `.nav-row kbd` is `--ink-4` (styles.css:565-570) against a `--ink-2` label:
	// one full ink step below, so the hint never competes with what it annotates.
	// Ours painted it `dim`, which is the heading's ink, so the hint and the
	// structure above it were the same colour.
	for (const id of ["overview", "models", "costs"]) {
		const { lines } = sidebar(theme, "unicode", id);
		const rows = lines.filter(l => /G [A-Z]$/.test(strip(l)));
		expect(rows.length).toBe(NAV_GROUPS.reduce((n, g) => n + g.items.length, 0));
		for (const line of rows) {
			expect(inksIn(line).at(-1), "the jump hint is the last run").toBe(hexOf(SIDEBAR_INK.jumpKey));
		}
	}
});

test("the row icon is a level of its own, quieter than its label", () => {
	// `.nav-row svg { color: var(--ink-3) }` against a `--ink-2` label
	// (styles.css:552-555): the icon is chrome for the label, not more label.
	// Ours painted icon and label the same colour, so each row was one flat run.
	const inactive = sidebar(theme, "unicode", "models").lines.find(l => strip(l).includes("Costs"))!;
	expect(inksIn(inactive).slice(0, 2)).toEqual([
		hexOf(SIDEBAR_INK.iconInactive),
		hexOf(SIDEBAR_INK.rowInactive),
	]);
	expect(SIDEBAR_INK.iconInactive).not.toBe(SIDEBAR_INK.rowInactive);
	// The ACTIVE row's icon is the ONE accent on the row (styles.css:557-559),
	// and its LABEL is not: the active row is ink-1 with an accent glyph.
	const active = sidebar(theme, "unicode", "costs").lines.find(l => strip(l).includes("Costs"))!;
	expect(inksIn(active)[1]).toBe(hexOf(SIDEBAR_INK.iconActive));
	expect(inksIn(active)[0]).toBe(hexOf(SIDEBAR_INK.rowActive));
	expect(inksIn(active)[2]).toBe(hexOf(SIDEBAR_INK.rowActive));
	expect(SIDEBAR_INK.iconActive).not.toBe(SIDEBAR_INK.rowActive);
});

test("hover and active share the band and the label ink, and differ by the three cues the web has", () => {
	// `.nav-row:hover` is `background: var(--hover); color: var(--ink-1)`
	// (styles.css:538-541); `[data-active]` is `background: var(--selected);
	// color: var(--ink-1)` (:547-550). The web separates those two states by
	// background ALPHA ALONE — 0.035 against 0.075 — and a terminal has one
	// background token and no alpha, so the terminal has to spend the difference
	// elsewhere. It spends it on the three cues the web already owns and which a
	// hover row never gets: the accent icon, the cursor, and the weight.
	const { lines } = sidebar(theme, "unicode", "overview", "models");
	const hovered = lines.find(l => strip(l).includes("Models"))!;
	const active = lines.find(l => strip(l).includes("Overview"))!;
	// Same band, same label ink — exactly the web's ink-1.
	expect(hovered).toContain(ACTIVE_BG);
	expect(inksIn(hovered)[1]).toBe(hexOf(SIDEBAR_INK.rowHover));
	expect(inksIn(active)[2]).toBe(hexOf(SIDEBAR_INK.rowActive));
	// And three differences, none of them the fill.
	expect(inksIn(hovered)[0]).not.toBe(inksIn(active)[1]); // icon: ink-3, not accent
	expect(strip(hovered)).not.toStartWith(theme.nav.cursor); // no cursor
	expect(hovered).not.toContain("\x1b[1m"); // no weight
	expect(hovered).not.toBe(active);
	// A hovered ID that names a group HEADING paints nothing special: the
	// heading is structure, not a target, so hovering it must not band it. The
	// active row still carries its own band, so only the heading row is checked.
	const { lines: plain } = sidebar(theme, "unicode", "overview", "Usage");
	expect(plain[0]).toBe(lines[0]);
	expect(plain[0]).not.toContain(ACTIVE_BG);
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
	expect(bodyRows).toHaveLength(NAV_GROUPS.reduce((n, g) => n + g.items.length, 0));

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
	const labels = NAV_GROUPS.flatMap(g => g.items.map(i => i.label));
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
	for (const width of [0, 1, 3, 8, 10, 12, 20, 60, 100]) {
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

/**
 * The three regions of a topbar row, in cells: the gap after the wordmark, the
 * action cluster's own width, and the padding the frame adds after it.
 *
 * Measured rather than guessed, because the cap under test is a comparison
 * between the gap and the cluster and a one-cell error in either side flips
 * the result. The cluster BEGINS at the first control cell — the chip's status
 * mark when the chip survives this width, the first range segment when it does
 * not — and ENDS one cell after the last non-blank, because the last segment
 * carries a one-cell right pad of its own (chrome.ts's `tray`, which pads every
 * segment as ` label `). `trailing` is therefore the frame's own padding and is
 * measured against the row's full inner width, NOT against `trimEnd`, which
 * would just be re-reading that segment pad.
 */
function spacerOf(row: string, innerWidth: number): { lead: number; trailing: number; cluster: number } {
	const plain = strip(row);
	const brandEnd = plain.indexOf("omp/stats") + "omp/stats".length;
	// Anchored on the control's LEADING PAD, not on its first visible glyph:
	// the chip is ` ● Live `, so matching `●` alone would start the cluster one
	// cell late and make the cap comparison off by exactly the chip's padding.
	const clusterStart = plain.search(/ (●|⟳|✘|⚠)| 1h | 24h /);
	const clusterEnd = plain.trimEnd().length + 1;
	return {
		lead: clusterStart - brandEnd,
		cluster: clusterEnd - clusterStart,
		trailing: innerWidth - plain.length,
	};
}

test("the spacer is BOUNDED by the cluster it separates, not by the row's slack", () => {
	// THE TERMINAL-HAS-NO-VIEWPORT RULE. The web separates the wordmark from
	// the action cluster with `.topbar-spacer { flex: 1 }` (styles.css:453-455)
	// — on a 1440px viewport that spacer absorbs roughly 850px against 8px
	// inside the group. A browser has a viewport to justify unbounded slack
	// between two fixed things; a terminal has none, and 95 blank cells at
	// width 150 reads as a broken row rather than as separation.
	//
	// So the spacer is capped at the WIDTH OF THE CLUSTER it separates: a gap
	// wider than the thing it divides stops reading as "these two are apart" and
	// starts reading as "something failed to draw". The cap is therefore derived
	// from the cluster's own measured width rather than picked — a cluster that
	// gains or loses a segment moves its own bound.
	for (const innerWidth of [96, 146, 196]) {
		const row = topbar(theme, { range: "24h", chip: chipFor(theme, idle()), freshness: "", innerWidth });
		const { lead, cluster } = spacerOf(row, innerWidth);
		expect(lead, `innerWidth=${innerWidth}`).toBeLessThanOrEqual(cluster);
		// …but never so tight that the chip welds itself to the wordmark, which
		// is the failure the gap exists to prevent.
		expect(lead, `innerWidth=${innerWidth}`).toBeGreaterThanOrEqual(TOPBAR_SPACER_MIN);
	}
});

test("the cluster is detached from the wordmark at 150, the width that broke it", () => {
	// The whole point of the cap: bounded, but still obviously a separate object.
	const row = topbar(theme, { range: "24h", chip: chipFor(theme, idle()), freshness: "", innerWidth: 146 });
	const { lead, cluster, trailing } = spacerOf(row, 146);
	expect(lead).toBeGreaterThanOrEqual(3);
	expect(lead).toBeLessThanOrEqual(cluster);
	// The cluster does not sit flush against the frame's right edge either: it
	// pulls inboard, which is what "centre-right rather than the extreme edge"
	// means for a row with no viewport to stretch.
	expect(trailing).toBeGreaterThan(0);
});

test("slack stays bounded at every width the brief names, and nothing ever clips", () => {
	// Requirement (b) and (c) together: a bounded gap at 150/100/60, and no
	// clipping at 40/60/100/150 for any range, chip state or freshness.
	for (const innerWidth of [146, 96, 56]) {
		for (const range of ["1h", "24h", "all"] as const) {
			const row = topbar(theme, { range, chip: chipFor(theme, idle()), freshness: "", innerWidth });
			const { lead, cluster } = spacerOf(row, innerWidth);
			expect(lead, `w=${innerWidth} ${range}`).toBeLessThanOrEqual(cluster);
			expect(visibleWidth(row), `w=${innerWidth} ${range}`).toBeLessThanOrEqual(innerWidth);
	}
	}
	for (const width of [40, 60, 100, 150]) {
		for (const range of ["1h", "24h", "7d", "30d", "90d", "all"] as const) {
			for (const chip of [chipFor(theme, idle()), chipFor(theme, idle({ syncing: true, current: 25, total: 100, determinate: true })), ""]) {
				for (const freshness of ["", "96 dirty hours"]) {
					const row = topbar(theme, { range, chip, freshness, innerWidth: width });
					expect(visibleWidth(row), `w=${width} ${range}`).toBeLessThanOrEqual(width);
				}
			}
		}
	}
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
	const inactive = ["1h", "7d", "30d", "90d", "All"].map(label => theme.fg(TAB_INK.inactive, ` ${label} `));
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


// ─── the number row ───────────────────────────────────────────────────────────

/**
 * Ported from the base branch's `test/panel.test.ts` ("every selectable screen
 * is on the number row, so no digit is a dead key" / "digits index the
 * SELECTABLE screens"). PR #1 took the panel from eleven routes to twelve and
 * rewrote `chrome.ts`'s hotkey map; both base assertions went with it and
 * nothing replaced them.
 *
 * The digits are written out rather than imported because `panel.ts` keeps
 * `DIGITS` module-private, and this is the whole point of the guard: the list
 * has to be observable from outside. Everything else here is DERIVED — from
 * `panelAction`, which is the real keymap, and from `SELECTABLE_SCREENS`, which
 * is the real registry. Nothing is a restatement, so nothing can go stale the
 * way a literal eight-id list did when `providers` and `gain` arrived.
 */
const DIGIT_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"] as const;

test("every digit on the number row is live and indexes a distinct selectable screen", () => {
	// The base asserted the panel's own `DIGIT_KEYS` list, which is gone; this
	// asks the keymap instead. A digit that indexes nothing, indexes past the
	// end, or lands on the same screen as another digit is a dead or aliased
	// key, and neither is observable from the constant alone.
	const landed: string[] = [];
	for (let index = 0; index < DIGIT_KEYS.length; index++) {
		const key = DIGIT_KEYS[index]!;
		expect(panelAction(key), `digit ${key} is not owned by the panel`).toEqual({ type: "screenIndex", index });
		const screen = SELECTABLE_SCREENS[index];
		expect(screen, `digit ${key} indexes past the end of SELECTABLE_SCREENS`).toBeDefined();
		landed.push(screen!.id);
	}
	expect(new Set(landed).size, `two digits select the same screen: ${landed.join(" ")}`).toBe(landed.length);
});

test("every selectable screen is on the number row, so no digit is a dead key", () => {
	// Direction matters. `DIGITS` is `1`-`9` then `0` — ten keys, and there is
	// no eleventh digit — so the row's length is a hard ceiling on how many
	// routes can carry one. `panel.ts` says as much ("An eleventh screen is
	// simply not on the number row and is reached with `tab`; test/panel.test.ts
	// asserts `SELECTABLE_SCREENS.length` against this list, so the gap becomes a
	// test failure rather than a silently dead key") — and that test is what PR
	// #1 deleted. The message names the orphans, because "12 > 10" on its own
	// does not tell a reader which two screens are the unreachable ones.
	const onRow = DIGIT_KEYS.slice(0, Math.min(DIGIT_KEYS.length, SELECTABLE_SCREENS.length)).map(
		(_, index) => SELECTABLE_SCREENS[index]!.id,
	);
	const orphans = SELECTABLE_SCREENS.map(screen => screen.id).filter(id => !onRow.includes(id));
	expect(
		SELECTABLE_SCREENS.length,
		`${orphans.length} selectable screen(s) are reachable but have no digit: ${orphans.join(", ") || "none"} — the number row holds ${DIGIT_KEYS.length}`,
	).toBeLessThanOrEqual(DIGIT_KEYS.length);
});

test("digits index the SELECTABLE screens, so a number never lands on an excluded one", () => {
	// The selectable set is spec-driven: every non-deferred screen the IR can
	// describe, minus the ones the registry marks excluded. A digit that could
	// reach an excluded screen would spend a keystroke on a page the panel
	// cannot honestly fill, which is exactly what `excluded` exists to prevent.
	expect(__testing.debugScreenIds()).toEqual(SELECTABLE_SCREENS.map(screen => screen.id));
	expect(SELECTABLE_SCREENS.every(screen => screen.status !== "excluded")).toBe(true);
	for (let index = 0; index < DIGIT_KEYS.length; index++) {
		const screen = SELECTABLE_SCREENS[index];
		expect(screen, `digit ${DIGIT_KEYS[index]} has nothing to select`).toBeDefined();
		expect(__testing.debugScreenIds(), `digit ${DIGIT_KEYS[index]}`).toContain(screen!.id);
	}
});

// ─── jump letters ────────────────────────────────────────────────────────────

test("every jump letter resolves back to the row that shows it, and none is claimed twice", () => {
	// The base pinned eight specific letters. This derives the whole set from
	// `NAV_GROUPS`, which is what `screenForHotkey` itself reads, so a letter
	// can no longer be added to one and forgotten in the other: `HOTKEYS` is
	// module-private in `chrome.ts`, and this asserts its observable projection
	// — every row has exactly one single lowercase letter, no two rows share
	// one, and `screenForHotkey` round-trips each of them in both cases.
	const rows = NAV_GROUPS.flatMap(group => group.items);
	const claimed = new Map<string, string>();
	for (const row of rows) {
		expect(row.hotkey, `${row.id} has no jump letter`).toMatch(/^[a-z]$/);
		expect(screenForHotkey(row.hotkey), `${row.id} claims ${row.hotkey}, which resolves elsewhere`)
			.toBe(row.id);
		expect(screenForHotkey(row.hotkey.toUpperCase()), `${row.id} is not case-insensitive`).toBe(row.id);
		const prior = claimed.get(row.hotkey);
		expect(prior, `letter ${row.hotkey} is claimed by both ${prior} and ${row.id}`).toBeUndefined();
		claimed.set(row.hotkey, row.id);
	}
	// `g` is the ARM, never a jump target: a row that claimed it would make
	// `g g` a screen and the prefix unexplainable.
	expect(claimed.has("g")).toBe(false);
	// Every selectable screen has a row, and therefore a letter — otherwise it
	// is reachable by arrow and by digit and not by jump.
	for (const screen of SELECTABLE_SCREENS) {
		expect(rows.map(row => row.id), `${screen.id} has no nav row and no jump letter`).toContain(screen.id);
	}
});

test("no jump letter resolves to a screen with no nav row to show it on", () => {
	// `screenForHotkey` reads `NAV_GROUPS`, so this cannot drift from it — but
	// the invariant is worth stating, because it is what makes `g` + a letter
	// safe: a keystroke never lands on a route the sidebar cannot name.
	for (let code = 97; code <= 122; code++) {
		const letter = String.fromCharCode(code);
		const id = screenForHotkey(letter);
		if (id === null) continue;
		expect(NAV_GROUPS.flatMap(group => group.items.map(row => row.id)), letter).toContain(id);
	}
});
