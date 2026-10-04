/**
 * `src/tui/screens/providers.ts` — registry entry, and nothing else.
 *
 * A spec'd screen's registry entry carries identity and contract and defers
 * `render` to the pipeline; see `costs.ts` for why a body here would be a
 * second grammar for the same screen.
 *
 * The local aggregates (`/api/stats/providers`) are DB-backed rollup — the
 * same cost profile as every other need. The NETWORK route
 * (`/api/stats/provider-windows`) does broker I/O per load and the panel
 * never calls it; the spec's note band names that boundary.
 */

import type { Screen } from "./types";
import { SCREEN_SPECS } from "../../layout/spec";
import { renderSpecScreen } from "./render";

const spec = SCREEN_SPECS.find(s => s.id === "providers")!;

export const providersScreen: Screen = {
	id: "providers",
	label: "Providers",
	short: "Provider",
	status: "implemented",
	needs: ["providers", "rollupStatus"],
	render: ctx => renderSpecScreen(spec, ctx),
};
