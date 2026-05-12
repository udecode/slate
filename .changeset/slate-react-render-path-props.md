---
"slate-react": minor
---

Remove eager `path` and `index` from element render props.

Resolve the current element path inside handlers with `ReactEditor.findPath(editor, element)`, or use `useElementPath()` for path-dependent render UI.
