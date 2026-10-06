import { expect, test } from "bun:test";
import { StatsReadClient } from "../src/data/client";
import type { StatsWorkerProcess } from "../src/workers/process";

function faultChild(source: string): StatsWorkerProcess {
	return Bun.spawn([process.execPath, "-e", source], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
}

test.each([false, true])("premature read-worker exit preserves stderr (already exited: %s)", async alreadyExited => {
	const child = faultChild('console.error("cannot read stats database"); process.exit(7);');
	if (alreadyExited) await child.exited;
	const client = new StatsReadClient(() => child);
	try {
		await expect(client.fetch(["overview"], "24h")).rejects.toThrow("cannot read stats database");
		expect(await child.exited).toBe(7);
	} finally { client.close(); }
});
