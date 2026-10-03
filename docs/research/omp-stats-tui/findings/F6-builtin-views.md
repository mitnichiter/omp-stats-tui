# F6 — How omp's built-in full-screen views are constructed

Read-only investigation. All line numbers are from the on-disk installs:

- TUI framework: `/Users/yuzu/.bun/install/global/node_modules/@oh-my-pi/pi-tui/src/`
- Coding agent: `/Users/yuzu/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/`

Short paths below: `pi-tui/src/...` and `coding-agent/src/...`.

---

## `/settings` anatomy

### The view component lives in pi-tui, NOT in coding-agent

The panel is **`SettingsSelectorComponent`**, in **`pi-tui/src/overlays/settings-selector.ts`**.
The coding-agent side (`src/modes/settings.ts`, `src/config/all-settings.ts`, `src/tools/settings.ts`) only
*declares settings data*; it never renders. `all-settings.ts` is pure registration:

```ts
// coding-agent/src/config/all-settings.ts:1-5
/**
 * Every settings domain, in settings-panel order. Importing this module registers every setting;
 * {@link orderedSettings} lists them by domain order, then declaration order within a domain;
 * `PLACED_DOMAINS` splice a domain into another domain's rows.
 */
```

Each setting declares its own tab/group in a `ui:` block:

```ts
// coding-agent/src/modes/settings.ts:88-110 (abridged)
export const cfgSymbolPreset = register({
	id: "symbolPreset",
	type: "enum",
	values: ["unicode", "nerd", "ascii"] as const,
	default: "unicode",
	ui: {
		tab: "appearance",
		group: "Theme",
		label: "Symbol Preset",
		description: "Glyph set for icons and symbols (Unicode, Nerd Font, or ASCII)",
		options: [
			{ value: "unicode", label: "Unicode", description: "Standard symbols (default)" },
			{ value: "nerd", label: "Nerd Font",
			  description: "Requires a Nerd Font, or a Glyph Protocol terminal (icons ship in-band)" },
			{ value: "ascii", label: "ASCII", description: "Maximum compatibility" },
		],
	},
});
effect(cfgSymbolPreset, setSymbolPreset);
```

### Class, constructor, Component methods

```ts
// pi-tui/src/overlays/settings-selector.ts:611-615
/**
 * Main tabbed settings selector component.
 * Uses declarative settings definitions from settings-defs.ts.
 */
export class SettingsSelectorComponent implements Component {
```

```ts
// pi-tui/src/overlays/settings-selector.ts:645
constructor(context: SettingsRuntimeContext, callbacks: SettingsCallbacks) {
```

`SettingsRuntimeContext` (`settings-selector.ts:561-581`):

```ts
export interface SettingsRuntimeContext {
	settings: SettingsHost;
	plugins: PluginSettingsHost;
	/** Available thinking levels (from session) */
	availableThinkingLevels: Effort[];
	/** Current thinking level (from session) */
	thinkingLevel: ThinkingLevel | undefined;
	/** Available themes */
	availableThemes: string[];
	/** Provider/source ids shown in /model. */
	providers: string[];
	/** Active model (api + id); resolves what the snapcompact `auto` shape maps to. */
	model?: ShapeTarget;
	/** Shared TUI image budget (graphics ids + transmit-once) for image previews. */
	imageBudget?: ImageBudget;
	/** Schedules a re-render after async preview work completes. */
	requestRender?: () => void;
	/** Live status renderer for composer-shape previews (the session's status line). */
	composerPreviewStatus?: ComposerPreviewStatusSource;
}
```

`SettingsCallbacks` (`settings-selector.ts:594-608`):

```ts
export interface SettingsCallbacks {
	/** Called when any setting value changes */
	onChange: (path: string, newValue: unknown) => void;
	/** Called for theme preview while browsing */
	onThemePreview?: (theme: string) => void | Promise<void>;
	/** Called for status line preview while configuring */
	onStatusLinePreview?: (settings: StatusLinePreviewSettings) => void;
	/** Get current rendered status line for inline preview */
	getStatusLinePreview?: () => string;
	/** Native status bar for the inline preview */
	describeStatusLinePreview?: () => NativeNode;
	/** Called when plugins change */
	onPluginsChanged?: () => void | Promise<void>;
	/** Called when settings panel is closed */
	onCancel: () => void;
}
```

Component methods implemented (verified against `interface Component` at `pi-tui/src/tui.ts:229-320`):

| Method | Line | Notes |
|---|---|---|
| `constructor(context, callbacks)` | 645 | |
| `invalidate()` | 670 | fans out to tab bar + list + plugin component |
| `render(width): readonly string[]` | 732 | the whole frame |
| `nativeSheet(cx): boolean` | 786 | TSP-only; irrelevant to ANSI |
| `describe(cx): NativeNode` | 796 | TSP-only |
| `handleInput(data)` | 1886 | |

Notably **absent**: no `dispose()`, no `setIgnoreTight()`. Resize is handled implicitly — `render(width)`
is re-invoked by the TUI on every frame including after a resize, and the component re-derives geometry
from `width` each time.

### How it is MOUNTED — fullscreen alternate screen

Mount chain: slash command → `InteractiveModeContext.showSettingsSelector()` →
`SelectorController.showSettingsSelector()` → `#showFullscreenMenu()` → `ui.showOverlay()`.

```ts
// coding-agent/src/modes/controllers/selector-controller.ts:181-192
	#showFullscreenMenu(component: Component): OverlayHandle {
		const handle = this.ctx.ui.showOverlay(component, {
			anchor: "bottom-center",
			width: "100%",
			maxHeight: "100%",
			margin: 0,
			fullscreen: true,
		});
		this.ctx.ui.setFocus(component);
		this.ctx.ui.requestRender();
		return handle;
	}
```

**Verbatim options object: `{ anchor: "bottom-center", width: "100%", maxHeight: "100%", margin: 0,
fullscreen: true }` at `selector-controller.ts:182-188`.** `fullscreen: true` borrows the alternate
screen buffer. `mouseTracking` is **omitted** → defaults to **on**, which is why the component parses SGR
mouse reports in `handleInput`.

The call site, with its own comment stating the intent:

```ts
// coding-agent/src/modes/controllers/selector-controller.ts:252-263
	showSettingsSelector(): void {
		getAvailableThemes().then(availableThemes => {
			// Fullscreen settings editor on the alternate screen: the overlay
			// enables mouse tracking (click/hover/wheel) for its lifetime and
			// the transcript stays untouched underneath.
			const done = () => {
				overlayHandle?.hide();
				this.focusActiveEditorArea();
				this.ctx.ui.requestRender();
			};
			const selector = new SettingsSelectorComponent(
				{
					availableThinkingLevels: [...this.ctx.session.getAvailableThinkingLevels()],
					thinkingLevel: this.ctx.session.thinkingLevel,
					availableThemes,
					...
```

Note the **dismissal discipline**: `done()` hides the handle, restores focus to the editor area, and
requests a render. `overlayHandle?.hide()` is captured after the component is constructed — a
`const` declared *after* the closure that closes over it.

The public entry point is a one-line forward:

```ts
// coding-agent/src/modes/interactive-mode.ts:7870-7872
	showSettingsSelector(): void {
		this.#selectorController.showSettingsSelector();
	}
```

### Slash-command registration

```ts
// coding-agent/src/slash-commands/builtin-modes.ts:295-302
	{
		name: "settings",
		icon: "settings",
		description: "Open settings menu",
		handleTui: (_command, runtime) => {
			runtime.ctx.showSettingsSelector();
			clearSubmittedText(runtime);
		},
	},
```

There is **no `handle:`** — settings is TUI-only. `icon: "settings"` is a theme symbol key, so the
completions menu renders it through the active symbol preset.

### Visual structure — the layout template

```ts
// pi-tui/src/overlays/settings-selector.ts:727-783
	/**
	 * Fullscreen frame: title border, tab row, divider, optional search banner,
	 * the active content sized to fill the terminal, the appearance preview,
	 * then a footer hint pinned above the bottom border.
	 */
	render(width: number): readonly string[] {
		const height = Math.max(14, process.stdout.rows || 40);
		const innerWidth = Math.max(1, width - 4);

		const tabLines = this.#tabBar.render(innerWidth);
		const searching = this.#searchList !== null;
		const showPreview = !searching && this.#currentTabId === "appearance";
		const previewLines = showPreview ? ["", theme.fg("muted", "Preview:"), this.#getStatusPreviewString()] : [];

		// Fixed chrome: top border, tabs, divider, [search row], divider, hint, bottom border.
		const fixedRows = 1 + tabLines.length + 1 + (searching ? 1 : 0) + 1 + 1 + 1;
		const contentRows = Math.max(7, height - fixedRows - previewLines.length);

		const list = this.#searchList ?? this.#currentList;
		let contentLines: readonly string[];
		if (list) {
			// SettingsList pads itself to viewport + blank + 3 description rows.
			list.setMaxVisible(contentRows - 4);
			contentLines = list.render(innerWidth);
		} else if (this.#pluginComponent) {
			contentLines = this.#pluginComponent.render(innerWidth);
		} else {
			contentLines = [];
		}

		const out: string[] = [];
		out.push(topBorder(width, "Settings"));
		this.#tabRowStart = out.length;
		this.#tabRowCount = tabLines.length;
		for (const line of tabLines) {
			out.push(row(line, width));
		}
		out.push(divider(width));
		if (searching) {
			out.push(row(this.#renderSearchBanner(innerWidth), width));
		}
		this.#contentRowStart = out.length;
		this.#contentRowCount = contentRows;
		for (let i = 0; i < contentRows; i++) {
			out.push(row(contentLines[i] ?? "", width));
		}
		for (const line of previewLines) {
			out.push(row(line, width));
		}
		out.push(divider(width));
		out.push(row(theme.fg("dim", this.#footerHintText()), width));
		out.push(bottomBorder(width));
		return out;
	}
```

Precise structure, top to bottom:

1. **Title border** — `topBorder(width, "Settings")`. Title is inset into the rule, bold, `accent` colored;
   the rule itself is `border` colored. Rounded corners (`╭ ─ ╮`).
2. **Tab strip** — `TabBar.render(innerWidth)`, `showHint = false` (no "(tab to cycle)" text).
   Left/right arrows switch tabs. Tab icon+label per tab; tabs with no search matches render dimmed
   (`tab.muted`) but keep their slot.
