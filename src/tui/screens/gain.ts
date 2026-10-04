/**
 * `src/tui/screens/gain.ts` — registry entry, and nothing else.
 *
 * A spec'd screen's registry entry carries identity and contract and defers
 * `render` to the pipeline; see `costs.ts` for why a body here would be a
 * second grammar for the same screen.
 *
 * Gain is token savings from snapcompact (a jsonl beside the DB), not cache
 * savings: no dollars, no ratio that goes negative, and reductionPercent
 * stays null because original sizes are never recorded.
 */

import type { Screen } from "./types";
import { SCREEN_SPECS } from "../../layout/spec";
import { renderSpecScreen } from "./render";

const spec = SCREEN_SPECS.find(s => s.id === "gain")!;

export const gainScreen: Screen = {
	id: "gain",
	label: "Gain",
	short: "Gain",
	status: "implemented",
	needs: ["gain", "rollupStatus"],
	render: ctx => renderSpecScreen(spec, ctx),
};
