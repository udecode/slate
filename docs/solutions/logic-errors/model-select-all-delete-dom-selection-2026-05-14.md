---
title: Model Select-All Delete DOM Selection
date: 2026-05-14
category: docs/solutions/logic-errors
module: slate-react editable runtime
problem_type: logic_error
component: tooling
symptoms:
  - Keyboard select-all followed by Delete removed only the first character.
  - Preserving the model selection exposed a crash after deleting the only root block.
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [slate-react, selection, keyboard, delete, playwright]
---

# Model Select-All Delete DOM Selection

## Problem

Keyboard select-all in a model-owned Slate editor can create a valid expanded model selection without creating a matching browser DOM range. The following Delete keydown must preserve that model selection instead of importing the collapsed DOM selection.

## Symptoms

- `Meta+A` followed by `Delete` in the Yjs collaboration example changed `Alpha shared document` to `lpha shared document`.
- After preserving the expanded model selection, full-block delete removed the only top-level block and React rendered the error boundary with `Cannot get the start point in the node at path [] because it has no start text node.`

## What Didn't Work

- Setting model-selection preference during select-all was not enough by itself. The next destructive keydown still forced a DOM selection import and overwrote the expanded model selection.

## Solution

Preserve an expanded preferred model selection during Delete keydown preparation:

```ts
const shouldPreservePreferredModelSelection =
  intent === 'delete' &&
  inputController.preferModelSelectionForInputRef.current &&
  selectionBefore !== null &&
  RangeApi.isExpanded(selectionBefore)

const shouldForceDOMImport =
  !shouldPreservePreferredModelSelection &&
  (intent === 'delete' ||
    intent === 'format' ||
    intent === 'insert-break' ||
    intent === 'model-selection-move')
```

When full-block delete removes the whole document, insert an empty paragraph and collapse selection into it:

```ts
if (removesWholeDocument) {
  const selectionPoint = { path: [0, 0], offset: 0 }

  tx.nodes.insert(createDefaultParagraph(), { at: [0] })
  tx.selection.set({ anchor: selectionPoint, focus: selectionPoint })
}
```

## Why This Works

The model selection is the source of truth after Slate handles keyboard select-all. Delete should use that range, because the DOM selection can still be collapsed or empty. Once the expanded range deletes the selected root block, Slate still needs a valid text node at the root so rendering and later selection reads have a legal start point.

## Prevention

- Browser regression tests for keyboard selection should assert the edited document text, not only absence of page errors.
- Full-document delete tests should assert the editor remains renderable and synchronized after the visible text becomes empty.

## Related Issues

- `playwright/integration/examples/yjs-collaboration.test.ts`
