# F5 — Extension resolution + overlay mount probe (empirical)

All commands run on macOS darwin arm64, `omp v18.4.10` (`~/.bun/bin/omp` ->
`~/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/dist/cli.js`,
a plain bun script — **not** a `--compile` binary).

The "real extension loader" was exercised via `omp models`, which calls
`discoverAndLoadExtensions(...)` and writes every load error to stderr
(`pi-coding-agent/src/cli/models-cli.ts:333-354`). `omp --help` does NOT load
extensions. `omp -p "hi"` does, but makes a live LLM call. `omp models` is the
correct non-interactive probe. `omp -e <file> models` also works, and
`-e` must come **after** the subcommand (`omp models -e <file>`); `omp -e <file>
models` silently ignores the extension.

---

# Angle

Can an `omp` extension under `~/.omp/agent/extensions/` import `@oh-my-pi/omp-stats/*`,
and can a fullscreen overlay mount? Verified by real execution, not inspection.

---

# Claims

## C1 — Baseline: what the two working extensions import

`~/.omp/agent/extensions/rtk.ts` (2.6K, 2mo ago):

```ts
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent"
```
…`export default async function (pi: ExtensionAPI) { ... pi.exec(...); pi.on("tool_call", handler) }`
Version-gates itself at load time via `pi.exec("rtk", ["--version"])` and `return`s early
if the binary is missing/old — i.e. it is written to survive a hostile environment.

`~/.omp/agent/extensions/herdr-omp-agent-state.ts` (12.1K, 2w ago):

```ts
import net from "node:net";
import path from "node:path";
```
…`// @ts-nocheck`, `export default function (pi) { ... }`. It imports **only node builtins**,
no `@oh-my-pi/*` at all.

**Ground truth:** the only `@oh-my-pi/*` import either file uses is a
`import type` from `@oh-my-pi/pi-coding-agent`. Neither file imports `pi-tui`.
Neither is evidence that `omp-stats` is reachable.

## C2 — Bare `bun run` from /tmp is NOT the loader environment, and it is misleading

```
$ cd /tmp/ompext-probe && bun run probe.ts
FAIL  @oh-my-pi/pi-tui  Failed to load pi_natives native addon for darwin-arm64.
FAIL  @oh-my-pi/pi-coding-agent  Failed to load pi_natives native addon for darwin-arm64.
FAIL  @oh-my-pi/omp-stats  Failed to load pi_natives native addon for darwin-arm64.
FAIL  @oh-my-pi/omp-stats/server  Failed to load pi_natives native addon for darwin-arm64.
FAIL  @oh-my-pi/omp-stats/aggregator  Failed to load pi_natives native addon for darwin-arm64.
FAIL  @oh-my-pi/omp-stats/rollup  Failed to load pi_natives native addon for darwin-arm64.
FAIL  @oh-my-pi/omp-stats/db  Failed to load pi_natives native addon for darwin-arm64.
OK    bun:sqlite keys=6
```

Every `@oh-my-pi/*` fails **identically**, including ones the loader serves fine.
So this probe is worthless as a resolution oracle. `Bun.resolveSync` shows why —
resolution actually **succeeds**, it is *evaluation* that dies:

```
$ bun run r.ts
RESOLVED @oh-my-pi/pi-tui -> /Users/yuzu/.bun/install/cache/@oh-my-pi/pi-tui@18.4.10@@@1/src/index.ts
RESOLVED @oh-my-pi/omp-stats -> /Users/yuzu/.bun/install/cache/@oh-my-pi/omp-stats@18.4.10@@@1/src/index.ts
RESOLVED @oh-my-pi/omp-stats/server -> /Users/yuzu/.bun/install/cache/@oh-my-pi/omp-stats@18.4.10@@@1/src/server.ts
RESOLVED @oh-my-pi/omp-stats/aggregator -> /Users/yuzu/.bun/install/cache/@oh-my-pi/omp-stats@18.4.10@@@1/src/aggregator.ts
UNRESOLVED @oh-my-pi/nonexistent-pkg :: Cannot find package '@oh-my-pi/nonexistent-pkg' imported from /private/tmp/ompext-probe
RESOLVED react -> /Users/yuzu/.bun/install/cache/react@19.3.0@@@1/index.js
```

