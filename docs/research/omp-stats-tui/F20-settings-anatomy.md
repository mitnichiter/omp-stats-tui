# F20 — `/settings` anatomy: the tab strip and the visual language

Research only. No production code changed. Every claim below is quoted from
source in `~/.bun/install/global/node_modules/@oh-my-pi/pi-tui/` at the pinned
version `18.4.10`, with `file:line`.

---

## The tab strip

### A. There IS a ready-made `TabBar`. Use it.

**Import path:** `@oh-my-pi/pi-tui` — it is on the **public barrel**:
`pi-tui/src/index.ts:22` → `export * from "./components/tab-bar";`

**`Tab` shape** — `pi-tui/src/components/tab-bar.ts:20-30`:

```ts
export interface Tab {
	/** Unique identifier for the tab */
	id: string;
	/** Display label shown in the tab bar */
	label: string;
	/** Compact form (e.g. just the icon) used when the bar must shrink to fit one line. */
	short?: string;
	/** Render with the muted style and skip during keyboard navigation. */
	muted?: boolean;
}
```

Note the two fields that matter to us and that `Screen` does not have today:
`short` (the compact form the bar degrades to) and `muted` (a tab that keeps
its place but is skipped by navigation). Our `src/tui/screens/types.ts` already
declares `short` with a width contract — it maps straight onto this.

**Constructor** — `tab-bar.ts:76-81`:

```ts
constructor(label: string, tabs: Tab[], theme: TabBarTheme, initialIndex: number = 0) {
	this.#label = label;
	this.#tabs = tabs;
	this.#theme = theme;
	this.#activeIndex = initialIndex;
}
```

`label` is a **prefix** rendered as `"<label>:"` (`tab-bar.ts:240-242`), not a
title. `/settings` passes `""` so the bar is just tabs.

**`TabBarTheme`** — `tab-bar.ts:33-47`. Five style callbacks plus two optional:

```ts
export interface TabBarTheme {
	label: (text: string) => string;
	activeTab: (text: string) => string;
	inactiveTab: (text: string) => string;
	hint: (text: string) => string;
	mutedTab?: (text: string) => string;
	hoverTab?: (text: string) => string;
}
```

**What it renders for N tabs** — `tab-bar.ts:239-266`. Each tab is its own
chunk styled by position, with a two-space gutter between chunks and a **two-cell
inner pad** on each side of every tab label:

