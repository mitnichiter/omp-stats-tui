# Angle
What rendering primitives `@oh-my-pi/pi-tui` exposes to an extension, and the exact idiom a first-party full-screen overlay (`usage-dashboard.ts`, `git-tui.ts`, `annotate/fullscreen.ts`) uses so `/stats-tui` copies a real pattern instead of inventing one.

Scope (read-only): `~/.bun/install/global/node_modules/@oh-my-pi/pi-tui/src/**` and
`~/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/extensibility/**` + `src/modes/controllers/extension-ui-controller.ts`.
No project code was modified.

## Claims

- **`ctx.ui.custom()` factory signature is `(tui: TUI, theme: Theme, keybindings: KeybindingsManager, done: (result: T) => void) => Component | Promise<Component>`, and `keybindings` is a *fresh empty* `KeybindingsManager.inMemory()`** — evidence: `pi-coding-agent/src/modes/controllers/extension-ui-controller.ts:1156` `const keybindings = KeybindingsManager.inMemory();` and `:1196` `Promise.try(() => factory(this.ctx.ui, theme, keybindings, close))`; the type is at `src/extensibility/extensions/types.ts:313-321` — confidence: high. **Implication: do NOT resolve keys through the passed `keybindings` object — it has no user bindings. Use `getKeybindings()` / `matchesSelect*()` (module global) or raw `matchesKey(data, "…")`.**

- **`{ overlay: true, overlayOptions: {…} }` is the exact mount form, and `overlayOptions` replaces the default `bottom-center/100%/maxHeight:100%/margin:0`** — evidence: `extension-ui-controller.ts:1204-1213`
  ```ts
  const overlayOptions = typeof options.overlayOptions === "function" ? options.overlayOptions() : options.overlayOptions;
  overlayHandle = this.ctx.ui.showOverlay(
      component,
      overlayOptions ?? { anchor: "bottom-center", width: "100%", maxHeight: "100%", margin: 0 },
  );
  ```
  — confidence: high.

- **First-party full-screen overlay options object, verbatim** — evidence: `pi-coding-agent/src/extensibility/custom-commands/bundled/annotate/fullscreen.ts:13-20`
  ```ts
  const ANNOTATION_OVERLAY_OPTIONS = {
      width: "100%",
      maxHeight: "100%",
      margin: 0,
      fullscreen: true,
      mouseTracking: false,
  } as const;
  ```
  used as `ctx.ui.custom<…>((tui, theme, keybindings, done) => new AnnotationOverlay(…), { overlay: true, overlayOptions: ANNOTATION_OVERLAY_OPTIONS })` (`:44`, `:60`) — confidence: high. **`fullscreen: true` = borrow the alternate screen buffer (vim/less idiom) so the transcript stays untouched** (`pi-tui/src/tui.ts:459-468`).

- **`Component` is a very small interface: `render(width: number): readonly string[]` is the only required member** — evidence: `pi-tui/src/tui.ts:229-318`. Optional members: `describe?(cx: DescribeContext)`, `describeScreen?`, `nativeOverlay?`, `nativeSheet?`, `handleNativeEvent?`, `handleInput?(data: string)`, `wantsKeyRelease?`, `invalidate?()`, `setIgnoreTight?(ignore)`, `dispose?()`, plus debug fields `debugId` / `debugKind` / `debugState()` / `debugChildren` — confidence: high.

- **`render(width)` must return a bounded array of physical rows and may return the same array reference when nothing changed** — evidence: `tui.ts:239-245`
  ```ts
  /** Render the component to an array of physical rows at the given width.
   * The result is component-owned and `readonly` to the caller; an unchanged
   * component may (and should) return the same array reference it returned
   * last time. */
  render(width: number): readonly string[];
  ```
  — confidence: high. **Width is the only input; height must come from `tui.terminal.rows`** (`usage-dashboard.ts:897` `Math.max(14, process.stdout.rows || 40)`; `ps-top.ts:621` `Math.max(6, this.#ui.terminal.rows)`).

- **`UsageDashboardComponent` is the closest reference impl and it does NOT use the public component kit** — it hand-rolls string rows and composes three chrome helpers. Evidence: imports at `pi-tui/src/overlays/usage-dashboard.ts:10-46`; the only pi-tui classes it instantiates are `OverlayPanel`, `PanelDivider`, `PanelRows` from `../chrome/overlay-box` (`:565-574`), plus pure functions `buildProviderCards`, `buildHeatmapLayout`, `formatActivityErrorDetail`. — confidence: high.

- **Async data loads without blocking the TUI via a push-callback + `requestRender()` + `AbortController`; the loading state is a dim text row** — evidence `usage-dashboard.ts:497`
  ```ts
  loadActivity: (push: (points: DailyActivityPoint[]) => void, signal: AbortSignal) => Promise<void>;
  ```
  `:559-576` constructor ends `void this.#loadActivity();` (fire-and-forget, NOT awaited); `:578-591`
  ```ts
  async #loadActivity(): Promise<void> {
      try {
          await this.#options.loadActivity(points => {
              if (this.#closed) return;
              this.#activity = points;
              this.#changed();
          }, this.#closeController.signal);
      } catch (error) { this.#activityError = error instanceof Error ? error.message : String(error); }
      finally { this.#syncing = false; if (!this.#closed) this.#changed(); }
  }
  ```
  `:1351-1354`
  ```ts
  /** Invalidate the native description and repaint. */
  #changed(): void { this.#revision++; this.#options.requestRender(); }
  ```
  loading render `:831` `if (!points) return [theme.fg("dim", "Loading usage history…")];` — confidence: high.

