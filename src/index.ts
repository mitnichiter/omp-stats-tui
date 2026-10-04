import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { VERSION } from "@oh-my-pi/pi-coding-agent";
import { initDb } from "@oh-my-pi/omp-stats/db";
import { STATS_OVERLAY_OPTIONS, StatsPanel } from "./tui/panel";
import { ShowcasePanel } from "./tui/showcase/panel";
import { SHOWCASE_SECTIONS } from "./tui/showcase/spec";

// The omp version this extension was built against. Every `@oh-my-pi/*` import
// below depends on host internals, so a host bump is the one failure mode that
// produces an obscure load failure rather than a clear error. Warn loudly, on
// stderr (stdout is the TUI's), and still load — refusing to load would leave
// the user with a working omp and no explanation.
const PINNED = "18.5.0";

/** Injectable for tests; production is the package's own initDb. */
type InitFn = () => Promise<unknown>;

interface WarmHandle {
	/** Schedule the warm. Never blocks the caller — that is the entire point. */
	start(): Promise<boolean>;
}

interface WarmDebug extends WarmHandle {
	debugStarted(): boolean;
	debugStartCount(): number;
}

/**
 * F16: `initDb()` costs ~850 ms of SYNCHRONOUS `bun:sqlite` work — 97% of it one
 * unguarded backfill rescanning ~70k permanently-unpriceable rows. Two measured
 * facts decide where this is called:
 *
 *   1. The cost is PER-PROCESS, not per-database. `db` is a module-level
 *      singleton behind `if (db) return db`, so a process pays it exactly once
 *      (846.6 ms, then 0.0 ms, then 0.0 ms). Spending it at load therefore costs
 *      nothing extra for a session that never opens /stats-tui, and spending it
 *      lazily would spend it at the worst possible moment — the keystroke the
 *      user just typed.
 *   2. A warm does NOT transfer between threads or processes. Measured: a Worker
 *      paid its own 941.8 ms and left the main thread to pay again. It has to be
 *      in-process to count.
 *
 * We are therefore deliberately the first thing in this codebase to call
 * `initDb()` on the thread that will paint the panel. First-party never does —
 * `grep -rn initDb pi-coding-agent/src` returns nothing; it answers this exact
 * problem by binding a socket, where a blocking call costs nothing. It is
 * acceptable here for one reason and one reason only: this runs at extension
 * LOAD, before the TUI is interactive, not on the render loop. If this call ever
 * moves into the panel's load path, the justification is gone and F16's
 * subprocess option applies instead.
 *
 * It is deferred rather than awaited so load time is not extended either.
 */
// Static import, deliberately: dynamic `import()` of any `@oh-my-pi/*` fails inside
// the extension loader, which rewrites specifiers for static imports only.
function makeWarm(init: InitFn = () => initDb()): WarmDebug {
	let startCount = 0;
	let started = false;
	let inflight: Promise<boolean> | null = null;

	return {
		start(): Promise<boolean> {
			// Idempotent by construction: `inflight` is the memo, so N callers
			// during load, plus the panel's own call on open, still cost one init.
			if (inflight) return inflight;
			startCount++;
			inflight = Promise.resolve()
				.then(() => init())
				.then(
					() => {
						started = true;
						return true;
					},
					(error: unknown) => {
						// stderr only. A warm that fails is not fatal: the panel
						// still opens and still reports, because its DbReadiness
						// guard refuses to claim freshness it cannot verify.
						console.error(`[stats-tui] database warm failed: ${String(error)}`);
						return false;
					},
				);
			return inflight;
		},
		debugStarted: () => started,
		debugStartCount: () => startCount,
	};
}

/**
 * The process-wide warm. Started from the extension factory; awaited by nothing
 * at load, and awaited by the panel only if a query somehow raced it.
 *
 * ── Task 11 panel authors: three requirements travel with this handle ──────────
 *
 * 1. AWAIT `statsDbWarm` before the panel's FIRST query, but never trigger the
 *    warm from the panel. It is per-PROCESS, so a deferred load-time start spends
 *    the ~850 ms once and invisibly, while anything lazy spends it on the
 *    keystroke the user just typed. F16 measured 846.6 ms then 0.0 ms in-process.
 *
 * 2. KEEP `DbReadiness` and the `fetchRollupStatus()` throw in `src/data/api.ts`
 *    even though the warm will normally have succeeded. The warm can fail on a
 *    locked database, a read-only filesystem, or a `ROLLUP_VERSION` bump landing
 *    mid-startup, and `getRollupStatus()` returns `{dirtyHours: 0, dirtySessions: 0}`
 *    when the handle is null — indistinguishable from a clean database. That is
 *    the failure that would tell the user their spend is up to date when it is
 *    not, so the panel must keep treating "not initialised" as unanswerable
 *    rather than as zero.
 *
 * 3. Do not move this call into the panel's load path. It is on the TUI thread
 *    today only because it runs at LOAD, before the TUI is interactive; first-party
 *    never calls initDb() on this thread at all (`grep -rn initDb
 *    pi-coding-agent/src` is empty — it binds a socket instead). Once the panel
 *    exists, a query must await the warm, never start it.
 */
