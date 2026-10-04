// Capture the composed panel frame at several widths, ANSI stripped, and report
// the frame contract by measurement. Run: bun scripts/probe-frame.ts
//
// The four widths are the ones the chrome brief names — 40 (tiny topbar),
// 60 (condensed), 100 (the common terminal, wide sidebar) and 150 (the widest
// band, where the topbar's painted spacer is most visible). OVERWIDE must be 0
// at every one: a row that overflows is torn by `OverlayPanel.row`, not
// squeezed, so the control on the trailing edge is what disappears.
import { __testing } from "../src/tui/panel";
import { liveData } from "../test/fixtures/panel";
import { visibleWidth } from "@oh-my-pi/pi-tui/utils";

const ANSI = /\x1b\[[0-9;]*m/g;
const WIDTHS = [150, 100, 60, 40];
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