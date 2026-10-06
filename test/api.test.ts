import { test, expect } from "bun:test";
import {
	apiGet,
	rollupStatusOrThrow,
} from "../src/data/api";
test("a non-OK response becomes a thrown error naming the path and status", async () => {
	const failing = async () => new Response("nope", { status: 404 });
	await expect(apiGet("/api/nope", {}, failing as never)).rejects.toThrow("/api/nope -> 404");
});

test("a 500 is surfaced as an error too, not parsed as a body", async () => {
	const failing = async () => new Response("boom", { status: 500 });
	await expect(apiGet("/api/stats/overview", {}, failing as never)).rejects.toThrow(
		"/api/stats/overview -> 500",
	);
});

test("THE SILENT-EMPTY TRAP: an uninitialised database is distinguishable from no data", () => {
	// getRollupStatus() returns {0,0} when currentDb() is null, which is
	// byte-identical to a genuinely clean database. The panel must be able to tell
	// them apart, or a first-run panel claims it is up to date while showing zeros.
	expect(() => rollupStatusOrThrow({ ready: false })).toThrow(/not initialised/);
	const clean = rollupStatusOrThrow({ ready: true, dirtyHours: 0, dirtySessions: 0 });
	expect(clean).toEqual({ dirtyHours: 0, dirtySessions: 0 });
});
