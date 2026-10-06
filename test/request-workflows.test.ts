import { expect, test } from "bun:test";
import { ensureThemeSync, theme } from "@oh-my-pi/pi-tui/theme";
import type { MessageStats, RequestDetails as Payload } from "@oh-my-pi/omp-stats/client/types";
import type { FeatureContext } from "../src/tui/features/types";
import { createRequestsFeature, RequestDetails } from "../src/tui/features/core/requests";

ensureThemeSync();
function row(id: number, overrides: Partial<MessageStats> = {}): MessageStats {
	return { id, sessionFile: `session-${id}`, entryId: `entry-${id}`, folder: "project", model: `model-${id}`, provider: "provider", api: "api", timestamp: id * 1000, duration: 100, ttft: 10, stopReason: "stop", errorMessage: null, usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, totalTokens: 10, premiumRequests: 0.5, cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 } }, ...overrides };
}
function context(api: FeatureContext["reader"]["api"]): FeatureContext {
	return { reader: { api, fetch: async () => { throw new Error("unexpected eager scan"); } }, theme, changed() {}, copy: async () => {}, openTrace() {}, openScreen() {}, now: () => 0 };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function payload(id: number): Payload { return { ...row(id), output: { text: `output-${id}` }, messages: [{ entry: id }] }; }

test("request inspector suppresses stale selections, back and dispose completions", async () => {
	const pending = [deferred<Payload>(), deferred<Payload>(), deferred<Payload>(), deferred<Payload>()];
	let calls = 0;
	const inspector = new RequestDetails(context(async <T>() => pending[calls++].promise as Promise<T>));
	const first = inspector.open(row(1)); const second = inspector.open(row(2));
	pending[0].resolve(payload(1)); await first;
	expect(inspector.render(120)?.join("\n")).not.toContain("output-1");
	pending[1].resolve(payload(2)); await second;
	expect(inspector.render(120)?.join("\n")).toContain("output-2");
	expect(inspector.handleInput("q")).toBe(false);
	const third = inspector.open(row(3)); expect(inspector.handleInput("\x1b")).toBe(true);
	pending[2].resolve(payload(3)); await third; expect(inspector.render(120)).toBeNull();
	const fourth = inspector.open(row(4)); inspector.dispose(); pending[3].resolve(payload(4)); await fourth;
	expect(inspector.active).toBe(false); expect(inspector.render(120)).toBeNull();
});

test("status intersects search while status counts stay unfiltered", async () => {
	const rows = [row(1, { model: "needle" }), row(2, { model: "needle", stopReason: "error", errorMessage: "failure" }), row(3)];
	const feature = createRequestsFeature("requests", context(async <T>() => rows as T)); await feature.load("24h");
	feature.handleInput("f"); feature.handleInput("/"); for (const char of "needle") feature.handleInput(char); feature.handleInput("\r");
	const text = feature.render(200, 40).join("\n");
	expect(text).toContain("matching 1"); expect(text).toContain("all 3 · ok 2 · aborted 0 · failed 1");
	expect(text).not.toContain("#2 needle"); expect(text).toContain("Complete range");
});

test("full server limit reports incomplete and load-more uses next limit", async () => {
	const limits: string[] = [];
	const feature = createRequestsFeature("requests", context(async <T>(_path: string, params?: Record<string, string>) => { limits.push(params!.limit); return Array.from({ length: 500 }, (_, index) => row(index)) as T; }));
	await feature.load("24h"); expect(feature.render(160, 30).join("\n")).toContain("older requests are not loaded");
	feature.handleInput("l"); await Promise.resolve();
	expect(limits).toEqual(["500", "2000"]); expect(feature.render(160, 30).join("\n")).toContain("Complete range");
});

test("expanded error signature exposes every member, not only the latest", async () => {
	const failures = Array.from({ length: 150 }, (_, index) => row(index + 1, { model: `unique-model-${index + 1}`, stopReason: "error", errorMessage: "same failure" }));
	const calls: string[] = [];
	const feature = createRequestsFeature("errors", context(async <T>(path: string) => { calls.push(path); return (path.includes("/request/") ? payload(Number(path.split("/").at(-1))) : failures) as T; }));
	await feature.load("24h"); feature.handleInput("\r");
	expect(feature.render(180, 40).join("\n")).toContain("Expanded signature");
	feature.handleInput("\t"); feature.handleInput("\t"); feature.handleInput("a");
	for (let index = 0; index < 149; index++) feature.handleInput("j");
	expect(feature.render(180, 40).join("\n")).toContain("unique-model-1");
	feature.handleInput("\r"); await Promise.resolve(); expect(calls).toContain("/api/request/1");
	feature.handleInput("b"); await feature.load("24h"); feature.handleInput("\r"); await Promise.resolve();
	expect(calls.filter(path => path === "/api/request/1")).toHaveLength(2);
});

test("inspector displays copy result and routes trace identity", async () => {
	const ctx = context(async <T>() => payload(7) as T); const traces: string[] = [];
	ctx.openTrace = (file, entry) => { traces.push(`${file}:${entry}`); };
	const inspector = new RequestDetails(ctx); await inspector.open(row(7)); inspector.handleInput("c"); await Promise.resolve();
	expect(inspector.render(160)?.join("\n")).toContain("JSON copied successfully");
	ctx.copy = async () => { throw new Error("clipboard denied"); }; inspector.handleInput("c"); await Promise.resolve();
	expect(inspector.render(160)?.join("\n")).toContain("Copy failed: Error: clipboard denied");
	inspector.handleInput("t"); expect(traces).toEqual(["session-7:entry-7"]); expect(inspector.active).toBe(false);
});

test("log ignores stale range and disposed reads; global navigation survives search", async () => {
	const reads = [deferred<MessageStats[]>(), deferred<MessageStats[]>(), deferred<MessageStats[]>()];
	let calls = 0;
	const feature = createRequestsFeature("requests", context(async <T>() => reads[calls++].promise as Promise<T>));
	const old = feature.load("24h"); const current = feature.load("7d");
	reads[1].resolve([row(2)]); await current; reads[0].resolve([row(1)]); await old;
	expect(feature.render(160, 40).join("\n")).toContain("#2 model-2");
	expect(feature.render(160, 40).join("\n")).not.toContain("#1 model-1");
	feature.handleInput("/");
	expect(feature.inputMode).toBe("text");
	for (const key of ["q", "[", "]"]) expect(feature.handleInput(key)).toBe(true);
	expect(feature.render(160, 40).join("\n")).toContain("Search: q[]");
	for (const key of ["\x0e", "\x10", "\x1b[D", "\x1b[C"]) expect(feature.handleInput(key)).toBe(false);
	feature.handleInput("\r");
	expect(feature.handleInput("q")).toBe(false);
	const closing = feature.load("all"); feature.dispose(); reads[2].resolve([row(3)]); await closing;
	expect(feature.render(160, 40).join("\n")).not.toContain("#3 model-3");
});

test("unpriced detail components are unavailable estimates rather than zero spend", async () => {
	const unpriced = { ...payload(8), costUnpriced: true };
	for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"] as const) unpriced.usage.cost[key] = 0;
	const inspector = new RequestDetails(context(async <T>() => unpriced as T));
	await inspector.open(unpriced);
	const text = inspector.render(160)!.join("\n");
	expect(text).toContain("unpriced requests: 1");
	for (const component of ["input", "output", "cacheRead", "cacheWrite", "total"]) {
		expect(text).toContain(`${component}: unpriced request; component estimate unavailable`);
	}
});

test("active list precedes secondary metrics and expanded signature contains real metadata", async () => {
	const failure = row(9, { stopReason: "error", errorMessage: "actual failure" });
	const ctx = context(async <T>() => [failure] as T);
	const requests = createRequestsFeature("requests", ctx); await requests.load("24h");
	const requestText = requests.render(180, 30).join("\n");
	expect(requestText.indexOf("Request log")).toBeLessThan(requestText.indexOf("Loaded request summary"));
	const errors = createRequestsFeature("errors", ctx); await errors.load("24h"); errors.handleInput("\r");
	const expanded = errors.render(180, 30).join("\n");
	expect(expanded).toContain("Latest error: actual failure");
	expect(expanded).toContain("model-9 · provider: 1 failures");
	errors.handleInput("\t");
	let text = errors.render(180, 30).join("\n");
	expect(text.indexOf("Affected models")).toBeLessThan(text.indexOf("Error signatures"));
	errors.handleInput("\t"); text = errors.render(180, 30).join("\n");
	expect(text.indexOf("\nFailures\n")).toBeLessThan(text.indexOf("Error signatures"));
});
