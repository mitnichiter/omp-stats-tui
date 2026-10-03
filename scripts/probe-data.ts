/**
 * probe-data — re-measures the live stats database instead of trusting a
 * number quoted in a findings file.
 *
 * READ-ONLY, ALWAYS. The script opens its own connection with
 * `{ readonly: true }` so a mistake in this file cannot mutate `~/.omp/stats.db`.
 * It never calls `syncAllSessions` (7141 ms of synchronous SQLite for 3401
 * files), never calls `/api/sync`, and never writes a file anywhere. The
 * aggregator's own handle is opened by `getDashboardStats` → `initDb()`, which
 * has write *intent*; the script prints the file's mtime and size before and
 * after so that claim stays checkable rather than assumed.
 *
 * Run: `bun run scripts/probe-data.ts`
 */

import { Database } from "bun:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDashboardStats, getTimeRangeConfig } from "@oh-my-pi/omp-stats/aggregator";
import { getRollupStatus } from "@oh-my-pi/omp-stats/rollup";
import { getStatsDbPath } from "@oh-my-pi/pi-utils";
import { KNOWN_INVALID_RANGES, VALID_RANGES, resolveRange } from "./lib/ranges";
import { formatTimingTable, type RangeTiming } from "./lib/timing";

/** Timed calls per range. Run 0 is the cold first call; runs 1+ are warm. */
const RUNS_PER_RANGE = 3;
/** Models shown in the magnitude table — enough to expose the price spread. */
const TOP_MODELS = 12;

const out = (line = "") => console.log(line);
const heading = (title: string) => {
	out();
	out(title);
	out("=".repeat(title.length));
};

function fileStamp(file: string): { mtimeMs: number; size: number } | null {
	try {
		const st = fs.statSync(file);
		return { mtimeMs: st.mtimeMs, size: st.size };
	} catch {
		return null;
	}
}

function formatStamp(stamp: { mtimeMs: number; size: number } | null): string {
	if (!stamp) return "missing";
	return `mtime ${stamp.mtimeMs.toFixed(0)} size ${(stamp.size / 1e6).toFixed(1)} MB`;
}

function formatCount(n: number): string {
	return n.toLocaleString("en-US");
}

/** Row counts of the fact tables, the rollup tables and the dirty queues. */
function printTableCounts(db: Database): void {
	heading("TABLES");
	const facts = ["messages", "tool_calls", "user_messages"];
	const rollups = ["message_rollup", "tool_rollup", "session_rollup"];

	for (const [label, tables] of [
		["fact tables", facts],
		["rollup tables", rollups],
	] as const) {
		for (const table of tables) {
			const { n } = db.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
			out(`  ${table.padEnd(16)} ${formatCount(n).padStart(12)}   (${label})`);
		}
	}

	// The dirty counts are the panel's own honesty signal: a not-yet-built hour
	// is a hole, not a zero, and past EXACT_DIRTY_LIMIT (96) the reader stops
	// unioning dirty hours with the facts altogether.
	const dirty = db.query("SELECT (SELECT COUNT(*) FROM rollup_dirty) AS hours, (SELECT COUNT(*) FROM session_dirty) AS sessions").get() as {
		hours: number;
		sessions: number;
	};
	out(`  rollup_dirty      ${formatCount(dirty.hours).padStart(12)}   dirty hours`);
	out(`  session_dirty     ${formatCount(dirty.sessions).padStart(12)}   dirty sessions`);
}

/**
 * The newest session file's mtime, printed beside the dirty counts so the
 * open question "does the host already sync before an extension runs?" can be
 * answered by comparison: if the newest session is newer than the oldest dirty
 * hour, ingest has not caught up and Task 12's subprocess earns its place.
 */
function newestSessionMtime(): { file: string; mtimeMs: number } | null {
	const sessionsDir = path.join(os.homedir(), ".omp", "agent", "sessions");
	const stack = [sessionsDir];
	let newest: { file: string; mtimeMs: number } | null = null;

	while (stack.length > 0) {
		const dir = stack.pop()!;
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) stack.push(full);
			else if (!newest || safeMtime(full) > newest.mtimeMs) newest = { file: full, mtimeMs: safeMtime(full) };
		}
	}
	return newest;
}

