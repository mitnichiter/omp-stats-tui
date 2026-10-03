# Hardcode plain Unicode for data ink; route only chrome through the symbol preset

Chart ink — bar fills, ramp steps, heatmap cells — is written as plain Unicode block and shade characters,
the way the host's own usage dashboard hardcodes its miniature bars. Chrome (box drawing, icons, progress
bars) goes through the theme's symbol preset as usual. The reason is not convenience: `theme.symbol()` only
resolves keys the host already registers, and the eighth-block ramp and shade ramp are not among them, so
"route everything through the preset" is not a policy we can actually implement without patching a package
we do not own.

## Considered Options

- **Route every decorative glyph through `theme.symbol()`** so the `ascii` preset renders correctly.
  Rejected: it requires registering new symbol keys upstream. The existing registry covers `sep.block`,
  `progress.filled`/`empty` and box drawing — not the chart ramps — so this would either degrade every
  chart to the same three glyphs or depend on an upstream change that may never come.
- **Branch on terminal capability to detect glyph coverage.** Rejected as unsound: no such detection exists
  or is reliable, and the host has none. Presets are opt-in settings, never detections, and anything we
  infer ourselves will be wrong for someone.
- **Use braille for higher-resolution plots.** Rejected: sub-cell colour is impossible, so it destroys
  exactly the per-cell colour channel a heatmap depends on, and it renders as tofu rather than degrading
  gracefully where unsupported.

## Consequences

A user on the `ascii` preset gets Unicode chart ink inside a panel whose chrome is ASCII. That is a
mismatch we accept knowingly: a chart drawn with `#` and `=` cannot show eight levels of magnitude, and
silently flattening the chart to show three glyphs would misrepresent the data. Emoji and Nerd Font
private-use codepoints are excluded from data ink for the same reason — unstable terminal width, and a
tofu box wherever the font lacks the glyph.