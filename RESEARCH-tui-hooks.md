# Q3 — Extension/plugin UI hooks in the `omp` TUI

Sources: `omp://extensions.md` (UI integration points), `omp://tui.md`, `omp://tui-runtime-internals.md`, `omp://tui-core-renderer.md`, `omp://keybindings.md`.

---

## 0. Bottom line

There is **no** documented hook that lets a plugin register a first-party view, sidebar pane, header/footer region, modal slot, or a `/`-command that behaves like `/settings` or `/usage` at the layout level.

`omp://extensions.md`, interactive mode section, verbatim:

> "Current no-op methods in this controller:
>
> - `setFooter`
> - `setHeader`"

There is no `registerView`, `registerPane`, `registerModal`, `registerSidebar`, or equivalent anywhere in the docs.

An extension can occupy exactly three places:

1. A transient `Component` in the **editor area** or as an **overlay** (`ctx.ui.custom(...)`).
2. An **above/below-editor widget strip** (`ctx.ui.setWidget` / `setHookWidget`).
3. **Tool call/result rows** in the transcript (`renderCall` / `renderResult`).

---

## 1. Complete `ctx.ui` enumeration

`omp://extensions.md`: "`ctx.ui` implements the `ExtensionUIContext` interface. Support differs by mode."

The doc lists **method names, not parameter signatures**. Every signature below is marked accordingly.

### 1a. Interactive mode (`packages/coding-agent/src/modes/controllers/extension-ui-controller.ts`)

Verbatim support list:

> "Supported:
>
> - dialogs: `select`, `confirm`, `input`, `editor`, optional `askDialog`
> - input editing: `setEditorText`, `getEditorText`, `pasteToEditor`, `editor`
> - autocomplete stacking: `addAutocompleteProvider(factory)` wraps the built-in editor provider (factories apply in registration order and re-apply on every slash-command refresh)
> - terminal title and working message (`setTitle`, `setWorkingMessage`)
> - notifications/status/editor text/terminal input/custom overlays
> - theme listing/loading by name (`setTheme` supports string names)
> - tools expanded toggle"

| Method | Signature | Notes / verbatim |
|---|---|---|
| `select` | NOT DOCUMENTED (no params given) | Interactive dialog |
| `confirm` | NOT DOCUMENTED | Interactive dialog |
| `input` | NOT DOCUMENTED | Interactive dialog |
| `editor` | NOT DOCUMENTED | Interactive dialog (distinct from `setEditorComponent`) |
| `askDialog` | NOT DOCUMENTED | Optional |
| `setEditorText` | NOT DOCUMENTED | "`setEditorText` and `pasteToEditor` request a repaint after mutating the editor." |
| `getEditorText` | NOT DOCUMENTED → returns `string` | RPC: "returns `\"\"`" |
| `pasteToEditor` | NOT DOCUMENTED | RPC fallback: "`pasteToEditor` falls back to `setEditorText`" |
| `setEditorComponent(factory)` | NOT DOCUMENTED — factory return type constrained | "wired to the live editor; the factory must return a `CustomEditor` subclass, not a plain `Editor`/`EditorComponent`" |
| `addAutocompleteProvider(factory)` | NOT DOCUMENTED | wraps built-in provider; "factories apply in registration order and re-apply on every slash-command refresh" |
| `setTitle` | NOT DOCUMENTED | RPC gate: emits only when `PI_RPC_EMIT_TITLE` is `1`, `true`, `yes`, or `on` (case-insensitive) |
| `setWorkingMessage` | NOT DOCUMENTED | — |
| `notify` | NOT DOCUMENTED | — |
| `setStatus` | NOT DOCUMENTED | — |
| `onTerminalInput` | NOT DOCUMENTED | RPC: unsupported/no-op |
| `setTheme` | NOT DOCUMENTED | "theme listing/loading by name (`setTheme` supports string names)"; RPC "returns failure" |
| tools-expanded toggle | **method name NOT DOCUMENTED** | listed only as "tools expanded toggle"; RPC "tool expansion controls are inert" |
| `setWidget` | NOT DOCUMENTED | see §3c below |
| `setFooter` | NOT DOCUMENTED | **no-op** in interactive |
| `setHeader` | NOT DOCUMENTED | **no-op** in interactive |
| `custom<T>` | **documented verbatim** — see §2 | — |

### 1b. RPC mode (`packages/coding-agent/src/modes/controllers/`, `rpc-mode.ts`)

Verbatim:

