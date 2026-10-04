# F23 — Panel redesign: the tab strip, the body grammar, the footer, and how to get there

Design only. No production code was written or modified.

**Inputs:** my own `F20-settings-anatomy.md` (what `/settings` and `/usage`
actually do) and the sibling's `F21-web-layout-spec.md` (what the web dashboard
does per screen). Both live in this directory.

**One correction to the brief before the design starts.** The task describes
`spec.ts` as a seam to feed a renderer from. `src/layout/spec.ts` **exists but
is untracked and does not compile**: `src/layout/spec.ts(278,30): error TS2307:
Cannot find module './screens'`. `src/layout/screens.ts` has not been written
yet. So the IR's `Band` union is a contract being built *toward*, not one to
import today. The renderer below is specified against
`spec.ts:196-201` and `spec.ts:236-244`, and its first step is gated on that
module resolving.

---

# Angle

Our panel reads as stacked text blocks with a rule under each one, because
**each screen invents its own visual structure.** `overview.ts` draws a rule
under its title and under each of three section headings; `models.ts` draws two
banded bar charts; `activity.ts` draws a heatmap under its own heading. Nothing
connects them, and nothing connects any of them to `/settings` or `/usage`.

That is not a styling bug and it cannot be fixed by restyling three files. The
web dashboard's structure *is* data — F21 reduces all eight routes to four band
shapes over a uniform 20px gutter — and the terminal port has no equivalent
level. So the fix is the one the IR agent's own header already argues for
(`spec.ts:5-13`): introduce a band renderer, make visual structure a data
decision, and let every screen draw from one grammar.

`/usage` shows what the target looks like and costs almost nothing to copy: it
draws **zero** rules inside its body. Structure comes from whitespace plus one
bold-accent heading per section (`usage-dashboard.ts:847, 878-884`), and colour
is reserved for magnitude and status, never for section identity. We spend
colour and rules on section identity, which is the whole complaint.

We also cycle twelve screens blind, because there is no tab strip at all.

---

## 0. The charts — the question asked alongside the four designs

**`usage-dashboard.ts` imports no chart component whatsoever.** Its full import
list is `usage-dashboard.ts:8-46` and contains no chart, no sparkline, no heat
map. Both of its visuals are inlined arithmetic:

- The quota bar, `usage-dashboard.ts:622-629`:

