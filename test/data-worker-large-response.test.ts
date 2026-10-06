import { expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { getSessionsDir } from "@oh-my-pi/pi-utils";
import type { MessageStats } from "@oh-my-pi/omp-stats/types";
import { StatsReadClient } from "../src/data/client";
import { spawnStatsWorker } from "../src/workers/process";
import type { StatsWorkerProcess } from "../src/workers/process";
import { installStatsTestIsolation } from "./fixtures/stats-isolation";

installStatsTestIsolation("@stats-large-worker-response-");

test("large request logs survive stdout backpressure and interleaved live status", async () => {
	const directory = resolve(getSessionsDir(), "--tmp--large-worker--");
	await mkdir(directory, { recursive: true });
	const started = Date.now() - 10_000;
	const entries: unknown[] = [{ type: "session", version: 3, id: "large", timestamp: new Date(started).toISOString(), cwd: "/tmp/large-worker" }];
	for (let i = 0; i < 601; i++) {
		const timestamp = started + i;
		entries.push({ type: "message", id: `response-${i}`, parentId: i ? `response-${i - 1}` : null,
			timestamp: new Date(timestamp).toISOString(), message: { role: "assistant", model: "private-model", provider: "private-provider", api: "openai-completions",
				timestamp, duration: 100, ttft: 20, stopReason: "stop", content: [{ type: "text", text: "recorded response" }],
				usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 120 } } });
	}
	await Bun.write(resolve(directory, "session.jsonl"), entries.map(entry => JSON.stringify(entry)).join("\n") + "\n");
	let child: StatsWorkerProcess | undefined;
	const client = new StatsReadClient(() => child = spawnStatsWorker(resolve(import.meta.dir, "../scripts/data-worker.ts"), "Stats reads", "pipe"));
	const synced = Promise.withResolvers<void>();
	client.subscribe(status => { if (status.sync.phase === "idle" && status.sync.lastSyncedAt !== null) synced.resolve(); }, error => synced.reject(error));
	try {
		await client.fetch(["rollupStatus"], "24h");
		await synced.promise;
		const first = await client.api<MessageStats[]>("/api/stats/recent", { range: "24h", limit: "500" });
		expect(first).toHaveLength(500);
		expect(first[0].entryId).toBe("response-600");
		expect(first[499].entryId).toBe("response-101");
		expect(first.every(row => row.costUnpriced && row.provider === "private-provider" && row.usage.totalTokens === 120)).toBe(true);
		const all = await client.api<MessageStats[]>("/api/stats/recent", { range: "24h", limit: "2000" });
		expect(all).toHaveLength(601);
		expect(all[600].entryId).toBe("response-0");
	} finally {
		client.close();
		if (child) await child.exited;
	}
}, 45_000);