> "`ctx.ui` is backed by RPC `extension_ui_request` events:
>
> - dialog methods (`select`, `confirm`, `input`, `editor`) round-trip to client responses
> - fire-and-forget methods emit requests (`notify`, `setStatus`, `setWidget` for string arrays or removal, and `setEditorText` as `method: \"set_editor_text\"`); `pasteToEditor` falls back to `setEditorText`
> - `setTitle` emits only when `PI_RPC_EMIT_TITLE` is `1`, `true`, `yes`, or `on` (case-insensitive)
>
> Unsupported/no-op in RPC implementation:
>
> - `onTerminalInput`
> - `custom`; optional `askDialog` is absent
> - `getEditorText` returns `\"\"`
> - `setFooter`, `setHeader`, `setEditorComponent`, `addAutocompleteProvider`
> - `setWorkingMessage`
> - theme switching/loading (`setTheme` returns failure)
> - tool expansion controls are inert"

`omp://tui.md` adds, for RPC: "`custom()` is implemented as unsupported UI and returns `undefined as never`; do not depend on interactive UI in RPC handlers."

### 1c. Print / headless / subagent paths

> "When no UI context is supplied to runner init, `ctx.hasUI` is `false` and methods are no-op/default-returning. Both `--mode rpc --no-ui` and `--mode rpc-ui --no-ui` take this path for extensions; `rpc-ui` tool dialogs remain enabled."

### 1d. ACP mode

> "ACP installs an elicitation-bridged UI context (`createAcpExtensionUiContext` in `modes/acp/acp-agent.ts`). `ctx.mode` is `\"rpc\"` and `ctx.hasUI` is `true`. `select`/`confirm`/`input`/`editor` and optional `askDialog` round-trip as ACP form elicitations; defaults are returned when the client lacks `elicitation.form`. The non-elicitation surface (widgets, editor control, theming, terminal input, autocomplete stacking) is inert; `notify` logs a debug notification."

### 1e. `hasUI` caveat (`omp://tui.md`)

> "Interactive TUI | Supported | Component is mounted in the editor area or overlay, focused, and must call `done(result)` to resolve.
> Background/headless | Not interactive | UI context is no-op (`hasUI === false`).
> RPC mode | Not mounted | `custom()` is implemented as unsupported UI and returns `undefined as never`…
>
> RPC can expose `hasUI === true` for protocol-backed dialogs while still not supporting `custom()`; `hasUI` alone does not guarantee a component can be mounted."

---

## 2. `custom<T>` — the one arbitrary-component hook

`omp://tui.md`, current signature (`extensibility/extensions/types.ts`), verbatim:

```ts
custom<T>(
  factory: (
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    done: (result: T) => void,
  ) => (Component & { dispose?(): void }) | Promise<Component & { dispose?(): void }>,
  options?: ExtensionCustomOptions,
): Promise<T>
```

`HookUIContext.custom` in `extensibility/hooks/types.ts` has an identical signature (no `options`).

`ExtensionCustomOptions` members named in the docs:

- `overlay?: boolean`
- `overlayOptions?: …` — "`overlayOptions` accepts static options or a function evaluated when mounting."
- `onHandle?: (handle: OverlayHandle) => void` — "`options.onHandle` receives the mounted overlay handle."
- `signal?: AbortSignal` — "`options.signal` aborts the flow and rejects its promise with the signal's reason (or `AbortError`); a component returned after cancellation is disposed rather than mounted."

`ExtensionCustomOptions`'s full TypeScript declaration, and `OverlayOptions` field names: **NOT DOCUMENTED**.

---

## 3. Where the mounted view renders

### 3a. Editor-area replacement vs overlay

`omp://tui.md`, verbatim:

> "In interactive extension/custom UI, `custom(..., { overlay: true })` mounts your component through `TUI.showOverlay(...)`; without `overlay`, it replaces the editor component area directly."

> "By default, overlay custom UI is anchored at `bottom-center` with full terminal width/max height. `overlayOptions` can override positioning and sizing; `onHandle` receives the `OverlayHandle`. The overlay is removed when `done(...)` closes the flow."

> "Saves editor text. Without `options.overlay`, replaces the editor component with your component. With `options.overlay`, mounts your component as an overlay instead of replacing the editor; `overlayOptions` accepts static options or a function evaluated when mounting.
> …
> - Focuses your component.
> - On `done(result)`: calls `component.dispose?.()`, hides the overlay if present, restores editor + text for non-overlay flows, focuses editor, resolves promise.
>   Call `done(...)` to complete successfully; factory failures and signal cancellation reject the promise."

Summary table:

| Form | Region |
|---|---|
| `custom(factory)` | **Replaces the editor component area** (saves/restores editor + text) |
| `custom(factory, { overlay: true })` | **Overlay on top of the mutable viewport**, default anchor `bottom-center`, full terminal width / max height |
| `setWidget(..., { placement })` | **Above or below the editor** only |
| `renderCall` / `renderResult` | **Inside the transcript**, wrapped by `ToolExecutionComponent` |

