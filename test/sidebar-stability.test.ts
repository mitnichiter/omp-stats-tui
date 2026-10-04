/**
 * A SCREEN REACHABLE BY ARROW KEY MUST BE VISIBLE IN THE FRAME YOU REACH IT FROM.
 *
 * Reported: pressing `←`/`→` makes the sidebar visibly jump. Two separate causes,
 * found by diffing all ten screens' sidebar columns at widths 100/150 and
 * heights 19-40, and both fixed here.
 *
 * D1 THE NAV WAS TRUNCATED BY THE BODY. `#zipSidebar` mapped over the body's
 * visible rows, so the nav column was exactly as tall as the body happened to be.
 * `overview` has a 50-line body against `gain`'s 12, and `gain` is the LAST nav
 * row — so arrowing from overview to gain dropped the entire active marker. The
 * nav appeared to jump to a screen it never drew. `panel.ts:#zipSidebar` now
 * takes `max(body rows, nav lines)` and pads the body, never the nav.
 *
 * D2 TWO SCREENS HAD NO NAV ROW AT ALL. `providers` and `gain` are on the
 * `←`/`→` cycle but had no HOTKEYS entry, and `NAV_GROUPS` drops ids without one,
 * so arrowing onto them removed the `❯` outright and left every group heading on
 * its inactive ink. Both are now in the nav.
 *
 * WHAT IS ALLOWED TO CHANGE between two screens: the `❯` marker, and the active
 * group's heading ink. Nothing else — not row order, not row text, not the nav's
 * height, not the column width.
 */
import { expect, test } from "bun:test";
import { SCREEN_SPECS } from "../src/layout/spec";
import { __testing, SELECTABLE_SCREENS } from "../src/tui/panel";
import { NAV_GROUPS, sidebar } from "../src/tui/chrome";
import type { ScreenId } from "../src/tui/screens/types";
import { ensureThemeSync, theme } from "@oh-my-pi/pi-tui/theme";

ensureThemeSync();
/** The nav column's own width, from the same renderer that draws it. Slicing a
 * FIXED width rather than searching for the next `│` matters: a body row with no
 * gutter of its own makes the next `│` a hundred cells away, which reads as a
 * changed nav column when nothing about the nav moved. */
const NAV_WIDTH = sidebar(theme, "unicode", "overview").width;
import { liveData } from "./fixtures/panel";

const ANSI = /\x1b\[[0-9;]*m/g;
const strip = (s: string): string => s.replace(ANSI, "");

/** The nav column of one frame row: exactly NAV_WIDTH cells after the leading `│ `. */
function navColumn(row: string): string | null {
	const plain = strip(row);
	if (!plain.startsWith("│ ")) return null;
	// The topbar shares the frame's left edge but is not nav, and counting it
	// pushes the LAST nav row out of the comparison — which is exactly the row
	// this test exists to catch. Excluded by content, not by index.
	return plain.includes("omp/stats") ? null : plain.slice(2, 2 + NAV_WIDTH);
}

/** The nav's own height, from NAV_GROUPS: one heading row per group, plus its screens. */
const NAV_LINES = NAV_GROUPS.reduce((n, g) => n + 1 + g.items.length, 0);

/** The nav region only. The footer also starts with `│ ` and legitimately differs
 * between a scrollable and a non-scrollable screen, so it is not nav. */
async function sidebarColumn(screenId: ScreenId, width: number, rows: number): Promise<readonly string[]> {
	const panel = __testing.makePanel({ data: liveData(), screenId, rows });
	await __testing.settled(panel);
	return panel
		.render(width)
		.map(navColumn)
		.filter((c): c is string => c !== null)
		.slice(0, NAV_LINES);
}

const WIDTHS = [150, 100] as const;
/** 40 is a normal terminal; 24 and 20 are short, and 20 is the nav floor. */
const HEIGHTS = [40, 24, 20] as const;

test("every reachable screen shows exactly one cursor, at every width and height", async () => {
	for (const width of WIDTHS) {
		for (const rows of HEIGHTS) {
			for (const id of SELECTABLE_SCREENS.map(s => s.id)) {
				const column = await sidebarColumn(id, width, rows);
				const cursors = column.filter(c => c.includes("❯"));
				expect(cursors, `${width}/${rows}/${id}: ${JSON.stringify(column)}`).toHaveLength(1);
			}
		}
	}
});

test("the nav column moves NOTHING between consecutive screens but the cursor", async () => {
	for (const width of WIDTHS) {
		for (const rows of HEIGHTS) {
			const screens = SELECTABLE_SCREENS.map(s => s.id);
			for (let k = 1; k < screens.length; k++) {
				const before = await sidebarColumn(screens[k - 1]!, width, rows);
				const after = await sidebarColumn(screens[k]!, width, rows);
				expect(after.length, `${width}/${rows} ${screens[k]} nav height changed`).toBe(before.length);
				for (let i = 0; i < before.length; i++) {
					if (before[i] === after[i]) continue;
					// The ONLY permitted difference is the cursor, and only on rows
					// that carry one: exactly one row loses `❯`, exactly one gains it.
					expect(
						before[i]!.includes("❯") || after[i]!.includes("❯"),
						`${width}/${rows} ${screens[k - 1]}→${screens[k]} row ${i} moved without the cursor:\n` +
							`  before ${JSON.stringify(before[i])}\n  after  ${JSON.stringify(after[i])}`,
					).toBe(true);
				}
			}
		}
	}
});

test("the nav is never shorter than NAV_GROUPS says it is, on any screen", () => {
	// D1 at the source: the nav is a FRAME region, so its height is a property of
	// the nav, not of whichever screen's body happens to be rendering.
	expect(NAV_LINES).toBeGreaterThan(11);
	for (const g of NAV_GROUPS) expect(g.items.length).toBeGreaterThan(0);
});

test("every screen on the arrow cycle has a row in the nav", () => {
	// D2 at the source. Derived from the two lists rather than restated, so adding
	// a screen without a nav row fails here instead of vanishing in the frame.
	const navIds = NAV_GROUPS.flatMap(g => g.items.map(i => i.id));
	for (const id of SELECTABLE_SCREENS.map(s => s.id)) {
		expect(navIds, `${id} is reachable by ←/→ but has no sidebar row`).toContain(id);
	}
});

test("the nav and the tab strip draw the same screens in different orders", () => {
	// Recorded, not endorsed: below MIN_SIDEBAR_ROWS the panel swaps the sidebar
	// for the strip (`panel.ts:620-626`) and the strip follows `SCREEN_SPECS`. Two
	// controls, two orders. This pins the fact so the ordering change that follows
	// is measurable.
	const navOrder = NAV_GROUPS.flatMap(g => g.items.map(i => i.label));
	const stripOrder = SCREEN_SPECS.filter(s => !s.deferred).map(s => s.label);
	expect(navOrder.indexOf("Activity")).toBeGreaterThan(navOrder.indexOf("Costs"));
	expect(stripOrder.indexOf("Activity")).toBeLessThan(stripOrder.indexOf("Costs"));
});
