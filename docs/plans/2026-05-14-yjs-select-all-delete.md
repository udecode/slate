# Yjs Select-All Delete Regression

## Goal

Reproduce and fix the collaboration example bug where keyboard select-all followed by Delete does not delete the full document.

## Evidence

- Focused Playwright repro uses `/examples/yjs-collaboration`.
- `Meta+A` is intercepted by Slate, but browser selection stays collapsed/empty.
- `Delete` then imports DOM selection and deletes only the first character, changing `Alpha shared document` to `lpha shared document`.
- Focused test is currently blocked by `next/font/google` fetching Roboto during the Next build.

## Plan

1. Remove the font build blocker from the example site.
2. Preserve model-owned select-all through the following destructive keydown.
3. Run the focused Playwright regression.
4. Run the relevant package/example checks.

## Progress

- Repro test added in `playwright/integration/examples/yjs-collaboration.test.ts`.
- Initial select-all preference patch added in `packages/slate-react/src/editable/keyboard-input-strategy.ts`.
- Removed `next/font/google` from the example app so Playwright builds do not depend on fetching Google font artifacts.
- Keydown kernel now preserves an expanded preferred model selection for Delete instead of force-importing a collapsed DOM selection.
- Full-block delete now preserves Slate's non-empty root invariant by inserting an empty paragraph when the delete removes the whole document.
- Verification passed:
  - `bunx playwright test playwright/integration/examples/yjs-collaboration.test.ts --project=chromium --grep "keyboard select-all"`
  - `bunx playwright test playwright/integration/examples/yjs-collaboration.test.ts --project=chromium`
  - `bun lint:fix`
  - `bun --filter slate-react typecheck`
  - `bun typecheck:site`
  - `bun --filter slate-react test`
  - `bun lint`
  - `bun check`