Full bare-bun error:

```
Error: Failed to load pi_natives native addon for darwin-arm64.

Tried:
- /Users/yuzu/.bun/install/cache/@oh-my-pi/pi-natives@18.4.10@@@1/native/pi_natives.darwin-arm64.node: Cannot find module '/Users/yuzu/.bun/install/cache/@oh-my-pi/pi-natives@18.4.10@@@1/native/pi_natives.darwin-arm64.node'
Require stack:
- /Users/yuzu/.bun/install/cache/@oh-my-pi/pi-natives@18.4.10@@@1/native/loader-state.js
- /Users/yuzu/.bun/bin/pi_natives.darwin-arm64.node: Cannot find module '/Users/yuzu/.bun/bin/pi_natives.darwin-arm64.node'
```

Root cause of the noise: the `.node` addon is shipped in a **sibling** package.

```
$ ls ~/.bun/install/global/node_modules/@oh-my-pi/pi-natives/native/*.node
ls: ... No such file or directory
$ ls ~/.bun/install/global/node_modules/@oh-my-pi/pi-natives-darwin-arm64/
pi_natives.darwin-arm64.node  166.9M
$ ls ~/.bun/install/cache/@oh-my-pi/pi-natives@18.4.10@@@1/native/*.node
ls: ... No such file or directory
```

`~/.bun/install/cache/` entries are flattened per-package; the sibling
`pi-natives-darwin-arm64` package is not next to them, so the require fails.
The **global `node_modules/@oh-my-pi/`** tree has the sibling and works.

## C3 — In the real loader: static `@oh-my-pi/pi-*` imports resolve fine

`~/.omp/agent/extensions/zz-probe-resolve.ts` (temporary):

```ts
import * as TUI from "@oh-my-pi/pi-tui"
import * as PCA from "@oh-my-pi/pi-coding-agent"
export default async function (pi: any) {
  console.error(`[zzprobe] STATIC-IMPORT-OK tui=${Object.keys(TUI).length} pca=${Object.keys(PCA).length}`)
  for (const s of SPECS) { try { const m = await import(s); ... } catch (e) { ... } }
}
```

```
$ cd /tmp && timeout 90 omp models 2>&1 | grep -i zzprobe
[zzprobe] STATIC-IMPORT-OK tui=359 pca=698
[zzprobe] FAIL  @oh-my-pi/pi-tui :: Failed to load pi_natives native addon for darwin-arm64.
[zzprobe] FAIL  @oh-my-pi/pi-coding-agent :: Failed to load pi_natives native addon for darwin-arm64.
[zzprobe] FAIL  @oh-my-pi/omp-stats :: Failed to load pi_natives native addon for darwin-arm64.
[zzprobe] FAIL  @oh-my-pi/omp-stats/server :: Failed to load pi_natives native addon for darwin-arm64.
[zzprobe] FAIL  @oh-my-pi/omp-stats/aggregator :: Failed to load pi_natives native addon for darwin-arm64.
[zzprobe] FAIL  @oh-my-pi/omp-stats/rollup :: Failed to load pi_natives native addon for darwin-arm64.
[zzprobe] FAIL  @oh-my-pi/omp-stats/db :: Failed to load pi_natives native addon for darwin-arm64.
[zzprobe] OK    bun:sqlite keys=6
```

Two separate facts here:

1. **Static** `import` of `pi-tui` / `pi-coding-agent` works (359 / 698 named exports).
2. **Dynamic** `import()` of *any* `@oh-my-pi/*` — even the ones that statically work —
   fails in the loader. The loader's `Bun.plugin` resolve hook rewrites the specifier to a
   `omp-legacy-pi-bundled:` virtual module, and the dynamic path re-enters resolution in a
   way that ends up at the flat cache copy. **Never use dynamic `import()` for `@oh-my-pi/*`
   in an extension; use static imports only.**

