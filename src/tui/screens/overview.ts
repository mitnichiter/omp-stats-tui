import type { Screen } from "./types";
import { scaffold, sampleFooter, sampleBar } from "./placeholders";
import { statsIcon } from "../icons";
import { formatCost, formatInteger, compactTokens, formatPercent } from "../format";

/**
 * IMPLEMENTED status with a PLACEHOLDER body. The data contract below is the real
 * one — Task 13 replaces the body, not the needs — and the shape of the body is
 * the layout Task 13 is expected to land on, so the tab can be reviewed today.
 */
export const overviewScreen: Screen = {
	id: "overview",
	label: "Overview",
	short: "Overview",
	status: "implemented",
	needs: ["overview", "recent", "rollupStatus"],
	reason: "placeholder body; the real overview lands in Task 13",
	render: ctx =>
		scaffold(ctx, statsIcon(ctx.preset, "tokens"), "Overview", [
			`  ${ctx.theme.fg("dim", "example totals")}`,
			`  ${"requests".padEnd(16)}${formatInteger(11111)}`,
			`  ${"tokens".padEnd(16)}${compactTokens(2222200)}`,
			`  ${"cost".padEnd(16)}${formatCost(333.33)}`,
			`  ${"cache rate".padEnd(16)}${formatPercent(0.6667)}`,
			"",
			`  ${"example/session-sample".padEnd(24)}${sampleBar(ctx, 0.61)} ${formatPercent(0.61)}`,
			sampleFooter(ctx, 3),
		]),
};
