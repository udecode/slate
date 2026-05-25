---
title: Filter example awareness by simulated network visibility
date: 2026-05-25
category: ui-bugs
module: slate-yjs
problem_type: ui_bug
component: tooling
symptoms:
  - Remote cursor presence stayed visible after a peer disconnected
  - The receiving peer still showed the disconnected user's last selection
root_cause: incomplete_setup
resolution_type: code_fix
severity: medium
tags: [slate-yjs, awareness, cursor-state, playwright]
---

# Filter example awareness by simulated network visibility

## Problem
The `yjs-collaboration` example simulated document-network disconnects, but its
fake awareness hub still returned every client state to every peer.

## Symptoms
- Peer A clicks `Select`.
- Peer B shows `101:0.0:0-0.0:6:{"color":"#2563eb","name":"Ada"}`.
- Peer A clicks `Disconnect`.
- Peer B still shows A's last cursor instead of `remote:none`.

## What Didn't Work
- Clearing only the selection field inside the package controller is not enough
  for this example, because the example's `Disconnect` button simulates the
  transport layer and keeps the local controller connected to its local Y.Doc.
- Deleting A's awareness state on disconnect would hide the cursor, but it would
  also lose the local presence that should be visible again after reconnect.

## Solution
Keep awareness state stored locally, but filter `getStates()` through the
simulated network connection graph. A viewer only receives its own state plus
states from currently connected peers.

Connection changes also emit an awareness change notification so subscribed
cursor hooks recompute immediately.

## Why This Works
Real providers remove or hide remote awareness when a peer goes offline. The
example's fake provider needs the same visibility rule; otherwise it proves
document synchronization while lying about presence.

Keeping the local state preserves reconnect behavior: after A reconnects, B can
see A's latest cursor again without recreating user metadata.

## Prevention
- Treat document updates and awareness visibility as separate simulated network
  channels.
- Add Playwright coverage for Select -> Disconnect -> `remote:none` -> Connect
  -> cursor restored.
- Do not implement disconnect by deleting local presence unless the product
  really wants local presence reset.

## Related Issues
- `docs/solutions/runtime-errors/yjs-cursor-external-store-snapshot-2026-05-24.md`
  covers cursor snapshot stability for `useSyncExternalStore`.
