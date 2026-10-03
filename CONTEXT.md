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
a view claims. Choosing a seam is the design decision; what sits behind it is not.

**Symbol preset**:
The person's choice of glyph repertoire — `unicode`, `nerd`, or `ascii`. It is a setting and never a
detection: nothing probes the terminal to guess which repertoire is safe.
_Not to be confused with_: capability detection. Colour depth and cell size can be detected; whether a
glyph exists cannot.

**Data ink**:
The glyphs that carry a magnitude — bar fills, ramp steps, heat cells — as distinct from the chrome drawn
around them. Data ink must read correctly under every symbol preset; chrome only has to match the panel.
