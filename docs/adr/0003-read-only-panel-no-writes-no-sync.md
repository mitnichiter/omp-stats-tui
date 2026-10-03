# The panel is read-only: it never writes and never triggers ingest

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