```ts
#miniBar(fraction: number | undefined, status: UsageLimit["status"], width: number): string {
	if (fraction === undefined) return theme.fg("dim", "·".repeat(width));
	const clamped = Math.min(Math.max(fraction, 0), 1);
	const filled = Math.round(clamped * width);
	const bar = "█".repeat(filled);
	const empty = "░".repeat(width - filled);
	return `${theme.fg(this.#statusColor(status), bar)}${theme.fg("dim", empty)}`;
}
```

- The heatmap cells, `usage-dashboard.ts:864-866`:

```ts
if (cell === null) line += "  ";
else if (cell === 0) line += `${theme.fg("dim", "·")} `;
else line += `${ramp[cell - 1]}■${reset} `;
```

**Conclusion: there is nothing to copy and no inconsistency to fix.** Our
`src/tui/charts/` is already more modular than the reference — `renderDailyBars`,
`renderHeatmap`, `renderSparkline`, `renderRankedBars`, `renderShareBar` are
separate pure functions where `/usage` has two inlined loops. Adopting "the
`/usage` approach" would mean deleting our separation, which is strictly worse.

**The charts are ugly because of where they sit, not what they draw.** Ours
renders under a `─` rule with its own title line; `/usage` renders under a
bold-accent heading with dim metadata and no rule. The same fix as everything
else: make the chart a **band body**, not a section of its own.

One genuine gap, from F21: four of the web Overview's five stat tiles carry a
28px sparkline (`OverviewRoute.tsx:103-140`). Our tiles have none. The IR's
`StatTile.spark` already models it (`spec.ts:160`) and `renderSparkline` already
exists, so this is a renderer gap, not a chart gap.

---

## 1. The tab strip

### 1.1 Tab shape, and the `short` budget

`TabBar`, `Tab` and `TabBarTheme` are on the public barrel — `pi-tui/src/index.ts:22`.
Import from `@oh-my-pi/pi-tui`. `Tab` is `pi-tui/src/components/tab-bar.ts:20-30`.

```ts
const tabs: Tab[] = SCREEN_SPECS
	.filter(spec => !spec.deferred)
	.map(spec => ({
		id: spec.id,
		label: `${statsIcon(preset, TAB_ICON[spec.id], theme)} ${spec.label}`,
		short: TAB_SHORT[preset][spec.id],
	}));
const bar = new TabBar("", tabs, tabBarTheme(theme));
bar.showHint = false;
```

The tab set is **the IR's `SCREEN_SPECS`** (`spec.ts:236-244`), filtered by
`!spec.deferred`. That is a single source of truth: the strip, the screen
registry, and the fetch needs all read the same nine specs. `spec.deferred`
replaces today's ad-hoc `status !== "excluded"` filter, and it says *why* a
screen is not on the strip.

**`label`** = `icon + space + label`, matching `/settings`
(`settings-selector.ts:546-553`).

**`short` is the whole problem.** F20 measured `TabBar`'s behaviour: it collapses
to `short` for tabs **farthest from the active one first**, then wraps
(`tab-bar.ts:271-286`). Our `Screen.short` values are 6–8 cell *words*
(`"Frustr."`, `"Provider"`), so 12 tabs of them cannot fit 76 columns and the
strip wraps to two rows on every terminal narrower than ~180 columns — costing
a frame row for no information, since a wrapped strip of words is unreadable.

The budget, computed from `tab-bar.ts:239-266` (each tab is
` ${label} ` = 2 cells of padding, plus a 2-cell gutter between tabs):

| `short` form | per tab | 12 tabs, `showHint=false` |
|---|---|---|
| 8-cell word | 12 | 142 — wraps |
| 2-cell emoji | 6 | 70 — fits at innerWidth ≥ 70 |
| 1-cell glyph | 5 | 58 — fits at innerWidth ≥ 58 |

**Decision: `short` is a single glyph, at most 1 cell on the `ascii` preset.**
Two cells on `unicode`/`nerd`, because the emoji and PUA icons are the readable
ones, and one ASCII character because the `ascii` arm of `STATS_ICONS` is
*variable* — `tok:` is 4 cells, `[!!]` is 4, `cache` is 5
(`src/tui/icons.ts:106-124`) — and 12 × (2 + 5 + 2) = 108 does not fit.

Reusing `statsIcon` for `short` therefore does **not** work; the ascii arm is
too wide. A dedicated table is required, and it must be one cell per preset:

```ts
/** One cell on every preset. F20: 12 tabs must fit 58 columns or the strip wraps. */
export const TAB_SHORT: Record<SymbolPreset, Record<string, string>> = {
	unicode: { overview: "💲", activity: "📅", models: "⬢", costs: "💲", projects: "📁",
	           requests: "📊", errors: "⚠", tools: "🛠", providers: "🛰", gain: "💹" },
	nerd:    { /* the PUA forms from STATS_ICONS.nerd — 1 cell each */ },
	ascii:   { overview: "*", activity: "#", models: "M", costs: "$", projects: "D",
	           requests: "R", errors: "!", tools: "T", providers: "H", gain: "+" },
};
```

Roles come from our existing `IconRole` table (`src/tui/icons.ts:10-27`) —
`cost`, `calendar`, `models`, `projects`, `requests`, `errors`, `tools`,
`providers`, `gains`. `costs` and `overview` share `cost`; that is acceptable
because only one is ever active and the labels disambiguate the rest.

**Wrap is accepted, not fought.** `TabBar` has no scroll. The panel reads
`bar.render(innerWidth)` every frame and feeds `tabLines.length` into the frame
budget — exactly what `/settings` does (`settings-selector.ts:736, 739`). Below
70 columns the strip is two rows and the body loses one; above, one row.

### 1.2 The active tab: yes, a luminance step

Confirmed and adopted. `getTabBarTheme()` (`chrome/shared.ts:18-27`):

```ts
activeTab: (text: string) => theme.bold(theme.bg("selectedBg", theme.fg("text", text))),
inactiveTab: (text: string) => theme.fg("muted", text),
```

The active tab is a **background-filled, bold** tab; inactive tabs are
**foreground colour only**. That is a luminance step, and it survives every
theme and every preset, where a hue step does not — `accent` and `warning` are
close in some themes and in colour-blind modes, `selectedBg` is a contrast
change. `selectedBg` is a real `ThemeBg` (`theme/schema.ts:177-178`).

We keep the muted-tab rule too: a tab whose screen `deferred` keeps its place
with `muted: true` so the strip never reflows, and `#stepTab` skips it.

### 1.3 The `TabBarTheme` adapter — closing over OUR `Theme`

`getTabBarTheme()` hardcodes the `theme` singleton (`chrome/shared.ts` imports
`theme` directly), so calling it would ignore the `Theme` instance the mount
hands us. The adapter is the same six callbacks closed over our instance:

```ts
export function tabBarTheme(theme: Theme): TabBarTheme {
	return {
		label: t => theme.bold(theme.fg("accent", t)),                       // chrome/shared.ts:20
		activeTab: t => theme.bold(theme.bg("selectedBg", theme.fg("text", t))), // :21
		inactiveTab: t => theme.fg("muted", t),                              // :22
		mutedTab: t => theme.fg("dim", t),                                   // :23
		hoverTab: t => theme.bg("selectedBg", theme.fg("text", t)),          // :24
		hint: t => theme.fg("dim", t),                                       // :25
	};
}
```

Token-for-token identical to `getTabBarTheme()`; only the receiver differs. All
six are required or optional per `TabBarTheme` (`tab-bar.ts:33-47`). `hoverTab`
is unreachable while `mouseTracking: false` stands, and is supplied anyway so
enabling the mouse later is a one-line change rather than a re-derivation.

This is a *deliberate copy*, and it should be commented as one: the alternative
is a private wrapper around the singleton, which would make the panel render
against a different theme than the host when `theme` is injected.

### 1.4 Keybinding collision — do NOT hand `handleInput` to `TabBar`

`TabBar.handleInput` binds `tab` / `right` → next and `shift+tab` / `left` →
prev (`tab-bar.ts:210-219`). We already bind `left`/`right` for screen switching.

**Recommendation: ignore `TabBar.handleInput` entirely; drive `setActiveById`
ourselves.** Three reasons, in order:

1. **`Tab` must mean "jump between landmarks".** `/settings` spends `Tab` on
   section jumping and only falls through to tab switching when there is
   nothing to jump to (`settings-selector.ts:1915-1921`):

```ts
// Tab toggles keyboard focus between section headings and setting rows
// (fast section hopping); tabs without sections keep Tab switching tabs.
if (matchesKey(data, "tab") || matchesKey(data, "shift+tab")) {
	if (this.#currentList?.hasSectionFocusTargets()) {
		this.#currentList.toggleSectionFocus();
		return;
	}
	this.#tabBar.handleInput(data);
	return;
}
```

Handing `TabBar` the input gives `Tab` to tab switching unconditionally and
takes it away from landmark jumping. That is backwards for a dashboard.
2. **Our `panelAction` cascade already owns the input contract** and is tested.
   `TabBar.handleInput` would be a second, untested key path running beside it.
3. `TabBar.setActiveById(id)` exists for exactly this — external sync. It does
   not fire `onTabChange`, which is what we want, because `panelAction` already
   decided the change and already triggered the reload.

**The user's keys become:**

| key | action |
|---|---|
| SGR wheel | scroll ±2 rows |
| `Esc` / `ctrl+c` / `q` | close, via `done()` exactly once |
| `←` / `shift+tab` | previous selectable screen |
| `→` / `tab` *(when the screen has ≥ 2 bands)* | next screen |
| `tab` *(when the screen has ≤ 1 band)* | next screen — the fallthrough |
| `1`–`9`, `0` | jump to that screen |
| `↑` / `↓` | scroll one row |
| `pgup` / `pgdn` | scroll one viewport |
| `home` / `end` | scroll to top / bottom |
| `r` / `R` | next / previous range, refetch |
| `s` | background ingest |
| anything else | ignored, passes through |

The `tab` fallthrough is decided by `bands.length >= 2`, read from the IR spec,
not by asking the list component. That is the `/settings` rule with the
landmarks coming from the spec instead of from `SettingsList`.

`left`/`right` stay bound to screen switching even though `TabBar` would also
claim them, because we never call `TabBar.handleInput` — the overlap is
documented, not removed.

---

## 2. The body grammar

### 2.1 Band kinds — the IR's union, unchanged

`spec.ts:196-201`:

```ts
export type Band =
	| { kind: "statRow"; stats: readonly StatTile[] }
	| { kind: "chart"; title: string; chart: ChartSpec; source?: string }
	| { kind: "table"; title: string; columns: readonly Column[]; rows: RowSource; source?: string }
	| { kind: "legend"; items: readonly LegendItem[]; source?: string }
	| { kind: "note"; text: string }
	| { kind: "custom"; id: string };
```

**No new kinds.** F21 found exactly four band shapes in the web and they map
onto four of these; `note` and `custom` are the two the web expresses as card
descriptions and per-route special cases. A `rank` band does not exist because
F21 showed ranking is `chart` with `type: "rankedBars"` — the dimension, not the
composition.

### 2.2 `renderBands` — the whole grammar, stated as invariants

```ts
export interface BandRenderOptions {
	width: number;
	rows: number;
	range: Range;
	theme: Theme;
	preset: SymbolPreset;
	glyphs: GlyphSet;
	plan: LayoutPlan;
	data: PanelData;
	colorFor: (index: number) => (text: string) => string;
	/** Resolves a `MetricRef` against `data`. The only place numbers become strings. */
	read: (ref: MetricRef) => BandValue;
}

export function renderBands(bands: readonly Band[], ctx: BandRenderOptions): readonly string[];
```

Six invariants. A renderer that follows them cannot make a layout decision.

- **G1 — a band is a heading line plus body lines.** Heading omitted for
  `statRow` and `note` (see G3), present for `chart`, `table`, `legend`.
- **G2 — the heading line is**
  `` `${icon} ${bold(accent(title))}` `` and, when meta exists,
  `  ${dim(meta)}` appended on **the same line**. No rule, ever.
- **G3 — `statRow` and `note` have no heading and no icon.** They are the page's
  first line and its inline caveats, mirroring F21's `StatGrid` sitting directly
  under `PageHeader` and the web's prose caveats (`CostsRoute.tsx:77`).
- **G4 — exactly one blank line between consecutive bands.** No leading blank,
  no trailing blank, no double blanks. A band that renders nothing contributes
  nothing and does not leave a gap.
- **G5 — no band body may emit a full-width rule.** `─`, `━`, `═` in a band is
  a bug. This is the single invariant that kills the complaint.
- **G6 — the only rule in the whole panel is the `PanelDivider` between body and
  footer**, exactly as `usage-dashboard.ts:573` has exactly one.

`legend` is the one exception to G4 and it is deliberate: in the web, a legend
lives *inside* the chart card, directly beneath it (`OverviewRoute.tsx:181-244`).
So `legend` is a **continuation**: no heading, no blank line before it, one
after. That is how the dashboard actually looks, and a terminal that put a gap
there would be reading the source less carefully than the browser did.

### 2.3 Per-kind layout, fully determined

**`statRow`** — tiles laid out in fixed columns.

```
columns = clamp(floor(innerWidth / TILE_WIDTH), 1, 3)        // TILE_WIDTH = 34
tileWidth = floor(innerWidth / columns)
rows = ceil(tiles.length / columns)
```

Each tile, in order, with these rules applied in sequence and no discretion:

1. `text = label.padEnd(LABEL_WIDTH) + value` (`LABEL_WIDTH` from
   `layout.ts`, currently 12).
2. If the tile has a hint **and** `visibleWidth(text + " " + hint) <= tileWidth`,
   append ` ${dim(hint)}`. **Hints are dropped, never truncated** — a
   half-printed "34,870 unpr" is a worse claim than no hint.
3. If `visibleWidth(text) > tileWidth`, truncate the value with
   `truncateToWidth`. The label is never truncated: a truncated label is still a
   label (`layout.ts:229-234` already argues this).
4. Pad to `tileWidth`; join a row's tiles with two spaces.

`emphasis: "primary"` (`spec.ts:158`) renders its value in **bold accent**; every
other tile's value is `text`. That is the only emphasis the terminal grammar
defines, and it maps to the web's larger first tile.

`spark` (`spec.ts:160`) renders `renderSparkline` on the row below, spanning the
tile's width, and only when `columns <= 2` — a 34-cell sparkline is noise at
three columns.

**`chart`** — heading, then the chart's own rows.

- Icon: `time`. Title: `band.title`.
- Meta: `band.source` when present, else a human label for `chart.axis` — the
  web puts the bucket unit in the card description ("Per hour", "Per UTC day")
  and that is a renderer concern, so the renderer owns it. The web's
  `Segmented` metric toggle has no terminal equivalent and is dropped; the axis
  is stated in the meta instead, which is strictly more honest than a chart that
  silently picks one.
- Body: the chart function's rows verbatim (`renderDailyBars` / `renderHeatmap` /
  `renderSparkline` / `renderRankedBars` / `renderShareBar`), each clamped to
  `innerWidth`. Height from `plan.barHeight`.
