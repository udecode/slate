# Slate Yjs Button Hardening

Date: 2026-05-24
Status: complete

## Target

Fix the `yjs-collaboration` control-button paths:

- `Undo` / `Redo` buttons must not diverge the initiating peer from the shared Yjs document.
- `Replace` must export to the shared Yjs document and converge both peers.
- Existing `Connect`, `Disconnect`, `Pause`, `Resume`, `Append`, `Select`, and `Reconcile` controls need focused browser coverage or explicit checked behavior.

## Evidence

- Manual browser sweep found `Undo` from the initiating peer leaves the initiator stale while the remote peer imports the Yjs undo.
- Manual browser sweep found `Replace` changes only the clicked peer, then later remote activity can overwrite it.
- `Cmd+Z` uses Slate history through `beforeinput historyUndo`; the broken button path uses `tx.yjs.undo()`.
- The initiating peer's model converged after button undo, but its editable DOM retained text written by DOM text sync.

## Verification Log

- `bun test ./packages/slate-yjs/test/core-contract.ts` - 8 passed.
- `bun --filter @slate/yjs build` - passed.
- `bun --filter slate-react build` - passed.
- `PLAYWRIGHT_RETRIES=0 PLAYWRIGHT_WORKERS=1 bun playwright playwright/integration/examples/yjs-collaboration.test.ts --project=chromium` - 6 passed.
- `bun install` - lockfile saved, no install changes.
- `bun --filter @slate/yjs typecheck` - passed.
- `bun --filter slate-react typecheck` - passed.
- `bun test:vitest test/dom-strategy-and-scroll.test.tsx` from `packages/slate-react` - 38 passed.
- `bun lint:fix` - no fixes applied.
- `bun lint` - passed.

## 2026-05-25 Reopened Slice

Finding: the example labels `Undo` / `Redo` as user controls, but they call
`tx.yjs.undo()` / `tx.yjs.redo()`. Keyboard undo/redo is routed through
Slate history, so the button controls are testing a lower-level CRDT stack
instead of the real user history path.

Acceptance:

- Add browser regression coverage for real typing followed by button
  `Undo` / `Redo`.
- Change the example user-facing `Undo` / `Redo` buttons to call Slate history.
- Keep Yjs UndoManager coverage in package-level tests rather than pretending
  the demo button is user undo.
- Verify with focused Playwright, source-first typecheck for the touched app
  surface, and lint.

Verification:

- Red: `PLAYWRIGHT_RETRIES=0 PLAYWRIGHT_WORKERS=1 bun playwright playwright/integration/examples/yjs-collaboration.test.ts --project=chromium --grep "shares user history"` failed before the fix because the Redo button did not restore text after keyboard undo.
- Green: `PLAYWRIGHT_RETRIES=0 PLAYWRIGHT_WORKERS=1 bun playwright playwright/integration/examples/yjs-collaboration.test.ts --project=chromium --grep "shares user history"` passed.
- `PLAYWRIGHT_RETRIES=0 PLAYWRIGHT_WORKERS=1 bun playwright playwright/integration/examples/yjs-collaboration.test.ts --project=chromium` - 7 passed.
- `bun typecheck:site` - passed.
- `bun lint:fix` - no fixes applied.
- `dev-browser --connect http://127.0.0.1:9222` on `persistent-main` verified keyboard undo followed by the Redo button restores typed text in both peers.
- `bun typecheck:root` - passed.
- `bun lint` - passed.

## 2026-05-25 User-Path Controls Slice

Finding: `Append`, `Select`, and `Replace` were still direct editor
transaction helpers. They produced useful simulation state, but they did not
exercise the same Slate React browser-input and DOM-selection paths as a real
user.

Acceptance:

- `Append` sets a DOM selection at the document end and inserts text through
  native editor input.
- `Select` sets the DOM selection instead of directly setting Slate selection.
- `Replace` dispatches a browser-style `beforeinput` with target ranges so the
  replacement enters Slate history and Yjs export like user typing.
- Network/debug controls (`Connect`, `Disconnect`, `Pause`, `Resume`,
  `Reconcile`) keep using `tx.yjs`.

Verification:

- Red: `PLAYWRIGHT_RETRIES=0 PLAYWRIGHT_WORKERS=1 bun playwright playwright/integration/examples/yjs-collaboration.test.ts --project=chromium --grep "routes append button|replace button uses user history"` failed because `Append` did not emit native input and `Replace` did not enable user undo.
- Green: same focused Playwright command passed.
- `PLAYWRIGHT_RETRIES=0 PLAYWRIGHT_WORKERS=1 bun playwright playwright/integration/examples/yjs-collaboration.test.ts --project=chromium` - 9 passed.
- `dev-browser --connect http://127.0.0.1:9222` verified Append emits `input:insertText`, Replace syncs both peers, and Replace undo/redo restores both peers.
- `bun typecheck:site` - passed.
- `bun typecheck:root` - passed.
- `bun lint:fix` - formatted files.
- `bun lint` - passed.

## 2026-05-25 Offline Replace Undo Slice

Finding: a disconnected peer could replace the full document, undo that
replacement before reconnecting, and still send the old Yjs delete history on
reconnect. That deleted a remote append made while the peer was offline.

Acceptance:

- A disconnected `Replace -> Undo` must not remove a connected peer's later
  append when the disconnected peer reconnects.
- Keep connected `Replace`, disconnected append merge, and reconnect undo
  behavior covered.
- Add core coverage for the Yjs merge shape and Playwright coverage for the
  browser example.

Verification:

- Red: `PLAYWRIGHT_BASE_URL=http://localhost:3100 PLAYWRIGHT_RETRIES=0 PLAYWRIGHT_WORKERS=1 bun playwright playwright/integration/examples/yjs-collaboration.test.ts --project=chromium --grep "preserves remote appends"` failed because A's `Ada` was removed after B reconnected.
- Green: same focused Playwright command passed.
- `bun test ./packages/slate-yjs/test/core-contract.ts` - 9 passed.
- `PLAYWRIGHT_BASE_URL=http://localhost:3100 PLAYWRIGHT_RETRIES=0 PLAYWRIGHT_WORKERS=1 bun playwright playwright/integration/examples/yjs-collaboration.test.ts --project=chromium` - 13 passed.
