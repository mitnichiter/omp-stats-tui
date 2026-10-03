/**
 * Cold-vs-warm timing reporting.
 *
 * WHY this exists: every latency quoted in the findings files was measured warm,
 * and the cold number is a different *kind* of thing — first-query-in-process
 * page-cache warmup, not rollup cost. Publishing only the warm number is how a
 * page-cache artefact gets mistaken for a design constraint (and vice versa).
 * This module owns the shape of the report so the distinction cannot be lost.
 *
 * Pure: no clock, no I/O. Callers pass already-measured durations, which is
 * what makes the formatting unit-testable.
 */

/** One call's measured duration, in milliseconds. */
export interface CallTiming {
	/** 0-based index of the call within the range's run sequence. */
	run: number;
	ms: number;
}

export interface RangeTiming {
	/** The key the caller asked for, valid or not. */
	requested: string;
	/** The key the aggregator actually resolved to. */
	resolved: string;
	/** False for a key outside the valid set (e.g. `365d`), which fell back. */
	valid: boolean;
	/** Milliseconds between the window's start and its first bucket. */
	bucketMs: number;
	/** ISO-8601 hour of the oldest bucket returned, or null when empty. */
	firstBucket: string | null;
	calls: readonly CallTiming[];
}

/**
 * The first call in a fresh process is *not* comparable to the rest, so it is
 * labelled and reported separately rather than averaged in.
 */
export function coldCall(timing: RangeTiming): CallTiming | undefined {
	return timing.calls.find((c) => c.run === 0);
}

/** Every call after the first — the numbers that reflect steady-state cost. */
export function warmCalls(timing: RangeTiming): readonly CallTiming[] {
	return timing.calls.filter((c) => c.run > 0);
}

export function meanMs(calls: readonly CallTiming[]): number | null {
	if (calls.length === 0) return null;
	return calls.reduce((sum, c) => sum + c.ms, 0) / calls.length;
}

/**
 * Human labels for the bucket widths the aggregator configures, widest first:
 * the label is the first width at least as wide as the requested one, so a
 * 300 s bucket reads "5m" and not "1m".
 */
const BUCKET_LABELS: readonly { readonly minMs: number; readonly label: string }[] = [
	{ minMs: 24 * 60 * 60 * 1000, label: "1d" },
	{ minMs: 6 * 60 * 60 * 1000, label: "6h" },
	{ minMs: 60 * 60 * 1000, label: "1h" },
	{ minMs: 5 * 60 * 1000, label: "5m" },
	{ minMs: 60 * 1000, label: "1m" },
];

export function bucketLabel(bucketMs: number): string {
	return BUCKET_LABELS.find((b) => bucketMs >= b.minMs)?.label ?? `${bucketMs}ms`;
}

function padEnd(value: string, width: number): string {
	return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function padStart(value: string, width: number): string {
	return value.length >= width ? value : " ".repeat(width - value.length) + value;
}

const RANGE_COL = 8;
const MS_COL = 8;

/**
 * Renders the timing table. Column widths are computed from the data rather than
 * hardcoded, because an invalid key's note is longer than its column.
 */
export function formatTimingTable(timings: readonly RangeTiming[], runsPerRange: number): readonly string[] {
	const headers = ["range", "resolved", "cold ms", "warm ms", "bucket", "first bucket"];
	const rows: string[][] = timings.map((t) => {
		const warm = meanMs(warmCalls(t));
		return [
			t.requested,
			t.valid ? "" : `-> ${t.resolved}`,
			coldCall(t) ? coldCall(t)!.ms.toFixed(1) : "-",
			warm === null ? "-" : warm.toFixed(1),
			bucketLabel(t.bucketMs),
			t.firstBucket ?? "-",
		];
	});

	const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));

	const header = headers.map((h, i) => padEnd(h, widths[i])).join("  ").trimEnd();
	const divider = widths.map((w) => "-".repeat(w)).join("  ");

	const body = rows.map((r, idx) => {
		const note = timings[idx].valid ? "" : "  <- INVALID: silent fallback";
		return r.map((c, i) => padEnd(c, widths[i])).join("  ").trimEnd() + note;
	});

	// Runs per range is reported so a reader can tell how many warm samples the
	// warm column actually averages.
	const footer = `warm ms = mean of runs 1..${Math.max(runsPerRange - 1, 0)}; run0 is cold (page-cache warmup)`;

	return [header, divider, ...body, footer];
}