- **Zero rows of overhead.** The chart contributes only its marks.

**`table`** — heading, header row, data rows, count note.

- Icon: `requests`. Header row in `dim`, columns aligned per `Column.align`,
  widths from `plan.tableColumns` and `plan.labelWidth` / `plan.valueWidth`.
- At most `rows.limit` data rows. When rows were dropped, a trailing
  `theme.fg("dim", "N of M")` line — the web emits the same (`Table.tsx:155-160`).
- Numeric columns right-aligned; `cell: "meter"` renders `renderRankedBars`' bar
  inline; `cell: "badge"` renders `theme.fg(errorRate > 0 ? "error" : "success", …)`.

**`legend`** — continuation. One row per item:
`${swatch} ${label} ${formatPercent(share)}`, left-aligned in a column sized to
the widest label, shares right-aligned in a fixed 7-cell column so the decimal
points line up. Swatch is `2` cells of `glyph(preset, "barFill")` in
`colorFor(index)` — the web's `Legend` and ours are the same object.

**`note`** — one `theme.fg("dim", text)` line. No icon, no heading. This is where
"This is not a zero", the unpriced caveat, and rollup staleness go. It answers
F21's open question 6 (`Card`'s `footer` prop, used by no route): yes, the port
needs a footer slot, and it is a `note` band at the end of a screen, never a
global footer.

