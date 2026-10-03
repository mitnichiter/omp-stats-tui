# Ingest runs in the background, in a subprocess the panel SIGKILLs

Status: accepted. Supersedes ADR 0003 on the sync clause only; the rest of ADR 0003 stands.

ADR 0003 made the stats panel read-only and refused to trigger ingest. We reverse that refusal: on
open, the panel paints from whatever the database already holds, then starts a background ingest in a
child process that streams progress and is `SIGKILL`ed when the panel closes. The reason is parity,
not necessity. Both existing surfaces already ingest in the background and never block their first
paint: `startServer` (`omp-stats/src/server.ts:485`) drives the live ingest hub, whose header says
"The dashboard never waits for ingest" (`omp-stats/src/live.ts:5`), and the TUI `/stats` command
returns from `launchStatsDashboard` (`pi-coding-agent/src/slash-commands/helpers/stats-dashboard.ts:78`)
with a message that reads `(sessions sync in the background)` (`stats-dashboard.ts:99`). A `/stats`
replacement that shows different hours than `/stats` would read as a bug, so parity wins the argument
that the panel does not need the freshness.

Ingest must be out-of-band because it is genuinely expensive and genuinely synchronous. Measured,
`syncAllSessions` takes 7141 ms for 3401 files and 151,107 rows on a warm page cache and really
writes: the probe's database copy grew from 305.6 MB to 307.1 MB with a changed mtime (F9 §3).
Because `bun:sqlite` is synchronous, running that inline holds the TUI event loop for the full seven
seconds. The first-party `/usage` view already solves this and says why in its own words:
"`bun:sqlite` is synchronous, so the daily-activity aggregate ... and the session sync that precedes
its refresh run in a child process — on a multi-GB stats database each query stalls the event loop for
seconds, which froze the TUI for the whole load when it ran inline"
(`pi-coding-agent/src/stats/activity-protocol.ts:3-7`). Its worker "Owns the stats DB handle ... so the
synchronous SQLite work never runs on the TUI thread; the parent SIGKILLs the child once `done`
arrives" (`activity-worker.ts:1-7`), and its client notes that aborting the signal "kills it mid-sync —
per-file writes are transactional and the OS-owned sync lock is released with the process"
(`activity-client.ts:53-59`). We copy that shape rather than invent one.

This reverses an earlier recommendation, and it is worth being explicit about why. F9 advised to
"prefer not calling `syncAllSessions` from the TUI at all unless the host has not already synced"
(F9, Recommendation), and ADR 0003 rejected a background subprocess on those grounds. What changed is
the unit of comparison: `/stats` is the command this panel exists to replace, and a user typing
`/stats-tui` expects the behaviour they already have from `/stats`. The cost also turned out to be an
idiom that already exists first-party rather than a design to be made.

## Considered Options

- **No sync at all.** ADR 0003's position, and still defensible on its own terms. Rejected because it
  makes the panel disagree with `/stats` about what it is showing, which is the one thing a
  replacement cannot do.
- **Sync on a key binding only.** Rejected: the settled decision is background ingest by default. A
  manual trigger could be added later without conflict, but it cannot be the only path.

## Consequences

We pay for a subprocess, a line-delimited progress protocol, and a kill path — Task 12 of the plan.
The benefit is that the stats panel agrees with `/stats` and `omp stats` about what it shows. The risk
is two writers contending for one database: the panel's ingest and the host's own, if it has one.
`omp-stats` already opens the database with `PRAGMA busy_timeout = 5000` and `PRAGMA journal_mode =
WAL` (`omp-stats/src/db.ts:124-125`), so contention is bounded by a 5-second busy timeout under
readers and writers rather than by an error.

The sync lock is not the hazard ADR 0003 took it to be. `withStatsSyncLock`
(`omp-stats/src/aggregator.ts:75`) polls every 25 ms for 144,000 attempts — one hour — before
throwing, but the wait is `await`-based and a 4-second holder was acquired after 3660 ms (F9 §5).
It blocks; it does not hang. What it lacks is cancellation, which is exactly why the worker is a
process we can `SIGKILL` rather than a promise we abandon.

**Still binding from ADR 0003**, restated here so the supersession is not read as a repeal: the panel
itself never writes to the database — its own handle stays read-only; ingest never runs on the TUI
thread; and the dirty-hour count from `getRollupStatus()` is always visible, so a stale panel says so
rather than presenting not-yet-built hours as `$0.00`.

**Open.** Whether the host already calls `syncAllSessions` before an extension runs was never
determined (F9, Gaps §6). If it does, this subprocess is redundant and the panel could drop it. One
run of `scripts/probe-data.ts` immediately after a heavy session, comparing
`getRollupStatus().dirtyHours` against the mtime of the newest session file, settles it.