Never above/below the transcript; never a header/footer/status region.

### 3b. Overlay compositing semantics

`omp://tui-core-renderer.md`, verbatim:

> "Visible overlays are screen-coordinate content. They composite over the viewport and never become history. Showing, updating, or closing an overlay only repaints the viewport."

`omp://tui-runtime-internals.md`, verbatim:

> "Fullscreen overlays use the alternate buffer and never append history. Normal overlays composite over the mutable viewport only."

### 3c. `setWidget` (the editor-adjacent region)

`omp://extensions.md`, verbatim:

> "`setWidget` renders widget components above or below the editor via `setHookWidget(...)` (`placement: \"aboveEditor\" | \"belowEditor\";` string arrays show up to 10 content lines plus a truncation notice). Pass `undefined` to remove a widget."

`setHookWidget`'s exact signature: **NOT DOCUMENTED** (only the `placement` union literal `"aboveEditor" | "belowEditor"`).

### 3d. Tool renderers (the transcript region)

`omp://tui.md`, verbatim:

> "Custom tools and extension tools can return components from:
>
> - `renderCall(args, options, theme)`
> - `renderResult(result, options, theme, args?)`
>
> `options` currently includes:
>
> - `expanded: boolean`
> - `isPartial: boolean`
> - `spinnerFrame?: number`
>
> … These renderers are mounted by `ToolExecutionComponent`."

`ToolExecutionComponent` lives in `packages/tui/src/chat/tool-execution.ts`. Optional Tern path: `describeCall(args, options)`, `describeResult(result, options, args?)` returning `NativeToolView | undefined`; components may implement `describe(cx)` / `handleNativeEvent(event)`.

---

## 4. Building the component — class names, import paths, export surface

### 4a. The interface to implement

`packages/tui/src/tui.ts`, verbatim:

```ts
export interface Component {
  render(width: number): readonly string[];
  handleInput?(data: string): void;
  wantsKeyRelease?: boolean;
  invalidate?(): void;
  setIgnoreTight?(ignore: boolean): any;
  dispose?(): void;
}
```

```ts
export interface Focusable {
  focused: boolean;
  setUseTerminalCursor?(useTerminalCursor: boolean): void;
}
```

There is **no base view class to subclass** — the doc's example class `class Picker implements Component` is the documented pattern.

Render-method contract, verbatim (`omp://tui.md`):

> "Render results are component-owned and immutable to callers. An unchanged component may (and should) return the **same array reference** it returned last time; it must return a new array whenever content changes. Reference equality enables container memoization and stable-prefix work avoidance. A component that mutates a previously returned array in place must also implement `RenderStablePrefix` and report how many leading rows survived unchanged."

> "Your `render(width)` output must be terminal-safe:
> 1. **Do not intentionally exceed `width` on any line**. … 2. **Measure visual width**, not string length: use `visibleWidth()`. 3. **Truncate/wrap ANSI-aware text** with `truncateToWidth()` / `wrapTextWithAnsi()`. 4. **Sanitize tabs/content** from external sources using `replaceTabs()`…"

### 4b. Public import paths that ARE documented

```ts
import type { Component } from "@oh-my-pi/pi-tui";
import {
  SelectList,
  matchesKey,
  replaceTabs,
  truncateToWidth,
} from "@oh-my-pi/pi-tui";
import {
  getSelectListTheme,
  type ExtensionAPI,
} from "@oh-my-pi/pi-coding-agent";
```

Also `@oh-my-pi/pi-coding-agent` exports `theme` ("import { theme } from "@oh-my-pi/pi-coding-agent";"). Theme adapters per `omp://theme.md`: `getMarkdownTheme()`, `getSelectListTheme()`, `getEditorTheme()`, `getSettingsListTheme()`.

Named component classes used in the docs: **`SelectList`** (`new SelectList(items, 8, getSelectListTheme())`, with `.onSelect`, `.onCancel`, `.render`, `.handleInput`) and **`CancellableLoader`** (`new CancellableLoader(tui, activeFn, inactiveFn, "Working...")`, with `.signal`, `.aborted`, `.onAbort`).

Text / Box / Table / key-hint component classes: **NOT DOCUMENTED**. Only `SelectList` and `CancellableLoader` are named. Boxes are hand-drawn with `boxRound.*` / `boxSharp.*` theme tokens.

`CancellableLoader`'s import statement is never shown in the docs (it appears only in a code fence body) — its exact import path is **NOT DOCUMENTED**.

### 4c. Are overlays constructible from outside the package?

