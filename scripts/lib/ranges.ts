/**
 * The valid range set, as data.
 *
 * WHY a hardcoded list and not a free-form string: the aggregator resolves an
 * unknown range key by falling back to the `24h` default *silently*
 * (`getTimeRangeConfig`: `TIME_RANGES[key] ?? TIME_RANGES[DEFAULT_TIME_RANGE]`).
 * A picker that offered "365d" would therefore show 24 hours of data with no
 * error anywhere — the failure mode is invisible, not loud. Centralising the
 * set here means a range added to the UI has to be added here too, and
 * `isValidRange` is the single place that can reject one.
 *
 * This module is deliberately free of any database or terminal access so it can
 * be unit-tested headless.
 */

/** The exact set of range keys the aggregator honours. */
export const VALID_RANGES = ["1h", "24h", "7d", "30d", "90d", "all"] as const;

export type ValidRange = (typeof VALID_RANGES)[number];

/** What an unrecognised key resolves to — the aggregator's default. */
export const DEFAULT_RANGE: ValidRange = "24h";

/**
 * Ranges that are NOT valid but that a naive implementation is likely to offer.
 * `probe-data.ts` times one of these purely to demonstrate that it silently
 * collapses onto `24h`; nothing in the product may ever pass it through.
 */
export const KNOWN_INVALID_RANGES = ["365d"] as const;

export function isValidRange(value: string): value is ValidRange {
	return (VALID_RANGES as readonly string[]).includes(value);
}

/**
 * What the aggregator will *actually* do with `value`: the key itself when it
 * is valid, `24h` when it is not. The probe prints the resolved key beside the
 * requested one so the silent fallback is visible rather than inferred.
 */
export function resolveRange(value: string): { requested: string; resolved: ValidRange; valid: boolean } {
	return isValidRange(value)
		? { requested: value, resolved: value, valid: true }
		: { requested: value, resolved: DEFAULT_RANGE, valid: false };
}