```ts
const buildChunks = (labels: readonly string[]): TabChunk[] => {
	const chunks: TabChunk[] = [];
	// Label prefix (omitted when the label is empty)
	if (this.#label) {
		chunks.push({ text: this.#theme.label(`${this.#label}:`) });
		chunks.push({ text: "  " });
	}
	for (let i = 0; i < this.#tabs.length; i++) {
		const tab = this.#tabs[i];
		// Muted tabs never take the active highlight: they are skipped by
		// navigation and only become "active" transiently via setTabs swaps.
		// A hovered (non-active) tab lights up so mouse users see the target.
		const hovered = tab.id === this.#hoverTabId && !tab.muted && i !== this.#activeIndex;
		const style = tab.muted
			? (this.#theme.mutedTab ?? this.#theme.inactiveTab)
			: i === this.#activeIndex
				? this.#theme.activeTab
				: hovered
					? (this.#theme.hoverTab ?? this.#theme.inactiveTab)
					: this.#theme.inactiveTab;
		chunks.push({ text: style(` ${labels[i]} `), tabIndex: i });
		if (i < this.#tabs.length - 1) {
			chunks.push({ text: "  " });
		}
	}
	// Navigation hint
	if (this.showHint) {
		chunks.push({ text: "  " });
		chunks.push({ text: this.#theme.hint(`(${formatKeyHint("tab")} to cycle)`) });
	}
	return chunks;
};
```

**Yes, the active tab is marked with a background fill (an inverse pill), not
merely a colour.** The host theme — `pi-tui/src/chrome/shared.ts:18-27`:

```ts
export function getTabBarTheme(): TabBarTheme {
	return {
		label: (text: string) => theme.bold(theme.fg("accent", text)),
		activeTab: (text: string) => theme.bold(theme.bg("selectedBg", theme.fg("text", text))),
		inactiveTab: (text: string) => theme.fg("muted", text),
		mutedTab: (text: string) => theme.fg("dim", text),
		hoverTab: (text: string) => theme.bg("selectedBg", theme.fg("text", text)),
		hint: (text: string) => theme.fg("dim", text),
	};
}
```

Measured output (`bun test`, real theme, `showHint = false`):

```
["\e[48;2;49;54;63m\e[39m  Appearance \e[39m\e[49m  \e[38;2;119;125;136m  Model \e[39m  \e[38;2;119;125;136m  Interaction \e[39m"]
```

`selectedBg` is a real `ThemeBg` — `pi-tui/src/theme/schema.ts:177-178`:
`export type ThemeBg = "selectedBg" | …`.

**It shrinks, then wraps — it does not scroll.** `tab-bar.ts:271-286`:

```ts
const labels = this.#tabs.map(tab => tab.label);
let chunks = buildChunks(labels);

if (totalWidth(chunks) > maxWidth) {
	const collapseOrder = this.#tabs
		.map((_, index) => index)
		.filter(index => index !== this.#activeIndex && this.#tabs[index].short !== undefined)
		.sort((a, b) => Math.abs(b - this.#activeIndex) - Math.abs(a - this.#activeIndex));
	for (const index of collapseOrder) {
		labels[index] = this.#tabs[index].short ?? this.#tabs[index].label;
		chunks = buildChunks(labels);
		if (totalWidth(chunks) <= maxWidth) break;
	}
}
```

Order matters: tabs **farthest from the active one collapse first**, so the
active tab never loses its label. Multi-line wrapping is the fallback
(`tab-bar.ts:292-333`). Verified: at width 24 the bar renders
`"  Appearance "` + `"  M "` + `"  I "` — the two inactive tabs collapsed, the
active one kept.

Other useful surface: `setTabs(tabs, activeId?)`, `setActiveById(id)`,
`selectTab(id)` (refuses muted), `getActiveIndex()`, `handleInput(data):
boolean` — which already binds `tab`/`right` → next and `shift+tab`/`left` →
prev (`tab-bar.ts:210-219`). `showHint` (`tab-bar.ts:74`) lets the host fold
the "(tab to cycle)" text into its own footer; `/settings` sets it to `false`.

### B. Tab set and active tab are data-driven, but the ACTIVE tab is owned by the component

`/settings` builds its tabs from a static table, `settings-selector.ts:546-553`:

```ts
function getSettingsTabs(): Tab[] {
	return [
		...SETTING_TABS.map(id => {
			const meta = TAB_METADATA[id];
			const icon = theme.symbol(meta.icon);
			return { id, label: `${icon} ${meta.label}`, short: icon };
		}),
		{ id: "plugins", label: `${theme.icon.package} Plugins`, short: theme.icon.package },
	];
}
```

`SETTING_TABS` and `TAB_METADATA` are declared in
`pi-tui/src/overlays/settings-defs.ts:20-45` as an ordered id list plus a
`Record<SettingTab, { label, icon }>` — the shape our `SCREENS` registry already
has. The label is **`${icon} ${label}` with a leading space**, and `short` is
the bare icon. That is why the collapse step works: our `short` is currently a
truncated word, theirs is a single glyph.

Wiring, `settings-selector.ts:651-669`:

```ts
const tabs = getSettingsTabs();
this.#tabs = tabs;
this.#tabBar = new TabBar("", tabs, getTabBarTheme());
this.#tabBar.showHint = false;
this.#tabBar.onTabChange = () => {
	const tabId = this.#tabBar.getActiveTab().id as SettingTab | "plugins";
	…
};
```

So: **the component owns the active tab** (`TabBar.#activeIndex`), not a
separate field. Ours keeps `#screenId` as its own `PanelState` field and syncs
by hand. `setActiveById` exists precisely for external sync (search results
move the strip: `settings-selector.ts:1420-1424`).

---

## OverlayPanel regions

### C. There is NO typed region concept. `OverlayPanel` is a child list.

`pi-tui/src/chrome/overlay-box.ts` exports, in full:

| Symbol | Line | Purpose |
|---|---|---|
| `topBorder(width, title, color?)` | `22` | Top rule with the title inset left. **No right-aligned segment.** |
| `divider(width)` | `36` | `├───┤` full-width section rule |
| `bottomBorder(width, color?)` | `41` | Bottom rule |
| `row(content, width, color?)` | `47` | Wraps one logical row in `│ … │`, inset 1 per side |
| `topBorderSplit(width, title, sidebarWidth)` | `69` | Two-column top border with a `┬` |
| `dividerSplit(width, sidebarWidth)` | `89` | Split divider |
| `splitRow(...)` | `103` | `│ sidebar │ body │` |
| `PanelRows` | `123` | A mutable row region; `setLines`, `setHeight` |
| `PanelDivider` | `178` | Sentinel child; renders nothing, `OverlayPanel` draws the rule |
| `OverlayPanel` | `218` | The container |

**Answer to "what regions exist beyond header/body/divider/footer": there is no
enum at all.** `OverlayPanel.children` is a plain `Component[]`
(`overlay-box.ts:218-219`); anything implementing `Component` can be a region,
and `OverlayPanel.render` wraps each child's rows in `row()` (`overlay-box.ts:318-330`).

**There is no status region and no right-aligned header segment.** `topBorder`
only left-insets the title:

```ts
// overlay-box.ts:22-33
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
```

`/settings` needed a right-aligned element in the header (its live match
count) and **hand-built it**: `settings-selector.ts:714-724`:

```ts
/** Single-line search banner: accent icon, editable query with live cursor, right-aligned match count. */
#renderSearchBanner(width: number): string {
	const icon = theme.symbol("icon.search");
	const countText = this.#searchMatchCount === 1 ? "1 match" : `${this.#searchMatchCount} matches`;
	const rightWidth = visibleWidth(countText) + 1; // trailing margin
	const prefix = ` ${theme.fg("accent", icon)} `;
	// The input pads itself to exactly this width and keeps the cursor in view.
	const inputWidth = Math.max(4, width - visibleWidth(prefix) - rightWidth - 1);
	const inputLine = this.#searchInput.render(inputWidth)[0] ?? "";
	const count = theme.fg(this.#searchMatchCount > 0 ? "dim" : "warning", countText);
	return truncateToWidth(`${prefix}${theme.bold(inputLine)} ${count} `, width);
}
```

`PanelRows` is the region primitive we already use — `overlay-box.ts:123-171` —
`setLines` is identity-stable (byte-identical rows keep the previous render
identity) and `setHeight(n)` clips/pads.

---

### D. The ONE visual device `/settings` uses and we do not: a background-filled active tab

That is `getTabBarTheme().activeTab` (`chrome/shared.ts:21`):

```ts
activeTab: (text: string) => theme.bold(theme.bg("selectedBg", theme.fg("text", text))),
```

Everything else about the strip is plumbing we could rebuild. The thing that
makes `/settings` read as a tabbed thing is that the active tab is a **filled
pill** and the inactive tabs are **muted foreground only** — a luminance step,
not a hue step. Our panel has no tab strip at all: the screen name appears only
inside the border title (`src/tui/panel.ts`, `state.title =
\`Stats · ${rangeLabel} · ${screen.label}\``), so the user cannot see which
screens exist without cycling them.

`/settings`' full frame, `settings-selector.ts:728-782`:

```ts
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
	…
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

Two structural notes we should copy:

- It does **not** use `OverlayPanel`. It hand-rolls the frame from the five
  primitive functions. That is a legitimate choice when the tab row's height is
  dynamic (`tabLines.length`), because `OverlayPanel` cannot pin a region to a
  runtime-determined height the way `PanelRows.setHeight` can — actually it can,
  `setHeight(tabLines.length)` works. Our `OverlayPanel` usage is fine; the
  reason `/settings` differs is historical, not a capability gap.
- The chrome budget is explicit and named (`fixedRows`), and content is
  `Math.max(7, …)` — a **minimum of 7 content rows**, so a short terminal
  degrades to a scrolling list rather than a 1-row body. Ours uses
  `planLayout`'s `Math.max(1, …)`.

### Section navigation

`SettingsList` (`pi-tui/src/components/settings-list.ts:171`) has a real
**two-level focus** model: rows, and section headings. `settings-list.ts:264-280`:

```ts
/** True while keyboard focus is on the section headings instead of the setting rows. */
get sectionFocused(): boolean {
	return this.#sectionFocus;
}

/** Whether section focus has anywhere to go: 2+ derived sections in the current view. */
hasSectionFocusTargets(): boolean {
	return this.#sections().length >= 2;
}

/**
 * Toggle keyboard focus between section headings and setting rows. While
 * focused, Up/Down jump whole sections and Enter/Esc return to the rows.
 * Engages only when {@link hasSectionFocusTargets}; returns the new state.
 */
toggleSectionFocus(): boolean {
	this.#sectionFocus = !this.#sectionFocus && this.hasSectionFocusTargets();
	return this.#sectionFocus;
}
```

and `Tab` is **repurposed** to move between focus levels rather than between
tabs (`settings-selector.ts:1913-1926`):

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

That is a genuinely good pattern for a scrolling panel and it is worth copying
verbatim in spirit: **`Tab` means "jump between landmarks", and only falls
through to "change tab" when there is nothing to jump to.**

### F. The footer hint row: two different builds, one native-only component

**Native path — a real component.** `pi-tui/src/native/overlay.ts:36-51`:

```ts
/**
 * A wrapping row of `kbd` keycaps with muted labels: the footer hint strip of
 * a selector. `undefined` entries (unbound actions) are skipped. Build it once
 * per hint-set change and reuse the node (memoization contract).
 */
export function hintsRow(hints: readonly (NativeHint | undefined)[], key = "hints"): NativeNode {
	const children: NativeChild[] = [];
	for (const hint of hints) {
		if (!hint) continue;
		const group: NativeChild[] = hint.keys.map(k => kbd(k));
		group.push(text([span(hint.label, "muted")]));
		children.push(row(group, { gap: "xs", align: "center" }));
	}
	return node("row", { gap: "md", wrap: true, role: "omp.overlay.hints" }, children, key);
}
```

plus `actionHint(actions, label)` at `native/overlay.ts:27-36`, which resolves
keys **from the live keybinding registry** and returns `undefined` when unbound:

```ts
export function actionHint(actions: Keybinding | readonly Keybinding[], label: string): NativeHint | undefined {
	const keys: KeyName[] = [];
	const bindings = getKeybindings();
	for (const action of typeof actions === "string" ? [actions] : actions) {
		const [key] = bindings.getKeys(action);
		if (key) keys.push(key);
	}
	return keys.length > 0 ? { keys, label } : undefined;
}
```

There is also `statusHintsRow(status, hints)` at `native/overlay.ts:53-56` — a
**status segment followed by key hints**. That is the "status region" concept
the question asks about, and it exists only on the native path.

`/settings` maintains **two parallel hint sets** that must agree — one native
node per mode (`settings-selector.ts:108-144`) and one ANSI string per mode
(`settings-selector.ts:697-712`). The ANSI one is hand-rolled:

```ts
#footerHintText(): string {
	const confirm = editorKey("tui.select.confirm");
	const cancel = editorKey("tui.select.cancel");
	const tab = formatKeyHint("tab");
	const switchTabs = `${formatKeyHints(["left", "right"])} to switch tabs`;
	if (this.#searchList) {
		return `${confirm} to change · ${tab} to jump tabs · ${cancel} to exit search`;
	}
	…
}
```

**So: there is NO ANSI hint-row component.** The ANSI primitives are
individual formatters in `pi-tui/src/chrome/keybinding-hints.ts`:

- `editorKey(action)` → first bound key, formatted (`chrome/keybinding-hints.ts:18`)
- `editorKeys(...actions)` → `"↑/↓"` (`:24`)
- `boundKeys(action, fallback)` (`:33`)
- `interruptKey()` (`:39`)
- `keyHint(action, description)` → `dim(key) + muted(" " + description)` (`:57`)
- `rawKeyHint(keys, description)` (`:78`)

`keyHint`/`rawKeyHint` are the two worth stealing: they produce the **dim key +
muted label** pairing, whereas our footer is `theme.fg("dim", …)` over the
entire hint string, so keys and labels are the same colour and the strip reads
as prose.

---

## usage-dashboard visual language

### E. Sections without rules: a bold accent heading with dim metadata, then a blank line

`pi-tui/src/overlays/usage-dashboard.ts:845-850`:

```ts
summary.push(
	`${theme.bold(theme.fg("accent", "Activity"))} ${theme.fg("dim", `${cost} · ${requests} requests · last ${weeks} weeks`)}${this.#syncing ? theme.fg("dim", " · syncing…") : ""}`,
);
summary.push("");
```

and the two-region composition, `usage-dashboard.ts:878-884`:

```ts
#overviewLines(innerWidth: number): string[] {
	const lines: string[] = [];
	lines.push(...this.#renderCardsGrid(innerWidth));
	lines.push("");
	lines.push(...this.#renderHeatmap(innerWidth));
	return lines;
}
```

**That is the whole device.** There is no `divider()` between the cards grid and
the heatmap — the panel contains exactly **one** `PanelDivider`, and it is
between the body and the footer (`usage-dashboard.ts:573`):

```ts
this.#panel.addChild(new PanelDivider());
```

Three devices carry the separation instead:

1. **A bold accent heading, no rule.** `theme.bold(theme.fg("accent", title))`,
   then `theme.fg("dim", …)` metadata on the same line.
2. **A single blank line** (`lines.push("")`) between regions.
3. **Per-row role colour**, not structure: labels `theme.fg("muted", …)`
   (`usage-dashboard.ts:726`), percentages `theme.fg(this.#statusColor(card.status), …)`
   (`:699`), absent cells a dim `·` vs a coloured `■` ramp (`:864-866`).

So the rule is: **structure comes from whitespace and one accent-bold heading;
colour is reserved for data magnitude and status, never for section identity.**

Compare ours. `src/tui/panel.ts` currently draws a `─` rule under the section
heading —

```ts
theme.fg("dim", "─".repeat(Math.max(0, Math.min(ctx.width, RULE_WIDTH)))),
```

— and uses a blank line between the chart and the figures. That is the
`Section` component's policy (`components/section.ts:28-36`, `title` + `rule` +
body + optional `blankAfter`), which is *a* pi-tui idiom, but it is not the
one `/settings` and `/usage` use for a scrolling body.

Also note `/usage` never truncates its frame budget against chrome: it uses
`Math.max(14, process.stdout.rows || 40)` (`usage-dashboard.ts:897`) and
`Math.max(5, height - 5)`. Our `MIN_PANEL_ROWS = 6` is far more aggressive.

---

## What we are missing

Concrete differences between `src/tui/panel.ts` and `/settings`, in the order
they would show up on screen:

1. **No tab strip at all.** The screen name exists only inside the border title.
   `/settings` renders a dedicated tab row directly under the top border
   (`settings-selector.ts:735-745`). With 12 screens, ours makes the user cycle
   blind.
2. **The active tab cannot be distinguished**, because there are no tabs.
   Even once wired, `getTabBarTheme().activeTab` uses a **background fill**
   (`theme.bg("selectedBg", …)`) plus bold, while inactive tabs are
   `theme.fg("muted", …)` foreground only. We have no equivalent.
3. **We own `#screenId` in `PanelState`; `TabBar` owns the active index.** Our
   `handleInput` → `#selectScreen` → `#load()` chain is a hand-rolled
   `onTabChange`. `setActiveById` / `setTabs(tabs, activeId)` exist for exactly
   this and would let the strip follow a selection.
4. **No collapse-to-`short` behaviour.** Our `Screen.short` is a ≤8-cell word
   (`test/screens.test.ts` pins it). `/settings` uses a **single icon glyph**
   as `short`, so collapse is nearly free. 12 tabs × 8 cells + gutters does not
   fit 80 columns; icons do.
5. **We put the range in the title, not the tab row.** `/settings` keeps the
   title constant (`"Settings"`) and puts navigation below it. Our title
   mutates with `Stats · 24 hours · Overview`, which means no stable landmark.
6. **Our footer is uniformly dim.** `/settings` splits `dim(key)` from
   `muted(label)` via `keyHint`/`rawKeyHint`. Ours is one `fg("dim", …)` over
   `"←→ screen · 24 hours · r range · s sync · esc close"`.
7. **Our section separator is a `─` rule; the reference uses bold-accent +
   dim metadata + a blank line, with no rule at all** inside a scrolling body
   (`usage-dashboard.ts:847, 878-884`).
8. **No `Tab`-means-landmark-jumping.** `/settings` only lets `Tab` fall through
   to `tabBar.handleInput` when there are fewer than two sections
   (`settings-selector.ts:1915-1921`). Ours spends `Tab` on tab switching
   unconditionally, so tab-switching gets no share of the keyboard when there
   is nothing below it.
9. **Our content floor is 1 row; `/settings` uses 7, `/usage` uses 5.** A short
   terminal gives ours a 1-line body.
10. **No hover/click affordance.** `TabBar.setHoverTab(id)` and
    `tabAt(line, col)` exist; we have no hit zones, and we ship
    `mouseTracking: false` on the overlay, which disables the mouse entirely.

---

## Export surface

| Symbol | On the barrel (`@oh-my-pi/pi-tui`)? | Working import |
|---|---|---|
| `TabBar`, `Tab`, `TabBarTheme` | **YES** — `src/index.ts:22` | `@oh-my-pi/pi-tui` |
| `SettingsList` | **YES** — `src/index.ts:26` | `@oh-my-pi/pi-tui` |
| `Section` | **YES** — `src/index.ts:20` | `@oh-my-pi/pi-tui` |
| `OverlayPanel`, `PanelRows`, `PanelDivider`, `topBorder`, `divider`, `bottomBorder`, `row` | no (`chrome/` is not on the barrel) | `@oh-my-pi/pi-tui/chrome` |
| `getTabBarTheme` | no | `@oh-my-pi/pi-tui/chrome` (re-exported by `chrome/index.ts` via `./shared`) |
| `editorKey`, `editorKeys`, `keyHint`, `rawKeyHint`, `interruptKey`, `boundKeys` | no | `@oh-my-pi/pi-tui/chrome` |
| `formatKeyHint`, `formatKeyHints` | no | `@oh-my-pi/pi-tui/app-keybindings` |
| `actionHint`, `hintsRow`, `statusHintsRow` | no | `@oh-my-pi/pi-tui/native/overlay` |
| `matchesKey` | **YES** — `src/index.ts` `./keys` | `@oh-my-pi/pi-tui` |
| `matchesSelect*` | no | `@oh-me-pi/pi-tui/keybinding-matchers` (already used) |
| `theme`, `ensureThemeSync`, `ThemeColor` | **YES** — `src/index.ts` `./theme` | `@oh-my-pi/pi-tui/theme` |

All of these were **resolved and executed** against the installed
`18.4.10` in `bun test`; nothing above is inferred from the exports map alone.
The package's `exports` map has `"./*": {"import": "./src/*.ts"}`, so every
deep path above is a real specifier.

---

## Gaps

- **NOT FOUND:** an ANSI hint-row component. `hintsRow` and `actionHint` build
  `NativeNode`s only; the ANSI path is composed by hand from
  `keyHint`/`rawKeyHint`/`editorKeys` and a `" · "` join.
- **NOT FOUND:** a status region in the ANSI path. `statusHintsRow` exists but
  is native-only.
- **NOT FOUND:** a right-aligned header/border segment in `OverlayPanel`. Only
  the hand-rolled `#renderSearchBanner` does it.
- **NOT FOUND:** any typed region enum for `OverlayPanel`. `children` is an
  open `Component[]`.
- `TabBar` does **not** scroll. It collapses to `short`, then wraps to multiple
  lines. Twelve tabs of 8 cells plus two-space gutters exceed 80 columns, so
  either `short` becomes icon-like or the strip wraps — a wrapping strip costs
  one more row of frame budget.
- `TabBar.handleInput` binds `tab`/`shift+tab`/`left`/`right`
  (`tab-bar.ts:210-219`). Ours binds `left`/`right`/`tab`/`shift+tab` to
  screen switching and `up`/`down` to scroll — compatible, but the two
  components will both want the same keys if both are wired.
- `getTabBarTheme()` hardcodes `theme` (the singleton), not an injected theme.
  Our panel is handed a `Theme` instance by the mount; we would need to
  re-implement the six callbacks against that instance rather than call
  `getTabBarTheme()`.
- The mouse affordances (`setHoverTab`, `tabAt`, `handleNativeEvent`) are
  unusable while `STATS_OVERLAY_OPTIONS.mouseTracking` is `false`.