- **Key input: mouse wheel first, then `matchesSelectCancel` for Esc (so user remapping works), then raw `matchesKey` for literal letters, then the `tui.select.*` bindings for arrows/page, then `home`/`end`** — evidence `usage-dashboard.ts:1367-1405`:
  ```ts
  handleInput(data: string): void {
      if (routeSgrMouseInput(data, event => {
          if (event.wheel === null) return false;
          this.#scrollBy(event.wheel * 2);
          return true;
      })) { return; }
      if (matchesSelectCancel(data) || matchesKey(data, "q")) {
          if (this.#view === "detail") { this.#setView("overview"); return; }
          this.dispose();
          this.#options.onClose();
          return;
      }
      if (matchesKey(data, "r")) { void this.#refresh(); return; }
      if (this.#view === "overview" && (matchesKey(data, "return") || matchesKey(data, "tab") || matchesKey(data, "d"))) {
          this.#setView("detail"); return;
      }
      if (matchesSelectUp(data)) this.#scrollBy(-1);
      else if (matchesSelectDown(data)) this.#scrollBy(1);
      else if (matchesSelectPageUp(data)) this.#scrollBy(-this.#lastViewportRows);
      else if (matchesSelectPageDown(data)) this.#scrollBy(this.#lastViewportRows);
      else if (matchesKey(data, "home")) { this.#scroll = 0; this.#options.requestRender(); }
      else if (matchesKey(data, "end")) this.#scrollBy(Number.MAX_SAFE_INTEGER);
  }
  ```
  — confidence: high.

- **Dismissal = `this.dispose()` then `this.#options.onClose()` (which calls `done(result)`); dispose must abort in-flight work** — evidence `:598-602`
  ```ts
  dispose(): void { this.#closed = true; this.#closeController.abort(); this.#panel.dispose(); }
  ```
  — confidence: high. (Note: for `ctx.ui.custom` the host *also* calls `component.dispose?.()` and `overlayHandle.hide()` in its own cleanup — `extension-ui-controller.ts:1161-1176` — so `dispose()` must be idempotent.)

- **Scrolling is a plain `#scroll` integer clamped inside `render()`, not a component** — evidence `:902-905`, `:924`
  ```ts
  const contentRows = Math.max(5, height - 5);
  this.#lastViewportRows = contentRows;
  const maxScroll = Math.max(0, contentSource.length - contentRows);
  if (this.#scroll > maxScroll) this.#scroll = maxScroll;
  …
  this.#body.setLines(contentSource.slice(this.#scroll, this.#scroll + contentRows));
  this.#body.setHeight(contentRows);
  ```
  — confidence: high. **There is no resize hook — height is recomputed from `process.stdout.rows` on every `render`.** Width changes are detected by comparing cached widths (`:887` `if (this.#detailCache?.width !== innerWidth)`, `:541-550` the `#nativeCache` memo).

