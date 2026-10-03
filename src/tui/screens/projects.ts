import type { Screen } from "./types";
import { scaffold, sampleFooter, sampleBar } from "./placeholders";
import { statsIcon } from "../icons";
import { formatCost, formatInteger } from "../format";

const SAMPLE = [
	{ folder: "example/one", requests: 4444, cost: 44.44, share: 1 },
	{ folder: "example/two", requests: 333, cost: 3.33, share: 0.25 },
	{ folder: "example/three", requests: 22, cost: 0.22, share: 0.02 },
];

/**
 * `folders` groups by working directory, which is the one grouping the panel can
 * present without inventing a project concept the host does not have.
 */
export const projectsScreen: Screen = {
	id: "projects",
	label: "Projects",
	short: "Projects",
	status: "scaffolded",
	needs: ["folders"],
	reason: "scaffolded: groups by working directory, the one grouping the host records without inventing a project concept",
	render: ctx =>
		scaffold(ctx, statsIcon(ctx.preset, "projects"), "Projects", [
			...SAMPLE.map(p =>
				[
					`  ${p.folder.padEnd(18)}`,
					sampleBar(ctx, p.share),
					`  ${formatCost(p.cost).padEnd(10)}`,
					`${formatInteger(p.requests)} req`,
				].join(""),
			),
			sampleFooter(ctx, SAMPLE.length),
		]),
};