**`custom`** — the escape hatch that makes migration incremental. It calls the
screen's existing `render(ctx)` and treats the result as one band's body. A
screen not yet ported keeps working exactly as it does today, inside the new
grammar. `custom` is **temporary** and its removal is a milestone.

---

## 3. The footer

### 3.1 What we build

`hintsRow` is native-only (F20: `pi-tui/src/native/overlay.ts:42-51` returns a
`NativeNode`), so it is unusable on the ANSI path. `/settings` hand-rolls its
ANSI footer from `editorKey` / `editorKeys` / `formatKeyHint` and joins with
`" · "` (`settings-selector.ts:697-712`). We do the same, but with the one
thing `/settings`'s ANSI footer lacks: **keys and labels in different colours.**

Reuse `rawKeyHint` from `@oh-my-pi/pi-tui/chrome` (re-exported by that barrel via
`./keybinding-hints`; `chrome/keybinding-hints.ts:78`):

```ts
export function rawKeyHint(keys: KeyName | readonly KeyName[], description: string): string {
	return theme.fg("dim", formatKeyHints(keys)) + theme.fg("muted", ` ${description}`);
}
```

**Note the singleton.** `rawKeyHint` reaches the theme singleton the same way
`getTabBarTheme` does. Since our footer is per-frame and cheap, the honest
options are (a) accept it — it is the same singleton the host's own footer uses,
so it cannot disagree — or (b) re-implement two lines to close over our
instance. **Recommendation: (a)**, with a comment; the whole of
`keybinding-hints.ts` is singleton-based and forking it would fork the entire
hint vocabulary.

