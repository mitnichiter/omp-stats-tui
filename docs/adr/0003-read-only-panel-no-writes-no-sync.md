# The panel is read-only: it never writes and never triggers ingest

Status: **superseded** by ADR 0006 and the [dashboard-parity roadmap](../plans/2026-10-05-dashboard-parity.md). The persistent isolated worker initializes the upstream DB (which can create/migrate/backfill), owns patched `StatsLive({ workers: 1 })` initial ingest/transcript watching, and handles explicit sync through that same live owner. The host source entry does no DB initialization. Twelve interactive controllers include on-demand request/trace/quota reads and explicit-confirmation paid judging; cached Frustration remains passive. The text below records the original decision, not a current read-only/no-sync guarantee.

The panel shows what is already in the database and nothing more. The database-opening path in the stats
package runs DDL and opens read-write, and the ingest routine takes an OS file lock that polls every 25 ms
for up to one hour before giving up — a panel that triggered it could hang for an hour under contention.
Our own handle is opened read-only, so a write fails immediately rather than blocking or mutating.

## Considered Options

- **Spawn a background sync subprocess on open**, the way `/usage` does. Rejected: it reintroduces a
  write, a subprocess, and a kill protocol, in exchange for freshness the panel does not need to be useful.
- **Offer an explicit "sync now" action.** Rejected for the same reason, deferred: the key is trivial to add
  once the lock behaviour is understood to be safe for a user-initiated call.

## Consequences

The panel can be stale, and the user must never be able to mistake stale for zero. The rollup backlog is
therefore surfaced rather than hidden: the count of dirty hours is part of what the panel says about itself.
A rollup version bump marks every hour dirty, and past the exactness threshold a reader stops unioning
dirty hours and returns stale rows with gaps — presenting those gaps as zeroes would be a lie about money.