function safeMtime(file: string): number {
	try {
		return fs.statSync(file).mtimeMs;
	} catch {
		return 0;
	}
}

async function timeRange(requested: string): Promise<RangeTiming> {
	const { resolved, valid } = resolveRange(requested);
	// The window is read before timing so Date.now() inside the aggregator
	// cannot drift the cutoff between the printed config and the query.
	const window = getTimeRangeConfig(resolved);
	const calls: { run: number; ms: number }[] = [];

	let firstBucket: string | null = null;
	for (let run = 0; run < RUNS_PER_RANGE; run++) {
		const start = performance.now();
		const stats = await getDashboardStats(resolved);
		calls.push({ run, ms: performance.now() - start });
		if (run === 0 && stats.timeSeries.length > 0) {
			firstBucket = new Date(stats.timeSeries[0].timestamp).toISOString().slice(0, 16);
		}
	}

	return { requested, resolved, valid, bucketMs: window.bucketMs, firstBucket, calls };
}

/**
 * Ranges are timed SEQUENTIALLY, never with `Promise.all`. `bun:sqlite` is
 * synchronous, so parallelising would interleave the first call's page-cache
 * warmup across every range and make each one look cold — a measurement
 * artefact, not a property of the range.
 */
async function printRangeTimings(): Promise<void> {
	heading("RANGE TIMINGS");
	out();
	out("Ranges run SEQUENTIALLY, so only the very first run0 in this table is");
	out("genuinely cold; every later run0 inherits an already-warm page cache.");
	out("warm = mean of runs 1.., which is the real per-range cost.");
	out();

	const timings: RangeTiming[] = [];
	for (const requested of [...VALID_RANGES, ...KNOWN_INVALID_RANGES]) {
	timings.push(await timeRange(requested));
}

	for (const line of formatTimingTable(timings, RUNS_PER_RANGE)) out(line);
}

/**
 * The magnitude table. Splitting fresh / cache-read / cache-write is not
 * polish: raw totals here run to BILLIONS and are ~95% cache reads, so a
 * single token figure is true and useless. And a model priced at exactly $0.00
 * is an UNPRICED request — unknown spend, not free spend — so the unpriced
 * count is printed beside every cost.
 */
function printModelMagnitudes(db: Database): void {
	heading("TOP MODELS BY REQUEST COUNT (all time, from the fact table)");
	out();
	out("A cost of $0.00 with unpriced > 0 is unknown spend, not free spend.");
	out();

	const rows = db
		.query(
			`SELECT model,
			        provider,
			        COUNT(*)                                  AS requests,
			        SUM(input_tokens)                         AS fresh,
			        SUM(cache_read_tokens)                    AS cache_read,
			        SUM(cache_write_tokens)                   AS cache_write,
			        SUM(output_tokens)                        AS output,
			        SUM(cost_total)                           AS cost,
			        SUM(CASE WHEN cost_total = 0
			                  AND (input_tokens + output_tokens
			                       + cache_read_tokens + cache_write_tokens) > 0

			                 THEN 1 ELSE 0 END)             AS unpriced
			 FROM messages
			 GROUP BY model, provider
			 ORDER BY requests DESC
			 LIMIT ?`,
		)
		.all(TOP_MODELS) as Record<string, number | string>[];

	const headers = ["model", "provider", "requests", "fresh", "cache-read", "cache-write", "cost $", "unpriced"];
	const body = rows.map((r) => [
		String(r.model),
		String(r.provider),
		formatCount(Number(r.requests)),
		compact(Number(r.fresh)),
		compact(Number(r.cache_read)),
		compact(Number(r.cache_write)),
		Number(r.cost).toFixed(2),
		formatCount(Number(r.unpriced)),
	]);
	const widths = headers.map((h, i) => Math.max(h.length, ...body.map((r) => r[i].length)));

	out(headers.map((h, i) => h.padEnd(widths[i])).join("  "));
	out(widths.map((w) => "-".repeat(w)).join("  "));
	for (const row of body) out(row.map((c, i) => c.padEnd(widths[i])).join("  ").trimEnd());

	// The same split for output tokens, which no single "total tokens" figure
	// can carry honestly.
	const totals = db
		.query(
			`SELECT SUM(input_tokens) AS fresh, SUM(cache_read_tokens) AS cache_read,
			        SUM(cache_write_tokens) AS cache_write, SUM(output_tokens) AS output,
			        SUM(cost_total) AS cost
			 FROM messages`,
		)
		.get() as Record<string, number>;
	const fresh = Number(totals.fresh);
	const cacheRead = Number(totals.cache_read);
	// Cache writes are deliberately OUT of the denominator (CONTEXT.md).
	const cacheRate = fresh + cacheRead > 0 ? (cacheRead / (fresh + cacheRead)) * 100 : 0;

	out();
	out(`all-time: fresh ${compact(fresh)} | cache-read ${compact(cacheRead)} | cache-write ${compact(Number(totals.cache_write))} | output ${compact(Number(totals.output))}`);
	out(`cache rate ${cacheRate.toFixed(2)}%  (cache-read / (fresh + cache-read); writes excluded)`);
	out(`recorded cost $${Number(totals.cost).toFixed(2)}  —  a FLOOR, because unpriced requests are excluded`);
}

