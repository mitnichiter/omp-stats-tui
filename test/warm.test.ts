import { test, expect } from "bun:test";
import { __warm } from "../src/index";

/**
 * The DB warm is the one piece of F16's recommendation that is behavioural rather
 * than measured, so its contract is pinned here: it must be DEFERRED (never
 * awaited during load), run at most once however many times it is called, and
 * report failure on stderr without ever touching stdout — stdout is the TUI's.
 */

test("the warm is deferred: it does not start during extension load", () => {
	const warm = __warm.make();
	// Calling it must schedule the work, not run it inline.
	const result = warm.start();
	expect(result).toBeDefined();
	expect(warm.debugStarted()).toBe(false);
});

test("the warm runs at most once however many times it is started", () => {
	const warm = __warm.make();
	warm.start();
	warm.start();
	warm.start();
	expect(warm.debugStartCount()).toBe(1);
});

test("a failed warm is reported on stderr and never resolves as success", async () => {
	const errors: string[] = [];
	const original = console.error;
	console.error = (msg: string) => errors.push(String(msg));
	try {
		const warm = __warm.make(async () => { throw new Error("database is locked"); });
		const settled = warm.start();
		await settled;
	} finally {
		console.error = original;
	}
	expect(errors.some(line => line.includes("database is locked"))).toBe(true);
});

test("the warm resolves to whether it succeeded, so the panel can decide", async () => {
	const warm = __warm.make(async () => {});
	expect(await warm.start()).toBe(true);

	const failing = __warm.make(async () => { throw new Error("nope"); });
	const original = console.error;
	console.error = () => {};
	try {
		expect(await failing.start()).toBe(false);
	} finally {
		console.error = original;
	}
});

test("the warm never writes to stdout", async () => {
	const lines: string[] = [];
	const out = console.log;
	const err = console.error;
	console.log = (msg: unknown) => lines.push(String(msg));
	console.error = () => {};
	try {
		await __warm.make(async () => { throw new Error("boom"); }).start();
	} finally {
		console.log = out;
		console.error = err;
	}
	expect(lines).toEqual([]);
});