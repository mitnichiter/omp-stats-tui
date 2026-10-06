import { expect, test } from "bun:test";
import { StatsReadClient } from "../src/data/client";
import type { StatsWorkerProcess } from "../src/workers/process";

function faultChild(source: string): StatsWorkerProcess {
	return Bun.spawn([process.execPath, "-e", source], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
}

test("premature read-worker exit rejects pending reads with its stderr", async () => {
	const child = faultChild('console.error("cannot read stats database"); process.exit(7);');
	const client = new StatsReadClient(() => child);
	try {
		await expect(client.fetch(["overview"], "24h")).rejects.toThrow("cannot read stats database");
		expect(await child.exited).toBe(7);
	} finally { client.close(); }
});