/** Billions compress to "2.39B"; below 1000 the exact count is more useful. */
function compact(n: number): string {
	const abs = Math.abs(n);
	if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
	if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
	if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
	return formatCount(n);
}

async function main(): Promise<number> {
	const dbPath = getStatsDbPath();
	const before = fileStamp(dbPath);

	heading("DATABASE");
	out(`path          ${dbPath}`);
	out(`before        ${formatStamp(before)}`);

	if (!before) {
		out();
		out(`No stats database at ${dbPath}.`);
		out("Run omp once so it records usage, or redirect the root with HOME=<dir>.");
		out("`OMP_PROFILE` moves the AGENT directory, not stats.db — the database always");
		out("sits at <config root>/stats.db, and `PI_CONFIG_DIR` is a NAME joined onto the");
		out("home directory, never an absolute path.");
		return 0;
	}

	const db = new Database(dbPath, { readonly: true });
	try {
		printTableCounts(db);
		printModelMagnitudes(db);
		await printRangeTimings();

		heading("ROLLUP STATUS");
		const status = getRollupStatus();
		out(`getRollupStatus()  ${JSON.stringify(status)}`);
		const newest = newestSessionMtime();
		out(
			newest
				? `newest session   ${new Date(newest.mtimeMs).toISOString()}  ${newest.file}`
				: `newest session   none found under ${path.join(os.homedir(), ".omp", "agent", "sessions")}`,
		);
		if (newest) {
			// The question Task 2 exists to answer: does the host already ingest?
			// If the newest session file is newer than the database itself, the
			// host has NOT synced it and Task 12's subprocess earns its cost.
			const sessionIsNewer = newest.mtimeMs > before.mtimeMs;
			out();
			out(
				sessionIsNewer
					? "VERDICT: the newest session file is NEWER than stats.db — the host does"
					: "VERDICT: stats.db is at least as new as the newest session file — the host",
			);
			out(
				sessionIsNewer
					? "NOT sync on our behalf. Background ingest (Task 12) is still required."
					: "may already sync for us. Re-run right after a heavy session to confirm;",
			);
			if (!sessionIsNewer) out("if it still holds, Task 12's subprocess can be deferred.");
		}
	} finally {
		db.close();
	}

	heading("READ-ONLY PROOF");
	const after = fileStamp(dbPath);
	out(`before        ${formatStamp(before)}`);
	out(`after         ${formatStamp(after)}`);
	out(`mtime changed ${before.mtimeMs !== after?.mtimeMs}`);
	out(`size changed  ${before.size !== after?.size}`);
	out();
	out("All SQL in this script ran on a `{ readonly: true }` connection, which cannot");
	out("create the -wal/-shm sidecars either. The aggregator's own handle is opened");
	out("by initDb() with write intent but performs no mutation — the stamps above are");
	out("the checkable version of that claim.");
	return 0;
}

process.exit(await main());