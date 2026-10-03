import type { Screen } from "./types";
import { excluded } from "./placeholders";
import { statsIcon } from "../icons";

/**
 * Not ported (ADR 0004). A trace view is a cursor-anchored flamegraph: the reader
 * navigates by hovering a frame, and the width of a frame is its duration. A
 * terminal has no cursor to anchor to and no second channel for duration, so a
 * port would either drop the interaction that makes a flamegraph readable or
 * flatten it into a table that answers a different question. `needs` is empty
 * because there is nothing the panel should fetch for a screen it will not draw.
 */
export const tracesScreen: Screen = {
	id: "traces",
	label: "Traces",
	short: "Traces",
	status: "excluded",
	needs: [],
	reason:
		"excluded (ADR 0004): a cursor-anchored flamegraph has no terminal equivalent, and a static table would answer a different question",
	render: ctx => excluded(ctx, statsIcon(ctx.preset, "time"), "Traces", tracesScreen.reason!),
};
