---
title: Preserve concurrent appends after offline replace undo
date: 2026-05-25
category: logic-errors
module: slate-yjs
problem_type: logic_error
component: tooling
symptoms:
  - A disconnected peer replaces the document and undoes the replacement
  - A connected peer appends text while the other peer is offline
  - Reconnecting removes the connected peer's appended text
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [slate-yjs, yjs, undo, reconnect, replace-children, playwright]
---

# Preserve concurrent appends after offline replace undo

## Problem
A peer could replace the full document while offline, undo that replacement
before reconnecting, and still remove a connected peer's later append when the
Yjs docs exchanged updates.

## Symptoms
- Peer B disconnects.
- Peer B clicks `Replace`, then `Undo`.
- Peer A clicks `Append`.
- Peer B reconnects.
- Both peers lose A's `Ada` append, even though B had already undone the
  replacement locally.

## What Didn't Work
- Routing the button through Slate history was necessary but not enough. The
  Slate value was restored locally, while the Yjs update history still contained
  a structural delete.
- Calling `Y.UndoManager.undo()` restored B's local Yjs value, but the original
  delete of the parent containers still participated in later CRDT merging and
  removed A's concurrent insert inside those containers.
- Rewriting the whole Yjs snapshot after undo also failed the intent: it made
  the local value look correct while preserving destructive update history.

## Solution
Encode `replace_children` without deleting the replaced Yjs containers. Mark
the old children with an internal hidden attribute and insert the replacement
children as visible nodes:

```ts
const DELETED_ATTRIBUTE = 'slate:deleted'

for (const child of replacedChildren) {
  child.setAttribute(DELETED_ATTRIBUTE, true)
}

parent.insert(
  getYjsInsertIndexForSlateIndex(parent, operation.index),
  slateNodesToYjsChildren(operation.newChildren)
)
```

All Slate reads and path lookups skip hidden Yjs nodes:

```ts
const isYjsDeleted = (node: Y.XmlElement | Y.XmlText) => {
  const value = node.getAttribute(DELETED_ATTRIBUTE)

  return value === true || value === 'true'
}
```

`Y.UndoManager` then removes the hidden attribute when the user undoes the
replacement. Because the original containers were never deleted, concurrent
remote inserts inside those containers survive the later sync.

Also listen to `stack-item-updated` so Yjs undo stack metadata stays aligned
when Yjs merges transactions within its capture window.

## Why This Works
Yjs is excellent at merging operations inside live shared types. It cannot infer
that a later undo should protect a remote insert inside a parent type that was
deleted by an earlier offline update. Keeping the container alive and hiding it
turns document replacement into reversible visibility plus insertion, so
concurrent inserts remain attached to their original shared type.

## Prevention
- Prefer operation-level Yjs updates over full-snapshot replacement for user
  edits.
- Do not encode replace/delete operations by deleting parent containers when
  undo should be able to reveal concurrent edits inside them.
- Add both core and browser coverage:
  - core: disconnected replace, undo, remote append, sync
  - browser: `B Disconnect -> B Replace -> B Undo -> A Append -> B Connect`

## Related Issues
- `docs/solutions/runtime-errors/yjs-disconnected-undo-history-offset-2026-05-25.md`
- `docs/solutions/ui-bugs/yjs-user-history-button-routing-2026-05-25.md`
