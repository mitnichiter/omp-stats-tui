import type { Screen } from "./types";
import { scaffold, sampleFooter, sampleBar } from "./placeholders";
import { statsIcon } from "../icons";
import { formatCost, formatPercent } from "../format";

const SAMPLE = [
	{ model: "example/model-a", savings: 11.11, baseline: 111.11, sampleRate: 0.1 },
	{ model: "example/model-b", savings: 0.22, baseline: 22.22, sampleRate: 0.01 },
	{ model: "example/model-c", savings: -0.33, baseline: 3.33, sampleRate: -0.1 },
];

/**
 * Cache savings is a RATIO, not a token count, and it goes negative when cache
 * writes cost more than cache reads save. The sample keeps one negative row so the
 * layout for that case is reviewable before the real number arrives.
 *
 * The screen declares `costs` because the figure is derived from the cost payload,
 * but the definitive gain payload lives in `snapcompact-savings.jsonl` off disk,
 * and reading an unprovenanced file from a render path is not a thing this panel
 * does. Deferred until that file's provenance is settled.
 */
export const gainScreen: Screen = {
	id: "gain",
	label: "Gain",
	short: "Gain",
	status: "scaffolded",
	needs: ["costs"],
	reason:
		"deferred: the authoritative gain payload is snapcompact-savings.jsonl read off disk, and its provenance is not yet settled",
	render: ctx =>
		scaffold(ctx, statsIcon(ctx.preset, "gains"), "Gain", [
			...SAMPLE.map(g =>
				[
					`  ${g.model.padEnd(20)}`,
					sampleBar(ctx, Math.max(0, g.sampleRate), 16),
					`  saved ${formatCost(Math.abs(g.savings)).padEnd(10)}`,
					`of ${formatCost(g.baseline)}  ${formatPercent(g.sampleRate)}`,
				].join(""),
			),
			sampleFooter(ctx, SAMPLE.length),
			`  ${ctx.theme.fg("dim", "example/model-c is a sample negative: cache savings is a ratio and can be below zero")}`,
		]),
};
