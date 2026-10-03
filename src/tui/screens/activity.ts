/**
 * Activity — where the calendar heatmap lives.
 *
 * The heatmap answers "when was I busy"; the bars below it answer "how much".
 * They are the same data read two ways, and showing only one is a real loss: a
 * calendar makes a pattern across weeks visible that a bar chart of the same
 * window hides, and a bar chart makes magnitude within the window visible that
 * colour alone cannot.
 *
 * ── The data problem, stated plainly ─────────────────────────────────────────
 *
 * `fetchDailyActivity` is the ONE query in this panel that is not rollup-backed:
 * it scans the raw `messages` table. Measured on this database: **88.8 / 87.6 /
 * 85.9 ms warm**, and 606.2 ms on the first call in a process because that one
 * carries `initDb()` as well (F16). A day-windowed call is cheaper still — 12.9 ms
 * for 7 days — so the window the screen asks for is the dominant term.
 *
 * That is 85-600 ms of SYNCHRONOUS `bun:sqlite` on the thread that paints this
 * panel, and it is why `dailyActivity` is declared as its own `DataNeed` rather
 * than folded into another call: it fetches independently of the cheap
 * rollup-backed reads, so nothing else has to wait on the scan's duration.
 *
 * ⚠ PER-NEED LOADING IS NOT SUPPORTED YET, and this screen does not fake it.
 * `src/tui/panel.ts` has a single all-or-nothing phase — `state.data !== null ?
 * "ready" : "loading"` — so the panel paints nothing until EVERY declared need
 * has resolved. The 85 ms therefore blocks the whole first paint today. Until
 * the panel grows a per-need phase, the "absent payload" branch below is the path
 * that will actually run in production; it is written and tested now so that path
 * is already correct when the panel does grow one.
 */

import type { DailyActivityPoint } from "@oh-my-pi/omp-stats/shared-types";
import type { Screen, ScreenContext } from "./types";
import { renderHeatmap, weeksForWidth } from "../charts/heatmap";
import { renderDailyBars } from "../charts/bars";
import { statsIcon, type IconRole } from "../icons";
import { costWithUnpriced, formatInteger, compactTokens } from "../format";
import type { GlyphValue } from "../glyphs";

/** Rows the daily-bars block gets. Small: the calendar is the star, not the bars. */
const BAR_HEIGHT = 6;

/** Number of intensity levels in the ramp, matching the chart layer. */
const HEAT_LEVELS = 4;

const DAY_MS = 86_400_000;

/**
 * A single cell painted through `colorFor` and then stripped back out, leaving
 * only the escape sequence that sets the level's colour. Cheaper and less fragile
 * than asking the context for raw hex, and it keeps colour maths out of the
 * screen entirely.
 */
const PROBE = "x";

/**
 * Truncate to `width` cells, measured rather than counted — ANSI escapes from a
 * styling callback make `text.length` the wrong measure. Same clamp as overview.
 */
function clamp(text: string, width: number): string {
	let visible = 0;
	let out = "";
	for (let i = 0; i < text.length; ) {
		if (text[i] === "\x1b") {
			const end = text.indexOf("m", i);
			const stop = end === -1 ? text.length : end + 1;
			out += text.slice(i, stop);
			i = stop;
			continue;
		}
		if (visible >= width) break;
		out += text[i];
		visible++;
		i++;
	}
	return out;
}

const dim = (ctx: ScreenContext): ((t: string) => string) =>
	ctx.theme.fg.bind(ctx.theme, "dim") as (t: string) => string;

function heading(ctx: ScreenContext, role: IconRole, label: string): string {
	return ctx.theme.fg("accent", statsIcon(ctx.preset, role)) + ctx.theme.bold(` ${label}`);
}

/** One rung of a ladder in the caller's GlyphSet, or the value itself. */
function rung(value: GlyphValue, level: number): string {
	if (typeof value === "string") return value;
	return value[Math.max(0, Math.min(value.length - 1, level))] ?? value[0];
}

interface DailyTotals {
	cost: number;
	requests: number;
	tokens: number;
	unpriced: number;
	/** Cost per local ISO date, for the bars. */
	byDay: Map<string, number>;
	busiest: { day: string; cost: number } | null;
}

/**
 * Totals over the window.
 *
 * Only days that HAVE activity produce an entry, because the host's query emits
 * rows for active days only — exactly like Crush. That is precisely why the
 * calendar must zero-fill: the missing days are real, quiet days, not absent
 * data, and a renderer that trusted its input would drop them from the axis.
 */