3. **`divider(width)`** — a `├──────┤` rule.
4. **Search banner** (only while searching) — one row: accent search icon, editable query with live
   cursor, right-aligned match count colored `dim`/`warning`.
5. **Content** — exactly `contentRows` lines, each wrapped in `row(...)`, blank-padded.
6. **Optional preview block** (appearance tab only) — blank line, `Preview:` in `muted`, then live preview lines.
7. **`divider(width)`** again.
8. **Footer hint** — one `dim` line, built by `#footerHintText()`.
9. **`bottomBorder(width)`**.

Fixed height budget is computed *first*, then content gets the remainder:
`fixedRows = 1 + tabLines.length + 1 + (searching ? 1 : 0) + 1 + 1 + 1`.

The footer is mode-dependent — this is the "key hints" idiom, driven by `editorKey`/`formatKeyHint`
so hints follow the user's actual keybindings:

```ts
// pi-tui/src/overlays/settings-selector.ts:685-699
	#footerHintText(): string {
		const confirm = editorKey("tui.select.confirm");
		const cancel = editorKey("tui.select.cancel");
		const tab = formatKeyHint("tab");
		const switchTabs = `${formatKeyHints(["left", "right"])} to switch tabs`;
		if (this.#searchList) {
			return `${confirm} to change · ${tab} to jump tabs · ${cancel} to exit search`;
		}
		if (this.#currentTabId === "plugins") {
			return `${tab} to switch tabs · ${cancel} to close`;
		}
		if (this.#currentList?.sectionFocused) {
			return `${editorKeys("tui.select.up", "tui.select.down")} to jump sections · ${tab}/${confirm} to settings · ${switchTabs} · ${cancel} to close`;
		}
		const nav = this.#hasSectionJump ? `${tab} to jump sections · ${switchTabs}` : `${tab} to switch tabs`;
		return `${confirm}/${formatKeyHint("space")} to change · ${nav} · Type to search · ${cancel} to close`;
	}
```

Separator between hints is `·` (U+00B7 MIDDLE DOT).

### Key input, mouse, scrolling

`handleInput` (`settings-selector.ts:1886-1941`) is a strict priority cascade:

```ts
	handleInput(data: string): void {
		// SGR mouse reports (the fullscreen overlay enables tracking).
		if (data.startsWith("\x1b[<")) {
			this.#handleMouse(data);
			return;
		}

		// Text-input submenus take every byte: arrow keys must reach the
		// cursor and Tab must not switch tabs.
		if (this.#textInputActive) {
			(this.#searchList ?? this.#currentList)?.handleInput(data);
			return;
		}

		const activeList = this.#searchList ?? this.#currentList;

		// An open submenu owns input entirely — Tab/arrows/typing belong to it.
		if (activeList?.hasOpenSubmenu()) {
			activeList.handleInput(data);
			return;
		}

		if (this.#searchList) {
			this.#handleSearchModeInput(data, this.#searchList);
			return;
		}

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
		if (matchesKey(data, "left") || matchesKey(data, "right")) {
			this.#tabBar.handleInput(data);
			return;
		}

		// Printable characters start a search across every settings tab. The
		// plugins tab keeps its own local filtering instead.
		if (this.#currentTabId !== "plugins") {
			const printable = extractPrintableText(data);
			if (printable !== undefined && printable.trim().length > 0) {
				this.#startSearch(printable);
				return;
			}
		}

		if (this.#currentList) {
			this.#currentList.handleInput(data);
		} else if (this.#pluginComponent) {
			this.#pluginComponent.handleInput(data);
		}
	}
```

Mouse hit-testing uses **absolute screen rows** — the reason `fullscreen: true` matters:

```ts
// pi-tui/src/overlays/settings-selector.ts:1224-1262
	#routeMouseEvent(event: SgrMouseEvent): boolean {
		const list = this.#searchList ?? this.#currentList;
		// row() insets content by the border column plus a space.
		const contentColInset = 2;
		const innerCol = event.col - contentColInset;
		const contentLine = event.row - this.#contentRowStart;

		// An open submenu owns the pointer: wheel, hover, and clicks route into
		// it (text-input submenus ignore routed events).
		if (list?.hasOpenSubmenu()) {
			list.routeSubmenuMouse(event, contentLine, innerCol);
			return true;
		}

		const tabLine = event.row - this.#tabRowStart;
		const overTabs = tabLine >= 0 && tabLine < this.#tabRowCount;
		const overContent = contentLine >= 0 && contentLine < this.#contentRowCount;

		if (event.wheel !== null) {
			if (overContent) {
				list?.handleWheelAt(event.wheel, contentLine, innerCol);
			}
			return true;
		}

		if (event.motion) {
			const hovered = overTabs ? this.#tabBar.tabAt(tabLine, innerCol) : undefined;
			this.#tabBar.setHoverTab(hovered && !hovered.muted ? hovered.id : null);
			// hoverTest: never light up pane rows while the pointer is on the
			// sidebar — only rows the pointer is actually on.
			list?.setHoverItem(overContent ? (list.hoverTest(contentLine, innerCol) ?? null) : null);
			return true;
		}
		if (!event.leftClick) return true;

		if (overTabs) {
			const tab = this.#tabBar.tabAt(tabLine, innerCol);
			if (tab) this.#tabBar.selectTab(tab.id);
			return true;
		}
		if (overContent && list) {
			const itemId = list.hoverTest(contentLine, innerCol);
```

`#contentRowStart` / `#contentRowCount` / `#tabRowStart` / `#tabRowCount` are recorded during `render`
(`settings-selector.ts:745-748, 758-760`) with the comment:
`// Frame geometry from the last render, for mouse hit-testing (the fullscreen overlay paints from screen row 0, so mouse rows map 1:1).`

**Scrolling** is delegated entirely to `SettingsList`, which owns the viewport height via
`setMaxVisible(contentRows - 4)` and uses a `ScrollView` internally (see below).

### The shared chrome helpers (`pi-tui/src/chrome/overlay-box.ts`)

These are what every outlined overlay uses; our panel should use the same.

```ts
// pi-tui/src/chrome/overlay-box.ts:17-19
function paint(s: string, color: ThemeColor = "border"): string {
	return theme.fg(color, s);
}

/** Top border with an optional title inset into the rule. `color` recolors border and title (default border/accent). */
```

```ts
// pi-tui/src/chrome/overlay-box.ts:22-49
export function topBorder(width: number, title: string, color?: ThemeColor): string {
	const box = theme.boxRound;
	const inner = Math.max(0, width - 2);
	if (!title) return paint(box.topLeft + box.horizontal.repeat(inner) + box.topRight, color);
	const shown = truncateToWidth(` ${title} `, Math.max(0, inner - 2));
	const fillWidth = Math.max(0, inner - 1 - visibleWidth(shown));
	return (
		paint(box.topLeft + box.horizontal, color) +
		theme.bold(theme.fg(color ?? "accent", shown)) +
		paint(box.horizontal.repeat(fillWidth) + box.topRight, color)
	);
}

/** A horizontal rule with left/right tees, splitting overlay sections. */
export function divider(width: number): string {
	const box = theme.boxRound;
	return paint(box.teeRight + box.horizontal.repeat(Math.max(0, width - 2)) + box.teeLeft);
}

export function bottomBorder(width: number, color?: ThemeColor): string {
	const box = theme.boxRound;
	return paint(box.bottomLeft + box.horizontal.repeat(Math.max(0, width - 2)) + box.bottomRight, color);
}

/** Wrap pre-styled content in vertical borders with single-column insets. */
export function row(content: string, width: number, color?: ThemeColor): string {
	const box = theme.boxRound;
	return `${paint(box.vertical, color)} ${width > 4 ? padToWidth(content, width - 4) : ""} ${paint(box.vertical, color)}`;
}
```

**Content width is always `width - 4`** (one border column + one space on each side). That is the
`innerWidth = Math.max(1, width - 4)` at the top of both `render()` methods.

`OverlayPanel` (`overlay-box.ts:218`) is the *stateful* variant — header/body/footer regions — and is
what `/usage` uses:

```ts
// pi-tui/src/chrome/overlay-box.ts:309-342
	render(width: number): readonly string[] {
		width = Number.isFinite(width) ? Math.max(0, Math.trunc(width)) : 0;
		const innerWidth = Math.max(1, width - 4);
		// Children render every frame (renders may carry side effects); the memo
		// only skips re-wrapping unchanged rows in border chrome.
		const childLines = this.children.map(child =>
			child instanceof PanelDivider ? NO_LINES : child.render(innerWidth),
		);
		...
		const result: string[] = [topBorder(width, this.#title)];
		for (let i = 0; i < this.children.length; i++) {
			if (this.children[i] instanceof PanelDivider) {
				result.push(divider(width));
				continue;
			}
			for (const line of childLines[i] ?? NO_LINES) result.push(row(line, width));
		}
		result.push(bottomBorder(width));
		...
```

So the frame is literally: `topBorder` → for each child (a `PanelDivider` becomes a `divider`) → `bottomBorder`.
`PanelRows` (`overlay-box.ts:123`) is a mutable row region that clips/fills to an exact height — this is
how `/usage` pins a footer to one row and a body to `contentRows`.

### Section navigation

Not a separate pane in ANSI mode — sections are **heading rows inside the list**, and `Tab` toggles a
"section focus" mode where Up/Down jump section to section:

```ts
// pi-tui/src/components/settings-list.ts:822-827
		const sections = this.#sections();
		const splitLines =
			this.#options.layout !== "flat" && !this.#filterQuery.trim() && sections.length >= 2
				? this.#renderSplitList(width, sections)
				: null;
```

Sections come from `pi-tui/src/overlays/settings-defs.ts` (`TAB_GROUPS`, line 66) and the tab list from
`SETTING_TABS` (line 20) / `TAB_METADATA` (line 34) / `TAB_LEADS` (line 48).

---

## `/usage` anatomy

### Mount path, hop by hop, verbatim

**Hop 1** — slash command:

```ts
// coding-agent/src/slash-commands/builtin-session.ts:411-417
		handleTui: async (command, runtime) => {
			const { verb, rest } = parseSubcommand(command.args);
			if (!verb || (verb === "show" && !rest)) {
				await runtime.ctx.handleUsageCommand();
				clearSubmittedText(runtime);
				return;
			}
```

