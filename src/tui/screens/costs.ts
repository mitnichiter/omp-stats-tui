import type { Screen } from "./types";
import { scaffold, sampleFooter, sampleBar } from "./placeholders";
import { statsIcon } from "../icons";
import { formatInteger, costWithUnpriced } from "../format";

/** Sample values are deliberately round and obviously synthetic. */
const SAMPLE = [
	{ model: "example/model-a", cost: 111.11, requests: 1111, unpriced: 0, share: 0.82 },
	{ model: "example/model-b", cost: 22.22, requests: 222, unpriced: 0, share: 0.41 },
	{ model: "example/model-c", cost: 3.33, requests: 33, unpriced: 7, share: 0.14 },
	{ model: "example/model-d", cost: 0, requests: 7, unpriced: 7, share: 0 },
];

export const costsScreen: Screen = {
	id: "costs",
	label: "Costs",
	short: "Costs",
	status: "scaffolded",
	needs: ["costs"],
	reason: "scaffolded: the data contract is real, the body is sample data until the ranked-bar list lands",
	render: ctx =>
		scaffold(ctx, statsIcon(ctx.preset, "cost"), "Costs", [
			...SAMPLE.map(r =>
				[
					`  ${r.model.padEnd(22)}`,
					sampleBar(ctx, r.share),
					` ${costWithUnpriced(r.cost, r.unpriced).padEnd(24)}`,
					`${formatInteger(r.requests)} req`,
				].join(""),
			),
			sampleFooter(ctx, SAMPLE.length),
			`  ${ctx.theme.fg("dim", "the sample unpriced counts exercise the N/A path; they claim no total")}`,
		]),
};
