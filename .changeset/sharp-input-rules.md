---
"slate-react": major
---

Remove `Editable` input rules and `editableInputRules`.

**Migration:** Use `editor.extend({ transforms: ... })` for model-owned input behavior, or `onDOMBeforeInput` for browser-specific input handling.
