import type { Screen } from "./types";
import { scaffold, sampleFooter, sampleBar } from "./placeholders";
import { statsIcon } from "../icons";
import { formatCost, formatInteger } from "../format";

const SAMPLE_DAYS = [
	{ day: "example-01", cost: 12.34, requests: 1234, share: 0.9 },
	{ day: "example-02", cost: 6.06, requests: 606, share: 0.44 },
	{ day: "example-03", cost: 0, requests: 0, share: 0 },
	{ day: "example-04", cost: 3.03, requests: 303, share: 0.22 },
];

/** IMPLEMENTED status, placeholder body — the real activity screen is Task 14. */
export const activityScreen: Screen = {
	id: "activity",
	label: "Activity",
	short: "Activity",
	status: "implemented",
	needs: ["dailyActivity", "costs", "rollupStatus"],
	reason: "placeholder body; the real activity screen lands in Task 14",
	render: ctx =>
		scaffold(ctx, statsIcon(ctx.preset, "calendar"), "Activity", [
			...SAMPLE_DAYS.map(d =>
				[
					`  ${d.day.padEnd(12)}`,
					sampleBar(ctx, d.share, 24),
					`  ${formatCost(d.cost).padEnd(10)}`,
					`${formatInteger(d.requests)} req`,
				].join(""),
			),
			sampleFooter(ctx, SAMPLE_DAYS.length),
			`  ${ctx.theme.fg("dim", "example-day-03 is a sample zero: a real empty day must still occupy a cell")}`,
		]),
};
