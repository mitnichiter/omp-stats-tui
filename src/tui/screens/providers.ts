import type { Screen } from "./types";
import { scaffold, sampleFooter } from "./placeholders";
import { statsIcon } from "../icons";

const SAMPLE = [
	{ provider: "example/provider-a", shareText: "sample 60%", window: "5h" },
	{ provider: "example/provider-b", shareText: "sample 30%", window: "5h" },
	{ provider: "example/provider-c", shareText: "sample 10%", window: "5h" },
];

/**
 * NO NEEDS, and that is the design rather than the state of the work.
 *
 * The only route that would answer this screen, /api/stats/provider-windows, calls
 * `getProviderWindowStats`, which does network I/O to each provider on every load.
 * The panel is a read-only view of what the database already holds and makes no
 * network call at all — not on select, not on refresh, not on the range change. A
 * screen that silently reaches out would spend the user's quota and stall on a
 * slow provider, both invisible from the panel.
 *
 * So this screen is scaffolded with a sample layout and will stay a sample until a
 * provider window is recorded locally by ingest, which is a separate decision.
 */
export const providersScreen: Screen = {
	id: "providers",
	label: "Providers",
	short: "Provider",
	status: "scaffolded",
	needs: [],
	reason:
		"no needs: /api/stats/provider-windows does network I/O to each provider on every load, and the panel never makes a network call",
	render: ctx =>
		scaffold(ctx, statsIcon(ctx.preset, "providers"), "Providers", [
			...SAMPLE.map(p =>
				`  ${p.provider.padEnd(24)}${p.window.padStart(4)}  ${p.shareText}`,
			),
			sampleFooter(ctx, SAMPLE.length),
			`  ${ctx.theme.fg("dim", "sample windows are invented: no provider was contacted to draw this screen")}`,
		]),
};
