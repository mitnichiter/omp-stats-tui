# omp stats in the terminal

The vocabulary for reading one person's own agent usage: what was recorded, what each recorded thing
actually means, and what a terminal panel is allowed to claim about it. Every term here exists because a
looser word for it was already in use and the looser word was wrong.

## Language

### Packaging

**Extension**:
A module the host loads at startup and calls once, so that it can register commands, tools, hooks and
user interface into the running agent.
_Avoid_: Plugin, Add-on, Integration

**Plugin**:
A distribution container — an installable package that carries extensions and other resources to a user.
The plugin is how an extension travels; the extension is what runs once it has arrived.
_Not to be confused with_: extension. A plugin may carry several extensions, and carries none of them
running.

**Built-in command**:
A command the host provides itself, which the host resolves before any extension command of the same name.
An extension that claims a built-in's name appears in the command palette and is never run.
_Not to be confused with_: extension command.

### What was recorded

**Request**:
One API call to a provider — the atom from which every token, cost and latency figure is counted. A request
may succeed, fail, or carry tokens with no recorded price, and each of those is still one request.
_Avoid_: Message, Query, Completion. "Message" means a chat item elsewhere in this system (see User message),
and a row of this kind is not one.

**User message**:
Something the person actually typed, recorded apart from anything the agent said. It carries no model, no
tokens and no cost of its own.
_Not to be confused with_: Request. One user message is answered by many requests.

**Turn**:
One typed prompt together with everything the agent did in answer to it — many requests and many tool calls.
The unit a person recognises as "one thing I asked for".
_Not to be confused with_: assistant turn.

**Assistant turn**:
The batch of tool calls a single assistant response emitted. The whole batch shares one request's usage, so
per-tool token and cost figures are shares of that request, not measurements of each call.
_Avoid_: Turn

**Tool call**:
One invocation of one tool, recorded against the assistant turn that asked for it.

**Session**:
One session file — a conversation's persisted history, and the unit that ingestion reads and reconciles. Every
request, user message and tool call belongs to exactly one session, even when a subagent produced it.

**Agent type**:
Which agent produced a request: the main agent, a task subagent, or an advisor. Subagent work lands in the
same session as the main agent's; agent type is how it is told apart.

**Ingest**:
The write path that reads session files and records their requests, tool calls and user messages, then
refreshes the rollups. Everything readable downstream of it is exactly as fresh as ingest left it.

### Facts and rollups

**Fact table**:
Per-event rows — one row per request, one per tool call, one per typed prompt. Exact and complete, and
expensive to aggregate over a long window.

**Rollup table**:
Hourly buckets holding pre-summed, additive figures over the same events. Reading a window from rollups
instead of facts is orders of magnitude cheaper, and is the reason a rollup exists at all. Rollups are
marked dirty by trigger whenever a fact changes and are rebuilt afterwards, so a rollup table can lag behind
the facts it summarizes.
_Not to be confused with_: fact table. The two are not interchangeable: a rollup row cannot be asked a
question a fact row can, and its absence means "not yet built" rather than "did not happen".

**Dirty hour**:
An hour whose rollup rows are stale or not yet built. While few are dirty, a reader can union them with the
facts and stay exact; past a threshold it stops and reports stale rows with holes in them.
_Avoid_: Staleness, stale data. There is a specific count of hours that are behind, and it is knowable.

**Range**:
The window a view reads, drawn from a fixed set — `1h`, `24h`, `7d`, `30d`, `90d`, `all`. A range fixes both
where the window starts and the width of the buckets its answer is grouped into.

**Bucket**:
The slice of time one column or one row of a series stands for. Bucket width decides which table an answer is
read from: an hourly or wider bucket is answered from rollups, and anything narrower falls back to facts.
_Avoid_: Granularity, interval.

### Money

**Fresh tokens**:
Input tokens billed at the full input price because the cache did not supply them.

**Cache-read tokens**:
Input tokens the cache supplied from an earlier identical prompt, billed at the cache-read price.

**Cache-write tokens**:
Input tokens written into the cache, billed at the cache-write price. They are neither fresh tokens nor a
cache hit, and they are outside the denominator of the cache rate.
_Not to be confused with_: cache-read tokens. A write is an investment in future reads, not a read.

**Cache rate**:
Cache-read tokens as a share of fresh plus cache-read input tokens. It is not "how much of the input was
cached": cache writes never enter the denominator, so the rate can read low while the cache is doing most of
the work.
_Not to be confused with_: cache savings.

**Cache savings**:
The money saved by caching rather than billing the same tokens uncached — a ratio, not a token count, and
negative when cache writes cost more than cache reads save.

**Cost**:
The money actually recorded against a request. It under-reports whenever any request went unpriced, so a
cost figure shown without its unpriced count beside it is a wrong number, not a rounded one.

**Unpriced request**:
A request whose recorded cost is zero because the price could not be determined — not because nothing was
spent. Its spend is unknown, which makes every total that contains it a floor rather than a figure.
_Not to be confused with_: free request. Nothing here is free; some of it is merely unmeasured.

