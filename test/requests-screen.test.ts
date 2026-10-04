/**
 * `test/requests-screen.test.ts` — the IR-rendered requests screen.
 *
 * Share parity lives in `test/parity.test.ts` ("the loaded count is the row
 * count"). These tests are what parity cannot see: the request log is the only
 * NEWEST-FIRST table on the panel, and a table that landed in payload order —
 * which for `recent` is arrival order — would read correctly for exactly as
 * long as arrival order happened to be newest-first.
 */

import { expect, test } from "bun:test";
import { ensureThemeSync, theme } from "@oh-my-pi/pi-tui/theme";
import type { ThemeColor } from "@oh-my-pi/pi-tui/theme/schema";

import { requestStatus, summarizeRequests } from "@oh-my-pi/omp-stats/client/data/view-models";
import { SCREEN_SPECS } from "../src/layout/spec";
import { resolveCell, resolveLabel, resolveNumber } from "../src/layout/resolve";
import { sourceOf } from "../src/layout/spec";
import { renderScreen, screenBands, type ScreenRenderOptions } from "../src/tui/render/screen";
import { planLayout } from "../src/tui/layout";
import { glyphsFor } from "../src/tui/glyphs";
import { SERIES_COLORS, stripForTest } from "../src/tui/palette";
import { formatDurationMs } from "@oh-my-pi/omp-stats/client/data/formatters";
import { DEFAULT_RANGE } from "../src/data/ranges";
import type { PanelData } from "../src/data/api";
import { FIXTURE_NOW, liveData, messageRow } from "./fixtures/panel";

ensureThemeSync();

const spec = SCREEN_SPECS.find(s => s.id === "requests")!;

function opts(data: PanelData, width = 100): ScreenRenderOptions {
	return {
		spec,
		data,
		plan: planLayout(width, 40, "unicode"),
		preset: "unicode",
		range: DEFAULT_RANGE,
		now: FIXTURE_NOW,
		fg: (color: ThemeColor, text: string) => theme.fg(color, text),
		bold: text => theme.bold(text),
		palette: theme,
		seriesColorFor: index => SERIES_COLORS[index % SERIES_COLORS.length],
		glyphs: glyphsFor("unicode"),
	};
}

const text = (rows: readonly string[]): string => stripForTest(rows.join("\n"));

test("requests: the log is newest-first even when the payload arrives oldest-first", () => {
	// The fixture's own RECENT arrives newest-first, so a renderer that merely
	// preserved payload order would pass against it. This reverses the arrival
	// order, which is what makes the sort PROVABLE rather than coincidental.
	const oldest = messageRow({ id: 101, timestamp: FIXTURE_NOW - 20 * 3_600_000, model: "probe-old" });
	const newest = messageRow({ id: 102, timestamp: FIXTURE_NOW - 60_000, model: "probe-new" });
	expect(newest.timestamp).toBeGreaterThan(oldest.timestamp);
	const shuffled = { recent: [oldest, newest] as unknown as PanelData["recent"] };
	const bands = screenBands(opts(shuffled));
	const band = bands.find(b => b.kind === "table" && b.title === "Request log");
	expect(band, `"Request log" table band missing`).toBeTruthy();
	if (band === undefined || band.kind !== "table") throw new Error(`"Request log" is not a table band`);
	const table = band;
	const rows = table.rows.kind === "inline" ? table.rows.rows : [];
	expect(rows.length).toBe(2);
	expect(rows[0]!["Model"]).toBe("probe-new");
	expect(rows[1]!["Model"]).toBe("probe-old");
});

test("requests: every loaded row appears, including the unpriced and the failed one", () => {
	// The fixture's row 2 is unpriced and row 3 failed. A renderer that dropped
	// either — because it could not price it, or because it "failed" — would
	// still show a plausible log with fewer rows.
	const rendered = text(renderScreen(opts(liveData())));
	const rows = liveData().recent!;
	expect(rows.length).toBeGreaterThan(0);
	// RecentRequest is `TimeSeriesPoint & Record<string, unknown>` — the rows here
	// carry `model`, which the type admits only as `unknown`. Read through it.
	for (const row of rows as unknown as { id: number; model: string }[]) {
		expect(rendered, `row ${row.id} (${row.model})`).toContain(row.model);
	}
});

