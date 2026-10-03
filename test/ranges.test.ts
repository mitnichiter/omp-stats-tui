import { test, expect } from "bun:test";
import {
	RANGES,
	DEFAULT_RANGE,
	isRange,
	nextRange,
	rangeLabel,
	bucketCountFor,
	NATURAL_BUCKETS,
} from "../src/data/ranges";

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

test("bucket counts are the ranges' natural bucket counts, clamped by width", () => {
	expect(bucketCountFor("1h", 200)).toBe(12); // 5-minute buckets
	expect(bucketCountFor("24h", 200)).toBe(24); // hourly
	expect(bucketCountFor("7d", 200)).toBe(7); // daily
	expect(bucketCountFor("30d", 200)).toBe(30);
	expect(bucketCountFor("90d", 200)).toBe(90);
	expect(bucketCountFor("all", 200)).toBe(53); // weeks, the calendar-heatmap width
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

test("natural bucket counts mirror the host's TIME_RANGES spans", () => {
	// The panel's own table, not the host's, decides this — so it is pinned here.
	// A drift means a bar chart silently resamples at the wrong bucket width.
	expect(Object.keys(NATURAL_BUCKETS).sort()).toEqual([...RANGES].sort());
	expect(NATURAL_BUCKETS["1h"]).toBe(12);
	expect(NATURAL_BUCKETS["all"]).toBe(53);
});