- **Theme usage: `theme.fg(color, text)` with a `ThemeColor` string, never `theme.colors.x`; symbol tokens via `theme.boxRound.*` / `theme.status.*`; `theme.bold()`** — evidence `usage-dashboard.ts:608-629`
  ```ts
  #statusIcon(status: UsageLimit["status"]): string {
      if (status === "exhausted") return theme.fg("error", theme.status.error);
      if (status === "warning") return theme.fg("warning", theme.status.warning);
      if (status === "ok") return theme.fg("success", theme.status.success);
      return theme.fg("dim", theme.status.info);
  }
  #miniBar(fraction: number | undefined, status: UsageLimit["status"], width: number): string {
      if (fraction === undefined) return theme.fg("dim", "·".repeat(width));
      const clamped = Math.min(Math.max(fraction, 0), 1);
      const filled = Math.round(clamped * width);
      const bar = "█".repeat(filled);
      const empty = "░".repeat(width - filled);
      return `${theme.fg(this.#statusColor(status), bar)}${theme.fg("dim", empty)}`;
  }
  ```
  other real accesses: `theme.bold(...)` `:641`, `theme.fg("muted", …)` `:726`, `theme.getColorMode()` `:809`, `theme.getColorHex("accent")` `:810`, `theme.fgOnBg`/`theme.bg` in `chrome/overlay-box.ts`. **There is NO `theme.colors` object — verified by grep on `theme/theme-class.ts` (no `get colors`).** — confidence: high.

- **`getSelectListTheme()` is a free function re-exported from `@oh-my-pi/pi-tui/theme`** — evidence `pi-tui/src/theme/theme.ts:33-43` re-exports it from `./tui-adapters`; body at `tui-adapters.ts:253-278`:
  ```ts
  return {
      selectedPrefix: (text: string) => theme.fg("accent", text),
      selectedText:   (text: string) => theme.fg("accent", text),
      description:    (text: string) => theme.fg("muted", text),
      scrollInfo:     (text: string) => theme.fg("muted", text),
      noMatch:        (text: string) => theme.fg("muted", text),
      symbols: getSymbolTheme(),
      icon:    (text: string) => theme.fg("muted", text),
      hovered: (text: string) => theme.bg("selectedBg", text),
  };
  ```
  — confidence: high.

- **`matchesKey(data: string, keyId: KeyId): boolean`; `KeyId` is a template-literal union of base keys × modifiers** — evidence `pi-tui/src/keys.ts:549-552` and `:189`
  ```ts
  export function matchesKey(data: string, keyId: KeyId): boolean {
      if (matchesRawBackspace(data, 4)) return keyId === "ctrl+backspace";
      return matchesKeypadKey(data, keyId) ?? matchesKeyNative(data, keyId, kittyProtocolActive);
  }
  export type KeyId = BaseKey | ModifiedKeyId<BaseKey>;
  export type ModifierName = "ctrl" | "shift" | "alt" | "super";
  ```
  `BaseKey` covers `Letter | Digit | KeySymbol | SpecialKey`; `SpecialKey` includes `"escape" | "enter" | "tab" | "space" | "backspace" | "delete" | "insert" | "clear" | "home" | "end" | "pageUp" | "pageDown" | "up" | "down" | "left" | "right" | "f1"…"f12"` (`keys.ts:150-171`). Modifiers compose in any order: `"ctrl+c"`, `"shift+up"`, `"alt+enter"`, `"shift+ctrl+p"`. — confidence: high.
  Note the **case-folding subtlety**: `usage-dashboard.ts:1392` matches `"return"` (not `"enter"`); both are accepted because `addKeyAliases` canonicalizes — but be consistent with first-party and use `"return"`/`"enter"` after verifying.

- **Keybinding defaults that back `matchesSelect*()`** — evidence `pi-tui/src/keybindings.ts:130-142`
  ```ts
  "tui.select.up":      { defaultKeys: "up",     description: "Move selection up" },
  "tui.select.down":    { defaultKeys: "down",   description: "Move selection down" },
  "tui.select.pageUp":  { defaultKeys: "pageUp", description: "Selection page up" },
  "tui.select.pageDown":{ defaultKeys: "pageDown", description: "Selection page down" },
  "tui.select.confirm": { defaultKeys: "enter",  description: "Confirm selection" },
  "tui.select.cancel":  { defaultKeys: ["escape", "ctrl+c"], description: "Cancel selection" },
  ```
  and the matchers are thin wrappers over `getKeybindings()` (the module singleton, seeded with `TUI_KEYBINDINGS` if unset) — `pi-tui/src/keybinding-matchers.ts:31-57`. — confidence: high.

- **`KeybindingsManager` API**: `matches(data, keybinding)`, `matchesCanonical(canonical, keybinding)`, `getKeys(keybinding): KeyId[]`, `getDefinition`, `getConflicts()`, `setUserBindings`, `getResolvedBindings()` — `keybindings.ts:247-337`. `app-keybindings.ts:579-608` extends it with `static inMemory(userBindings = {})` and file `reload()`. — confidence: high.

- **Real digit-matching example (no `matchesKey` needed for ASCII digits)** — evidence `pi-tui/src/overlays/hook-selector.ts:618`
  ```ts
  if (this.#menu.query.length > 0 || keyData.length !== 1 || keyData < "1" || keyData > "9") return false;
  ```
  — confidence: high. `Letter`/`Digit` are valid `KeyId`s too, so `matchesKey(data, "1")` compiles.

- **Heatmap: NOT reusable as a component — only as an algorithm + two renderers.** `buildHeatmapLayout(points, weeks, today = new Date())` and `interface HeatmapLayout` are exported from `pi-tui/src/overlays/usage-dashboard.ts:281-357`; the ANSI renderer is the **private** `#renderHeatmap(innerWidth)` at `:824-872`; the truecolor ramp is the **private** `#heatRamp()` at `:807-822`. There is no heatmap component and no chart component anywhere — grep for `sparkline|Sparkline|histogram|Histogram` across `pi-tui/src` returns **zero** hits. — confidence: high.

- **Bar charts: two real, reusable paths.** (a) `renderProgressBar(value, width, options)` — a *free function*, exported, used by first party at `chrome/format.ts:63,69` (`renderAsciiBar`), `apps/cleanse-board.ts:364`, `overlays/agent-hub-renderer.ts:320`, `tools/find.ts:122`. (b) `ProgressBar` component (`components/progress-bar.ts:89`) — **zero first-party instantiations**; everyone uses the free function. — confidence: high.

- **A ready-made ANSI mini-bar idiom already in first-party code** — `usage-dashboard.ts:622-629` `#miniBar` (quoted above): `"█"` fill + `"░"` empty, each `theme.fg`-tinted separately. Copy this verbatim. — confidence: high.

- **Full-screen apps already in `pi-tui/src/apps/`**: `git/git-tui.ts` (`showGitOverlay`), `ps-top.ts` (`runPsTop`), `session-picker.ts`, `standalone-picker.ts`, `if-bench-board.ts`, `cleanse-board.ts`, `autoresearch-dashboard.ts`, `live-visualizer.ts`, `setup-model-picker.ts`, plus `debug/log-viewer.ts`. **Every one of them mounts via `ui.showOverlay(component, { anchor: "top-left", width: "100%", maxHeight: "100%", margin: 0, fullscreen: true })` and wraps the component's own `run()` promise in try/finally with `dispose()` + `overlay.hide()`** — `git-tui.ts:1210-1228`, `ps-top.ts:841-861`, `session-picker.ts:81-96`. — confidence: high.

- **`showGitOverlay` verbatim** — evidence `pi-tui/src/apps/git/git-tui.ts:1210-1228`:
  ```ts
  export async function showGitOverlay(ui: TUI, host: GitTuiHost): Promise<void> {
      const component = new GitTuiComponent(ui, host);
      const overlay = ui.showOverlay(component, {
          anchor: "top-left",
          width: "100%",
          maxHeight: "100%",
          margin: 0,
          fullscreen: true,
          mouseTracking: true,
      });
      ui.setFocus(component);
      ui.requestRender();
      try {
          await component.run();
      } finally {
          component.dispose();
          // overlay.hide() restores focus to the pre-overlay component.
          overlay.hide();
      }
  }
  ```
  **There is NO `runView` split in git-tui** — that name is NOT FOUND. `ps-top.ts` has the same shape with `await component.run()` at `:857`. For an *extension* we do NOT call `showOverlay` ourselves — the host does, via `ctx.ui.custom(factory, { overlay: true, overlayOptions })`, and we just implement `render`/`handleInput`/`dispose` and call `done(result)`. — confidence: high.

- **Theme object shape an extension receives**: a `Theme` *instance* (`pi-tui/src/theme/theme-class.ts:163`). Top-level members: methods `fg(color, text)`, `fgResolved(color, text)`, `bg(color, text)`, `bgFill`, `fgOnBg(color, bg, text)`, `bold`, `italic`, `underline`, `strikethrough`, `inverse`, `getColorHex(color)`, `getBgHex(color)`, `getAccentColorHex()`, `getColorMode()`, `getSymbolPreset()`, `getAllThemeColorHexes()`, `getMajorThemeColorHexes()`, `getThinkingBorderColor(level)`, `getSessionAccentHex`, `bindTheme`…; getters `isLight`, `accentSurfaceLuminance`, `sessionAccentInputs`, `statusLineLuminance`; symbol getters `status`, `nav`, `tree`, `progress`, `boxRound`, `boxSharp`, `boxDotted`, `sep`, `icon`, `cmd`, `thinking`, `checkbox`, `radio`, `format`, `md`, `spinnerFrames`. **There is no `colors` map** — confidence: high.

- **`ThemeColor` union** (`theme/schema.ts:44-…`) — the stats-relevant ones, exactly: `"accent" | "border" | "borderAccent" | "borderMuted" | "success" | "error" | "warning" | "muted" | "dim" | "text"` plus markdown/syntax/statusLine families. **`ThemeBg` union** (`schema.ts:177-184`): `"selectedBg" | "userMessageBg" | "customMessageBg" | "toolPendingBg" | "toolSuccessBg" | "toolErrorBg" | "statusLineBg"` — confidence: high.

- **Box-drawing tokens** — `theme.boxRound` (`theme-class.ts:528-546`) returns `{ topLeft, topRight, bottomLeft, bottomRight, horizontal, vertical, cross, teeDown, teeUp, teeRight, teeLeft }`, where the junctions deliberately alias `boxSharp.*`. Unicode defaults (`theme/symbols.ts:421-426`): `╭ ╮ ╰ ╯ ─ │`; `boxSharp` defaults at `:431-432`: `┌ ┐ …`. Access is always through the getter: `const box = theme.boxRound;` then `box.topLeft + box.horizontal.repeat(inner) + box.topRight` — `chrome/overlay-box.ts:27-38` — confidence: high.

## Component catalogue

All from the public barrel `pi-tui/src/index.ts` (`export * from "./components/…"`). Import paths below are the package subpaths, valid via the `./*` and `./components/*` export map (`package.json:100-107`).

| symbol | import path | constructor signature | renders as | useful for stats panel? |
|---|---|---|---|---|
| `Table` / `renderTableRow` | `@oh-my-pi/pi-tui` (barrel) or `@oh-my-pi/pi-tui/components/table` | `new Table(rows: readonly (readonly TableCell[])[], columns: readonly TableColumn[], options: TableOptions = {})` | one padded, aligned, ANSI-aware physical row per data row; `fit` shrinks lowest-priority truncating columns first | **Yes — the numbers table.** But first-party prefers the free `renderTableRow(cells, columns, maxWidth, options)`; `new Table(...)` has **0 first-party call sites**. `TableColumn = { width, minWidth?, align: "left"\|"right", overflow: "allow"\|"truncate", priority?, style? }` (lower `priority` gives way first) |
| `ScrollView` | `@oh-my-pi/pi-tui/components/scroll-view` | `new ScrollView(content: readonly string[] \| Component, options: ScrollViewOptions)` — `options: { height: number; scrollbar?: "auto"\|"always"\|"never"\|boolean; totalRows?; theme?: {track?, thumb?}; trackChar?; thumbChar?; ellipsis?; fastScrollLines?: number (=5); followTail?: boolean; anchor?: ScrollAnchor }` | a fixed-height window over the content with an auto scrollbar column; own offset state | **Yes — the scrolling pane.** Methods: `scroll(±n)`, `page(±1)`, `scrollToTop()`, `scrollToBottom()`, `getScrollOffset()`, `getMaxScrollOffset()`, `setScrollOffset(n)`, `setLines(lines)`, **`handleScrollKey(data): boolean`** (shift+up/down, up/down, pageUp/pageDown, home, end — returns true if consumed), `invalidate()`, `dispose()`, `debugState()` |
| `ScrollView` helpers | `@oh-my-pi/pi-tui/components/scroll-viewport` | **NOT a component — free functions only**: `maxScrollOffset(total,viewport)`, `clampScrollOffset(offset,total,viewport)`, `viewportRange(total,viewport,offset)`, `viewportOverflows`, `scrollOffsetForRow`, `centeredViewportRange`, `scrollbarThumbRange`, `cursorColumnWindow` | n/a — pure geometry | Only if you hand-roll a scrollbar. Prefer `ScrollView` |
| `Text` | `@oh-my-pi/pi-tui/components/text` | `new Text(text = "", paddingX = 1, paddingY = 1, customBgFn?)` | the string ANSI-wrapped to `width`, plus padding rows | Yes — for prose/banner blocks. Note the **padding defaults to 1** — use `new Text(s, 0, 0)` for tight rows |
| `Box` | `@oh-my-pi/pi-tui/components/box` | `new Box(paddingX = 1, paddingY = 1, bgFn?, border?: BoxBorder)`; `children: Component[]` pushed directly | padded/bordered container around children | Maybe — for card chrome. `BoxBorder = { chars: {topLeft,topRight,bottomLeft,bottomRight,horizontal,vertical}, color? }` |
| `MetricRow` + `formatMetric` + `formatMetricRow` | `@oh-my-pi/pi-tui/components/metric` | `new MetricRow(metrics: readonly MetricSpec[], options: MetricRowOptions = {})` — `MetricSpec = { value: string\|undefined; leading?; separator?; priority?; style? }`; `MetricRowOptions = { separator?; overflow?: "allow"\|"drop"\|"truncate"\|"wrap"; maxWidth?; paddingX?; paddingY?; style? }` | one inline line `a · b · c`; `drop` removes the lowest-priority metric first when it overflows | **Yes — a stat strip** (`5 models · $12.30 · 340 reqs · 2 errors`). `undefined` value = metric omitted |
| `Section` | `@oh-my-pi/pi-tui/components/section` | `new Section(options: SectionOptions)` — `{ title: string; body: Component \| readonly string[]; titleStyle?; ruleStyle?; ruleGlyph: string; ruleWidth: number\|"fill"; blankAfter?: boolean }` | `[title line, rule line, …body lines]` | **Yes — section headers.** `ruleWidth: "fill"` spans the pane |
| `KeyValueList` | `@oh-my-pi/pi-tui/components/key-value-list` | `new KeyValueList(rows: readonly KeyValueRow[], options: KeyValueListOptions)` — `KeyValueRow = { label, value, labelStyle?, valueStyle? }`; `KeyValueListOptions = { indent?: string; labelWidth: number; gap?; minValueWidth?; labelOverflow?: "allow"\|"truncate" }` | aligned `label   value` grid with wrapped value continuations | **Yes — the metric grid.** Real usage: `ps-top.ts:90` `new KeyValueList([], { indent: "   ", labelWidth: 9, gap: " " })`; has `setRows()` |
| `TabBar` | `@oh-my-pi/pi-tui/components/tab-bar` | `new TabBar(label: string, tabs: Tab[], theme: TabBarTheme, initialIndex = 0)` — `Tab = { id, label, short?, muted? }`; `TabBarTheme = { label, activeTab, inactiveTab, hint, mutedTab?, hoverTab? }` all `(text: string) => string` | `Overview · Models · Folders ▸` with the active tab styled; trailing `(tab to cycle)` hint (`showHint = false` to suppress) | **Yes — view switching.** `getActiveTab()`, `setActiveIndex(i)`, `setTabs(tabs, activeId?)`, `onTabChange?` callback. It renders the bar only — you own `handleInput` |
| `SelectList` | `@oh-my-pi/pi-tui/components/select-list` | `new SelectList(items: ReadonlyArray<SelectItem>, maxVisible: number, theme: SelectListTheme, layout: SelectListLayoutOptions = {})` | scrollable, filterable, selectable list with a cursor row | **Yes — for picking a model/folder.** `SelectItem = { value, label, description?, icon?, state?, hint?, disabled?, confirmation?, searchText? }`. Pass `getSelectListTheme()`. `setMaxVisible(rows)`, `setItems()`, `setSelectedValue()`, `setFilter()` |
| `renderProgressBar` / `ProgressBar` | `@oh-my-pi/pi-tui/components/progress-bar` | `renderProgressBar(value: number \| undefined, width: number, options: ProgressBarOptions)`; `ProgressBarOptions = { min?, max?, minWidth?, maxWidth?, prefix?, suffix?, showPercentage?, percentageSeparator?, formatPercentage?, style: { filled, empty, indeterminate?, styleFilled?, styleEmpty?, styleIndeterminate?, styleBar? } }`; `new ProgressBar(value, options)` | one filled/empty bar line, `undefined` = indeterminate | **Yes — quotas.** Use the **free function** (4 first-party call sites) not the component (0). `renderAsciiBar(fraction, width)` in `chrome/format.ts:59-80` is the ready-made `[████░░░░] 42%` wrapper |
| `TreeView` | `@oh-my-pi/pi-tui/components/tree-view` | `new TreeView(options: TreeViewOptions<T,K>)` — `{ theme: Theme; renderRow; filter?; selectedKey?; maxRows?; maxLines?; centerSelection?; renderPrefix?; renderLeading?; styleSelected?; truncateRows?; scrollbar?; scrollbarTheme? }` | a keyed hierarchy with a gutter, selection band and optional scrollbar | Maybe — a folder/path breakdown tree. Heavyweight; the flattened-row maths is internal |
| `SplitPane` | `@oh-my-pi/pi-tui/components/layout/split-pane` | `new SplitPane(options: SplitPaneOptions)` — `{ left: LayoutContent; right: LayoutContent; leftSize?: {fixed?;ratio?;min?;max?}; rightMinWidth?; splitAt?; narrowPane?; height?; prefix?; divider?; suffix?; align? }` | adaptive 2-column pane, collapses to one pane below `splitAt` | **Yes — sidebar + main (models list beside charts).** Over `Row`; implements `MouseRoutable` |
| `Disclosure` | `@oh-my-pi/pi-tui/components/disclosure` | `new Disclosure(options: DisclosureOptions)` — `{ summary?: DisclosureSlot; collapsedBody?: DisclosureSlot; body: () => Component; expanded?; paddingX?; maxCollapsedRows?; collapsedHint? }` | collapsed summary row that expands a lazily-built body | Maybe — per-row drill-down in a table |
| `TruncatedText` | `@oh-my-pi/pi-tui/components/truncated-text` | `new TruncatedText(text: string, paddingX = 0, paddingY = 0)` | the text clipped to `width` with an ellipsis | Yes — defensive single-row labels |
| `Markdown` | `@oh-my-pi/pi-tui/components/markdown` | `new Markdown(text: string, paddingX: number, paddingY: number, theme: MarkdownTheme, defaultTextStyle?, codeBlockIndent = 2)` | full markdown (headings, tables, code w/ highlighting, mermaid) | **Probably not** for a stats panel — but it renders **markdown tables**; if `/stats-tui` accepts a markdown report, use `getMarkdownTheme()`. 152KB module |
| `PanelRows` / `PanelDivider` / `OverlayPanel` | `@oh-my-pi/pi-tui/chrome` (via `chrome/index.ts` → `overlay-box`) | `new OverlayPanel(title = "", role = "omp.overlay")`; `new PanelRows()`; `new PanelDivider()` | `OverlayPanel` draws `╭─ Title ─…─╮`, `│ … │` rows, `╰───╯`, with `│────│` for each `PanelDivider`; `PanelRows.setLines(lines)` / `.setHeight(n)` | **Yes — this is what `usage-dashboard` uses for its chrome.** Memoized; `renderContent(width)` gives unbordered body rows for tests |

**Ranking for `/stats-tui`**: `OverlayPanel`+`PanelRows` (frame) → `renderTableRow` (numbers) → `KeyValueList` (metric grid) → `renderProgressBar` (quotas) → `ScrollView` (paging) → `MetricRow` (stat strip) → `Section` (headers) → `SplitPane` (sidebar). `usage-dashboard` itself uses **none** of the middle ones — it hand-rolls them because it wants byte-exact column geometry across cards; a stats panel with a single pane should use the kit instead.

## Copy-this patterns

### 1. The whole mount, end to end (a real first-party extension)

```ts
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

const STATS_OVERLAY_OPTIONS = {
    width: "100%",
    maxHeight: "100%",
    margin: 0,
    fullscreen: true,
    mouseTracking: false,
} as const;

export default function (pi: ExtensionAPI) {
    pi.addCommand({
        name: "stats-tui",
        description: "…",
        handler: async ctx => {
            const result = await ctx.ui.custom<StatsResult | undefined>(
                (tui, theme, keybindings, done) =>
                    new StatsComponent(tui, theme, {
                        onClose: () => done(undefined),
                        requestRender: () => tui.requestRender(),
                        load: (push, signal) => loadStats(push, signal),
                    }),
                { overlay: true, overlayOptions: STATS_OVERLAY_OPTIONS },
            );
            return result;
        },
    });
}
```
Source shape: `pi-coding-agent/src/extensibility/custom-commands/bundled/annotate/fullscreen.ts:36-45`. **Use `tui.requestRender()` from the factory's `tui` — do not use the `keybindings` arg** (it is `KeybindingsManager.inMemory()`, empty).

### 2. The component skeleton

```ts
export class StatsComponent implements Component {
    readonly #panel: OverlayPanel;
    readonly #header: PanelRows;
    readonly #body: PanelRows;
    readonly #footer: PanelRows;
    readonly #close = new AbortController();
    #closed = false;
    #scroll = 0;
    #rows = 0;
    #loading = true;
    #data: Stats | null = null;

    constructor(/* … */) {
        ensureThemeSync();                     // from "@oh-my-pi/pi-tui/theme"
        this.#panel  = new OverlayPanel("Stats");
        this.#header = new PanelRows(); this.#header.setHeight(1);
        this.#body   = new PanelRows();
        this.#footer = new PanelRows(); this.#footer.setHeight(1);
        this.#panel.addChild(this.#header);
        this.#panel.addChild(this.#body);
        this.#panel.addChild(new PanelDivider());
        this.#panel.addChild(this.#footer);
        void this.#load();                     // fire-and-forget, never awaited
    }

    async #load(): Promise<void> {
        try {
            await this.opts.load(data => { if (this.#closed) return; this.#data = data; this.#repaint(); },
                                 this.#close.signal);
        } catch (e) {
            this.#error = e instanceof Error ? e.message : String(e);
        } finally {
            this.#loading = false;
            if (!this.#closed) this.#repaint();
        }
    }

    #repaint(): void { this.#panel.invalidate(); this.opts.requestRender(); }

    invalidate(): void { this.#panel.invalidate(); }
    dispose(): void   { if (this.#closed) return; this.#closed = true; this.#close.abort(); this.#panel.dispose(); }

    render(width: number): readonly string[] {
        const height = Math.max(14, this.opts.tui.terminal.rows);
        const content = this.#lines(Math.max(20, width - 4));   // OverlayPanel insets 4 cols
        const rows = Math.max(5, height - 5);
        this.#rows = rows;
        this.#scroll = Math.max(0, Math.min(this.#scroll, content.length - rows));
        this.#panel.title = "Stats";
        this.#body.setLines(content.slice(this.#scroll, this.#scroll + rows));
        this.#body.setHeight(rows);
        this.#footer.setLines([theme.fg("dim", hint)]);
        return this.#panel.render(width);
    }
}
```
Source: `usage-dashboard.ts:559-576` (ctor), `:578-591` (load), `:593-602` (`invalidate`/`dispose`), `:896-928` (`render`). **Height from `process.stdout.rows` (or `tui.terminal.rows`) — there is no `onResize`.**

### 3. Loading state is a dim one-liner, not a spinner

```ts
if (!points) return [theme.fg("dim", "Loading usage history…")];
```
`usage-dashboard.ts:831`. Error state likewise:
```ts
return [theme.fg("dim", detail ? `Usage history unavailable (${detail}).` : "Usage history unavailable.")];
```
`:828`. `formatActivityErrorDetail(error, homeDir = os.homedir())` (`:509-517`) is the exported sanitizer to copy — strips ANSI, expands tabs, collapses whitespace, shortens `$HOME` to `~`, trims trailing dots.

### 4. Key handling, verbatim from `usage-dashboard.ts:1367-1405` (quoted in Claims). Additions from `ps-top.ts:248-270` for plain-letter keys:
```ts
if (matchesKey(data, "escape") || data === "q") { this.#done.resolve(); return; }
if (matchesKey(data, "up") || data === "k") this.#moveSelection(-1);
else if (matchesKey(data, "down") || data === "j") this.#moveSelection(1);
else if (matchesKey(data, "enter") || data === "i") void this.#openInfo();
```
Note `data === "q"` (raw compare) for letters, `matchesKey` for special keys — this is the house style.

### 5. Footer hints from the live keybinding registry

```ts
import { editorKey, editorKeys } from "@oh-my-pi/pi-tui/chrome/keybinding-hints";
import { formatKeyHint } from "@oh-my-pi/pi-tui/app-keybindings";

const scrollHint = maxScroll > 0 ? `${editorKeys("tui.select.up", "tui.select.down")} scroll · ` : "";
const cancel = editorKey("tui.select.cancel");
const hint = `${scrollHint}${formatKeyHint("enter")} details · ${cancel} close`;
```
`usage-dashboard.ts:915-921`; `editorKey`/`editorKeys` at `chrome/keybinding-hints.ts:18-26` read `getKeybindings().getKeys(action)` and format via `formatKeyHints` (`key-hint-format.ts:114-116`, `formatKeyHint` at `:91`).

### 6. Wheel scrolling without implementing mouse decoding

```ts
if (routeSgrMouseInput(data, event => {
    if (event.wheel === null) return false;
    this.#scrollBy(event.wheel * 2);
    return true;
})) { return; }
```
`usage-dashboard.ts:1369-1376`; `routeSgrMouseInput` exported from the barrel (`pi-tui/src/mouse.ts`, re-exported via `index.ts`).

### 7. Numbers formatting (copy exactly — first-party already solved this)

```ts
const cost = layout.totalCost >= 1
    ? `$${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(layout.totalCost)}`
    : `$${layout.totalCost.toFixed(2)}`;
const requests = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 })
    .format(layout.totalRequests);
// → "$1,234 · 5.6K requests"
```
`usage-dashboard.ts:839-845` / `:467-476`.

### 8. Heatmap: copy the *algorithm*, write the ANSI cells yourself

`buildHeatmapLayout` is exported (`usage-dashboard.ts:313`) and takes `{ day: string; cost: number; requests: number }[]` (`DailyActivityPoint`, `:49-53`). Level bucketing (`:327-330`):
```ts
const level = (value: number): number => {
    if (value <= 0 || max <= 0) return 0;
    return Math.min(4, Math.max(1, Math.ceil(Math.sqrt(value / max) * 4)));
};
```
ANSI cell emission (`:861-870`), with the truecolor ramp at `:807-822` built from `theme.getColorHex("accent")` + `colorToAnsi(hex, theme.getColorMode())`:
```ts
for (let day = 0; day < 7; day++) {
    let line = theme.fg("dim", HEATMAP_DAY_LABELS[day]) + " ";
    for (let week = 0; week < weeks; week++) {
        const cell = layout.cells[day][week];
        if (cell === null) line += "  ";
        else if (cell === 0) line += `${theme.fg("dim", "·")} `;
        else line += `${ramp[cell - 1]}■${reset} `;   // reset === "\x1b[39m"
    }
    summary.push(line.trimEnd());
}
```
`HEATMAP_DAY_LABELS = ["M","T","W","T","F","S","S"]` (`:293`), `HEATMAP_ROW_LABELS = ["M","","W","","F","",""]` (`:368`, native variant). Column count is width-driven: `const weeks = Math.max(4, Math.min(53, Math.floor((innerWidth - labelWidth) / 2)));` (`:834`). Month-label packing at `:851-859`.

### 9. Bar / quota row — the two idioms

First-party inline mini-bar (no import needed):
```ts
const filled = Math.round(clamped * width);
const bar   = "█".repeat(filled);
const empty = "░".repeat(width - filled);
return `${theme.fg(statusColor, bar)}${theme.fg("dim", empty)}`;
```
`usage-dashboard.ts:622-629`. For framed + labelled bars use `renderProgressBar(fraction, width, { min: 0, max: 1, prefix: "[", suffix: "]", showPercentage: true, formatPercentage: v => `${Math.round(v*100)}%`, style: { filled: "█", empty: "░" } })` — the `renderAsciiBar` shape at `chrome/format.ts:69-79`. Or `renderProgressBar(done, BAR_WIDTH, { min: 0, max: total, style: REPAIR_BAR_STYLE })` — `cleanse-board.ts:364`.

### 10. Native/TSP path (optional, terminal-capability gated)

`usage-dashboard` also implements `describe(cx: DescribeContext): NativeNode`, `handleNativeEvent(event: NativeUiEvent)`, `nativeOverlay = { role: "omp.overlay.usage", size: "lg", anchor: "center", head: "Usage" }` (`:535`), and probes capability with `cx.supports("meter")` / `cx.supports("chart")` (`:943-944`), falling back to ANSI rows otherwise. **Skip this for v1** — it is a second rendering backend, not required for the ANSI path.

## Searches

```
ls -R pi-tui/src/components/ pi-tui/src/theme/
cat pi-tui/src/index.ts                      # public barrel
sed -n 1,1406p pi-tui/src/overlays/usage-dashboard.ts   (in ranges)
cat pi-tui/src/chrome/overlay-box.ts
cat pi-tui/src/keybinding-matchers.ts
sed -n 150,200p; 540,600p pi-tui/src/keys.ts
sed -n 240,350p pi-tui/src/keybindings.ts
sed -n 130,142p pi-tui/src/keybindings.ts      # tui.select.* defaults
grep -n "showGitOverlay" -r pi-tui/src ; sed -n 1150,1245p pi-tui/src/apps/git/git-tui.ts
sed -n 1140,1260p pi-coding-agent/src/modes/controllers/extension-ui-controller.ts
cat pi-coding-agent/src/extensibility/custom-commands/bundled/annotate/fullscreen.ts
grep -n "custom<" -A 12 pi-coding-agent/src/extensibility/extensions/types.ts
grep -rn "sparkline\|Sparkline\|histogram\|Histogram" pi-tui/src        # ZERO hits
grep -rln "heatmap\|Heatmap" pi-tui/src                                # only usage-dashboard.ts
grep -rln "barchart\|BarChart\|barChart\|▇\|▂▃▄▅▆▇" pi-tui/src           # only apps/live-visualizer.ts
grep -rn "renderProgressBar(" pi-tui/src                              # 4 call sites
grep -rn "new Table(" pi-tui/src                                       # ZERO call sites
grep -rn "new KeyValueList(" pi-tui/src                                # 2 call sites
grep -n "get colors" pi-tui/src/theme/theme-class.ts                   # ZERO hits
grep -rn "fullscreen" pi-tui/src/apps/ pi-tui/src/tui.ts
ls pi-tui/src/apps/ pi-tui/src/apps/git/ pi-tui/src/apps/debug/
```

## Conflicting evidence

- **`theme.colors.*` does not exist.** The task brief guessed it; grep on `theme/theme-class.ts` returns zero hits for `get colors` or `colors:`. The real API is `theme.fg(color: ThemeColor, text)` / `theme.bg(color: ThemeBg, text)`. Confidence high.
- **The `keybindings` argument to a `custom()` factory is useless as a resolver.** It is `KeybindingsManager.inMemory()` (`extension-ui-controller.ts:1156`) — a manager built from the *static* `KEYBINDINGS` default map with **no user config**, distinct from the global `getKeybindings()` singleton that `matchesSelect*()` consults. So `keybindings.getKeys("tui.select.cancel")` inside our factory returns the hardcoded default `["escape","ctrl+c"]` even if the user remapped it. Use the module-level matchers. Confidence high.
- **"runView split" — NOT FOUND.** `showGitOverlay` has no `runView`; it is a straight `await component.run()` in a try/finally. Confidence high.
- **`Table` and `ProgressBar` components are effectively dead code inside the package** — every first-party site uses the free functions `renderTableRow` / `renderProgressBar`. Prefer the free functions (they compose into a parent component's own `render`); the classes are better if you want a self-contained child with its own cache. Confidence medium (absence of call sites is strong but not conclusive for a public API).
- `usage-dashboard` describes its heatmap natively as a `chart` node with `{ kind: "heatmap", cells, cols, rows, tips, token: "accent", summary, size: "md" }` (`:1150-1173`), but `native/node.ts` has **no** `chart` or `meter` literal in this checkout (grep zero hits) — the type lives in `@oh-my-pi/pi-wire`. The ANSI fallback path is what we can rely on. Confidence medium.

## Gaps

- **`Theme` symbol getters `md`, `format`, `sep`, `icon`, `thinking`, `checkbox`, `radio`, `cmd` internals** — read the getter names and defaults spot-checked only (`symbols.ts:391-426`); full per-preset (unicode/nerd/ascii) glyph tables not enumerated.
- **`SelectList.handleInput` / `TreeView.handleInput` / `TabBar` navigation contract** — not read. `TabBar` exposes `setActiveIndex`/`onTabChange` and renders only; whether it consumes Tab itself is unverified.
- **`MarkdownTheme` shape** (1727-line interface at `markdown.ts:1327`) not read — only that `getMarkdownTheme()` exists (`theme/tui-adapters.ts`).
- **`SplitPane` `LayoutContent` / `LayoutDecoration` types** (`layout/row.ts`, `layout/geometry.ts`) not read; constructor keys known from the options interface only.
- **`ScrollAnchor`, `ScrollbarMode`, `Ellipsis` enum literal values** — `ScrollbarMode = "auto" | "always" | "never"` confirmed (`scroll-view.ts:21`); `ScrollAnchor`/`Ellipsis` members not read.
- **`TUI` API surface** — only `showOverlay`, `setFocus`, `requestRender`, `terminal.rows` verified from call sites; `OverlayHandle` members beyond `hide()` unverified.
- **No runtime smoke test was performed** (read-only investigation, no project code, no TUI instance launched). Every claim above is source-derived.
- The **`custom()` handler return contract** for `pi.addCommand` (what a handler may return) was not verified against `custom-commands/types.ts`.