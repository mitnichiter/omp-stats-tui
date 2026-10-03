import type { Screen } from "./types";
import { scaffold, sampleFooter } from "./placeholders";
import { statsIcon } from "../icons";
import { formatCost, formatDurationMs, compactTokens } from "../format";

const SAMPLE = [
	{ id: "example-request-1", model: "example/model-a", ms: 1111, tokens: 1234, cost: 1.11 },
	{ id: "example-request-2", model: "example/model-b", ms: 222, tokens: 222, cost: 0.22 },
	{ id: "example-request-3", model: "example/model-c", ms: 33333, tokens: 33333, cost: 3.33 },
];

/**
 * `recent` is a fixed-size list of the latest requests, not a window: the route
 * takes a limit rather than a range, so the screen's heading must not claim the
 * range covers it.
 */
export const requestsScreen: Screen = {
	id: "requests",
	label: "Requests",
	short: "Requests",
	status: "scaffolded",
	needs: ["recent"],
	reason: "scaffolded: the recent-records list is sample data until the row renderer lands",
	render: ctx =>
		scaffold(ctx, statsIcon(ctx.preset, "requests"), "Requests", [
			...SAMPLE.map(r =>
				[
					`  ${r.id.padEnd(20)}`,
					`${r.model.padEnd(18)}`,
					`${formatDurationMs(r.ms).padStart(9)}`,
					`${compactTokens(r.tokens).padStart(7)} tok`,
					`${formatCost(r.cost).padStart(9)}`,
				].join(""),
			),
			sampleFooter(ctx, SAMPLE.length),
			`  ${ctx.theme.fg("dim", "sample ids are example-request-1..3; real ids are opaque hashes")}`,
		]),
};
