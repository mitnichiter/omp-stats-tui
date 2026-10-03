# Read the stats database with our own SQL over a read-only handle, not the omp-stats package

`@oh-my-pi/omp-stats` cannot be imported by name from an extension in omp 18.4.10: the host's resolver
allowlist covers seven `pi-*` packages and does not include it, so the bare specifier falls out of the
host shim, misses the upward `node_modules` walk, and lands on Bun's flat install cache, which lacks the
sibling native addon the package needs. We therefore open `~/.omp/stats.db` with the `bun:sqlite` builtin
in read-only mode and write the ~150–250 lines of rollup SQL ourselves. Measured on a 304 MB database, that
path opens in 0.1 ms and answers the rollup queries in 0.1–1.0 ms, against 1.2–31.5 ms through the
package's own getters plus an 864 ms first-call `initDb()` that opens the file read-write.

## Considered Options

- **Call the package's HTTP handler in-process with a synthetic request.** Genuinely socket-free and
  reusable, but it is only reachable by absolute filesystem path into another package's source tree —
  machine-specific, silently broken on version skew — and it still pays `initDb()`.
- **Declare the package as a real dependency and let the installer place it.** Measured working at a
  168 ms install, but it makes the plugin depend on an install step and pins it to one host version.
- **Own the SQL, read-only.** Chosen: zero dependency risk, zero write intent, an order of magnitude
  cheaper per query, and no dependency on a resolver behaviour we do not control.

## Consequences

We now own the rollup union (clean rollup hours plus raw rows for the partial hour at the range start and
for dirty hours) and the aggregate column list, whose mixes of `SUM` for counts and `TOTAL` for money are
load-bearing. We lose automatic compatibility with upstream schema changes, so a schema-version assertion
is mandatory rather than optional, and a rollup version bump must be checked against the live schema before
the panel trusts a number.