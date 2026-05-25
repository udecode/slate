---
title: Sync full-document replaces after DOM text sync
date: 2026-05-24
category: ui-bugs
module: slate-react
problem_type: ui_bug
component: tooling
symptoms:
  - Yjs Undo button removed text from the model and remote peer but left the initiator DOM stale
  - Cmd+Z did not reproduce the same stale DOM state
  - Playwright saw the initiating peer keep appended text after undo
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [slate-react, slate-yjs, dom-sync, full-document-replace, playwright]
---

# Sync full-document replaces after DOM text sync

## Problem
The `yjs-collaboration` example's Undo button could make the initiating peer appear divergent: the shared Yjs document and Slate model had removed the appended text, but the editable DOM still showed it.

## Symptoms
- Clicking `Append` then `Undo` on the same peer left that peer showing the appended name.
- The remote peer removed the appended text correctly.
- `__slateBrowserHandle.getText()` returned the correct model text while `textContent` still contained the stale appended text.
- Manual Cmd+Z did not reproduce the bug because browser-owned history paths trigger the editable render/repair path differently.

## What Didn't Work
- Delegating Yjs undo to Slate history was not a fix for this DOM sync bug; it left the Yjs undo stack behavior untested and moved the user-control semantics into a separate follow-up.
- Importing the Yjs snapshot after `stack-item-popped` fixed the initiating peer's model, but not its DOM.
- Forcing the editable to render from `@slate/yjs/react` was not enough because the mounted text selector cache still considered the reverted text unchanged.

## Solution
Keep Yjs history in `@slate/yjs` and repair the React DOM layer where the stale DOM is created:

- Defer `tx.yjs.undo()` and `tx.yjs.redo()` out of the active editor transaction.
- After a Yjs history pop, import the shared Yjs snapshot back into the initiating editor.
- In Slate React, when a full-document replace has no text operations, sync affected text runtime IDs directly to the DOM.
- Cover the path with both Playwright and a slate-react regression test.

```ts
if (commit?.fullDocumentChanged && commit.operations.length === 0) {
  syncTextRuntimeIdsToDOM(reactEditor, commit.affectedTextRuntimeIds)
}
```

## Why This Works
The initial append is a text operation, so Slate React can skip a component render and write the text directly to the DOM. That leaves the mounted text selector cache at the pre-append text. When a later full-document replace reverts to that same pre-append text, React sees no selector change and leaves the DOM mutation in place. Syncing affected text runtime IDs on full-document replace updates the DOM from the model even when selector equality correctly says the cached value is unchanged.

## Prevention
- When a model is correct but the editor DOM is stale, inspect both `__slateBrowserHandle.getText()` and `textContent` before changing collaboration logic.
- Treat DOM text sync optimizations as a separate render layer from collaboration state.
- Add browser coverage for collaboration buttons, not only keyboard paths.
- Add unit coverage for "text op synced to DOM, then full-document replace back to the cached text."

## Related Issues
- `docs/solutions/runtime-errors/yjs-cursor-external-store-snapshot-2026-05-24.md` covers a different Yjs React integration failure around external-store snapshot identity.
- `docs/solutions/ui-bugs/yjs-user-history-button-routing-2026-05-25.md` covers the follow-up that routes user-facing Undo and Redo buttons through Slate history.
