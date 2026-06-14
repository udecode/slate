# slate-browser

Browser proof harness for the production Slate replacement stack.

`slate-browser` owns browser proof lanes. It is proof infrastructure, not the
product surface of Slate itself.

Stable package surface:

- `slate-browser/core`
  - pure selection helpers
- `slate-browser/browser`
  - DOM selection and zero-width helpers
- `slate-browser/playwright`
  - start here for browser proof work
  - editor-first Playwright harness
  - Chromium CDP IME helpers
  - real clipboard write + browser paste helpers
  - real clipboard read helpers
  - readiness contract for mounted examples
  - getter namespace for text/html/selection state
  - selected-text getter
  - displayed-selection getter for native and projected selection proof
  - screenshot attachment helper for visual proof artifacts
  - file-backed JSON attachment helper for replayable proof artifacts
  - native event trace helpers for `selectionchange`, `beforeinput`, `input`,
    composition, target ranges, DOM deltas, and anomaly labels
  - block-text getter and assertion helpers
  - snapshot helper for aggregated editor state
  - selection namespace for semantic selection actions and setup
  - DOM namespace for mounted text-path readiness and native caret setup
  - bookmark/capture helpers backed by real Slate range refs
  - tolerant selection assertions
  - collapsed model/native DOM selection agreement assertions
  - double-highlight selection assertion
  - normalized html equality assertions
  - iframe and scoped-surface support
  - block/text locator helpers
  - replayable scenario steps, including direct DOM text mutation import for
    contenteditable repair proof
  - replayable selection-contract assertions for model, native selected text,
    DOM endpoints, visible selection, and double-highlight proof

Secondary public surface:

- Playwright helper types:
  - `ReadyOptions`
  - `EditorSurfaceOptions`
  - selection and clipboard snapshot types
  - native event trace snapshot and anomaly types
- `withExclusiveClipboardAccess(...)`
- `slate-browser/transports`
  - browser-mobile transport descriptors
  - proof-scope classifiers for mobile transport claims
  - current adapter builders for:
    - `agent-browser` iOS
    - Appium Android
    - Appium iOS

Freeze rule:

- keep `slate-browser` as proof infrastructure, not product API
- keep the current subpath surface and `ready` contract as the stable package shape
- keep transport identity explicit; no fake universal driver
- Appium descriptors can close automated device-browser input/IME proof only
  when the device gate actually runs; `agent-browser` iOS is proxy evidence,
  and the current automated surface does not claim native mobile clipboard,
  human soft-keyboard, glide typing, or voice input proof

Use the `ready` contract for maintained callsites and examples.
For editor surfaces, do not use Playwright `locator.fill()` as proof. Slate
owns model input through `beforeinput`, selection import, and editor commands;
`fill()` can bypass or mis-model that path, especially in Firefox. Use
`editor.type(...)` or `page.keyboard.type(...)` when the claim is real keyboard
behavior: typing, selected-text replacement, undoable key input, focus/caret
routing, Enter follow-up text, or visual caret proof. Use
`page.keyboard.insertText(...)` only when the row deliberately bypasses keydown:
native `beforeinput` / `targetRange` traces, IME or CDP input, Unicode/layout
insertion that Playwright cannot key-dispatch consistently, direct browser DOM
mutation import, undo grouping as one text insertion, or model-latency probes.
Every remaining `insertText` call in non-pagination example specs is classified
by `packages/slate-browser/test/core/keyboard-oracle-audit.test.ts`.
Then assert model text, native selection, and native event trace when the
behavior depends on browser input.
Native event traces are browser contracts, not one-size-fits-all strings:
Chromium/WebKit `insertText` may produce only `beforeinput`, while Firefox can
report `insertCompositionText` and a trailing `input` event for the same
Playwright call.
Clipboard helpers prove delivery path and editor ownership, not feature
semantics by themselves. `editor.clipboard.pasteHtml(...)` writes a rich
clipboard payload and triggers the browser paste path; the route-specific test
must still assert the expected parser behavior. Do not treat it as proof that a
surface supports every rich HTML mark, element, sanitizer, or table policy.
Use replayable scenario steps for generated stress. For direct browser DOM
mutation/import proof, use `mutateTextDOM` so the artifact stays replayable;
do not hide DOM mutation work in a `custom` step unless the packet is explicitly
non-replayable.
Generated stress artifacts carry reduction candidates. Replay the full artifact
with `STRESS_REPLAY=<artifact> bun test:stress:replay:<project>`. Replay one
candidate with
`STRESS_REPLAY=<artifact> STRESS_REDUCTION=<label> bun test:stress:replay:<project>`.
Reduced replays write a separate `.reduction-<label>.result.json` trace beside
the full replay result.

