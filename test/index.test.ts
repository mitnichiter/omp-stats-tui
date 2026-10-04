import { test, expect } from "bun:test";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import register, { showcaseSectionFrom } from "../src/index";

/**
 * A minimal fake host. It records what the extension registers so the test can
 * assert on the *contract* the entrypoint owes the loader — a command named
 * exactly `stats-tui` — without booting a TUI. Kept here, never in `src/`.
 */
function fakePi() {
	const commands: {
		name: string;
		options: { description?: string; handler?: unknown };
	}[] = [];
	// Cast through `never`: the fake deliberately implements only the slice of
	// ExtensionAPI this entrypoint touches, and widening it as the entrypoint
	// grows is the point of the test rather than a failure.
	const pi = {
		registerCommand(name: string, options: { description?: string; handler?: unknown }) {
			commands.push({ name, options });
		},
	} as unknown as ExtensionAPI;
	return { pi, commands };
}

test("the extension registers exactly two commands: /stats-tui and /stats-test", () => {
	// Both, and ONLY both. An extension registering a name the host already provides
	// appears in the palette and is never run (ADR 0002), so the list is pinned
	// exactly rather than checked for a superset.
	const { pi, commands } = fakePi();
	register(pi);
	expect(commands.map(c => c.name)).toEqual(["stats-tui", "stats-test"]);
});

test("both commands carry a description and a callable handler", () => {
	const { pi, commands } = fakePi();
	register(pi);
	expect(commands).toHaveLength(2);
	for (const command of commands) {
		expect(command.options.description).toBeString();
		expect(typeof command.options.handler).toBe("function");
	}
});

test("/stats-test opens a section named by its argument, and falls back for a typo", () => {
	// The optional argument is free: an id, a jump letter or a label all resolve,
	// and anything else yields `undefined` — which the panel reads as "open the
	// first section". A typo in an argument to a playground should not be an error.
	expect(showcaseSectionFrom("")).toBeUndefined();
	expect(showcaseSectionFrom("charts")).toBe("charts");
	expect(showcaseSectionFrom("CHARTS")).toBe("charts");
	expect(showcaseSectionFrom("c")).toBe("charts");
	expect(showcaseSectionFrom("Stat tiles")).toBe("tiles");
	expect(showcaseSectionFrom("nonsense")).toBeUndefined();
});