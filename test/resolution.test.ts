import { test, expect } from "bun:test";
import { visibleWidth, renderTableRow } from "@oh-my-pi/pi-tui";
import { OverlayPanel } from "@oh-my-pi/pi-tui/chrome";
import { handleApi } from "@oh-my-pi/omp-stats/server";

// `bun test` runs outside the omp extension loader, so anything the loader
// resolves for free must still resolve from disk here. This test is the early
// warning that a dependency was dropped or mis-pinned.
test("every package the extension imports resolves under bun test", () => {
	expect(typeof visibleWidth).toBe("function");
	expect(typeof renderTableRow).toBe("function");
	expect(typeof OverlayPanel).toBe("function");
	expect(typeof handleApi).toBe("function");
});