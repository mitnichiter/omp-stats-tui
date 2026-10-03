/**
 * Stats ingest worker. Runs as a one-shot child process spawned by
 * `src/sync/client.ts`. Owns the stats DB handle so the synchronous SQLite work
 * never runs on the TUI thread; the parent SIGKILLs this process once `done`
 * arrives. Mirrors pi-coding-agent/src/stats/activity-worker.ts.
 *
 * Emits one JSON object per line on stdout. Writes nothing to stderr on the
 * happy path — stderr is the crash channel and the parent surfaces its tail.
 *
 * WHY A SUBPROCESS AND NOT AN ABANDONED PROMISE. `syncAllSessions` takes an OS
 * file lock via `withStatsSyncLock`, which polls every 25 ms for 144,000
 * attempts (one hour) before it throws. That wait is `await`-based, so it blocks
 * without deadlocking — but it has NO CANCELLATION whatsoever. There is no
 * signal to abort it and no way to shorten the hour. On a TUI thread that wait
 * would pin the event loop for up to an hour with no way out. A child process is
 * the only thing that can be torn down unconditionally: SIGKILL is immediate,
 * unignorable, and needs no cooperation from the code holding the lock.
 *
 * Killing this process mid-sync is SAFE, which is what makes the kill path
 * legitimate rather than a crash to apologise for. Per-file writes are
 * transactional, and the OS-owned sync lock is a file descriptor released with
 * the process. A half-finished sync leaves the database exactly as a half-
 * finished sync always does: the next run picks up from the file offsets that
 * did commit. See ADR 0006 and activity-client.ts:53-59.
 */
import { syncAllSessions, type SyncProgress } from "@oh-my-pi/omp-stats/aggregator";
import { getDailyActivity } from "@oh-my-pi/omp-stats/db";
import { getRollupStatus, refreshRollups } from "@oh-my-pi/omp-stats/rollup";

const emit = (o: unknown): void => {
	process.stdout.write(JSON.stringify(o) + "\n");
};

try {
	// Whatever the database already holds is valid, so the panel's first paint
	// costs nothing here and is not held hostage to this sync.
	emit({ type: "activity", points: await getDailyActivity() });

	emit({ type: "progress", phase: "scan", current: 0, total: 0 });
	await syncAllSessions({
		onProgress: (p: SyncProgress) => {
			emit({
				type: "progress",
				phase: "ingest",
				current: p.current,
				total: p.total,
				sessionFile: p.sessionFile,
			});
		},
	});

	// `refreshRollups` reports only the REMAINING backlog, with no denominator,
	// so the rollup phase is necessarily indeterminate to the panel.
	emit({ type: "progress", phase: "rollup", current: 0, total: getRollupStatus().dirtyHours });
	await refreshRollups({
		onProgress: (remaining: number) => {
			emit({ type: "progress", phase: "rollup", current: 0, total: remaining });
		},
	});

	// Push refreshed activity so a heatmap painted from cached rows converges,
	// exactly as activity-worker.ts does.
	emit({ type: "activity", points: await getDailyActivity() });
	emit({ type: "done", rollup: getRollupStatus() });
} catch (error) {
	// A failure here is reported as an event, never as a silent exit: the parent
	// rejects on it, and the panel keeps showing the numbers it already has.
	emit({ type: "error", error: error instanceof Error ? error.message : String(error) });
	process.exitCode = 1;
}