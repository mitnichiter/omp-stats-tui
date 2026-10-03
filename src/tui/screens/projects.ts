/**
 * `src/tui/screens/projects.ts` — registry entry, and nothing else.
 *
 * A spec'd screen's registry entry carries identity and contract and defers
 * `render` to the pipeline; see `costs.ts` for why a body here would be a
 * second grammar for the same screen.
 *
 * `folders` groups by working directory, which is the one grouping the panel
 * can present without inventing a project concept the host does not have.
 */

import type { Screen } from "./types";
import { SCREEN_SPECS } from "../../layout/spec";
import { renderSpecScreen } from "./render";

const spec = SCREEN_SPECS.find(s => s.id === "projects")!;

export const projectsScreen: Screen = {
	id: "projects",
	label: "Projects",
	short: "Projects",
	status: "implemented",
	needs: ["folders", "rollupStatus"],
	render: ctx => renderSpecScreen(spec, ctx),
};
