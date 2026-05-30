---
"slate": patch
"slate-dom": patch
"slate-react": patch
---

Track split leaf offsets in the DOM so projected root-chrome clicks resolve to the visual line edge instead of the browser's fallback caret point, and restore the previous root selection for unfocused editable-root chrome clicks without inventing a root-end caret when no selection exists.

Command middleware returns a strict boolean: `true` means handled, `false` means unhandled and eligible for the next command handler. Internal command registration helpers are exposed from `slate/internal`.
