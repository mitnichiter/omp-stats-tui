import type { FrustrationModelStats } from "@oh-my-pi/omp-stats/shared-types";

export const MIN_MESSAGES = 50;
export const MIN_JUDGED_SHARE = 0.5;
export type FrustrationLayer = "angry" | "assistant" | "other";
export type FrustrationSort = "version" | "label" | "messages" | "judged" | "annoyed" | "atAssistant" | "angry";
export const FRUSTRATION_SORTS: readonly FrustrationSort[] = ["version", "label", "messages", "judged", "annoyed", "atAssistant", "angry"];
export interface FrustrationFilters {
	modelClass: string | null;
	hiddenFamilies: ReadonlySet<string>;
	showSmall: boolean;
	hideRegex: boolean;
}
export function familyKey(row: FrustrationModelStats): string {
	return `${row.modelClass}/${row.family ?? "unclassified"}`;
}
export function fraction(part: number, whole: number): number {
	return whole > 0 ? part / whole : 0;
}
export function mostlyRegex(row: FrustrationModelStats): boolean {
	return row.messages > 0 && fraction(row.judged, row.messages) < MIN_JUDGED_SHARE;
}
export function layerFraction(row: FrustrationModelStats, layer: FrustrationLayer): number {
	const count = layer === "angry" ? row.angry : layer === "assistant" ? row.atAssistant - row.angry : row.annoyed - row.atAssistant;
	return fraction(count, row.messages);
}
export function classTotals(models: readonly FrustrationModelStats[]): Map<string, number> {
	const totals = new Map<string, number>();
	for (const row of models) totals.set(row.modelClass, (totals.get(row.modelClass) ?? 0) + row.messages);
	return totals;
}
export function activeModelClass(models: readonly FrustrationModelStats[], selected: string | null): string {
	const totals = classTotals(models);
	if (selected === "*" || (selected !== null && totals.has(selected))) return selected;
	let best = "*";
	let messages = -1;
	for (const [key, count] of totals) if (count > messages) { best = key; messages = count; }
	return best;
}
export function filterFrustrationRows(models: readonly FrustrationModelStats[], filters: FrustrationFilters): FrustrationModelStats[] {
	const active = activeModelClass(models, filters.modelClass);
	return models.filter(row => (active === "*" || row.modelClass === active)
		&& !filters.hiddenFamilies.has(familyKey(row))
		&& (filters.showSmall || row.messages >= MIN_MESSAGES)
		&& !(filters.hideRegex && mostlyRegex(row)));
}
/** Version order is upstream's catalog-aware order, not lexicographic revision order. */
export function sortFrustrationRows(rows: readonly FrustrationModelStats[], sort: FrustrationSort, descending: boolean): FrustrationModelStats[] {
	if (sort === "version") return descending ? [...rows].reverse() : [...rows];
	return [...rows].sort((a, b) => {
		const compare = sort === "label" ? a.label.localeCompare(b.label)
			: sort === "messages" ? a.messages - b.messages
			: fraction(a[sort], a.messages) - fraction(b[sort], b.messages);
		return (descending ? -compare : compare) || a.key.localeCompare(b.key);
	});
}
