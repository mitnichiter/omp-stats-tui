# The command is `/stats-tui`, not `/stats`

`/stats` is a built-in slash command that launches the browser dashboard, and the host dispatches built-ins
before extension commands. An extension registering `/stats` therefore appears in the command palette and
never executes — the worst kind of bug, because it looks like it works. We register `/stats-tui` instead,
so our command is reachable by the name the user types.

## Consequences

There is no collision and no override path either: we can never take over `/stats`, and if the host ever
improves `/stats` natively our command is redundant rather than an upgrade. A user who types `/stats`
still gets the browser. This also means the two surfaces coexist, and the distinction between them is a
real vocabulary problem, not a naming preference.