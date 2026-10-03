import { test, expect } from "bun:test";
import { rangeMeta, TIME_RANGES } from "@oh-my-pi/omp-stats/client/data/range";
import {
	RANGES,
	DEFAULT_RANGE,
	isRange,
	nextRange,
	rangeLabel,
	bucketCountFor,
	bucketCountForRange,
} from "../src/data/ranges";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

test("the valid set is exactly six, and 365d is not one of them", () => {
	expect([...RANGES]).toEqual(["1h", "24h", "7d", "30d", "90d", "all"]);
	// 365d is not a key the host understands: getTimeRangeConfig silently resolves
	// an unknown range to the 24h default, so a picker offering "365 days" would
	// show 24 hours of data with no error at all.
	expect(isRange("365d")).toBe(false);
	expect(isRange("24H")).toBe(false);
	expect(isRange("")).toBe(false);
	expect(isRange("7d")).toBe(true);
});

test("non-string and nullish values are rejected rather than coerced", () => {
	// A picker binding can hand us undefined before a selection exists; treating
	// that as a range would make the panel render an empty window, not an error.
	expect(isRange(undefined as unknown as string)).toBe(false);
	expect(isRange(null as unknown as string)).toBe(false);
	expect(isRange(7 as unknown as string)).toBe(false);
	expect(isRange(" 24h")).toBe(false);
	expect(isRange("24h ")).toBe(false);
});

test("the default range is 24h", () => {
	expect(DEFAULT_RANGE).toBe("24h");
	expect(isRange(DEFAULT_RANGE)).toBe(true);
});

test("cycling wraps in both directions", () => {
	expect(nextRange("all", 1)).toBe("1h");
	expect(nextRange("1h", -1)).toBe("all");
	expect(nextRange("7d", 1)).toBe("30d");
	expect(nextRange("90d", 1)).toBe("all");
	expect(nextRange("24h", -1)).toBe("1h");
});

test("cycling walks the whole list and returns where it started", () => {
	let range = DEFAULT_RANGE;
	for (let i = 0; i < RANGES.length; i++) range = nextRange(range, 1);
	expect(range).toBe(DEFAULT_RANGE);
	let back = DEFAULT_RANGE;
	for (let i = 0; i < RANGES.length; i++) back = nextRange(back, -1);
	expect(back).toBe(DEFAULT_RANGE);
});

test("labels read as spans, not as raw keys", () => {
	expect(rangeLabel("1h")).toBe("1 hour");
	expect(rangeLabel("24h")).toBe("24 hours");
	expect(rangeLabel("7d")).toBe("7 days");
	expect(rangeLabel("30d")).toBe("30 days");
	expect(rangeLabel("90d")).toBe("90 days");
	expect(rangeLabel("all")).toBe("All time");
});

test("every range has a distinct human label", () => {
	const labels = RANGES.map(rangeLabel);
	expect(new Set(labels).size).toBe(RANGES.length);
});

test("bucket counts are the HOST's natural bucket counts, clamped by width", () => {
	// These expectations are now the host's, read from `rangeMeta` — see the
	// agreement test below, which is what actually pins them.
	expect(bucketCountFor("1h", 200)).toBe(12); // 5-minute buckets over one hour
	expect(bucketCountFor("24h", 200)).toBe(24); // hourly over one day
	expect(bucketCountFor("7d", 200)).toBe(7); // daily over a week
	expect(bucketCountFor("30d", 200)).toBe(30);
	expect(bucketCountFor("90d", 200)).toBe(90);
	// `all` has NO span in the host's table (spanMs === null), so there is no
	// natural bucket count to derive. We fill the available width instead of
	// inventing a number — the previous hand-written 53 was an invention that
	// disagreed with the host.
	expect(bucketCountFor("all", 200)).toBe(200);
});

test("never more buckets than columns, and never zero or negative", () => {
	for (const range of RANGES) {
		for (const width of [1, 6, 40, 200]) {
			const n = bucketCountFor(range, width);
			expect(n, `${range}@${width}`).toBeGreaterThanOrEqual(1);
			expect(n, `${range}@${width}`).toBeLessThanOrEqual(width);
		}
	}
});

test("bucket counts AGREE with the host's rangeMeta, derived not duplicated", () => {
	// The regression this replaces: we hand-maintained a NATURAL_BUCKETS table
	// that claimed `all` was 53 weekly buckets while the host buckets `all` by
	// DAY. A hand-written copy of a host-owned table is exactly how the two drift.
	for (const range of RANGES) {
		const { spanMs, bucketMs } = rangeMeta(range);
		// Derived exactly as the host's own TimeChart does: span / bucket size.
		const expected = spanMs === null ? 200 : spanMs / bucketMs;
		expect(bucketCountForRange(range, 200), `${range} bucket count`).toBe(expected);
	}
});

test("our valid set and the host's are the same six ranges, in the same order", () => {
	expect([...RANGES]).toEqual([...TIME_RANGES]);
});

test("bucketCountForRange leaves an unbounded range alone", () => {
	// The `all` case, isolated: no span means no natural count, so the caller
	// gets the width back rather than a made-up number.
	expect(bucketCountForRange("all", 42)).toBe(42);
	expect(bucketCountForRange("7d", 42)).toBe(7);
});
