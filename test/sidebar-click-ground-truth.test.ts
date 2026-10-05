/**
 * `test/sidebar-click-ground-truth.test.ts` — EVERY nav row, one click, real bytes.
 *
 * WHY THIS FILE EXISTS. Two implementations of "which screen is this click" exist:
 * `mouse.ts`'s `hitTest`, and the `overlayRow` helper in `test/mouse.test.ts`. Read
 * on paper they disagree by one — substituting the helper's coordinate into
 * `hitTest`'s arithmetic gives `bodyRow = navRow + 1`, which reads like a real
 * off-by-one in the sidebar's hit geometry.
 *
 * They do not disagree. `routeSgrMouseInput` converts the terminal's 1-BASED SGR
 * coordinates to 0-based before the panel ever calls `hitTest`
 * (`pi-tui/src/mouse.ts:43-44`), so the helper's `+1` and `hitTest`'s `-1` are the
 * SAME conversion applied on either side of the same wire format.
 *
 * THAT WAS NOT OBVIOUS, and it was nearly concluded the other way twice:
 *
 *   - a probe that fired 13 clicks into ONE panel reported "nav N selects N-1" —
 *     but a click only lands on the next render, so that sweep measured its own
 *     sequencing, not the geometry;
 *   - a probe that called `hitTest` directly, passing the helper's coordinate
 *     through unconverted, reported a uniform off-by-one across all 52 row/width
 *     combinations — which was the PROBE's bug, since it fed `hitTest` a 1-based
 *     coordinate the panel would never hand it.
 *
 * Both errors produced the same convincing wrong answer. So the invariant is now
 * pinned by MEASUREMENT rather than by arithmetic anyone has to re-derive.
 *
 * WHAT IS ASSERTED, and why each half matters:
 *
 *   1. ONE CLICK PER PANEL. A fresh panel per coordinate, settled before and after.
 *      Sequential clicks cannot be attributed, which is what made the first sweep
 *      useless.
 *   2. THE ROW NAMED BY `sidebarHit` IS THE SCREEN THE CLICK LANDS ON — for every
 *      nav row, at every width and height that has a sidebar. This is the actual
 *      contract: the helper's coordinate resolves to the row it claims to.
 *   3. A GROUP HEADING SELECTS NOTHING. Three of the thirteen rows are headings,
 *      and "a click on a heading moves nothing" is half of what the arithmetic
 *      claim rests on — it is also the half a naive `navRow + 1` reading would
 *      break first, by selecting the row below.
 *   4. THE COORDINATE IS 1-BASED. Pinned explicitly, because it is the fact that
 *      reconciles the two implementations and the one most likely to be "tidied"
 *      away by someone who believes it is an off-by-one.
 */

import { expect, test } from "bun:test";

import { __testing, SELECTABLE_SCREENS } from "../src/tui/panel";
import { hitTest, sidebarHit, type MouseFrame } from "../src/tui/mouse";
import { NAV_GROUPS } from "../src/tui/chrome";
import { liveData } from "./fixtures/panel";

/** Every row a sidebar column can occupy: one per heading, plus one per screen. */
const NAV_ROWS = NAV_GROUPS.reduce((rows, group) => rows + 1 + group.items.length, 0);

const WIDTHS = [150, 100] as const;
const HEIGHTS = [40, 24] as const;
/** Content column 0 is overlay column 2 (two cells of side inset). */
const CLICK_COL = 3;

/**
 * `test/mouse.test.ts`'s `overlayRow`, verbatim — this is the arithmetic under
 * test, so it is reproduced rather than tidied. If it is wrong, this file has to be
 * able to say so.
 */
function overlayRow(frame: MouseFrame, navRow: number): number {
	return 1 + frame.topbarRows + frame.stripRows + navRow + 1;
}

/** One SGR left-click press, as the terminal sends it: 1-based, button 0. */
const sgr = (col: number, row: number): string => `\x1b[<0;${col};${row}M`;

/** A settled panel with a rendered frame, at one width and height. */
async function frameAt(width: number, height: number): Promise<{ panel: ReturnType<typeof __testing.makePanel>; frame: MouseFrame }> {
	const panel = __testing.makePanel({ data: liveData(), range: "30d", rows: height });
	await __testing.settled(panel);
	panel.render(width);
	const frame = __testing.debugFrame(panel);
	if (!frame) throw new Error(`no frame recorded at width ${width}`);
	return { panel, frame };
}

// ---------------------------------------------------------------------------
// The coordinate is 1-BASED, and that is what reconciles the two implementations
// ---------------------------------------------------------------------------