Example:

```ts
import {
  attachSlateBrowserJsonArtifact,
  attachPageScreenshot,
  openExample,
  startSlateBrowserNativeEventTrace,
  stopSlateBrowserNativeEventTrace,
  takeSlateBrowserNativeEventTrace,
} from 'slate-browser/playwright'

const editor = await openExample(page, 'placeholder', {
  ready: {
    editor: 'visible',
    placeholder: 'visible',
  },
})

await editor.focus()
await editor.type('Hello Slate Browser')
await editor.selection.select({
  anchor: { path: [0, 0], offset: 0 },
  focus: { path: [0, 0], offset: 5 },
})
await editor.dom.waitForTextPath([0, 0])
await editor.dom.collapseAtTextPath({ path: [0, 0], offset: 5 })

await editor.assert.text('Hello Slate Browser')
await editor.assert.blockTexts(['Hello Slate Browser'])
expect(await editor.get.selectedText()).toBe('Hello')
expect((await editor.selection.displayed()).source).toBe('native')
await editor.assert.noDoubleSelectionHighlight()
await attachPageScreenshot(page, testInfo, 'selection-proof.png')

await startSlateBrowserNativeEventTrace(editor.root)
await editor.type('!')
const nativeTrace = await takeSlateBrowserNativeEventTrace(editor.root)
expect(nativeTrace.entries.some((entry) => entry.type === 'beforeinput')).toBe(
  true
)
await stopSlateBrowserNativeEventTrace(editor.root)

await editor.assert.htmlContains('data-slate-string="true"')
await editor.assert.selection({
  anchor: { path: [0, 0], offset: [0, 1] },
  focus: { path: [0, 0], offset: [4, 5] },
})
await editor.assert.collapsedModelDOMSelection({
  offset: [4, 5],
  path: [0, 0],
  text: 'Hello Slate Browser',
})
await editor.assert.htmlEquals(
  '<div data-slate-node="element"><span data-slate-node="text"><span data-slate-leaf="true"><span data-slate-string="true">Hello Slate Browser</span></span></span></div>',
  { ignoreClasses: true, ignoreInlineStyles: true, ignoreDir: true }
)

const snapshot = await editor.snapshot()
expect(snapshot.selection).not.toBeNull()
await attachSlateBrowserJsonArtifact(testInfo, 'editor-snapshot-proof', snapshot)

const secondBlock = editor.locator.block([1])
await secondBlock.click({ clickCount: 3 })
await editor.selection.doubleClickDragTextRange({
  doubleClickOffset: 'This is edit'.length,
  endOffset: 'This is editable plain'.length,
  text: 'This is editable plain text, just like a <textarea>!',
})
await editor.selection.dragTextRange({
  endOffset: 5,
  endText: ' text, ',
  startOffset: 8,
  text: 'This is editable ',
})
await editor.selection.dragTextRange({
  direction: 'backward',
  endOffset: 'hyperlink'.length,
  startOffset: 0,
  text: 'hyperlink',
})
await editor.scenario.run([
  {
    expectation: {
      domSelection: {
        anchorNodeText: 'This is editable ',
        anchorOffset: 8,
        focusNodeText: ' text, ',
        focusOffset: 5,
      },
      noDoubleSelectionHighlight: true,
      selectedText: 'editable rich text',
    },
    kind: 'assertSelectionContract',
  },
])

const bookmark = await editor.selection.capture({ affinity: 'inward' })
await editor.selection.restore(bookmark)
await editor.selection.unref(bookmark)

await editor.clipboard.pasteText('more')
await editor.clipboard.copy()
expect(await editor.clipboard.readText()).toContain('more')
```

For Tab-away or blur proof, use `editor.assert.noVisibleCaretInRoot()` after
focus leaves the editor. It asserts the editor no longer owns a paintable
focused caret even if the browser keeps a stale DOM range.

Root commands:

- `bun --filter slate-browser build`
- `bun --filter slate-browser test`
- `bun run setup:slate-browser`
- `bun run test:slate-browser`
- `bun run test:slate-browser:core`
- `bun run test:slate-browser:dom`
- `bun run test:slate-browser:selection`

The package-local `test` script covers:

- `test:core`
- `test:dom`
- `test:selection`