### 3.2 The hint set

Data, not strings:

```ts
type PanelHint = { keys: readonly KeyName[]; label: string };
type HintMode = "idle" | "scrollable" | "syncing" | "error";
function hintsFor(mode: HintMode, bands: number): PanelHint[];
```

| mode | hints, in order |
|---|---|
| `idle` | `←→ screen`, `r range`, `s sync`, `esc close` |
| `scrollable` | `↑↓ scroll`, `←→ screen`, `r range`, `s sync`, `esc close` |
| `syncing` | `describeSyncProgress(event, …)`, `←→ screen`, `r range`, `esc close` |
| `error` | `s retry sync`, `esc close` |

Rendered as `hints.map(h => rawKeyHint(h.keys, h.label)).join(sep)` where
`sep = theme.fg("borderMuted", " · ")`. The separator is a *border* colour, one
step quieter than either half, so it recedes instead of reading as content.

`mode` is derived, not stored: `error` when `#error !== null`; `syncing` when an
ingest handle is live; `scrollable` when `#maxScroll > 0`; else `idle`. That is
already the shape of our current `#footerLine`, with the scroll hint hoisted to
the front instead of being buried mid-string.

### 3.3 What leaves the footer

The **range moves out of the footer and into the border title**, per F20's
observation that `/settings` keeps the title constant (`"Settings"`) and puts
navigation below it:

