---
title: Cache external store snapshots for Yjs cursor state
date: 2026-05-24
category: runtime-errors
module: slate-yjs
problem_type: runtime_error
component: tooling
symptoms:
  - React production error 185 before the Yjs example editor mounted
  - Playwright could not find the editor textbox because the example crashed
root_cause: wrong_api
resolution_type: code_fix
severity: high
tags: [react, yjs, use-sync-external-store, cursor-state]
---

# Cache external store snapshots for Yjs cursor state

## Problem
The `yjs-collaboration` example crashed before mounting because the remote cursor hook exposed an unstable external-store snapshot.

## Symptoms
- React rendered production error 185 in the example error boundary.
- Playwright waited for `#yjs-peer-a-editor-surface [role="textbox"]` and timed out because the editor never mounted.

## What Didn't Work
- Treating the failure as selector drift missed the real page snapshot: the example crashed before any textbox existed.
- Returning `[]` or a freshly mapped cursor array from `getSnapshot` looked harmless, but it violated React's external store contract.

## Solution
Cache the remote cursor array by controller revision and return the same array reference until the next Yjs/editor notification.

```ts
getRemoteCursorStates(): SlateYjsRemoteCursorState[] {
  if (this.remoteCursorSnapshotRevision === this.revision) {
    return this.remoteCursorSnapshot
  }

  this.remoteCursorSnapshot = this.readRemoteCursorStates()
  this.remoteCursorSnapshotRevision = this.revision

  return this.remoteCursorSnapshot
}
```

## Why This Works
`useSyncExternalStore` snapshots must be referentially stable between store changes. A fresh array on every render tells React that the store changed during render, which can spin into a max-update-depth crash. Tying the array identity to the controller revision makes cursor projections update when collaboration state changes while keeping render-time reads stable.

## Prevention
- Any hook backed by `useSyncExternalStore` must return cached object and array snapshots.
- Add browser proof for new external-store-backed examples; production React errors may hide the useful development warning.
- When a Playwright ready selector times out, inspect the page snapshot before changing selectors.

## Related Issues
- None found in `docs/solutions`.
