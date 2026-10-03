/**
 * `src/layout/resolve.ts` — an IR value, made real.
 *
 * WHY THIS MODULE EXISTS. `MetricRef` is a DECLARATION: it names a value and
 * says nothing about how the value reads. That separation is what lets one
 * screen show a cost as a headline and another show the same cost as a table
 * cell without either hard-coding the other's choice. But a declaration that
 * nothing fulfils is a comment, so this module is where the declaration meets
 * a `PanelData` and produces a number or a string.
 *
 * THE ONE RULE THAT SHAPES EVERYTHING HERE: a value that cannot be resolved is
 * `null`, never `undefined`, never `NaN`, never `"undefined"`. An unresolvable
 * ref produces a BLANK CELL, and a blank cell is invisible — the screen still
 * renders, still looks plausible, and the reader never learns a figure is
 * missing. That is the failure this project has already paid for once (the
 * no-catalog-card model reading `$0.00` for $935 of real spend). So the return
 * type carries `null` explicitly, every arithmetic path guards its divisor, and
 * `test/resolve.test.ts` walks EVERY ref in EVERY spec against a fixture shaped
 * like the real route response. An unresolvable ref is a test failure naming
 * the screen and the path, not a blank cell a human has to notice.
 *
 * `NEED_BY_SOURCE` decides fetchability, and it is the IR's own table rather
 * than a second one here. `explainUnresolved` uses it to say WHICH of three
 * very different failures it is looking at:
 *
 *   1. `providerStats` — no need fills it (its route does network I/O). The
 *      screen is `deferred`, and a blank cell there is the honest answer.
 *   2. the need was never fetched — a WIRING bug. `fetchFor` never asked, so
 *      "no data" here means "not asked", which is not the same as "nothing
 *      happened" and must not be painted as an empty range.
 *   3. the need was fetched and the payload is empty — the real, honest zero.
 *
 * PURE. No I/O, no theme, no database, no clock. Everything here is a function
 * of `(MetricRef, PanelData)` plus an optional row scope, which is what makes it
 * testable without a terminal and without a 321 MB database.
 */

import type { DataNeed, PanelData } from "../data/api";
import {
	NEED_BY_SOURCE,
	sourceOf,
	type AggregateRef,
	type DerivedRef,
	type LabelRef,
	type MetricRef,
	type MetricSource,
	type SeriesRef,
} from "./spec";

/** A payload row. Heterogeneous by nature — the IR names fields by string, so a
 *  row is only ever read through {@link readPath}, never indexed directly. */
export type DataRow = object;

/** Every kind of ref, minus the derived wrapper. What a resolution bottoms out in. */
export type BaseRef = AggregateRef | SeriesRef | LabelRef;

/**
 * What a ref resolves to. `null` means ABSENT, and it is a distinct case from
 * every other value on purpose:
 *
 *  - `null` is never rendered as text. `resolveCell` returns it, the caller
 *    emits an empty cell, and `explainUnresolved` explains why.
 *  - `0` is a MEASURED value and is rendered as `0`.
 *
 * Conflating them is how an unmeasured model reads as a free one.
 */
export type Resolved = number | string | null;

// ─── Reading the payload ─────────────────────────────────────────────────────

/**
 * Every row a source carries, or `[]`.
 *
 * ONE ROW ARRAY PER SOURCE, ALWAYS. `overall` and `rollupStatus` are single
 * objects, and every array source may be empty; normalising both to a list is
 * what lets `resolveNumber` and friends share one code path instead of a branch
 * per source shape. An absent payload is `[]` and NOT an exception — the panel
 * reaches this with a database that was never initialised, and a throw here
 * would blank the whole panel rather than one cell.
 */
export function rowsFor(source: MetricSource, data: PanelData): readonly DataRow[] {
	switch (source) {
		case "overall":
		case "rollupStatus":
			return singleRow(payloadFor(source, data));
		case "byAgentType":
		case "timeSeries":
			return asRows(data.overview?.[source === "byAgentType" ? "byAgentType" : "timeSeries"]);
		case "byModel":
		case "modelSeries":
		case "modelPerformanceSeries":
			return asRows(data.modelDashboard?.[source]);
		case "costSeries":
			return asRows(data.costs?.costSeries);
		case "folders":
			return asRows(data.folders);
		case "recentMessages":
			return asRows(data.recent);
		case "errorMessages":
			return asRows(data.errors);
		case "toolsByTool":
			return asRows(data.tools?.byTool);
		case "toolsByToolModel":
			return asRows(data.tools?.byToolModel);
		case "toolsSeries":
			return asRows(data.tools?.series);
		case "dailyActivity":
			return asRows(data.dailyActivity);
		// `providerStats` is deliberately absent: `/api/stats/provider-windows`
		// does network I/O on every load and this panel makes no network call.
		case "providerStats":
			return [];
	}
}

