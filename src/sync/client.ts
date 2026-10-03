import { join } from "node:path";

/**
 * Wire protocol for the ingest subprocess, and the parent-side spawn/kill glue.
 *
 * `bun:sqlite` is synchronous, so the session sync that seeds the panel holds
 * the event loop for its entire duration — 7141 ms measured at 3401 files and
 * 151,107 rows. Running it inline froze the TUI for the whole load, which is
 * why the first-party `/usage` view does exactly what this module does: the
 * expensive work lives in a one-shot child, and this file spawns it, reads its
 * progress, and tears it down. See ADR 0006.
 *
 * This module deliberately contains NO reference to the aggregator and opens no
 * database handle. That is structural, not stylistic: the parent has no seam
 * through which the expensive synchronous sync could be reached, so there is no
 * code path that can put it back on the TUI thread. `test/sync.test.ts` asserts
 * the absence directly against this file's source.
 *
 * SYNC LIFECYCLE — exactly when cached rows paint vs refreshed rows, what the
 * user sees during the ~7s ingest, what happens on error.
 *
 * Mirrors the web's settled/loading/error states (`useQuery` in
 * `client/data/query.ts`, `LiveChip` in `client/app/LiveChip.tsx`) as far as a
 * panel with no always-on server can:
 *
 *  1. CACHED ROWS PAINT FIRST. The panel's `#load()` awaits the extension
 *     start-up warm, then `fetchFor()` reads the database as it stands; the
 *     worker in `scripts/sync-worker.ts` never blocks that paint ("whatever
 *     the database already holds is valid"). Web equivalent: `useQuery` serves
 *     its per-key cache instantly, skeletons only when nothing is cached.
 *  2. SYNC STARTS ONLY ON `s`. `#beginSync()` spawns this module's one-shot
 *     child; there is no watcher, no interval, no connect trigger. The web's
 *     `StatsLive.start()` auto-syncs on first `/api/events` connect plus a
 *     transcript watcher and a 5-minute resync — none of which exist here, by
 *     design: there is no server process to own them. Dirty-hour counts in the
 *     header are the only staleness nudge.
 *  3. DURING INGEST the rows on screen are FROZEN and the header carries the
 *     progress line (`describeSyncProgress`): `Scanning sessions` /
 *     `Ingesting sessions N%` + bar where the worker reports a denominator,
 *     indeterminate otherwise (scan reports total 0; rollup reports remaining
 *     only). Web equivalent: `LiveChip` Syncing current/total, then
 *     `Indexing Nh left`. There is NO mid-sync refetch here — the web bumps a
 *     data version per committed batch and every query revalidates; this panel
 *     reloads exactly once, on `done`.
 *  4. `activity` EVENTS DELIVER WITHOUT SETTLING. The worker's opening and
 *     closing snapshots reach every listener, but only `done` calls `#load()`.
 *     Pinned by `test/sync.test.ts` ("activity snapshots reach listeners
 *     without settling the sync").
 *  5. ON `done` the panel reloads: every number on screen is one sync out of
 *     date until that reload lands. `startIngest` notifies listeners BEFORE
 *     the handle settles so the `done` rollup status cannot be missed.
 *  6. ON `error` the handle REJECTS with the worker's message and every
 *     listener still receives the event first — the panel keeps the stale rows
 *     it already had; the rejection IS the error surface. A child that exits
 *     with neither `done` nor `error` rejects naming its pid. Pinned by
 *     `test/sync.test.ts` ("an error event rejects…", "a child that exits
 *     without done or error…").
 *  7. ABORT IS A NORMAL CLOSE. Signal abort kills the child (SIGKILL — the
 *     sync lock has no cancellation) and RESOLVES, so teardown surfaces no
 *     error. Shared `inflight` dedupes concurrent callers onto one child.
 */
import type { DailyActivityPoint } from "@oh-my-pi/omp-stats/shared-types";
import type { RollupStatus } from "@oh-my-pi/omp-stats/rollup";

export type SyncEvent =
	| { type: "progress"; phase: "scan" | "ingest" | "rollup"; current: number; total: number; sessionFile?: string }
	| { type: "activity"; points: DailyActivityPoint[] }
	| { type: "done"; rollup: RollupStatus }
	| { type: "error"; error: string };

export interface IngestHandle {
	/** SIGKILL the child. Idempotent, and safe after the sync has settled. */
	kill(): void;
	/** Resolves when the child reports `done`; rejects on `error` or a dead child. */
	readonly settled: Promise<void>;
}

/**
 * The slice of a child process this module uses. Narrow on purpose: tests
 * substitute a fake so the suite never performs a real 7-second sync.
 */
export interface SyncChild {
	readonly pid: number | undefined;
	readonly stdout: ReadableStream<Uint8Array> | null;
	readonly stderr: ReadableStream<Uint8Array> | null;
	kill(signal?: number | NodeJS.Signals): void;
}

export type Spawner = () => SyncChild;

const WORKER_PATH = join(import.meta.dir, "../../scripts/sync-worker.ts");

function spawnWorker(): SyncChild {
	const proc = Bun.spawn([process.execPath, "run", WORKER_PATH], {
		stdout: "pipe",
		stderr: "pipe",
		// One-shot: a request is in flight until the child is killed, so the child
		// must stay referenced or an idle parent loop can starve its stdout reads.
		stdin: "ignore",
	});
	return {
		pid: proc.pid,
		stdout: proc.stdout as ReadableStream<Uint8Array>,
		stderr: proc.stderr as ReadableStream<Uint8Array>,
		kill: signal => proc.kill((signal ?? "SIGKILL") as never),
	};
}