## C4 — THE decisive test: static `import { handleApi } from "@oh-my-pi/omp-stats/server"`

```
$ cd /tmp && timeout 90 omp models 2>&1 | grep -i "zzprobe\|Failed to load extension\|omp-stats"
Failed to load extension: /Users/yuzu/.omp/agent/extensions/zz-probe-resolve.ts: Failed to load extension: Failed to load pi_natives native addon for darwin-arm64.

Tried:
- /Users/yuzu/.bun/install/cache/@oh-my-pi/pi-natives@18.4.10@@@1/native/pi_natives.darwin-arm64.node: Cannot find module '/Users/yuzu/.bun/install/cache/@oh-my-pi/pi-natives@18.4.10@@@1/native/pi_natives.darwin-arm64.node'
Require stack:
- /Users/yuzu/.bun/install/cache/@oh-my-pi/pi-natives@18.4.10@@@1/native/loader-state.js
- /Users/yuzu/.bun/bin/pi_natives.darwin-arm64.node: Cannot find module '/Users/yuzu/.bun/bin/pi_natives.darwin-arm64.node'
Require stack:
- /Users/yuzu/.bun/install/cache/@oh-my-pi/pi-natives@18.4.10@@@1/native/loader-state.js

If installed via npm/bun, try reinstalling: bun install @oh-my-pi/pi-natives
If developing locally, build with: bun --cwd=packages/natives run build
```

**ANSWER: it does NOT load.** It throws a structured load error rendered as
`Failed to load extension: <path>: Failed to load extension: <message>`.

Important correction to the task's stated expectation: this is **not** an
allowlist rejection. `@oh-my-pi/omp-stats` is genuinely not in `PI_PACKAGE_NAMES`
(`legacy-pi-compat.ts:806-814`: `pi-agent-core, pi-ai, pi-catalog, pi-coding-agent,
pi-natives, pi-tui, pi-utils`), so the `LEGACY_PI_SPECIFIER_FILTER` shim declines it —
but the specifier is still found by the generic bare-dependency resolver, which walks
up from the extension's directory and lands on `~/.bun/install/cache/…`. That cache
copy is the flat, sibling-less one, and it dies on `pi_natives`. Same for every
omp-stats subpath (`/server`, `/aggregator`, `/rollup`, `/db`).

So: **allowlist miss → wrong resolution root → missing native addon.**

## C5 — Workaround (a): absolute filesystem path — WORKS, both static and dynamic

```ts
// static
import { handleApi } from "/Users/yuzu/.bun/install/global/node_modules/@oh-my-pi/omp-stats/src/server.ts"
export default function (pi: any) { console.error(`[zzprobe] STATIC-ABS-OK handleApi=${typeof handleApi}`) }
```
```
[zzprobe] STATIC-ABS-OK handleApi=function
```

```ts
// dynamic
const P = "/Users/yuzu/.bun/install/global/node_modules/@oh-my-pi/omp-stats/src/server.ts"
const m = await import(P)
```
```
[zzprobe] ABS-OK keys=3 handleApi=function
```

The source-rewrite hook **accepts** an absolute filesystem path unchanged.
`src/server.ts` exports exactly **3** names, one of which is `handleApi: function`.

## C6 — Relative path from the extension file — also WORKS

```ts
import { handleApi } from "../../../.bun/install/global/node_modules/@oh-my-pi/omp-stats/src/server.ts"
```
```
[zzrel] OK handleApi=function
```

(`~/.omp/agent/extensions/x.ts` → `../../..` = `/Users/yuzu`.)

## C7 — Workaround (b): computing the path at runtime + dynamic `import()` — WORKS

Same as C5-dynamic: `await import("/abs/path/.../src/server.ts")` → `handleApi=function`.
(Works because the target is a filesystem path, not a `@oh-my-pi/*` specifier — contrast C3.)

