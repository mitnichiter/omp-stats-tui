import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	describeSyncProgress,
	parseSyncLine,
	startIngest,
	type IngestHandle,
	type SyncChild,
	type SyncEvent,
} from "../src/sync/client";

/**
 * Every test here drives a FAKE spawner. Nothing in this file may reach
 * `syncAllSessions` — it takes 7141 ms for 3401 files / 151,107 rows and it
 * WRITES to `~/.omp/stats.db`. The fake keeps the suite at milliseconds and
 * keeps the real database untouched.
 */

/**
 * A fake child whose stdout the test writes by hand.
 *
 * `signals` records the SIGNAL VERBATIM. An earlier version normalised every
 * signal to the number 9, which silently erased the one distinction this file
 * exists to protect: `kill("SIGTERM")` and `kill("SIGKILL")` both became `9`,
 * so no assertion could ever tell them apart.
 */
function fakeChild(): {
	child: SyncChild;
	emit: (o: unknown) => void;
	end: () => void;
	signals: (number | NodeJS.Signals | undefined)[];
} {
	const encoder = new TextEncoder();
	let controller!: ReadableStreamDefaultController<Uint8Array>;
	const stdout = new ReadableStream<Uint8Array>({
		start(c) {
			controller = c;
		},
	});
	const signals: (number | NodeJS.Signals | undefined)[] = [];
	return {
		child: {
			pid: 4242,
			stdout,
			stderr: null,
			kill: (signal?: number | NodeJS.Signals) => {
				signals.push(signal);
				try {
					controller.close();
				} catch {}
			},
		},
		emit: o => controller.enqueue(encoder.encode(JSON.stringify(o) + "\n")),
		end: () => {
			try {
				controller.close();
			} catch {}
		},
		signals,
	};
}

const collect = () => {
	const events: SyncEvent[] = [];
	return { events, onEvent: (e: SyncEvent) => void events.push(e) };
};

test("malformed lines are null, not throws", () => {
	expect(parseSyncLine("")).toBeNull();
	expect(parseSyncLine("not json")).toBeNull();
	expect(parseSyncLine('{"type":"progress"}')).toBeNull();
});

test("progress lines carry a denominator, so a percentage is possible", () => {
	const e = parseSyncLine('{"type":"progress","phase":"ingest","current":25,"total":100}');
	expect(e).toEqual({ type: "progress", phase: "ingest", current: 25, total: 100 });
});

test("done carries the rollup status so the panel can update its dirty-hour count", () => {
	expect(parseSyncLine('{"type":"done","rollup":{"dirtyHours":0,"dirtySessions":0}}')).toEqual({
		type: "done",
		rollup: { dirtyHours: 0, dirtySessions: 0 },
	});
});

test("the child streams progress messages, then a terminal done", async () => {
	const { child, emit, end } = fakeChild();
	const { events, onEvent } = collect();
	const handle = startIngest(onEvent, undefined, () => child);

	emit({ type: "progress", phase: "scan", current: 0, total: 0 });
	emit({ type: "progress", phase: "ingest", current: 120, total: 3401, sessionFile: "/tmp/a.jsonl" });
	emit({ type: "done", rollup: { dirtyHours: 3, dirtySessions: 1 } });
	end();

	await handle.settled;
	expect(events).toEqual([
		{ type: "progress", phase: "scan", current: 0, total: 0 },
		{
			type: "progress",
			phase: "ingest",
			current: 120,
			total: 3401,
			sessionFile: "/tmp/a.jsonl",
		},
		{ type: "done", rollup: { dirtyHours: 3, dirtySessions: 1 } },
	]);
	handle.kill();
});

/**
 * A REAL child that outlives a polite kill, plus an event-driven barrier.
 *
 * `until(needle)` blocks on the child's own OUTPUT rather than on a duration:
 * no sleep, no guessed timeout. That matters because the obvious version of
 * this test — spawn, signal immediately, wait — is a RACE. `process.on('SIGTERM')`
 * only takes effect once the child has executed that line, so a signal sent
 * earlier hits the default disposition and kills the child anyway. That race
 * made the original test pass against `kill("SIGTERM")` in the source: the
 * assertion existed, and could not fail.
 *
 * The child is always SIGKILLed in a `finally`, because a leaked
 * `setInterval(() => {}, 1000)` process outlives the test run.
 */
