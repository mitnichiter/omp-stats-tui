/**
 * `src/tui/footer.ts` — the panel's key hints, hand-rolled for the ANSI path.
 *
 * WHY HAND-ROLLED. `hintsRow` returns a `NativeNode`, so it is unusable
 * anywhere but the native renderer (F20: `native/overlay.ts:42-51`). `/settings`
 * hand-rolls its ANSI footer from `editorKey`/`editorKeys`/`formatKeyHint` and
 * joins with `" · "`; this does the same, and adds the one thing `/settings`'s
 * ANSI footer lacks: **keys and labels in different colours.** A dim key beside a
 * muted label reads as a sentence, where a single-colour hint reads as a wall.
 *
 * WHY `rawKeyHint` RATHER THAN A FORK. `rawKeyHint` reaches the theme singleton,
 * exactly as `getTabBarTheme` does. F23 §3.1 recommends accepting that rather
 * than forking, and the reasoning holds: it is the SAME singleton the host's own
 * footer uses, so it cannot disagree with the rest of the UI, and the whole of
 * `keybinding-hints.ts` is singleton-based — a local fork would fork the entire
 * hint vocabulary to change one line. The footer is per-frame and cheap.
 *
 * WHY THE HINTS ARE DATA. A footer built by concatenating strings is a footer
 * that drifts from the keymap: a key gets rebound, the hint does not, and the
 * panel advertises something it no longer does. {@link hintsFor} returns the keys
 * as `KeyName`s, so `test/tab-strip.test.ts` can round-trip every one of them
 * through `panelAction` and fail when a hint names an unbound key.
 *
 * PURE. The hint SET is a function of state; the colouring comes from an
 * injected `Theme`, so the module holds no singleton and loads before theme init.
 */

import { rawKeyHint } from "@oh-my-pi/pi-tui/chrome";
import type { Theme } from "@oh-my-pi/pi-tui/theme";
import type { KeyName } from "@oh-my-pi/pi-tui/key-hint-format";
import { truncateToWidth, visibleWidth } from "@oh-my-pi/pi-tui/utils";

/** One hint: the keys that do it, and what they do. */
export interface PanelHint {
	keys: readonly KeyName[];
	label: string;
}

/**
 * What the panel is doing, which decides which hints are worth the row.
 *
 * DERIVED, never stored: an `error` state shows a retry and a close, not a range
 * switch that would only discard the message the user has not read.
 */
export type HintMode = "idle" | "scrollable" | "syncing" | "error";

/**
 * The hints for a state, in the order they read.
 *
 * `scrollable` puts the scroll hint FIRST rather than in the middle. F23 §3.2's
 * argument: it is the one hint whose absence changes what the reader can DO, so
 * it belongs where the eye lands, and a footer that buries it mid-row teaches the
 * reader to skip the footer.
 *
 * EVERY KEY HERE IS BOUND BY `panelAction`. That is not a convention, it is an
 * assertion: `test/tab-strip.test.ts` maps each hint back to a raw key sequence
 * and fails if `panelAction` returns null. A hint for an unbound key is a lie the
 * user acts on.
 */
export function hintsFor(mode: HintMode): readonly PanelHint[] {
	const scroll: PanelHint = { keys: ["up", "down"], label: "scroll" };
	const screen: PanelHint = { keys: ["left", "right"], label: "screen" };
	const range: PanelHint = { keys: ["r"], label: "range" };
	const sync: PanelHint = { keys: ["s"], label: "sync" };
	const close: PanelHint = { keys: ["escape", "q"], label: "close" };

	switch (mode) {
		case "idle":
			return [screen, range, sync, close];
		case "scrollable":
			return [scroll, screen, range, sync, close];
		case "syncing":
			// No `s`: a sync is already running, so offering to start another is
			// offering a key that does nothing.
			return [screen, range, close];
		case "error":
			// Retry, not "range": the message on screen is the thing to act on.
			return [{ keys: ["s"], label: "retry sync" }, close];
	}
}

/**
 * The footer row.
 *
 * Hints are dropped from the RIGHT until the row fits, never truncated. A hint
 * that ends mid-word is worse than a shorter footer, and `truncateToWidth` on a
 * STYLED string can cut an escape sequence in half and leak the remainder as
 * literal text — which is why the fit is measured on the assembled row with
 * `visibleWidth` and the row is rebuilt after each drop.
 *
 * Returns `[]` rather than `undefined` for an empty hint set: a panel row is a
 * string, and `PanelRows` must never be handed nothing where a row is expected.
 */
export function footerHints(
	hints: readonly PanelHint[],
	theme: Theme,
	width = Number.POSITIVE_INFINITY,
): readonly string[] {
	if (hints.length === 0) return [];
	// One step quieter than either half, so the separator recedes instead of
	// reading as content.
	const separator = theme.fg("borderMuted", " · ");
	let kept = [...hints];
	while (kept.length > 0) {
		const row = kept.map(hint => rawKeyHint(hint.keys, hint.label)).join(separator);
		if (visibleWidth(row) <= width) return [row];
		kept = kept.slice(0, -1);
	}
	// Nothing fits: drop the row entirely rather than emit a truncated word.
	return [];
}

/**
 * Truncate a footer row that has already been composed — used when a caller has
 * exactly one row and needs it to fit rather than to vanish.
 */
export function clampFooter(row: string, width: number): string {
	return visibleWidth(row) > width ? truncateToWidth(row, width) : row;
}