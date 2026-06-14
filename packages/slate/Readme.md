# slate

Core Slate editor runtime.

`slate` owns the document model, operations, paths, points, ranges, transforms,
transactions, state fields, schema extension runtime, and pure node/location
helper namespaces.

## Editor Lifecycle

```ts
import { createEditor } from 'slate'

const editor = createEditor({
  initialValue: [{ type: 'paragraph', children: [{ text: '' }] }],
})

const value = editor.read((state) => state.value.get())

editor.update((tx) => {
  tx.text.insert('Hello')
})
```

Use `editor.read(...)` for coherent state reads. Use `editor.update(...)` for
document, selection, mark, root, state-field, and operation changes.

## Extension Authoring

```ts
import { defineEditorExtension, elementProperty } from 'slate'
```

Extensions register schema facts, state groups, transaction groups,
normalizers, operation middleware, commit listeners, and runtime APIs without
mutating random fields onto the editor object.

## Helper Namespaces

Pure data helpers live on `ElementApi`, `LocationApi`, `NodeApi`,
`OperationApi`, `PathApi`, `PathRefApi`, `PointApi`, `PointRefApi`, `RangeApi`,
`RangeRefApi`, `SpanApi`, and `TextApi`.
