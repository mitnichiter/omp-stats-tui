# Stats reads and live ingest share a persistent isolated subprocess

Status: persistent isolated read/live worker **accepted**; the original one-shot subprocess details and historical freshness uncertainty below are superseded by the [dashboard-parity roadmap](../plans/2026-10-05-dashboard-parity.md).

## Current execution contract

One `StatsReadClient` per mounted panel owns `scripts/data-worker.ts`. The worker initializes the upstream DB, runs synchronous queries/transcript reads and owns patched upstream `StatsLive({ workers: 1 })`, which performs initial ingest and watches transcript changes. Request/reply and unsolicited live status/invalidation use NDJSON pipes. Manual `s` invokes the same live owner's `requestSync()`, not a second one-shot ingest worker. The host source entry performs no DB initialization.

Compiled omp is not standalone Bun. Resolve `bun` on PATH, pass an absolute worker path, inherit host cwd for project/judge configuration, and explicitly pass active agent directory plus `OMP_PROFILE`/`PI_PROFILE` with `PI_BUNDLED` cleared. Source mode resolves `scripts/data-worker.ts` relative to the client; the build substitutes `__STATS_READ_WORKER__` with `./data-worker.js` relative to `dist/index.js`. The bundle owns corrected local stats/private dependencies while supported host UI/theme/native APIs remain external. The committed Bun patch/lockfile ships upstream pricing-v2, rollup-v3, recent-range and provider-output corrections.

The runtime coding-agent dependency provides real standalone judging. Registering its lazy judge provider does not open judge/auth resources or spend; those open only when requested. Cached/regex Frustration is passive. Paid start requires an estimate, explicit `y` confirmation, configured `judge` model role and provider credentials; cancellation is available. No paid smoke is claimed.

The client drains stdout/bounded stderr and awaits process exit, rejects pending requests on failure and keeps useful recovery diagnostics beside cached data. A sync request returns live status, not process completion: the persistent child remains alive to watch and serve reads. Close disposes controllers/watchers/jobs, kills/reaps the child and ignores late responses/errors. Per-query generations protect newer selections.

Initialization can create/migrate/backfill shared records; there is no read-only DB guarantee. Early isolated mounted evidence included automatic ingestion of a root plus two child sessions (eight recorded requests), live refresh, request/associated-trace details and restored terminal/reaped child on close. The parity roadmap records subsequent 612-request, nested-trace, provider/Gain, worker-recovery, theme and installed-package evidence separately from unverified paid/broker scenarios.

## Original rationale

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

The original no-write assertion does not describe current upstream initialization. Ingest must stay off the TUI thread; dirty/unknown data must not be presented as measured zero.

**Historical uncertainty, now resolved for this panel:** whether the host syncs before extensions was not determined by F9. Production does not rely on that ordering: its isolated upstream live owner performs initial ingest, watches transcripts and serves manual sync. The historical rationale is retained above as decision history, not a pending one-shot design.