/** The payload a single-object source carries, or `undefined`. */
function payloadFor(source: MetricSource, data: PanelData): DataRow | undefined {
	if (source === "overall") return data.overview?.overall as DataRow | undefined;
	if (source === "rollupStatus") return data.rollupStatus as DataRow | undefined;
	return undefined;
}

/** One object becomes a one-element list; an absent value becomes an empty list. */
function singleRow(row: DataRow | undefined): readonly DataRow[] {
	return row ? [row] : [];
}

function asRows(value: readonly unknown[] | undefined): readonly DataRow[] {
	return Array.isArray(value) ? (value as readonly DataRow[]) : [];
}

// ─── Fetchability ────────────────────────────────────────────────────────────

/**
 * Which fetch fills this ref, or `null` when nothing can.
 *
 * Delegates to `NEED_BY_SOURCE` rather than restating it, so a source added to
 * the IR's table is fetchable here the moment it lands. `null` is NOT an error:
 * it is `providerStats`, whose route does network I/O, and the screen that
 * names it is marked `deferred` for exactly this reason.
 */
export function metricNeed(ref: MetricRef): DataNeed | null {
	return NEED_BY_SOURCE[sourceOf(ref)] ?? null;
}

/**
 * Did the panel actually ask for this source?
 *
 * The distinction the panel's correctness rests on. A source that was never
 * fetched means `fetchFor` never issued the query — a wiring bug, which must
 * be reported rather than painted as an empty range. A source that WAS fetched
 * and came back empty means nothing happened in the window, which is a real
 * answer. Both look identical to `rowsFor`, and only this function can tell
 * them apart.
 */
export function isFetched(source: MetricSource, data: PanelData): boolean {
	const need = NEED_BY_SOURCE[source];
	if (need === null) return false;
	switch (need) {
		case "overview":
			return data.overview !== undefined;
		case "modelDashboard":
			return data.modelDashboard !== undefined;
		case "costs":
			return data.costs !== undefined;
		case "folders":
			return data.folders !== undefined;
		case "recent":
			return data.recent !== undefined;
		case "errors":
			return data.errors !== undefined;
		case "tools":
			return data.tools !== undefined;
		case "dailyActivity":
			return data.dailyActivity !== undefined;
		case "rollupStatus":
			return data.rollupStatus !== undefined;
	}
}

/**
 * Why a ref could not be resolved, in one clause. `""` when it DID resolve, so
 * a caller can accumulate failures by filtering on emptiness.
 *
 * Exported because the only way to hold a resolver to "no invisible blanks" is
 * to make the reason printable, and `test/resolve.test.ts` prints it in every
 * failure message. A blank cell with no stated cause is exactly the bug.
 */
export function explainUnresolved(ref: MetricRef, data: PanelData, row?: DataRow): string {
	if (resolveCell(ref, data, row) !== null) return "";
	const source = sourceOf(ref);
	if (NEED_BY_SOURCE[source] === null) {
		return `source "${source}" has no DataNeed — ${NEED_BY_SOURCE[source] === null ? "its route does network I/O" : ""}`;
	}
	if (!isFetched(source, data)) {
		return `source "${source}" is mapped to need "${NEED_BY_SOURCE[source]}" but that payload is absent from PanelData — not fetched`;
	}
	return `source "${source}" was fetched and is empty — nothing recorded for "${leafField(ref)}"`;
}

/** The field a ref bottoms out in, following `derived` to its base. */
function leafField(ref: MetricRef): string {
	return ref.kind === "derived" ? leafField(ref.of) : ref.field;
}

/** The innermost non-derived ref: what the arithmetic actually operates on. */
function baseOf(ref: MetricRef): BaseRef {
	return ref.kind === "derived" ? baseOf(ref.of) : ref;
}

// ─── Reading a field ─────────────────────────────────────────────────────────

/**
 * A dotted path into a row. `"usage.cost.total"` is legal, and every segment
 * after the first is the IR's own promise about the payload's shape.
 *
 * Returns `undefined` for a missing segment rather than throwing: a field the
 * payload does not have is a spec/payload disagreement, and the caller's job
 * is to report it, not to crash a render pass over it.
 */
function readPath(row: DataRow | undefined, path: string): unknown {
	if (row === undefined || row === null) return undefined;
	let node: unknown = row;
	for (const key of path.split(".")) {
		if (node === null || typeof node !== "object") return undefined;
		node = (node as Record<string, unknown>)[key];
	}
	return node;
}

