/** Progress consumed by the dashboard chrome, not a worker lifecycle protocol. */
export interface SyncEvent {
	type: "progress";
	phase: "scan" | "ingest" | "rollup";
	current: number;
	total: number;
	sessionFile?: string;
}

const PHASE_WORDS: Record<"scan" | "ingest" | "rollup", string> = {
	scan: "Scanning sessions",
	ingest: "Ingesting sessions",
	rollup: "Building rollups",
};

const BAR_WIDTH = 20;

/**
 * One footer line describing ingest. Determinates where the worker reports a
 * denominator (the ingest phase) and goes indeterminate where it does not (the
 * rollup phase reports only a remaining count). Never emits NaN, and never
 * exceeds `width` — the footer must not reflow the panel.
 */
export function describeSyncProgress(event: SyncEvent, width: number): string {
	if (width <= 0) return "";
	if (event.type !== "progress") return "";

	const pct = event.total > 0 ? Math.floor((event.current / event.total) * 100) : null;
	// Clamp defensively: a total smaller than current would otherwise print a
	// width over 100 and overflow the bar.
	const clamped = pct === null ? null : Math.max(0, Math.min(100, pct));
	const word = PHASE_WORDS[event.phase];
	const label = clamped === null ? `${word} ·` : `${word} ${clamped}%`;

	if (Bun.stringWidth(label) >= width) {
		return clipped(label, width);
	}

	const barWidth = Math.min(BAR_WIDTH, width - Bun.stringWidth(label) - 1);
	if (barWidth < 3) return clipped(label, width);
	const filled = clamped === null ? 0 : Math.round((barWidth * clamped) / 100);
	const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);
	return `${label} ${bar}`;
}

function clipped(label: string, width: number): string {
	let out = "";
	let used = 0;
	for (const ch of label) {
		const w = Bun.stringWidth(ch);
		if (used + w > width) break;
		out += ch;
		used += w;
	}
	return out;
}
