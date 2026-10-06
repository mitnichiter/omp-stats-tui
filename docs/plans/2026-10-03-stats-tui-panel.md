# Stats Panel (`/stats-tui`) Implementation Plan

> Historical 18.4.10 implementation plan. Do not execute its old scope/version/read-only constraints as current instructions. The active [dashboard-parity roadmap](2026-10-05-dashboard-parity.md) supersedes them.

**Goal:** Ship a distributable omp plugin whose `/stats-tui` command opens a fullscreen overlay rendering the person's own local usage records, drawn from `~/.omp/stats.db` through the `@oh-my-pi/omp-stats` data layer with no webserver and no SQL of our own.

**Architecture:** Three seams. The **data seam** is a ~15-line adapter over the package's exported `handleApi(req: Request) => Promise<Response>` — a synthetic `Request` satisfies every read the function makes, so no socket is bound. The **view seam** is a set of pure render functions (`render* → readonly string[]`) that never read the theme singleton, take a resolved glyph set and a width, and are unit-testable headless. The **mount seam** is `ctx.ui.custom(factory, { overlay: true, overlayOptions })` with `fullscreen: true`, composing `OverlayPanel`/`PanelRows`/`PanelDivider` from `@oh-my-pi/pi-tui/chrome`. Ingest, which costs 7141 ms of synchronous SQLite, runs in a `SIGKILL`-able subprocess and never on the TUI thread.

**Tech Stack:** omp 18.4.10 · Bun 1.4.2 · TypeScript · `@oh-my-pi/omp-stats@18.4.10` (declared dependency) · `@oh-my-pi/pi-tui@18.4.10` (devDependency, for `bun test` only) · `bun test` · no framework, no bundler.

**Spec:** `docs/adr/0001`–`0006` (settled decisions), `CONTEXT.md` (glossary — its terms are load-bearing), `docs/research/omp-stats-tui/REPORT.md` (synthesis) and `docs/research/omp-stats-tui/findings/F1`–`F11` and `F14` (primary evidence). The plan argues from those and cites them by line; executors read both.

## Global Constraints

- **`~/.bun/install/global/node_modules/@oh-my-pi/` is READ-ONLY.** Never install into it, never modify it, never move it. Every `@oh-my-pi` import is either host-resolved at runtime or installed into this project's own `node_modules/`.
- **Nothing in this project writes outside the project directory**, except the plugin's own `node_modules/` produced by `bun install`. No file is created under `~/.omp/` — not an extension, not a plugin, not config. `~/.omp/stats.db` is read; `scripts/*.ts` open it `{ readonly: true }`.
- **Verification goes through `scripts/*.ts` run with `bun run scripts/<name>.ts`.** No ad-hoc shell one-liners. Each script reads state and prints; none writes to `~/.omp/` or to the database.
- **Test runner is `bun test`.** omp ships no extension test harness, so only pure functions exported from non-entry modules are under test. Do not test the overlay itself — see Task 16.
- **`~/.bun/install/global/node_modules/@oh-my-pi/pi-tui` must be a `devDependency`, not a `dependency`.** It resolves bare from an extension at runtime with no install (measured: 359 named exports in the real loader), but a bare `bun test` runs outside the loader and needs the real package on disk. Installing it as a `devDependency` gives both: 112 packages, ~1.1 s.
- **Static imports only.** Dynamic `import()` of any `@oh-my-pi/*` fails in the extension loader even for packages that resolve fine statically.
- **Pin `@oh-my-pi/*` exactly** (no carets), matching the host: `18.4.10`. Read `VERSION` from `@oh-my-pi/pi-coding-agent` at load and notify on mismatch; never refuse to load.
- **Do not print to stdout from extension code** — it corrupts the TUI. `console.error` is fine at load time.
- **Do not check exit codes to decide whether an extension loaded.** `omp models -e` exits 0 either way; read stderr.
- **Data ink must measure `Bun.stringWidth === 1`.** No braille, no Nerd Font PUA codepoints, no hand-rolled box drawing (consume `theme.boxRound.*`). **Emoji are permitted for section-heading icons only, under the `unicode` preset, where every one of them measures exactly 2 cells** (measured: `Bun.stringWidth("🪙") === 2`, `"💲"`, `"📊"`, `"📁"`, `"📅"` all 2; `"⏱"` and `"⬢"` and `"⚠"` are 1). The panel therefore reserves a **2-cell heading gutter** under `unicode`. Emoji are **forbidden inside any repeated data cell** — a bar cell, a sparkline column, a heatmap cell, a table cell. Never emit an emoji in a per-row glyph position.
- **Under the `nerd` preset, emit byte-identical data ink to `unicode`.** No Nerd glyph's semantics is magnitude.
- **Scale bars by cost, never by token count.** This database has a 41× price spread at comparable token volume across models.
- **Never print a bare token total.** Show fresh / cache-read / cache-write separately plus the cache share as a number; cache writes are excluded from the cache-rate denominator.
- **Never render a `$0.00` model cost as free.** 68,578 rows in this database have tokens > 0 and cost exactly 0. That is an unpriced request — unknown spend, not free spend.
- **Never call `syncAllSessions` on the TUI thread.** Never call `/api/sync`, `getProviderWindowStats` (network I/O) or `getRequestDetails` (reads transcripts off disk) from the load path.
- **`365d` is not a valid range** and silently resolves to the `24h` default. The valid set is exactly `1h | 24h | 7d | 30d | 90d | all`; the option list is hardcoded to it with no free-form entry.

### Settled decisions this plan implements

| ADR | Status here |
|---|---|
| 0001 — reuse `@oh-my-pi/omp-stats`, do not own SQL | Implemented as stated. The ADR's own text is already superseded in outcome; `AGENTS.md` records that. |
| 0002 — the command is `/stats-tui` | Implemented. Registered through `pi.registerCommand("stats-tui", …)`. |
| 0003 — read-only, no writes, surface the dirty-hour count | **Superseded on the sync clause only by ADR 0006.** Every other ADR-0003 guarantee is binding: the panel itself never writes, ingest never runs on the TUI thread, and the dirty-hour count is always visible (Task 5, Task 16). |
| 0004 — terminal-native views, no React port | Implemented. `Traces` and `Frustration` are registered as `excluded`, not ported. |
| 0005 — plain Unicode data ink, chrome through the symbol preset | **Refined by F10, which post-dates it.** F10 proved `theme.symbol()` cannot express a ramp (269 registered keys, zero of them a data-ink ramp), so a preset-aware glyph module of our own is the only implementable form of the same policy. Task 3 builds it. |
| 0006 — background ingest in a `SIGKILL`-able subprocess, superseding ADR 0003's no-sync clause | **Accepted; implemented by Task 12.** The panel paints from whatever the database already holds, then starts ingest in a child process that streams NDJSON progress and is `SIGKILL`ed on close. Measured cost 7141 ms for 3401 files / 151,107 rows; `bun:sqlite` is synchronous, so inline it freezes the TUI for seven seconds. Shape copied from `pi-coding-agent/src/stats/activity-worker.ts` + `activity-client.ts`. |

> **RESOLVED — sync: option (a). ADR 0006 exists and supersedes ADR 0003's no-sync clause.**
> The user's settled decision is option (a): mirror the stats dashboard and its server. Task 12 implements the subprocess ingest. The one residual question — *does the host already call `syncAllSessions` before an extension runs?* — is not a decision this plan makes; it is **settled by one run** of `scripts/probe-data.ts` immediately after a heavy session, comparing `getRollupStatus().dirtyHours` against the newest session file's mtime. If the host already syncs, Task 12 can be deferred without reopening anything here.

> **OPEN DECISION — heatmap data ink: one glyph with colour, or a shade ramp? (deliberately deferred to empirical comparison).**
> ADR 0005 and F10 chose a single `■` U+25A0 at four colours under `unicode`/`nerd`, with an ASCII ladder under `ascii`. Independent web research (primary sources, accessed 2026-10-03) argues the other way: **no** surveyed TUI degrades on `NO_COLOR`, locale or TTY detection — every fallback is an explicit user flag or a platform check — and ratatui's `symbols::shade` (` ` U+0020, `░` U+2591, `▒` U+2592, `▓` U+2593, `█` U+2588) is a shipped monochrome floor (`btop` uses `" ░▒█"` as its `tty_up` mode; gnuplot documents `set term block`).
> **Decision taken: keep it data-driven — this plan does NOT hardcode the choice.** The heatmap role is a **ramp keyed per preset**, so swapping `■`+colour for `░▒▓█` is a **one-line edit to a table value**, with no code change anywhere else. `scripts/probe-glyphs.ts` renders the heatmap row under each candidate ladder so the choice is made by **looking**, not by reasoning.
> **What would settle it:** running `bun run scripts/probe-glyphs.ts --heatmap` and comparing the two ladders side by side, plus one look at `/stats-tui` under a monochrome terminal with `symbolPreset: "unicode"`.
> **Not decided here.** Both ladders are width-1 (measured: `■` U+25A0 = 1, `░`/`▒`/`▓`/`█` = 1, `·` U+00B7 = 1), so either keeps the 108-cell row width and neither is foreclosed by this plan.

> **SETTLED — first batch of screens: option (a), `overview` + `activity` + `models`.**
> These three exercise five of the five chart primitives (vertical bar chart, sparkline, ranked bar list, share bar, calendar heatmap) plus both table shapes, so the chart layer is proven before a second screen depends on it. `activity` is not a stats-dashboard route; it is where `/usage`'s calendar heatmap belongs, and it is the hardest primitive to get right. All nine other routes remain scaffolded with their data contracts in place; promoting any one is a single self-contained task.

> **SETTLED — scaffolded screens render PLACEHOLDER DATA, not a "not built yet" line.**
> A scaffolded screen declares its `needs`, appears in the tab strip as a normal selectable tab, and renders a small, clearly-labelled sample of **realistic placeholder rows** — 4–8 rows shaped like the screen it stands in for — behind a visible dim `placeholder` marker on the first line. The layout is therefore reviewable and testable *today*, and the numbers are obviously fake to anyone reading them.
> **The hard rule: a scaffolded screen NEVER fetches.** It renders its fixture and returns. Selecting it must not issue a single adapter call, because a fetch the user cannot see the result of reads as a hang. Pinned by a snapshot-style test in Task 10 asserting the placeholder marker is present on every scaffolded screen's first rendered line, and by a fetch-counting assertion that the render is pure.

## Review Focus

The five input classes below are the ones most likely to bite a real person using this panel, most likely first. Each names the input and what a reasonable person would expect. Every one is pinned by a test in the task that owns the code.