/** A finite number, or `null`. `NaN` and `Infinity` are failures, not values. */
function asNumber(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value)) return null;
	return value;
}

/** Non-empty text, or `null`. A numeric field read as a label is `null`. */
function asLabel(value: unknown): string | null {
	if (typeof value !== "string" || value === "") return null;
	return value;
}

// ─── Base resolution ─────────────────────────────────────────────────────────

/**
 * The value of a non-derived ref.
 *
 * `AggregateRef` and `LabelRef` read ONE row: the first when unscoped, the
 * supplied one when the caller is inside a table. `SeriesRef` is a DIFFERENT
 * KIND of answer — a whole series, not a figure — so it resolves through
 * {@link resolveSeriesValues} and sums to a scalar here. That asymmetry is the
 * IR's own: a table cell reads a cell, a stat tile needs a number.
 */
function resolveBase(ref: BaseRef, data: PanelData, row?: DataRow): Resolved {
	const rows = row !== undefined ? [row] : rowsFor(ref.source, data);

	if (ref.kind === "series") {
		// A `SeriesRef` resolved to a scalar is its TOTAL. A stat tile reading
		// `timeSeries("cost")` means "cost over the window"; the per-bucket values
		// belong to {@link resolveSeriesValues}.
		const values = seriesValues(ref, data, row);
		return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0);
	}

	const value = readPath(rows[0], ref.field);
	if (ref.kind === "label") return asLabel(value);
	// `aggregate` does NOT insist on a number. The IR names text fields with it
	// (`recentMessages.model`, `recentMessages.provider`) while `label` names the
	// same idea elsewhere, and a resolver answering `null` for a field that plainly
	// holds a model name would paint a blank cell for a value it has. Arithmetic
	// callers narrow through {@link resolveNumber}, the only place the
	// number-vs-text distinction actually matters.
	return asNumber(value) ?? asLabel(value);
}

/** The rows a grouped `SeriesRef` covers, narrowed to `row`'s own group. */
function seriesRows(ref: SeriesRef, data: PanelData, row?: DataRow): readonly DataRow[] {
	const rows = rowsFor(ref.source, data);
	if (!ref.groupBy || row === undefined) return rows;
	const group = readPath(row, ref.groupBy);
	if (typeof group !== "string") return [];
	// A row-scoped SeriesRef is the TREND FOR THAT ROW: the models table's
	// `Trend` column must draw each model's own sparkline, not the payload's.
	return rows.filter(candidate => readPath(candidate, ref.groupBy ?? "") === group);
}

function seriesValues(ref: SeriesRef, data: PanelData, row?: DataRow): readonly number[] {
	const values: number[] = [];
	for (const candidate of seriesRows(ref, data, row)) {
		const value = asNumber(readPath(candidate, ref.field));
		// A gap is skipped, not zero-filled: zero would draw a row the payload
		// never reported, and the charts scale by maximum.
		if (value !== null) values.push(value);
	}
	return values;
}

// ─── Derived resolution ───────────────────────────────────────────────────────

/**
 * A derived value: the four ops the IR names, each with its own guard.
 *
 * Every divisor is checked and every empty source answers 0. Those two guards
 * are the whole reason this function exists as a `switch` rather than four
 * one-line expressions: `0 / 0` is `NaN`, `NaN` prints as the literal text
 * `NaN` inside a stat tile, and a stat tile reading `NaN%` is a bug a user
 * reports rather than one a test catches later.
 */
function resolveDerived(ref: DerivedRef, data: PanelData, row?: DataRow): number | null {
	const base = baseOf(ref);
	// `conversationTokens` is the one derived that sums FOUR token kinds rather
	// than the two its `of`/`against` name, because the IR declares it by name
	// and the header comment in spec.ts states what it means: uncached input +
	// cache reads + cache writes + output. A single "total tokens" figure is
	// 95.5% cache reads in this database and describes nothing.
	if (ref.name === "conversationTokens") return sumTokenKinds(base, data, row);

	switch (ref.op) {
		case "sum":
			// A `sum` is a sum ACROSS ROWS. Its base is an `AggregateRef`, which on
			// its own reads only the FIRST row, so resolving the base directly would
			// answer "total cost across every model" with the first model's cost —
			// the one figure a per-model table is least able to detect.
			return sumOverRows(baseOf(ref.of), data, row);
		case "count": {
			const rows = row !== undefined ? [row] : rowsFor(base.source, data);
			if (base.kind === "label" && row === undefined) {
				// "Distinct tools" / "affected models" counts DISTINCT values, not
				// rows: a payload with two rows per tool has three tools.
				const seen = new Set<string>();
				for (const candidate of rows) {
					const value = asLabel(readPath(candidate, base.field));
					if (value !== null) seen.add(value);
				}
				return seen.size;
			}
			return rows.length;
		}
		case "share": {
			if (!ref.against) return null;
			const numerator = resolveNumber(ref.of, data, row);
			const denominator = resolveNumber(ref.against, data, row);
			if (numerator === null || denominator === null) return null;
			// A measured zero denominator is 0, never Infinity. Every call failing
			// at once is "no calls happened", which is 0% and not a crash.
			return denominator === 0 ? 0 : numerator / denominator;
		}
		case "max": {
			const base2 = baseOf(ref.of);
			if (base2.kind !== "series") return resolveNumber(ref.of, data, row);
			const values = seriesValues(base2, data, row);
			return values.length === 0 ? 0 : Math.max(...values);
		}
	}
}