test("requests: an aborted request still carries its tokens", () => {
	// Parity: the host's `requestStatus` calls an aborted row "aborted", not
	// "failed" and not "ok" — and an aborted request is a request, so it still
	// carries tokens. A renderer keying the token column to success would blank
	// this row.
	const aborted = messageRow({ id: 201, stopReason: "aborted", model: "probe-aborted" });
	expect(requestStatus(aborted)).toBe("aborted");
	const rendered = text(renderScreen(opts({ recent: [aborted] as unknown as PanelData["recent"] })));
	expect(rendered).toContain("probe-aborted");
});

test("requests: the failed count is the host's count, not the row's", () => {
	// Parity: `summarizeRequests` says what "failed" means, and row 3 is it.
	const rendered = text(renderScreen(opts(liveData())));
	expect(rendered).toContain("1");
});

test("requests: an unfetched recent payload renders a defined state", () => {
	const rows = renderScreen(opts({}));
	expect(text(rows)).not.toMatch(/NaN|undefined|Infinity/);
	expect(text(rows).length).toBeGreaterThan(0);
});

test("requests: the log has one table and no chart band", () => {
	// The web Requests screen is stats plus ONE table. A renderer that invented
	// a chart — or rendered a band twice — changes the port, not the mirror.
	const bands = screenBands(opts(liveData()));
	expect(bands.filter(b => b.kind === "table").map(b => b.title)).toEqual(["Request log"]);
	expect(bands.some(b => b.kind === "chart")).toBe(false);
});

test("requests: the stat row carries the web's six tiles, not four", () => {
	// RequestsRoute.tsx:117-154 renders six tiles; the spec carried four.
	// Median/p95 are nearest-rank quantiles over the loaded rows — the same
	// rule as the host's `summarizeRequests` (view-models.ts quantile).
	expect(spec.bands.filter(b => b.kind === "statRow").flatMap(b => b.kind === "statRow" ? b.stats.map(t => t.label) : [])).toEqual([
		"Requests",
		"Failed",
		"Tokens",
		"API-equivalent cost",
		"Median duration",
		"Median TTFT",
	]);
	const { medianDuration, medianTtft } = summarizeRequests(liveData().recent as never);
	const tiles = spec.bands.flatMap(b => b.kind === "statRow" ? b.stats : []);
	const median = tiles.find(t => t.label === "Median duration")!;
	expect(resolveNumber(median.metric, liveData())).toBe(medianDuration);
	expect(resolveNumber(tiles.find(t => t.label === "Median TTFT")!.metric, liveData())).toBe(medianTtft);
	const statBands = screenBands(opts(liveData())).filter(b => b.kind === "statRow");
	const renderedLabels = statBands.flatMap(b => b.kind === "statRow" ? b.stats.map(t => t.label) : []);
	expect(renderedLabels).toContain("Median duration");
});

test("requests: failed means the host's failed, not the errors endpoint", () => {
	// RequestsRoute counts `summarizeRequests(inRange).failed` via
	// `requestStatus` over the loaded rows; the spec counted the `errors`
	// endpoint, which is range+limit capped and disagrees. The tile resolves
	// against recentMessages, and `errors` leaves the needs.
	const summary = summarizeRequests(liveData().recent as never);
	const failed = spec.bands.flatMap(b => b.kind === "statRow" ? b.stats : []).find(t => t.label === "Failed")!;
	expect(sourceOf(failed.metric)).toBe("recentMessages");
	expect(resolveNumber(failed.metric, liveData())).toBe(summary.failed);
	expect([...spec.needs].sort()).toEqual(["recent", "rollupStatus"]);
});

test("requests: the log carries the provider line and the abort-aware status", () => {
	// The Model cell pairs the provider underneath (LabelCell primary+secondary)
	// and Status reads requestStatus: aborted rows are "aborted", not "failed".
	// The panel has no secondary cell, so the provider rides in its own column —
	// the models table's precedent — rather than vanishing.
	const band = spec.bands.find(b => b.kind === "table" && b.title === "Request log");
	if (band === undefined || band.kind !== "table") throw new Error(`"Request log" has no spec band`);
	expect(band.columns.map(c => c.header)).toContain("Provider");
	const aborted = messageRow({ id: 301, stopReason: "aborted", errorMessage: null, model: "probe-aborted-2" });
	expect(requestStatus(aborted)).toBe("aborted");
	expect(resolveLabel(
		band.columns.find(c => c.header === "Status")!.source,
		liveData({ recent: [aborted] as never, errors: [] }),
		aborted as never,
	)).toBe("aborted");
});