- Title: `Stats · 24 hours` — the only always-changing title content, and it is
  the one thing a screenshot must carry.
- Screen name: gone from the title; the tab strip owns it.
- Hints: no state at all. `/usage`'s footer is hints plus a *scroll* hint only
  (`usage-dashboard.ts:915`).

---

## 4. Migration

### 4.1 The seam

**A new module `src/tui/band.ts` exporting `renderBands`. `ScreenContext` is
NOT extended.**

Reasoning: `ScreenContext` (`screens/types.ts:38-49`) is the *data* contract a
screen receives. Band rendering is a *presentation* concern that every screen
shares, and putting it on the context would make every screen able to bypass the
grammar — which is the exact failure being fixed. The grammar must be
unreachable from a screen.

`ScreenContext` therefore changes in exactly one way: it keeps carrying
`theme`, `preset`, `glyphs`, `plan`, `data`, `colorFor`, and the screen stops
calling formatters itself — it returns `Band[]` instead of `string[]`.

**Two return types are in flight, and that is deliberate:**

```ts
// today, screens/types.ts:70
render(ctx: ScreenContext): readonly string[];

// after migration
render(ctx: ScreenContext): readonly Band[];
```

Keep both by adding `renderBands?` as an *optional* member and letting the panel
prefer it:

```ts
const body = screen.renderBands?.(ctx)
	? renderBands(screen.renderBands(ctx), bandOptions(ctx))
	: screen.render(ctx);
```

That one ternary in the panel is the entire compatibility seam, and it is
removable in a single commit once the last screen is ported.

### 4.2 Sequence — each step ships on its own

| # | Step | Ships | Gate |
|---|---|---|---|
| 0 | `src/layout/spec.ts` + `screens.ts` compile | — | **blocked**: `Cannot find module './screens'` today |
| 1 | `src/tui/band.ts`: `renderBands` + `BandValue` + `read(metricRef)` | yes | step 0 |
| 2 | Panel renders the `overview` body through `renderBands`, behind the existing `LOCAL_BODIES` seam | yes | step 1 |
| 3 | Tab strip into the frame; `tabLines.length` enters the frame budget | yes | step 0 |
| 4 | Footer rebuilt from `rawKeyHint`; range moves to the title | yes | step 2 |
| 5 | Port `models`, then `activity`, then `costs` — one commit each | yes | step 4 |
| 6 | Delete `LOCAL_BODIES`, `RULE_WIDTH`, the rule helper, and the `custom` band | yes | step 5 |