**Hop 2** — `command-controller.ts:655`:

```ts
// coding-agent/src/modes/controllers/command-controller.ts:655-673
	async handleUsageCommand(reports?: UsageReport[] | null): Promise<void> {
		let usageReports = reports ?? null;
		if (!usageReports) {
			const provider = this.ctx.session as { fetchUsageReports?: () => Promise<UsageReport[] | null> };
			if (!provider.fetchUsageReports) {
				this.ctx.showWarning("Usage reporting is not configured for this session.");
				return;
			}
			try {
				usageReports = await provider.fetchUsageReports();
			} catch (error) {
				this.ctx.showError(`Failed to fetch usage data: ${error instanceof Error ? error.message : String(error)}`);
			}
		}

		this.ctx.showUsageDashboard(usageReports ?? []);
	}
```

Note: it awaits the fetch **before** mounting, so the panel only appears once data is in hand.

**Hop 3** — `selector-controller.ts:347`:

```ts
// coding-agent/src/modes/controllers/selector-controller.ts:342-390
	/**
	 * Fullscreen `/usage` dashboard on the alternate screen (the /settings
	 * idiom): compact subscriptions grid + daily activity heatmap, with the
	 * classic full report one keypress away. Takes no transcript space.
	 */
	showUsageDashboard(reports: UsageReport[]): void {
		const authStorage = this.ctx.session.modelRegistry.authStorage;
		const accounts = selectReportableAccounts(
			collectStoredAccounts(authStorage),
			provider => authStorage.usage.providerFor(provider) !== undefined,
		);
		if (reports.length === 0 && accounts.length === 0) {
			this.ctx.showWarning("No usage data available.");
			return;
		}
		...
		const done = () => {
			overlayHandle?.hide();
			this.focusActiveEditorArea();
			this.ctx.ui.requestRender();
		};
		const dashboard = new UsageDashboardComponent({
			reports,
			unavailableAccounts,
			renderDetail: (width, current) =>
				renderUsageReports(
					current,
					theme,
					Date.now(),
					width,
					provider => (provider === currentProvider ? activeAccount : undefined),
					usageModelSelectors,
					unavailableAccounts,
				),
			loadActivity: loadDailyActivity,
			refresh: () => this.ctx.session.fetchUsageReports(),
			requestRender: () => this.ctx.ui.requestRender(),
			onClose: done,
		});
		const overlayHandle = this.#showFullscreenMenu(dashboard);
	}
```

**Hop 4** — the overlay options are the **same** `#showFullscreenMenu` as `/settings`:
`{ anchor: "bottom-center", width: "100%", maxHeight: "100%", margin: 0, fullscreen: true }`
(`selector-controller.ts:182-188`).

**`/usage` is fullscreen (alternate screen), identical mounting to `/settings`.** This is the single most
important structural fact: the two are siblings.

### Class + full options interface

```ts
// pi-tui/src/overlays/usage-dashboard.ts:482-500
/** Callbacks and data sources for {@link UsageDashboardComponent}. */
export interface UsageDashboardOptions {
	reports: UsageReport[];
	unavailableAccounts?: readonly UnavailableUsageAccount[];
	/**
	 * Full classic `/usage` report of `reports` (the latest refresh) for the
	 * expanded detail view; re-invoked per terminal width.
	 */
	renderDetail: (width: number, reports: UsageReport[]) => string;
	/**
	 * Stream daily activity into the heatmap: push cached DB rows immediately,
	 * then push again after an incremental session sync. Resolves when the sync
	 * settles; rejection renders as a dim unavailable note. `signal` aborts when
	 * the dashboard closes so an in-flight sync can stop early.
	 */
	loadActivity: (push: (points: DailyActivityPoint[]) => void, signal: AbortSignal) => Promise<void>;
	/** Re-fetch the usage reports (`r`); omitted when the host can't. Resolves null when nothing came back. */
	refresh?: () => Promise<UsageReport[] | null>;
	requestRender: () => void;
	onClose: () => void;
}
```

```ts
// pi-tui/src/overlays/usage-dashboard.ts:533-560 (head of class + ctor)
export class UsageDashboardComponent implements Component {
	/** The terminal draws the sheet: a large glass overlay titled Usage. */
	readonly nativeOverlay = { role: "omp.overlay.usage", size: "lg", anchor: "center", head: "Usage" } as const;
	#options: UsageDashboardOptions;
	#reports: UsageReport[];
	#cards: ProviderCard[];
	#nowMs: number;
	#refreshing = false;
	#refreshError: string | null = null;
	/** Bumped whenever anything the native description shows changes. */
	#revision = 0;
	#view: "overview" | "detail" = "overview";
	#scroll = 0;
	#activity: DailyActivityPoint[] | null = null;
	#activityError: string | null = null;
	#syncing = true;
	#detailCache: { width: number; lines: string[] } | null = null;
	#lastViewportRows = 10;
	#closed = false;
	readonly #panel: OverlayPanel;
	readonly #header: PanelRows;
	readonly #body: PanelRows;
	readonly #footer: PanelRows;
	readonly #closeController = new AbortController();
	#nativeCache: { revision: number; meter: boolean; chart: boolean; node: NativeNode } | undefined;

	constructor(options: UsageDashboardOptions) {
		ensureThemeSync();
		this.#options = options;
		this.#reports = options.reports;
		this.#nowMs = Date.now();
		this.#cards = buildProviderCards(this.#reports, this.#nowMs, options.unavailableAccounts);
		this.#panel = new OverlayPanel("Usage");
		this.#header = new PanelRows();
		this.#header.setHeight(1);
		this.#body = new PanelRows();
		this.#footer = new PanelRows();
		this.#footer.setHeight(1);
		this.#panel.addChild(this.#header);
		this.#panel.addChild(this.#body);
		this.#panel.addChild(new PanelDivider());
		this.#panel.addChild(this.#footer);
		void this.#loadActivity();
	}
```

Component methods: `render` (896), `invalidate` (593), `dispose` (598), `handleInput` (1367),
`describe*` (TSP only), `nativeOverlay`.

The panel is composed as **header / body / divider / footer** — exactly the frame shape we want:

```ts
this.#panel.addChild(this.#header);
this.#panel.addChild(this.#body);
this.#panel.addChild(new PanelDivider());
this.#panel.addChild(this.#footer);
```

### The frame (`render`, verbatim)

```ts
// pi-tui/src/overlays/usage-dashboard.ts:896-927
	render(width: number): readonly string[] {
		const height = Math.max(14, process.stdout.rows || 40);
		const innerWidth = Math.max(20, width - 4);

		const contentSource = this.#view === "detail" ? this.#detailLines(innerWidth) : this.#overviewLines(innerWidth);
		// Fixed chrome: top border, blank, content…, divider, hint, bottom border.
		const contentRows = Math.max(5, height - 5);
		this.#lastViewportRows = contentRows;
		const maxScroll = Math.max(0, contentSource.length - contentRows);
		if (this.#scroll > maxScroll) this.#scroll = maxScroll;

		const latestFetchedAt = Math.max(0, ...this.#reports.map(report => report.fetchedAt ?? 0));
		const checkedText = this.#refreshing
			? "refreshing…"
			: latestFetchedAt
				? `checked ${formatDuration(this.#nowMs - latestFetchedAt)} ago`
				: "";
		const title = this.#view === "detail" ? "Usage · Details" : "Usage";

		const scrollHint = maxScroll > 0 ? `${editorKeys("tui.select.up", "tui.select.down")} scroll · ` : "";
		const cancel = editorKey("tui.select.cancel");
		const refreshHint = this.#options.refresh ? "r refresh · " : "";
		const hint =
			this.#view === "detail"
				? `${scrollHint}${refreshHint}${cancel} back`
				: `${scrollHint}${refreshHint}${formatKeyHint("enter")} details · ${cancel} close`;
		this.#panel.title = title;
		this.#header.setLines([checkedText ? theme.fg("dim", checkedText) : ""]);
		this.#body.setLines(contentSource.slice(this.#scroll, this.#scroll + contentRows));
		this.#body.setHeight(contentRows);
		this.#footer.setLines([theme.fg("dim", hint)]);
		return this.#panel.render(width);
	}
```

Idiom worth stealing: **the title is mutated per view** (`"Usage"` → `"Usage · Details"`), the header
carries a live freshness stamp, and the footer hint is *conditionally composed* — the scroll hint only
appears when there is something to scroll, the refresh hint only when `refresh` exists.

### Detail-view toggle + scroll

```ts
// pi-tui/src/overlays/usage-dashboard.ts:1367-1405
	handleInput(data: string): void {
		if (
			routeSgrMouseInput(data, event => {
				if (event.wheel === null) return false;
				this.#scrollBy(event.wheel * 2);
				return true;
			})
		) {
			return;
		}
		if (matchesSelectCancel(data) || matchesKey(data, "q")) {
			if (this.#view === "detail") {
				this.#setView("overview");
				return;
			}
			this.dispose();
			this.#options.onClose();
			return;
		}
		if (matchesKey(data, "r")) {
			void this.#refresh();
			return;
		}
		if (
			this.#view === "overview" &&
			(matchesKey(data, "return") || matchesKey(data, "tab") || matchesKey(data, "d"))
		) {
			this.#setView("detail");
			return;
		}
		if (matchesSelectUp(data)) this.#scrollBy(-1);
		else if (matchesSelectDown(data)) this.#scrollBy(1);
		else if (matchesSelectPageUp(data)) this.#scrollBy(-this.#lastViewportRows);
		else if (matchesSelectPageDown(data)) this.#scrollBy(this.#lastViewportRows);
		else if (matchesKey(data, "home")) {
			this.#scroll = 0;
			this.#options.requestRender();
		} else if (matchesKey(data, "end")) this.#scrollBy(Number.MAX_SAFE_INTEGER);
	}
```

**Escape is two-level**: first Escape returns to overview, second Escape closes. `q` is a shortcut for
the same. Enter / Tab / `d` all toggle into the detail view.

```ts
// pi-tui/src/overlays/usage-dashboard.ts:1351-1364
	#changed(): void {
		this.#revision++;
		this.#options.requestRender();
	}

	#scrollBy(delta: number): void {
		this.#scroll = Math.max(0, this.#scroll + delta);
		this.#options.requestRender();
	}

	#setView(view: "overview" | "detail"): void {
		this.#view = view;
		this.#scroll = 0;
		this.#changed();
	}