- The only documented construction path is **`tui.showOverlay(component, …)` on the injected `TUI` instance**, whose signature is **NOT DOCUMENTED**.
- The control handle is **`OverlayHandle`**, delivered via `options.onHandle`; its members are **NOT DOCUMENTED**.
- `omp://tui.md` says only: "Overlay APIs exist in `TUI` (`showOverlay`, `OverlayHandle`)."
- Built-in overlays live in `packages/tui/src/overlays/` (per `omp://porting-from-pi-mono.md`: "Shared TUI components now live in `packages/tui/src/` (including `chat/`, `overlays/`, and `status-line/`)"), but **no export names from that directory are documented**, and no doc states they are re-exported from `@oh-my-pi/pi-coding-agent` or `@oh-my-pi/pi-tui`.

**Verdict on export surface: whether any first-party overlay/widget class is importable by an extension is NOT DOCUMENTED.** The docs only ever show extensions writing their own `Component` and calling `custom()` / `setWidget()`.

---

## 5. Key input and dismissal

### 5a. Input routing

`omp://tui-runtime-internals.md`, verbatim:

> "Input path:
>
> `stdin -> ProcessTerminal -> StdinBuffer -> TUI.#handleInput -> focusedComponent.handleInput`
>
> `StdinBuffer` assembles fragmented CSI/OSC/DCS/APC/SS3 sequences and bracketed paste before dispatch. TUI input listeners may consume or transform input first. Key releases are filtered unless the focused component opts in."

`omp://tui.md`, verbatim:

> "`TUI.setFocus(component)` routes input to that component."
> "Key release events are filtered unless your component sets: `wantsKeyRelease = true;` Then use `isKeyRelease()` / `isKeyRepeat()` if needed."

There is **no `onKey` registration API**. You implement `handleInput?(data: string): void` on the `Component` and the TUI routes to it once focused.

### 5b. Matching keys

`omp://tui.md`, verbatim:

> "Use `matchesKey(data, \"...\")` for navigation keys and combos."

> "Extension UI factories receive a `KeybindingsManager` (interactive mode; an in-memory instance carrying the default bindings, not the user's `keybindings.yml`) so you can match action ids instead of hardcoding keys:
>
> ```ts
> if (keybindings.matches(data, "app.interrupt")) {
>   done(undefined);
>   return;
> }
> ```"

### 5c. Dismissing

Verbatim:

> "Call `done(...)` to complete successfully; factory failures and signal cancellation reject the promise."

> "The overlay is removed when `done(...)` closes the flow."

> "`done(...)` should be called exactly once from your component flow."

Alternative paths named in docs: `options.onHandle` receiving `OverlayHandle` (close the overlay directly — `OverlayHandle` members NOT DOCUMENTED), and `options.signal` + `CancellableLoader`:

```ts
const loader = new CancellableLoader(tui, …);
loader.onAbort = () => done(undefined);
void doWork(loader.signal).then(result => { if (!loader.aborted) done(result); });
```

Lifecycle, verbatim:

> "`dispose()` is optional at type level but should be implemented when you own timers, subprocesses, watchers, sockets, or overlays. It must be idempotent: containers propagate disposal, and reset/removal paths may converge."

### 5d. First-party analogue for a dismiss key

For reference, the host gives a first-party view its opening key via an `app.*` action id in `~/.omp/agent/keybindings.yml` (`omp://keybindings.md`, e.g. `app.agents.hub: Alt+A`) and the view itself handles `Escape` internally — `omp://slash-command-internals.md` documents `Esc` closing `/btw` history and `/pause` ("press the configured interrupt key (Esc by default), Enter, Space, or Ctrl+C to resume"). Extensions get **no** equivalent `app.*` action id they can bind to; a plugin's own `keybindings.matches(data, "app.interrupt")` resolves against default bindings only.

---

## 6. Architecture verdict

A plugin **cannot** do first-party main-TUI integration. `setHeader` / `setFooter` are documented no-ops and no view-registration hook exists.

Reachable plugin surfaces, all supported and first-class:

1. `pi.registerCommand(name, { description, handler })` + `ctx.ui.custom(factory, { overlay: true, overlayOptions, onHandle, signal })` → a `bottom-center` overlay bound to its own slash command, closed by `done(...)`.
2. `ctx.ui.setWidget` / `setHookWidget(..., { placement })` → above/below-editor strip.
3. `renderCall` / `renderResult` → transcript tool rows via `ToolExecutionComponent`.
4. Replacing usage **data** for a provider via `pi.registerProvider(name, { usage: { fetchUsage } })` — "the result is then handled by the host's AuthStorage cache, history, and usage displays just like built-in provider usage." This is the only route by which plugin code lands inside a first-party surface's data path without owning the view.

To own a real view (`/settings`- or `/usage`-style) requires an upstream patch: a new entry in `BUILTIN_SLASH_COMMAND_DEFS` / `packages/coding-agent/src/slash-commands/builtin-registry.ts` plus a component under `packages/tui/src/overlays/` — that is not a plugin capability.