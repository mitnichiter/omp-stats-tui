#!/usr/bin/env bun
/**
 * Mutation harness — one mutation, one verdict.
 *
 * Apply a production-code mutation, run the named test files, record whether the
 * suite DIED (the mutation was caught) or SURVIVED (the test is decorative for
 * that mutation), then revert. Never leaves the tree dirty.
 */
import { $ } from "bun";

interface Mutation {
	id: string;
	file: string;
	find: string;
	replace: string;
	tests: string[];
	expectation: string;
	/** Deliberate no-op: verifies the harness itself can see a green run. */
	control?: boolean;
}

const MUTATIONS: Mutation[] = [
	// ── band.ts / G1–G6 ──────────────────────────────────────────────────────
	{
		id: "G4-legend-continuation-breaks",
		file: "src/tui/band.ts",
		find: 'if (!isContinuation && lines.length > 0) lines.push("");',
		replace: 'if (lines.length > 0) lines.push("");',
		tests: ["test/band.test.ts"],
		expectation: "G4: the legend continuation gains a blank line it must not have",
	},
	{
		id: "G5-heading-becomes-rule",
		file: "src/tui/band.ts",
		find: 'const parts = [statsIcon(preset, icon), ctx.bold(ctx.fg(PALETTE.heading, title))];',
		replace:
			'const parts = ["─".repeat(60), statsIcon(preset, icon), ctx.bold(ctx.fg(PALETTE.heading, title))];',
		tests: ["test/band.test.ts"],
		expectation: "G5: a band heading emits a full-width rule",
	},
	{
		id: "G3-note-gains-heading",
		file: "src/tui/band.ts",
		find: 'return [clamp(ctx.fg(PALETTE.dim, band.text), ctx.width)];',
		replace: 'return [heading(BAND_ICONS.chart, "Note", band.text, ctx.preset, ctx)];',
		tests: ["test/band.test.ts"],
		expectation: "G3: a note acquires a heading and icon",
	},
	{
		id: "statRow-truncates-label",
		file: "src/tui/band.ts",
		find: "truncateToWidth(tile.value, Math.max(0, tileWidth - ctx.labelWidth));",
		replace: "truncateToWidth(tile.label, Math.max(0, tileWidth));",
		tests: ["test/band.test.ts"],
		expectation: "F23 2.3 r3: the LABEL is truncated instead of the value",
	},
	{
		id: "statRow-hint-truncated",
		file: "src/tui/band.ts",
		find: "if (visibleWidth(candidate) <= tileWidth) text = candidate;",
		replace: "text = truncateToWidth(candidate, tileWidth);",
		tests: ["test/band.test.ts"],
		expectation: "F23 2.3 r2: an oversized hint is truncated rather than dropped",
	},
	{
		id: "table-drop-note-removed",
		file: "src/tui/band.ts",
		find: '? [clamp(ctx.fg(PALETTE.dim, `${shown.length} of ${all.length}`), ctx.width)]',
		replace: "? []",
		tests: ["test/band.test.ts"],
		expectation: "a truncated table silently implies it showed everything",
	},
	{
		id: "table-numbers-dimmed",
		file: "src/tui/band.ts",
		find: "(t) => ctx.fg(PALETTE.label, t),\n\t\t),\n\t);",
		replace: "(t) => ctx.fg(PALETTE.dim, t),\n\t\t),\n\t);",
		tests: ["test/band.test.ts"],
		expectation: "table data cells become dim instead of default text",
	},
	{
		id: "table-limit-ignored",
		file: "src/tui/band.ts",
		find: "const shown = all.slice(0, ctx.tableLimit);",
		replace: "const shown = all;",
		tests: ["test/band.test.ts"],
		expectation: "the table limit stops dropping rows",
	},
	{
		id: "legend-share-column-lost",
		file: "src/tui/band.ts",
		find: "const share = padStartTo(formatPercent(item.share), SHARE_COL);",
		replace: "const share = formatPercent(item.share);",
		tests: ["test/band.test.ts"],
		expectation: "legend shares stop right-aligning (decimal points unalign)",
	},
	{
		id: "statRow-columns-clamp-removed",
		file: "src/tui/band.ts",
		find: "const columns = Math.max(1, Math.min(3, Math.floor(inner / TILE_WIDTH)));",
		replace: "const columns = stats.length;",
		tests: ["test/band.test.ts"],
		expectation: "statRow lays every tile in one row, ignoring the 34-wide grid",
	},
	{
		id: "chart-meta-drops-source",
		file: "src/tui/band.ts",
		find: "const meta = band.source ?? band.chart.axis ?? \"\";",
		replace: "const meta = \"\";",
		tests: ["test/band.test.ts"],
		expectation: "G2: the heading meta (source / axis) stops rendering",
	},
	{
		id: "colour-leak-hardcoded-hex",
		file: "src/tui/band.ts",
		find: "const swatch = ctx.fg(seriesToken(ctx, index), glyph(ctx.preset, \"barFill\").repeat(2));",
		replace: 'const swatch = `\\x1b[38;2;255;0;0m${glyph(ctx.preset, "barFill").repeat(2)}\\x1b[0m`;',
		tests: ["test/band.test.ts"],
		expectation: "a literal truecolor escape enters a band body",
	},
	// ── format.ts ────────────────────────────────────────────────────────────
	{
		id: "format-percent-drops-decimals",
		file: "src/tui/format.ts",
		find: "return `${(value * 100).toFixed(digits)}%`;",
		replace: "return `${(value * 100).toFixed(0)}%`;",
		tests: ["test/format.test.ts", "test/band.test.ts"],
		expectation: "formatPercent ignores the requested decimals",
	},
	{
		id: "format-cost-ignores-subcent-digits",
		file: "src/tui/format.ts",
		find: "export function formatCost(value: number, digits?: number): string {",
		replace: "export function formatCost(value: number, digits?: number): string {\n\tdigits = 2;",
		tests: ["test/format.test.ts"],
		expectation: "formatCost forces 2 digits, losing sub-cent precision",
	},
	{
		id: "format-unpriced-marker-dropped",
		file: "src/tui/format.ts",
		find: "export function costWithUnpriced(cost: number, unpricedRequests: number, digits?: number): string {",
		replace:
			"export function costWithUnpriced(cost: number, unpricedRequests: number, digits?: number): string {\n\treturn formatCost(cost, digits);",
		tests: ["test/format.test.ts", "test/unpriced-render.test.ts"],
		expectation: "costWithUnpriced stops marking unpriced spend — the one lie this panel avoids",
	},
	// ── api.ts / the unpriced discriminator ──────────────────────────────────
	{
		id: "unpriced-discriminator-inverts",
		file: "src/data/api.ts",
		find: "if (catalogPriceCard(row.model)) continue;",
		replace: "if (!catalogPriceCard(row.model)) continue;",
		tests: ["test/unpriced-correction.test.ts", "test/unpriced-render.test.ts", "test/api.test.ts"],
		expectation: "the discriminator INVERTS: no-card models counted as priced",
	},
	{
		id: "unpriced-card-detection-requires-nonzero",
		file: "src/data/api.ts",
		find: 'if (model && typeof model === "object" && model.cost !== undefined) priced.add(id);',
		replace:
			'if (model && typeof model === "object" && (model.cost as { input?: number })?.input) priced.add(id);',
		tests: ["test/unpriced-correction.test.ts", "test/unpriced-render.test.ts"],
		expectation: "an ALL-ZERO price card reads as NO card — free tiers marked unknown",
	},
	{
		id: "unpriced-replaces-instead-of-adds",
		file: "src/data/api.ts",
		find: "unpricedRequests: ((overall as { unpricedRequests?: number }).unpricedRequests ?? 0) + total,",
		replace: "unpricedRequests: total,",
		tests: ["test/unpriced-correction.test.ts"],
		expectation: "the package's own unpriced count is REPLACED, losing xai-oauth rows",
	},
	{
		id: "unpriced-mutates-input",
		file: "src/data/api.ts",
		find: "if (counts.size === 0) return payload;\n\tconst patched = { ...payload } as Record<string, unknown>;",
		replace: "if (counts.size === 0) return payload;\n\tconst patched = payload as Record<string, unknown>;",
		tests: ["test/unpriced-correction.test.ts"],
		expectation: "the correction mutates its input payload instead of copying",
	},
	// ── sync/client.ts ───────────────────────────────────────────────────────
	{
		id: "sync-abort-uses-sigterm",
		file: "src/sync/client.ts",
		find: 'child.kill("SIGKILL");',
		replace: 'child.kill("SIGTERM");',
		tests: ["test/sync.test.ts"],
		expectation: "the child is SIGTERMed instead of SIGKILLed — a lock can survive",
	},
	{
		id: "sync-abort-does-not-kill",
		file: "src/sync/client.ts",
		find: '\t\tkill();\n\t\tinflight = null;\n\t\tif (!settled) {',
		replace: '\t\tinflight = null;\n\t\tif (!settled) {',
		tests: ["test/sync.test.ts"],
		expectation: "aborting resolves the handle but leaves the child running",
	},
	{
		id: "sync-memoisation-removed",
		file: "src/sync/client.ts",
		find: "\tif (inflight) {\n\t\tinflight.listeners.add(onEvent);",
		replace: "\tif (false && inflight) {\n\t\tinflight.listeners.add(onEvent);",
		tests: ["test/sync.test.ts"],
		expectation: "N concurrent callers each spawn their own ingest child",
	},
	{
		id: "sync-partial-line-throws",
		file: "src/sync/client.ts",
		find: "const event = parseSyncLine(line);\n\t\t\t\t\tif (!event) continue;",
		replace: "const event = parseSyncLine(line) as SyncEvent;",
		tests: ["test/sync.test.ts"],
		expectation: "a malformed/partial line is no longer skipped (null passed to listeners)",
	},
	// ── bars.ts ──────────────────────────────────────────────────────────────
	{
		id: "bars-zero-gets-a-cell",
		file: "src/tui/charts/bars.ts",
		find: "return values.map((v) => (v <= 0 ? 0 : Math.max(1, Math.round((v / max) * height))));",
		replace: "return values.map((v) => Math.max(1, Math.round((v / max) * height)));",
		tests: ["test/bars.test.ts"],
		expectation: "a ZERO value renders a filled cell — \"nothing happened\" looks like spend",
	},
	{
		id: "bars-compose-inverts-fill",
		file: "src/tui/charts/bars.ts",
		find: ".map((h) => (h >= threshold ? opts.accent(fill) : opts.dim(blank)))",
		replace: ".map((h) => (h < threshold ? opts.accent(fill) : opts.dim(blank)))",
		tests: ["test/bars.test.ts"],
		expectation: "the bar chart fills from the BOTTOM (staircase inverted)",
	},
	{
		id: "bars-empty-state-removed",
		file: "src/tui/charts/bars.ts",
		find: 'if (values.length === 0) return [clamp("No activity recorded in this range.", Math.max(0, Math.floor(opts.width)))];',
		replace: "if (values.length === 0) return [];",
		tests: ["test/bars.test.ts"],
		expectation: "an empty range renders nothing instead of saying so",
	},
	// ── controls ─────────────────────────────────────────────────────────────
	{
		id: "CONTROL-no-op",
		file: "src/tui/band.ts",
		find: "const TILE_WIDTH = 34;",
		replace: "const TILE_WIDTH = 34;",
		tests: ["test/band.test.ts"],
		expectation: "CONTROL: harness must report a green run here",
		control: true,
	},
];

