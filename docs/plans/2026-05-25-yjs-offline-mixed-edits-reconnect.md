# Yjs Offline Mixed Edits Reconnect

## Goal

Fix the four-peer Yjs demo path where disconnected peers make independent mark,
text replacement, and paragraph insertion edits, then reconnect in sequence.
The merged document should preserve the text replacement and insertion instead
of dropping `Hi` or duplicating `Hello world!`.

## Scope

- Add Playwright coverage for the browser-visible regression.
- Fix the collaboration/Yjs import or encoding path that causes destructive
  snapshot-style reconnect behavior.
- Verify with the focused Yjs example test and package checks.

## Progress

- Reproduced manually in `dev-browser`.
- Reviewed existing Yjs solution notes for reconnect history and hidden
  replacement containers.
- Added a failing Playwright regression for offline mark, text replacement, and
  paragraph insertion edits.
- Fixed `split_node` Yjs encoding so Enter does not fall back to a full-document
  snapshot write.
- Verified package build/typecheck, focused core tests, full Yjs example
  Playwright, lint, and dev-browser manual repro.
