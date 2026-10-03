import type { Screen } from "./types";
import { scaffold, sampleFooter, sampleBar } from "./placeholders";
import { statsIcon } from "../icons";
import { formatInteger } from "../format";

const SAMPLE = [
	{ tool: "example/read", calls: 900, share: 1 },
	{ tool: "example/edit", calls: 90, share: 0.1 },
	{ tool: "example/bash", calls: 9, share: 0.01 },
	{ tool: "example/never-called", calls: 0, share: 0 },
];

/**
 * Per-tool token and cost figures are SHARES of the assistant turn that asked for
 * them, not measurements of each call — one turn's usage is attributed across its
 * batch. So this screen ranks calls, and Task 16 must not print a per-call cost.
 */
export const toolsScreen: Screen = {
	id: "tools",
	label: "Tools",
	short: "Tools",
	status: "scaffolded",
	needs: ["tools"],
	reason: "scaffolded: the call ranking is sample data until it lands, and it must never print a per-call cost",
	render: ctx =>
		scaffold(ctx, statsIcon(ctx.preset, "tools"), "Tools", [
			...SAMPLE.map(t =>
				[`  ${t.tool.padEnd(24)}`, sampleBar(ctx, t.share), `  ${formatInteger(t.calls)} calls`].join(""),
			),
			sampleFooter(ctx, SAMPLE.length),
			`  ${ctx.theme.fg("dim", "example/never-called is a sample zero: a zero row must still be visible")}`,
		]),
};