## C8 — Workaround (c): `bun install` in a plugin dir — WORKS

Simulated in `/tmp` (nothing written under `~/.omp/plugins/`):

```
$ mkdir -p /tmp/ompext-probe/plug && cd /tmp/ompext-probe/plug
$ printf '{"name":"zzplug","type":"module","dependencies":{"@oh-my-pi/omp-stats":"18.4.10"}}' > package.json
$ bun install
+ @oh-my-pi/omp-stats@18.4.10
12 packages installed [168.00ms]
$ ls node_modules/@oh-my-pi/
omp-stats omptype pi-ai pi-catalog pi-natives pi-natives-darwin-arm64 pi-utils pi-wire
```
```ts
// /tmp/ompext-probe/plug/zz-plug.ts
import { handleApi } from "@oh-my-pi/omp-stats/server"
export default function (pi: any) { console.error(`[zzplug] OK handleApi=${typeof handleApi}`) }
```
```
$ cd /tmp && timeout 120 omp models -e /tmp/ompext-probe/plug/zz-plug.ts 2>&1 | grep -i zzplug
[zzplug] OK handleApi=function
```

A local `node_modules` **with a complete dep tree** (including
`pi-natives-darwin-arm64`) makes the bare specifier work. The bare-specifier
walk finds it before ever reaching the flat cache. 168 ms install.

## C9 — Workaround (d): NO omp-stats import at all; `bun:sqlite` direct — WORKS

`bun:sqlite` is a Bun builtin, so it is immune to the whole resolver.

```ts
import { Database } from "bun:sqlite"
const db = new Database("/Users/yuzu/.omp/stats.db", { readonly: true })
db.query("SELECT COUNT(*) AS c FROM message_rollup").get()
db.query("SELECT model, COUNT(*) AS c, SUM(input_tokens) AS ti, SUM(output_tokens) AS ot FROM message_rollup GROUP BY model ORDER BY c DESC LIMIT 5").all()
```
```
$ cd /tmp && timeout 90 omp models 2>&1 | grep -i zzprobe
[zzprobe] SQLITE open=0.1ms count=1907 q1=0.3ms q2=8.8ms rows=5
[zzprobe] SQLITE sample={"model":"deepseek-v4-flash","c":252,"ti":91573883,"ot":23453277}
```

**Timings on the real 305 MB DB:** open **0.1 ms** (readonly, no WAL replay),
`COUNT(*)` over `message_rollup` **0.3 ms**, 5-row GROUP BY over 1907 rows **8.8 ms**.
That is comfortably inside a keystroke budget for an interactive overlay panel.

Gotcha found the hard way: `to` is a reserved word in this SQLite build — aliasing
output tokens as `to` gives `near "to": syntax error`. Use `ot`.

Readonly really is readonly:

```
$ stat -f "%m %z" ~/.omp/stats.db
1790947527 319889408
$ bun -e '...new Database("/Users/yuzu/.omp/stats.db",{readonly:true})...'
{ c: 1907 }
$ stat -f "%m %z" ~/.omp/stats.db
1790947527 319889408
```
mtime and size byte-identical before/after.

## C10 — Overlay extension loads cleanly

`~/.omp/agent/extensions/zz-probe-overlay.ts` (temporary) registering `/zzprobe`
with `ctx.ui.custom(factory, { overlay: true, overlayOptions: { fullscreen: true,
width: "100%", maxHeight: "100%", margin: 0 } })` and a module-level
`import { Table, KeyValueList, Text, ScrollView, SelectList, MetricRow, Section, Spacer } from "@oh-my-pi/pi-tui"`:

```
$ cd /tmp && timeout 90 omp models 2>&1 | grep -i "zzprobe-overlay\|Failed to load"
[zzprobe-overlay] MODULE-IMPORTS-OK Table=function KeyValueList=function Text=function ScrollView=function SelectList=function MetricRow=function Section=function Spacer=function
```

