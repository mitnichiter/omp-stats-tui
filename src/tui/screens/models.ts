/**
 * `src/tui/screens/models.ts` — registry entry, and nothing else.
 *
 * Once a screen has a `ScreenSpec`, its grammar is already defined — in the IR,
 * shared with every other screen — and its rows are already produced, by
 * `renderScreen`. A `render` body here would be a SECOND grammar for the same
 * screen: a second place to arrange tiles, a second column policy, a second
 * answer to "what does this screen look like". The migration rule that falls
 * out of the IR's own contract is therefore: a spec'd screen's registry entry
 * carries identity and contract, and defers `render` to the pipeline.
 *
 * Row expansion (`ModelDetail` in the route — efficiency, latency and token
 * key-values plus the per-model performance chart) has no terminal renderer;
 * the table carries `expandable: true` on its Model column so the contract is
 * declared even though the pipeline does not expand it.
 */

import type { Screen } from "./types";
import { SCREEN_SPECS } from "../../layout/spec";
import { renderSpecScreen } from "./render";

const spec = SCREEN_SPECS.find(s => s.id === "models")!;

export const modelsScreen: Screen = {
	id: "models",
	label: "Models",
	short: "Models",
	status: "implemented",
	needs: ["modelDashboard", "rollupStatus"],
	render: ctx => renderSpecScreen(spec, ctx),
};