/**
 * One field, added up over every row of its source (or over `row` alone when
 * the caller is inside a table and means that row's own figure).
 */
function sumOverRows(base: BaseRef, data: PanelData, row?: DataRow): number {
	const rows = row !== undefined ? [row] : rowsFor(base.source, data);
	let total = 0;
	for (const candidate of rows) {
		const value = asNumber(readPath(candidate, base.field));
		if (value !== null) total += value;
	}
	return total;
}

/** input + cacheRead + cacheWrite + output, off one row of the base's source. */
function sumTokenKinds(base: BaseRef, data: PanelData, row?: DataRow): number | null {
	const rows = row !== undefined ? [row] : rowsFor(base.source, data);
	let total = 0;
	let seen = false;
	for (const candidate of rows) {
		for (const field of [
			"totalInputTokens",
			"totalCacheReadTokens",
			"totalCacheWriteTokens",
			"totalOutputTokens",
		]) {
			const value = asNumber(readPath(candidate, field));
			if (value !== null) {
				total += value;
				seen = true;
			}
		}
	}
	return seen ? total : null;
}

// ─── The public surface ──────────────────────────────────────────────────────

/**
 * Resolve a ref to a figure. `null` when absent — never `undefined`, never
 * `NaN`. A `LabelRef` resolves to text, so this returns `string` for one.
 */
export function resolveCell(ref: MetricRef, data: PanelData, row?: DataRow): Resolved {
	if (ref.kind === "derived") return resolveDerived(ref, data, row);
	return resolveBase(ref, data, row);
}

/** Resolve to a NUMBER, or `null`. A ref that names text is not a number. */
export function resolveNumber(ref: MetricRef, data: PanelData, row?: DataRow): number | null {
	const value = resolveCell(ref, data, row);
	return typeof value === "number" ? value : null;
}

/** Resolve to TEXT, or `null`. Used for "Most used" and "Top model". */
export function resolveLabel(ref: MetricRef, data: PanelData, row?: DataRow): string | null {
	const value = resolveCell(ref, data, row);
	return typeof value === "string" ? value : null;
}

/**
 * A ref's values as a plottable series, oldest bucket first.
 *
 * This is the ONLY path into a chart, which is what keeps charts honest: they
 * cannot invent a bucket, and a source with no rows yields `[]` rather than an
 * array of zeroes that would draw a flat "nothing happened" chart when the
 * truth is "nothing was fetched".
 */
export function resolveSeriesValues(ref: MetricRef, data: PanelData, row?: DataRow): readonly number[] {
	const base = baseOf(ref);
	if (base.kind === "series") return seriesValues(base, data, row);
	// An aggregate or a derived total has no shape to plot; its single value is
	// the whole series.
	const value = resolveNumber(ref, data, row);
	return value === null ? [] : [value];
}

/**
 * The number every share on one legend is drawn against.
 *
 * A legend is a set of PARTS, and the parts only mean something relative to a
 * stated whole. The IR does not carry the denominator, so it is derived from
 * the items themselves: the sum of the values a screen's legend names. On
 * Overview that is the four token kinds, so "Uncached input 8.2%" is true of
 * the token mix, and the three agent rows — which the IR points at
 * `overall.totalRequests`, the same field three times — read as a fraction of
 * that mix rather than as a fabricated third of a pie nothing drew.
 *
 * Returns 0 for an empty item list so the caller's division is guarded.
 */
export function sharedDenominator(
	source: MetricSource,
	items: readonly MetricRef[],
	data: PanelData,
): number {
	let total = 0;
	for (const item of items) {
		const base = baseOf(item);
		// Only refs that actually read `source` contribute. A legend that mixes
		// sources (Overview's agent rows) then contributes nothing rather than
		// dragging an unrelated total into the denominator.
		if (base.source !== source) continue;
		const value = resolveNumber(item, data);
		if (value !== null) total += value;
	}
	return total;
}
