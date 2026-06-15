# slate-history

Undo/redo history extension for Slate editors.

```ts
import { createEditor } from 'slate'
import { History, history } from 'slate-history'

const editor = createEditor({
  extensions: [history()],
  initialValue: [{ type: 'paragraph', children: [{ text: '' }] }],
})

editor.update((tx) => {
  tx.history.undo()
})

const stacks = editor.read((state) => state.history.get())
History.isHistory(stacks)
```

Read stacks through `state.history`, write through `tx.history`, and control
batching through `editor.api.history`.

`History.isHistory(value)` validates undo/redo stack objects.

`useSlateEditor` installs history by default for Slate React editors.