interface Row {
	id: string;
	expectation: string;
	verdict: "DIED" | "SURVIVED" | "ERROR";
	detail: string;
}

/**
 * Restore from an in-memory snapshot — NEVER from git.
 *
 * The first version of this harness ran `git checkout -- src test` after every
 * mutation. On a shared working tree that discards every uncommitted change
 * under those paths, not just the mutation this script wrote. It ate a sibling
 * agent's in-progress edits to `src/tui/palette.ts` and `test/heatmap.test.ts`.
 *
 * Snapshotting the one file we are about to touch is both safer and sufficient:
 * the only change this script makes is a single `Bun.write` to `m.file`.
 */
async function run(m: Mutation): Promise<Row> {
	const original = await Bun.file(m.file).text();
	try {
		if (!original.includes(m.find)) {
			return { id: m.id, expectation: m.expectation, verdict: "ERROR", detail: `anchor not found in ${m.file}` };
		}
		await Bun.write(m.file, original.replace(m.find, m.replace));

		const proc = Bun.spawn(["bun", "test", ...m.tests], { stdout: "pipe", stderr: "pipe" });
		const out = await new Response(proc.stdout).text();
		const exit = await proc.exited;

		const failed = /^ (\d+) fail/m.exec(out)?.[1] ?? "?";
		const passed = /^ (\d+) pass/m.exec(out)?.[1] ?? "?";
		if (m.control) {
			return {
				id: m.id,
				expectation: m.expectation,
				verdict: exit === 0 ? "DIED" : "SURVIVED",
				detail: `CONTROL ${passed} pass ${failed} fail`,
			};
		}
		return exit !== 0
			? { id: m.id, expectation: m.expectation, verdict: "DIED", detail: `${failed} fail / ${passed} pass` }
			: { id: m.id, expectation: m.expectation, verdict: "SURVIVED", detail: `${passed} pass, 0 fail` };
	} finally {
		// Always restore, even if the test run threw. `git` is never involved, so
		// a sibling's uncommitted work in any other file is untouchable.
		await Bun.write(m.file, original);
	}
}

// Refuse to run on a dirty tree rather than risk it, unless explicitly forced.
const dirty = await $`git status --porcelain`.quiet().text();
if (dirty.trim() && !process.argv.includes("--allow-dirty")) {
	console.error("Refusing to run: the working tree has uncommitted changes.");
	console.error("This script snapshots the files it touches, so it is safe, but run");
	console.error("`bun run scripts/mutate.ts --allow-dirty` if you know that is fine.\n");
	console.error(dirty);
	process.exit(2);
}

const rows: Row[] = [];
for (const m of MUTATIONS) rows.push(await run(m));

console.log("\n=== MUTATION RESULTS ===");
for (const r of rows) {
	console.log(`${r.verdict.padEnd(9)} ${r.id.padEnd(42)} ${r.detail}`);
}
const scored = rows.filter(r => r.verdict !== "ERROR" && !r.id.startsWith("CONTROL"));
console.log(`\nDIED: ${scored.filter(r => r.verdict === "DIED").length} / ${scored.length}`);