Steps 2, 3 and 4 are independent of each other and of step 5; they can land in
any order and each leaves the panel opening and closing correctly. Step 6 is a
pure deletion and is the commit that proves the grammar is now the only path.

**Step 1's tests** are the ones that matter, and they are cheap because
`renderBands` is pure: every band at widths 20/40/80/120 stays within
`innerWidth`; **no rendered line contains `─`** (the G5 invariant, asserted
literally, so a future contributor cannot reintroduce a rule without failing a
test); band order is preserved; a spec with N bands yields exactly N−1 blank
lines (G4).

---

## Frame budget — what changes

Today: `PANEL_CHROME_ROWS = 5` (`topBorder`, header, `PanelDivider`, footer,
`bottomBorder`) and `MIN_PANEL_ROWS = 6`, with `planLayout` granting the body
`rows − 6`.

After: the **tab row replaces the header row**, so chrome is still 5 and
`MIN_PANEL_ROWS` is still 6. What changes is the *body* budget, which must
subtract the live tab row height:

```ts
const tabRows = tabBar.render(innerWidth).length;       // 1, or 2 when it wraps
const plan = planLayout(width, height - tabRows + 1, preset);  // header row traded for tab rows
```

The `+ 1` is the header row the tab row replaces. `/settings` does the same
arithmetic explicitly (`settings-selector.ts:739`):

```ts
// Fixed chrome: top border, tabs, divider, [search row], divider, hint, bottom border.
const fixedRows = 1 + tabLines.length + 1 + (searching ? 1 : 0) + 1 + 1 + 1;
const contentRows = Math.max(7, height - fixedRows - previewLines.length);
```

**Adopt `Math.max(7, …)` too.** Our body currently floors at 1 row
(`layout.ts:209`), which on a short terminal renders a one-line dashboard —
technically not a crash, and useless. `/settings` floors at 7, `/usage` at 5.
Seven is the right floor because the first band is a `statRow` that is 2–4 rows
tall; below that the first thing a user sees is a truncated headline.

---

## Gaps and open decisions

1. **Blocked on the IR.** `src/layout/screens.ts` does not exist;
   `spec.ts:278` fails to resolve. Steps 1 and 3 cannot start. Nothing else
   can.
2. **`ScreenSpec.short` vs `TAB_SHORT`.** The IR already carries a `short` per
   screen (`spec.ts:239`). If it is a word, `TAB_SHORT` supersedes it for the
   strip and the spec's value becomes dead. Decide which one owns it; two tables
   of short labels is a rot bug.
3. **`SCREEN_SPECS` has 9 screens; the registry has 12.** `gain` and the two
   excluded screens have no spec. The strip must not silently drop them — either
   the IR grows three more entries or the strip filters on a rule the registry
   already states.
4. **`legend` has no heading.** That is right for a legend under its chart, but
   a screen whose first band is a `legend` renders an unlabelled block. The IR
   should forbid that ordering, or `renderBands` should emit the previous
   chart's title.
5. **`Segmented` metric toggles have no terminal equivalent** and are dropped
   (F21 calls this "the single most transferable structural fact"). The terminal
   can offer `1`/`2`/`3` for chart metric when a band declares >1 series, but
   that needs a place to render the current choice, and the tab row is full.
   Deferred.
6. **Native path is unspecified here.** Everything above is the ANSI path. If
   the panel ever ships a `describe()`, `TabBar` and `hintsRow` both have native
   implementations already (`tab-bar.ts:163-208`, `native/overlay.ts:42-51`) and
   should be used rather than mirrored.
7. **`tab` fallthrough is decided by `bands.length >= 2`** — a band count, not a
   focus-model query. `/settings` asks `hasSectionFocusTargets()`. Ours is
   cruder but has the same shape, and the band count is knowable at load.