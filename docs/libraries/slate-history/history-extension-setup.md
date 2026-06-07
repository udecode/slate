# History Extension Setup

Install history with the `history()` extension.

```typescript
import { createEditor } from 'slate'
import { history } from 'slate-history'

const editor = createEditor({
  extensions: [history()],
  initialValue: [{ type: 'paragraph', children: [{ text: '' }] }],
})
```

`createReactEditor` installs history by default. Disable it explicitly when a
React editor should not expose history state or transaction helpers.

```typescript
import { history } from 'slate-history'
import { createReactEditor } from 'slate-react'

const editor = createReactEditor({
  extensions: [history({ enabled: false })],
  initialValue,
})
```

Read history through `state.history`, write through `tx.history`, and control
batching through `editor.api.history`.

```typescript
const undoCount = editor.read((state) => state.history.undos().length)

editor.update((tx) => {
  tx.history.undo()
})

editor.api.history.withoutSaving(() => {
  editor.update((tx) => {
    tx.text.insert('draft')
  })
})
```

See [History Editor API](./history-editor.md) for the full API surface.