```

There is **no clamping in `#scrollBy`** — clamping happens in `render` (`if (this.#scroll > maxScroll)`),
which also covers shrink-on-resize for free.

### Async data without blocking — the loading state

```ts
// pi-tui/src/overlays/usage-dashboard.ts:574-591
	async #loadActivity(): Promise<void> {
		try {
			await this.#options.loadActivity(points => {
				if (this.#closed) return;
				this.#activity = points;
				this.#changed();
			}, this.#closeController.signal);
		} catch (error) {
			this.#activityError = error instanceof Error ? error.message : String(error);
		} finally {
			this.#syncing = false;
			if (!this.#closed) this.#changed();
		}
	}
```

```ts
// pi-tui/src/overlays/usage-dashboard.ts:821-830
	#renderHeatmap(innerWidth: number): string[] {
		const summary: string[] = [];
		if (this.#activityError) {
			const detail = formatActivityErrorDetail(this.#activityError);
			return [theme.fg("dim", detail ? `Usage history unavailable (${detail}).` : "Usage history unavailable.")];
		}
		const points = this.#activity;
		if (!points) return [theme.fg("dim", "Loading usage history…")];
```

Three states, all rendered inline in place of the panel body — never a spinner:
1. `#activity === null` → `dim("Loading usage history…")`
2. `#activityError` → `dim("Usage history unavailable (<sanitized detail>).")`
3. loaded → the grid, with an inline `· syncing…` suffix on the summary line when `#syncing` is still true.

`dispose()` closes the abort controller so an in-flight worker dies with the panel:

```ts
// pi-tui/src/overlays/usage-dashboard.ts:598-602
	dispose(): void {
		this.#closed = true;
		this.#closeController.abort();
		this.#panel.dispose();
	}
```

### The subscriptions grid layout

**No CSS, no flexbox — pure integer column math on strings.** Constants:

```ts
// pi-tui/src/overlays/usage-dashboard.ts:525-529
const CARD_MIN_WIDTH = 32;
const CARD_GUTTER = 3;
const CARD_MAX_WINDOWS = 4;
const CARD_MIN_BAR_WIDTH = 12;
const CARD_MAX_LABEL_LINES = 2;
```

Column count is derived from content width, then card width from remainder:

```ts
// pi-tui/src/overlays/usage-dashboard.ts:713-717
	#renderCardsGrid(innerWidth: number): string[] {
		if (this.#cards.length === 0) return [theme.fg("dim", "No usage data available.")];
		const active = this.#cards.filter(card => !card.idle);
		const idle = this.#cards.filter(card => card.idle);
		const columns = Math.max(1, Math.floor((innerWidth + CARD_GUTTER) / (CARD_MIN_WIDTH + CARD_GUTTER)));
		const cardWidth = Math.floor((innerWidth - (columns - 1) * CARD_GUTTER) / columns);
```

Rendering is **row-major across cards**: each card produces an array of lines, then the grid zips them
side by side, padding each cell to `cardWidth` and joining with `CARD_GUTTER` spaces:

```ts
// pi-tui/src/overlays/usage-dashboard.ts:775-785
			const height = Math.max(...rowCards.map(card => card.length));
			for (let lineIdx = 0; lineIdx < height; lineIdx++) {
				const segments = rowCards.map(card => {
					const line = card[lineIdx] ?? "";
					return line + " ".repeat(Math.max(0, cardWidth - visibleWidth(line)));
				});
				lines.push(segments.join(" ".repeat(CARD_GUTTER)).trimEnd());
			}
			if (start + columns < active.length) lines.push("");
		}
```

Key refinement: **one geometry per grid row**, not per card — labels/bars/resets share column widths
across the whole row of cards, and if inline bars would fall below `CARD_MIN_BAR_WIDTH` the entire row
switches to stacked layout:

```ts
// pi-tui/src/overlays/usage-dashboard.ts:726-742
			// One geometry per grid row: labels, bars, and resets share columns,
			// and every card stacks together when inline bars would be too short.
			const labelWidth = labels.reduce(
				(max, rows) => rows.reduce((width, label) => Math.max(width, visibleWidth(label)), max),
				0,
			);
			const resetWidth = windows.reduce(
				(max, rows) =>
					rows.reduce(
						(width, window) =>
							Math.max(width, window.resetMs !== undefined ? formatDuration(window.resetMs).length : 0),
						max,
					),
				0,
			);
			const contentWidth = Math.max(1, cardWidth - 2);
			const suffixWidth = 5 + (resetWidth > 0 ? resetWidth + 1 : 0);
			const inlineBarWidth = contentWidth - labelWidth - 1 - suffixWidth;
			const stacked = inlineBarWidth < CARD_MIN_BAR_WIDTH;
```

Cards themselves are **not** bordered. A card is: a status-icon + bold title row, right-aligned
`N accts` dimmed, then `label  bar  pct  reset` rows indented two spaces.

### `#miniBar` — verbatim, with codepoints

```ts
// pi-tui/src/overlays/usage-dashboard.ts:622-630
	#miniBar(fraction: number | undefined, status: UsageLimit["status"], width: number): string {
		if (fraction === undefined) return theme.fg("dim", "·".repeat(width));
		const clamped = Math.min(Math.max(fraction, 0), 1);
		const filled = Math.round(clamped * width);
		const bar = "█".repeat(filled);
		const empty = "░".repeat(width - filled);
		return `${theme.fg(this.#statusColor(status), bar)}${theme.fg("dim", empty)}`;
	}
```

| Character | Codepoint | Name |
|---|---|---|
| `█` | **U+2588** | FULL BLOCK |
| `░` | **U+2591** | LIGHT SHADE |
| `·` | **U+00B7** | MIDDLE DOT |

Colors come from `#statusColor` (`usage-dashboard.ts:615-620`):
`exhausted → "error"`, `warning → "warning"`, `ok → "success"`, else `"dim"`; the empty track is always `dim`.

Note these are **hardcoded string literals, not theme symbols** — they bypass the ASCII preset entirely.

### The heat color ramp — `#heatRamp`, verbatim

```ts
// pi-tui/src/overlays/usage-dashboard.ts:799-825
	/** Truecolor ramp from the theme's background side toward its accent: level 1
	 * sits near-invisible, level 4 is the full accent, so cell brightness reads
	 * as amount of work. Anchored to black or white by the text color's luma so
	 * the ramp keeps its direction on light themes. */
	#heatRamp(): string[] {
		const mode = theme.getColorMode();
		const darkBackground = (colorLuma(theme.getColorHex("text")) ?? 1) > 0.5;
		const from = darkBackground ? { r: 20, g: 20, b: 24 } : { r: 244, g: 244, b: 246 };
		const to = hexToRgb(theme.getColorHex("accent"));
		return [0.3, 0.5, 0.72, 1].map(t =>
			colorToAnsi(
				rgbToHex({
					r: Math.round(from.r + (to.r - from.r) * t),
					g: Math.round(from.g + (to.g - from.g) * t),
					b: Math.round(from.b + (to.b - from.b) * t),
				}),
				mode,
			),
		);
	}
```

Four stops at `t = 0.3, 0.5, 0.72, 1.0` (level 0 is *not* in the ramp — it is drawn as a dim `·`).
It interpolates from a near-background anchor (`#141418` dark / `#f4f4f6` light, chosen by the
luma of the theme's `text` color) to the theme's `accent` hex, then emits SGR via
`colorToAnsi(hex, theme.getColorMode())` — so it degrades to 256-color automatically.

### The heatmap cell rendering

```ts
// pi-tui/src/overlays/usage-dashboard.ts:822-872 (tail of #renderHeatmap)
		const labelWidth = 2;
		const weeks = Math.max(4, Math.min(53, Math.floor((innerWidth - labelWidth) / 2)));
		const layout = buildHeatmapLayout(points, weeks);
		const ramp = this.#heatRamp();
		const reset = "\x1b[39m";
		...
		let monthLine = " ".repeat(labelWidth);
		for (let week = 0; week < weeks; week++) {
			const label = layout.monthLabels[week];
			const targetCol = labelWidth + week * 2;
			if (label && targetCol >= visibleWidth(monthLine)) {
				monthLine = monthLine.padEnd(targetCol) + label;
			}
		}
		summary.push(theme.fg("dim", truncateToWidth(monthLine, innerWidth)));

		for (let day = 0; day < 7; day++) {
			let line = theme.fg("dim", HEATMAP_DAY_LABELS[day]) + " ";
			for (let week = 0; week < weeks; week++) {
				const cell = layout.cells[day][week];
				if (cell === null) line += "  ";
				else if (cell === 0) line += `${theme.fg("dim", "·")} `;
				else line += `${ramp[cell - 1]}■${reset} `;
			}
			summary.push(line.trimEnd());
		}
		return summary;
```

Layout facts, exactly:
- **Cell width is 2 columns** (`■` + a trailing space). Week count: `clamp(floor((innerWidth - 2) / 2), 4, 53)`.
- **Row labels** occupy 2 columns, one of `HEATMAP_DAY_LABELS` (`["M","T","W","T","F","S","S"]`, `usage-dashboard.ts:293`).
- **Month labels** are placed by *padEnd to the target column* — a month name is only written if it
  starts at or past the end of the previous one, so labels never overlap.
- **Three cell states**: `null` (future day) → two spaces; `0` (no activity) → `dim("·") `; `1..4` →
  `${ramp[cell-1]}■\x1b[39m `.
- The reset is a raw `"\x1b[39m"` (FG reset only, imported as `FG_RESET` semantics) rather than
  `theme.fg("dim", …)` per cell, so it does not pay theme lookups 53×7 times per frame.

### `buildHeatmapLayout` — fully readable, directly reusable

```ts
// pi-tui/src/overlays/usage-dashboard.ts:281-290
export interface HeatmapLayout {
	/** Per week column: short month name when the column starts a new month. */
	monthLabels: (string | undefined)[];
	/** 7 rows (Mon..Sun) × N week columns; 0..4 intensity, null = future day. */
	cells: (number | null)[][];
	totalCost: number;
	totalRequests: number;
	/** Local midnight of the first cell (column 0, Monday). */
	start: Date;
}
```

```ts
// pi-tui/src/overlays/usage-dashboard.ts:292-311
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const HEATMAP_DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

function localIso(date: Date): string {
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${date.getFullYear()}-${month}-${day}`;
}

function addDays(date: Date, days: number): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}
```

```ts
// pi-tui/src/overlays/usage-dashboard.ts:304-362
/**
 * Lay out daily activity into a Monday-first week grid ending at `today`'s
 * week. Intensity levels are magnitude-scaled against the busiest day
 * (square-root compressed so mid-size days stay distinguishable from
 * outliers), over per-day cost — falling back to request counts when nothing
 * in range has priced usage. Unlike GitHub's rank quartiles, intensity tracks
 * *how much* work a day carried.
 */
