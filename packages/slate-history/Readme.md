# slate-history

Undo/redo history extension for Slate editors.

```ts
import { createEditor } from 'slate'
import { history } from 'slate-history'

const editor = createEditor({
  extensions: [history()],
  initialValue: [{ type: 'paragraph', children: [{ text: '' }] }],
})

editor.update((tx) => {
  tx.history.undo()
})
```

Read stacks through `state.history`, write through `tx.history`, and control
batching through `editor.api.history`.

`createReactEditor` installs history by default.
