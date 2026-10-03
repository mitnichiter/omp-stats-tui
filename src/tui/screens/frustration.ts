import type { Screen } from "./types";
import { excluded } from "./placeholders";
import { statsIcon } from "../icons";

/**
 * Not ported (ADR 0004). Deciding a turn was frustrating means classifying it, and
 * classification here is a paid judge job run over transcripts the panel never
 * reads and would have to copy off disk. A panel that spends money and reads
 * session files to draw a chart is no longer read-only, and a score it cannot
 * recompute locally is not a fact it may assert. `needs` is empty because there is
 * nothing the panel should fetch for a screen it will not draw.
 */
export const frustrationScreen: Screen = {
	id: "frustration",
	label: "Frustration",
	short: "Frustr.",
	status: "excluded",
	needs: [],
	reason:
		"excluded (ADR 0004): classifying a turn as frustration is a paid judge job over transcripts this panel never reads",
	render: ctx =>
		excluded(ctx, statsIcon(ctx.preset, "warning"), "Frustration", frustrationScreen.reason!),
};