export function buildHeatmapLayout(points: DailyActivityPoint[], weeks: number, today = new Date()): HeatmapLayout {
	const byDay = new Map(points.map(point => [point.day, point]));
	const anyCost = points.some(point => point.cost > 0);
	const metric = (point: DailyActivityPoint): number => (anyCost ? point.cost : point.requests);

	const today0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
	const mondayOffset = (today0.getDay() + 6) % 7;
	const currentMonday = addDays(today0, -mondayOffset);
	const start = addDays(currentMonday, -(weeks - 1) * 7);
	const startIso = localIso(start);
	const todayIso = localIso(today0);

	const inRange = points.filter(point => point.day >= startIso && point.day <= todayIso);
	const max = inRange.reduce((acc, point) => Math.max(acc, metric(point)), 0);
	const level = (value: number): number => {
		if (value <= 0 || max <= 0) return 0;
		return Math.min(4, Math.max(1, Math.ceil(Math.sqrt(value / max) * 4)));
	};

	const monthLabels: (string | undefined)[] = [];
	const cells: (number | null)[][] = Array.from({ length: 7 }, () =>
		Array.from({ length: weeks }, (): number | null => null),
	);
	let previousMonth = -1;
	for (let week = 0; week < weeks; week++) {
		const weekStart = addDays(start, week * 7);
		const month = weekStart.getMonth();
		monthLabels.push(month !== previousMonth ? MONTH_NAMES[month] : undefined);
		previousMonth = month;
		for (let day = 0; day < 7; day++) {
			const date = addDays(weekStart, day);
			if (date > today0) continue;
			const point = byDay.get(localIso(date));
			cells[day][week] = level(point ? metric(point) : 0);
		}
	}

	return {
		monthLabels,
		cells,
		totalCost: inRange.reduce((sum, point) => sum + point.cost, 0),
		totalRequests: inRange.reduce((sum, point) => sum + point.requests, 0),
		start,
	};
}
```

**Signature**: `buildHeatmapLayout(points: DailyActivityPoint[], weeks: number, today = new Date()): HeatmapLayout`

**Input shape** — `DailyActivityPoint` (`usage-dashboard.ts:49-53`), note it is imported from
`@oh-my-pi/omp-stats/shared-types` in the coding-agent side, i.e. it is already our type:

```ts
/** Local calendar-day activity consumed by the usage heatmap. */
export interface DailyActivityPoint {
	day: string;
	cost: number;
	requests: number;
}
```

**Returns** `{ monthLabels: (string|undefined)[weeks], cells: (number|null)[7][weeks], totalCost, totalRequests, start: Date }`.

Design decisions worth copying:
- `cells` is indexed `[day][week]` (row-major by weekday), `null` = future/not-yet-rendered.
- Monday-first: `mondayOffset = (today0.getDay() + 6) % 7`.
- Intensity is **magnitude**, not rank quartile: `ceil(sqrt(value/max) * 4)`, clamped to 1..4.
- Metric falls back from `cost` to `requests` when no point in range has priced usage.
- All date math is **local-timezone** via `new Date(y, m, d + n)`, and day keys are `YYYY-MM-DD` strings
  (lexicographically sortable — that's why the range filter is a string compare).
- `totalCost`/`totalRequests` are computed over `inRange` only, so the header number matches the grid.

### `usage-display.ts` and `usage-row.ts`

- `pi-tui/src/overlays/usage-display.ts` (118 lines) — pure **formatting helpers**, no components:
  `formatLimitTitle` (line 4), `formatUsageResetWindow` (29), `UsageResetSummary` (46),
  `summarizeUsageResetCredits` (~59). Reused by the dashboard (`usage-dashboard.ts:22-27`).
- `pi-tui/src/overlays/usage-row.ts` (254 lines) — per-turn usage, a `Container` of `MetricRow`s
  (`components/metric.ts`), plus `TurnUsageTally` (line 60) and `turnElapsedMs` (line 31). This is the
  transcript-embedded variant, not the overlay.

---

## Other first-party full-screen in-TUI apps (`pi-tui/src/apps/`)

Full inventory:

| File | Size | What |
|---|---|---|
| `ps-top.ts` | 27.8K | interactive process monitor, fullscreen |
| `git/git-tui.ts` | 42.4K | `omp git` — repo TUI, fullscreen |
| `autoresearch-dashboard.ts` | 32.8K | experiment dashboard |
| `cleanse-board.ts` | 19.8K | board view |
| `if-bench-board.ts` | 11.0K | benchmark board |
| `live-visualizer.ts` | 10.3K | mic/call visualizer, uses `OverlayPanel` |
| `ps-data.ts`, `autoresearch-data.ts`, `cleanse-picker.ts` | — | data sources / small pickers |
| `session-picker.ts`, `standalone-picker.ts`, `setup-model-picker.ts` | — | pickers |
| `debug/` | — | protocol probes, terminal info |
| `git/{sidebar,diff-pane,avatar,colors,help,state}.ts` | — | git sub-panes |

### `git-tui.ts` overlay mount, verbatim

```ts
// pi-tui/src/apps/git/git-tui.ts:1206-1229
/**
 * Mount the git TUI as a fullscreen overlay on an existing TUI (the `/git`
 * slash command). Resolves when the user closes it; the caller restores focus.
 */
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

`GitTuiComponent` implements `constructor(ui, host)` (192), `dispose` (228), `handleInput` (614),
`render` (745), `describe` (902). It runs its own `run()` promise rather than relying on
`onClose` — the `finally` block is the dismissal discipline.

`ps-top.ts` uses the same shape with `anchor: "top-left"` and `mouseTracking: false`
(`ps-top.ts:843-853`). `session-picker.ts:81-95` documents *why* top-left is chosen:

```ts
		// Present as a fullscreen overlay so the picker borrows the terminal's
		// alternate screen buffer (vim/less idiom): the list scrolls and rows are
		// clickable via the mouse tracking the overlay enables for its lifetime.
		// Anchored top-left at full size so a mouse row maps directly to a rendered
		// line (the overlay paints from screen row 0).
```

### Best structural template: **`/usage` (`UsageDashboardComponent`), not `/settings`**

| Criterion | `/settings` | `/usage` | Winner |
|---|---|---|---|
| Data-heavy | no — a settings form | yes — cards + grid | `/usage` |
| Read-only | no — mutates config | yes — no state writes | `/usage` |
| Async data w/ loading states | theme list only | streaming loader + error state + refresh | `/usage` |
| Scrolling | delegated to a child list widget | self-managed `#scroll`, clamped in `render` | `/usage` |
| View toggle | tabs | overview ⇄ detail | both |
| Overlay panel abstraction | manual `topBorder/row/bottomBorder` | `OverlayPanel` + `PanelRows` regions | `/usage` |
| Mouse | full hit-testing incl. hover | wheel only | n/a for us |
| Footer hints | yes | yes | tie |

**Verdict**: copy `UsageDashboardComponent`. Take `SettingsSelectorComponent`'s *frame composition*
(tab strip, divider, pinned footer, footer-hint-from-real-keybindings) if we ever need section nav, and
`SettingsList`'s scroll/description-pad discipline for any list we do add.

---

## Terminal capability detection

### What exists

**Color depth** — `pi-tui/src/theme/color.ts:14-19`:

```ts
/** Resolve theme color depth from the shared terminal capability model. */
export function detectColorMode(env: NodeJS.ProcessEnv = Bun.env): ColorMode {
	if (env.WT_SESSION) return "truecolor";
	const terminal = getTerminalInfo(detectTerminalId(env), process.platform, env);
	return terminal.trueColor ? "truecolor" : "256color";
}
```

Only **two** modes exist — `ColorMode = "truecolor" | "256color"` (`pi-tui/src/theme/schema.ts:201`).
There is **no 16-color mode**. `theme.getColorMode()` is the runtime accessor. Ansi formatting:

```ts
// pi-tui/src/theme/color.ts:33
	const format = mode === "truecolor" ? "ansi-16m" : "ansi-256";
```

**Terminal identification** — `pi-tui/src/terminal-capabilities.ts`:

```ts
// :718
export function detectTerminalId(env: NodeJS.ProcessEnv = Bun.env): TerminalId {
// :774
export const TERMINAL_ID: TerminalId = detectTerminalId(Bun.env);
// :799
export const TERMINAL: RuntimeTerminal = (() => { … })();
```

`TerminalInfo` (`:138-155`) is the capability record: `imageProtocol`, `trueColor`, `hyperlinks`,
`notifyProtocol`, `deccara`, `supportsScreenToScrollback`, `supportsTextSizing`, `hangulJamoWidth`.
**There is no `nerdFont` or `unicode` capability field.** Detection reads `TERM`, `TERM_PROGRAM`,
`TERM_PROGRAM_VERSION`, `COLORTERM` (`:748`, `:768-769`):

```ts
	if (COLORTERM) {
		if (caseEq(COLORTERM, "truecolor") || caseEq(COLORTERM, "24bit")) return "trueColor";
```

### The answer to "may I draw fancy glyphs?" — **the symbol preset, not detection**

There is **no capability probe for a Nerd Font**. The mechanism is a **user setting** wired into the
theme, and the correct call for an extension is `theme.symbol(key)` / `theme.getSymbolPreset()`:

```ts
// pi-tui/src/theme/theme-class.ts:459-479
	/**
	 * Get a symbol from the active preset.
	 */
	symbol(key: SymbolKey): string {
		return this.#symbols[key];
	}

	/**
	 * Get a symbol styled with a color.
	 */
	styledSymbol(key: SymbolKey, color: ThemeColor): string {
		return this.fg(color, this.#symbols[key]);
	}

	/**
	 * Get the current symbol preset.
	 */
	getSymbolPreset(): SymbolPreset {
		return this.symbolPreset;
	}
```