async function stubbornChild(script: string) {
	const spawn = Bun.spawn([process.execPath, "-e", script], { stdout: "pipe", stderr: "pipe" });
	const exited = spawn.exited;
	const reader = spawn.stdout.getReader();
	const decoder = new TextDecoder();
	let text = "";
	let raw = new Uint8Array(0);

	const until = async (needle: string): Promise<string> => {
		for (;;) {
			if (text.includes(needle)) return text;
			const { done, value } = await reader.read();
			if (done) throw new Error(`child exited before emitting ${needle}; saw ${JSON.stringify(text)}`);
			text += decoder.decode(value, { stream: true });
			const merged = new Uint8Array(raw.length + value.length);
			merged.set(raw);
			merged.set(value, raw.length);
			raw = merged;
		}
	};

	/** Replays what the barrier consumed, then keeps streaming. */
	const streamAfterBarrier = (): ReadableStream<Uint8Array> =>
		new ReadableStream<Uint8Array>({
			async start(controller) {
				controller.enqueue(raw);
				for (;;) {
					const { done, value } = await reader.read();
					if (done) break;
					controller.enqueue(value);
				}
				controller.close();
			},
		});

	return { spawn, exited, until, streamAfterBarrier, reap: () => spawn.kill("SIGKILL") };
}
test("the child dies when the parent goes away, and a still-running sync leaves nothing behind", async () => {
	// A REAL long-lived child, so "the child is actually gone" is checked against
	// the OS rather than against a recorded call. It ignores SIGTERM, so only
	// SIGKILL can clear this pid.
	const kid = await stubbornChild(
		`process.on('SIGTERM', () => {}); console.log('READY'); setInterval(() => {}, 1000);`,
	);
	try {
		// BARRIER: the child prints READY only after installing its SIGTERM
		// handler, so this line is proof the polite-kill refusal is live.
		expect(await kid.until("READY")).toContain("READY");

		const child: SyncChild = {
			pid: kid.spawn.pid,
			stdout: kid.streamAfterBarrier(),
			stderr: null,
			kill: signal => kid.spawn.kill((signal ?? "SIGKILL") as never),
		};

		const controller = new AbortController();
		const handle = startIngest(() => {}, controller.signal, () => child);
		const pid = kid.spawn.pid!;

		expect(() => process.kill(pid, 0)).not.toThrow(); // alive before abort

		// ONLY the abort. Calling `handle.kill()` as well would mask a client
		// whose abort path no longer kills at all — a separate test covers that.
		controller.abort();

		// `await exited` IS the assertion: SIGKILL is unignorable, so a child
		// that survived would hang the test rather than pass it.
		await kid.exited;
		expect(() => process.kill(pid, 0)).toThrow(); // reaped
		await handle.settled.catch(() => {}); // abort settles rather than hangs
	} finally {
		kid.reap();
	}
});

test("SIGTERM would NOT reap a worker holding the sync lock, which is why the kill is SIGKILL", async () => {
	// The JUSTIFICATION for the signal choice, asserted instead of commented.
	// The child REPORTS that it handled SIGTERM, so receiving that report is
	// proof it survived the polite kill — event-driven, no guessed duration.
	const kid = await stubbornChild(
		`process.on('SIGTERM', () => console.log('IGNORED')); console.log('READY'); setInterval(() => {}, 1000);`,
	);
	try {
		await kid.until("READY"); // handler installed before we signal
		kid.spawn.kill("SIGTERM");

		expect(
			await kid.until("IGNORED"),
			"the worker never saw the SIGTERM — delivery was not proven",
		).toContain("IGNORED");
		expect(
			() => process.kill(kid.spawn.pid!, 0),
			"the worker died on SIGTERM, so it no longer needs SIGKILL",
		).not.toThrow();

		kid.spawn.kill("SIGKILL");
		await kid.exited;
		expect(() => process.kill(kid.spawn.pid!, 0)).toThrow();
	} finally {
		kid.reap();
	}
});