**No load error.** `fullscreen` is a real `OverlayOptions` field
(`pi-tui/src/tui.ts:468`), alongside `width`/`minWidth`/`maxHeight`/`anchor`/
`offsetX`/`offsetY`/`row`/`col`/`margin` (`tui.ts:424-470`). `margin: 0` is valid
(`OverlayMargin | number`).

## C11 — Components construct and render inside the loader process

Run from the extension factory body (so the code executes in the real host
process, under the real loader-installed module graph):

```
[zz] OK Text [" hi                                     "]
[zz] OK MetricRow ["1                                       "]
[zz] FAIL Table :: undefined is not an object (evaluating 'e.replaceAll')
[zz] OK KeyValueList ["a     b"]
[zz] OK ScrollView ["a","","","",""]

[zz] OK Table cellObjects+colStyle ["deepsee…   91,573,883"]
[zz] FAIL Table rawStrings (expected FAIL) :: undefined is not an object (evaluating 'e.replaceAll')
```

Stack for the Table failure:

```
TypeError: undefined is not an object (evaluating 'e.replaceAll')
    at we (/Users/yuzu/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/dist/cli.js:281:12172)
    ...
    at render (.../dist/cli.js:1888:7977)
    at zz_probe_resolve_default (/Users/yuzu/.omp/agent/extensions/zz-probe-resolve.ts?mtime=...:4:161)
```

**Root cause is mine, not pi-tui's.** `Table` cells must be
`TableCell` objects (`{ text, style? }`). `alignCell` does
`singleLine(cell.text)`; given the raw strings `["a","b"]`, `cell.text` is
`undefined` and `undefined.replaceAll` throws. With `{text}` objects it renders
correctly, including column-level `style` and right-alignment. Copying the
`rtk.ts` habit of defensively wrapping load-time work (`try/catch` + `console.warn`)
around any table construction is still cheap insurance.

Also noted: importing the `theme` binding at module scope **throws at extension
load time** in this process — `undefined is not an object (evaluating
'e.replaceAll')` — because theme init has not run in the `omp models` process.
`getTheme` is not an export at all (`Export named 'getTheme' not found in module
'omp-legacy-pi-bundled:@oh-my-pi/pi-tui'`). Use the `theme` passed to the
`ctx.ui.custom` factory `(tui, theme, keybindings, done) => ...`; do **not** import it.

---

# Resolution matrix

| specifier | bare bun (from /tmp) | omp extension loader (`~/.omp/agent/extensions/`) | workaround |
|---|---|---|---|
| `@oh-my-pi/pi-tui` (static) | fails (pi_natives) | **resolves** — 359 exports | none needed |
| `@oh-my-pi/pi-tui` (dynamic `import()`) | fails | **FAILS** — use static only | static import |
| `@oh-my-pi/pi-coding-agent` (static) | fails (pi_natives) | **resolves** — 698 exports | none needed |
| `@oh-my-pi/pi-coding-agent` (dynamic) | fails | **FAILS** | static import |
| `@oh-my-pi/omp-stats` | fails (pi_natives) | **FAILS** | (a)(b)(c)(d) |
| `@oh-my-pi/omp-stats/server` | fails (pi_natives) | **FAILS** | (a)(b)(c)(d) |
| `@oh-my-pi/omp-stats/aggregator` | fails (pi_natives) | **FAILS** | (a)(b)(c)(d) |
| `@oh-my-pi/omp-stats/rollup` | fails (pi_natives) | **FAILS** | (a)(b)(c)(d) |
| `@oh-my-pi/omp-stats/db` | fails (pi_natives) | **FAILS** | (a)(b)(c)(d) |
| `bun:sqlite` | **OK** | **OK** | none needed |
| absolute path `…/@oh-my-pi/omp-stats/src/server.ts` (static) | — | **resolves**, `handleApi=function` | **use this** |
| absolute path (dynamic) | — | **resolves**, `handleApi=function` | works |
| relative path from ext dir | — | **resolves**, `handleApi=function` | works |
| bare spec w/ local `node_modules` tree (incl. `pi-natives-darwin-arm64`) | — | **resolves**, `handleApi=function` | 168 ms install |