### The two surfaces

**Stats panel**:
A full-screen, read-only view of the person's own usage, drawn inside the terminal from what the database
already holds.
_Not to be confused with_: stats dashboard.

**Stats dashboard**:
A multi-screen browser view over the same records, reached through a separate command that starts a local
server. It is a different application, not a source for the panel.

**Overlay**:
A component composited over the mutable viewport, sharing the terminal with the conversation underneath it.

**Fullscreen overlay**:
An overlay that borrows the terminal's alternate screen buffer, so it claims the whole screen and leaves the
conversation untouched beneath it.

**Seam**:
A place where behaviour can be altered without editing the thing that holds it. Three seams matter here:
the data seam, which decides whether an answer is read from rollups or from facts; the view seam, which
decides how a set of rows becomes lines of text; and the mount seam, which decides how much of the terminal

### The layout IR

**Band**:
The unit of vertical layout a screen is composed from — `statRow`, `chart`, `table`, `legend`,
`note`, or `custom` (`src/layout/spec.ts`). A screen is a vertical stack of bands with exactly one
blank line between consecutive bands, and no band body may emit a full-width rule
(`src/tui/band.ts` G4–G5).
_Not to be confused with_: a web card. A card carries its own border and header; a band carries
neither and gets both from the grammar.

**ScreenSpec**:
One screen's declared layout: its id, labels, `needs`, and `Band[]` (`src/layout/spec.ts`).
The tab strip, the screen registry and the fetch needs all read the same specs, so there is one
source of truth rather than three lists that can disagree.
_Not to be confused with_: the registry's `Screen` record, which carries identity and contract and
defers rendering to the pipeline.

**MetricRef**:
A declared read of one figure — which payload, which field, which row (`src/layout/spec.ts`).
The IR says what a tile measures; `src/layout/resolve.ts` says how that declaration reads against
real data. A value that cannot be resolved is `null`, never a blank cell a human has to notice.
_Not to be confused with_: a formatter. A ref names the value; a formatter decides how it reads.

**Resolve**:
The act of answering a `MetricRef` from a payload (`resolveCell` / `resolveNumber` /
`resolveLabel` in `src/layout/resolve.ts`). The only place numbers become strings.

**Resolver**:
The test harness's name for the same code: `test/parity.test.ts` calls the web's own functions
and asserts the resolver answers identically on one shared fixture.

**Parity**:
Agreement with the web dashboard on the same input, checked by machine rather than by eye.
`test/parity.test.ts` calls the web's functions from `@oh-my-pi/omp-stats` and asserts our
answers match, so "we show the same number" is a test result rather than a claim.
_Not to be confused with_: pixel equivalence. Parity is about figures, not about drawing.

**Symbol preset**:
The person's choice of glyph repertoire — `unicode`, `nerd`, or `ascii`. It is a setting and never a
detection: nothing probes the terminal to guess which repertoire is safe.
_Not to be confused with_: capability detection. Colour depth and cell size can be detected; whether a
glyph exists cannot.

**Data ink**:
The glyphs that carry a magnitude — bar fills, ramp steps, heat cells — as distinct from the chrome drawn
around them. Data ink must read correctly under every symbol preset; chrome only has to match the panel.


**Frame band**:
The width class a total terminal width falls into — `wide`, `medium`, `narrow`, `tiny`
(`src/tui/responsive.ts`). Each band fixes what chrome the frame may spend: a full sidebar, an icon
rail, or none; and a full, condensed or minimal topbar. The band is derived from the breakpoint table
(`BREAKPOINTS` in `src/tui/layout.ts`) rather than restated beside it, so a retuned threshold flows
through. Do not confuse it with a band in the layout IR, which is vertical space rather than width.

**Frame policy**:
One width's answer: its frame band, sidebar and topbar modes, column count and whether a hint row fits
(`framePolicy` in `src/tui/responsive.ts`). It states no geometry — `planLayout` owns that — and it must
always agree with `planLayout` at the same width.

**Loading state**:
The panel's statement that a figure has not arrived yet. It is distinct from an empty result, and an
empty result is distinct from an error, and the three are never merged. On the activity calendar a
day with no requests is an empty day and reads as an empty cell; an entire empty range is "nothing
recorded" and is stated in words, not drawn as a field of zero-day cells that would read as a quiet
year; a payload that never arrived says so (`src/tui/screens/activity.ts`). A fetch that fails is not
one of these states at all — it reaches the panel's own error phase, because `fetchFor` throws rather
than returning a degraded payload.

_Deliberate deviation_: `/usage` renders a fetched-but-empty range as a zero-filled grid. We state it
instead. A grid of empty cells is a claim about someone's usage, and a wrong one, where one line of
words is not. Where a host view does pin wording we reuse it — the summary line's dim ` · syncing…`
suffix is such a case (`src/tui/render/screen.ts`, host `usage-dashboard.ts:847`).