const statsDbWarm = makeWarm();

/** Await this before the panel's first query. See the note above. */
export const statsDb = statsDbWarm;

/** Test seam. Not part of the extension's public surface. */
export const __warm = { make: makeWarm, current: statsDbWarm };

export default function (pi: ExtensionAPI): void {
	if (VERSION !== PINNED) {
		console.error(`[stats-tui] built against omp ${PINNED}, host is ${VERSION}`);
	}

	// Fire-and-forget at load. Not awaited: this must not extend startup, and the
	// panel awaits `statsDbWarm` itself if a query ever beats it.
	void statsDbWarm.start();

	pi.registerCommand("stats-tui", {
		description: "Local usage stats, fullscreen",
		handler: async (_args, ctx) => {
			// `ctx.mode === "tui"`, not `ctx.hasUI`: `hasUI` is true in RPC mode,
			// where `custom()` is implemented as *unsupported UI* and returns
			// `undefined as never` — a promise that never resolves.
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/stats-tui needs an interactive terminal", "warning");
				return;
			}
			await ctx.ui.custom<undefined>(
				(tui, theme, _keybindings, done) =>
					new StatsPanel({
						tui,
						theme,
						done: () => done(undefined),
						requestRender: () => tui.requestRender(),
						// Handed in, not imported. The panel AWAITS this handle and
						// never triggers it: `start()` is memoised and was already
						// called above, so this joins the warm instead of paying for
						// it on the keystroke. Requirement 3 on `statsDbWarm`.
						warm: statsDbWarm,
					}),
				{ overlay: true, overlayOptions: STATS_OVERLAY_OPTIONS },
			);
		},
	});
	// `/stats-test` — the SHOWCASE. A fullscreen overlay bound to nothing: it
	// exercises the panel's whole visual grammar on fabricated fixtures, so colour,
	// hierarchy and chart choices can be judged side by side, and so the limits of
	// what `@oh-my-pi/pi-tui` can actually draw are visible rather than assumed.
	//
	// It reads NO DATABASE, which is why it takes no `warm` handle and why
	// `test/showcase-panel.test.ts` asserts at the source level that nothing under
	// `src/tui/showcase/` names `initDb`, `fetchFor` or `bun:sqlite`. A playground
	// that queried would defeat its own purpose and would put ~850 ms of
	// synchronous SQLite on the keystroke the user just typed.
	pi.registerCommand("stats-test", {
		description: "Showcase: the panel's whole visual grammar on fixtures",
		// An optional section or jump letter: `/stats-test charts`, `/stats-test c`.
		// Costs one lookup, and an argument the panel ignores is an argument the user
		// typed for nothing.
		handler: async (args, ctx) => {
			// The same `ctx.mode === "tui"` guard as `/stats-tui`, and for the same
			// reason: `hasUI` is true in RPC mode, where `custom()` is implemented as
			// *unsupported UI* and returns `undefined as never` — a promise that never
			// resolves, so the command would hang rather than fail.
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/stats-test needs an interactive terminal", "warning");
				return;
			}
			await ctx.ui.custom<undefined>(
				(tui, theme, _keybindings, done) =>
					new ShowcasePanel({
						tui,
						theme,
						done: () => done(undefined),
						requestRender: () => tui.requestRender(),
						sectionId: showcaseSectionFrom(args.trim()),
					}),
				{ overlay: true, overlayOptions: STATS_OVERLAY_OPTIONS },
			);
		},
	});
}

/**
 * Which section `/stats-test <arg>` opens, or `undefined` for the first.
 *
 * Accepts a section id, a jump letter, or a label — the three things a reader who
 * has seen one of them would try. An argument that matches none of them yields
 * `undefined`, which the panel treats as "open the first section", because a typo
 * in an argument to a playground should not be an error dialog.
 */
export function showcaseSectionFrom(arg: string): string | undefined {
	if (arg === "") return undefined;
	const lower = arg.toLowerCase();
	const byId = SHOWCASE_SECTIONS.find(section => section.id === lower);
	if (byId) return byId.id;
	const byLabel = SHOWCASE_SECTIONS.find(section => section.label.toLowerCase() === lower);
	if (byLabel) return byLabel.id;
	if (lower.length === 1) {
		const byLetter = SHOWCASE_SECTIONS.find(section => section.hotkey === lower);
		if (byLetter) return byLetter.id;
	}
	return undefined;
}