**Recommended:** (d) — skip `omp-stats` entirely, open `~/.omp/stats.db` with
`bun:sqlite` in `readonly` mode and write the SQL. Zero resolution risk, zero
install, 0.1 ms open, sub-ms typical queries. (a) absolute-path import is the
fallback if `handleApi` is genuinely needed.

---

# Available pi-tui exports

Full `Object.keys(m).sort()` from the host package — **359** exports.
Command:

```
$ cd ~/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent
$ bun -e 'import("@oh-my-pi/pi-tui").then(m=>console.log(Object.keys(m).sort().join("\n")))'
```

### The names in the task brief are WRONG in two places

- There is **no `ScrollViewport`**. The real name is **`ScrollView`**.
- There is **no `Metric`**. The real name is **`MetricRow`**.

### Components relevant to a numeric panel (exact signatures)

```ts
// components/text.ts:48
class Text implements Component {
  constructor(text: string = "", paddingX: number = 1, paddingY: number = 1,
              customBgFn?: (text: string) => string)
  setStyleFn(fn?: (text: string) => string): this   // returns this
  setIgnoreTight(ignore: boolean): this
}

// components/metric.ts:93  — the "KPI strip" primitive
interface MetricSpec {
  readonly value: string | undefined;   // undefined OMITS the metric
  readonly leading?: string;           // icon/label before the value
  readonly separator?: string;         // default " "
  readonly priority?: number;          // higher survives first on `drop` overflow
  readonly style?: (text: string) => string;
}
type MetricOverflow = "allow" | "drop" | "truncate" | "wrap";
interface MetricRowOptions {
  readonly separator?: string; readonly overflow?: MetricOverflow;
  readonly maxWidth?: number; readonly paddingX?: number;
  readonly paddingY?: number; readonly style?: (text: string) => string;
}
class MetricRow implements Component {
  constructor(metrics: readonly MetricSpec[], options: MetricRowOptions = {})
  setMetrics(metrics): boolean
}
// free functions: formatMetric(spec): string|undefined, formatMetricRow(metrics, opts): string

// components/table.ts:101
interface TableCell   { readonly text: string; readonly style?: (text: string) => string }
interface TableColumn { readonly width: number; readonly minWidth?: number;
                        readonly align: "left" | "right";
                        readonly overflow: "allow" | "truncate";
                        readonly priority?: number; readonly style?: (text: string) => string }
interface TableOptions { readonly gap?: string; readonly indent?: string; readonly fit?: boolean }
class Table implements Component {
  constructor(rows: readonly (readonly TableCell[])[],   // MUST be {text} objects, not raw strings
              columns: readonly TableColumn[], options: TableOptions = {})
  setRows(rows): boolean
}
// free fn: renderTableRow(cells, columns, maxWidth?, options?) => string

// components/key-value-list.ts:39
interface KeyValueRow { readonly label: string; readonly value: string;
                        readonly labelStyle?: (t: string) => string;
                        readonly valueStyle?: (t: string) => string }
interface KeyValueListOptions { readonly indent?: string; readonly labelWidth: number;
                        readonly gap?: string; readonly minValueWidth?: number;
                        readonly labelOverflow?: "allow" | "truncate" }
class KeyValueList implements Component {
  constructor(rows: readonly KeyValueRow[], options: KeyValueListOptions)
  setRows(rows): boolean
}

// components/scroll-view.ts:134
type ScrollAnchor = ScrollRangeAnchor | "start" | "end" | "center"   // (see scroll-view.ts:53+)
interface ScrollViewTheme { track?: (t: string) => string; thumb?: (t: string) => string }
interface ScrollViewOptions {
  height: number;                                    // required
  scrollbar?: ScrollbarMode | boolean;               // default "auto" — column only when overflowing
  totalRows?: number;                                // logical rows for pre-windowed slices
  theme?: ScrollViewTheme; trackChar?: string; thumbChar?: string;
  ellipsis?: Ellipsis;                               // default Ellipsis.Unicode; Omit when you wrap yourself
  fastScrollLines?: number;                          // Shift+Arrow, default 5
  followTail?: boolean; anchor?: ScrollAnchor;
}
class ScrollView implements Component {
  constructor(content: readonly string[] | Component, options: ScrollViewOptions)
}

// components/select-list.ts:186
interface SelectItem { value: string; label: string; description?: string; icon?: string;
                       iconName?: string; nativeDetail?: string; state?: string; hint?: string;
                       disabled?: boolean; confirmation?: string; searchText?: string }
interface SelectListTheme { selectedPrefix: (t: string) => string; selectedText: (t: string) => string;
                       description: (t: string) => string; scrollInfo: (t: string) => string;
                       noMatch: (t: string) => string; symbols: SymbolTheme;
                       icon?: (t: string) => string; hovered?: (t: string) => string }
class SelectList implements Component {
  theme: SelectListTheme; layout: …; onSelect; onCancel; onSelectionChange;
  constructor(items, maxVisible: number, theme: SelectListTheme, layout = {}, …)
  // NOTE: theme is a required ctor arg and comes from ctx.ui.custom's factory, not from a module import
}

// components/section.ts:45
interface SectionOptions { readonly title: string; readonly body: Component | readonly string[];
                           readonly titleStyle?: (t: string) => string;
                           readonly ruleStyle?: (t: string) => string;
                           readonly ruleGlyph: string; readonly ruleWidth: number | "fill";
                           readonly blankAfter?: boolean }
class Section implements Component { constructor(options: SectionOptions) }

// components/spacer.ts:21
class Spacer implements Component { constructor(lines: number = 1) }
```

