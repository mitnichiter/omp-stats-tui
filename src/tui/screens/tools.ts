/**
 * `src/tui/screens/tools.ts` — registry entry, and nothing else.
 *
 * A spec'd screen's registry entry carries identity and contract and defers
 * `render` to the pipeline; see `costs.ts` for why a body here would be a
 * second grammar for the same screen.
 *
 * Per-tool token and cost figures are SHARES of the assistant turn that asked
 * for them, not measurements of each call — one turn's usage is attributed
 * across its batch. So this screen ranks calls and never prints a per-call cost.
 */

import type { Screen } from "./types";
import { SCREEN_SPECS } from "../../layout/spec";
import { renderSpecScreen } from "./render";

const spec = SCREEN_SPECS.find(s => s.id === "tools")!;

export const toolsScreen: Screen = {
	id: "tools",
	label: "Tools",
	short: "Tools",
	status: "implemented",
	needs: ["tools", "rollupStatus"],
	render: ctx => renderSpecScreen(spec, ctx),
};
