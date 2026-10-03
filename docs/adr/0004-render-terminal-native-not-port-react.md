# Render terminal-native views; do not port the React dashboard

The web dashboard is a React 19 application: eleven screens, 4,637 lines of route components and 9,244
lines of TSX in total. The TUI is the opposite shape — a hand-written component whose whole interface is
`render(width) => readonly string[]`. Porting the dashboard means rewriting every screen into a rendering
model it was not written for, and the traces view in particular (2,126 lines of wheel-zoomed flamegraph
with a draggable viewport) is not a dashboard at all but a different application with no terminal
equivalent. We build terminal-native views over the same data instead, reusing the host's component kit
and its first-party idioms.

## Consequences

We accept a smaller feature surface than the browser dashboard, and v1 is a deliberate subset rather than a
checklist. Only the chart layer is genuinely cheap — a sparkline, a ranked bar list and a proportional split
bar each translate to a few lines, and 637 lines of chart code covers all of them. The cost is concentrated
in the screens, not the drawing primitives.