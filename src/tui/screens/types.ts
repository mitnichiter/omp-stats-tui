import type { Theme } from "@oh-my-pi/pi-tui/theme";
import type { Range } from "../../data/ranges";
import type { DataNeed, PanelData } from "../../data/api";
import type { GlyphSet, SymbolPreset } from "../glyphs";
import type { LayoutPlan } from "../layout";

/**
 * Every dashboard screen, and every screen's data contract, in one closed set.
 * This module is DATA: a `Screen` record per screen and nothing else. There is no
 * switch over `ScreenId` anywhere in the panel, because a switch is a second place
 * to add a screen and the registry is the only place that should know one exists.
 */
export type ScreenId =
	| "overview"
	| "activity"
	| "models"
	| "costs"
	| "projects"
	| "requests"
	| "errors"
	| "tools"
	| "providers"
	| "gain"
	| "traces"
	| "frustration";

/**
 * - `implemented` — a real render body exists.
 * - `scaffolded` — the data contract is real, the body is labelled sample data.
 * - `excluded`   — deliberately not ported; `reason` says why.
 */
export type ScreenStatus = "implemented" | "scaffolded" | "excluded";

/**
 * Everything a screen is allowed to see. It carries a `Theme` and a `LayoutPlan`
 * rather than reading the singletons, which is what makes `render` pure: a screen
 * can be rendered headless, at any width, with no terminal attached.
 */
export interface ScreenContext {
	width: number;
	rows: number;
	range: Range;
	theme: Theme;
	preset: SymbolPreset;
	glyphs: GlyphSet;
	plan: LayoutPlan;
	data: PanelData;
	colorFor: (index: number) => (text: string) => string;
}

export interface Screen {
	id: ScreenId;
	/** Full name for headings. */
	label: string;
	/** Tab-strip label. Measured, not assumed: test/screens.test.ts pins this at 8 cells. */
	short: string;
	status: ScreenStatus;
	/**
	 * Exactly what this screen fetches, and nothing more. Empty means it fetches
	 * nothing — which for `providers` and the two excluded screens is a design
	 * decision, not an omission.
	 */
	needs: readonly DataNeed[];
	/**
	 * Why a screen is scaffolded or excluded, in the user's words. A tab with no
	 * stated reason is indistinguishable from a bug, so anything not `implemented`
	 * carries one.
	 */
	reason?: string;
	render(ctx: ScreenContext): readonly string[];
}

import { overviewScreen } from "./overview";
import { activityScreen } from "./activity";
import { modelsScreen } from "./models";
import { costsScreen } from "./costs";
import { projectsScreen } from "./projects";
import { requestsScreen } from "./requests";
import { errorsScreen } from "./errors";
import { toolsScreen } from "./tools";
import { providersScreen } from "./providers";
import { gainScreen } from "./gain";
import { tracesScreen } from "./traces";
import { frustrationScreen } from "./frustration";

/** Frozen, ordered, and the ONLY list of screens. Tab order is registry order. */
export const SCREENS: readonly Screen[] = Object.freeze([
	overviewScreen,
	activityScreen,
	modelsScreen,
	costsScreen,
	projectsScreen,
	requestsScreen,
	errorsScreen,
	toolsScreen,
	providersScreen,
	gainScreen,
	tracesScreen,
	frustrationScreen,
]);

/**
 * The three screens whose bodies Tasks 13-15 build. Declared here rather than
 * derived from `status`, because during that work an `implemented` screen may
 * still be showing a placeholder body and the panel needs to know which tabs are
 * unfinished.
 */
export const IMPLEMENTED_IDS = [
	"overview",
	"activity",
	"models",
] as const satisfies readonly ScreenId[];

/**
 * Lookup that THROWS on an unknown id rather than returning undefined. A silent
 * undefined reaches the tab strip and paints an empty body, which reads as "this
 * screen has no data" rather than as "this screen does not exist".
 *
 * Linear over twelve records on purpose: a derived `Record<ScreenId, Screen>`
 * would need a cast that erases the very exhaustiveness this lookup proves.
 */
export function screenById(id: ScreenId): Screen {
	const screen = SCREENS.find(s => s.id === id);
	if (!screen) throw new Error(`unknown screen id: ${String(id)}`);
	return screen;
}

export { PLACEHOLDER_MARKER, scaffold, sampleFooter, sampleBar, excluded } from "./placeholders";