```ts
// pi-tui/src/theme/symbols.ts:5
export type SymbolPreset = "unicode" | "nerd" | "ascii";
// :1461
export const SYMBOL_PRESETS: Record<SymbolPreset, SymbolMap> = {
```

Plus category accessors for the common ones (`theme-class.ts:485+`):

```ts
	get status() {
		return {
			success: this.#symbols["status.success"],
			error: this.#symbols["status.error"],
			warning: this.#symbols["status.warning"],
			info: this.#symbols["status.info"],
			pending: this.#symbols["status.pending"],
			disabled: this.#symbols["status.disabled"],
```

and `theme.boxRound` (a whole glyph map: `topLeft/topRight/bottomLeft/bottomRight/horizontal/vertical`)
plus `theme.boxSharp` and `theme.boxDotted`.

The user-facing setting is `symbolPreset` in `coding-agent/src/modes/settings.ts:88-110` (quoted in
§`/settings` above), applied via `effect(cfgSymbolPreset, setSymbolPreset)`:

```ts
// pi-tui/src/theme/theme.ts:325-344
/**
 * Set the symbol preset override, recreating the theme with the new preset.
 */
export async function setSymbolPreset(preset: SymbolPreset): Promise<void> {
	currentSymbolPresetOverride = preset;
	if (!currentThemeName) return;

	const requestId = ++themeLoadRequestId;
	try {
		const loadedTheme = await loadTheme(currentThemeName, getCurrentThemeOptions());
		if (requestId !== themeLoadRequestId) return;
		assignTheme(loadedTheme);
	} catch {
		if (requestId !== themeLoadRequestId) return;
		// Fall back to dark theme with new preset
		assignTheme(await loadTheme("dark", getCurrentThemeOptions()));
		if (requestId !== themeLoadRequestId) return;
	}
	notifyThemeChange({ ephemeral: true });
}
```

**There is no `unicode`-vs-`ascii` *auto*-detection.** Default is `"unicode"` and the user opts into
`ascii`. That is the whole fallback story.

### Glyph Protocol — the one true nerd-font-ish capability

`pi-tui/src/glyph-protocol.ts` ships icons *in-band* to terminals that support the rio Glyph Protocol,
so PUA codepoints render even without a patched font:

```ts
// pi-tui/src/glyph-protocol.ts:44-45
export const GLYPH_CONFIRMATION_CODEPOINT = 0xf0d57;

// :57
/** Whether `cp` lies in one of the three Private Use Areas the protocol accepts. */
export function isPrivateUseCodepoint(cp: number): boolean {
	return (cp >= 0xe000 && cp <= 0xf8ff) || (cp >= 0xf0000 && cp <= 0xffffd) || (cp >= 0x100000 && cp <= 0x10fffd);
}
```

The runtime flag is `TERMINAL.glyphProtocol`, mutated by:

```ts
// pi-tui/src/terminal-capabilities.ts:855
export function setTerminalGlyphProtocol(supported: boolean): void {
	TERMINAL.glyphProtocol = supported;
}
```

It gates the *setup wizard*, not rendering:

```ts
// pi-tui/src/setup/scenes/glyph.ts:137-142
export const glyphSetupScene: SetupScene = {
	id: "glyph-mode",
	title: "Choose glyph mode",
	minVersion: 1,
	shouldRun: () => !TERMINAL.glyphProtocol,
	mount: host => new GlyphSceneController(host),
};
```

When the handshake succeeds the terminal auto-upgrades the preset. From
`coding-agent/src/modes/interactive-mode.ts:2460-2464`:

```
// this terminal without a Nerd Font, so the unconfigured `unicode` preset
...
this.ui.terminal.onGlyphProtocolReport?.(supported => {
```

and `native/backend.ts:350` `#useNerdSymbols(on)` (Tern terminals always have the glyphs).

### `NO_COLOR`

Only **one** real use, and it gates hyperlinks, not glyphs or color in general:

```ts
// pi-tui/src/render/hyperlink.ts:94-95
	// runtime flag that applyHyperlinkSetting overwrites) and NO_COLOR.
	if (Bun.env.NO_COLOR) return false;
```

`NO_COLOR` is **NOT FOUND** as a gate on `theme.fg` / symbol selection.

### `PI_TUI_RESIZE_IN_PLACE`

Not asked but adjacent — `pi-tui/src/tui.ts:106`:

```
 * `PI_TUI_RESIZE_IN_PLACE=1|true` forces in-place resize (no alt-buffer borrow).
```

Relevant because our panel runs on the alt screen; resize handling differs.

### Verdict for the extension

**Do not hand-roll a glyph capability check. There isn't one to call.** Instead:

1. Draw all chrome through `theme.boxRound` / `theme.boxSharp` / `theme.symbol(...)` — these are
   preset-aware and fall back to `+ - | > [ok]` under `ascii` automatically.
2. Read `theme.getSymbolPreset()` if you need to branch (`=== "ascii"` ⇒ avoid block-drawing entirely).
3. Read `theme.getColorMode()` before emitting any interpolated hex; pass it to `colorToAnsi`.

**Important exception, learned from `/usage`:** `#miniBar` (`█`/`░`) and the heatmap's `■` are
**hardcoded**, not theme symbols — they do *not* respect the ascii preset. If our panel wants ASCII
safety for bars, we must either gate them ourselves on `theme.getSymbolPreset()` or reuse
`theme.progress.filled` / `theme.progress.empty` (`━` U+2501 / `─` U+2500, which *do* fall back to
`=`/`-`).

---

## Unicode/box-drawing in use

Codepoints were obtained by importing the real module and printing `[...s].map(c => c.codePointAt(0))`
via `bun -e` against `pi-tui/src/theme/symbols.ts`, and by printing each literal with `bun -e`
`'█'.codePointAt(0)`. Every table below is measured, not recalled.

### Preset-aware symbols (first-party call sites everywhere)

Measured from `SYMBOL_PRESETS` in `pi-tui/src/theme/symbols.ts`:

| Key | unicode | nerd | ascii |
|---|---|---|---|
| `boxRound.topLeft` | `╭` U+256D | `╭` U+256D | `+` U+002B |
| `boxRound.topRight` | `╮` U+256E | `╮` U+256E | `+` |
| `boxRound.bottomLeft` | `╰` U+2570 | `╰` U+2570 | `+` |
| `boxRound.bottomRight` | `╯` U+256F | `╯` U+256F | `+` |
| `boxRound.horizontal` | `─` U+2500 | `─` U+2500 | `-` U+002D |
| `boxRound.vertical` | `│` U+2502 | `│` U+2502 | `\|` U+007C |
| `boxSharp.cross` | `┼` U+253C | `┼` U+253C | `+` |
| `boxSharp.teeDown` | `┬` U+252C | `┬` U+252C | `+` |
| `boxSharp.teeUp` | `┴` U+2534 | `┴` U+2534 | `+` |
| `boxSharp.teeRight` | `├` U+251C | `├` U+251C | `+` |
| `boxSharp.teeLeft` | `┤` U+2524 | `┤` U+2524 | `+` |
| `progress.filled` | `━` U+2501 | `━` U+2501 | `=` U+003D |
| `progress.empty` | `─` U+2500 | `─` U+2500 | `-` |
| `status.success` | `✔` U+2714 | U+F00C | `[ok]` |
| `status.error` | `✘` U+2718 | U+F00D | `[!!]` |
| `status.warning` | `⚠` U+26A0 | U+F12A | `[!]` |
| `status.info` | `ⓘ` U+24D8 | U+F129 | `[i]` |
| `nav.cursor` | `❯` U+276F | U+F054 | `>` U+003E |
| `nav.selected` | `➤` U+27A4 | U+F178 | `->` |

Note box-drawing is **identical** between `unicode` and `nerd` — only status/icon glyphs differ.

### Hardcoded literals with real call sites (bypass the preset)

| Char | Codepoint | Call site | Purpose |
|---|---|---|---|
| `█` | U+2588 | `usage-dashboard.ts:626` (`#miniBar`), `chrome/qrcode.ts:534,562`, `apps/git/avatar.ts:26` | bar fill, half-block raster |
| `░` | U+2591 | `usage-dashboard.ts:627` (`#miniBar` empty track) | bar track |
| `▀` | U+2580 | `chrome/qrcode.ts:534,562`, `apps/git/avatar.ts:26` | upper half block |
| `▄` | U+2584 | same | lower half block |
| `■` | U+25A0 | `usage-dashboard.ts:869` | heatmap cell |
| `·` | U+00B7 | `usage-dashboard.ts:624,868`; hint separator in both `/settings` and `/usage` footers | empty bar / empty heat cell / hint delimiter |
| `●` | U+25CF | `usage-dashboard.ts:382` (`statusDot`) | native status dot |
| `✦` | U+2726 | `usage-dashboard.ts:653` | reset-credit marker |
| `…` | U+2026 | `Ellipsis`, `truncateToWidth` everywhere | truncation |
| `▁ ▂ ▃ ▄ ▅ ▆ ▇` | U+2581…U+2587 | `apps/live-visualizer.ts:41` (`SPECTRUM_BLOCKS`) | audio spectrum sparkline |
| ` ` (space) | — | `apps/live-visualizer.ts:41` | spectrum floor (index 0) |

The **only** vertical-bar sparkline idiom in the codebase is:

```ts
// pi-tui/src/apps/live-visualizer.ts:41
const SPECTRUM_BLOCKS = [" ", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const;
```

That is the pattern to copy for a per-day/per-hour bar chart: **9 levels, one column each, ramp from a
space floor to a full block.** Verified no other sparkline helper exists (`grep` for `▁`/`▂`/…/
`SPARK`/`sparkline` returned only these three files).

`⎯` / braille (`⣿` U+28FF, `⠁` U+2801) — **NOT FOUND** in first-party code. Don't reach for them;
`█`/`░` is the house style.

### Rules the codebase actually follows

1. **Never hand-write box-drawing in overlay chrome.** Use `theme.boxRound.*` via
   `topBorder/divider/bottomBorder/row` from `pi-tui/src/chrome/overlay-box.ts`.
2. **Use theme symbols for status** (`theme.status.*`, `theme.symbol("icon.search")`) so the ascii preset
   works.
