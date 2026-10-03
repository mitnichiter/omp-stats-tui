/**
 * `src/tui/screens/render.ts` — the registry's seam onto the pipeline.
 *
 * ONE rendering path, in two call shapes. The panel builds
 * `ScreenRenderOptions` inline per frame; a registry `Screen` must render from
 * a `ScreenContext`. Both construct the same object, so neither can drift from
 * the other: the plan, the data and the preset come from wherever the caller
 * already has them, and the theme, the colours and the clock are injected the
 * same way in both.
 */

import { ensureThemeSync, theme } from "@oh-my-pi/pi-tui/theme";
import type { ThemeColor } from "@oh-my-pi/pi-tui/theme/schema";

import type { ScreenSpec } from "../../layout/spec";
import { glyphsFor } from "../glyphs";
import { SERIES_COLORS } from "../palette";
import { renderScreen } from "../render/screen";
import type { ScreenContext } from "./types";

/**
 * Render a spec'd screen from a registry `ScreenContext`. The one place that
 * knows a registry entry's `ctx.plan` is already built, so this file never
 * calls `planLayout` — a second plan would be a second width, and the body
 * must never invent one.
 */
export function renderSpecScreen(spec: ScreenSpec, ctx: ScreenContext): readonly string[] {
	ensureThemeSync();
	return renderScreen({
		spec,
		data: ctx.data,
		plan: ctx.plan,
		preset: ctx.preset,
		range: ctx.range,
		now: Date.now(),
		fg: (color: ThemeColor, text: string) => theme.fg(color, text),
		bold: text => theme.bold(text),
		palette: theme,
		seriesColorFor: index => SERIES_COLORS[index % SERIES_COLORS.length],
		glyphs: glyphsFor(ctx.preset),
	});
}
