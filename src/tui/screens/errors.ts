import type { Screen } from "./types";
import { scaffold, sampleFooter } from "./placeholders";
import { statsIcon } from "../icons";
import { formatPercent } from "../format";

const SAMPLE = [
	{ kind: "example/rate-limit", count: 7, sampleShare: 0.7 },
	{ kind: "example/overloaded", count: 2, sampleShare: 0.2 },
	{ kind: "example/context-length", count: 1, sampleShare: 0.1 },
];

/**
 * An error is a REQUEST that failed, so this screen shares `recent`'s shape and
 * reads the errors route, which takes a range. A failed request still costs time
 * and may still carry tokens — it is not free, it is unmeasured.
 */
export const errorsScreen: Screen = {
	id: "errors",
	label: "Errors",
	short: "Errors",
	status: "scaffolded",
	needs: ["errors"],
	reason: "scaffolded: the failure breakdown is sample data until it can print its own real total",
	render: ctx =>
		scaffold(ctx, statsIcon(ctx.preset, "errors"), "Errors", [
			...SAMPLE.map(e =>
				[
					`  ${e.kind.padEnd(26)}`,
					`${String(e.count).padStart(4)}`,
					`  ${formatPercent(e.sampleShare, 0)} of a sample total`,
				].join(""),
			),
			sampleFooter(ctx, SAMPLE.length),
			`  ${ctx.theme.fg("dim", "sample shares are of a made-up total, so the real screen must print its own")}`,
		]),
};
