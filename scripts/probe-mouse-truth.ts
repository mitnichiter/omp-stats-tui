/**
 * `scripts/probe-mouse-truth.ts` — SETTLE THE SIDEBAR ROW ARITHMETIC, ONCE.
 *
 * WHY THIS FILE IS A PROBE AND NOT A TEST. Two implementations of "which row is
 * this click" exist and they disagree by one:
 *
 *   - `mouse.ts`'s `hitTest`, which computes `contentRow = row - 1` and then
 *     `bodyRow = contentRow - topbarRows - stripRows`;
 *   - `test/mouse.test.ts`'s `overlayRow` helper, which builds
 *     `1 + topbarRows + stripRows + navRow + 1`.
 *
 * Substituting the helper into `hitTest` gives `bodyRow = navRow + 1`, so on
 * their reading the helper clicks the row BELOW the one it names. That is either a
 * real off-by-one in one of them, or an artefact of how a probe drove them.
 *
 * WHY ARGUMENTING DID NOT SETTLE IT. A single probe that sweeps rows in ONE panel
 * cannot attribute an answer: a click only takes effect on the next render, so a
 * probe that fires N clicks and reads N answers is measuring its own sequencing,
 * not the geometry. The "nav N returns nav N-1" shape that reading produces is
 * exactly what render lag looks like.
 *
 * SO EVERY ROW GETS A FRESH PANEL, AND — THE POINT — THE SAME COORDINATE IS PUT
 * THROUGH BOTH PATHS IN THE SAME RUN:
 *
 *     N | overlay row | hitTest says | one-click path says | agree?
 *
 * `hitTest` is called DIRECTLY with the panel's own recorded frame, so its answer
 * is computed from the same input as the click's, with no render in between. The
 * two columns agree or they do not, and there is no third interpretation
 * available: the table cannot be ambiguous, because both answers come from the
 * same frame in the same process.
 *
 * Swept across every nav row at two widths and two heights, since the frame
 * regions differ between them (the sidebar exists only where `framePolicy`
 * affords one, and `topbarRows` moves with the sync chip).
 *
 * Run: `bun scripts/probe-mouse-truth.ts`
 */

import { __testing, SELECTABLE_SCREENS } from "../src/tui/panel";
import { hitTest, sidebarHit, type MouseFrame } from "../src/tui/mouse";
import { NAV_GROUPS } from "../src/tui/chrome";
import { liveData } from "../test/fixtures/panel";

const WIDTHS = [150, 100] as const;
const HEIGHTS = [40, 24] as const;
const CLICK_COL = 3;

/** The nav rows a sidebar column can occupy: headings included, so all 13. */
const NAV_ROWS = NAV_GROUPS.reduce((rows, group) => rows + 1 + group.items.length, 0);

/**
 * `test/mouse.test.ts`'s helper, verbatim. This is the ARITHMETIC UNDER TEST, so
 * it must not be tidied: if it is wrong, the probe has to be able to say so.
 */
function overlayRow(frame: MouseFrame, navRow: number): number {
	return 1 + frame.topbarRows + frame.stripRows + navRow + 1;
}

/** One SGR left-click press, built the way the terminal sends it. */
const sgr = (button: number, col: number, row: number): string => `\x1b[<0;${col};${row}M`;

const rows: string[] = [];
let disagreements = 0;
let unreachable = 0;

for (const width of WIDTHS) {
	for (const height of HEIGHTS) {
		rows.push(`\n### width ${width}, height ${height}`);

		for (let navRow = 0; navRow < NAV_ROWS; navRow++) {
			// A FRESH panel per coordinate, and a settle before the click so the
			// frame this row is read from is a settled one rather than a loading
			// one — the topbar carries one more row while a sync is live.
			const panel = __testing.makePanel({ data: liveData(), range: "30d", rows: height });
			await __testing.settled(panel);
			panel.render(width);
			const frame = __testing.debugFrame(panel);
			if (!frame) {
				rows.push(`${String(navRow).padStart(2)} | no frame recorded`);
				continue;
			}
			if (frame.sidebarWidth === 0) {
				unreachable++;
				rows.push(`${String(navRow).padStart(2)} | sidebar hidden at this width — no nav to click`);
				continue;
			}

			const coordinate = overlayRow(frame, navRow);

			// PATH 1 — `hitTest` called directly, with the SAME arguments the panel
			// passes it. That means applying `routeSgrMouseInput`'s 1-based → 0-based
			// conversion FIRST (`pi-tui/src/mouse.ts:43-44` does `Number(match[n]) - 1`
			// on both axes): the terminal reports row 1 first, and the panel hands
			// `hitTest` the CONVERTED row.
			//
			// THE FIRST RUN OF THIS PROBE OMITTED THAT CONVERSION, fed `hitTest` a raw
			// 1-based coordinate, and so reported a uniform off-by-one across all 52
			// row/width combinations that was entirely the probe's own: the click
			// column agreed with `sidebarHit` on every row while only the `hitTest`
			// column disagreed. Both columns are pure calls from one frame, so the
			// table is comparable only once they receive the same coordinate.
			const hit = hitTest(frame, coordinate - 1, CLICK_COL - 1);
			const viaHitTest = hit.type === "screen" ? hit.id : hit.type === "none" ? "(none)" : `${hit.type}`;

			// PATH 2 — real SGR bytes through the panel, ONE click, then settle.
			const before = __testing.debugScreenId(panel);
			panel.handleInput(sgr(0, CLICK_COL, coordinate));
			await __testing.settled(panel);
			const after = __testing.debugScreenId(panel);

			// The click path can only report a CHANGE as a selection, so a row that
			// legitimately names the already-active screen is indistinguishable from
			// one that hit nothing. The `sidebarHit` column disambiguates them.
			const expected = sidebarHit(navRow);
			const clicked = after === before ? `(no change: ${after})` : after;
			// A heading names nothing, so BOTH paths must report no hit for it. For a
			// row that names a screen, the click path agrees only if it moved to that
			// screen, or was already there — the `(no change: X)` reading is an
			// agreement precisely when X is the expected screen.
			const clickAgrees = expected === null ? clicked === `(no change: ${before})` : clicked === expected || clicked === `(no change: ${expected})`;
			const hitAgrees = expected === null ? viaHitTest === "(none)" : viaHitTest === expected;
			const agree = hitAgrees && clickAgrees;
			if (!agree) disagreements++;
			rows.push(
				`${String(navRow).padStart(2)} | ${String(coordinate).padStart(3)} | ` +
					`sidebarHit=${(expected ?? "(heading)").padEnd(9)} | hitTest=${viaHitTest.padEnd(9)} ${hitAgrees ? " " : "<--"} | ` +
					`click=${clicked.padEnd(18)} ${clickAgrees ? " " : "<--"} | ${agree ? "AGREE" : "**DISAGREE**"}`,
			);
		}
	}
}

console.log(`nav rows per sidebar: ${NAV_ROWS} (${NAV_GROUPS.length} headings + ${SELECTABLE_SCREENS.length} screens)`);
console.log(`swept ${WIDTHS.length} widths x ${HEIGHTS.length} heights x ${NAV_ROWS} rows`);
console.log(`sidebar hidden (skipped): ${unreachable}`);
console.log(`DISAGREEMENTS between hitTest and the click path: ${disagreements}`);
console.log(
	disagreements === 0
		? "\nVERDICT: the two paths AGREE on every reachable row. The click arithmetic is correct."
		: "\nVERDICT: the two paths DISAGREE — there is a real off-by-one, and the disagreeing\n" +
			"         rows above name which path moved.",
);
console.log(rows.join("\n"));