/**
 * `test/errors-screen.test.ts` — the IR-rendered errors screen, against the shared fixture.
 *
 * The deep figure parity already lives in `test/parity.test.ts` (F24: 4-vs-3
 * signatures via `groupErrorsBySignature`, 1-vs-2 models via `modelKey`). These
 * tests are about what parity cannot see: that the REGISTRY entry renders
 * through the pipeline rather than a hand-written scaffold body, so no second
 * grammar can drift from the spec.
 *
 * Fixtures are the shared `test/fixtures/panel.ts` live set — the same live
 * data the pipeline tests render.
 */

import { expect, test } from "bun:test";
import { ensureThemeSync, theme } from "@oh-my-pi/pi-tui/theme";
import type { ThemeColor } from "@oh-my-pi/pi-tui/theme/schema";

import { groupErrorsBySignature } from "@oh-my-pi/omp-stats/client/data/view-models";
import { modelKey } from "@oh-my-pi/omp-stats/client/data/colors";
import { SCREEN_SPECS } from "../src/layout/spec";
import { resolveNumber } from "../src/layout/resolve";
import { glyphsFor } from "../src/tui/glyphs";
import { renderScreen, type ScreenRenderOptions } from "../src/tui/render/screen";
import { planLayout } from "../src/tui/layout";
import { PALETTE, SERIES_COLORS, stripForTest } from "../src/tui/palette";
import { DEFAULT_RANGE } from "../src/data/ranges";
import type { PanelData } from "../src/data/api";
import { FIXTURE_NOW, ERRORS, liveData } from "./fixtures/panel";
import { errorsScreen } from "../src/tui/screens/errors";

ensureThemeSync();

const spec = SCREEN_SPECS.find(s => s.id === "errors")!;

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

test("errors: the registry entry defers to the spec's pipeline, not a scaffold body", () => {
	expect(errorsScreen.id).toBe("errors");
	expect(errorsScreen.status).toBe("implemented");
	expect(errorsScreen.reason).toBeUndefined();
	// The spec's needs, or the panel fetches what the body never reads.
	expect([...errorsScreen.needs]).toEqual([...spec.needs]);
});

test("errors: rendered rows name the HOST's normalised signatures, not raw strings", () => {
	// The shared ERRORS fixture is a single row, so there is nothing to
	// normalise against it. The F24 regression fixture proves the mechanism —
	// parity.test.ts at 4-vs-3, test/errors-sync.test.ts at render level —
	// using the host function directly. Here the assertion is the registry one:
	// the rendered body contains the host's normalised signature for the fixture
	// row, whatever it is, rather than a second implementation's idea of it.
	const groups = groupErrorsBySignature(ERRORS as never);
	expect(groups.length).toBeGreaterThan(0);
	const rows = errorsScreen.render({
		width: 100,
		rows: 40,
		range: DEFAULT_RANGE,
		theme,
		preset: "unicode",
		glyphs: glyphsFor("unicode"),
		plan: planLayout(100, 40, "unicode"),
		data: liveData(),
		colorFor: () => (t: string) => t,
	});
	const body = text(rows);
	for (const group of groups) {
		expect(body, group.signature).toContain(group.signature);
	}
});

test("errors: every rendered row fits its width across the 40..200 sweep", () => {
	for (let width = 40; width <= 200; width += 40) {
		for (const row of errorsScreen.render({
			width,
			rows: 40,
			range: DEFAULT_RANGE,
			theme,
			preset: "unicode",
			glyphs: glyphsFor("unicode"),
			plan: planLayout(width, 40, "unicode"),
			data: liveData(),
			colorFor: () => (t: string) => t,
		})) {
			expect(Bun.stringWidth(row), `w=${width}: ${row}`).toBeLessThanOrEqual(width);
		}
	}
});

test("errors: an empty failure list is an honest empty state, never NaN or undefined", () => {
	const data = { ...liveData(), errors: [] };
	const body = text(
		errorsScreen.render({
			width: 100,
			rows: 40,
			range: DEFAULT_RANGE,
			theme,
			preset: "unicode",
			glyphs: glyphsFor("unicode"),
			plan: planLayout(100, 40, "unicode"),
			data,
			colorFor: () => (t: string) => t,
		}),
	);
	expect(body).not.toContain("NaN");
	expect(body).not.toContain("undefined");
});

test("errors: affected models are model::provider identities, not bare names", () => {
	// The shared fixture has one provider-qualified identity; the 2-vs-1 mechanism
	// itself is pinned in parity.test.ts on its own fixture. Here the assertion is
	// that the rendered screen agrees with the host's own identity function.
	const expected = new Set(ERRORS.map(r => modelKey(r.model, r.provider))).size;
	expect(expected).toBe(1);
	const body = text(
		errorsScreen.render({
			width: 100,
			rows: 40,
			range: DEFAULT_RANGE,
			theme,
			preset: "unicode",
			glyphs: glyphsFor("unicode"),
			plan: planLayout(100, 40, "unicode"),
			data: liveData(),
			colorFor: () => (t: string) => t,
		}),
	);
	// The affected-model tile shows the host-derived count.
	expect(body.length).toBeGreaterThan(0);
	expect(body).toMatch(/Affected models[\s\S]*1/);
});

test("errors: the signatures table carries the web's Failures meter", () => {
	// ErrorsRoute.tsx buildGroupColumns: the fourth column is a MeterCell of
	// the group count against the largest group — the only in-table magnitude
	// cue. The spec carried three columns; the meter is the fourth.
	const band = spec.bands.find(b => b.kind === "table" && b.title === "Error signatures");
	if (band === undefined || band.kind !== "table") throw new Error(`"Error signatures" has no spec band`);
	expect(band.columns.map(c => c.header)).toContain("Failures");
	expect(band.columns.find(c => c.header === "Failures")!.cell).toBe("meter");
	expect(groupErrorsBySignature(ERRORS as never).length).toBeGreaterThan(0);
});

test("errors: failures group by model identity beside the signatures", () => {
	// ErrorsRoute.tsx:197-228 "By model" card: failures per modelKey(model,
	// provider), top 12, beside the signatures table. The spec had no band for
	// it; the IR carries it as a rankedBars chart over errorMessages grouped
	// by provider-qualified identity.
	const band = spec.bands.find(b => b.kind === "chart" && b.title === "Failures by model");
	expect(band, `"Failures by model" chart band missing`).toBeTruthy();
	if (band === undefined || band.kind !== "chart") throw new Error(`"Failures by model" is not a chart band`);
	expect(band.chart.series[0]?.metric).toMatchObject({ kind: "series", source: "errorMessages", groupBy: "model" });
});

test("errors: the signature meter matches the host's group count per row", () => {
	// The meter resolves row-scoped against the host's own groups: each row
	// reads its normalized signature's count, not a raw-string count.
	const first = ERRORS[0] as never;
	expect(resolveNumber(
		{ kind: "derived", name: "signatureFailures", op: "count", of: { kind: "aggregate", source: "errorMessages", field: "errorMessage" } },
		liveData(),
		first,
	)).toBe(groupErrorsBySignature(ERRORS as never)[0]!.count);
});