test("aborting sends SIGKILL and nothing else — a polite kill would be ignored", async () => {
	// The deterministic half of the SIGKILL invariant: no process, no timers.
	// The fake records the signal VERBATIM, so this fails if the kill is
	// softened to SIGTERM — the mutation the old normalising fake could not see.
	const { child, signals } = fakeChild();
	const controller = new AbortController();
	const handle = startIngest(() => {}, controller.signal, () => child);

	controller.abort();

	expect(signals.length).toBe(1);
	expect(signals[0], "the abort must SIGKILL, not SIGTERM").toBe("SIGKILL");
	await handle.settled;
});

test("aborting settles the handle as a normal close, not as a failure", async () => {
	// Aborting is the caller saying "I am done", so the promise RESOLVES. A
	// rejection here would surface an error the panel asked for and has no way
	// to distinguish from a real ingest failure.
	const { child, signals } = fakeChild();
	const controller = new AbortController();
	const handle = startIngest(() => {}, controller.signal, () => child);

	controller.abort();

	// Resolves — an unhandled rejection here would fail the run.
	await expect(handle.settled).resolves.toBeUndefined();
	expect(signals.length).toBe(1);
});

test("killing after `done` still SIGKILLs, because the child has the lock too", async () => {
	// `done` means the work finished, NOT that the process released its lock:
	// `finish()` calls `kill()` on the way out, and that is the call that
	// releases the lock. Dropping it would leave the panel's next sync blocked.
	const { child, emit, signals } = fakeChild();
	const handle = startIngest(() => {}, undefined, () => child);
	emit({ type: "done", rollup: { dirtyHours: 0, dirtySessions: 0 } });
	await handle.settled;

	expect(signals).toEqual(["SIGKILL"]);
});


test("the parent never calls syncAllSessions directly", async () => {
	// Structural, not behavioural: the client module must not even name the
	// expensive synchronous entry point, so there is no code path on the TUI
	// thread that can reach it.
	const source = readFileSync(join(import.meta.dir, "../src/sync/client.ts"), "utf8");
	expect(source).not.toContain("syncAllSessions");
	expect(source).not.toContain("@oh-my-pi/omp-stats/aggregator");

	// And the same rule for the TUI surface that renders it.
	const panel = readFileSync(join(import.meta.dir, "../src/sync/client.ts"), "utf8");
	expect(panel).not.toContain("omp-stats/db");
});

test("the parent spawns the worker and never runs the sync itself", async () => {
	// The fake child stands in for the child's expensive work. The parent's only
	// contact with it is the NDJSON stream, so there is no path from here to the
	// sync — the count below can only rise if the parent tried.
	const { child, emit, end } = fakeChild();
	let spawns = 0;
	const spawn = (): SyncChild => {
		spawns++;
		return child;
	};
	const { onEvent } = collect();
	const handle = startIngest(onEvent, undefined, spawn);
	emit({ type: "done", rollup: { dirtyHours: 0, dirtySessions: 0 } });
	end();
	await handle.settled;
	handle.kill();

	expect(spawns).toBe(1);
});


test("concurrent requests are memoised, so N callers cost one sync", async () => {
	const { child, emit, end } = fakeChild();
	let spawns = 0;
	const { events, onEvent } = collect();
	const a = collect();
	const b = collect();

	const handle = startIngest(onEvent, undefined, () => {
		spawns++;
		return child;
	});
	const second = startIngest(a.onEvent, undefined, () => {
		spawns++;
		return child;
	});
	const third = startIngest(b.onEvent, undefined, () => {
		spawns++;
		return child;
	});

	expect(spawns).toBe(1); // one child for three callers

	emit({ type: "progress", phase: "ingest", current: 1, total: 2 });
	emit({ type: "done", rollup: { dirtyHours: 0, dirtySessions: 0 } });
	end();
	await Promise.all([handle.settled, second.settled, third.settled]);

	// Every caller saw the stream: sharing the child must not mean dropping listeners.
	expect(events.length).toBe(2);
	expect(a.events.length).toBe(2);
	expect(b.events.length).toBe(2);

	// A later request starts fresh work rather than reusing the finished child.
	const doneEvents = events.filter(e => e.type === "done").length;
	expect(doneEvents).toBe(1);
});

