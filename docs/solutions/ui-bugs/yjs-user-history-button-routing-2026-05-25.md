---
title: Route Yjs example buttons through user paths
date: 2026-05-25
last_updated: 2026-05-25
category: ui-bugs
module: slate-yjs
problem_type: ui_bug
component: tooling
symptoms:
  - Yjs example buttons did not share redo state with keyboard undo
  - Cmd+Z removed typed text but the Redo button could not restore it
  - Append did not emit native editor input
  - Replace changed local editor state without entering user history
  - The example labeled lower-level simulation controls as user controls
root_cause: wrong_api
resolution_type: code_fix
severity: high
tags: [slate-yjs, slate-history, beforeinput, undo-redo, playwright]
---

# Route Yjs example buttons through user paths

## Problem
The `yjs-collaboration` example exposed buttons labeled `Undo` and `Redo`, but
they called `tx.yjs.undo()` and `tx.yjs.redo()`. Those labels imply the same
history path as `Cmd+Z` and `Cmd+Shift+Z`, so the demo was mixing user history
with the lower-level CRDT history stack.

The same mistake showed up in the other editing controls. `Append`, `Select`,
and `Replace` used direct editor helpers instead of the DOM selection and
browser input paths a real user exercises.

## Symptoms
- Type text into peer A, press `Cmd+Z`, then click peer A `Redo`: the typed
  text stayed removed.
- Programmatic `Append -> Undo -> Redo` could pass because it created a clean
  Yjs undo item.
- Keyboard history and button history behaved like separate stacks.
- `Append` synchronized text but did not emit native `input:insertText`.
- `Replace` could update the clicked editor without enabling user undo or
  exporting through the same path as real replacement typing.

## What Didn't Work
- Testing only `Append -> Undo -> Redo` missed the issue because that path stays
  inside Yjs-tracked programmatic transactions.
- Treating the failure as a DOM sync bug was the wrong layer for this specific
  case; the DOM and model both agreed after the failed redo.
- Calling Slate transforms directly from example buttons kept the simulation
  easy to write but bypassed Slate React's browser event integration.

## Solution
Route user-facing editing controls through the same browser and Slate history
paths as real users.

Use the Slate history controller that keyboard history uses for `Undo` and
`Redo`:

```tsx
const history = useSlateHistory()

const undo = () => history.undo()
const redo = () => history.redo()
```

Disable the controls from the same controller state:

```tsx
<button disabled={!history.canUndo} onClick={undo}>
  Undo
</button>
<button disabled={!history.canRedo} onClick={redo}>
  Redo
</button>
```

For text insertion, set a DOM selection and ask the browser editing layer to
insert text:

```tsx
selectDOMRange(editor, { anchor: point, focus: point })
document.execCommand('insertText', false, ` ${name}`)
```

For selection, set the DOM selection and dispatch `selectionchange`:

```tsx
const domRange = domEditor.resolveDOMRange(range)
selection.removeAllRanges()
selection.addRange(domRange)
document.dispatchEvent(new Event('selectionchange'))
```

For replacement, dispatch a browser-style `beforeinput` with target ranges so
Slate React handles it as real replacement typing:

```tsx
const event = new InputEvent('beforeinput', {
  bubbles: true,
  cancelable: true,
  data: text,
  inputType: 'insertText',
})

event.getTargetRanges = () => [staticRange]

element.dispatchEvent(event)
```

Keep `tx.yjs` controls for network and CRDT simulation: `Connect`,
`Disconnect`, and `Reconcile`.

## Why This Works
`Cmd+Z` is classified as a history intent and routed through `tx.history`.
`useSlateHistory()` calls the same transaction API and exposes the same
availability state. Once the buttons use that controller, keyboard undo and
button redo share one user history stack, and each Slate history operation is
then exported through the Yjs collaboration binding like any other local edit.

The DOM-selection and `beforeinput` paths exercise Slate React's real editable
integration. That means the example checks selection import, input handling,
history grouping, and Yjs export together instead of validating only a direct
transaction helper.

## Prevention
- User-facing example editing controls should go through browser selection,
  browser input, or Slate history. Direct `tx.yjs` calls belong to network and
  collaboration simulation controls.
- Add Playwright coverage that mixes keyboard and button history:
  type text, press `Cmd+Z`, click `Redo`, and assert both peers restore the text.
- Add Playwright coverage that proves `Append` emits native editor input and
  that `Replace` can undo and redo through user history.
- Keep CRDT UndoManager tests explicit in package tests so failures are not
  confused with user-history behavior.

## Related Issues
- `docs/solutions/ui-bugs/yjs-button-undo-dom-sync-2026-05-24.md` covers the
  separate case where Yjs history changed the model but left the initiator DOM
  stale.
