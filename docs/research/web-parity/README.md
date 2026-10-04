# Web parity — the durable reference

The terminal panel at `/stats-tui` is a port of a **web dashboard that is not in this repository**. It lives at
`http://127.0.0.1:3847/` inside a globally-installed package
(`~/.bun/install/global/node_modules/@oh-my-pi/omp-stats/src/client/`), and it is **lost the moment that server
stops**. Everything downstream of it — the layout IR in `src/layout/spec.ts`, the renderers, the tests — was
re-derived from those files by reading them again on every task.

**This directory exists so that re-derivation stops.** It is the reference the port is measured against: the design
tokens, the layout grammar, and one document per screen per width, each carrying concrete `file:line` citations
into the web source and the measured geometry of the live page.

**Nothing here describes what the terminal currently does.** These documents describe the **web**, as ground truth
for what the terminal should become.

---

## The target look, in one paragraph

A pure-black chassis (`--bg #000`) holding one inset panel of `--panel #09090a` with a `--r-panel 16px` radius, a
fixed 52px glass topbar and a fixed 204px sidebar; inside it a `--card #0e0e10` surface whose only edge is a
single 1px top-lit hairline gradient from `rgba(255,255,255,0.14)` to `rgba(255,255,255,0.06)`. Down the page: a
**22px @ weight-600** title with a 13.5px `ink-2` description; then **stat grids** — 24px `tabular-nums` values in
`ink-1` over 12.5px `ink-2` labels over a 12px `ink-3` foot, 28px sparklines, tiles separated by 1px hairlines and
not by boxes; then **cards** — 14px @ 550 titles in `ink-2`-coloured 12.5px descriptions, `14px 16px 16px` bodies,
`flush` bodies when the card holds a table; then **tables** whose 12px @ 500 `ink-3` headers are *smaller and
dimmer* than their 13px `ink-1` bodies, numbers right-aligned in mono, hairline row rules, and 64×4px meters and
96×22px sparklines sitting **inside** cells; and **charts** — cyan for ordinary series, **pink (`--chart-secondary`)
for anything that is money**, red (`--bad`) for anything that is an error, stacked by default, with a 12px `ink-2`
legend *below* the chart and 8×8px square swatches. One accent gradient (`--accent-a` cyan → `--accent-b` pink)
reserved for hero marks. No colour is used for decoration: hue means *category* or *severity*, never emphasis.

---

## How this directory was produced

**Source of truth:** `~/.bun/install/global/node_modules/@oh-my-pi/omp-stats/src/client/` — 13,625 lines across
`routes/*.tsx`, `ui/*.tsx`, `charts/*.tsx`, `app/*.tsx` and `styles.css` (1834 lines).

Three passes, in order:

1. **Read the source.** Every `--*` custom property, every layout rule, every component's DOM structure, and every
   route's JSX was read with line numbers preserved.
2. **Ran the app.** Headless Chrome (via `puppeteer-core`, `/Applications/Google Chrome.app`) drove the live
   server: 9 screens × 4 viewport widths → **36 full-page PNGs** in `screens/`.
3. **Measured the DOM.** `getComputedStyle` + `getBoundingClientRect` on the live page gave computed values for the
   stat grid, table, card, meter, legend, chart and shell at each width — **not** inferred from the CSS. Every number
   marked **[measured]** in `layout-rules.md` came from this pass.

**Routing.** The app uses **hash routing with no basename** — `App.tsx:30` calls `useHashRoute`, and
`data/useHashRoute.ts:13-25` parses `#/<section>?range=<range>`. The path form is
`http://127.0.0.1:3847/#/<section>?range=<range>`, where `<section>` ∈ `overview | models | providers | costs |
requests | errors | traces | tools | frustration | projects | gain` (`app/nav.ts:16-27`) and `<range>` ∈
`1h | 24h | 7d | 30d | 90d | all` (`data/range.ts:37`). There is no react-router; the server serves one
`index.html` at `/`.

**Width mapping.** The terminal's four breakpoints are 150 / 100 / 60 / 40 columns. For capture they were mapped
to viewports as:

