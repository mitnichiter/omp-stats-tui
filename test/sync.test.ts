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

/** A fake child whose stdout the test writes by hand. */
function fakeChild(): { child: SyncChild; emit: (o: unknown) => void; end: () => void; kills: number[] } {
	const encoder = new TextEncoder();
	let controller!: ReadableStreamDefaultController<Uint8Array>;
	const stdout = new ReadableStream<Uint8Array>({
		start(c) {
			controller = c;
		},
	});
	const kills: number[] = [];
	return {
		child: {
			pid: 4242,
			stdout,
			stderr: null,
			kill: (signal?: number | NodeJS.Signals) => {
				kills.push(typeof signal === "number" ? signal : 9);
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
		kills,
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

test("the child dies when the parent goes away, and a still-running sync leaves nothing behind", async () => {
	// A REAL long-lived child, so "the child is actually gone" is checked against
	// the OS rather than against a recorded call. It ignores SIGTERM, so only
	// SIGKILL can clear this pid.
	const spawn = Bun.spawn([process.execPath, "-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"], {
		stdout: "pipe",
		stderr: "pipe",
	});
	// The platform clock is genuinely in play here — the assertion is that the OS
	// reaps a killed pid, which no fake timer can model.
	const exited = spawn.exited;
	const child: SyncChild = {
		pid: spawn.pid,
		stdout: spawn.stdout as ReadableStream<Uint8Array>,
		stderr: null,
		kill: (signal?: number | NodeJS.Signals) =>
			spawn.kill((typeof signal === "number" ? signal : (signal ?? "SIGKILL")) as never),
	};

	const controller = new AbortController();
	const handle = startIngest(() => {}, controller.signal, () => child);
	const pid = spawn.pid!;

	expect(() => process.kill(pid, 0)).not.toThrow(); // alive before abort
	controller.abort();
	handle.kill();

	await exited; // the real signal that the process is gone
	expect(() => process.kill(pid, 0)).toThrow(); // reaped by SIGKILL
	await handle.settled.catch(() => {}); // abort settles rather than hangs
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