function tally(points: readonly DailyActivityPoint[]): DailyTotals {
	const byDay = new Map<string, number>();
	let cost = 0;
	let requests = 0;
	let tokens = 0;
	let unpriced = 0;
	let busiest: { day: string; cost: number } | null = null;

	for (const point of points) {
		const dayCost = point.cost ?? 0;
		const dayRequests = point.requests ?? 0;
		byDay.set(point.day, (byDay.get(point.day) ?? 0) + dayCost);
		cost += dayCost;
		requests += dayRequests;
		tokens += point.totalTokens ?? 0;
		// An unpriced request is UNKNOWN SPEND, not free spend. Counting it is what
		// lets the summary render N/A beside the cost instead of a confident $0.00.
		if (dayRequests > 0 && dayCost === 0) unpriced += dayRequests;
		if (dayCost > 0 && (!busiest || dayCost > busiest.cost)) {
			busiest = { day: point.day, cost: dayCost };
		}
	}
	return { cost, requests, tokens, unpriced, byDay, busiest };
}

/**
 * The legend. Without thresholds a colour is decoration — the reader cannot tell
 * whether a mid-tone day was a hundred requests or ten thousand.
 */
function legend(ctx: ScreenContext): readonly string[] {
	const swatches = [0, 1, 2, 3].map(level =>
		ctx.colorFor(level)(rung(ctx.glyphs.heatCell, level)),
	);
	return [
		clamp(
			`  ${dim(ctx)("less")} ${swatches.join("")} ${dim(ctx)("more")}` +
				`   ${dim(ctx)(`bucketed at 25/50/75/100% of the busiest day`)}` +
				`   ${dim(ctx)(rung(ctx.glyphs.heatEmpty, 0))} ${dim(ctx)("= no requests")}`,
			ctx.plan.innerWidth,
		),
	];
}

export const activityScreen: Screen = {
	id: "activity",
	label: "Activity",
	short: "Activity",
	status: "implemented",
	// `dailyActivity` is the slow raw-table scan, declared on its own so it fetches
	// independently of the cheap rollup-backed reads. `costs` and `rollupStatus`
	// back the summary and the freshness line.
	needs: ["dailyActivity", "costs", "rollupStatus"],
	render: (ctx): readonly string[] => {
		const width = Math.max(0, ctx.plan.innerWidth);
		const points = ctx.data.dailyActivity;

		// ABSENT PAYLOAD is not the same as an empty range. `fetchDailyActivity` is
		// the slow query and may not have arrived, or may have failed. An EMPTY GRID
		// would read as "you did nothing this year", which is a lie about someone's
		// usage and the worst thing this screen could render.
		if (!points) {
			return [
				heading(ctx, "calendar", "Activity"),
				"",
				clamp(`  ${dim(ctx)("Usage history unavailable.")}`, width),
				clamp(`  ${dim(ctx)("Daily activity is still loading, or the query failed.")}`, width),
			];
		}

		const totals = tally(points);

		// EMPTY IS AN HONEST STATE. No rows at all is "nothing recorded", and it is
		// stated rather than drawn as a field of zero-day cells that reads as a
		// quiet year. Review Focus line 3.
		if (points.length === 0) {
			return [
				heading(ctx, "calendar", "Activity"),
				"",
				clamp(`  ${dim(ctx)("No activity recorded.")}`, width),
			];
		}

		const { busiest } = totals;
		const lines: string[] = [
			heading(ctx, "calendar", "Activity"),
			// The summary answers what the calendar cannot: how much in total, how
			// many requests, and which single day was the worst.
			clamp(
				`  ${costWithUnpriced(totals.cost, totals.unpriced)}` +
					`   ${dim(ctx)(`${formatInteger(totals.requests)} requests`)}` +
					`   ${dim(ctx)(`${compactTokens(totals.tokens)} tokens`)}` +
					(busiest
						? `   ${dim(ctx)(`busiest ${busiest.day} · ${formatInteger(busiest.cost)}`)}`
						: ""),
				width,
			),
			"",
		];

		// The calendar. Weeks come from this module's ladder, so a narrow terminal
		// loses WINDOW, never cell size: a sub-cell calendar is unreadable and
		// cannot be redrawn at a different cell size later.
		const weeks = weeksForWidth(ctx.plan.labelWidth, width);
		lines.push(
			...renderHeatmap(points, {
				innerWidth: width,
				labelWidth: ctx.plan.labelWidth,
				weeks,
				glyphs: ctx.glyphs,
				// Four colour stops for levels 1..4. Level 0 deliberately gets none: a
				// day with no activity must read as empty, not as the faintest colour.
				ramp: Array.from({ length: HEAT_LEVELS }, (_, i) =>
					ctx.colorFor(i + 1)(PROBE).replace(PROBE, ""),
				),
				today: new Date(),
			}).map(row => clamp(row, width)),
		);
		lines.push(...legend(ctx));

		// The same cost, read as magnitude within the window.
		lines.push("");
		lines.push(clamp(`  ${ctx.theme.fg("accent", "Daily cost")}`, width));
		lines.push(
			...renderDailyBars(
				[...totals.byDay.entries()]
					.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
					.map(([, cost]) => cost),
				{
					width: Math.max(0, width - 2),
					height: BAR_HEIGHT,
					glyphs: ctx.glyphs,
					accent: ctx.theme.fg.bind(ctx.theme, "accent") as (t: string) => string,
					dim: dim(ctx),
				},
			).map(row => clamp(` ${row}`, width)),
		);

		return lines;
	},
};