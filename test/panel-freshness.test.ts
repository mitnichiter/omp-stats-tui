import { expect, test } from "bun:test";
import { __testing } from "../src/tui/panel";
import { blankData, liveData } from "./fixtures/panel";

test("un-ingested transcripts cannot present a fabricated zero-cost dashboard", async () => {
	const panel = __testing.makePanel({ data: {
		...blankData(), freshness: { records: 0, pendingSessions: 2, observedAt: 100 },
	} });
	try {
		await __testing.settled(panel);
		const body = __testing.debugBody(panel).join("\n");
		expect(body).toContain("un-ingested");
		expect(body).not.toContain("API-equivalent cost");
	} finally { panel.dispose(); }
});

test("cached usage remains visible while newer transcripts await ingest", async () => {
	const panel = __testing.makePanel({ data: liveData({
		freshness: { records: 10, pendingSessions: 2, observedAt: 100 },
	}) });
	try {
		await __testing.settled(panel);
		const body = __testing.debugBody(panel).join("\n");
		expect(body).toContain("un-ingested");
		expect(body).toContain("$112.36");
	} finally { panel.dispose(); }
});
