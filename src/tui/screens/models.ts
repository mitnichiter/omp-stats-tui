import type { Screen } from "./types";
import { scaffold, sampleFooter, sampleBar } from "./placeholders";
import { statsIcon } from "../icons";
import { compactTokens, formatPercent } from "../format";

const SAMPLE_MODELS = [
	{ model: "example/model-a", tokens: 1110000, cacheRate: 0.8125, share: 0.88 },
	{ model: "example/model-b", tokens: 222000, cacheRate: 0.5, share: 0.4 },
	{ model: "example/model-c", tokens: 33000, cacheRate: 0.25, share: 0.12 },
	{ model: "example/model-d", tokens: 4400, cacheRate: 0, share: 0.03 },
];

/** IMPLEMENTED status, placeholder body — the real models screen is Task 15. */
export const modelsScreen: Screen = {
	id: "models",
	label: "Models",
	short: "Models",
	status: "implemented",
	needs: ["modelDashboard", "rollupStatus"],
	reason: "placeholder body; the real models screen lands in Task 15",
	render: ctx =>
		scaffold(ctx, statsIcon(ctx.preset, "models"), "Models", [
			...SAMPLE_MODELS.map(m =>
				[
					`  ${m.model.padEnd(20)}`,
					sampleBar(ctx, m.share),
					`  ${compactTokens(m.tokens).padStart(6)} tok`,
					`  cache ${formatPercent(m.cacheRate).padStart(6)}`,
				].join(""),
			),
			sampleFooter(ctx, SAMPLE_MODELS.length),
			`  ${ctx.theme.fg("dim", "sample cache rates are examples of the denominator, not measurements")}`,
		]),
};
