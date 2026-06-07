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

Secondary public surface:

- Playwright helper types:
  - `ReadyOptions`
  - `EditorSurfaceOptions`
  - selection and clipboard snapshot types
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

Example:

```ts
import { openExample } from 'slate-browser/playwright'

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

const secondBlock = editor.locator.block([1])
await secondBlock.click({ clickCount: 3 })

const bookmark = await editor.selection.capture({ affinity: 'inward' })
await editor.selection.restore(bookmark)
await editor.selection.unref(bookmark)

await editor.clipboard.pasteText('more')
await editor.clipboard.copy()
expect(await editor.clipboard.readText()).toContain('more')
```

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
