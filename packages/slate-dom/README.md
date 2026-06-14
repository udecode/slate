# slate-dom

DOM bridge for Slate editors.

`slate-dom` owns DOM point/range conversion, selection conversion, clipboard
formatting, hotkey helpers, contenteditable helpers, and DOM coverage boundary
metadata used by React and browser-proof layers.

React apps normally use these APIs through `slate-react`:

```ts
editor.api.dom.focus()
editor.api.clipboard.insertTextData(dataTransfer)
```

Use direct `slate-dom` imports for framework/runtime integration code that
needs DOM coverage types or DOM bridge helpers without React.

```ts
import { DOMCoverage } from 'slate-dom'
```

DOM coverage boundaries model same-root content whose DOM is hidden, staged, or
virtualized. They keep selection, copy, find, and Slate-to-DOM conversion tied
to explicit policies instead of assuming every document node is mounted.

Framework packages own bridge installation.