| Terminal columns | Viewport px | What that triggers in the web |
|---|---|---|
| 150 | **1200px** | above both breakpoints: `--sidebar-w 204px`, `--gutter 22px`, `.grid-main-side` = 2fr : 1fr |
| 100 | **800px** | below the 1100px grid collapse; above 900px so the sidebar is still docked |
| 60 | **480px** | below 900px: sidebar becomes a 260px off-canvas overlay, `--gutter 16px` |
| 40 | **320px** | same as 60; both stat grids collapse to one column |

---

## Capture status

**Server reachability: CONFIRMED.** `GET http://127.0.0.1:3847/` returns `200`, `content-type: text/html`,
779 bytes. The app renders (`<title>omp stats</title>`, 35,355 bytes of DOM, dark theme, `#root` populated).
**Screenshot tool: AVAILABLE** — Google Chrome 359.1K at
`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, driven by `puppeteer-core` from the repo's
`node_modules`. All 36 captures below are **live**.

### Live captures — 36 of 40 documents

| Screen | 150 (1200px) | 100 (800px) | 60 (480px) | 40 (320px) | Range |
|---|---|---|---|---|---|
| `overview` | ✅ `screens/overview-150.png` | ✅ | ✅ | ✅ | `24h` |
| `models` | ✅ `screens/models-150.png` | ✅ | ✅ | ✅ | `24h` |
| `costs` | ✅ `screens/costs-150.png` | ✅ | ✅ | ✅ | `24h` |
| `projects` | ✅ `screens/projects-150.png` | ✅ | ✅ | ✅ | `24h` |
| `requests` | ✅ `screens/requests-150.png` | ✅ | ✅ | ✅ | `24h` |
| `errors` | ✅ `screens/errors-150.png` | ✅ | ✅ | ✅ | `24h` |
| `tools` | ✅ `screens/tools-150.png` | ✅ | ✅ | ✅ | `24h` |
| `providers` | ✅ `screens/providers-150.png` | ✅ | ✅ | ✅ | `24h` |
| `gain` | ✅ `screens/gain-150.png` | ✅ | ✅ | ✅ | **`all`** ⚠️ |

⚠️ **Gain required `range=all`.** At `range=24h` the Gain screen renders its `EmptyState` and **no data at all** —
confirmed live: the DOM contains only `section.card > div.card-body > div.empty`. Gain data comes from
**snapcompact**, which only records once tool output has been compacted, so short windows are legitimately empty.
All four Gain captures were re-taken at `range=all`. The empty state itself is documented in `gain-150.md`.

### Source-derived — 4 documents, and why

| Screen | Status | Reason |
|---|---|---|
| `activity` (all four widths) | **SOURCE-DERIVED — capture impossible** | **The web dashboard has no Activity screen.** |

The web's eleven routes are listed in `app/nav.ts:16-27` and `app/nav.ts:43-70`; none renders a calendar. The
Activity screen is ported from **omp's own `/usage` overlay**
(`@oh-my-pi/pi-tui/src/overlays/usage-dashboard.ts`), a terminal-native panel — the IR states this in its own words
at `src/layout/spec.ts:474-478`. There is no URL to visit, so no screenshot can exist. The four Activity documents
cite the overlay source with `file:line` throughout and state their source-derived status at the top of each file.

### Capture facts worth knowing

- **`errors`, `requests`, `providers` also contain routes the IR excludes.** `traces` and `frustration` were not
  captured: neither appears in `SCREEN_SPECS`, so neither is in scope for this port.
- **`providers` shows 4 cards in the web and the IR ports 3.** The Subscription-windows and Window-utilization
  cards read `provider-windows`, a network-only payload the panel never fetches (`spec.ts:1162`). They are
  documented in `providers-150.md` for completeness and marked out of scope.
- **`gain` at 24h shows an empty state, not a zeroed screen.** `Reduction` is `"–"` rather than `0.0%` because
  snapcompact never records an original size (`spec.ts:1310-1313`).

---

## Reading order for a new implementer

**If you are porting one screen, read in this order:**

1. **`layout-rules.md`** — the grammar. Every component's DOM outline first, then its numbers. If you take only the
   outlines and lose every number, you still have the web.
2. **`css-tokens.md`** — the palette and the four breakpoints. Establishes what "one surface step", "four hairline
   weights" and "value / label / foot" mean numerically.
3. **`<screen>-150.md`** — that screen in full: header, section order, every card, every column, every formatter
   call verbatim.
4. **`<screen>-100.md` → `-60.md` → `-40.md`** — what changes. Each carries its own measured delta table plus the
   full column/format tables, so it stands alone.
5. **`README.md` § Capture status** — whether to trust a screenshot or a source derivation for that screen.

**If you are changing the shared grammar**, read `layout-rules.md` § 9 (grid containers) and § 10 (`.row` /
`.stack`) first, then `css-tokens.md` § 9 (spacing literals), then any screen document — the grid question
("is this two-up or one-up at this width?") is answered identically in all 40.

**If you are auditing the port**, compare each `Column` in `src/layout/spec.ts` against the route's own column
array. Three divergences are already recorded and unresolved — see below.

---

## Files in this directory

| File | Contents |
|---|---|
| `README.md` | this file |
| `css-tokens.md` | every `--*` declaration grouped by role, with values, `file:line`, terminal equivalents, and the 4 `@media` breakpoints |
| `layout-rules.md` | DOM outlines + measured numbers for Shell, PageHeader, Card, StatGrid/Stat, Table, MeterCell, LabelCell, States, Chart, ShareBar, BarList, Legend, grid containers |
| `overview-{150,100,60,40}.md` | Overview |
| `activity-{150,100,60,40}.md` | Activity — **source-derived from omp's `/usage` overlay, no web capture possible** |
| `models-{150,100,60,40}.md` | Models |
| `costs-{150,100,60,40}.md` | Costs |
| `projects-{150,100,60,40}.md` | Projects |
| `requests-{150,100,60,40}.md` | Requests |
| `errors-{150,100,60,40}.md` | Errors |
| `tools-{150,100,60,40}.md` | Tools |
| `providers-{150,100,60,40}.md` | Providers |
| `gain-{150,100,60,40}.md` | Gain |
| `screens/*.png` | 36 live full-page captures, `<screen>-<cols>.png` at 2× device scale |

---

## Divergences found between the IR and the web — recorded, not reconciled

These are places where `src/layout/spec.ts` and the web source disagree. Each is documented in the relevant
screen file with citations on both sides. **They are reported here because an audit should not rediscover them.**

| # | Screen | Divergence | Web | IR |
|---|---|---|---|---|
| 1 | **projects** | Both "Top by cost" / "Top by requests" charts are typed `shareBar`, but the route renders **`BarList`** — 30px ranked rows with the bar *behind* the label, not one 8px bar | `ProjectsRoute.tsx:127`, `:148` | `spec.ts:770`, `:786` |
| 2 | **providers** | The IR's column **order** is Provider, Requests, Tokens, Cost, Share, Error rate, Models, Tokens/s, Premium. The web's is Provider, Requests, **Error rate, Models**, Tokens, Share, **Cost**, Tokens/s, Premium | `ProvidersRoute.tsx:311-415` | `spec.ts:1215-1249` |
| 3 | **providers** | The IR's band order is StatGrid → Burn by provider → Provider totals. The web renders **Provider totals before Burn by provider** | `ProvidersRoute.tsx:190`, `:206` | `spec.ts:1164-1251` |
| 4 | **requests** | The IR declares `Status` as `align: "right"`; the route has no `align` key, so it is **left** (a `LabelCell` with a `Dot`) | `RequestsRoute.tsx:296` | `spec.ts:893` |
| 5 | **errors** | The IR records the By-model chart as `foldTo {limit: 12, label: "Other"}`; the route does `.slice(0, 12)` and **drops the tail with no `Other` row** | `ErrorsRoute.tsx:211` | `spec.ts:970` |
| 6 | **providers** | The IR declares no `foldTo` for the burn chart, but `TOP_PROVIDERS = 6` means up to **7** series render including `Other` | `ProvidersRoute.tsx:61`, `:115-116` | `spec.ts:1191-1205` |

---

## Conventions used in these documents

- **`styles.css:NNN`** — a line in the web's stylesheet.
- **`Route.tsx:NNN`** — a line in a web route/component file, named in full at first use per document.
- **`[measured]`** — a value read from the live DOM with `getComputedStyle` / `getBoundingClientRect`, not
  inferred from CSS. Both values are given where they could differ.
- **`formatCompact` / `formatInteger`** — the two formatters this port keeps getting wrong. Every screen document
  has a table saying which is which, per column.
- **`–`** — U+2013 EN DASH, the web's universal "no value" glyph (`formatters.ts:67`, and every stat fallback).
  Never `0`, never `-`.
