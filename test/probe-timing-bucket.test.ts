import { expect, test } from "bun:test";
import { rangeMeta } from "@oh-my-pi/omp-stats/client/data/range";
import { bucketLabel } from "../scripts/lib/timing";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * `bucketLabel` used to hardcode a minute/hour/day threshold table. The host
 * holds those widths once, as `bucketMs`, and restating them is how a probe ends
 * up labelling the dashboard's axis differently from the dashboard. These tests
 * assert agreement with `rangeMeta` for every range the aggregator supports.
 */
test("bucket labels agree with the host's bucket widths", () => {
	for (const range of ["1h", "24h", "7d", "30d", "90d", "all"] as const) {
		const { bucketMs } = rangeMeta(range);
		expect(bucketLabel(bucketMs), `${range} (${bucketMs}ms)`).toBe(
			bucketMs === 5 * MINUTE ? "5m" : bucketMs === HOUR ? "1h" : "1d",
		);
	}
});

test("the widths the aggregator actually configures all label correctly", () => {
	expect(bucketLabel(MINUTE)).toBe("1m");
	expect(bucketLabel(5 * MINUTE)).toBe("5m");
	expect(bucketLabel(HOUR)).toBe("1h");
	expect(bucketLabel(6 * HOUR)).toBe("6h");
	expect(bucketLabel(DAY)).toBe("1d");
	expect(bucketLabel(7 * DAY)).toBe("1w");
});

test("an unconfigured width still reads as milliseconds rather than lying", () => {
	expect(bucketLabel(999)).toBe("999ms");
	expect(bucketLabel(30 * DAY)).toBe("30d");
});
