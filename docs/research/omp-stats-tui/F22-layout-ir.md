# F22 — A layout IR, so screens are generated from a spec

**Date: 2026-10-03.** Companion to `src/layout/spec.ts` and `test/layout-ir.test.ts`.

## The problem this file exists to solve

Three hand-written screens shipped: `overview`, `activity`, `models`. Each one
works. Each one passes its own tests. And together they read as **three unrelated
text blocks** rather than as one ported dashboard:

- **Overview** opens with a four-figure stat strip, then a five-row token list,
  then a daily bar chart, then a cost-ranked model list. Four sections, four
  different column grammars.
- **Activity** opens with a calendar heatmap and nothing else above it.
- **Models** opens with a cost-ranked model list — which is roughly what
  Overview's *fourth* section is — and then adds a per-model detail block with
  its own key/value layout.

There is no shared notion of what a section looks like, so consistency is not a
property of the code; it is a thing a reviewer has to notice every time. The
next screen would have invented a fifth grammar. That is not a styling bug. It
is a missing level of abstraction.

## The fix: describe layout as data

`src/layout/spec.ts` is a **declarative intermediate representation** of the web
dashboard's structure. A screen becomes a literal object:

```ts
{
  id: "models",
  label: "Models",
  needs: ["modelDashboard", "rollupStatus"],
  bands: [
    { kind: "statRow", stats: [ /* four tiles */ ] },
    { kind: "chart",  title: "Request share", chart: { type: "shareBar", axis: "share", … } },
    { kind: "legend", items: [ … ] },
    { kind: "table",  title: "All models", columns: [ /* ten columns */ ], rows: { … } },
    { kind: "note",   text: "…" },
  ],
  source: { file: "@oh-my-pi/omp-stats/src/client/routes/ModelsRoute.tsx", lines: "61-214" },
}
```

A renderer — a later task — walks the bands and emits `pi-tui` components. What
that buys, concretely:

| Before | After |
|---|---|
| A new section means editing a `render` | A new section means adding an object to an array |
| Two screens can disagree about what a stat row looks like | They cannot: there is one `statRow` band and one renderer branch for it |
| Consistency is reviewed, not enforced | Consistency is structural |
| Porting is "read the route, remember it in code" | Porting is "read the route, write it down" — and the citation says where to check |

## The type surface

### `MetricSource` — where a number comes from

A closed union of the payload shapes the dashboard reads: `overall`,
`byAgentType`, `timeSeries`, `byModel`, `modelSeries`, `modelPerformanceSeries`,
`costSeries`, `folders`, `recentMessages`, `errorMessages`, `toolsByTool`,
`toolsByToolModel`, `toolsSeries`, `dailyActivity`, `rollupStatus`,
`providerStats`.

`NEED_BY_SOURCE` maps each one to the `DataNeed` that fetches it — or to `null`
for the one source nothing may fetch. That table is the load-bearing piece of the
whole design; §"The valuable test" below is what it buys.

### `MetricRef` — what is shown, never how it reads

```ts
type MetricRef = AggregateRef | SeriesRef | LabelRef | DerivedRef;
```

- **aggregate** — a field on one row: `{ source: "overall", field: "totalCost" }`.
- **series** — a field per row of a grouped series, with the grouping named:
  `{ source: "modelSeries", field: "requests", groupBy: "model" }`.
- **label** — a row's *text* rather than a number. "Most used" shows which model
  won, not how much of it there was; forcing that into a numeric tile would have
  meant either faking a number or special-casing the tile.
- **derived** — a value the host computes rather than stores: a sum across token
  kinds, a share of a total, a distinct count. `derived` nests, so "average
  result per call" is a `share` of a `sum` of a field.

The ref **never says how the value reads**. `"$1,039.27 · 34,870 unpriced"` and
`"112.36"` come from the same `field: "totalCost"`. That separation is what lets
Overview show a cost as a headline and Models show the same cost as a table cell
without either hard-coding the other's formatting choice.

### `Band` — the vertical grammar

Screens are stacks of bands:

| `kind` | Carries | Ported from |
|---|---|---|
| `statRow` | `StatTile[]` — label, metric, optional hint / spark / emphasis / size | `StatGrid` |
| `chart` | title + `ChartSpec` | `Card` wrapping a `Chart` / `TimeChart` / `ShareBar` / `Sparkline` |
| `table` | title + `Column[]` + `RowSource` | `Table` |
| `legend` | `LegendItem[]` | `Legend` |
| `note` | a line of prose | a route's `description` / the panel's own caveats |
| `custom` | an id | the escape hatch for what the IR cannot express |

