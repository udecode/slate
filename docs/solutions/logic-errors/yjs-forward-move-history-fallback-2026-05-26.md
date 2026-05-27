---
title: Encode forward move_node history fallback at the post-hide index
date: 2026-05-26
category: logic-errors
module: slate-yjs
problem_type: logic_error
component: tooling
symptoms:
  - Keyboard undo after a reconnected offline block move changed only the initiating editor
  - Other connected peers stayed on the moved order after Cmd+Z
  - Reconcile snapped the initiating editor back to the remote Yjs order
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [slate-yjs, yjs, move-node, undo-redo, playwright]
---

# Encode forward move_node history fallback at the post-hide index

## Problem
After an offline peer moved a block, reconnected, and pressed keyboard Undo, the initiating editor showed the undone order while the other peers stayed on the moved order.

## Symptoms
- Reconnect converged all peers to `beta / alpha / gamma!`.
- Keyboard Undo on B changed B to `alpha / beta / gamma!`.
- A/C/D stayed at `beta / alpha / gamma!`.
- B Reconcile restored B to `beta / alpha / gamma!`, proving B's Yjs document had not encoded the local undo.

## What Didn't Work
- Checking the button path alone was misleading. The Undo button used the Yjs history stack and converged, while keyboard Undo fell back to operation replay.
- Treating the browser event path as the root cause missed the real failure: the fallback `move_node` encoder accepted the operation but produced no visible Yjs value change.
- Waiting longer did not help. The split was stable because the wrong Yjs tree state had already been exported.

## Solution
For same-parent forward moves, insert the cloned node one visible slot after `operation.newPath` before hiding the original node:

```ts
const truePath = sameParentForwardMove
  ? [...operation.newPath.slice(0, -1), operation.newPath.at(-1)! + 1]
  : PathApi.transform(operation.newPath, {
      node: node ?? { text: '' },
      path: operation.path,
      type: 'remove_node',
    })
```

The regression should cover both layers:

- Core: `move_node [0] -> [1]` encodes `beta / alpha / gamma` into the Yjs tree.
- Browser: offline move, reconnect, keyboard Undo, keyboard Redo, assert every peer converges.

## Why This Works
`@slate/yjs` encodes structural moves by cloning the visible Yjs node to the destination and marking the original with `slate:deleted`. For a same-parent forward move, the original node is still visible while the insert index is computed. Inserting at `newPath` places the clone before the destination sibling, then hiding the original leaves the visible order unchanged. Advancing the insert index by one matches Slate's post-remove move semantics.

## Prevention
- Test both backward and forward `move_node` operations when using clone-and-hide structural encoding.
- Browser collaboration tests should exercise keyboard history, not just toolbar buttons.
- When a local editor changes but Reconcile restores the remote value, inspect the Yjs document state before debugging UI rendering.

## Related Issues
- `docs/solutions/ui-bugs/yjs-user-history-button-routing-2026-05-25.md`
- `docs/solutions/runtime-errors/yjs-disconnected-undo-history-offset-2026-05-25.md`
- `docs/solutions/logic-errors/yjs-offline-replace-undo-concurrent-append-2026-05-25.md`
