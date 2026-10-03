/**
 * `src/tui/screens/overview.ts` — registry entry, and nothing else.
 *
 * Once a screen has a `ScreenSpec`, its grammar is already defined — in the IR,
 * shared with every other screen — and its rows are already produced, by
 * `renderScreen`. A `render` body here would be a SECOND grammar for the same
 * screen: a second place to arrange tiles, a second column policy, a second
 * answer to "what does this screen look like". The migration rule that falls
 * out of the IR's own contract is therefore: a spec'd screen's registry entry
 * carries identity and contract, and defers `render` to the pipeline.
 *
 * `recent` is a fixed-size list of the latest requests, not a window: the route
 * takes a limit rather than a range, so the screen's heading must not claim the
 * range covers it.
 */

import type { Screen } from "./types";
import { SCREEN_SPECS } from "../../layout/spec";
import { renderSpecScreen } from "./render";

const spec = SCREEN_SPECS.find(s => s.id === "overview")!;

export const overviewScreen: Screen = {
	id: "overview",
	label: "Overview",
	short: "Overview",
	status: "implemented",
	needs: ["overview", "recent", "rollupStatus"],
	render: ctx => renderSpecScreen(spec, ctx),
};