3. **Hardcoded block glyphs are acceptable only for dense data** (bars, heatmap, spectrum) where a
   fallback would break the layout — and the `/usage` authors accepted that tradeoff.
4. **Two-column cells** (`■` + space) are the established pitch for heatmaps; bars are 1-column.

---

## Copy-this patterns

1. **Mount identically to `/settings` and `/usage`** — one helper, one options object:
   ```ts
   ui.showOverlay(component, {
       anchor: "bottom-center",
       width: "100%",
       maxHeight: "100%",
       margin: 0,
       fullscreen: true,
   });
   ui.setFocus(component);
   ```
   Omit `mouseTracking` unless you need clicks (default is on).
2. **Frame via `OverlayPanel` + `PanelRows`**, not manual borders. Header (1 row), body (N rows),
   `PanelDivider`, footer (1 row). This gives you the title, the `├───┤` separator and the pinned
   footer for free, and re-renders only when children actually change.
3. **`const height = Math.max(14, process.stdout.rows || 40)`; `const innerWidth = Math.max(N, width - 4)`** —
   read the height from `process.stdout`, not from a prop. Compute fixed chrome rows first, give the
   remainder to content.
4. **Clamp scroll inside `render`**, never in the key handler — then resize-shrink is automatic.
5. **Escape is two-level** (detail → overview → close), with `q` aliased to cancel.
6. **Footer hints built from `editorKey`/`editorKeys`/`formatKeyHint`/`formatKeyHints`**, joined with `·`,
   and *conditionally* included (scroll hint only when scrollable, refresh hint only when refreshable).
7. **Async loads never block the mount.** Render a `dim` loading line, stream via `push()` + a
   `requestRender()` callback, hold an `AbortController` and abort it in `dispose()`.
8. **Cache expensive sub-renders by width** — `usage-dashboard.ts:884-891`:
   ```ts
   	#detailLines(innerWidth: number): string[] {
   		if (this.#detailCache?.width !== innerWidth) {
   			this.#detailCache = {
   				width: innerWidth,
   				lines: this.#options.renderDetail(innerWidth, this.#reports).split("\n"),
   			};
   		}
   		return this.#detailCache.lines;
   	}
   ```
9. **Record frame geometry during `render`** if you need mouse hit-testing; only valid because
   `fullscreen: true` paints from screen row 0.
10. **A card grid is integer math, not layout** — `columns = floor((w + gutter) / (minW + gutter))`,
    then row-major zip with per-cell pad and a gutter join.
11. **Reuse `buildHeatmapLayout` directly** if the metric is daily activity; it is exported and the
    input type already lives in `@oh-my-pi/omp-stats/shared-types`.
12. **Use `theme.symbol` / `theme.boxRound` for anything decorative; hardcode `█░■` only for dense
    data marks.** Gate on `theme.getSymbolPreset()` if ASCII safety matters more than layout.
13. **Sanitize anything that came from a DB or a subprocess** before display —
    `formatActivityErrorDetail` (`usage-dashboard.ts:511-525`) and `sanitizeDisplayLine`
    (`pi-tui/src/overlays/extensions/display-text.ts`).
14. **Mutation signal is a counter + `requestRender()`** (`#changed()` at `usage-dashboard.ts:1351`),
    not diffing or event emitters.

### The extension mount path

Extensions do not get `showOverlay` directly; they get `ctx.ui.custom()`:

```ts
// coding-agent/src/extensibility/extensions/types.ts:242-252
/** Options for `ExtensionUIContext.custom()` (overlay rendering of a custom component). */
export interface ExtensionCustomOptions {
	/** Render the component as an overlay over the transcript instead of replacing the editor area. */
	overlay?: boolean;
	/** Static or lazily resolved overlay positioning/sizing options forwarded to `showOverlay`. */
	overlayOptions?: OverlayOptions | (() => OverlayOptions);
	/** Invoked with the overlay handle once the overlay is created (overlay mode only). */
	onHandle?: (handle: OverlayHandle) => void;
	/** Abort the custom UI and reject its promise. */
	signal?: AbortSignal;
}
```

```ts
// coding-agent/src/extensibility/extensions/types.ts:312-321
	/** Show a custom component with keyboard focus. */
	custom<T>(
		factory: (
			tui: TUI,
			theme: Theme,
			keybindings: KeybindingsManager,
			done: (result: T) => void,
		) => ExtensionUiComponent | Promise<ExtensionUiComponent>,
		options?: ExtensionCustomOptions,
	): Promise<T>;
```

So the extension path is:

```ts
await ctx.ui.custom(
    (tui, theme) => new StatsPanel(tui, theme, deps, /* done */),
    {
        overlay: true,
        overlayOptions: {
            anchor: "bottom-center",
            width: "100%",
            maxHeight: "100%",
            margin: 0,
            fullscreen: true,
        },
        onHandle: handle => { /* keep for hide() */ },
        signal,
    },
);
```

The factory already receives the live `tui` and `theme`, so `theme` need not be re-imported.

### `OverlayOptions` reference (`pi-tui/src/tui.ts:424-474`)

```ts
export interface OverlayOptions {
	// === Sizing ===
	/** Width in columns, or percentage of terminal width (e.g., "50%") */
	width?: SizeValue;
	/** Minimum width in columns */
	minWidth?: number;
	/** Maximum height in rows, or percentage of terminal height (e.g., "50%") */
	maxHeight?: SizeValue;

	// === Positioning - anchor-based ===
	/** Anchor point for positioning (default: 'center') */
	anchor?: OverlayAnchor;
	/** Horizontal offset from anchor position (positive = right) */
	offsetX?: number;
	/** Vertical offset from anchor position (positive = down) */
	offsetY?: number;

	// === Positioning - percentage or absolute ===
	/** Row position: absolute number, or percentage (e.g., "25%" = 25% from top) */
	row?: SizeValue;
	/** Column position: absolute number, or percentage (e.g., "50%" = centered horizontally) */
	col?: SizeValue;

	// === Margin from terminal edges */
	/** Margin from terminal edges. Number applies to all sides. */
	margin?: OverlayMargin | number;

	// === Visibility ===
	visible?: (termWidth: number, termHeight: number) => boolean;

	// === Fullscreen ===
	/**
	 * Borrow the terminal's alternate screen buffer for this overlay's lifetime
	 * (vim/less idiom). While the topmost visible overlay sets this, the engine
	 * paints only the modal on the alt screen and emits no ED3 / scrollback
	 * bytes, so the transcript on the normal screen stays untouched and is not
	 * scrollable behind the modal. Defaults off — all other overlays are
	 * unchanged and still draw over the transcript on the normal screen.
	 */
	fullscreen?: boolean;
	/**
	 * Enable terminal mouse reporting while fullscreen. Defaults on; disable it
	 * when native terminal text selection takes precedence over pointer events.
	 */
	mouseTracking?: boolean;
}
```

And `OverlayHandle` (`tui.ts:479-486`) — `hide()` (permanent, restores focus), `setHidden(bool)`, `isHidden()`.

`showOverlay` itself (`tui.ts:1188-1198`) does three things worth noting:

```ts
	showOverlay(component: Component, options?: OverlayOptions): OverlayHandle {
		component.setIgnoreTight?.(true);
		const entry = { component, options, preFocus: this.#focusedComponent, hidden: false, released: false };
		this.overlayStack.push(entry);
		// Only focus if overlay is actually visible
		if (this.#isOverlayVisible(entry)) {
			this.setFocus(component);
		}
		this.terminal.hideCursor();
		this.#recordHardwareCursorHidden();
		this.requestRender();
```

It auto-focuses, so an explicit `ui.setFocus(component)` (as `/settings` and `/git` both do) is
belt-and-braces, and **`hide()` restores `preFocus` for you** — so our `onClose` need only call `hide()`
plus, if we want the editor focused, `focusActiveEditorArea()` like the built-ins do.

### `Component` contract (`pi-tui/src/tui.ts:229-320`) — required vs optional

**Required**: `render(width: number): readonly string[]`.

**Optional, in rough value order for a stats panel**:
`handleInput?(data)` (keys), `invalidate?()` (theme change / full repaint),
`dispose?()` (timers, subscriptions — "Must be idempotent"), `setIgnoreTight?(ignore)`,
`debugState?()` / `debugId` / `debugKind` (the `/debug` tree), `debugChildren?`.

Render contract worth honoring: *"an unchanged component may (and should) return the same array reference
it returned last time."* Both built-ins memoize — `OverlayPanel` on `(width, title, children, childLines)`
(`overlay-box.ts:309-342`), `SettingsList`/`PanelRows` similarly. Our panel should too, or we will
re-emit the whole frame every tick.

`describe()` / `nativeOverlay` / `nativeSheet()` / `describeScreen()` are the Tern Surface Protocol path —
only invoked when a native backend is active. Ignore for ANSI.

### `SettingsList` — yes it exists, and its exact interface

`pi-tui/src/components/settings-list.ts`:

```ts
// :36-58
export interface SettingItem {
	/** Unique identifier for this setting */
	id: string;
	/** Display label (left side) */
	label: string;
	/** Optional description shown when selected */
	description?: string;
	/** Optional risk note shown in warning styling above the description, with a glyph on the row. */
	warning?: string;
	/** Current value to display (right side) */
	currentValue: string;
	/** If provided, Enter/Space cycles through these values */
	values?: string[];
	/** If provided, Enter opens this submenu. Receives current value and done callback. */
	submenu?: (currentValue: string, done: (selectedValue?: string) => void) => Component;
	/** True when the displayed setting differs from its default value. */
	changed?: boolean;
	/** The default, as a native settings page names it in the changed dot's title. */
	defaultLabel?: string;
	/** Render as a non-interactive section heading. Skipped by navigation and search. */
	heading?: boolean;
}
```

```ts
// :106-131
export interface SettingsListTheme {
	label: (text: string, selected: boolean, changed: boolean) => string;
	value: (text: string, selected: boolean, changed: boolean) => string;
	description: (text: string) => string;
	/** Style for risk notes and the row warning glyph. Falls back to `description` when omitted. */
	warning?: (text: string) => string;
	/** Glyph marking rows that carry a `warning`. Omitted hides the row marker. */
	warningMark?: string;
	cursor: string;
	hint: (text: string) => string;
	/** Style for section heading rows (dimmed when outside the active section). Falls back to `hint` when omitted. */
	heading?: (text: string, dimmed: boolean) => string;
	/** Style for sidebar section names in the split layout. Falls back to label/hint. */
	section?: (text: string, active: boolean) => string;
	/** Hover band applied to the full row under the mouse pointer. */
	hovered?: (text: string) => string;
}
```