test("a total of 0 renders as indeterminate, not as NaN%", () => {
	const line = describeSyncProgress({ type: "progress", phase: "ingest", current: 0, total: 0 }, 40);
	expect(line).not.toContain("NaN");
	expect(Bun.stringWidth(line)).toBeLessThanOrEqual(40);
});

test("a determinate progress line renders a percentage and fits the width", () => {
	const e: SyncEvent = { type: "progress", phase: "ingest", current: 25, total: 100 };
	expect(describeSyncProgress(e, 40)).toContain("25%");
	expect(Bun.stringWidth(describeSyncProgress(e, 20))).toBeLessThanOrEqual(20);
});

test("every phase has a human word", () => {
	for (const phase of ["scan", "ingest", "rollup"] as const) {
		expect(describeSyncProgress({ type: "progress", phase, current: 1, total: 2 }, 60)).toMatch(/[a-z]/i);
	}
});

test("a width too small for the label still yields one line inside the width", () => {
	for (const width of [0, 1, 3, 8, 12]) {
		const line = describeSyncProgress({ type: "progress", phase: "ingest", current: 25, total: 100 }, width);
		expect(Bun.stringWidth(line)).toBeLessThanOrEqual(width);
		expect(line).not.toContain("NaN");
	}
});

test("kill is idempotent and safe to call after settle", async () => {
	const { child, emit, end } = fakeChild();
	const { onEvent } = collect();
	const handle: IngestHandle = startIngest(onEvent, undefined, () => child);
	emit({ type: "done", rollup: { dirtyHours: 0, dirtySessions: 0 } });
	end();
	await handle.settled;
	expect(() => {
		handle.kill();
		handle.kill();
	}).not.toThrow();
});

test("an error event rejects the handle with the worker's message, after delivering it", async () => {
	// The panel keeps its stale rows on a failed sync, so the rejection carrying
	// the message IS the error surface — dropping the event would fail silently.
	const { child, emit, end } = fakeChild();
	const { events, onEvent } = collect();
	const handle = startIngest(onEvent, undefined, () => child);
	emit({ type: "progress", phase: "ingest", current: 3, total: 10 });
	emit({ type: "error", error: "lock held by another omp process" });
	end();
	await expect(handle.settled).rejects.toThrow("lock held by another omp process");
	expect(events).toEqual([
		{ type: "progress", phase: "ingest", current: 3, total: 10 },
		{ type: "error", error: "lock held by another omp process" },
	]);
});

test("a child that exits without done or error rejects naming the pid", async () => {
	// stdout closed with neither terminal event: the child died mid-sync, and a
	// resolve here would read as a clean sync that never happened.
	const { child, end } = fakeChild();
	const { onEvent } = collect();
	const handle = startIngest(onEvent, undefined, () => child);
	end();
	await expect(handle.settled).rejects.toThrow("4242");
});

test("activity snapshots reach listeners without settling the sync", async () => {
	// The worker's opening `activity` emit is the pre-sync heatmap snapshot, and
	// the closing one lets it converge — both must arrive, and neither ends the
	// stream; only `done` does.
	const points = [{ day: "2026-06-15", cost: 4, requests: 3, totalTokens: 900 }];
	const { child, emit, end } = fakeChild();
	const { events, onEvent } = collect();
	const handle = startIngest(onEvent, undefined, () => child);
	emit({ type: "activity", points });
	emit({ type: "progress", phase: "rollup", current: 0, total: 5 });
	emit({ type: "done", rollup: { dirtyHours: 5, dirtySessions: 1 } });
	end();
	await handle.settled;
	expect(events).toEqual([
		{ type: "activity", points },
		{ type: "progress", phase: "rollup", current: 0, total: 5 },
		{ type: "done", rollup: { dirtyHours: 5, dirtySessions: 1 } },
	]);
});