Other useful exported components confirmed present: `Container`, `Stack`, `Box`
(`constructor(paddingX=1, paddingY=1, bgFn?, border?: BoxBorder)`), `Markdown`,
`TruncatedText`, `Editor`, `Loader`, `ProgressBar`, `MenuSelection`, `TreeView`,
`TranscriptBrowser`, `SplitPane`, `TabBar`, `WizardStep`, `Disclosure`,
`FormField`, `TextFormField`, `SelectFormField`, `SettingsList`, `Ellipsis`.

### `Component` contract (`pi-tui/src/tui.ts:229`)

```ts
interface Component {
  debugId?: string; debugKind?: string; debugState?(): Record<string, unknown>;
  debugChildren?: readonly Component[];
  render(width: number): readonly string[];          // <- the only required member
  readonly retireDisplacedTranscript?: boolean;
  describe?(cx: DescribeContext): NativeNode | null; // native backend; return null to use render()
  nativeOverlay?: { role?: string; head?: TspText;
                    size?: "sm"|"md"|"lg"|"full";
                    anchor?: "center"|"top"|"bottom" };
  // …plus optional invalidate()/dispose() honoured by containers
}
```

Only `render(width)` is required. Return the **same array reference** when
unchanged.

### `ctx.ui.custom` (`pi-coding-agent/src/extensibility/extensions/types.ts:313`)

```ts
custom<T>(
  factory: (tui: TUI, theme: Theme, keybindings: KeybindingsManager,
            done: (result: T) => void) => ExtensionUiComponent | Promise<ExtensionUiComponent>,
  options?: {
    overlay?: boolean;
    overlayOptions?: OverlayOptions | (() => OverlayOptions);
    onHandle?: (handle: OverlayHandle) => void;
    signal?: AbortSignal;
  },
): Promise<T>
```

`OverlayOptions` (`pi-tui/src/tui.ts:424+`): `width?: SizeValue`,
`minWidth?: number`, `maxHeight?: SizeValue`, `anchor?: OverlayAnchor`,
`offsetX?`, `offsetY?`, `row?: SizeValue`, `col?: SizeValue`,
`margin?: OverlayMargin | number`, `fullscreen?: boolean`, `mouse?: boolean`.
`SizeValue` accepts a column/row count or a `"50%"` string.

