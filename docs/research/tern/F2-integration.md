# F2 — Tern integration: TUI-only vs dual-target vs Tern-native

## Angle

Should `omp-stats-tui` integrate with both Tern and the terminal TUI, or stay TUI-only?
A sibling session owns "what Tern is"; this file owns only the integration judgment
from the omp side. Assumptions stated explicitly:

- **A1. "Tern" = Stencil's Tern terminal, and "integrating with Tern" means speaking the
  Tern Surface Protocol (TSP).** There is no Tern plugin/extension API to target:
  Tern is a terminal program, not a host. The only integration surface is the TSP
  `describe()` contract that `pi-tui` components already implement. (If the sibling
  session finds a separate Tern app/plugin API, this file's options need revision.)
- **A2. omp version drift is real.** The repo pins `18.5.0` (`src/index.ts`); the
  installed host on this machine is `18.6.0`. All line citations below are against
  the installed `18.6.0` host sources under
  `~/.bun/install/global/node_modules/@oh-my-pi/`, read-only.
- **A3. Tern availability is unverified on this machine.** No `tern` binary check
  was run; the experiment below covers both "Tern present" and "Tern absent" cases.

## Claims

| # | Claim | Source URL / path | Date | Confidence |
|---|-------|-------------------|------|------------|
| C1 | An omp extension has exactly one UI mount: `ctx.ui.custom(factory, { overlay, overlayOptions })`, which mounts a `Component` via `showOverlay` (overlay) or editor replacement (inline). `ExtensionCustomOptions = { overlay?, overlayOptions?, onHandle?, signal? }`. | `~/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/extensibility/extensions/types.ts:242-252`; `src/modes/controllers/extension-ui-controller.ts:1126-1206` (local host source, 18.6.0) | 2026-10-04 (read) | High |
| C2 | `custom()` is interactive-TUI-only. In RPC it "is implemented as unsupported UI and returns `undefined as never`"; headless is no-op. Guard is `ctx.mode === "tui"`, not `ctx.hasUI` (RPC can report `hasUI === true` while not supporting `custom()`). | `omp://tui.md` (Runtime behavior by mode); `omp://extensions.md` (RPC mode section); `src/index.ts:133-139` already guards on `mode` | 2026-10-04 (read) | High |
| C3 | Tern integration is a **terminal capability probe**, not a second extension API. `ProcessTerminal` sends a TSP `hello` query (`q: "hello"`, `app: "omp"`, `features: ["edit","undo","send"]`) behind a DA1 sentinel; a supported-version reply switches `TUI` to `native/backend.ts`. Gating: `PI_TUI_NATIVE=0` disables, multiplexers skip, `PI_TUI_NATIVE=1` forces; `TERM_PROGRAM=tern` marks expectation. | `pi-tui/src/terminal.ts` (`#shouldQueryTspSupport` ~:1776, `#queryTspSupport` ~:1785, `tspExpected` ~:968); `pi-tui/src/native/encode.ts:110-122`; `omp://tui-core-renderer.md` §5 "Native rendering (Tern Surface Protocol)" | 2026-10-04 (read) | High |
| C4 | A component opts into native rendering with **additive optional methods** — no new registration, no separate build: `describe(cx): NativeNode \| null`, `nativeOverlay` (`{ role, head, size, anchor }`), `nativeSheet(cx)`, `describeScreen(cx)`, `handleNativeEvent(event)`. Keyboard still arrives via the existing `handleInput`; TSP pointer/toggle/select/action events arrive via `handleNativeEvent`, and the backend calls `requestRender()` after. | `pi-tui/src/tui.ts:255-294` (`Component` contract); `pi-tui/src/native/backend.ts:626-741` (`#handleEvent`); `pi-tui/src/tui.ts:2680-2795` (`#handleInput` routes TSP strings to native backend, keys to focused component) | 2026-10-04 (read) | High |
| C5 | **Fallback is automatic and free.** A component without `describe()` (or returning `null`) is rendered through `render(cols)` and shipped as a `rows` node; `Reconciler.fallbackCount` counts such nodes per frame. So today's `StatsPanel` already "works" in Tern — as an ANSI-rows block, with zero native fidelity. | `pi-tui/src/native/reconcile.ts:901-924` (`#resolve`); `backend.ts:282-284` (`fallbackCount`); debug via `PI_TUI_TSP_RECORD` / `PI_TUI_NATIVE_STATS=1` (`backend.ts:265-267`) | 2026-10-04 (read) | High |
| C6 | A fullscreen overlay becomes a native **screen surface** (the ANSI alternate-screen borrow's counterpart): the topmost fullscreen overlay's `describeScreen()` fills `main`/`dock`, else the component itself is placed. While it is topmost the inline surface pauses; closing it closes the surface. | `pi-tui/src/native/backend.ts:426-468` (`render()`, `mode:"screen"`); header comment `:1-17` | 2026-10-04 (read) | High |
| C7 | First-party precedent #1: `UsageDashboardComponent` (the `/usage` overlay — the closest analog to our panel) declares `nativeOverlay = { role: "omp.overlay.usage", size: "lg", anchor: "center", head: "Usage" }`, implements `describe()` (provider cards → `card`+`meter`, activity → native `chart` heatmap w/ `cx.supports("chart")` gating and `progress`/`table` fallbacks, memoized on a revision counter), and `handleNativeEvent()` (tabs via select/activate, Refresh via action). | `pi-tui/src/overlays/usage-dashboard.ts:535` (`nativeOverlay`), `:942-953` (`describe`), `:956-966` (`handleNativeEvent`), `:1128-1147` (`#describeActivity`) | 2026-10-04 (read) | High |
| C8 | First-party precedent #2: an **extension-mounted** custom overlay can do the same. `autoresearch-dashboard.ts` (driven through `ctx.ui.custom`) returns an object literal with a `nativeOverlay` getter and `describe()`, and gates its 80 ms spinner interval on `!isNativeRendering()` because spinners/elapsed are terminal-clocked on TSP. | `pi-tui/src/apps/autoresearch-dashboard.ts:136-199` (`showOverlay` via `ctx.ui.custom`, `nativeOverlay`, `describe`, `isNativeRendering` gate at `:142`) | 2026-10-04 (read) | High |
| C9 | TSP v1 vocabulary covers our data shapes: `chart` (`kind: "heatmap" \| "bars" \| "spark"`; heatmap `cells` as rows×cols of 0–1/`null`, `cols`/`rows` labels, `tips` tooltips; bars/spark `series` of `{ label, value, title }`; `token`, `summary`, `size`), `meter` (`value` 0–1, stacked `parts`, `thresholds`, `label`), plus `table`, `tabs`, `card`, `list`, `progress`, `text`, `badge`, `kbd`. Capability varies per terminal: `cx.supports(kind)` gates, `cx.cols` is width, `DescribeContext` is never a clock. | `pi-wire/src/tsp.ts:36-79` (`TSP_KINDS`), `:743-779` (`TspMeterProps`, `TspChartProps`); `pi-tui/src/native/node.ts:71-87` (`DescribeContext`) | 2026-10-04 (read) | High |
| C10 | omp has been going native incrementally since 18.4.3: working row / todo HUD / subagent HUD / progress natively; `/usage` as a glass sheet with native heatmap; MCP tool cards native with `describeCall`/`describeResult` hooks for custom tools; 18.4.5 added native HUD + session/job views and "Inside a Tern pane, the browser tool opens tabs as picture-in-pictures". Extension tools already have the native hook pair (`describeCall`/`describeResult` → `NativeToolView`). | Host `CHANGELOG.md`: `## [18.4.3]` Added (TSP paragraphs); `## [18.4.5]` Added ("native HUD and UI elements…", "browser tool…Tern pane"); `pi-coding-agent/src/extensibility/extensions/types.ts:735-743` | 2026-09-28 – 2026-10-02 (changelog dates) | High |
| C11 | Tern is in closed beta (public page). Audience for native-only fidelity is therefore bounded today; the ANSI path remains the universal one. | https://stencil.so/tern | 2026-10-04 (fetched) | Medium (marketing page, secondary source) |
| C12 | On a native surface the nerd symbol preset is forced process-locally and icon glyphs go as `icon` spans; motion (spinners, elapsed) is terminal-clocked, so repaint timers must be gated off (C8 pattern). Our hardcoded-Unicode data ink (ADR 0005) and 80 ms-class repaint assumptions need re-checking on that path, not redesign. | `omp://tui-core-renderer.md` §5 ("nerd symbol preset is forced… icon glyphs are sent as `icon` spans"); `autoresearch-dashboard.ts:142` | 2026-10-04 (read) | Medium-High |
| C13 | `StatsPanel` today has **zero** native surface: no `describe`, `nativeOverlay`, `describeScreen`, or `handleNativeEvent` (only an unrelated identifier match on "described"). Its overlay options are the 8-line fullscreen constants; mount is `ctx.ui.custom` + `STATS_OVERLAY_OPTIONS`. | `grep` over `src/tui/panel.ts` (2026-10-04); `src/index.ts:140-154`; `src/tui/panel.ts:60-80` | 2026-10-04 (measured) | High |

## Options

### Option A — TUI-only (status quo)

Ship only `render()` rows. In Tern the panel appears as an ANSI `rows` block
inside the overlay surface (C5) — correct figures, host theme tokens, but none
of: native heatmap/charts, meters, tabs, pointer events, terminal-clocked motion.

- Effort: **zero** (current state).
- Risk: **none technically**; product risk only — in the terminal where omp's own
  `/usage` is a glass sheet with a native heatmap (C7, C10), `/stats-tui` looks
  legacy by comparison, and every chart we hand-tune in ANSI (sparklines, bars,
  heat cells) is work Tern would do natively from a `chart` node (C9).
- Verdict: viable floor, not the ceiling.

### Option B — Dual-target (progressive enhancement; RECOMMENDED)

Keep `render()` as the universal path; add `describe()` + `nativeOverlay` (+
`handleNativeEvent`) to `StatsPanel` so Tern-speaking terminals get semantic
nodes while every other terminal is byte-identical to today. This is not "two
integrations": it is one component with an additive method (C4), the exact shape
of both first-party precedents (C7, C8). Concretely:

1. `readonly nativeOverlay = { role: "omp.overlay.stats", size: "lg", anchor: "center", head: "Stats" }` (role namespaced `omp.overlay.*` per the `overlayCard` convention; `usage` precedent `omp.overlay.usage`).
2. `describe(cx)`: map bands → nodes (`statRow`→`kv`/rows, `chart`→`chart` with `cx.supports("chart")` gating to `table`/`progress` fallback, `table`→`table`, `note`→`text`, tab strip→`tabs`); memoize on a revision counter like `#nativeCache` (C7), since `describe` runs per frame and `buildHeatmapLayout`-class work must not repeat.
3. `handleNativeEvent()`: route tab select/activate → existing `screenForHotkey`/index path, action buttons → existing `panelAction` (`r` range, refresh) — reuse, never a second keymap.
4. Gate repaint timers on `!isNativeRendering()` (C8/C12 pattern); keep `handleInput` untouched (keys still flow, C4).

- Effort: **small-medium**. One `describe` mapping over the band grammar (bands are already a closed union — `statRow | chart | table | legend | note | custom`), so per-screen work is bounded; the activity heatmap maps directly onto `chart`/`heatmap` with per-day `tips` (the `/usage` precedent ships 53 weeks, C7). No protocol, mount, data, or test-harness changes.
- Risk: **low, and capped by construction**. Any gap (an unmapped band, an unsupported kind) degrades to the `rows` fallback per node (C5), never to a blank panel. Known unknowns: native **scroll** behavior for a 12-screen scrollable panel (the `scroll` op exists but is terminal-feature-gated — Gaps G2); `chart` `token` → theme mapping for series colors (Gaps G3); whether `describeScreen` (own page, `raw-sse` precedent) fits better than `nativeOverlay` sheet (`usage-dashboard` precedent says sheet — follow it).
- Why not bigger: no Tern-side code exists to write (A1); no `ctx.ui` API change is involved (C1–C2).

### Option C — Tern-native (native-only)

Implement `describe`/`describeScreen` and let `render()` rot (or return a stub),
designing only for TSP vocabulary. Maximal fidelity in Tern; nothing everywhere else.

- Effort: **medium** (same mapping as B, plus maintaining the fiction that ANSI doesn't matter).
- Risk: **high and unforced**. Abandons every non-Tern terminal including all of today's users; bets the product on a closed-beta terminal (C11); contradicts ADR 0004/0005 (terminal-native views, hardcoded data ink) without any new evidence; and buys nothing B doesn't — the native backend calls the same `describe()` either way (C4). There is no separate "Tern build" to justify it.
- Verdict: reject. If Tern ever becomes the only terminal, B *becomes* C by deleting `render()`.

## Recommendation

**Option B, phased, after the ANSI panel ships.** Order matters: the ANSI `render()`
path is both the universal product and the automatic fallback (C5), so native work
before the panel is solid is polish before product. When taken up:

1. Phase 1 (the experiment below): `nativeOverlay` + one-screen `describe` → proves the sheet mounts and events round-trip.
2. Phase 2: band-grammar mapping for all screens + `handleNativeEvent` for tabs/range → full dual-target.
3. Never Phase 3 (Option C) without new evidence (Tern ubiquity or host deprecation of ANSI).

Cost framing: Phase 1 is hours, Phase 2 is days, both are additive-only diffs to
`src/tui/panel.ts` (+ maybe one `src/tui/native.ts` mapper) with zero changes to
mount, data, IR, or tests-in-place. The single open technical question that could
resize Phase 2 is native scrolling (G2) — the experiment is designed to surface it.

## Gaps

- **G1 (sibling-owned): what Tern is.** A1 assumes Tern = Stencil Tern-terminal + TSP. If the sibling session finds otherwise (app API, plugin SDK, different "Tern"), this file's framing is wrong and must be redone.
- **G2 (largest technical unknown): native scrolling.** How a scrolled, 12-tab, variable-height panel behaves as native nodes is unexamined: whether `ScrollView` content describes as one tall `col` (terminal scrolls) or the panel keeps its own scroll offset with `reveal`/`scroll` ops, and what happens on terminals not advertising the `scroll` feature. The usage-dashboard precedent is shorter than our panel; read its `#describeDetail`/table path and `TspScrollBy` gating before sizing Phase 2.
- **G3: `chart` token/color mapping.** `TspChartProps.token` takes one color token; our multi-series charts use `SERIES_COLORS` (6 theme tokens). Unknown whether multi-series needs multiple `chart` nodes, `parts`-style stacking (a `meter` concept), or per-datum tones — read `NATIVE_REDESIGN.md §3–§5` (cited in `tsp.ts:402`) and the Stencil-side renderer behavior.
- **G4: `describeScreen` vs `nativeOverlay`.** Two fullscreen precedents exist (`describeScreen` in `raw-sse.ts:251`; `nativeOverlay` sheet in usage-dashboard). Default to the sheet (closest analog), but confirm what makes a page-of-its-own preferable.
- **G5: Tern presence for testing.** No Tern binary was located on this machine (A3). Without Tern, validation is limited to `PI_TUI_NATIVE_STATS=1` fallback counts, `PI_TUI_TSP_RECORD` frame capture, and the `Reconciler` unit path — sufficient to prove "describes correctly", insufficient to prove "looks right". A Tern beta seat (or the sibling session's environment) is the missing test rig.
- **G6: Host drift.** Installed host is 18.6.0 vs pinned 18.5.0 (A2). The TSP surface grew recently (C10); re-verify `Component` contract + `TSP_KINDS` after any host bump, since `describe()` couples to host internals exactly the way `@oh-my-pi/*` imports do (`src/index.ts` PINNED warning).

## Cheapest experiment (validates or kills dual-target)

**Add `nativeOverlay` + a minimal `describe()` to `StatsPanel` and observe one frame.**
Concretely, in a scratch branch (no `src/` commitment until it passes):

1. Add to `StatsPanel`:
   ```ts
   readonly nativeOverlay = { role: "omp.overlay.stats", size: "lg", anchor: "center", head: "Stats" } as const;
   describe(_cx: DescribeContext): NativeNode {
     return overlayCard("omp.overlay.stats", "Stats", [text("probe")]);
   }
   ```
   (builders from `@oh-my-pi/pi-tui/native/describe` + `native/overlay` — same imports as usage-dashboard, C7; `Component`, `DescribeContext`, `NativeNode` types from `@oh-my-pi/pi-tui` — note AGENTS.md's static-import rule).
2. Run `/stats-tui` with `PI_TUI_NATIVE_STATS=1` (and optionally `PI_TUI_TSP_RECORD=<file>`):
   - **In Tern (or any TSP terminal):** if a native "Stats" sheet mounts and `fallbackCount` for the panel is 0, dual-target is proven viable — proceed to Phase 1 proper (one real screen). If the panel still arrives as `rows` (fallbackCount 1) or the sheet never mounts, dual-target is blocked: read the `doc` debug op / recorded frames to see whether the terminal rejected the kind set, then decide (likely: fix role/kind usage, not abandon).
   - **Without Tern:** force the probe path check in a `bun test` against the real `Reconciler` — assert the panel's node reconciles with `fallbackCount === 0`. This proves "describes valid nodes" but not "Tern renders them" (G5).
3. Extend the probe once: return the `tabs` node for the screen strip, click/arrow it in Tern, and confirm `handleNativeEvent` fires and the screen changes. This answers the input half (C4) and surfaces G2 (scroll) at the smallest possible size.

**Kill criterion:** the overlay mounts natively but keyboard/pointer events never reach `handleNativeEvent`/`handleInput` (i.e., a native stats panel would be view-only in a way `/usage` is not) — or the fullscreen overlay is refused a screen surface and renders worse than today's ANSI. Either outcome is visible in a single session and costs one scratch diff. **Pass criterion:** sheet mounts + one event round-trips → Option B is viable and Phase 2 is just mapping work.
