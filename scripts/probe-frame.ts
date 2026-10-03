// Capture the composed panel frame at several widths, ANSI stripped, and report
// the frame contract by measurement. Run: bun -e "$(cat scripts/probe-frame.ts)"
import { __testing } from "../src/tui/panel";
import { liveData } from "../test/fixtures/panel";
import { visibleWidth } from "@oh-my-pi/pi-tui/utils";

const ANSI = /\x1b\[[0-9;]*m/g;
const WIDTHS = [100, 60, 40];
const summary: string[] = [];
const blocks: string[] = [];

for (const width of WIDTHS) {
	const panel = __testing.makePanel({ data: liveData(), range: "30d", rows: 40 });
	await __testing.settled(panel);
	const frame = panel.render(width);
	const plain = frame.map(line => line.replace(ANSI, ""));
	const dividers = plain.filter(row => row.includes("├")).length;
	const widest = Math.max(...plain.map(row => visibleWidth(row)));
	const over = plain.filter(row => visibleWidth(row) > width).length;
	summary.push(`  FRAME@${width} — ${plain.length} rows, widest ${widest}, ${dividers} divider(s), OVERWIDE: ${over}`);
	blocks.push(`--- FRAME@${width}: rows=${plain.length} widest=${widest} dividers=${dividers} OVERWIDE=${over}\n${plain.join("\n")}`);
}
console.log(summary.join("\n"));
console.log(blocks.join("\n\n"));