```ts
// :132-155
/** Optional behavior overrides for {@link SettingsList}. */
export interface SettingsListOptions {
	/**
	 * "auto" (default) renders the section sidebar layout when headings exist
	 * and the width allows; "flat" always renders inline heading rows.
	 */
	layout?: "auto" | "flat";
	/**
	 * When false, printable input is ignored (no internal type-to-filter) and
	 * the search status line is never rendered. Use when a parent component
	 * owns the query. Default true.
	 */
	typeToSearch?: boolean;
	/** Text shown when the list has no items at all. */
	emptyText?: string;
	/**
	 * Footer hint line (hint-styled, replaces the default navigation hint).
	 * An empty string removes the hint row and its leading blank entirely —
	 * use when the host renders its own footer.
	 */
	hint?: string;
	/** Fixed split-sidebar width (columns incl. indent+gap); default derives from section names. */
	sidebarWidth?: number;
}
```

Constructor (`:199-208`) — **positional, five required args**:

```ts
	constructor(
		items: SettingItem[],
		maxVisible: number,
		theme: SettingsListTheme,
		onChange: (id: string, newValue: string) => void,
		onCancel: () => void,
		options: SettingsListOptions = {},
	) {
```

Public surface: `getSelectedItem()`, `selectItem(id)`, `sectionFocused`, `openSubmenu`,
`hasOpenSubmenu()`, `hasSectionFocusTargets()`, `toggleSectionFocus()`, `setMaxVisible(rows)`,
`setHoverItem(id)`, `getSearchQuery()`, `setItems(items)`, `clearSearch()`, `render(width)`,
`handleInput(data)`, `invalidate()`, `handleWheelAt(wheel, line, col)`, `hoverTest(line, col)`,
`routeSubmenuMouse(event, line, col)`, `onSelectionChange?: (item) => void`.

Its internal scroll/description discipline is the part to copy for any list:

```ts
// :852-869 (excerpt)
			const labelWidths = this.#filteredItems
				.filter(item => !item.heading)
				.map(item => visibleWidth(item.label + this.#warningMark(item)));
			const maxLabelWidth = Math.min(30, labelWidths.length > 0 ? Math.max(...labelWidths) : 0);
			...
			const scrollView = new ScrollView(itemRows, {
				height: viewportHeight,
				scrollbar: "auto",
				totalRows: this.#filteredItems.length,
				theme: {
					track: text => this.#theme.hint(text),
					thumb: text => this.#theme.label(text, true, false),
				},
			});
			scrollView.setScrollOffset(startIndex);
			lines.push(...scrollView.render(width));
			// Pad short lists to the full viewport so the panel height is constant.
			while (lines.length < this.#maxVisible) lines.push("");
```

and:

```ts
		// Description area: 1 blank + exactly 3 rows, clamped with an ellipsis,
		// so moving between items with/without descriptions never shifts rows.
```

`ScrollView` (`pi-tui/src/components/scroll-view.ts`) is the reusable viewport with `scrollbar: "auto"`.

Other ready-made pieces: `Table` (`components/table.ts:94`) with `TableCell`/`TableColumn`
(`width`, `minWidth`, `align`, `overflow`, `priority`, `style`) and `renderTableRow`; `MetricRow`/
`formatMetricRow` (`components/metric.ts`) with `overflow: "allow" | "drop" | "truncate" | "wrap"`;
`TabBar` (`components/tab-bar.ts`); `ProgressBar` (`components/progress-bar.ts`); `KeyValueList`;
`Section`; `TreeView`.

---

## Searches

Greps run against `pi-tui/src` and `pi-coding-agent/src` (both `*.ts`):

| Search | Result |
|---|---|
| `showOverlay` in `pi-tui/src/tui.ts` | 2 hits — `:477` (doc comment), `:1188` (definition) |
| `OverlayOptions` / `OverlayHandle` defs | `pi-tui/src/tui.ts:424`, `:479` |
| `export interface Component` | `pi-tui/src/tui.ts:229` |
| `SettingsSelectorComponent` refs | `selector-controller.ts:116` (import), `:262` (construct), `settings-selector.ts:615` (def) |
| `showSettingsSelector` refs | `interactive-mode.ts:7870`, `types.ts:477`, `selector-controller.ts:252`, `builtin-modes.ts:300` |
| `handleUsageCommand` refs | `interactive-mode.ts:1894,7627`, `types.ts:428`, `command-controller.ts:655`, `builtin-session.ts:414` |
| `showOverlay` in `apps/` | `git/git-tui.ts:889,1212`, `ps-top.ts:845`, `session-picker.ts:92`, `standalone-picker.ts:58` |
| `fullscreen: true` | `selector-controller.ts:187`, `git-tui.ts:1217`, `ps-top.ts:850`, `session-picker.ts:92` |
| `NO_COLOR` | `pi-tui/src/render/hyperlink.ts:95` only |
| `COLORTERM` | `terminal-capabilities.ts:748,768-769`, `apps/debug/terminal-info.ts:43,81,112`, `cli/gallery-cli.ts:332`, `cli/gallery-screenshot.ts` |
| `COLORFGBG` | `theme/theme.ts:65` only |
| `truecolor` | `theme/color.ts:16,18,33`, `theme/schema.ts:201`, `chat/assistant-message.ts:625`, `prompt/welcome.ts:704,721`, `prompt/gradient-highlight.ts:51`, `apps/git/colors.ts:30,35`, `apps/debug/protocol-probe.ts:6,117,196,201` |
| `nerd` / `nerdfont` / `nerdFont` | `modes/settings.ts:95,100-101,166,184-185`; `setup/scenes/glyph.ts:12-22,133,140`; `native/backend.ts:296,346,350`; `native/icons.ts:4`; `key-hint-format.ts:17,85`; `status-line/presets.ts:60,85`; `prompt/welcome.ts:186,209`; `overlays/session-selector.ts:64` |
| `asciiFallback` / `asciiOnly` / `useNerd` | NOT FOUND (only `SYMBOL_PRESETS.ascii` and `theme.getSymbolPreset()`) |
| `glyphProtocol` | `terminal-capabilities.ts:796,828,855`, `terminal.ts:26`, `setup/scenes/glyph.ts:140`, `native/backend.ts:346-382`, `glyph-protocol.ts:52` |
| `▁▂▃▄▅▆▇` / `sparkline` / `SPARK` | only `apps/live-visualizer.ts:41`, `chrome/qrcode.ts`, `apps/git/avatar.ts` |
| braille `⣿` / `⠁` | NOT FOUND in first-party code |
| `setSymbolPreset` | `theme/theme.ts:328` (def); wired by `effect(cfgSymbolPreset, setSymbolPreset)` at `modes/settings.ts:110` |
| `loadDailyActivity` | `selector-controller.ts:72,384`; def at `coding-agent/src/stats/activity-client.ts:61` |
| `showOverlay` in extension API | `extensibility/extensions/types.ts` only, via `ExtensionCustomOptions.overlayOptions` |

Codepoint measurement: `bun -e` importing `pi-tui/src/theme/symbols.ts` and printing
`[...s].map(c => "U+"+c.codePointAt(0).toString(16).toUpperCase().padStart(4,"0")).join(" ")` for every
symbol key, plus `bun -e 'for (const c of ["█","░",…]) console.log(c, "U+"+c.codePointAt(0)…)'` for the
hardcoded literals quoted from `usage-dashboard.ts`.

---

## Gaps

- **No Nerd Font capability probe exists.** There is no function an extension can call to ask "does this
  terminal have a Nerd Font?". The Glyph Protocol handshake (`TERMINAL.glyphProtocol`) is the only
  runtime signal, and it reports a *protocol*, not a *font*. The practical answer is to route everything
  through `theme.symbol` / `theme.boxRound` and let the user's `symbolPreset` setting decide — but that
  means a user on the default `unicode` preset who lacks box-drawing coverage still gets tofu, because
  the default is optimistic, not probed.
- **No 16-color mode.** `ColorMode` is only `"truecolor" | "256color"` (`theme/schema.ts:201`). An
  extension that needs 16-color degradation must do it itself.
- **`NO_COLOR` is not honored by `theme.fg` / symbol selection** — only by hyperlinks. A user with
  `NO_COLOR=1` still gets a colored panel.
- **`/usage`'s data marks ignore the ascii preset.** `#miniBar`'s `█`/`░` and the heatmap's `■`/`·` are
  hardcoded. If we want true ASCII parity we must gate them ourselves.
- **`OverlayHandle` does not await anything** — `hide()` is synchronous and restores `preFocus`, but the
  built-ins still call `focusActiveEditorArea()` + `requestRender()` afterwards. Copy that, don't assume.
- **`SettingsSelectorComponent` has no `dispose()`** — it holds no timers. Our panel *will* hold async
  loaders and timers, so `dispose()` is mandatory and must be idempotent (`Component` contract, `tui.ts:313-319`).
- **Not traced**: `pi-tui/src/overlays/plugin-settings.ts` (34.6K), `annotation-overlay.ts` (53.4K),
  `plan-review-overlay.ts` (63.9K), `model-hub.ts` (139.3K), `agent-hub.ts` (92.7K) — other overlays that
  may carry additional fullscreen idioms worth borrowing. `ps-top.ts` and `git/git-tui.ts` internals
  (`sidebar.ts` 61K, `diff-pane.ts` 55.9K) were not read beyond the mount site.
- **Not traced**: how `TabBar` computes its own widths/icons, and the `native/describe.ts` +
  `native/node.ts` TSP surface. Not needed for an ANSI panel.
- **`buildHeatmapLayout` performance is unmeasured.** It rebuilds the whole grid on every render call; at
  53×7 = 371 cells per frame that is likely fine, but our panel should cache it per `(points, weeks)`
  the way `#detailLines` caches per width.
- **Extension-side `ui.custom` lifetime is untested here.** `ExtensionCustomOptions` exists and is typed,
  but no first-party extension in this install was found using `overlay: true` — the `showOverlay` call
  path for extensions is therefore unproven by example.