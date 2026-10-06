import type { ProviderWindowInsight, UsageWindowSeries } from "@oh-my-pi/omp-stats/shared-types";
import type { Range } from "../../data/ranges";
import { bucketAxis, rangeMeta } from "@oh-my-pi/omp-stats/client/data/range";
import { densify } from "@oh-my-pi/omp-stats/client/data/series";

export const DAY = 86_400_000;
const HOUR = 3_600_000;
export function rangeStep(range: Range): number {
	return rangeMeta(range).bucketMs;
}
/** Host axis semantics with the controller's injected clock. */
export function rangeAxis(range: Range, timestamps: Iterable<number>, now: number, step = rangeStep(range)): number[] {
	return bucketAxis(range, timestamps, step, now);
}
export interface WindowRef { provider: string; windowKey: string }
/** Same identity/fallback precedence as ProvidersRoute.resolveWindow. */
export function resolveWindow(insights: readonly ProviderWindowInsight[], picked: WindowRef | null): WindowRef | null {
	if (picked && insights.some(i => i.provider === picked.provider && i.windowKey === picked.windowKey)) return picked;
	const fallback = (picked && insights.find(i => i.provider === picked.provider)) || insights.reduce<ProviderWindowInsight | undefined>((best, i) => !best || i.fractionConsumed > best.fractionConsumed ? i : best, undefined);
	return fallback ? { provider: fallback.provider, windowKey: fallback.windowKey } : null;
}
export function accountNames(series: readonly UsageWindowSeries[]): Map<string, string> {
	const groups = new Map<string, Set<string>>();
	for (const s of series) {
		const keys = groups.get(s.accountLabel) ?? new Set<string>();
		keys.add(s.accountKey);
		groups.set(s.accountLabel, keys);
	}
	const names = new Map<string, string>();
	for (const [label, keys] of groups) [...keys].sort().forEach((key, i) => names.set(key, keys.size > 1 ? `${label} #${i + 1}` : label));
	return names;
}
export interface AccountReadings {
	latest: { fraction: number; timestamp: number; exhausted: boolean } | null;
	peak: number | null;
	resets: number;
	samples: number;
}
export function accountReadings(series: UsageWindowSeries): AccountReadings {
	let latest: AccountReadings["latest"] = null;
	let peak: number | null = null;
	let resets = 0;
	let previous: number | null = null;
	for (const p of [...series.points].sort((a, b) => a.timestamp - b.timestamp)) {
		if (p.usedFraction === null) continue;
		if (previous !== null && p.usedFraction - previous < -0.05) resets++;
		previous = p.usedFraction;
		peak = Math.max(peak ?? 0, p.usedFraction);
		latest = { fraction: p.usedFraction, timestamp: p.timestamp, exhausted: p.exhausted };
	}
	return { latest, peak, resets, samples: series.points.length };
}
/** Web utilization: last numeric reading per bucket, hold at most six hours. */
export function utilization(series: readonly UsageWindowSeries[]) {
	let first = Infinity;
	let last = -Infinity;
	for (const s of series) for (const p of s.points) { first = Math.min(first, p.timestamp); last = Math.max(last, p.timestamp); }
	if (last < first) return { axis: [] as number[], step: HOUR, rows: [] as { key: string; values: (number | null)[] }[], exhausted: [] as string[][] };
	const step = [300_000, 900_000, 1_800_000, HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY].find(v => (last - first) / v < 240) ?? DAY;
	const axis = rangeAxis("all", [first], last, step);
	const exhausted: string[][] = axis.map(() => []);
	const rows = series.map(s => {
		const values: (number | null)[] = axis.map(() => null);
		const readAt = axis.map(() => -Infinity);
		for (const p of s.points) {
			const i = Math.floor((p.timestamp - axis[0]) / step);
			if (i < 0 || i >= axis.length) continue;
			if (p.exhausted && !exhausted[i].includes(s.accountKey)) exhausted[i].push(s.accountKey);
			if (p.usedFraction === null || p.timestamp < readAt[i]) continue;
			values[i] = p.usedFraction; readAt[i] = p.timestamp;
		}
		let held: number | null = null;
		let heldAt = 0;
		for (let i = 0; i < axis.length; i++) {
			if (values[i] !== null) { held = values[i]; heldAt = readAt[i]; }
			else if (held !== null && axis[i] - heldAt <= 6 * HOUR) values[i] = held;
		}
		return { key: s.accountKey, values };
	});
	return { axis, step, rows, exhausted };
}
export function projectOptions(projects: readonly string[], selected: string | null): (string | null)[] {
	return [null, ...new Set(selected !== null && !projects.includes(selected) ? [selected, ...projects] : projects)];
}
export function savingsHistory(points: readonly { date: string; snapcompact: number }[], range: Range, now: number) {
	const timestamped = points.map(p => ({ ...p, timestamp: Date.parse(`${p.date}T00:00:00Z`) }));
	const axis = rangeAxis(range, timestamped.map(p => p.timestamp), now, DAY);
	const daily = densify(timestamped, axis, p => p.snapcompact);
	let total = 0;
	return { axis, daily, cumulative: daily.map(v => total += v) };
}