/**
 * Parse one NDJSON line. Returns null for anything malformed rather than
 * throwing, so a partially-written final line from a killed child degrades to
 * "no event" instead of crashing the panel mid-paint.
 */
export function parseSyncLine(line: string): SyncEvent | null {
	const trimmed = line.trim();
	if (!trimmed) return null;
	let raw: unknown;
	try {
		raw = JSON.parse(trimmed);
	} catch {
		return null;
	}
	if (typeof raw !== "object" || raw === null) return null;
	const o = raw as Record<string, unknown>;
	switch (o.type) {
		case "progress": {
			const phase = o.phase;
			if (phase !== "scan" && phase !== "ingest" && phase !== "rollup") return null;
			if (typeof o.current !== "number" || typeof o.total !== "number") return null;
			if (!Number.isFinite(o.current) || !Number.isFinite(o.total)) return null;
			const event: SyncEvent = { type: "progress", phase, current: o.current, total: o.total };
			if (typeof o.sessionFile === "string") event.sessionFile = o.sessionFile;
			return event;
		}
		case "activity":
			return Array.isArray(o.points) ? { type: "activity", points: o.points as DailyActivityPoint[] } : null;
		case "done": {
			const rollup = o.rollup as RollupStatus | undefined;
			if (!rollup || typeof rollup.dirtyHours !== "number" || typeof rollup.dirtySessions !== "number")
				return null;
			return { type: "done", rollup };
		}
		case "error":
			return typeof o.error === "string" ? { type: "error", error: o.error } : null;
		default:
			return null;
	}
}

interface Ingest {
	handle: IngestHandle;
	listeners: Set<(event: SyncEvent) => void>;
}

/**
 * At most one ingest child exists at a time. Three panels opening in the same
 * tick share one sync rather than racing three writers for the same lock, and
 * each late caller still receives the full event stream.
 */
let inflight: Ingest | null = null;

/**
 * Start (or join) the background ingest. `onEvent` receives every streamed
 * event; `signal` aborting kills the child. Returns a handle for the caller to
 * kill on close.
 */
export function startIngest(
	onEvent: (event: SyncEvent) => void,
	signal?: AbortSignal,
	spawn: Spawner = spawnWorker,
): IngestHandle {
	if (inflight) {
		inflight.listeners.add(onEvent);
		return {
			kill: () => inflight?.handle.kill(),
			settled: inflight.handle.settled,
		};
	}
	if (signal?.aborted) {
		return { kill: () => {}, settled: Promise.resolve() };
	}

	const { promise, resolve, reject } = Promise.withResolvers<void>();
	const listeners = new Set<(event: SyncEvent) => void>([onEvent]);
	let settled = false;
	let killed = false;

	const child = spawn();

	const finish = (): void => {
		if (settled) return;
		settled = true;
		// Always tear the child down, whichever way we leave: a `done` child has
		// nothing left to do, and an aborted one must not keep the lock.
		kill();
		inflight = null;
		resolve();
	};

	const fail = (error: Error): void => {
		if (settled) return;
		settled = true;
		kill();
		inflight = null;
		reject(error);
	};

	function kill(): void {
		if (killed) return;
		killed = true;
		// SIGKILL, not SIGTERM: the child may be inside `withStatsSyncLock`, which
		// has no cancellation and would ignore a polite request. Killing is safe —
		// per-file writes are transactional and the OS-owned lock is released with
		// the process.
		try {
			child.kill("SIGKILL");
		} catch {
			// Already reaped; nothing to do.
		}
	}

	const handle: IngestHandle = { kill, settled: promise };

	void (async () => {
		if (child.stdout) {
			// An explicit decoder rather than TextDecoderStream: the stream types
			// disagree on the buffer generic under this tsconfig's lib.
			const decoder = new TextDecoder();
			const reader = child.stdout.getReader();
			let buffer = "";
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				// A killed child can leave a final line without a newline. That
				// partial line parses to null, which is the intended degradation.
				let nl: number;
				while ((nl = buffer.indexOf("\n")) >= 0) {
					const line = buffer.slice(0, nl);
					buffer = buffer.slice(nl + 1);
					const event = parseSyncLine(line);
					if (!event) continue;
					// `done` carries the rollup status the panel needs for its
					// dirty-hour count, so every listener is notified BEFORE the handle
					// settles — a caller awaiting `settled` must not miss it.
					for (const listener of listeners) listener(event);
					if (event.type === "error") return fail(new Error(event.error));
					if (event.type === "done") return finish();
				}
			}
		}
		// stdout closed with neither `done` nor `error`: the child died mid-sync.
		if (!settled) fail(new Error(`ingest worker exited without reporting done (pid ${child.pid ?? "?"})`));
	})();

	const onAbort = (): void => {
		// Aborting is a normal close, not a failure: resolve rather than reject so
		// the panel's teardown does not surface an error it asked for.
		kill();
		inflight = null;
		if (!settled) {
			settled = true;
			resolve();
		}
	};
	signal?.addEventListener("abort", onAbort, { once: true });

	inflight = { handle, listeners };
	// Drop the listener so a long-lived signal cannot retain this ingest.
	promise.then(
		() => signal?.removeEventListener("abort", onAbort),
		() => signal?.removeEventListener("abort", onAbort),
	);
	return handle;
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