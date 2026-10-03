/**
 * `src/tui/screens/requests.ts` — registry entry, and nothing else.
 *
 * A spec'd screen's registry entry carries identity and contract and defers
 * `render` to the pipeline; see `costs.ts` for why a body here would be a
 * second grammar for the same screen.
 *
 * `recent` is a fixed-size list of the latest requests, not a window: the route
 * takes a limit rather than a range, so the screen's heading must not claim the
 * range covers it.
 */

import type { Screen } from "./types";
import { SCREEN_SPECS } from "../../layout/spec";
import { renderSpecScreen } from "./render";

const spec = SCREEN_SPECS.find(s => s.id === "requests")!;

export const requestsScreen: Screen = {
	id: "requests",
	label: "Requests",
	short: "Requests",
	status: "implemented",
	needs: ["recent", "errors", "rollupStatus"],
	render: ctx => renderSpecScreen(spec, ctx),
};