1. **A model priced at exactly `$0.00` while other models cost real money.** Several top models on this database price at zero. A reasonable person expects the panel to say *unknown spend*, not *free* — a `$0.00` bar sitting next to `$935.72` with no annotation reads as a bug or a bargain. Pinned in Task 4 (`formatEstimatedCost(0, 12) === "N/A"`) and Task 13 (`costWithUnpriced` renders the unpriced count beside every cost figure).
2. **Billions of tokens, 95% cache-read.** This person is 23.2 B cache-read against 115 M fresh input. A reasonable person expects the panel to never show a single "24.4B tokens" figure: it is true and useless, and it makes a cheap session look like an expensive one. Pinned in Task 4 (`tokenCells` always returns four separate cells; no exported function returns a bare token sum).
3. **An empty or sparse range — a quiet night, or a database written five minutes ago.** A reasonable person expects an honest empty state, not a wall of zero-height bars that reads as "you did nothing today" when in fact the range has no data at all. Pinned in Task 7 (`renderDailyBars([], …)` returns the empty-state line) and Task 13 (an all-zero `overall` renders `No usage recorded in 24 hours.`, not zeroes).
4. **A terminal too narrow for the layout.** Someone in an 80×24 split pane. A reasonable person expects a single readable column with no torn borders, no overflow past the right edge, and no silently dropped panels — degraded, but legible. Pinned in Task 6 (`planLayout(40, 24, "unicode")` returns `columns: 1` and every returned width is ≥ 1; `planLayout(20, 10, …)` still returns a valid plan).
5. **Symbol preset `ascii`.** Someone who set `symbolPreset: "ascii"` because their font is unreliable. A reasonable person expects every data-ink character to be ASCII *and* every row to be exactly the same width — an ASCII glyph ladder that misaligns by one cell is worse than the Unicode one. Pinned in Task 3 (all 10 roles × 3 presets measured with `Bun.stringWidth`; a 7×53 heatmap renders 108 cells on every row under both `ascii` and `unicode`).
6. **A stale rollup backlog.** Someone right after an omp upgrade that bumped `ROLLUP_VERSION`, leaving thousands of dirty hours. A reasonable person expects the panel to *say* it is behind, never to render not-yet-built hours as `$0.00` — that is a lie about money. Bound to the user by ADR 0003. Pinned in Task 5 (`fetchFor` returns `rollupStatus` from `getRollupStatus()`; the adapter test asserts it is present) and verified manually in Task 16 by rendering the footer against a fixture with `dirtyHours: 4281`.
7. **A scaffolded screen showing placeholder data.** Someone who tabs to `costs` before it is built. A reasonable person expects to see that the layout *would* look right, with an unmistakable marker saying the numbers are not real — and they expect it not to hang. A scaffold that fetches real data and shows it unlabelled would be actively misleading; one that fetches and then says "not built yet" reads as a hang. Pinned in Task 10 (every scaffolded screen's first rendered line contains the dim `placeholder` marker; a fetch-counting assertion proves the render issues no adapter call).
8. **An emoji leaking into a data cell.** Under `symbolPreset: "unicode"` every section-heading icon is 2 cells wide (measured), so it is tempting to reuse one per row. A reasonable person expects headings to be emoji and *data* to be plain blocks — an emoji in a bar column silently doubles that cell's width and misaligns the whole chart. Pinned in Task 3 (`STATS_ICONS` unicode values are all emoji, `Bun.stringWidth` 2 or 1; the data-ink width test asserts every `GlyphSet` value is exactly 1, so an emoji cannot enter a ramp without failing the suite).

---

## Reconciliation: web research against F10's glyph system

F10 (`docs/research/omp-stats-tui/findings/F10-glyph-system.md`) designed a preset-aware glyph module and proved alignment with `Bun.stringWidth` — 108 cells on every heatmap row under both the `unicode` and `ascii` ladders. Independent web research over primary sources (accessed 2026-10-03) was run to stress-test it. Result, in the order the user asked for:

**Where the research confirms F10 — no change:**

- **Data ink stays plain Unicode block elements.** `spark`'s `ticks=(▁ ▂ ▃ ▄ ▅ ▆ ▇ █)` (U+2581–U+2588, `spark` L59), visidata's `disp_sparkline` (U+2581–U+2587, `sparkline.py` L9) and `bottom`'s eighth-block gauges (`pipe_gauge.rs` L41-50) are three independent implementations converging on the same ramp. F10's `sparkRamp` is the standard, and nothing better exists for a one-row sparkline.
- **Braille stays excluded.** The research reached the same verdict independently, for the same structural reason: braille is a 2×4 raster, one foreground colour per character cell, and plotext excludes its higher-resolution sextant table on Windows outright (`high_def.cpp` L32) because font support is genuinely poor. F8 and ADR 0005 stand.
- **Emoji and Nerd Font stay excluded from *data ink*.** Measured directly: every candidate glyph in every surveyed ramp returns `Bun.stringWidth === 1` under Bun 1.4.2, while `🪙` U+1FA99 returns 2. This is the mechanical reason, and it agrees with F10. **F14 refines rather than reverses this:** emoji are permitted for *section-heading icons* under the `unicode` preset, in a reserved 2-cell gutter (Task 3's `STATS_ICONS`), because a heading renders once and padding absorbs its width. The prohibition is unchanged for any repeated data cell. Nerd Font PUA stays excluded from data ink entirely — no PUA codepoint's semantics is magnitude; it is confined to `STATS_ICONS.nerd`.
- **The alternate screen buffer solves the last-row/last-column problem, and we already have it.** `bottom` calls `EnterAlternateScreen` (`src/lib.rs` L367); `btop` writes `?1049h`/`?1049l` directly (`btop_tools.cpp` L759-760). Both then never face a bottom-right cell because there is no scrollback. `OverlayOptions.fullscreen: true` is documented as exactly this borrow (`pi-tui/src/tui.ts:459-468`), so the fix costs zero new code and `fullscreen: true` is not optional.
- **Preset-as-setting, not capability detection, is the right seam.** The research grepped `LC_ALL|LANG|NO_COLOR|isatty` across every cloned repository and found **zero** automatic glyph degradation; the only automatic trigger in the entire set is plotext's `sys.platform in {"win32","cygwin"}`. omp matches this exactly: `NO_COLOR` gates hyperlinks only (`pi-tui/src/render/hyperlink.ts:95`), and there is no `TERM=dumb` check anywhere. F10's one `getSymbolPreset()` read is the correct shape.
- **Never emit a trailing newline after the bottom row.** gnuplot's `dumb` driver does this deliberately: `if (dumb_feed || y > 0) putc('\n', …)` (`term/dumb.trm` L612-613). Our render functions return a `readonly string[]` and never concatenate, so this is satisfied by construction — Task 3 pins it with a test.

**Where the research beats F8 — one change, in Task 7:**

- **The daily bar chart must repeat a single glyph, not use the eighth ramp.** F8 and REPORT §9 recommended eighth blocks for vertical daily bars. plotext (`docs/source/bar.rst` L55: marker `'full'` → `█` U+2588, `width` 0.8 of the inter-bar gap), gnuplot `dumb` (`fillchar` defaults to one repeated character), and `termplot` (`make_col`, one repeated glyph per column) all use a **single repeated glyph** for vertical bars, because eighths describe a value's height *within one cell* — stacked vertically they give every bar a staircase top edge and near-equal bars no shared top line. F10's `barFill`/`barEmpty` roles already cover this. The correction costs no new glyphs: `bars.ts` uses `barFill`, `sparkline.ts` uses `sparkRamp`.
- **Explicit downsampling is required, and no surveyed tool provides it.** plotext stretches, `asciichart` overflows (`width = max(series lengths) + offset`, `asciichart.js` L63-67), `spark` has no width logic at all, and `termplot` documents its own inaccuracy (`term_plot.py` L37-38). `bucketToWidth` in Task 7 is therefore genuinely new code, and it is the one place the panel must decide an aggregation rule for itself.

**One finding that is a genuine gap in the ecosystem, and which we close for free:** no surveyed tool degrades glyphs on `NO_COLOR` or a monochrome terminal. F10's `ascii` ladder is, in the research's words, "the single highest-value addition" available — because it is the only fallback in the set that produces a *legible* chart rather than a merely plainer one. That is a point in F10's favour, not against it.

---

## File Structure

Every file is named here with the one responsibility it owns. Files that change together live together: the five charts share `src/tui/charts/`; the twelve screens share `src/tui/screens/`; the four probes share `scripts/`.

```
omp-stats-tui/
  package.json              # plugin manifest + omp.extensions + pinned deps
  bun.lock                  # committed; the install is the packaging (Task 1)
  tsconfig.json             # strict, Bun types, noEmit
  .gitignore                # node_modules/ and nothing else
  src/
    index.ts                # the extension factory; registers /stats-tui, nothing else
    data/
      ranges.ts             # the six valid ranges, cycling, labels, bucket counts
      api.ts                # THE DATA SEAM — synthetic Request → handleApi → typed fetchers
    tui/
      glyphs.ts             # THE ONE PRESET SWITCH. 10 roles × 3 presets. Pure.
      format.ts             # number + time vocabulary; re-exports the package's formatters
      icons.ts             # THE SECOND PRESET TABLE — Record<SymbolPreset, Record<IconRole, string>>. Reuses theme.symbol() for 10 of 16 roles.
      layout.ts             # (width, rows, preset) → LayoutPlan. The narrow-terminal seam.
      panel.ts              # the overlay component: frame, scroll, keys, footer, dispose
      charts/
        bars.ts             # vertical daily bar chart + bucketToWidth downsampler
        sparkline.ts        # sparkline, ranked bar list, share bar  (the three thin ones)
        heatmap.ts          # calendar heatmap + the four-stop colour ramp
      screens/
        types.ts            # ScreenId, ScreenStatus, DataNeed, ScreenContext, Screen, SCREENS
        placeholders.ts     # PLACEHOLDER_MARKER + scaffold() — the shared "fake but reviewable" renderer
        overview.ts         # implemented  — stat grid, daily bars, sparkline, share bar, table
        activity.ts         # implemented  — calendar heatmap + daily bars
        models.ts           # implemented  — ranked bar list, per-row sparkline, table
        costs.ts            # scaffolded  — data contract in place
        projects.ts         # scaffolded
        requests.ts         # scaffolded
        errors.ts           # scaffolded
        tools.ts            # scaffolded
        providers.ts        # scaffolded
        gain.ts             # scaffolded
        traces.ts           # excluded    — flamegraph, no terminal equivalent (ADR 0004)
        frustration.ts      # excluded    — paid judge job, no TUI equivalent (ADR 0004)
    sync/
      client.ts             # spawns the worker, parses its NDJSON, SIGKILLs on abort
  scripts/
    probe-data.ts           # times every range query against the live DB, read-only
    probe-glyphs.ts         # every role × every preset, with codepoint + Bun.stringWidth
    probe-render.ts         # renders any layout/chart function at a given width
    sync-worker.ts          # the background ingest subprocess
  test/
    glyphs.test.ts
    ranges.test.ts
    format.test.ts
    api.test.ts
    layout.test.ts
    bars.test.ts
    sparkline.test.ts
    heatmap.test.ts
    screens.test.ts
```

Dependency direction is strictly downward: `index.ts` → `panel.ts` → `screens/` → `charts/` + `format.ts` + `layout.ts` → `glyphs.ts`; `screens/` → `api.ts` → `ranges.ts`. Nothing in `data/` imports anything from `tui/`. That is what lets Task 5's adapter tests run with no terminal.

## Modules and their interfaces

| Module | Interface | Depth |
|---|---|---|
| `data/api.ts` | `apiGet<T>(path, params?)`, `fetchOverview(range)`, … , `fetchFor(needs, range)` | Deep: 23 upstream routes, JSON encoding, error mapping, type selection and the `initDb()` ordering trap all sit behind 10 one-line functions. |
| `data/ranges.ts` | `RANGES`, `Range`, `DEFAULT_RANGE`, `isRange`, `nextRange`, `rangeLabel`, `bucketCountFor` | Deep: validation, cycle order, human labels and expected bucket counts behind 7 constants/functions. |
| `tui/glyphs.ts` | `GlyphRole`, `GlyphSet`, `glyphsFor(preset)`, `glyph(preset, role, level?)` | Deep: three presets, ten roles, ramp clamping and the ASCII ladder behind one switch. |
| `tui/format.ts` | `costWithUnpriced`, `tokenCells`, `cacheShare`, plus re-exports | Deep: the unpriced-request rule and the cache-denominator rule behind two functions, not scattered call sites. |
| `tui/icons.ts` | `IconRole`, `STATS_ICONS`, `statsIcon(preset, role)`, `ICON_GUTTER` | Deep: per-preset icon selection, host-key reuse, and the emoji gutter width behind one lookup. Sits beside `glyphs.ts` because both are preset switches, but they obey opposite width rules — icons may be 2 cells, data ink may not. |
| `tui/layout.ts` | `LayoutPlan`, `planLayout(width, rows, preset)` | Deep: every width threshold, every degradation decision, behind one pure call. |
| `tui/charts/*` | `render*(data, opts) → readonly string[]` | Each is shallow but that is correct — a chart is a rendering, and it is the *composition* of five of them behind the panel that pays. |
| `tui/panel.ts` | `StatsPanel` implementing `Component` | Deep: load orchestration, scroll clamping, key cascade, range cycling, footer composition, idempotent dispose. Not unit-tested — see Task 16. |

---

## Task 1: Plugin skeleton and install

Establishes the package as a loadable plugin with `@oh-my-pi/omp-stats` declared. This is the packaging decision the research settled on: a `package.json` declaring the dependency plus `bun install` (measured 146 ms / 12 packages, and 84 ms for the single-dependency manifest) installs the `pi-natives-darwin-arm64` sibling that the bare specifier otherwise lacks, which makes the plain bare specifier work.

**Files:**
- Create: `package.json`
- Verify: `.gitignore` (already present in the repo baseline commit; must contain `node_modules/` and nothing else)
- Create: `tsconfig.json`
- Create: `src/index.ts`
- Create (generated, committed): `bun.lock`

**Interfaces:**
- Consumes: nothing. This is the root task.
- Produces: a package at `omp-stats-tui` whose default export is `export default function (pi: ExtensionAPI): void`, loadable by `omp models -e src/index.ts`. Later tasks import nothing from `src/index.ts`; it is an entry point, never a module. Tasks 2–15 import from `src/data/`, `src/tui/` and `scripts/`.

- [ ] **Step 1: Write the manifest**

```json
{
  "name": "omp-stats-tui",
  "version": "0.1.0",
  "type": "module",
  "description": "Fullscreen local usage-stats panel for omp",
  "scripts": {
    "test": "bun test",
    "probe:data": "bun run scripts/probe-data.ts",
    "probe:glyphs": "bun run scripts/probe-glyphs.ts",
    "probe:render": "bun run scripts/probe-render.ts"
  },
  "omp": {
    "name": "omp-stats-tui",
    "description": "Fullscreen local usage-stats panel for omp",
    "extensions": ["./src/index.ts"]
  },
  "dependencies": {
    "@oh-my-pi/omp-stats": "18.4.10"
  },
  "devDependencies": {
    "@oh-my-pi/pi-coding-agent": "18.4.10",
    "@oh-my-pi/pi-tui": "18.4.10"
  }
}
```

`omp.extensions` paths are relative to the package root and authoritative when non-empty. Do not add `omp.commands`, `omp.agents`, `omp.rules`, `omp.mcp` or `omp.lsp` — they are not manifest keys and do nothing. `pi-tui` is a **devDependency**: it resolves bare at runtime with no install, but `bun test` runs outside the loader and needs the package on disk.

- [ ] **Step 2: Confirm `.gitignore` covers the install**

Read `.gitignore`. It must contain exactly `node_modules/` — that is the only build artifact this project produces, so nothing else belongs in it. Check it here rather than later: the install in Step 5 writes ~180 MB of native addon into the tree, and an unignored `node_modules/` is a 180 MB accidental commit.

- [ ] **Step 3: Write `tsconfig.json`**

`strict: true`, `noEmit: true`, `moduleResolution: "bundler"`, `target: "ESNext"`, `types: ["bun"]`, `include: ["src", "scripts", "test"]`.

- [ ] **Step 4: Write the failing load probe**

`src/index.ts`:

```ts
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { VERSION } from "@oh-my-pi/pi-coding-agent";

const PINNED = "18.4.10";

export default function (pi: ExtensionAPI): void {
	if (VERSION !== PINNED) {
		console.error(`[stats-tui] built against omp ${PINNED}, host is ${VERSION}`);
	}
	pi.registerCommand("stats-tui", {
		description: "Local usage stats, fullscreen",
		handler: async () => {},
	});
}
```

The handler body is empty on purpose — Task 11 replaces it. What this task proves is that the plugin loads at all.

- [ ] **Step 5: Install**

Run: `bun install`
Expected: `12 packages installed` or more, and `node_modules/@oh-my-pi/` containing `omp-stats` **and** `pi-natives-darwin-arm64`. That sibling is the entire point of this task — it is what the flat Bun install cache omits, and its absence is what makes the bare specifier die with `Failed to load pi_natives native addon for darwin-arm64`.

- [ ] **Step 6: Verify the extension loads in the real loader**

Run: `bun run --silent scripts/../src/index.ts >/dev/null 2>&1 || true` — no. Use the real probe:

Run: `omp models -e src/index.ts 2>&1 | grep -i "stats-tui\|Failed to load"`
Expected: **no** `Failed to load` line. A version-skew warning is acceptable and expected to be absent. The exit code is 0 either way — read stderr, do not check `$?` (measured: `omp -e <file> models` silently ignores the extension; `-e` must follow the subcommand).

- [ ] **Step 7: Verify `bun test` can resolve `@oh-my-pi/pi-tui`**

Create `test/resolution.test.ts`:

```ts
import { test, expect } from "bun:test";
import { visibleWidth, renderTableRow } from "@oh-my-pi/pi-tui";
import { OverlayPanel } from "@oh-my-pi/pi-tui/chrome";
import { handleApi } from "@oh-my-pi/omp-stats/server";

test("every package the extension imports resolves under bun test", () => {
	expect(typeof visibleWidth).toBe("function");
	expect(typeof renderTableRow).toBe("function");
	expect(typeof OverlayPanel).toBe("function");
	expect(typeof handleApi).toBe("function");
});
```

Run: `bun test test/resolution.test.ts`
Expected: `1 pass`.

- [ ] **Step 8: Commit**

```bash
git add package.json bun.lock .gitignore tsconfig.json src/index.ts test/resolution.test.ts
git commit -m "feat(plugin): scaffold loadable omp-stats-tui plugin with pinned deps"
```

---

## Task 2: Verification scripts

No ad-hoc shell. Four named TypeScript scripts, each of which prints and none of which writes. `scripts/probe-data.ts` is how we re-measure instead of trusting a number quoted in a findings file; the findings' timings are all warm-page-cache on one machine and every one of them will drift.

**Files:**
- Create: `scripts/probe-data.ts`
- Create: `scripts/probe-glyphs.ts`
- Create: `scripts/probe-render.ts`
- Create: `scripts/sync-worker.ts` (placeholder this task; Task 12 fills it in)

**Interfaces:**
- Consumes: `handleApi` from `@oh-my-pi/omp-stats/server`; `getDashboardStats`, `getTimeRangeConfig` from `@oh-my-pi/omp-stats/aggregator`; `getRollupStatus` from `@oh-my-pi/omp-stats/rollup`; `getDailyActivity` from `@oh-my-pi/omp-stats/db`.
- Produces: four runnable entry points and **no exported symbols**. Nothing in `src/` or `test/` imports a script. Task 3 imports `glyphsFor`/`GlyphRole` from `src/tui/glyphs.ts` — `probe-glyphs.ts` does not define them.

- [ ] **Step 1: Write `scripts/probe-data.ts`**

Open `~/.omp/stats.db` read-only (the package's own handle is read-write with write *intent*, even though it produces no mutation — 866.9 ms with mtime and size byte-identical). Print, for each of the six valid ranges plus the invalid `365d`, the wall-clock cost of `getDashboardStats(range)` over three runs, and print `getRollupStatus()`.

What it prints:

```
range    run0    run1    run2   bucket     first-bucket
1h      434.2     4.8     4.8   5m         2026-10-03T08:00
24h       1.2     1.2     1.2   1h         2026-10-02T17:00
…
365d      1.2       —       —   1h         2026-10-02T17:00   ← INVALID: same cutoff as 24h

initDb ms: 866.9   mtime changed: false   size changed: false
rollupStatus: {"dirtyHours":2,"dirtySessions":5}
getDailyActivity(371) ms: 141.9   rows: 72
```

What it proves: every range is under 20 ms warm, so no range needs a subprocess; `365d` is bit-identical to `24h` and must never be offered; `initDb()` costs most of a second and does not mutate the file; the daily-activity scan is the one query that is slow enough to justify the subprocess.

- [ ] **Step 2: Run it**

Run: `bun run scripts/probe-data.ts`
Expected: a table for all seven keys. Record the numbers in the PR description; they replace the quoted findings numbers for this machine.

- [ ] **Step 3: Write `scripts/probe-glyphs.ts`**

Walk the `SYMBOL_PRESETS` structure from `src/tui/glyphs.ts` — which does not exist yet, so for this task read the ten roles directly from `@oh-my-pi/pi-tui/theme/symbols.ts` for the chrome keys and hardcode nothing. Print, for each preset and each role, the character, its codepoint in hex, and `Bun.stringWidth`:

```
preset    role           glyph  codepoint  width
unicode   barFill        █      2588       1
unicode   sparkRamp[0]   ▁      2581       1
ascii     barFill        #      0023       1
ascii     sparkRamp[7]   @      0040       1
```

What it proves: no candidate is width 2 (emoji would be), so the column grid needs no per-cell compensation; and a preset regression — a glyph someone changed that is no longer single-cell — is visible at a glance rather than as a one-cell misalignment in a screenshot.

- [ ] **Step 4: Run it**

Run: `bun run scripts/probe-glyphs.ts`
Expected: every `width` column is `1`. Any `2` is a stop-the-line finding.

- [ ] **Step 5: Write `scripts/probe-render.ts`**

Take a module path, an exported function name, a width and optional height as `process.argv`, import it, call it, print each returned row with its `Bun.stringWidth`. Default to rendering a chart at width 108.

```
$ bun run scripts/probe-render.ts src/tui/charts/bars.ts renderDailyBars 108 8
row 0  width 108
row 1  width 108
…
```

What it proves: alignment at a chosen width without launching a terminal, which is the only way to check a layout during development. When a test fails on a width assertion, this script shows the actual misalignment.

- [ ] **Step 6: Write the `scripts/sync-worker.ts` placeholder**

```ts
// Placeholder. Task 12 replaces this with the real ingest subprocess.
console.error("[sync-worker] not implemented yet");
process.exit(1);
```

- [ ] **Step 7: Commit**

```bash
git add scripts/probe-data.ts scripts/probe-glyphs.ts scripts/probe-render.ts scripts/sync-worker.ts
git commit -m "feat(scripts): named verification probes, replacing ad-hoc shell"
```

---

## Task 3: Glyph module

The one preset switch. Ten roles: `barFill`, `barEmpty`, `sparkRamp`, `heatCell`, `heatEmpty`, `heatMarker`, `columnGap`, `trendUp`, `trendFlat`, `trendDown`.

**Two corrections to F10's draft, both forced by measurement:**

1. **Take the preset as a parameter; do not import the `theme` singleton.** F10's sketch defaults to `theme` at module scope. Importing `theme` at module scope **throws at extension load time** in the loader process (`omp models -e`), because theme initialisation has not run — measured. In `bun test` it works only after `ensureThemeSync()`. A pure function of `(preset)` is testable with no ordering constraint and cannot throw at load. The panel reads `theme.getSymbolPreset()` exactly once per frame and passes it down.
2. **`nerd` is byte-identical to `unicode` for data ink.** No Nerd Font codepoint's semantics is magnitude.

**Task 3 builds TWO tables, not one.** They are the two halves of the preset story and they obey opposite width rules:

- `Record<SymbolPreset, GlyphSet>` — **data-mark ramps**. Every value must measure `Bun.stringWidth === 1`. No emoji, no PUA, no braille. This is what makes the heatmap choice a one-line table edit rather than a code change.
- `Record<SymbolPreset, Record<IconRole, string>>` — **section-heading and inline icons**. Emoji are permitted here under `unicode` (2 cells, in a reserved gutter). Under `nerd` they are Nerd Font PUA codepoints; under `ascii` they are short ASCII labels. Not width-constrained to 1.

**Icon policy (settled by the user, per F14):** icons reuse `theme.symbol()` wherever a host key already exists. F14 dumped `SYMBOL_PRESETS` and found **10 of our 16 roles already registered** — `icon.cost` (`💲` U+1F4B2 / `` U+F155 / `$`), `icon.tokens` (`🪙` U+1FA99 / `` U+E26B / `tok:`), `icon.time` (`⏱` U+23F1 / `` U+F017 / `t:`), `icon.model` (`⬢` U+2B22 / `` U+EC19 / `[M]`), `icon.extensionTool` (`🛠` U+1F6E0 / `` U+F0AD / `TL`), `icon.folder` (`📁` U+1F4C1 / `` U+F115 / `[D]`), `status.error` (`✘` U+2718 / `` U+F00D / `[!!]`), `icon.cache` (`💾` U+1F4BE / `` U+F1C0 / `cache`), `icon.warning` (`⚠` U+26A0 / `` U+F071 / `[!]`), `icon.host` (`🖥` U+1F5A5 / `` U+F109 / `host`) — plus `cmd.stats` and `icon.cacheMiss`. Reading those through `theme.symbol()` means a future host change propagates for free. **Only 4 roles are new: `calendar`, `gains`, `trendUp`, `trendDown`.**

> **ADR-0007 candidate — the icon policy.** The rule "icons are preset-keyed and reusable from `theme.symbol()`; emoji allowed for headings under `unicode`, never for data ink; ASCII uses short labels" is exactly the shape of a decision that needs its own ADR, because it is a *chrome* policy that F14's measurements would otherwise be asked to re-derive every time. **This plan does not write it.** Flagged as a candidate only; the executor of Task 3 must not create `docs/adr/0007-*.md` without a human asking for one.

**Two measurement traps F14 found. Both become test cases.**

1. **`sep.pipe` must never be used as a column separator.** Measured: `" │ "` is `Bun.stringWidth === 3` under `unicode` and `ascii`, while its `nerd` value `` U+E0B3 is **1**. Using it would silently triple column gaps on two presets and leave the third correct. Use the bare `│` U+2502 (= `boxRound.vertical`) or `|` U+007C, both width 1 in every preset.
2. **The warning icon must use the bare `⚠` U+26A0, never `⚠️`.** Measured: bare `⚠` is `Bun.stringWidth === 1`; `⚠️` (U+26A0 followed by VS16 U+FE0F) is **2**. `theme.symbol("icon.warning")` already returns the bare form — this is the test that stops someone "correcting" it later.

**Files:**
- Create: `src/tui/glyphs.ts`
- Create: `test/glyphs.test.ts`
- Modify: `scripts/probe-glyphs.ts` (switch it to read the real module)
- Create: `src/tui/icons.ts`
- Modify: `test/glyphs.test.ts` (the icon cases live beside the ramp cases — one module, one file)

**Interfaces:**
- Consumes: nothing from earlier tasks except the package install.
- Produces:
  ```ts
  export type SymbolPreset = "unicode" | "nerd" | "ascii";
  export type GlyphRole =
    | "barFill" | "barEmpty" | "sparkRamp" | "heatCell" | "heatEmpty"
    | "heatMarker" | "columnGap" | "trendUp" | "trendFlat" | "trendDown";
  export type GlyphValue = string | readonly string[];
  export type GlyphSet = Readonly<Record<GlyphRole, GlyphValue>>;
  export const HEAT_LEVELS: 4;
  export function glyphsFor(preset: SymbolPreset): GlyphSet;
  export function glyph(preset: SymbolPreset, role: GlyphRole, level?: number): string;
  ```
  ```ts
  // src/tui/icons.ts — the second preset table
  export type IconRole =
    | "cost" | "tokens" | "requests" | "time" | "models" | "providers"
    | "tools" | "projects" | "errors" | "calendar" | "gains"
    | "trendUp" | "trendDown" | "unknown" | "cache" | "warning";
  export const STATS_ICONS: Record<SymbolPreset, Record<IconRole, string>>;
  export const HOST_ICON_KEYS: Partial<Record<IconRole, SymbolKey>>;  // 12 of 16 roles route through theme.symbol()
  export const NEW_ICON_ROLES: readonly IconRole[];                  // exactly ["calendar","gains","trendUp","trendDown"]
  export const ICON_GUTTER: Record<SymbolPreset, number>;            // unicode: 2 (emoji), nerd: 1, ascii: length of the label
  export function statsIcon(preset: SymbolPreset, role: IconRole, theme?: Theme): string;
  ```
  Tasks 7, 8 and 9 consume `GlyphSet` and `glyph`. Task 13 consumes `glyph` for its table rules **and `statsIcon` for its section headings**.

- [ ] **Step 1: Write the failing tests**

`test/glyphs.test.ts`:

```ts
import { test, expect } from "bun:test";
import { ensureThemeSync } from "@oh-my-pi/pi-tui/theme";
import { type GlyphSet, glyph, glyphsFor, HEAT_LEVELS } from "../src/tui/glyphs";
import { STATS_ICONS, HOST_ICON_KEYS, NEW_ICON_ROLES, ICON_GUTTER, statsIcon } from "../src/tui/icons";

const PRESETS = ["unicode", "nerd", "ascii"] as const;

test("every data-ink glyph in every preset is exactly one cell wide", () => {
	for (const preset of PRESETS) {
		const set = glyphsFor(preset);
		for (const [role, value] of Object.entries(set)) {
			const glyphs = typeof value === "string" ? [value] : value;
			for (const g of glyphs) {
				if (role === "heatEmpty" && preset === "ascii") continue; // U+0020, deliberately blank
				expect(Bun.stringWidth(g), `${preset}/${role}/${g}`).toBe(1);
			}
		}
	}
});

test("nerd preset emits byte-identical data ink to unicode", () => {
	expect(glyphsFor("nerd")).toEqual(glyphsFor("unicode"));
});

test("sparkRamp is the eight vertical eighths, lowest first", () => {
	expect(glyph("unicode", "sparkRamp", 0)).toBe("▁");
	expect(glyph("unicode", "sparkRamp", 7)).toBe("█");
	expect(glyphsFor("unicode").sparkRamp).toHaveLength(8);
});

test("barFill is the full block, barEmpty the light shade — the daily-bar pair", () => {
	expect(glyph("unicode", "barFill")).toBe("█");     // U+2588
	expect(glyph("unicode", "barEmpty")).toBe("░");    // U+2591
});

test("heatCell is a RAMP, so the ladder is a one-line table edit, not a code change", () => {
	// The user settled this as a data-driven decision (Settled decisions block). The
	// test therefore asserts the SHAPE — a per-level ramp — and not a particular ladder.
	// Swapping unicode heatCell from "■" to ["░","▒","▓","█"] must not require touching this test.
	for (const preset of PRESETS) {
		const value = glyphsFor(preset).heatCell;
		expect(Array.isArray(value) || typeof value === "string", `${preset} heatCell`).toBe(true);
	}
	// Whatever the ladder is, every level must be exactly one cell wide, so swapping
	// ladders can never break the 108-cell row width asserted below.
	for (const preset of PRESETS) {
		for (let level = 1; level <= HEAT_LEVELS; level++) {
			expect(Bun.stringWidth(glyph(preset, "heatCell", level)), `${preset} heat level ${level}`).toBe(1);
		}
	}
});

test("the shade-ramp alternative is admissible without any code change (deferred decision)", () => {
	// Deferred to empirical comparison — this test exists to prove the SWAP is cheap,
	// not to pick a winner. If someone swaps UNICODE_GLYPHS.heatCell to the shade ramp,
	// this assertion must keep passing.
	const SHADE = ["░", "▒", "▓", "█"] as const;
	expect(SHADE).toHaveLength(HEAT_LEVELS);
	for (const g of SHADE) expect(Bun.stringWidth(g)).toBe(1);
	expect(glyph("unicode", "heatCell", 1)).not.toBe(glyph("unicode", "heatCell", 2));
});

test("MEASUREMENT TRAP: sep.pipe is 3 cells under unicode but 1 under nerd — never a column separator", () => {
	// Measured with Bun.stringWidth. Using sep.pipe here would triple the gap on two
	// presets and leave the third correct: an alignment bug invisible in one preset.
	const unicode = ensureThemeSync().symbol("sep.pipe");
	expect(Bun.stringWidth(unicode)).toBe(3);
	expect(Bun.stringWidth(glyph("unicode", "columnGap"))).toBe(1);
	expect(glyph("unicode", "columnGap")).not.toBe(unicode);
});

test("MEASUREMENT TRAP: bare ⚠ is 1 cell, ⚠️ with VS16 is 2 — the warning icon uses the bare form", () => {
	expect(Bun.stringWidth("⚠")).toBe(1);          // U+26A0
	expect(Bun.stringWidth("⚠️")).toBe(2);         // U+26A0 U+FE0F
	expect(statsIcon("unicode", "warning")).toBe("⚠");
	expect(statsIcon("unicode", "warning")).not.toContain("\uFE0F");
});

test("icons: unicode preset uses emoji, nerd uses PUA, ascii uses plain ASCII labels", () => {
	expect(statsIcon("unicode", "cost")).toBe("💲");
	expect(statsIcon("nerd", "cost")).toBe("\uF155");
	expect(statsIcon("ascii", "cost")).toBe("$");
	for (const icon of Object.values(STATS_ICONS.ascii)) {
	expect(/^[\x20-\x7E]+$/.test(icon), `ascii icon must be ASCII: ${icon}`).toBe(true);
}
});

test("icons: only four roles are new; twelve route through a host key", () => {
	expect([...NEW_ICON_ROLES].sort()).toEqual(["calendar", "gains", "trendDown", "trendUp"]);
	expect(Object.keys(STATS_ICONS.unicode)).toHaveLength(16);
	expect(Object.keys(HOST_ICON_KEYS)).toHaveLength(12);
});

test("icons: every unicode icon is one or two cells, and ICON_GUTTER matches the widest", () => {
	for (const [role, icon] of Object.entries(STATS_ICONS.unicode)) {
		expect([1, 2]).toContain(Bun.stringWidth(icon));
	}
	expect(ICON_GUTTER.unicode).toBe(2);   // emoji are 2 cells; headings reserve the wider gutter
	expect(ICON_GUTTER.nerd).toBe(1);
});

test("ascii heat ladder is . - + #, distinct per level", () => {
	const set = glyphsFor("ascii");
	expect(set.heatCell).toEqual([".", "-", "+", "#"]);
	expect(new Set(set.heatCell as readonly string[]).size).toBe(4);
	expect(set.heatEmpty).toBe(" ");
});

test("ascii sparkline is an eight-rung ranking ladder, all distinct", () => {
	const ramp = glyphsFor("ascii").sparkRamp as readonly string[];
	expect(ramp).toHaveLength(8);
	expect(new Set(ramp).size).toBe(8);
	for (const g of ramp) expect(Bun.stringWidth(g)).toBe(1);
});

test("glyph clamps the level into the ramp instead of returning undefined", () => {
	expect(glyph("unicode", "sparkRamp", 99)).toBe("█");
	expect(glyph("unicode", "sparkRamp", -5)).toBe("▁");
	expect(glyph("unicode", "heatCell", 7)).toBe(glyph("unicode", "heatCell", HEAT_LEVELS));
});

test("a 7x53 heatmap is exactly 108 cells wide on every row, under both ladders", () => {
	for (const preset of ["unicode", "ascii"] as const) {
		const set = glyphsFor(preset);
		const gap = preset === "ascii" ? "|" : "│";
		const widths = new Set<number>();
		for (let day = 0; day < 7; day++) {
			const label = `${["M","T","W","T","F","S","S"][day]} `;
			let row = label;
			for (let week = 0; week < 53; week++) {
				const level = (day * 7 + week) % 5;
				row += (level === 0 ? glyph(preset, "heatEmpty") : glyph(preset, "heatCell", level)) + gap;
			}
			widths.add(Bun.stringWidth(row));
		}
		expect([...widths], `${preset} heatmap row widths`).toEqual([108]);
	}
});
```

The last test is Review Focus line 5. It is the whole reason this module exists.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test test/glyphs.test.ts`
Expected: FAIL — `Cannot find module '../src/tui/glyphs'`.

- [ ] **Step 3: Implement `src/tui/glyphs.ts`**

Two `const` tables and one lookup. `nerd` and `unicode` share the *same object*, not two copies — the test asserts identity by value, and sharing the object makes that structural.

```ts
import type { SymbolPreset } from "@oh-my-pi/pi-tui/theme";
export type { SymbolPreset };

export type GlyphRole =
	| "barFill" | "barEmpty" | "sparkRamp" | "heatCell" | "heatEmpty"
	| "heatMarker" | "columnGap" | "trendUp" | "trendFlat" | "trendDown";
export type GlyphValue = string | readonly string[];
export type GlyphSet = Readonly<Record<GlyphRole, GlyphValue>>;

export const HEAT_LEVELS = 4;
```

`UNICODE_GLYPHS`, exactly:

```ts
const UNICODE_GLYPHS = {
	barFill: "█",                                    // U+2588
	barEmpty: "░",                                   // U+2591
	sparkRamp: ["▁","▂","▃","▄","▅","▆","▇","█"],  // U+2581..U+2588
	// heatCell is a RAMP, deliberately. ADR 0005's starting value is the single ■,
	// but the shade ramp ["░","▒","▓","█"] (ratatui symbols::shade / btop tty_up)
	// is equally valid and is one line away. The decision is deferred to a visual
	// comparison, so the module must not encode the winner.
	heatCell: "■",                                   // U+25A0 — one swatch; colour carries the level
	heatEmpty: "·",                                  // U+00B7 — byte-identical to /usage
	heatMarker: "□",                                 // U+25A1
	columnGap: "│",                                  // U+2502 — matches boxRound.vertical in both presets
	trendUp: "▲",                                    // U+25B2
	trendFlat: "─",                                  // U+2500
	trendDown: "▼",                                  // U+25BC
} as const satisfies GlyphSet;
```

`ASCII_GLYPHS`, exactly — a *ranking* ladder, not a density ladder, and each rung must be distinct from the one below at one cell:

```ts
const ASCII_GLYPHS = {
	barFill: "#",                                    // U+0023 — omp's own ascii choice for sep.block
	barEmpty: ".",
	sparkRamp: [".",":","-","=","+","*","#","@"],     // 8 distinct rungs, all 1 cell
	heatCell: [".","-","+","#"],                      // level 1 is ".", not ":": leaves the zero cell distinct
	heatEmpty: " ",
	heatMarker: "o",
	columnGap: "|",
	trendUp: "^",
	trendFlat: "-",
	trendDown: "v",
} as const satisfies GlyphSet;
```

`glyphsFor` is a plain record lookup, no branching:

```ts
const SETS: Record<SymbolPreset, GlyphSet> = { unicode: UNICODE_GLYPHS, nerd: UNICODE_GLYPHS, ascii: ASCII_GLYPHS };
export function glyphsFor(preset: SymbolPreset): GlyphSet { return SETS[preset]; }
```

`glyph` clamps:

```ts
export function glyph(preset: SymbolPreset, role: GlyphRole, level = 0): string {
	const value = glyphsFor(preset)[role];
	if (typeof value === "string") return value;
	const clamped = Math.max(0, Math.min(value.length - 1, Math.round(level)));
	return value[clamped] ?? value[0];
}
```


Note the ADR-0005 constraint that makes this module necessary rather than optional: `theme.symbol()` is a plain map read of 269 registered keys, and **none** of them is a data-ink ramp. There is no way to express "the fourth of eight block fills" through the registry without patching a package we do not own.

> **The heatmap swap, spelled out.** To move from colour-carried intensity to a glyph-carried ramp, the executor changes exactly one value: `heatCell: "■"` → `heatCell: ["░","▒","▓","█"]` in `UNICODE_GLYPHS`. Because `nerd` shares the *same object* as `unicode`, that single edit covers both presets; `ASCII_GLYPHS` already carries its own 4-rung ladder and is untouched. Task 9's `heatmap.ts` reads levels through `glyph(preset, "heatCell", level)`, so it needs no change either, and the 108-cell row width holds because all five candidate glyphs measure 1. **Do not hardcode this choice in `heatmap.ts`.**

- [ ] **Step 3b: Implement `src/tui/icons.ts`**

The second preset table. It is *not* width-constrained the way `glyphs.ts` is: under `unicode` these are emoji at 2 cells, which is exactly why they are legal here and illegal in a ramp.

```ts
import type { SymbolPreset } from "@oh-my-pi/pi-tui/theme";

export type IconRole =
	| "cost" | "tokens" | "requests" | "time" | "models" | "providers"
	| "tools" | "projects" | "errors" | "calendar" | "gains"
	| "trendUp" | "trendDown" | "unknown" | "cache" | "warning";

/** 12 of 16 roles already exist in omp's SYMBOL_PRESETS — reuse, do not reinvent. */
export const HOST_ICON_KEYS = {
	cost: "icon.cost", tokens: "icon.tokens", requests: "cmd.stats",
	time: "icon.time", models: "icon.model", providers: "icon.host",
	tools: "icon.extensionTool", projects: "icon.folder", errors: "status.error",
	unknown: "cmd.question", cache: "icon.cache", warning: "icon.warning",
} as const satisfies Partial<Record<IconRole, string>>;

/** The only four roles this project adds. */
export const NEW_ICON_ROLES = ["calendar", "gains", "trendUp", "trendDown"] as const satisfies readonly IconRole[];

export const STATS_ICONS: Record<SymbolPreset, Record<IconRole, string>> = {
	unicode: {
		cost: "💲", tokens: "🪙", requests: "📊", time: "⏱", models: "⬢",
		providers: "🛰", tools: "🛠", projects: "📁", errors: "❌",
		calendar: "📅", gains: "💹",
		trendUp: "↗", trendDown: "↘", unknown: "❓", cache: "💾", warning: "⚠",
	},
	nerd: {
		cost: "\uF155", tokens: "\uE26B", requests: "\uF080", time: "\uF017",
		models: "\uEC19", providers: "\u{F048B}", tools: "\uF0AD", projects: "\uF07C",
		errors: "\uF057", calendar: "\uF073", gains: "\uF0E5",
		trendUp: "\uF062", trendDown: "\uF063", unknown: "\uF059", cache: "\uF1C0",
		warning: "\uF071",                       // nf-fa-warning — NEVER the VS16 form
	},
	ascii: {
		cost: "$", tokens: "tok:", requests: "req:", time: "t:", models: "[M]",
		providers: "host", tools: "TL", projects: "[D]", errors: "[!!]",
		calendar: "cal", gains: "+", trendUp: "+", trendDown: "-", unknown: "?", cache: "cache", warning: "[!]",
	},
};

/** Heading gutter. Emoji are 2 cells; Nerd PUA is 1; ASCII labels vary. */
export const ICON_GUTTER: Record<SymbolPreset, number> = { unicode: 2, nerd: 1, ascii: 5 };
```

`statsIcon` prefers the host registry so a future upstream change propagates:

```ts
export function statsIcon(preset: SymbolPreset, role: IconRole, theme?: Theme): string {
	const key = HOST_ICON_KEYS[role as keyof typeof HOST_ICON_KEYS];
	if (key && theme) return theme.symbol(key as SymbolKey);
	return STATS_ICONS[preset][role];
}
```

The `theme` parameter is optional and passed only by the panel (which holds the live singleton). `bun test` calls the form without it and reads the table, which keeps the module pure and load-order-safe — the same discipline `glyphs.ts` follows for its preset parameter.

All nerd codepoints above were verified against the Nerd Fonts cheat sheet and wiki, and all measured `Bun.stringWidth === 1`. Note `nf-md-server` is `U+F048B`, not the widely-copied `U+F233`; Nerd Fonts 3.x moved Material Design Icons into the five-digit `U+F0001`+ range.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test test/glyphs.test.ts`
Expected: `19 pass` (the original 9 plus the ramp-shape, shade-swap, two measurement-trap, and four icon cases).

- [ ] **Step 5: Repoint `scripts/probe-glyphs.ts` at the real module — ramps AND icons AND a heatmap comparison**

Replace its hardcoded role list with an import of `glyphsFor`, iterating `Object.entries` over the returned `GlyphSet`, so it can never drift from the module. Then extend it:

1. **Ramp table** — every role × preset, with `codePointAt(0).toString(16)` and `Bun.stringWidth`, so the measurements behind this task are reproducible by the next person rather than trusted.
2. **Icon table** — every role × preset, same two columns, from `STATS_ICONS`. Flag any icon wider than 1 cell under `unicode` as `2-cell (gutter)` rather than an error.
3. **`--heatmap` mode** — render the same 7×53 heatmap row **side by side under each candidate ladder**: `■`+colour (ADR 0005) and `░▒▓█` (ratatui/btop). Print the `Bun.stringWidth` of each rendered row under both. **This is how the deferred heatmap decision gets made — by looking at it, not by arguing about it.**
4. **Trap report** — assert and print that `sep.pipe` measures 3 under `unicode` and 1 under `nerd`, and that `⚠` measures 1 while `⚠️` measures 2.

- [ ] **Step 6: Verify alignment by eye**

Run: `bun run scripts/probe-glyphs.ts` and `bun run scripts/probe-glyphs.ts --heatmap`
Expected: every ramp `width` is `1`; `unicode` and `nerd` ramp rows are byte-identical; the two heatmap ladders both render at 108 cells per row.

- [ ] **Step 7: Commit**

```bash
git add src/tui/glyphs.ts src/tui/icons.ts test/glyphs.test.ts scripts/probe-glyphs.ts
git commit -m "feat(tui): preset-aware glyph and icon tables, width-proved"
```

---

## Task 4: Number and time vocabulary

Reuse, not reimplementation. The stats package already ships the exact formatters this panel needs and they were built against this same data: `@oh-my-pi/omp-stats/client/data/formatters` exports 14 functions including `formatCost`, `formatEstimatedCost`, `formatCompact`, `formatInteger`, `formatPercent`, `formatElapsed`, `isUnpricedMessage`. Re-export those; write only the two rules the package has no opinion about.

**Files:**
- Create: `src/tui/format.ts`
- Create: `test/format.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  ```ts
  export interface TokenCells {
    fresh: string; cacheRead: string; cacheWrite: string; rate: string;
  }
  export function costWithUnpriced(cost: number, unpricedRequests: number, digits?: number): string;
  export function tokenCells(s: {
    totalInputTokens: number; totalOutputTokens: number;
    totalCacheReadTokens: number; totalCacheWriteTokens: number; cacheRate: number;
  }): TokenCells;
  // plus re-exports: formatCost, formatEstimatedCost, formatCompact, formatInteger,
  //                 formatPercent, formatElapsed, isUnpricedMessage
  ```
  `formatCost(0) === "$0"` and `formatEstimatedCost(0, 12) === "N/A"` — the difference is the whole unpriced-request rule, and it is Review Focus line 1.

- [ ] **Step 1: Write the failing tests**

```ts
import { test, expect } from "bun:test";
import { costWithUnpriced, tokenCells, formatCost, formatElapsed } from "../src/tui/format";
import type { AggregatedStats } from "@oh-my-pi/omp-stats/shared-types";

test("a zero cost with unpriced requests is N/A, never $0", () => {
	expect(formatCost(0)).toBe("$0");
	expect(costWithUnpriced(0, 12)).toBe("N/A · 12 unpriced");
	expect(costWithUnpriced(0, 0)).toBe("$0");
	expect(costWithUnpriced(2582.33, 0)).toBe("$2,582.33");
	expect(costWithUnpriced(611.4, 3)).toBe("$611.40 · 3 unpriced");
});

test("cost adapts below one cent, at exactly zero, and above a dollar", () => {
	expect(formatCost(0.0000646324)).toBe("$0.0001");
	expect(formatCost(0.023)).toBe("$0.02");
	expect(formatCost(1292.85)).toBe("$1,292.85");
});

test("tokens are split four ways and never summed into one figure", () => {
	const cells = tokenCells({
		totalInputTokens: 115284971, totalOutputTokens: 64071,
		totalCacheReadTokens: 23208537877, totalCacheWriteTokens: 0, cacheRate: 0.9513,
	});
	expect(cells.fresh).toBe("115M");
	expect(cells.cacheRead).toBe("23B");
	expect(cells.cacheWrite).toBe("0");
	expect(cells.rate).toBe("95.1% cache");
	expect(Object.values(cells)).not.toContain("24B");   // the bare total this panel must never print
});

test("a zero-token aggregate does not divide by zero", () => {
	const cells = tokenCells({
		totalInputTokens: 0, totalOutputTokens: 0,
		totalCacheReadTokens: 0, totalCacheWriteTokens: 0, cacheRate: 0,
	});
	expect(cells.rate).toBe("0.0% cache");
	expect(cells.fresh).toBe("0");
});

test("elapsed crosses into minutes and hours, formatDurationMs alone does not", () => {
	expect(formatElapsed(8)).toBe("0.01s");
	expect(formatElapsed(4515)).toBe("4.5s");
	expect(formatElapsed(303702)).toBe("5m 03s");
	expect(formatElapsed(1582747)).toBe("26m 22s");
	expect(formatElapsed(7200000)).toBe("2h 00m");
});

test("an aggregate type with the real field names satisfies the tokenCells input", () => {
	const agg: AggregatedStats = {
		totalRequests: 1, successfulRequests: 1, failedRequests: 0, errorRate: 0,
		totalInputTokens: 1, totalOutputTokens: 1, totalCacheReadTokens: 1,
		totalCacheWriteTokens: 0, cacheRate: 0.5, cacheSavings: 0,
		totalCost: 0, unpricedRequests: 0, totalPremiumRequests: 0,
		avgDuration: null, avgTtft: null, avgTokensPerSecond: null,
		firstTimestamp: 0, lastTimestamp: 1,
	};
	expect(tokenCells(agg).rate).toBe("50.0% cache");
});
```

The third test is Review Focus line 2. The `not.toContain("24B")` assertion is the one that makes it impossible to regress into a bare total.

- [ ] **Step 2: Run to verify it fails**

Run: `bun test test/format.test.ts`
Expected: FAIL — `Cannot find module '../src/tui/format'`.

- [ ] **Step 3: Implement `src/tui/format.ts`**

Re-export the package's formatters verbatim:

```ts
export {
	formatCompact, formatCost, formatDurationMs, formatElapsed, formatEstimatedCost,
	formatInteger, formatPercent, formatTokensPerSecond, isUnpricedMessage,
} from "@oh-my-pi/omp-stats/client/data/formatters";
```

Then the two rules of ours:

```ts
export function costWithUnpriced(cost: number, unpricedRequests: number, digits?: number): string {
	const base = formatEstimatedCost(cost, unpricedRequests, digits);
	return unpricedRequests > 0 && base !== "N/A" ? `${base} · ${formatInteger(unpricedRequests)} unpriced` : base;
}
```

The suffix appears whenever `unpricedRequests > 0` and the total is not already `N/A`; when the whole total is unpriced, `N/A` alone says it. And:

```ts
export function tokenCells(s: { … }): TokenCells {
	return {
		fresh: formatCompact(s.totalInputTokens),
		cacheRead: formatCompact(s.totalCacheReadTokens),
		cacheWrite: formatCompact(s.totalCacheWriteTokens),
		rate: `${formatPercent(s.cacheRate)} cache`,
	};
}
```

The split is into **four** cells because the cache rate's denominator is `totalInputTokens + totalCacheReadTokens` — cache *writes* are excluded — so a panel showing only the rate understates the write cost. `cacheSavings` is a dollar-savings *ratio*, not a token count, and goes in a footnote, never in the cells.

- [ ] **Step 4: Run to verify it passes**

Run: `bun test test/format.test.ts`
Expected: `6 pass`.

- [ ] **Step 5: Commit**

```bash
git add src/tui/format.ts test/format.test.ts
git commit -m "feat(tui): number vocabulary; unpriced and cache-split rules"
```

---

## Task 5: Data seam — the adapter

The data seam. `handleApi` is a plain `export async function handleApi(req: Request): Promise<Response>` at `omp-stats/src/server.ts:165`, and its body reads the request only through `new URL(req.url)`, `req.method`, two `req.headers.get(...)` calls and `url.searchParams`. There is no `req.json()`, no `req.text()`, no `req.body`, no `req.signal`. A constructed `Request` satisfies all of it, and the body contains zero references to the Bun server object — the only `server.*` call in the file lives in `createDashboardServer`'s SSE branch, outside `handleApi`. Importing the module starts nothing.

**Files:**
- Create: `src/data/ranges.ts`
- Create: `src/data/api.ts`
- Create: `test/ranges.test.ts`
- Create: `test/api.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks except the Task 1 install.
- Produces:
  ```ts
  // src/data/ranges.ts
  export const RANGES = ["1h","24h","7d","30d","90d","all"] as const;
  export type Range = (typeof RANGES)[number];
  export const DEFAULT_RANGE: Range = "24h";
  export function isRange(value: string): value is Range;
  export function nextRange(current: Range, direction: 1 | -1): Range;
  export function rangeLabel(range: Range): string;
  export function bucketCountFor(range: Range, width: number): number;

  // src/data/api.ts
  export interface RollupStatus { dirtyHours: number; dirtySessions: number }
  export type DataNeed = "overview" | "modelDashboard" | "costs" | "folders"
                      | "recent" | "errors" | "tools" | "dailyActivity" | "rollupStatus";
  export const DATA_NEEDS: readonly DataNeed[];
  export interface PanelData { …one optional field per DataNeed… }
  export async function apiGet<T>(path: string, params?: Record<string, string>): Promise<T>;
  export function fetchOverview(range: Range): Promise<OverviewPayload>;
  export function fetchModelDashboard(range: Range): Promise<ModelDashboardPayload>;
  export function fetchCosts(range: Range): Promise<CostPayload>;
  export function fetchFolders(range: Range): Promise<FolderStats[]>;
  export function fetchRecent(limit: number): Promise<MessageStats[]>;
  export function fetchErrors(range: Range, limit: number): Promise<MessageStats[]>;
  export function fetchTools(range: Range): Promise<ToolDashboardStats>;
  export function fetchDailyActivity(days?: number): Promise<DailyActivityPoint[]>;
  export function fetchRollupStatus(): Promise<RollupStatus>;
  export async function fetchFor(needs: readonly DataNeed[], range: Range): Promise<PanelData>;
  ```
  Task 11 consumes `fetchFor`; Tasks 13–15 consume `PanelData`. `fetchProviderDashboard` is deliberately **not** written — `/api/stats/provider-windows` does network I/O to a broker fetch and is on the forbidden list, so the `providers` scaffold in Task 10 declares no `needs` and says so.

- [ ] **Step 1: Write the failing range tests**

```ts
import { test, expect } from "bun:test";
import { RANGES, DEFAULT_RANGE, Range, isRange, nextRange, rangeLabel, bucketCountFor } from "../src/data/ranges";

test("the valid set is exactly six, and 365d is not one of them", () => {
	expect([...RANGES]).toEqual(["1h","24h","7d","30d","90d","all"]);
	expect(isRange("365d")).toBe(false);
	expect(isRange("24H")).toBe(false);
	expect(isRange("")).toBe(false);
	expect(isRange("7d")).toBe(true);
});

test("the default range is 24h", () => {
	expect(DEFAULT_RANGE).toBe("24h");
});

test("cycling wraps in both directions", () => {
	expect(nextRange("all", 1)).toBe("1h");
	expect(nextRange("1h", -1)).toBe("all");
	expect(nextRange("7d", 1)).toBe("30d");
	expect(nextRange("90d", 1)).toBe("all");
});

test("labels read as spans, not as raw keys", () => {
	expect(rangeLabel("1h")).toBe("1 hour");
	expect(rangeLabel("24h")).toBe("24 hours");
	expect(rangeLabel("7d")).toBe("7 days");
	expect(rangeLabel("all")).toBe("All time");
});

test("bucket counts are the ranges' natural bucket counts, clamped by width", () => {
	expect(bucketCountFor("1h", 200)).toBe(12);    // 5-minute buckets
	expect(bucketCountFor("24h", 200)).toBe(24);   // hourly
	expect(bucketCountFor("7d", 200)).toBe(7);     // daily
	expect(bucketCountFor("1h", 6)).toBe(6);       // never more buckets than columns
	expect(bucketCountFor("all", 200)).toBeGreaterThan(0);
});
```

The `365d` test is the one that stops a real bug: `365d` is not a valid key and silently resolves to the `24h` default via `getTimeRangeConfig`'s `TIME_RANGES[normalized] ?? TIME_RANGES[DEFAULT_TIME_RANGE]`. A picker offering "365 days" would show 24 hours of data with no error.

- [ ] **Step 2: Write the failing adapter tests**

`test/api.test.ts` runs against **fixtures**, not the live database, so it is deterministic and does not touch `~/.omp`. Freeze the shapes measured in the real loader:

```ts
import { test, expect } from "bun:test";
import { fetchFor, apiGet } from "../src/data/api";
import overview from "./fixtures/overview-24h.json";
import modelDashboard from "./fixtures/model-dashboard-24h.json";

test("overview carries overall, byAgentType and timeSeries", () => {
	expect(Object.keys(overview).sort()).toEqual(["byAgentType","overall","timeSeries"]);
	expect(overview.overall).toHaveProperty("unpricedRequests");
	expect(overview.overall).toHaveProperty("totalCacheReadTokens");
	expect(overview.overall).toHaveProperty("cacheRate");
	expect(overview.timeSeries[0]).toHaveProperty("timestamp");
	expect(overview.timeSeries[0]).toHaveProperty("requests");
	expect(overview.timeSeries[0]).toHaveProperty("cost");
});

test("model-dashboard carries byModel, modelSeries and modelPerformanceSeries", () => {
	expect(Object.keys(modelDashboard).sort())
		.toEqual(["byModel","modelPerformanceSeries","modelSeries"]);
});

test("fetchFor returns only what was asked for", async () => {
	// fetchFor is pure mapping over fixtures in this test via the injected reader
	const data = await fetchFor(["overview"], "24h", () => Promise.resolve(overview as never));
	expect(data.overview).toBeDefined();
	expect(data.modelDashboard).toBeUndefined();
	expect(data.rollupStatus).toBeUndefined();
});

test("fetchFor always returns rollupStatus when asked, and never guesses it", async () => {
	const data = await fetchFor(["rollupStatus"], "24h", () => Promise.resolve({ dirtyHours: 2, dirtySessions: 5 } as never));
	expect(data.rollupStatus).toEqual({ dirtyHours: 2, dirtySessions: 5 });
});

test("a non-200 response becomes a thrown error naming the path", async () => {
	await expect(apiGet("/api/nope", {}, () => Promise.resolve(new Response("nope", { status: 404 }))))
		.rejects.toThrow("/api/nope -> 404");
});
```

`fetchFor` and `apiGet` therefore take an optional third parameter — a reader — defaulting to the real `handleApi` call. That is the adapter's one seam: production injects nothing, tests inject a fixture reader. Do not remove the parameter; without it the data layer is untestable without a 321 MB database.

- [ ] **Step 3: Capture the fixtures**

Run: `bun run scripts/probe-data.ts --emit-fixtures`
Expected: writes `test/fixtures/overview-24h.json` and `test/fixtures/model-dashboard-24h.json`. Trim each to 3 array elements — the shapes are what is under test, not the volume.

If the script does not yet accept that flag, add it in this step rather than shell-piping JSON.

- [ ] **Step 4: Run both test files to verify they fail**

Run: `bun test test/ranges.test.ts test/api.test.ts`
Expected: FAIL — `Cannot find module '../src/data/ranges'` and `'../src/data/api'`.

- [ ] **Step 5: Implement `src/data/ranges.ts`**

```ts
export const RANGES = ["1h", "24h", "7d", "30d", "90d", "all"] as const;
export type Range = (typeof RANGES)[number];
export const DEFAULT_RANGE: Range = "24h";
export function isRange(value: string): value: Range {
	return (RANGES as readonly string[]).includes(value);
}
export function nextRange(current: Range, direction: 1 | -1): Range {
	const i = RANGES.indexOf(current);
	return RANGES[(i + direction + RANGES.length) % RANGES.length]!;
}
```

`rangeLabel` maps to `1 hour` / `24 hours` / `7 days` / `30 days` / `90 days` / `All time`. `bucketCountFor(range, width)` returns `12` for `1h` (5-minute buckets), `24` for `24h` (hourly), `7` for `7d`, `30` for `30d`, `90` for `90d`, `min(width, 53)` for `all` — then `Math.min(natural, width)`. This mirrors `TIME_RANGES` at `omp-stats/src/aggregator.ts:473-499`.

- [ ] **Step 6: Implement `src/data/api.ts`**

The core, verbatim in shape from `REPORT.md` §1:

```ts
import { handleApi } from "@oh-my-pi/omp-stats/server";
import type { Range } from "./ranges";

type Reader = (path: string, params: Record<string, string>) => Promise<unknown>;

const liveReader: Reader = async (path, params) => {
	const url = new URL("http://localhost" + path);
	for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
	const res = await handleApi(new Request(url));
	if (!res.ok) throw new Error(`${path} -> ${res.status}`);
	return await res.json();
};

export async function apiGet<T>(
	path: string,
	params: Record<string, string> = {},
	read: Reader = liveReader,
): Promise<T> {
	return (await read(path, params)) as T;
}
```

Then eight one-line `fetch*` functions over it, each naming its route and its return type — `fetchOverview` → `/api/stats/overview`, `fetchModelDashboard` → `/api/stats/model-dashboard`, `fetchCosts` → `/api/stats/costs`, `fetchFolders` → `/api/stats/folders`, `fetchRecent` → `/api/stats/recent?limit=`, `fetchErrors` → `/api/stats/errors`, `fetchTools` → `/api/stats/tools`.

Two of them do not go through `handleApi`, because no route exposes them:

```ts
export function fetchDailyActivity(days = 371) {
	return import("@oh-my-pi/omp-stats/db").then(m => m.getDailyActivity(days));
}
```
— no. **Static import only.** Use `import { getDailyActivity } from "@oh-my-pi/omp-stats/db";` at the top and wrap it. Dynamic `import()` of any `@oh-my-pi/*` fails in the extension loader even for packages that resolve fine statically.

```ts
export function fetchRollupStatus(): RollupStatus {
	return getRollupStatus();
}
```

`getRollupStatus()` is synchronous and reads `currentDb()`, which returns `null` until `initDb()` has run — and then it returns `{dirtyHours: 0, dirtySessions: 0}`, which is indistinguishable from "clean". **This is the trap that survives the reversal of ADR 0001:** it applies equally to the reused package. `fetchFor` therefore fetches `overview` (or any aggregator-backed need) *before* `rollupStatus`, and when `rollupStatus` is the only need, it throws `new Error("rollup status requires an initialised database")` rather than reporting a fabricated zero.

`fetchFor(needs, range, read = liveReader)` maps each `DataNeed` to its fetcher and returns a `PanelData` with one optional field per need. Every need is fetched with `Promise.all`, so a 24h first paint is one wall-clock round of rollup-backed queries.

- [ ] **Step 7: Run to verify it passes**

Run: `bun test test/ranges.test.ts test/api.test.ts`
Expected: `11 pass` (6 range + 5 adapter).

- [ ] **Step 8: Measure the real thing**

Run: `bun run scripts/probe-data.ts`
Expected: the per-range table. Confirm every range is under 20 ms warm and that `365d` reports the same cutoff as `24h`. If any range is over 100 ms, that range gets its own subprocess in Task 12 — do not proceed assuming it will be fine.

- [ ] **Step 9: Commit**

```bash
git add src/data/ranges.ts src/data/api.ts test/ranges.test.ts test/api.test.ts test/fixtures/
git commit -m "feat(data): range vocabulary and the handleApi adapter seam"
```

---

## Task 6: Layout — the narrow-terminal seam

One pure function decides every width threshold and every degradation, so the degradation rules are testable without a terminal and cannot drift between screens.

**Files:**
- Create: `src/tui/layout.ts`
- Create: `test/layout.test.ts`

**Interfaces:**
- Consumes: `SymbolPreset` and `GlyphRole` from `src/tui/glyphs.ts` (Task 3).
- Produces:
  ```ts
  export interface LayoutPlan {
    width: number; innerWidth: number; bodyRows: number;
    columns: 1 | 2; compact: boolean;
    labelWidth: number; valueWidth: number; barWidth: number; barHeight: number;
    heatWeeks: number; showFooterHints: boolean; sparkWidth: number;
  }
  export function planLayout(width: number, rows: number, preset: SymbolPreset): LayoutPlan;
  ```
  Task 11 calls it once per frame. Tasks 7–9 and 13–15 take `innerWidth`/`barWidth` from it.

- [ ] **Step 1: Write the failing tests**

```ts
import { test, expect } from "bun:test";
import { planLayout } from "../src/tui/layout";

test("a wide terminal gets two columns and a full-height bar chart", () => {
	const p = planLayout(200, 50, "unicode");
	expect(p.columns).toBe(2);
	expect(p.compact).toBe(false);
	expect(p.barHeight).toBeGreaterThanOrEqual(12);
	expect(p.heatWeeks).toBeGreaterThanOrEqual(26);
});

test("an 80-column terminal drops to one column", () => {
	const p = planLayout(80, 24, "unicode");
	expect(p.columns).toBe(1);
});

test("a 40-column terminal is still a valid plan with every width at least one", () => {
	const p = planLayout(40, 24, "unicode");
	for (const k of ["innerWidth","labelWidth","valueWidth","barWidth","sparkWidth"] as const) {
		expect(p[k], k).toBeGreaterThanOrEqual(1);
	}
	expect(p.bodyRows).toBeGreaterThanOrEqual(5);
});

test("a 20x10 terminal degrades rather than returning negatives", () => {
	const p = planLayout(20, 10, "unicode");
	for (const k of ["innerWidth","labelWidth","valueWidth","barWidth","sparkWidth"] as const) {
		expect(p[k], k).toBeGreaterThanOrEqual(1);
	}
	expect(p.barHeight).toBeGreaterThanOrEqual(1);
	expect(p.heatWeeks).toBeGreaterThanOrEqual(1);
});

test("body rows never exceed the terminal, and never go below the chrome", () => {
	for (const rows of [10, 24, 40, 100]) {
		expect(planLayout(120, rows, "unicode").bodyRows).toBeLessThanOrEqual(rows);
	}
});

test("the ascii preset does not change the layout's geometry, only its glyphs", () => {
	const u = planLayout(100, 30, "unicode");
	const a = planLayout(100, 30, "ascii");
	expect(a).toEqual({ ...u, showFooterHints: u.showFooterHints });
});

test("the heatmap week count is driven by inner width, clamped to 53", () => {
	expect(planLayout(200, 40, "unicode").heatWeeks).toBeLessThanOrEqual(53);
	expect(planLayout(60, 24, "unicode").heatWeeks)
		.toBeLessThan(planLayout(200, 40, "unicode").heatWeeks);
});

test("footer hints are suppressed when there is nothing to scroll", () => {
	expect(planLayout(200, 50, "unicode").showFooterHints).toBe(true);
});
```

The third and fourth tests are Review Focus line 4.

- [ ] **Step 2: Run to verify it fails**

Run: `bun test test/layout.test.ts`
Expected: FAIL — `Cannot find module '../src/tui/layout'`.

- [ ] **Step 3: Implement `planLayout`**

Fixed chrome, matching `usage-dashboard.ts:896-927`: top border, header row, body, divider, footer row, bottom border — six rows. `bodyRows = max(1, rows - 6)`.

Thresholds, all measured against real overlay geometry (`OverlayPanel` insets 4 columns — two borders plus one space each side — so `innerWidth = max(20, width - 4)`):

| Condition | Decision |
|---|---|
| `innerWidth >= 76` | `columns: 2`, `compact: false` |
| `innerWidth < 76` | `columns: 1`, `compact: true` |
| `innerWidth < 44` | `barHeight = 4`, tables drop to two columns |
| `innerWidth < 30` | `showFooterHints: false`, `sparkWidth = 8` |
| `heatWeeks = clamp(floor((innerWidth - labelWidth) / 2), 4, 53)` | mirrors `/usage`'s formula exactly |
| `labelWidth = 12` (unicode/ascii alike) | the widest label is `cache writes` |

The `ascii` preset changes glyphs, never geometry — every ASCII data-ink candidate is natively one cell and natively monospace, so both ladders produce an identical column grid. The last test pins that.

- [ ] **Step 4: Run to verify it passes**

Run: `bun test test/layout.test.ts`
Expected: `8 pass`.

- [ ] **Step 5: Verify by eye**

Run: `bun run scripts/probe-render.ts src/tui/layout.ts planLayout 40 24`
Expected: prints the plan for the narrow case; every field ≥ 1.

- [ ] **Step 6: Commit**

```bash
git add src/tui/layout.ts test/layout.test.ts
git commit -m "feat(tui): layout plan with narrow-terminal degradation"
```

---

## Task 7: Vertical daily bar chart

**The correction from web research lands here.** F8 and REPORT §9 recommended the eighth-block ramp for vertical daily bars. Every surveyed production TUI uses a **single repeated glyph** instead — plotext (`marker 'full'` → `█`, `width` 0.8 of the inter-bar gap), gnuplot `dumb` (`fillchar`, one repeated character), `termplot` (`make_col`, one repeated glyph) — because eighths describe a value's height *within one cell*, so stacked vertically they give every bar a staircase top edge and near-equal bars no shared top line. `barFill`/`barEmpty` already exist in the glyph module; this task just uses them.

**The second thing this task must build is genuinely new: `bucketToWidth`.** plotext stretches, `asciichart` overflows (`width = max(series lengths) + offset`), `spark` has no width logic, and `termplot` documents its own inaccuracy. No surveyed tool aggregates. So the chart must decide for itself, and cost must aggregate by **sum** (cost is additive; a mean would understate a busy week and overstate a quiet one).

**Files:**
- Create: `src/tui/charts/bars.ts`
- Create: `test/bars.test.ts`

**Interfaces:**
- Consumes: `GlyphSet`, `glyph`, `SymbolPreset` from `src/tui/glyphs.ts`; `formatCost`/`formatCompact` from `src/tui/format.ts`; `LayoutPlan` from `src/tui/layout.ts`.
- Produces:
  ```ts
  export interface BarsOptions {
    width: number; height: number; glyphs: GlyphSet;
    accent: (text: string) => string; dim: (text: string) => string;
  }
  export function bucketToWidth(values: readonly number[], width: number): readonly number[];
  export function renderDailyBars(values: readonly number[], opts: BarsOptions): readonly string[];
  ```
  Task 13 renders `values` from `overview.timeSeries[].cost` and Tasks 14 renders them from `costs.costSeries` summed by day. Neither passes a `theme` — colours arrive as two styled callbacks, which is what makes the function headless-testable.

- [ ] **Step 1: Write the failing tests**

```ts
import { test, expect } from "bun:test";
import { bucketToWidth, renderDailyBars } from "../src/tui/charts/bars";
import { glyphsFor } from "../src/tui/glyphs";

const identity = (t: string) => t;
const opts = (width: number, height = 8) => ({
	width, height, glyphs: glyphsFor("unicode"), accent: identity, dim: identity,
});

test("bucketToWidth sums into exactly width buckets when there are more values", () => {
	const values = [1, 2, 3, 4, 5, 6];
	expect(bucketToWidth(values, 3)).toEqual([3, 7, 6]);   // sums, not means, not maxima
	expect(bucketToWidth(values, 6)).toEqual(values);
	expect(bucketToWidth(values, 10)).toHaveLength(10);    // pads rather than overflowing
	expect(bucketToWidth([], 4)).toEqual([0, 0, 0, 0]);
});

test("bucketToWidth never loses a value: the sum is conserved", () => {
	const values = Array.from({ length: 97 }, (_, i) => i + 1);
	const out = bucketToWidth(values, 20);
	expect(out).toHaveLength(20);
	expect(out.reduce((a, b) => a + b, 0)).toBe(values.reduce((a, b) => a + b, 0));
});

test("an empty series renders an honest empty state, not a wall of zero bars", () => {
	expect(renderDailyBars([], opts(20))).toEqual(["No activity recorded in this range."]);
});

test("an all-zero series is distinguishable from a sparse one but is not an error", () => {
	const rows = renderDailyBars([0, 0, 0], opts(3, 4));
	expect(rows.length).toBeGreaterThan(0);
	expect(rows.join("")).toContain(glyphsFor("unicode").barEmpty as string);
});

test("every rendered row is exactly width cells", () => {
	for (const width of [8, 20, 53, 108, 200]) {
		const values = Array.from({ length: 40 }, (_, i) => (i * 37) % 91);
		for (const row of renderDailyBars(values, opts(width))) {
			expect(Bun.stringWidth(row), `width ${width}: ${row}`).toBe(width);
		}
	}
});

test("the chart is height rows tall, top to bottom", () => {
	expect(renderDailyBars([1, 2, 3], opts(3, 6)).length).toBe(6);
});

test("the tallest bar reaches the top row and the baseline is zero", () => {
	const values = [0, 5, 10];
	const rows = renderDailyBars(values, opts(3, 4));
	expect(rows[0]).toBe(glyphsFor("unicode").barFill.repeat(3));
});

test("no rendered row ends in a newline, and no row is empty", () => {
	for (const row of renderDailyBars([1, 2, 3], opts(10, 5))) {
		expect(row.includes("\n")).toBe(false);
		expect(row.length).toBeGreaterThan(0);
	}
});

test("the ascii ladder renders the same geometry as unicode", () => {
	const values = [3, 1, 4, 1, 5];
	const u = renderDailyBars(values, { ...opts(12, 4), glyphs: glyphsFor("unicode") });
	const a = renderDailyBars(values, { ...opts(12, 4), glyphs: glyphsFor("ascii") });
	expect(u.length).toBe(a.length);
	for (let i = 0; i < u.length; i++) expect(Bun.stringWidth(a[i]!)).toBe(12);
});
```

The empty-series test is Review Focus line 3. The width test across five widths is what catches a bar chart that overflows a wide terminal — the failure mode no surveyed tool guards against.

- [ ] **Step 2: Run to verify it fails**

Run: `bun test test/bars.test.ts`
Expected: FAIL — `Cannot find module '../src/tui/charts/bars'`.

- [ ] **Step 3: Implement `bucketToWidth`**

```ts
export function bucketToWidth(values: readonly number[], width: number): readonly number[] {
	if (width <= 0) return [];
	if (values.length <= width) {
		return [...values, ...new Array(width - values.length).fill(0)];
	}
	const out: number[] = [];
	for (let c = 0; c < width; c++) {
		const from = Math.floor((c * values.length) / width);
		const to = Math.floor(((c + 1) * values.length) / width);
		let sum = 0;
		for (let i = from; i < to; i++) sum += values[i] ?? 0;
		out.push(sum);
	}
	return out;
}
```

- [ ] **Step 4: Implement `renderDailyBars`**

`values` → `bucketToWidth(values, opts.width)` → per column, `rows = round(value / max * opts.height)` filled cells of `glyph("…", "barFill")` from the bottom, `barEmpty` above, `dim`-styled for the empty part and `accent`-styled for the fill. Emit exactly `opts.height` rows. When `max <= 0` return the all-`barEmpty` block. When `values.length === 0`, return the single empty-state line.

The bars are **adjacent, not 0.8-of-a-slot wide**. plotext's 0.8 fraction exists because its plot matrix is a scatter of coordinates with variable gaps; a dense calendar chart wants contiguous columns, and a fractional width would need per-column padding maths that `Bun.stringWidth` would then have to absorb. Contiguity is the right call here and is a deliberate departure.

- [ ] **Step 5: Run to verify it passes**

Run: `bun test test/bars.test.ts`
Expected: `9 pass`.

- [ ] **Step 6: Verify by eye**

Run: `bun run scripts/probe-render.ts src/tui/charts/bars.ts renderDailyBars 108 10`
Expected: ten rows, each reporting `width 108`, forming a recognisable cost profile.

- [ ] **Step 7: Commit**

```bash
git add src/tui/charts/bars.ts test/bars.test.ts
git commit -m "feat(charts): daily bar chart with sum-preserving downsampling"
```

---

## Task 8: Sparkline, ranked bar list, share bar

The three thin primitives — 38, 49 and 26 lines of React respectively, each a few lines of text here. Web research **confirms** the ramp: `spark`'s `ticks=(▁ ▂ ▃ ▄ ▅ ▆ ▇ █)`, visidata's `disp_sparkline` and `bottom`'s eighth-block gauges are three independent implementations converging on U+2581–U+2588. Three details worth copying from `spark` specifically: constant data collapses to two mid-height glyphs rather than dividing by zero; the baseline is the **minimum** of the data (correct for a sparkline, wrong for bars — keep the two scalings separate); and binning is integer arithmetic.

**Files:**
- Create: `src/tui/charts/sparkline.ts`
- Create: `test/sparkline.test.ts`

**Interfaces:**
- Consumes: `GlyphSet`/`glyph` from `src/tui/glyphs.ts`; `renderProgressBar` from `@oh-my-pi/pi-tui` (the **free function** — 4 first-party call sites; the `ProgressBar` class has 0); `formatCost`/`formatCompact` from `src/tui/format.ts`.
- Produces:
  ```ts
  export function renderSparkline(values: readonly number[], width: number, glyphs: GlyphSet): string;
  export interface BarListRow { label: string; value: number; display?: string; unpriced?: number }
  export function renderBarList(rows: readonly BarListRow[], width: number, opts: {
    glyphs: GlyphSet; max?: number; accent: (t: string) => string; dim: (t: string) => string;
  }): readonly string[];
  export function renderShareBar(segments: readonly { label: string; value: number }[], width: number, opts: {
    glyphs: GlyphSet; colorFor: (index: number) => (t: string) => string;
  }): readonly string[];
  ```
  Task 13 uses the share bar for the agent-type token mix and the bar list for top folders; Task 15 uses the bar list for per-model cost and the sparkline for the per-row trend. Every task that calls these passes `glyphs` from `planLayout`/`theme.getSymbolPreset()` — none reads the theme singleton.

- [ ] **Step 1: Write the failing tests**

```ts
import { test, expect } from "bun:test";
import { renderSparkline, renderBarList, renderShareBar } from "../src/tui/charts/sparkline";
import { glyphsFor } from "../src/tui/glyphs";

const identity = (t: string) => t;
const U = glyphsFor("unicode");

test("a sparkline is exactly width cells and uses only the eighth ramp", () => {
	const s = renderSparkline([1, 5, 3, 9, 2, 7], 6, U);
	expect(Bun.stringWidth(s)).toBe(6);
	const allowed = new Set(U.sparkRamp as readonly string[]);
	for (const ch of s) expect(allowed.has(ch), `unexpected glyph ${ch}`).toBe(true);
});

test("a sparkline is baseline-relative: the minimum sits at the bottom of the ramp", () => {
	const s = renderSparkline([10, 20, 30], 3, U);
	expect(s[0]).toBe((U.sparkRamp as readonly string[])[0]);
	expect(s[2]).toBe((U.sparkRamp as readonly string[])[7]);
});

test("constant data collapses to a mid ramp position instead of dividing by zero", () => {
	expect(Bun.stringWidth(renderSparkline([7, 7, 7, 7], 4, U))).toBe(4);
	expect(renderSparkline([7, 7, 7, 7], 4, U)).not.toContain("NaN");
});

test("an empty sparkline is blanks, not a crash", () => {
	expect(Bun.stringWidth(renderSparkline([], 8, U))).toBe(8);
});

test("a sparkline downsamples to width, summing like the bar chart", () => {
	expect(Bun.stringWidth(renderSparkline(Array.from({length: 200}, (_, i) => i), 30, U))).toBe(30);
});

test("the ascii sparkline is also exactly width cells", () => {
	expect(Bun.stringWidth(renderSparkline([3,1,4,1,5], 10, glyphsFor("ascii")))).toBe(10);
});

test("a bar list is one row per entry, each exactly width cells", () => {
	const rows = renderBarList(
		[{ label: "model-a", value: 935.72 }, { label: "model-b", value: 22.85 }],
		40, { glyphs: U, accent: identity, dim: identity },
	);
	expect(rows).toHaveLength(2);
	for (const r of rows) expect(Bun.stringWidth(r)).toBe(40);
});

test("a bar list surfaces unpriced rows instead of rendering them as free", () => {
	const rows = renderBarList(
		[{ label: "muse-spark-1.3-contributor-free", value: 0, unpriced: 55 }],
		48, { glyphs: U, accent: identity, dim: identity },
	);
	expect(rows[0]).toContain("N/A");
	expect(rows[0]).toContain("55 unpriced");
});

test("a bar list sorts descending by value and clamps the bar to the max", () => {
	const rows = renderBarList(
		[{ label: "small", value: 1 }, { label: "big", value: 100 }],
		40, { glyphs: U, accent: identity, dim: identity },
	);
	expect(rows[0]).toContain("big");
});

test("a share bar is exactly width cells and sums to the full width", () => {
	const bar = renderShareBar([{label:"main",value:75},{label:"subagent",value:25}], 40, {
		glyphs: U, colorFor: i => identity,
	});
	expect(Bun.stringWidth(bar)).toBe(40);
});

test("a share bar with a single segment and a zero total is still width cells", () => {
	expect(Bun.stringWidth(renderShareBar([{label:"main",value:1}], 24, { glyphs: U, colorFor: () => identity }))).toBe(24);
	expect(Bun.stringWidth(renderShareBar([{label:"main",value:0}], 24, { glyphs: U, colorFor: () => identity }))).toBe(24);
});

test("an empty bar list and an empty share bar are empty, not crashing", () => {
	expect(renderBarList([], 40, { glyphs: U, accent: identity, dim: identity })).toEqual([]);
	expect(renderShareBar([], 40, { glyphs: U, colorFor: () => identity })).toBe("");
});
```

The unpriced test is Review Focus line 1's second half: a `$0.00` model with 55 unpriced requests must read as `N/A · 55 unpriced`, never as a zero-length bar labelled free.

- [ ] **Step 2: Run to verify it fails**

Run: `bun test test/sparkline.test.ts`
Expected: FAIL — `Cannot find module '../src/tui/charts/sparkline'`.

- [ ] **Step 3: Implement `src/tui/charts/sparkline.ts`**

`renderSparkline`: bucket with the same sum rule as the bar chart (reuse `bucketToWidth` from `./bars` — import it, do not reimplement), then min/max-scale across the bucketed values into `sparkRamp`. When `min === max`, use ramp index 4 for every column rather than dividing by zero. When `width === 0`, return `""`. When `values` is empty, return `width` spaces.

`renderBarList`: one row per entry, label left-truncated to `labelWidth`, then `renderProgressBar(value, barWidth, { min: 0, max: max ?? rowMax, style: { filled: glyph("barFill"), empty: glyph("barEmpty"), styleFilled: accent, styleEmpty: dim } })`, then the display value right-aligned. When `row.unpriced && row.unpriced > 0`, the display value is `costWithUnpriced(row.value, row.unpriced)` — reusing Task 4's function so the rule has exactly one implementation. Sort descending by `value`, with unpriced rows sorting by their request count so they are not all buried at the bottom.

`renderShareBar`: one row, `width` cells, each segment `round(value/total * width)` cells of `barFill` in `colorFor(i)`, with the final segment absorbing the rounding remainder so the total is exactly `width`. When `total <= 0`, return `width` spaces in the dim colour.

- [ ] **Step 4: Run to verify it passes**

Run: `bun test test/sparkline.test.ts`
Expected: `12 pass`.

- [ ] **Step 5: Verify by eye**

Run: `bun run scripts/probe-render.ts src/tui/charts/sparkline.ts renderSparkline 40`
Expected: one line, `width 40`, a recognisable trend.

- [ ] **Step 6: Commit**

```bash
git add src/tui/charts/sparkline.ts test/sparkline.test.ts
git commit -m "feat(charts): sparkline, ranked bar list, share bar"
```

---

## Task 9: Calendar heatmap

The hardest primitive, and the one `/usage` already proves in production. Reuse the layout algorithm by import — `@oh-my-pi/pi-tui/overlays/usage-dashboard` exports `buildHeatmapLayout`, verified loadable from the real extension loader. Its input type `DailyActivityPoint` (`{ day: string; cost: number; requests: number }`) is already ours: it is defined in `@oh-my-pi/omp-stats/shared-types`, not in pi-tui.

Reimplement only the two things the package keeps private: the ANSI cell emission and the four-stop colour ramp. Both are small, and `/usage`'s versions are `#private` methods.

**Files:**
- Create: `src/tui/charts/heatmap.ts`
- Create: `test/heatmap.test.ts`

**Interfaces:**
- Consumes: `buildHeatmapLayout` from `@oh-my-pi/pi-tui/overlays/usage-dashboard`; `DailyActivityPoint` from `@oh-my-pi/omp-stats/shared-types`; `colorToAnsi` from `@oh-my-pi/pi-tui/theme/color`; `colorLuma`, `hexToRgb`, `rgbToHex` from `@oh-my-pi/pi-utils`; `glyphsFor`/`glyph` from `src/tui/glyphs.ts`.
- Produces:
  ```ts
  export interface HeatmapOptions {
    innerWidth: number; labelWidth: number; weeks: number; glyphs: GlyphSet;
    ramp: readonly string[]; today?: Date;
  }
  export function buildRamp(theme: Theme): readonly string[];   // 4 stops, "" for level 0
  export function renderHeatmap(points: readonly DailyActivityPoint[], opts: HeatmapOptions): readonly string[];
  export function heatmapSummary(layout: HeatmapLayout): string;
  ```
  Task 14 renders it. `buildRamp` is the only function in the whole chart layer that takes a `Theme`, because it is the only one that must know the accent hex and the colour mode; everything else takes styled callbacks.

- [ ] **Step 1: Write the failing tests**

```ts
import { test, expect } from "bun:test";
import { renderHeatmap } from "../src/tui/charts/heatmap";
import { glyphsFor, glyph } from "../src/tui/glyphs";
import type { DailyActivityPoint } from "@oh-my-pi/omp-stats/shared-types";

const U = glyphsFor("unicode");
// Stand-in for buildRamp's four truecolor stops. Written as \x1b so the
// assertion reads as the bytes the renderer actually emits.
const RAMP = ["\x1b[38;2;60;60;70m", "\x1b[38;2;90;90;110m", "\x1b[38;2;140;140;170m", "\x1b[38;2;23;143;185m"];
const opts = (weeks: number, innerWidth = weeks * 2 + 2) => ({
	innerWidth, labelWidth: 2, weeks, glyphs: U, ramp: RAMP,
});


const point = (day: string, cost: number, requests = 1): DailyActivityPoint => ({ day, cost, requests });

test("a heatmap is a month-label row plus exactly seven day rows", () => {
	expect(renderHeatmap([], opts(53))).toHaveLength(8);
});

test("every row is the same width under both ladders", () => {
	for (const preset of ["unicode", "ascii"] as const) {
		const rows = renderHeatmap(
			[point("2026-10-01", 10), point("2026-10-02", 40), point("2026-09-30", 1)],
			{ ...opts(53), glyphs: glyphsFor(preset) },
		);
		expect([...new Set(rows.map(r => Bun.stringWidth(r)))], `${preset} heatmap widths`).toEqual([108]);
	}
});

test("a day with no activity is the empty cell, not a level-1 cell", () => {
	// row 0 is the month-label row; the seven weekday rows follow
	expect(renderHeatmap([], opts(10))[1]).toContain(glyph("unicode", "heatEmpty"));
});

test("the busiest day in range reaches the top level", () => {
	expect(renderHeatmap([point("2026-10-01", 1), point("2026-10-02", 100)], opts(10))[1]).toContain(RAMP[3]);
});

test("intensity is magnitude, not rank: a quarter-max day is level 2, not level 4", () => {
	// sqrt compression is what keeps mid-size days distinguishable from outliers
	expect(renderHeatmap([point("2026-10-01", 25), point("2026-10-02", 100)], opts(10))[1]).toContain(RAMP[1]);
});

test("with nothing priced, intensity falls back to request counts", () => {
	expect(renderHeatmap([point("2026-10-01", 0, 5), point("2026-10-02", 0, 500)], opts(10))[1]).toContain(RAMP[3]);
});

test("a zero-width grid and a zero inner width do not throw", () => {
	expect(() => renderHeatmap([], opts(0))).not.toThrow();
	expect(() => renderHeatmap([], { ...opts(53), innerWidth: 0 })).not.toThrow();
});

test("an inner width narrower than the grid truncates rather than wrapping", () => {
	for (const r of renderHeatmap([point("2026-10-01", 5)], { ...opts(53), innerWidth: 30 })) {
		expect(Bun.stringWidth(r)).toBeLessThanOrEqual(30);
	}
});

test("no row ends in a newline and no row is empty", () => {
	for (const r of renderHeatmap([point("2026-10-01", 5)], opts(20))) {
		expect(r.includes("\n")).toBe(false);
		expect(r.length).toBeGreaterThan(0);
	}
});
```

Two corrections to the first draft of this test, both caught in self-review. The week count is **not** a third positional parameter — it comes from `opts.weeks`, which `planLayout` derives from the inner width (Task 6). And a "future day renders as blanks" assertion cannot be written against an empty `points` array, because an empty array produces the same bytes either way; that distinction lives in `buildHeatmapLayout`'s `null` cell, which this function renders as two spaces. The truncation test above covers the degenerate geometry instead of a test that cannot fail.

The width test across both ladders is Review Focus line 5 at the chart level, and matches F10's measured 108-cell result — which this implementation must reproduce exactly.

- [ ] **Step 2: Run to verify it fails**

Run: `bun test test/heatmap.test.ts`
Expected: FAIL — `Cannot find module '../src/tui/charts/heatmap'`.

- [ ] **Step 3: Implement `buildRamp`**

Four stops at `t = [0.3, 0.5, 0.72, 1.0]`, interpolated from a near-background anchor to the theme accent, direction chosen by the luma of the theme's `text` colour so the ramp keeps its direction on light themes, emitted through `colorToAnsi(hex, theme.getColorMode())` so it degrades to 256-colour automatically. This is `/usage`'s `#heatRamp` (`usage-dashboard.ts:799-825`), reimplemented because that method is private.

**A ~15-line deliberate copy** from `pi-tui/src/overlays/usage-dashboard.ts:799-825`. The reason is that the deep path is real and reachable but the *method* is `#private`; there is no export to call, so copying the algorithm is the only option short of forking pi-tui.

- [ ] **Step 4: Implement `renderHeatmap`**

```ts
export function renderHeatmap(points, opts): readonly string[] {
	const layout = buildHeatmapLayout(points, opts.weeks, opts.today);
	// month-label row: pad to the target column so labels never overlap
	// 7 day rows: labelWidth + weeks × (glyph + 1 space), trimmed right
}
```

Three cell states, exactly as `/usage` renders them: `null` (a future day) → two spaces; `0` (no activity) → `dim(glyph("heatEmpty"))` plus a space; `1..4` → `ramp[cell-1] + glyph("heatCell", cell) + "\x1b[39m"` plus a space. The raw FG reset rather than a `theme.fg` per cell is deliberate — it avoids 371 theme lookups per frame, and it is the same reason `/usage` does it.

- [ ] **Step 5: Implement `heatmapSummary`**

`"Oct 2026 · $611.40 · 11,328 requests"` from `layout.totalCost` and `layout.totalRequests`, which `buildHeatmapLayout` sums over the in-range subset only, so the header number matches the grid.

- [ ] **Step 6: Run to verify it passes**

Run: `bun test test/heatmap.test.ts`
Expected: `10 pass`.

- [ ] **Step 7: Verify by eye against `/usage`**

Run: `bun run scripts/probe-render.ts src/tui/charts/heatmap.ts renderHeatmap 108`
Expected: eight rows, all `width 108`, with a month-label row on top and seven weekday rows below — visually the same grid as `/usage`'s, which is the "look native" requirement.

- [ ] **Step 8: Commit**

```bash
git add src/tui/charts/heatmap.ts test/heatmap.test.ts
git commit -m "feat(charts): calendar heatmap reusing buildHeatmapLayout"
```

---

## Task 10: Screen registry and twelve screens

Every dashboard screen exists as a registry entry with its **data contract in place**. Three are implemented (Tasks 13–15); seven are scaffolds; two are excluded.

**Files:**
- Create: `src/tui/screens/types.ts`
- Create: `src/tui/screens/placeholders.ts`
- Create: `src/tui/screens/{costs,projects,requests,errors,tools,providers,gain,traces,frustration}.ts`
- Create: `test/screens.test.ts`
- Modify: `src/index.ts` (nothing yet — the panel is Task 11)

**Interfaces:**
- Consumes: `DataNeed`, `Range`, `PanelData` from `src/data/api.ts` and `src/data/ranges.ts`; `Theme` type from `@oh-my-pi/pi-tui/theme`; `LayoutPlan` from `src/tui/layout.ts`.
- Produces:
  ```ts
  export type ScreenId = "overview" | "activity" | "models" | "costs" | "projects"
                     | "requests" | "errors" | "tools" | "providers" | "gain"
                     | "traces" | "frustration";
  export type ScreenStatus = "implemented" | "scaffolded" | "excluded";
  export interface ScreenContext {
    width: number; rows: number; range: Range; theme: Theme;
    preset: SymbolPreset; glyphs: GlyphSet; plan: LayoutPlan; data: PanelData;
    colorFor: (index: number) => (text: string) => string;
  }
  export interface Screen {
    id: ScreenId; label: string; short: string; status: ScreenStatus;
    needs: readonly DataNeed[];
    render(ctx: ScreenContext): readonly string[];
  }
  export const SCREENS: readonly Screen[];
  export function screenById(id: ScreenId): Screen;
  export const IMPLEMENTED_IDS: readonly ScreenId[];
  ```
  Task 11 builds the tab strip from `SCREENS`. Tasks 13–15 replace three scaffold entries with real ones.

- [ ] **Step 1: Write the failing registry test**

```ts
import { test, expect } from "bun:test";
import { SCREENS, IMPLEMENTED_IDS, screenById, type ScreenContext, type ScreenId } from "../src/tui/screens/types";
import { RANGES, DEFAULT_RANGE } from "../src/data/ranges";
import { DATA_NEEDS, type PanelData } from "../src/data/api";
import { planLayout } from "../src/tui/layout";
import { glyphsFor } from "../src/tui/glyphs";
import { ensureThemeSync, theme } from "@oh-my-pi/pi-tui/theme";

// One ScreenContext for the whole file. Screens must be renderable headless,
// which is the whole reason the interface carries a Theme instead of reading
// the theme singleton.
ensureThemeSync();
function ctxWith(data: Partial<PanelData>, width = 120, override?: PanelData): ScreenContext {
	return {
		width, rows: 40, range: DEFAULT_RANGE, theme,
		preset: "unicode", glyphs: glyphsFor("unicode"),
		plan: planLayout(width, 40, "unicode"),
		data: override ?? (data as PanelData),
		colorFor: () => (t: string) => t,
	};
}

test("every dashboard screen is registered exactly once", () => {
	const ids = SCREENS.map(s => s.id);
	expect(new Set(ids).size).toBe(ids.length);
	for (const id of ["overview","models","costs","projects","requests","errors","tools","providers","gain","traces","frustration"] as ScreenId[]) {
		expect(ids, id).toContain(id);
	}
});

test("traces and frustration are excluded, not ported — ADR 0004", () => {
	for (const id of ["traces", "frustration"] as const) {
		expect(screenById(id).status, id).toBe("excluded");
		expect(screenById(id).needs, id).toEqual([]);
		expect(screenById(id).reason!.length, id).toBeGreaterThan(20);
	}
});

test("a scaffolded screen declares its real data contract and renders labelled PLACEHOLDER rows", () => {
	const costs = screenById("costs");
	expect(costs.status).toBe("scaffolded");
	expect(costs.needs).toEqual(["costs"]);
	const rows = costs.render(ctxWith({}));
	// Not one "not built yet" line: a reviewable layout with obviously fake values.
	expect(rows.length).toBeGreaterThan(3);
	expect(rows[0]).toContain(PLACEHOLDER_MARKER);          // snapshot-style: marker present
	expect(rows.some(r => r.includes("placeholder"))).toBe(true);
});

test("PLACEHOLDER: every scaffolded screen's first row carries the marker", () => {
	for (const s of SCREENS.filter(x => x.status === "scaffolded")) {
		const rows = s.render(ctxWith({}));
		expect(rows.length, s.id).toBeGreaterThan(1);
		expect(rows[0], `${s.id} must be visibly marked as placeholder data`).toContain(PLACEHOLDER_MARKER);
	}
});

test("PLACEHOLDER: a scaffolded screen NEVER fetches — selecting it issues no adapter call", () => {
	// The hard rule. A scaffold renders its fixture and returns; ctx.data is never read
	// and no fetchFor call is issued. Proven by handing it a ctx whose data access throws.
	for (const s of SCREENS.filter(x => x.status === "scaffolded")) {
		const trap = new Proxy({} as PanelData, {
			get(_t, prop) { throw new Error(`scaffold ${s.id} must not read ctx.data.${String(prop)}`); },
		});
		expect(() => s.render(ctxWith({}, 120, trap))).not.toThrow();
	}
});

test("PLACEHOLDER: the sample rows are recognisably fake, not plausible-looking data", () => {
	// A placeholder that reads like real numbers is worse than no placeholder: the user
	// reads a real number off the screen and believes it. Every fixture value must be
	// obviously synthetic.
	for (const s of SCREENS.filter(x => x.status === "scaffolded")) {
		const rows = s.render(ctxWith({})).join("\n");
		expect(rows, s.id).toMatch(/placeholder|example|sample/i);
	}
});

test("providers declares no needs: provider-windows does network I/O and is forbidden", () => {
	expect(screenById("providers").needs).toEqual([]);
	expect(screenById("providers").reason).toMatch(/network/i);
});

test("no screen declares a need that is not a real DataNeed", () => {
	for (const s of SCREENS) {
		for (const n of s.needs) expect(DATA_NEEDS, `${s.id}/${n}`).toContain(n);
	}
});

test("every scaffolded screen's needs are covered by the range list, so no screen can ask for an invalid window", () => {
	expect(RANGES).toContain(DEFAULT_RANGE);
	expect(RANGES).not.toContain("365d");
});

test("short labels fit a narrow tab strip", () => {
	for (const s of SCREENS) expect(Bun.stringWidth(s.short), s.id).toBeLessThanOrEqual(8);
});

test("IMPLEMENTED_IDS is exactly the three screens tasks 13-15 build", () => {
	expect([...IMPLEMENTED_IDS]).toEqual(["overview", "activity", "models"]);
});
```

Self-review caught two defects in the first draft: it imported `RANGES` from `src/data/api` (it lives in `src/data/ranges`), and it asserted against an undefined `DataNeeds` symbol. Both are fixed above, and the data layer now also exports a `DATA_NEEDS` runtime constant so the check is a real membership test rather than a type-level claim `bun test` cannot make.

- [ ] **Step 2: Run to verify it fails**

Run: `bun test test/screens.test.ts`
Expected: FAIL — `Cannot find module '../src/tui/screens/types'`.

- [ ] **Step 3: Add `reason?: string` to the `Screen` interface**

An excluded or a scaffolded screen states why, in the user's words, on the tab itself. A tab with no stated reason is indistinguishable from a bug.

- [ ] **Step 4: Write the nine scaffold modules, each rendering labelled PLACEHOLDER DATA**

This is the boundary the plan commits to, and it is deliberately boring so that promoting one is a single self-contained task. **The settled decision is placeholder data, not a "not built yet" line**: a scaffolded screen shows a small, realistic, obviously-fake sample so the layout can be reviewed and tested today. It **NEVER fetches**.

`src/tui/screens/placeholders.ts` owns the shared marker and the shared renderer, so the rule lives in one place:

```ts
// src/tui/screens/placeholders.ts
import type { ScreenContext } from "./types";

/** The literal marker a human sees on a scaffolded screen. Pinned by test/screens.test.ts. */
export const PLACEHOLDER_MARKER = "placeholder data — not real usage";

/**
 * Render a scaffolded screen's sample rows behind the marker.
 * Deliberately never touches ctx.data: selecting a scaffold must issue no fetch.
 */
export function scaffold(ctx: ScreenContext, icon: string, label: string, rows: readonly string[]): readonly string[] {
	const head = `${icon} ${label}  ${ctx.theme.fg("dim", PLACEHOLDER_MARKER)}`;
	return [head, ctx.theme.fg("dim", "─".repeat(Math.min(ctx.width, 60))), ...rows];
}
```

Each scaffold module then supplies only its own sample rows:

```ts
// src/tui/screens/costs.ts
import type { Screen } from "./types";
import { scaffold } from "./placeholders";
import { statsIcon } from "../icons";
import { glyph } from "../glyphs";

/** Sample values are deliberately round and obviously synthetic. */
const SAMPLE = [
	{ model: "example/model-a", cost: 111.11, requests: 1111, bar: 0.82 },
	{ model: "example/model-b", cost: 22.22, requests: 222, bar: 0.41 },
	{ model: "example/model-c", cost: 3.33, requests: 33, bar: 0.14 },
	{ model: "example/model-d", cost: 0, requests: 7, bar: 0 },       // unpriced, still visible
];

export const costsScreen: Screen = {
	id: "costs", label: "Costs", short: "Costs", status: "scaffolded", needs: ["costs"],
	render: ctx => scaffold(ctx, statsIcon(ctx.preset, "cost"), "Costs", [
		...SAMPLE.map(r =>
			`  ${r.model.padEnd(22)} ${glyph(ctx.preset, "barFill").repeat(Math.round(r.bar * 20)).padEnd(20, glyph(ctx.preset, "barEmpty"))} $${r.cost.toFixed(2)}`),
		`  ${ctx.theme.fg("dim", `${SAMPLE.length} of an unknown number of rows`)}`,
	]),
};
```

Two rules make the placeholder honest rather than misleading:

- **The values are obviously fake** — `example/model-a`, round numbers, `1111`/`222`/`33`/`7` request counts. A reader must not be able to mistake one for a real figure.
- **No fetch, ever.** `scaffold()` takes no data and the `render` above reads only `ctx.preset`, `ctx.width` and `ctx.theme`. `test/screens.test.ts` proves it with a `Proxy` that throws on any `ctx.data` read. A fetch whose results the user cannot see reads as a hang, which is worse than an honest stub.

The `needs` arrays, exactly:

| Screen | `needs` |
|---|---|
| `overview` | `["overview", "recent", "rollupStatus"]` |
| `activity` | `["dailyActivity", "costs", "rollupStatus"]` |
| `models` | `["modelDashboard", "rollupStatus"]` |
| `costs` | `["costs"]` |
| `projects` | `["folders"]` |
| `requests` | `["recent"]` |
| `errors` | `["errors"]` |
| `tools` | `["tools"]` |
| `providers` | `[]` — reason: "provider windows do network I/O on every load; excluded deliberately" |
| `gain` | `["costs"]` — the gain payload reads `snapcompact-savings.jsonl` off disk and is deferred |
| `traces` | `[]` — reason: "a cursor-anchored flamegraph has no terminal equivalent (ADR 0004)" |
| `frustration` | `[]` — reason: "classification is a paid judge job with no terminal equivalent (ADR 0004)" |

- [ ] **Step 5: Write `src/tui/screens/types.ts`**

The `Screen` interface as above, `SCREENS` as the frozen ordered array of all twelve, `screenById` as a lookup that throws on an unknown id, and:

```ts
export const IMPLEMENTED_IDS = ["overview", "activity", "models"] as const satisfies readonly ScreenId[];
```

All twelve entries start as `scaffolded` except `traces` and `frustration`, which start as `excluded`. Tasks 13–15 flip three entries to `implemented` and replace their `render`.

- [ ] **Step 6: Run to verify it passes**

Run: `bun test test/screens.test.ts`
Expected: `8 pass`.

- [ ] **Step 7: Commit**

```bash
git add src/tui/screens/ test/screens.test.ts
git commit -m "feat(tui): screen registry with all twelve dashboard screens and their data contracts"
```

---

## Task 11: The panel

The mount seam. This is where the reuse is heaviest and where the new code is smallest.

**Files:**
- Create: `src/tui/panel.ts`
- Modify: `src/index.ts` (replace the empty handler)

**Interfaces:**
- Consumes: `SCREENS`, `Screen`, `ScreenContext`, `ScreenId` from `src/tui/screens/types.ts`; `planLayout`, `LayoutPlan` from `src/tui/layout.ts`; `fetchFor`, `PanelData`, `DataNeed` from `src/data/api.ts`; `RANGES`, `Range`, `DEFAULT_RANGE`, `nextRange`, `rangeLabel` from `src/data/ranges.ts`; `Theme`/`ensureThemeSync` from `@oh-my-pi/pi-tui/theme`; `OverlayPanel`, `PanelRows`, `PanelDivider` from `@oh-my-pi/pi-tui/chrome`; `matchesKey`, `matchesSelect*`, `routeSgrMouseInput` from `@oh-my-pi/pi-tui`.
- Produces: `export const STATS_OVERLAY_OPTIONS` and `export class StatsPanel implements Component`. `src/index.ts` calls `ctx.ui.custom<undefined>((tui, theme, _keybindings, done) => new StatsPanel({...}), { overlay: true, overlayOptions: STATS_OVERLAY_OPTIONS })`.

**Deliberate copies, each named:**

| What | Copied from | Why not imported |
|---|---|---|
| `STATS_OVERLAY_OPTIONS` | `pi-coding-agent/src/extensibility/custom-commands/bundled/annotate/fullscreen.ts:13-20` | 8 lines of constants; importing a private extension's constant couples us to its file layout. `fullscreen: true` is **not optional** — it borrows the alternate screen buffer, which is the same `?1049h` mechanism `btop` and `bottom` use to make the last-row/last-column problem disappear entirely. |
| the load idiom | `pi-tui/src/overlays/usage-dashboard.ts:559-591` | The constructor's fire-and-forget `#loadActivity` + push callback + `AbortController` + `#changed()` repaint is ~30 lines and is the pattern, not an API. |
| the key cascade | `pi-tui/src/overlays/usage-dashboard.ts:1367-1405` | ~40 lines. The *order* is load-bearing and undocumented: `routeSgrMouseInput` for the wheel, then `matchesSelectCancel` for Esc so a remapped cancel still works, then raw `matchesKey` for literal letters, then `matchesSelect*` for arrows and paging, then `home`/`end`. |
| the `render` frame | `pi-tui/src/overlays/usage-dashboard.ts:896-927` | Height comes from `tui.terminal.rows` on every frame because there is no resize hook; scroll is clamped inside `render`, never in the key handler, which makes shrink-on-resize automatic. |

- [ ] **Step 1: Write the failing behavioural test**

The panel is not unit-testable in the strict sense — it needs a terminal — but three of its invariants are pure and *are* testable, because `render(width)` is just a function of state:

```ts
// added to test/screens.test.ts
import { __testing } from "../src/tui/panel";
const { makePanel } = __testing;

test("the scroll offset is clamped inside render, so shrinking shrinks the view", () => {
	const panel = makePanel({ rows: 40, scroll: 999, screenLines: 400 });
	panel.render(120);
	expect(__testing.debugScroll(panel)).toBeLessThanOrEqual(__testing.debugMaxScroll(panel));
});

test("the panel never returns more rows than the terminal has", () => {
	for (const rows of [10, 24, 50]) {
		const panel = makePanel({ rows, screenLines: 400 });
		expect(panel.render(120).length).toBeLessThanOrEqual(rows);
	}
});

test("dispose is idempotent and aborts the in-flight load", () => {
	const panel = makePanel({});
	panel.dispose();
	panel.dispose();
	expect(__testing.debugClosed(panel)).toBe(true);
});

```

`panel.ts` exports one test seam, `export const __testing = { makePanel, debugScroll, debugMaxScroll, debugClosed }`. `makePanel(state)` constructs a `StatsPanel` with a stub `tui` (`{ terminal: { rows: state.rows ?? 40 } }`), a real theme, and a synthetic screen of `screenLines` lines — so `render(width)` keeps its production signature and is a pure function of state. The three `debug*` readers take a panel and return one number each. That is the interface being tested, not the implementation: these are the invariants a real terminal would otherwise be needed to check.

- [ ] **Step 2: Run to verify it fails**

Run: `bun test test/screens.test.ts -t "scroll offset"`
Expected: FAIL — `makePanel` is not exported.

- [ ] **Step 3: Implement `panel.ts`**

State: `#panel`, `#header`, `#body`, `#footer` from `@oh-my-pi/pi-tui/chrome`; `#range: Range = DEFAULT_RANGE`; `#screenId`; `#scroll`; `#data: PanelData | null`; `#error: string | null`; `#closed`; `#closeController = new AbortController()`.

The constructor composes header/body/divider/footer, sets the footer height to 1 and the header height to 1, and calls `void this.#load()` — **fire-and-forget, never awaited**, because the 866.9 ms `initDb()` must sit behind the loading state.

`#load()` calls `fetchFor(needs, this.#range, …)` where `needs` is the union of the active screen's `needs`, pushes into a repaint, and on error sets `#error`. `#changed()` bumps a revision and calls the injected `requestRender()`.

`render(width)`:

```ts
const height = Math.max(14, this.#tui.terminal.rows || 40);
const plan = planLayout(width, height, this.#theme.getSymbolPreset());
const context = this.#screenContext(plan);
const source = this.#data ? screenById(this.#screenId).render(context)
                         : [this.#theme.fg("dim", "Loading usage…")];
this.#scroll = Math.max(0, Math.min(this.#scroll, source.length - plan.bodyRows));
this.#panel.title = `Stats · ${rangeLabel(this.#range)}`;
this.#header.setLines([this.#headerLine()]);
this.#body.setLines(source.slice(this.#scroll, this.#scroll + plan.bodyRows));
this.#body.setHeight(plan.bodyRows);
this.#footer.setLines([this.#footerHint(plan)]);
return this.#panel.render(width);
```

`this.#theme.getSymbolPreset()` is the **only** `getSymbolPreset()` read in the entire feature. `glyphsFor(preset)` threads the set down; no render function branches on preset.

The header carries the range and the dirty-hour count — ADR 0003's requirement that the panel never let a user mistake stale for zero: when `data.rollupStatus?.dirtyHours` exceeds 0, the header reads `24h · 2 dirty hours`, in the warning colour above 96 (the `EXACT_DIRTY_LIMIT`, past which reads stop unioning dirty hours and return stale rows with holes).

The footer hint is composed conditionally, the way `/usage` composes it: the scroll hint only when there is something to scroll, the range hint only when `plan.showFooterHints`.

`handleInput(data)` in the cascade order above, plus `r` to cycle the range through `nextRange(this.#range, 1)` and `R` for the reverse, plus `tab`/`shift+tab` to cycle screens, skipping `excluded` ones. Each of `r`/`R`/`tab` triggers a fresh `fetchFor`.

`dispose()` sets `#closed`, aborts the controller, and disposes the panel — and must be **idempotent**, because the host also calls `component.dispose?.()` in its own cleanup after hiding the overlay. `done()` must be called exactly once.

- [ ] **Step 4: Replace the handler in `src/index.ts`**

```ts
handler: async (_args, ctx) => {
	if (ctx.mode !== "tui") {
		ctx.ui.notify("/stats-tui needs an interactive terminal", "warning");
		return;
	}
	await ctx.ui.custom<undefined>(
		(tui, theme, _keybindings, done) =>
			new StatsPanel({
				tui, theme,
				requestRender: () => tui.requestRender(),
				onClose: () => done(undefined),
			}),
		{ overlay: true, overlayOptions: STATS_OVERLAY_OPTIONS },
	);
}
```

Two guards that are easy to get wrong. `ctx.mode === "tui"`, not `ctx.hasUI`: `hasUI` is `true` in RPC mode while `custom()` is implemented as *unsupported UI* and returns `undefined as never`. And the `keybindings` argument is ignored entirely — it is `KeybindingsManager.inMemory()`, the static defaults with no user config, so resolving keys through it silently ignores the user's `keybindings.yml`. Use `matchesKey` and `matchesSelect*`, which read the module-global singleton.

- [ ] **Step 5: Run the full suite**

Run: `bun test`
Expected: all files pass.

- [ ] **Step 6: Verify it loads**

Run: `omp models -e src/index.ts 2>&1 | grep -i "stats-tui\|Failed to load"`
Expected: no `Failed to load`. Do **not** check the exit code — it is 0 either way.

- [ ] **Step 7: Commit**

```bash
git add src/tui/panel.ts src/index.ts test/screens.test.ts
git commit -m "feat(tui): fullscreen overlay panel with range cycling and screen tabs"
```

---

## Task 12: Background ingest subprocess

`bun:sqlite` is synchronous, so the 7141 ms of `syncAllSessions` — measured at 3401 files and 151,107 rows on a warm page cache — holds the event loop for its entire duration if it runs inline. The first-party `/usage` view already solves exactly this and its author says why, in `pi-coding-agent/src/stats/activity-protocol.ts:1-11`: the synchronous SQLite work "froze the TUI for the whole load when it ran inline". Mirror `activity-worker.ts` (which owns the DB handle in a one-shot child the parent `SIGKILL`s once `done` arrives) and `activity-client.ts` (which spawns, streams, and tears down).

Because `bun install` placed `@oh-my-pi/omp-stats` and its `pi-natives-darwin-arm64` sibling in **this** package's `node_modules/`, the worker resolves its own bare imports with no `NODE_PATH` and no absolute paths. Measured: a script at the package root importing `@oh-my-pi/omp-stats/{aggregator,rollup,db,server}` loads from any `cwd`, because Bun keys bare resolution off the importing file's directory.

**Files:**
- Create: `src/sync/client.ts`
- Modify: `scripts/sync-worker.ts` (replace the placeholder)
- Create: `test/sync.test.ts`

**Interfaces:**
- Consumes: `DataNeed`, `PanelData`, `RollupStatus` from `src/data/api.ts`; `SyncProgress` from `@oh-my-pi/omp-stats/aggregator`; `RefreshOptions` from `@oh-my-pi/omp-stats/rollup`.
- Produces:
  ```ts
  export type SyncEvent =
    | { type: "progress"; phase: "scan" | "ingest" | "rollup"; current: number; total: number }
    | { type: "activity"; points: DailyActivityPoint[] }
    | { type: "done"; rollup: RollupStatus }
    | { type: "error"; error: string };
  export function parseSyncLine(line: string): SyncEvent | null;
  export interface IngestHandle { kill(): void }
  export function startIngest(onEvent: (event: SyncEvent) => void, signal?: AbortSignal): IngestHandle;
  export function describeSyncProgress(event: SyncEvent, width: number): string;
  ```
  Task 11 consumes `startIngest` and `describeSyncProgress`; Task 16 verifies both manually.

- [ ] **Step 1: Write the failing tests**

```ts
import { test, expect } from "bun:test";
import { parseSyncLine, describeSyncProgress } from "../src/sync/client";

test("malformed lines are null, not throws", () => {
	expect(parseSyncLine("")).toBeNull();
	expect(parseSyncLine("not json")).toBeNull();
	expect(parseSyncLine('{"type":"progress"}')).toBeNull();     // missing fields
});

test("progress lines carry a denominator, so a percentage is possible", () => {
	const e = parseSyncLine('{"type":"progress","phase":"ingest","current":25,"total":100}');
	expect(e).toEqual({ type: "progress", phase: "ingest", current: 25, total: 100 });
});

test("a progress line with total 0 renders as indeterminate, not as NaN%", () => {
	expect(describeSyncProgress({ type: "progress", phase: "ingest", current: 0, total: 0 }, 40))
		.not.toContain("NaN");
	expect(describeSyncProgress({ type: "progress", phase: "ingest", current: 0, total: 0 }, 40).length)
		.toBeLessThanOrEqual(40);
});

test("a determinate progress line renders a percentage and fits the width", () => {
	expect(describeSyncProgress({ type: "progress", phase: "ingest", current: 25, total: 100 }, 40))
		.toContain("25%");
	expect(Bun.stringWidth(describeSyncProgress({ type: "progress", phase: "ingest", current: 25, total: 100 }, 20)))
		.toBeLessThanOrEqual(20);
});

test("every phase has a human word", () => {
	for (const phase of ["scan", "ingest", "rollup"] as const) {
		expect(describeSyncProgress({ type: "progress", phase, current: 1, total: 2 }, 60)).toMatch(/[a-z]/i);
	}
});

test("done carries the rollup status so the panel can update its dirty-hour count", () => {
	expect(parseSyncLine('{"type":"done","rollup":{"dirtyHours":0,"dirtySessions":0}}'))
		.toEqual({ type: "done", rollup: { dirtyHours: 0, dirtySessions: 0 } });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test test/sync.test.ts`
Expected: FAIL — `Cannot find module '../src/sync/client'`.

- [ ] **Step 3: Write `scripts/sync-worker.ts`**

```ts
/**
 * Stats ingest worker. Runs as a one-shot child process spawned by
 * src/sync/client.ts. Owns the stats DB handle so the synchronous SQLite work
 * never runs on the TUI thread; the parent SIGKILLs this process once `done`
 * arrives. Mirrors pi-coding-agent/src/stats/activity-worker.ts.
 *
 * Emits one JSON object per line on stdout. Writes nothing to stderr on the
 * happy path — stderr is the crash channel and the parent surfaces its tail.
 */
import { syncAllSessions, type SyncProgress } from "@oh-my-pi/omp-stats/aggregator";
import { refreshRollups, getRollupStatus } from "@oh-my-pi/omp-stats/rollup";
import { getDailyActivity } from "@oh-my-pi/omp-stats/db";

const emit = (o: unknown): void => { process.stdout.write(JSON.stringify(o) + "\n"); };

emit({ type: "progress", phase: "scan", current: 0, total: 0 });

await syncAllSessions({
	onProgress: (p: SyncProgress) => {
		emit({ type: "progress", phase: "ingest", current: p.current, total: p.total });
	},
});

emit({ type: "progress", phase: "rollup", current: 0, total: getRollupStatus().dirtyHours });
await refreshRollups({
	onProgress: (dirtyHours: number) => { emit({ type: "progress", phase: "rollup", current: 0, total: dirtyHours }); },
});

// Push refreshed activity so a heatmap painted from cached rows converges,
// exactly as activity-worker.ts does.
emit({ type: "activity", points: await getDailyActivity() });
emit({ type: "done", rollup: getRollupStatus() });
```

`syncAllSessions` takes an OS file lock that polls every 25 ms for up to one hour. That wait is `await`-based, so the parent's async continuations keep running and it acquires as soon as the holder releases — a 4-second holder was measured acquiring after 3660 ms. It is a block, not a deadlock, and it is bounded by the abort signal in `startIngest`.

- [ ] **Step 4: Implement `src/sync/client.ts`**

`parseSyncLine` returns `null` for anything malformed, so a partially-written final line on a killed child cannot crash the panel. `startIngest` spawns `[process.execPath, join(import.meta.dir, "../../scripts/sync-worker.ts")]`, reads stdout line by line, and calls `onEvent` for each parsed event. In a `finally`, it `SIGKILL`s the child and removes the abort listener — the same contract as `loadDailyActivity`, where per-file writes are transactional and the OS-owned sync lock is released with the process.

`describeSyncProgress` renders a phase word plus a bar. When `total > 0`, a determinate bar; when `total === 0`, an indeterminate one. Never emit `NaN`.

> **OPEN DECISION — percentage or indeterminate bar for the sync indicator?**
> `SyncProgress` carries `current` and `total` (`omp-stats/src/aggregator.ts:89-94`), so a percentage is available for the ingest phase. `refreshRollups` reports only a remaining `dirtyHours` count, with no total, so the rollup phase is necessarily indeterminate.
> **Recommended default:** determinate where a denominator exists, indeterminate otherwise, in both cases in the footer so it never reflows the layout. **Evidence that would settle it:** one look at a real 7141 ms ingest. The test above already covers both branches, so switching is a one-line change.

- [ ] **Step 5: Run to verify it passes**

Run: `bun test test/sync.test.ts`
Expected: `6 pass`.

- [ ] **Step 6: Verify the worker end to end**

Run: `bun run scripts/sync-worker.ts 2>&1 | tail -3`
Expected: a stream of `progress` lines, then an `activity` line, then `{"type":"done",…}`. It writes to `~/.omp/stats.db` — that is ingest, and it is the only thing in this project that writes there. It is not a `probe-*` script and the naming keeps that distinction visible.

- [ ] **Step 7: Wire it into the panel**

In `StatsPanel`'s constructor, start the ingest fire-and-forget alongside the first load. On a `done` event, re-run `fetchFor` so the painted data reflects what ingest just wrote. On `error`, show it in the footer without tearing the panel down — the numbers already on screen are still true, just older.

- [ ] **Step 8: Commit**

```bash
git add src/sync/client.ts scripts/sync-worker.ts test/sync.test.ts src/tui/panel.ts
git commit -m "feat(sync): out-of-band ingest subprocess with streamed progress"
```

---

## Task 13: Overview screen

The landing screen, and the first to compose five primitives at once.

**Files:**
- Modify: `src/tui/screens/types.ts` (flip `overview` to `implemented`)
- Create: `src/tui/screens/overview.ts` (replace the stub — it did not exist; Tasks 10–12 created only the nine other scaffolds)
- Modify: `test/screens.test.ts`

**Interfaces:**
- Consumes: `ScreenContext`, `Screen` from `src/tui/screens/types.ts`; `renderDailyBars` from `src/tui/charts/bars.ts`; `renderSparkline`, `renderBarList`, `renderShareBar` from `src/tui/charts/sparkline.ts`; `renderTableRow` from `@oh-my-pi/pi-tui` (the free function — `new Table(...)` has **zero** first-party call sites, and its cells must be `{ text, style? }` objects or `alignCell` throws on `undefined.replaceAll`); `MetricRow`, `KeyValueList`, `Section` from `@oh-my-pi/pi-tui`; `buildAgentTokenShare` from `@oh-my-pi/omp-stats/client/data/view-models`; `costWithUnpriced`, `tokenCells`, `formatCost`, `formatCompact`, `formatInteger`, `formatPercent` from `src/tui/format.ts`.
- Produces: nothing new. `overview.ts` exports the single `overviewScreen: Screen` that Task 10's registry already references.

- [ ] **Step 1: Write the failing screen test**

```ts
// added to test/screens.test.ts
import { overviewScreen } from "../src/tui/screens/overview";

test("overview renders an empty state when the range has no data", () => {
	const rows = overviewScreen.render(ctxWith({ overview: zeroedOverview() }));
	expect(rows.join("\n")).toMatch(/no usage recorded/i);
});

test("overview never prints a bare token total", () => {
	const rows = overviewScreen.render(ctxWith({ overview: busyOverview() })).join("\n");
	expect(rows).not.toMatch(/\b\d+(\.\d+)?B tokens/);
	expect(rows).toContain("cache");
});

test("overview renders the unpriced count beside the cost", () => {
	const rows = overviewScreen.render(ctxWith({ overview: unpricedOverview() })).join("\n");
	expect(rows).toContain("unpriced");
});

test("every overview row fits the width it was given", () => {
	for (const width of [40, 80, 120, 200]) {
		const rows = overviewScreen.render(ctxWith({ overview: busyOverview() }, width));
		for (const r of rows) expect(Bun.stringWidth(r), `w=${width}`).toBeLessThanOrEqual(width);
	}
});

test("overview uses the primitives it is here to prove", () => {
	const rows = overviewScreen.render(ctxWith({ overview: busyOverview() })).join("\n");
	expect(rows.length).toBeGreaterThan(8);   // stat strip + bars + sparkline + share bar + table
});
```

The empty-state test is Review Focus line 3; the bare-token test is Review Focus line 2; the unpriced test is Review Focus line 1.

- [ ] **Step 2: Run to verify it fails**

Run: `bun test test/screens.test.ts -t overview`
Expected: FAIL — the scaffold's placeholder rows do not satisfy any overview assertion.

- [ ] **Step 3: Implement the screen**

Top to bottom:

1. **Stat strip** — `MetricRow` with `{ value, leading }` specs: requests, models, days. A `value: undefined` omits the metric, which is how the strip degrades when the range is narrow.
2. **Metric grid** — `KeyValueList` with `labelWidth: 12`: cost (via `costWithUnpriced`), fresh / cache-read / cache-write / cache share (via `tokenCells`), error rate, median duration (via `formatElapsed`).
3. **Daily cost bars** — `renderDailyBars(overview.timeSeries.map(p => p.cost), …)` on a **zero baseline**, scaled by cost and never by tokens.
4. **Requests sparkline** — `renderSparkline(overview.timeSeries.map(p => p.requests), plan.sparkWidth, glyphs)`, min-based baseline, because a sparkline's job is contrast, not magnitude.
5. **Agent-type share bar** — `renderShareBar(buildAgentTokenShare(overview.byAgentType).segments, …)` plus a legend line. `buildAgentTokenShare` is reused verbatim from the package's `view-models.ts`, which is pure TS with no React binding.

6. **Recent requests table** — `renderTableRow` with `TableCell` objects and `TableColumn` descriptors, sorted newest first.

Each section heading takes its icon from `statsIcon(ctx.preset, role, ctx.theme)` — the Task 3 icon table — padded to `ICON_GUTTER[ctx.preset]` (2 under `unicode`, 1 under `nerd`, label width under `ascii`) so headings align regardless of emoji width. `cost` reads `icon.cost` (`💲` / `` / `$`), `tokens` reads `icon.tokens`, `requests` reads `cmd.stats`, `models` reads `icon.model`. **Never** hand-write a heading glyph in a screen module: if it is not in the table, add it to Task 3 instead.

```ts
const heading = (ctx: ScreenContext, role: IconRole, label: string): string =>
	`${statsIcon(ctx.preset, role, ctx.theme).padEnd(ICON_GUTTER[ctx.preset])} ${label}`;
```

The cache caveat, printed as a footnote rather than a tooltip: `cacheRate`'s denominator is fresh + cache-read, so cache **writes** are excluded. Showing only the rate understates the write cost.

- [ ] **Step 4: Flip the registry entry**

In `src/tui/screens/types.ts`, change `overview`'s `status` to `"implemented"` and import the real module. `IMPLEMENTED_IDS` stays as declared in Task 10 — it already lists it.

- [ ] **Step 5: Run to verify it passes**

Run: `bun test`
Expected: all pass.

- [ ] **Step 6: Verify by eye**

Run: `bun run scripts/probe-render.ts src/tui/screens/overview.ts render 108`
Expected: a stat strip, a labelled grid, a bar chart of recognisable shape, a sparkline, a share bar with legend, and a table — every row reporting its width.

- [ ] **Step 7: Commit**

```bash
git add src/tui/screens/overview.ts src/tui/screens/types.ts test/screens.test.ts
git commit -m "feat(screen): overview — stat strip, daily bars, sparkline, share bar, table"
```

---

## Task 14: Activity screen

The heatmap's home, and the proof that the hardest primitive composes.

**Files:**
- Create: `src/tui/screens/activity.ts`
- Modify: `src/tui/screens/types.ts`
- Modify: `test/screens.test.ts`

**Interfaces:**
- Consumes: `renderHeatmap`, `buildRamp`, `heatmapSummary` from `src/tui/charts/heatmap.ts`; `renderDailyBars` from `src/tui/charts/bars.ts`; `renderSparkline` from `src/tui/charts/sparkline.ts`; `Section`, `Spacer` from `@oh-my-pi/pi-tui`; `buildCostSummary` from `@oh-my-pi/omp-stats/client/data/view-models`.
- Produces: `export const activityScreen: Screen`.

- [ ] **Step 1: Write the failing test**

```ts
import { activityScreen } from "../src/tui/screens/activity";

test("activity renders the heatmap grid at every width without overflowing", () => {
	for (const width of [50, 80, 120, 200]) {
		for (const r of activityScreen.render(ctxWith({ dailyActivity: busyDays(), costs: busyCosts() }, width))) {
			expect(Bun.stringWidth(r), `w=${width}`).toBeLessThanOrEqual(width);
		}
	}
});

test("activity says so when the range has no activity at all", () => {
	expect(activityScreen.render(ctxWith({ dailyActivity: [], costs: [] })).join("\n"))
		.toMatch(/no activity/i);
});

test("activity's summary total matches the grid it summarises", () => {
	const rows = activityScreen.render(ctxWith({ dailyActivity: busyDays(), costs: busyCosts() })).join("\n");
	expect(rows).toContain("$");
});

test("activity works when the activity payload is absent (worker not started)", () => {
	expect(() => activityScreen.render(ctxWith({ dailyActivity: undefined }))).not.toThrow();
});
```

The last test matters because `getDailyActivity` is the one slow query and it lives in the subprocess — the panel must render *before* it arrives.

- [ ] **Step 2: Run to verify it fails**

Run: `bun test test/screens.test.ts -t activity`
Expected: FAIL.

- [ ] **Step 3: Implement the screen**

`buildRamp(ctx.theme)` once per frame, `renderHeatmap` at `plan.heatWeeks`, `heatmapSummary` as the section's title line, then the daily cost bars from `buildCostSummary(costs.costSeries)` — summed by UTC day, which is how `costSeries` is already bucketed — and a requests sparkline beneath. When `data.dailyActivity` is absent, render the dim one-liner `/usage` uses (`"Usage history unavailable."`) rather than an empty grid, because an empty grid reads as "you did nothing" when the truth is "it has not loaded yet".

- [ ] **Step 4: Flip the registry entry to `implemented`.**

- [ ] **Step 5: Run and verify**

Run: `bun test`, then `bun run scripts/probe-render.ts src/tui/screens/activity.ts render 108`.
Expected: an eight-row heatmap grid of identical widths, a summary line, bars, sparkline.

- [ ] **Step 6: Commit**

```bash
git add src/tui/screens/activity.ts src/tui/screens/types.ts test/screens.test.ts
git commit -m "feat(screen): activity — calendar heatmap over the full record"
```

---

## Task 15: Models screen

**Files:**
- Create: `src/tui/screens/models.ts`
- Modify: `src/tui/screens/types.ts`
- Modify: `test/screens.test.ts`

**Interfaces:**
- Consumes: `renderBarList`, `BarListRow`, `renderSparkline` from `src/tui/charts/sparkline.ts`; `renderTableRow` from `@oh-my-pi/pi-tui`; `costWithUnpriced`, `formatCost`, `formatCompact`, `formatPercent`, `formatElapsed` from `src/tui/format.ts`; `buildModelPerformanceLookup` from `@oh-my-pi/omp-stats/client/data/view-models`.
- Produces: `export const modelsScreen: Screen`.

- [ ] **Step 1: Write the failing test**

```ts
import { modelsScreen } from "../src/tui/screens/models";

test("models sorts by cost and renders an unpriced model as N/A, never free", () => {
	const rows = modelsScreen.render(ctxWith({ modelDashboard: mixedModelDashboard() })).join("\n");
	expect(rows).toContain("N/A");
	expect(rows).toMatch(/unpriced/);
});

test("a single model does not break the bar list", () => {
	expect(() => modelsScreen.render(ctxWith({ modelDashboard: oneModel() }))).not.toThrow();
});

test("models renders one sparkline cell per model row", () => {
	const rows = modelsScreen.render(ctxWith({ modelDashboard: mixedModelDashboard() })).join("\n");
	const glyphCount = (rows.match(/[▁▂▃▄▅▆▇█]/g) ?? []).length;
	expect(glyphCount).toBeGreaterThan(0);
});

test("every models row fits its width", () => {
	for (const width of [40, 80, 160]) {
		for (const r of modelsScreen.render(ctxWith({ modelDashboard: mixedModelDashboard() }, width))) {
			expect(Bun.stringWidth(r), `w=${width}`).toBeLessThanOrEqual(width);
		}
	}
});

test("models with no data says so", () => {
	expect(modelsScreen.render(ctxWith({ modelDashboard: emptyModelDashboard() })).join("\n"))
		.toMatch(/no models/i);
});
```

The first test is Review Focus line 1's sharpest case: a model with real token volume and exactly zero recorded cost must not render as a free model.

- [ ] **Step 2: Run to verify it fails**

Run: `bun test test/screens.test.ts -t models`
Expected: FAIL.

- [ ] **Step 3: Implement the screen**

A ranked `renderBarList` scaled by **cost** — never by tokens, because this database has `deepseek-v4-flash` reading 4.04 B cache tokens for $22.85 against `gpt-5.6-terra` reading 2.39 B for $935.72, a 41× price spread at comparable volume, so a token-scaled bar chart across models is actively misleading. Then a `renderTableRow` table with columns: model, requests, error rate, TTFT (`formatElapsed`), cost (`costWithUnpriced`), and a per-row `renderSparkline` over that model's `modelSeries` request counts.

- [ ] **Step 4: Flip the registry entry to `implemented`.**

- [ ] **Step 5: Run and verify**

Run: `bun test`, then `bun run scripts/probe-render.ts src/tui/screens/models.ts render 120`.
Expected: a cost-ranked list, then a table with sparkline cells; every row within its width.

- [ ] **Step 6: Commit**

```bash
git add src/tui/screens/models.ts src/tui/screens/types.ts test/screens.test.ts
git commit -m "feat(screen): models — cost-ranked bars, per-row sparklines, unpriced surfaced"
```

---

## Task 16: End-to-end verification in a real omp session

The overlay has never been painted in a real terminal. Everything above it is source-derived or headless-rendered. This task is the one that cannot be automated, and the plan says so rather than pretending otherwise.

**Files:**
- Create: `docs/plans/2026-10-03-stats-tui-verification.md` — the checklist as run, with what was observed
- Modify: `README.md` — install and usage, if it does not exist

**Interfaces:**
- Consumes: everything.
- Produces: no code. A verified panel and a record of what a human saw.

- [ ] **Step 1: Run the whole automated suite**

Run: `bun test`
Expected: every file passes, no skipped, no console noise.

- [ ] **Step 2: Link the plugin**

Run: `omp plugin link /Users/yuzu/Documents/Projects/omp-stats-tui`

- [ ] **Step 3: Open a real session and run the command**

Run: `omp`, then type `/stats-tui`.

Check, in order:

| # | Check | What "pass" looks like |
|---|---|---|
| 1 | The command is reachable | `/stats-tui` appears in the palette and executes. `/stats` still launches the browser — the two coexist by design (ADR 0002). |
| 2 | First paint is not blocked | The overlay appears with a dim loading line; the session stays responsive to Esc while the 866.9 ms `initDb()` runs. |
| 3 | The frame renders | Header, body, divider and footer, inside `╭─ Stats · 24 hours ─…─╮`. The transcript underneath is untouched — `fullscreen: true` borrowed the alternate screen buffer. |
| 4 | Range cycling | `r` steps `24h → 7d → 30d → 90d → all → 1h → 24h`; `R` reverses. The header label follows. There is **no** "365 days" option anywhere. |
| 5 | Tab cycling | `tab`/`shift+tab` move across all twelve tabs, skipping `traces` and `frustration`. Each scaffold shows one dim line with a reason. |
| 6 | Scrolling | Arrow keys, page keys, `home`, `end`, and the mouse wheel all scroll. Scrolling past the end clamps. |
| 7 | Resize | Resize the terminal while the panel is open. The layout reflows, the heatmap's week count changes, and the scroll offset clamps rather than leaving a blank body. There is no resize hook, so this is height read fresh from `tui.terminal.rows` every frame. |
| 8 | Narrow terminal | Shrink to 40 columns. One column, no torn borders, no overflow, no dropped section. Then to 20×10: still a valid frame. |
| 9 | `ascii` preset | Set `symbolPreset: "ascii"`, reopen. Every data-ink character is ASCII; every row is the same width; chrome is `+ - |`. |
| 10 | Monochrome terminal | Run with colour stripped. The heatmap still shows four distinguishable levels — because the `ascii` ladder is a ranking ladder and the `unicode` level-1 glyph is `■` at ramp[0], not a flat field. |
| 11 | Empty range | Run `/stats-tui`, press `r` until `1h`, in a quiet hour. An honest empty state, not a wall of zero bars. |
| 12 | Sync progress | The footer shows ingest progress; the panel stays scrollable throughout. Closing the panel mid-sync leaves no orphan process — check with a process listing. |
| 13 | Stale backlog | With `rollupStatus().dirtyHours` above 0, the header names the count. **To see a large one:** check `bun run scripts/probe-data.ts` output for the current `dirtyHours`; if it is 0, that check is deferred and must be recorded as unverified rather than claimed. |
| 14 | The DB was not corrupted | Run `bun run scripts/probe-data.ts` after the session; `PRAGMA integrity_check` returns `ok`. |
| 15 | Nothing leaked | No file was created under `~/.omp/` other than the database writes ingest performs, and `~/.bun/install/global/node_modules/@oh-my-pi/` is byte-identical to before. |

- [ ] **Step 4: Record the result**

Write the observed outcome of all fifteen checks into `docs/plans/2026-10-03-stats-tui-verification.md`. **Any check that was not actually run is recorded as `NOT VERIFIED`, never as passed.** A verification record that overstates itself is worse than none.

- [ ] **Step 5: Commit**

```bash
git add docs/plans/2026-10-03-stats-tui-verification.md README.md
git commit -m "docs: record the end-to-end verification run"
```

---

## Appendix A — The reuse ledger

Every line is an import, not a reimplementation. This is the list a reviewer should check first.

| Need | Reused from | Not written |
|---|---|---|
| Data access | `handleApi` from `@oh-my-pi/omp-stats/server` | No SQL, no server, no socket |
| Ranges | `TIME_RANGES` mirrored in `src/data/ranges.ts` | Not our own windowing |
| Cost / token / percent / duration formatting | `@oh-my-pi/omp-stats/client/data/formatters` (14 exports) | Not re-derived |
| Agent-type token share | `buildAgentTokenShare` from `…/client/data/view-models` | Not re-derived |
| Cost-component summary | `buildCostSummary` from the same module | Not re-derived |
| Folder / tool rows | `buildFolderRows`, `buildToolRows` from the same module | Not re-derived |
| Heatmap layout | `buildHeatmapLayout` from `@oh-my-pi/pi-tui/overlays/usage-dashboard` | Only the private cell emission and ramp |
| Overlay frame | `OverlayPanel`, `PanelRows`, `PanelDivider` from `@oh-my-pi/pi-tui/chrome` | No hand-rolled borders |
| Numbers table | `renderTableRow` from `@oh-my-pi/pi-tui` | Not `new Table()` — zero first-party call sites |
| Stat strip | `MetricRow` | — |
| Metric grid | `KeyValueList` | — |
| Section headers | `Section` | — |
| Tab strip | `TabBar` | — |
| Bars | `renderProgressBar` from `@oh-my-pi/pi-tui` | Not the `ProgressBar` class — zero call sites |
| Keys | `matchesKey`, `matchesSelect*`, `routeSgrMouseInput` | No own key decoder |
| Key hints | `editorKey`, `editorKeys`, `formatKeyHint` | — |
| Colour | `theme.fg` / `theme.bg`; `colorToAnsi`; `colorLuma`, `hexToRgb`, `rgbToHex` | No own ANSI encoder |
| Chrome glyphs | `theme.boxRound.*`, `theme.sep.*`, `theme.icon.*`, `theme.md.colorSwatch` | No own box drawing |
| Ingest subprocess shape | `activity-worker.ts` + `activity-client.ts` | ~80 lines; see below |

### The five deliberate copies

Each is named, bounded, and justified. If a reviewer objects to one, the objection is to the coupling, and the answer is on the line.

1. **`STATS_OVERLAY_OPTIONS`** — 8 lines, from `pi-coding-agent/src/extensibility/custom-commands/bundled/annotate/fullscreen.ts:13-20`. The deep path is private and would couple us to its file layout.
2. **Panel load idiom** — ~30 lines, from `pi-tui/src/overlays/usage-dashboard.ts:559-591`. The pattern (fire-and-forget, push callback, `AbortController`, `#changed()`), not an API.
3. **Key cascade** — ~40 lines, from `pi-tui/src/overlays/usage-dashboard.ts:1367-1405`. The *order* is load-bearing and undocumented: wheel, then `matchesSelectCancel` for Esc, then literal letters, then `matchesSelect*`, then `home`/`end`.
4. **Render frame** — ~30 lines, from `pi-tui/src/overlays/usage-dashboard.ts:896-927`. Height comes from `tui.terminal.rows` every frame because there is no resize hook; the scroll clamp lives inside `render` so shrink-on-resize is free.
5. **Heat ramp** — ~15 lines, from `pi-tui/src/overlays/usage-dashboard.ts:799-825`. The method is `#private`; there is no export to call.

## Appendix B — Test coverage map

| Pure logic | Test file | Task |
|---|---|---|
| Glyph ramp, presets, width | `test/glyphs.test.ts` | 3 |
| Cost / token / unpriced / elapsed | `test/format.test.ts` | 4 |
| Range set, cycling, buckets | `test/ranges.test.ts` | 5 |
| Adapter against fixtures | `test/api.test.ts` | 5 |
| Layout at five widths | `test/layout.test.ts` | 6 |
| Bar chart, downsampling, empty state | `test/bars.test.ts` | 7 |
| Sparkline, bar list, share bar | `test/sparkline.test.ts` | 8 |
| Heatmap grid, both ladders | `test/heatmap.test.ts` | 9 |
| Registry, data contracts | `test/screens.test.ts` | 10 |
| Scroll clamp, row budget, dispose | `test/screens.test.ts` | 11 |
| Sync protocol, progress rendering | `test/sync.test.ts` | 12 |
| Overview composition | `test/screens.test.ts` | 13 |
| Activity composition | `test/screens.test.ts` | 14 |
| Models composition | `test/screens.test.ts` | 15 |

**What is not unit-tested, and why:** the fullscreen overlay itself. It needs a terminal, `process.stdout.rows`, a real alternate screen buffer and real key delivery. Three of its invariants are tested through the `makePanel` seam (scroll clamping, row budget, idempotent dispose); mount, resize, mouse and dismissal are manual, and Task 16 is the record of them. The research that produced this plan could not paint the overlay either — every overlay claim in it is source-derived.

## Appendix C — Sources

**Primary, local, read 2026-10-02/03, omp 18.4.10:**

- `@oh-my-pi/omp-stats/src/server.ts:165-329` — `handleApi`, its signature, its route dispatch, its request reads. `:364-396` — `createDashboardServer`, the SSE branch outside `handleApi`. `:20-63, 115-153, 485-496` — import-time work; `ensureClientBuild` is only called from `startServer`.
- `@oh-my-pi/omp-stats/src/aggregator.ts:89-110, 245-256, 470-520, 598-660` — `SyncProgress`, `SyncOptions`, `syncAllSessions`, `TIME_RANGES`, `getTimeRangeConfig`, the eight aggregator exports.
- `@oh-my-pi/omp-stats/src/rollup.ts:1-26, 300-314, 387-399` — the module doc, `EXACT_DIRTY_LIMIT`, `getRollupStatus`, `refreshRollups`.
- `@oh-my-pi/omp-stats/src/db.ts:83-86, 115-126, 985-1011` — `currentDb()`, `initDb()`, `getDailyActivity`.
- `@oh-my-pi/omp-stats/src/shared-types.ts` — `AggregatedStats`, `ModelStats`, `FolderStats`, `DashboardStats`, `TimeSeriesPoint`, `CostTimeSeriesPoint`, `DailyActivityPoint`.
- `@oh-my-pi/omp-stats/src/client/data/formatters.ts` — the 14 exported formatters.
- `@oh-my-pi/omp-stats/src/client/data/view-models.ts` — `buildAgentTokenShare`, `buildCostSummary`, `buildFolderRows`, `buildToolRows`, `summarizeRequests`, `groupErrorsBySignature`, `buildModelPerformanceLookup`.
- `@oh-my-pi/pi-tui/src/overlays/usage-dashboard.ts:281-362, 482-500, 533-560, 559-602, 799-872, 896-927, 1351-1405` — `buildHeatmapLayout`, `HeatmapLayout`, `DailyActivityPoint`, `UsageDashboardOptions`, the class, the load idiom, `#heatRamp`, `#renderHeatmap`, `render`, `handleInput`, `formatActivityErrorDetail`.
- `@oh-my-pi/pi-tui/src/chrome/overlay-box.ts:107-260` — `PanelRows`, `PanelDivider`, `OverlayPanel`.
- `@oh-my-pi/pi-tui/src/components/{table,metric,key-value-list,section,tab-bar,progress-bar}.ts` — constructor signatures and option types.
- `@oh-my-pi/pi-tui/src/tui.ts:229-320, 424-470` — the `Component` interface; `OverlayOptions` and the `fullscreen` doc comment.
- `@oh-my-pi/pi-tui/src/theme/{symbols.ts,theme-class.ts,color.ts,schema.ts}` — `SymbolPreset`, `SYMBOL_PRESETS`, `theme.symbol`, `theme.fg`, `theme.getSymbolPreset`, `detectColorMode`, `colorToAnsi`.
- `@oh-my-pi/pi-tui/src/keybinding-matchers.ts:31-57`, `src/keys.ts:189, 549-552`, `src/keybindings.ts:130-142` — `matchesSelect*`, `matchesKey`, the `tui.select.*` defaults.
- `@oh-my-pi/pi-coding-agent/src/modes/controllers/extension-ui-controller.ts:1150-1215` — the factory signature, `KeybindingsManager.inMemory()`, `showOverlay`, cleanup.
- `@oh-my-pi/pi-coding-agent/src/extensibility/extensions/types.ts:243-321, 1328-1333, 1517-1525` — `ExtensionCustomOptions`, `custom`, `RegisteredCommand`, `registerCommand`.
- `@oh-my-pi/pi-coding-agent/src/extensibility/plugins/{types.ts:28-56, legacy-pi-compat.ts:806-814}` — `PluginManifest`; `PI_PACKAGE_NAMES`.
- `@oh-my-pi/pi-coding-agent/src/extensibility/custom-commands/bundled/annotate/fullscreen.ts:13-20, 36-45` — `ANNOTATION_OVERLAY_OPTIONS` and the mount.
- `@oh-my-pi/pi-coding-agent/src/stats/{activity-worker.ts,activity-client.ts,activity-protocol.ts}` — the subprocess pattern, and the author's stated reason for it.
- `@oh-my-pi/pi-coding-agent/src/cli/worker-client.ts` — `WorkerHandle`, `spawnWorkerOrUnavailable`, `createUnavailableWorker`, `terminate`.
- `omp://extensions.md`, `omp://extension-loading.md`, `omp://tui.md` — extension API, discovery rules, TUI runtime.

**Primary, on-disk research, this project:**

- `docs/research/omp-stats-tui/REPORT.md` and `findings/F1`–`F11`. F9 (four import strategies run in the real loader; `handleApi` verified 200; `initDb()` non-mutation; `syncAllSessions` at 7141 ms; per-range timings; lock contention), F10 (the glyph system, its per-preset codepoints and its `Bun.stringWidth` alignment proof) and F11 (five zero-install paths tested) are the load-bearing ones.

**Primary, web, fetched 2026-10-03** (repo-location corrections noted; five URLs named in the original brief returned HTTP 404 and were replaced with verified locations):

1. plotext — https://github.com/piccolomo/plotext (clone `e51c92a`)
2. plotext bar geometry — https://raw.githubusercontent.com/piccolomo/plotext/master/docs/source/bar.rst
3. plotext terminal sizing — https://raw.githubusercontent.com/piccolomo/plotext/master/plotext/_kernel/terminal.py
4. plotext defaults — https://raw.githubusercontent.com/piccolomo/plotext/master/plotext/_settings/defaults.py
5. plotext marker table — https://raw.githubusercontent.com/piccolomo/plotext/master/plotext/_kernel/cpp/utility/maps/marker.cpp
6. plotext high-definition tables (the Windows sextant exclusion) — https://raw.githubusercontent.com/piccolomo/plotext/master/plotext/_kernel/cpp/utility/maps/high_def.cpp
7. asciichart — https://raw.githubusercontent.com/kroitor/asciichart/master/asciichart.js
8. spark — https://raw.githubusercontent.com/holman/spark/master/spark
9. visidata sparkline — https://raw.githubusercontent.com/saulpw/visidata/v3.0/visidata/features/sparkline.py
10. bottom — https://github.com/ClementTsang/bottom (clone `cea7547`)
11. bottom gauges — https://raw.githubusercontent.com/ClementTsang/bottom/main/src/canvas/components/pipe_gauge.rs
12. btop — https://github.com/aristocratos/btop (clone `d3389d7`)
13. btop graphs — https://raw.githubusercontent.com/aristocratos/btop/master/src/btop_draw.cpp
14. btop alt-screen — https://raw.githubusercontent.com/aristocratos/btop/master/src/btop_tools.cpp
15. ratatui block symbols (the *left-partial* set — a trap: correct for horizontal bars, wrong for vertical ones) — https://raw.githubusercontent.com/ratatui/ratatui/main/ratatui-core/src/symbols/block.rs
16. ratatui shade symbols (a shipped heatmap ramp) — https://raw.githubusercontent.com/ratatui/ratatui/main/ratatui-core/src/symbols/shade.rs
17. gnuplot `dumb` driver — https://raw.githubusercontent.com/gnuplot/gnuplot/master/term/dumb.trm
18. gnuplot `dumb` docs — https://gnuplot.sourceforge.net/docs/loc20689.html
19. gnuplot `block` terminal docs — https://gnuplot.sourceforge.net/docs/loc19798.html
20. termplot — https://github.com/iswdp/termplot (clone `079d0f2`)
21. bandwhich — https://github.com/imsnif/bandwhich (clone `1899870`; **it draws no chart at all**, only a table)

## Appendix D — Open questions carried forward

Each is a place where the plan still needs a decision the evidence does not settle. Four were closed by the user's settled decisions and are recorded below as **resolved**, not open; only **(1)** and **(2)** are genuinely open.

**Genuinely open — two:**

1. **Does the host already call `syncAllSessions` before an extension runs?** Undetermined in the research. If it does, Task 12's subprocess is redundant and can be deferred without reopening anything else. **Settled by one run** of `scripts/probe-data.ts` immediately after a heavy session, comparing `getRollupStatus().dirtyHours` against the newest session file's mtime. (The *larger* question — whether to sync at all — is **resolved**: option (a), ADR 0006, superseding ADR 0003's no-sync clause. See the Settled decisions table.)
2. **Heatmap data ink: one glyph with colour, or a shade ramp?** Deliberately **deferred to an empirical comparison**. The glyph module models it as a per-preset ramp so the swap is one table value; `scripts/probe-glyphs.ts --heatmap` renders both ladders side by side. **Settled by running that script and looking at the two rows**, plus one look under a monochrome terminal with `symbolPreset: "unicode"`.

**Resolved since the first draft — recorded for traceability, not open:**

- ~~Sync policy~~ — **ADR 0006**, option (a): background ingest in a `SIGKILL`-able subprocess. ADR 0003 superseded on that clause only.
- ~~First batch of screens~~ — **option (a)**: `overview` + `activity` + `models`. The other nine routes keep their data contracts as scaffolds.
- ~~Stub → real boundary for scaffolded screens~~ — **placeholder data**, not a "not built yet" line: a small, visibly-fake, reviewable sample behind a dim `placeholder data — not real usage` marker, and **never a fetch**.
- ~~`icon.cost` / `cmd.stats` emoji in headings~~ — **allowed**, as section-heading icons under the `unicode` preset in a reserved 2-cell gutter, reusing `theme.symbol()` for 10 of the 16 roles; still forbidden as repeated data cells. Recorded as an **ADR-0007 candidate** in Task 3 (not written by this plan).

**Still open, but narrow — implementation detail, not policy:**

3. **Sync indicator: percentage or indeterminate?** — determinate where `SyncProgress.total > 0`, indeterminate otherwise. Settled by one look at a real 7141 ms ingest.
4. **What happens on a version skew** (our pin `18.4.10` against a `18.4.11` host)? — warn on mismatch and keep loading, never refuse. The failure mode is an obscure load failure rather than a clear error, so the warning must be loud. Settled by a deliberate skew test: pin `18.4.9` against a `18.4.10` host and record what happens.