`note` and `custom` carry **no metrics**, which is why they have no fields. That
is load-bearing: the IR's answer to "this band needs something the grammar does
not have" is `note` for prose and `custom` for structure, never a metric field
that happens to be optional.

`ChartSpec` names a type (`bars` | `sparkline` | `heatmap` | `rankedBars` |
`shareBar`), an **explicit axis**, its series, and the fold policy
(`foldTo: { limit: 6, label: "Other" }`). Stating the axis is what stops a
renderer quietly picking a friendlier one — a token axis on this data would
invert the ranking, and the IR makes that a one-word change rather than a bug
found in review.

`Column.cell` names what sits inside a cell (`text` | `meter` | `sparkline` |
`badge`), because `MeterCell` and the per-row `Sparkline` are structural facts
about the web table, not styling.

### `ScreenSpec`

`{ id, label, short, needs, bands, deferred?, deferredReason?, source }`.

`needs` is the data seam's own `DataNeed` union, imported as a type. The IR
therefore cannot drift from what `fetchFor` knows how to fetch.

## The IR knows nothing about drawing

This is the constraint that makes the IR worth having, so it is asserted rather
than promised. `test/layout-ir.test.ts` checks the **serialised data**:

- no glyphs (`[▀-▟░-▓]`)
- no colours (`var(--…)`, `#rrggbb`)
- no preset names (`"unicode"`, `"nerd"`, `"ascii"`)
- no layout primitives (`width`, `height`, `color`, `glyph`, `padding`, `indent`,
  `preset` keys)

and checks the **import statements**: the only import in the file is
`import type { DataNeed }`. It pulls in nothing from `@oh-my-pi/pi-tui`, nothing
from `src/tui/`, and nothing from `src/tui/charts`. Every import must be
`import type`, because an IR that can execute is an IR that will eventually
contain the rendering it was supposed to describe.

The module's only runtime content is its own data.

## Data, not branches

Two assertions guard this:

- No `switch (spec)` / `switch (screen)` / `if (spec.id …)` in the IR.
- `screenById`-style lookup is a `find` over the frozen array — and the IR does
  not even do that, because it does not need to.

A switch over screen ids is the exact thing that must not exist: it is a second
place that has to learn about a new screen, and the registry is that place. The
`custom` band exists so the answer to "the grammar does not cover this" is data,
not a branch.

## The valuable test

> **every band references a metric its screen's `needs` actually fetch**

This is the test that makes the IR more than documentation. It walks every
metric in every band, follows `derived` to its base source, looks that source up
in `NEED_BY_SOURCE`, and asserts the result is in the screen's `needs`.

It catches the specific failure a hand-written screen cannot catch about
itself: **a screen that draws a band it can never fill.** A band reading
`costSeries` on a screen whose `needs` is `["overview"]` is not a runtime bug —
the data is `undefined`, the cell renders empty, and the reader sees a chart of
nothing with no indication why. The screen passes every test it wrote about
itself. This test fails.

The companion assertion is equally valuable: **every `MetricRef` resolves to a
real field on a real payload**. `test/layout-ir.test.ts` walks each ref's dotted
path against realistic fixtures shaped like the real route responses. `"usage.cost.total"`
existing and `usage.cost.estimates` not existing is the difference between a
column and a blank cell that only shows up in production.

The harness is deliberately dumb — `split(".")`, index, compare — because a
clever resolver would share bugs with the renderer it is supposed to be checking.

## Deferred screens

`providers` is `deferred: true` with `needs: []`, because the only route that
answers it, `/api/stats/provider-windows`, does network I/O on every load and
this panel makes no network call at all. `NEED_BY_SOURCE.providerStats` is
`null`, and exactly one entry in that table is `null` — asserted.

The point is that the IR describes the **web dashboard's structure faithfully**
even where the panel cannot fill it. A renderer can be built against the
providers spec today; when the data seam grows a non-network provider source,
the spec is already right and only the flag changes.

A deferred screen must declare `deferredReason`, longer than twenty characters,
and a screen with no needs *must* be deferred — both asserted, because "no needs"
is otherwise indistinguishable from "unfinished".

## What was ported, from where

Every spec cites its route file and line range. The port is auditable rather
than trusted.

