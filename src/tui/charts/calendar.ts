import type { DailyActivityPoint } from "@oh-my-pi/omp-stats/shared-types";

export interface CalendarLayout {
	/** Short month name when a Monday column starts a new month. */
	monthLabels: (string | undefined)[];
	/** Monday-first rows × week columns; 0..4 intensity, null for future dates. */
	cells: (number | null)[][];
	totalCost: number;
	totalRequests: number;
	/** Local midnight of the first Monday. */
	start: Date;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function localDay(date: Date): string {
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${date.getFullYear()}-${month}-${day}`;
}

function addDays(date: Date, days: number): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/**
 * Terminal-owned port of omp /usage's calendar algorithm (pi-tui's private
 * overlays/usage-dashboard.ts). Local date arithmetic preserves DST boundaries.
 * Cost determines sqrt-compressed levels, or requests if all supplied costs
 * are zero; the visible window alone determines the maximum and totals.
 */
export function calendarLayout(
	points: readonly Pick<DailyActivityPoint, "day" | "cost" | "requests">[],
	weeks: number,
	today = new Date(),
): CalendarLayout {
	const byDay = new Map(points.map(point => [point.day, point]));
	const anyCost = points.some(point => point.cost > 0);
	const metric = (point: (typeof points)[number]): number => (anyCost ? point.cost : point.requests);
	const today0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
	const mondayOffset = (today0.getDay() + 6) % 7;
	const currentMonday = addDays(today0, -mondayOffset);
	const start = addDays(currentMonday, -(weeks - 1) * 7);
	const startDay = localDay(start);
	const todayDay = localDay(today0);
	const inRange = points.filter(point => point.day >= startDay && point.day <= todayDay);
	const max = inRange.reduce((acc, point) => Math.max(acc, metric(point)), 0);
	const level = (value: number): number => {
		if (value <= 0 || max <= 0) return 0;
		return Math.min(4, Math.max(1, Math.ceil(Math.sqrt(value / max) * 4)));
	};

	const monthLabels: (string | undefined)[] = [];
	const cells: (number | null)[][] = Array.from({ length: 7 }, () =>
		Array.from({ length: weeks }, (): number | null => null),
	);
	let previousMonth = -1;
	for (let week = 0; week < weeks; week++) {
		const weekStart = addDays(start, week * 7);
		const month = weekStart.getMonth();
		monthLabels.push(month !== previousMonth ? MONTH_NAMES[month] : undefined);
		previousMonth = month;
		for (let day = 0; day < 7; day++) {
			const date = addDays(weekStart, day);
			if (date > today0) continue;
			const point = byDay.get(localDay(date));
			cells[day][week] = level(point ? metric(point) : 0);
		}
	}
	return {
		monthLabels,
		cells,
		totalCost: inRange.reduce((sum, point) => sum + point.cost, 0),
		totalRequests: inRange.reduce((sum, point) => sum + point.requests, 0),
		start,
	};
}
