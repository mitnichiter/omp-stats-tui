import { test, expect } from "bun:test";
import { Reconciler } from "@oh-my-pi/pi-tui/native/reconcile";
import { __testing, SELECTABLE_SCREENS } from "../src/tui/panel";
import type { DescribeContext, NativeNode, NativeUiEvent } from "@oh-my-pi/pi-tui/native/node";
import { FIXTURE_NOW, liveData } from "./fixtures/panel";

/**
 * TERN PROBE (F2 experiment, scratch — additive only).
 *
 * Without Tern on this machine, validation is the `Reconciler` unit path:
 * a panel whose `describe()` returns real nodes reconciles with
 * `fallbackCount === 0`; a panel without `describe()` falls back to `rows`
 * and counts 1. This proves "describes valid nodes", not "Tern renders them".
 */

function probeCx(): DescribeContext {
	return {
		cols: 100,
		reduceMotion: false,
		dark: true,
		supports: () => true,
		feature: () => false,
	};
}

test("tern probe: panel describes a native node, so the reconciler never falls back to rows", async () => {
	const panel = __testing.makePanel({ data: liveData(), now: () => FIXTURE_NOW });
	await __testing.settled(panel);
	// The probe patch adds describe() to StatsPanel; the static type lags it by one diff.
	const native = panel as unknown as { describe(cx: DescribeContext): NativeNode };
	const reconciler = new Reconciler("probe");
	reconciler.reconcile({ main: [], dock: [], layer: [panel] }, probeCx());
	expect(reconciler.fallbackCount).toBe(0);
	expect(native.describe(probeCx()).k).toBe("card");
});

test("tern probe: tabs node carries the screen strip, select round-trips to a new screen", async () => {
	const panel = __testing.makePanel({ data: liveData(), now: () => FIXTURE_NOW });
	await __testing.settled(panel);
	// Same lag as above: describe/handleNativeEvent arrive with the probe patch.
	const native = panel as unknown as {
		describe(cx: DescribeContext): NativeNode;
		handleNativeEvent(event: NativeUiEvent): void;
	};
	const before = __testing.debugScreenId(panel);
	const root = native.describe(probeCx());
	expect(root.k).toBe("card");
	const tabs = root.c?.find(
		child => typeof child === "object" && child !== null && "k" in child && child.k === "tabs",
	);
	expect(tabs).toBeDefined();
	if (tabs !== undefined && typeof tabs === "object" && "k" in tabs && tabs.k === "tabs") {
		const items = tabs.p?.items ?? [];
		expect(items.map(item => item.id)).toEqual(SELECTABLE_SCREENS.map(screen => screen.id));
	} else {
		throw new Error("probe describe() returned no tabs node");
	}
	const other = SELECTABLE_SCREENS.find(screen => screen.id !== before);
	if (!other) throw new Error("single-screen registry, nothing to switch to");
	native.handleNativeEvent({ type: "select", key: "tabs", item: other.id });
	expect(__testing.debugScreenId(panel)).toBe(other.id);
});
