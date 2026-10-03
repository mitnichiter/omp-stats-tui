import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { VERSION } from "@oh-my-pi/pi-coding-agent";

// The omp version this extension was built against. Every `@oh-my-pi/*` import
// below depends on host internals, so a host bump is the one failure mode that
// produces an obscure load error rather than a clear one. Warn loudly, on
// stderr (stdout is the TUI's), and still load — refusing to load would leave
// the user with a working omp and no explanation.
const PINNED = "18.4.10";

export default function (pi: ExtensionAPI): void {
	if (VERSION !== PINNED) {
		console.error(`[stats-tui] built against omp ${PINNED}, host is ${VERSION}`);
	}

	pi.registerCommand("stats-tui", {
		description: "Local usage stats, fullscreen",
		// PLACEHOLDER — Task 11 replaces this body with the mount seam
		// (ctx.ui.custom(..., { overlay: true, overlayOptions: { fullscreen: true } })).
		// Nothing is implemented yet; this task exists only to prove the plugin loads.
		handler: async () => {},
	});
}