---

# Searches

- `~/.omp/agent/extensions/{rtk.ts,herdr-omp-agent-state.ts}` — baseline imports.
- `legacy-pi-compat.ts:806-846` — `PI_PACKAGE_NAMES` allowlist + `LEGACY_PI_SPECIFIER_FILTER`.
- `loader.ts:416-520` — `importExtensionModule` / `bindExtension` error string format.
- `models-cli.ts:333-354` — non-interactive stderr surfacing of load errors.
- `main.ts:2256-2267` — trusted-extension hard-fail + non-interactive stderr path.
- `pi-tui/src/components/{table,metric,key-value-list,scroll-view,select-list,text,section,spacer}.ts` — exact ctor signatures.
- `pi-tui/src/tui.ts:229` (`Component`), `:424` (`OverlayOptions`), `:468` (`fullscreen`).
- `pi-tui/src/components/table.ts:60` (`alignCell`) — the `replaceAll` crash site.

---

# Gaps

1. **The overlay was NOT visually verified.** I cannot drive an interactive TUI. What
   *is* proven: the extension loads without error, `pi-tui` resolves with 359 exports,
   all eight component classes are `function`, `fullscreen` is a real `OverlayOptions`
   field, and `Text` / `MetricRow` / `KeyValueList` / `ScrollView` / `Table` construct
   and return real row arrays inside the host process. What is **not** proven: that the
   overlay actually paints, that `fullscreen` alt-screen works, that key handling
   reaches the component, or that the layout looks right. **A human must run
   `/zzprobe` in a real terminal.**
2. `Table`'s render was exercised at extension-load time inside the headless
   `omp models` process. Its behaviour under a *live* TUI (theme initialised, native
   backend active, real terminal width) may differ; the `describe()`/native path was
   never exercised at all.
3. Workaround (c) was proven in `/tmp`, not under `~/.omp/plugins/`. Per the task's
   own constraint I wrote nothing outside `/tmp` except the two probe extensions. The
   plugin-dir variant is very likely identical (the resolver walks up from the
   extension's directory either way) but is not empirically confirmed.
4. Only `@oh-my-pi/omp-stats/src/server.ts` was exercised via absolute path. The
   `/aggregator`, `/rollup`, `/db` files were not individually imported that way —
   they should behave identically, but only `/server` is proven. `src/server.ts`
   exports exactly 3 names; only `handleApi` was inspected.
5. `omp-stats` version is pinned in the report at **18.4.10**, matching the host. A
   version skew between the extension's expectations and the host's install would break
   the absolute-path workaround silently.
6. The 8.8 ms GROUP BY was measured cold. Steady-state with a warm page cache will be
   faster; a cold-start first frame after `omp` launches should be assumed to pay it.

---

# Cleanup (verified)

```
$ rm -f ~/.omp/agent/extensions/zz-probe-resolve.ts ~/.omp/agent/extensions/zz-probe-overlay.ts
$ rm -rf /tmp/ompext-probe
$ ls -la ~/.omp/agent/extensions/
644  herdr-omp-agent-state.ts  12.1K
600  rtk.ts  2.6K
$ ls -d /tmp/ompext-probe
ls: /tmp/ompext-probe: No such file or directory
$ ls -la ~/.omp/stats.db*
644  /Users/yuzu/.omp/stats.db  305.1M
644  /Users/yuzu/.omp/stats.db-shm  64.0K
644  /Users/yuzu/.omp/stats.db-wal  60.4K
600  /Users/yuzu/.omp/stats.db.sync.lock  0B
```

Both probe extensions are gone; only the two original extensions remain.
`/tmp/ompext-probe/` is gone. `stats.db` mtime/size byte-identical across the
readonly-open test (`1790947527 319889408` before and after). The file's *size*
drifted between the start of the session and the end because the background
`omp-stats` daemon is continuously writing — not because of any probe.