| Screen | Source | Lines |
|---|---|---|
| `overview` | `client/routes/OverviewRoute.tsx` | 63-276 |
| `activity` | `pi-tui/src/overlays/usage-dashboard.ts` | 305-345, 467-476, 824-875 |
| `models` | `client/routes/ModelsRoute.tsx` | 61-214, 88-118, 124-211, 311-433 |
| `costs` | `client/routes/CostsRoute.tsx` | 90-171, 246-280, 323-405 |
| `projects` | `client/routes/ProjectsRoute.tsx` | 78-219, 221-320 |
| `requests` | `client/routes/RequestsRoute.tsx` | 107-205, 219-299 |
| `errors` | `client/routes/ErrorsRoute.tsx` | 123-295, 296-340, 368-421 |
| `tools` | `client/routes/ToolsRoute.tsx` | 74-233, 339-458, 486-560 |
| `providers` | `client/routes/ProvidersRoute.tsx` | 146-310, 311-422 |

**`activity` is the interesting one.** The web dashboard has **no activity route**
— there is nothing to port from. The calendar heatmap lives in omp's own
`/usage` overlay (`pi-tui/src/overlays/usage-dashboard.ts`), fed by the same
local calendar-day points, so that is where the spec comes from, and its citation
says so. A port whose source could not be found would have been invented; this
one is traced.

Two of the web app's interactions are deliberately **not** ported, and both are
recorded rather than dropped silently:

- The Activity card's requests/tokens/cost `Segmented` control (a panel has no
  mode switch) → the default metric is declared, the alternatives are a `note`.
- The Models card's share/requests toggle → recorded as the chart's `foldTo`
  policy and its two series, not as a switch.

The IR also keeps the web app's **band order**, which is the part a redesign
would throw away first. `overview` is asserted to be exactly
`[statRow, statRow, chart, chart, legend, table, note]` because that is the order
`OverviewRoute` renders them in.

## Notes on specific choices

**Tokens are never summed in the IR either.** `conversationTokens` is a named
`derived` op, not a field, so a renderer cannot accidentally read it as a single
stored total. The kinds stay separately addressable, which is what makes a
~95%-cache-read dataset legible.

**`foldTo` is part of the grammar.** `pivotSeries`'s "Other (n)" appears in
Models (limit 6) and Tools (limit 8). Encoding it means the fold policy is one
number in a spec rather than a decision re-made per screen.

**`emphasis: "primary"` instead of a colour.** The IR marks the one tile a
reader should land on. What emphasis looks like is the renderer's problem —
changing it must not mean editing nine screens.

**`initialSort` is in the IR.** A table that lands in whatever order the query
returned is not a port; `initialSort` makes the web route's
`initialSort={{ key: "requests", dir: "desc" }}` a fact about the spec.

**`calendar` is in the IR.** The heatmap's grid shape — week columns, Monday
first, `M T W T F S S` — is structure, not presentation, and it is the same
shape `pi-tui`'s own `/usage` overlay draws. A renderer reuses it rather than
re-deriving it.

## What a renderer will need that is not here yet

Named honestly rather than discovered later:

1. **`custom` band handling.** `providers` uses `{ kind: "custom", id:
   "subscription-windows" }`. A renderer must decide what an unknown custom id
   does — most likely render nothing and say so. Deliberately left undefined
   here, because inventing a behaviour for it in the IR would be the IR
   deciding presentation.
2. **Series pivoting.** A `series` ref with `groupBy` means "pivot this by that
   key, folding past `foldTo.limit`". `pivotSeries` already exists in the host
   package; a renderer calls it rather than re-deriving the fold.
3. **Row sorting and limiting.** `initialSort` and `limit` are declarative;
   applying them is the renderer's job.
4. **`hint` shapes.** A hint is either a `MetricRef` or literal `{ text }`. The
   web routes show both (`{formatInteger(unpricedRequests)} unpriced` and
   `"Pick a wider range"`).
5. **Width behaviour.** Entirely absent, on purpose. What a band does at 40
   columns is a renderer decision driven by `planLayout`, and putting it here
   would make the grammar a layout policy — exactly the failure this file exists
   to prevent.

## Result

`src/layout/spec.ts`: **21 tests, 21 pass**, type-clean. The three main specs in
summary:

- **overview** — 2 stat rows (5 headline tiles + 8 small), an `Activity` bars
  chart on requests/errors, a `Token mix` share bar, a 7-item legend, the
  `Latest requests` table (7 columns, 12 rows), and a note recording the
  un-ported metric switch.
- **activity** — a 2-tile totals row, the Monday-first calendar heatmap over
  per-day cost with a `note` recording the sqrt-compressed max-anchored scaling
  and its request-count fallback.
- **models** — 4 stat tiles, the `Request share` chart folding at 6, a legend,
  the `All models` table (10 columns including a `meter` Requests cell and a
  per-row `sparkline` Trend, limited to 25, sorted by requests desc), and a note
  that per-tool/per-model figures are shares rather than measurements.
