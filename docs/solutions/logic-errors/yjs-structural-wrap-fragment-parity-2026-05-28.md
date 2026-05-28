---
title: Preserve Yjs identity through structural wrap and fragment edits
date: 2026-05-28
category: logic-errors
module: slate-yjs
problem_type: logic_error
component: tooling
symptoms:
  - Offline wrap_node drops a remote insert inside the wrapped node after reconnect.
  - Offline insert fragment drops a remote append at the same text position after reconnect.
  - Offline merge undo can leave the initiating editor split from the shared Yjs value.
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [slate-yjs, yjs, wrap-node, insert-fragment, undo-redo]
---

# Preserve Yjs identity through structural wrap and fragment edits

## Problem
Some offline structural edits were encoded by cloning visible Yjs nodes and hiding the originals. That made reconnect look locally correct, but concurrent remote text stayed attached to hidden containers and disappeared from the visible Slate value.

## Symptoms
- B goes offline, wraps the first block, A inserts `!` into that block, then B reconnects. Broken result: the wrapped block reads `alpha`; expected `alpha!`.
- B goes offline, inserts `Lin fragment` at the end of `alpha`, A appends ` Ada`, then B reconnects. Broken result: `alphaLin fragment`; expected `alpha AdaLin fragment`.
- B goes offline, merges `alpha / beta`, A appends to `beta`, then B reconnects and undoes. Broken result: B can stay at `alphabeta / empty` while other peers read `alpha / beta`.

## What Didn't Work
- Treating `wrap_node` as a normal `move_node` clone lost remote edits because the visible clone and hidden original were independent Yjs types.
- Replacing one text child with another for `insert_fragment` hid the original `Y.XmlText`, so remote inserts on the original text were skipped by readers.
- Letting a historic Slate undo commit export without reconciling back from Yjs allowed the local editor to keep a stale Slate replay even when the shared Yjs document had converged.

## Solution
Keep live Yjs identities in the paths that need CRDT conflict resolution.

For wrap-like moves, store a reference from the wrapper to the original moved node and hide the original only at its old root position. Read and path lookup helpers treat that referenced source as the wrapper's virtual child:

```ts
current.setAttribute(MOVE_REF_ID_ATTRIBUTE, refId)
destinationParent.setAttribute(WRAPPED_SOURCE_ATTRIBUTE, refId)
current.setAttribute(DELETED_ATTRIBUTE, 'true')
```

For single-text `replace_children` edits, apply a text diff to the existing `Y.XmlText` instead of hiding it and inserting a replacement container:

```ts
sharedText.delete(prefixLength, removedLength)
sharedText.insert(insertOffset, text, getNodeAttributes(leaf))
```

For historic commits, after exporting the Slate history replay to Yjs, read the canonical shared value and replace the local editor value when they differ.

## Why This Works
Yjs can rebase concurrent edits when both peers edit the same shared type. Clone-and-hide is acceptable for some move operations, but not when the hidden source still receives meaningful concurrent text. A virtual wrapper child keeps the original shared node alive for both local wrapped edits and remote updates. Text diffing keeps fragment insertion in the same `Y.XmlText`, so same-offset inserts order by Yjs conflict rules instead of disappearing behind `slate:deleted`.

The history fix handles the remaining mismatch layer: Slate's local undo replay can be structurally stale, while Yjs has already produced the correct collaborative value. Replacing local Slate state from Yjs after a historic export keeps the initiating peer converged.

## Prevention
- Add package-level tests for each structural encoder that can hide or clone a Yjs container.
- For browser examples, assert final peer text only; do not add style or disabled-state assertions to collaboration e2e tests.
- Treat Potion as a parity oracle only after confirming the same operation shape. Move/down clone loss still matches Potion and should stay out of this fix.
- When a fix needs conflict resolution, preserve the original Yjs shared type or add an explicit virtual reference back to it.

## Related Issues
- `docs/solutions/logic-errors/yjs-offline-replace-undo-concurrent-append-2026-05-25.md`
- `docs/solutions/logic-errors/yjs-split-history-empty-leaf-reconnect-2026-05-26.md`
- `docs/solutions/logic-errors/yjs-merge-read-virtual-text-leaves-2026-05-27.md`