test("the sidebar coordinate is 1-BASED: hitTest wants it one lower", async () => {
	// The whole finding, in one assertion. `routeSgrMouseInput` subtracts 1 from
	// both axes (`pi-tui/src/mouse.ts:43-44`) before the panel calls `hitTest`, so a
	// coordinate handed straight to `hitTest` must be decremented first. Passing it
	// through unconverted is what made the earlier probe report a phantom
	// off-by-one — and if the conversion is ever removed upstream, this fails and
	// names the place.
	const { frame } = await frameAt(150, 40);
	expect(frame.sidebarWidth).toBeGreaterThan(0);
	const navRow = 2;
	const coordinate = overlayRow(frame, navRow);

	const raw = hitTest(frame, coordinate, CLICK_COL);
	const converted = hitTest(frame, coordinate - 1, CLICK_COL - 1);
	// Unconverted it lands one row low; converted it lands on the named screen.
	expect(sidebarHit(navRow)).not.toBeNull();
	expect(raw.type === "screen" ? raw.id : null).not.toBe(sidebarHit(navRow));
	expect(converted.type === "screen" ? converted.id : null).toBe(sidebarHit(navRow));
});

// ---------------------------------------------------------------------------
// Every nav row, one click per panel
// ---------------------------------------------------------------------------

for (const width of WIDTHS) {
	for (const height of HEIGHTS) {
		test(`every sidebar row selects the screen it names, at ${width}x${height}`, async () => {
			const failures: string[] = [];

			for (let navRow = 0; navRow < NAV_ROWS; navRow++) {
				// A FRESH panel per coordinate. Sequential clicks only take effect on
				// the next render, so a sweep that reuses one panel cannot attribute
				// an answer to the click that caused it.
				const { panel, frame } = await frameAt(width, height);
				if (frame.sidebarWidth === 0) continue;

				const expected = sidebarHit(navRow);
				const coordinate = overlayRow(frame, navRow);

				// PATH 1: `hitTest` directly, with the panel's own conversion applied.
				const hit = hitTest(frame, coordinate - 1, CLICK_COL - 1);
				const viaHitTest = hit.type === "screen" ? hit.id : null;

				// PATH 2: real SGR bytes, ONE click, then settle.
				const before = __testing.debugScreenId(panel);
				panel.handleInput(sgr(CLICK_COL, coordinate));
				await __testing.settled(panel);
				const after = __testing.debugScreenId(panel);

				if (expected === null) {
					// A GROUP HEADING names no screen, so the click must move nothing.
					if (viaHitTest !== null) failures.push(`row ${navRow}: heading, but hitTest reported ${viaHitTest}`);
					if (after !== before) failures.push(`row ${navRow}: heading, but the click moved to ${after}`);
					continue;
				}

				if (viaHitTest !== expected) failures.push(`row ${navRow}: hitTest said ${viaHitTest}, row names ${expected}`);
				// The click reports a selection only as a CHANGE, so landing on the
				// already-active screen reads as "no change" — which agrees.
				if (after !== expected && !(after === before && before === expected)) {
					failures.push(`row ${navRow}: click landed on ${after}, row names ${expected} (was ${before})`);
				}
			}

			expect(failures).toEqual([]);
		});
	}
}

// ---------------------------------------------------------------------------
// The shape of the nav itself
// ---------------------------------------------------------------------------

test("the sweep covered every nav row, and three of them are headings", () => {
	// A sweep that silently covered nothing would pass every row assertion above,
	// so the coverage is asserted rather than assumed.
	expect(NAV_ROWS).toBe(NAV_GROUPS.length + SELECTABLE_SCREENS.length);
	const headings = Array.from({ length: NAV_ROWS }, (_, row) => sidebarHit(row)).filter(id => id === null);
	expect(headings).toHaveLength(NAV_GROUPS.length);
	// And every selectable screen is reachable from a nav row.
	const reachable = new Set(Array.from({ length: NAV_ROWS }, (_, row) => sidebarHit(row)).filter(Boolean));
	for (const screen of SELECTABLE_SCREENS) expect(reachable.has(screen.id), `${screen.id} unreachable`).toBe(true);
});

test("every nav row has a coordinate inside the rendered frame", () => {
	// A coordinate past the frame would be clipped by `OverlayPanel` and the click
	// would vanish — which is a failure mode that looks exactly like "the row is
	// not clickable", so the bound is pinned rather than inferred.
	return frameAt(150, 40).then(({ frame }) => {
		const rows = Array.from({ length: NAV_ROWS }, (_, row) => overlayRow(frame, row));
		expect(Math.min(...rows)).toBeGreaterThan(0);
		// The last nav row must land within the panel's own chrome, not below it.
		expect(Math.max(...rows)).toBeLessThan(frame.topbarRows + frame.stripRows + frame.sidebarRows + 2);
	});
});