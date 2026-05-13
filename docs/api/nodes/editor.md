# Editor

An editor owns the document runtime. It is the root node of the document, and
its path is `[]`.

The public editor object is intentionally small:

```typescript
interface Editor {
  read<T>(fn: (state: EditorState) => T): T
  update(fn: (tx: EditorTransaction) => void, options?: EditorUpdateOptions): void
  subscribe(listener: EditorListener): () => void
  extend(extension: EditorExtension | EditorExtension[]): () => void
}
```

- [Creating an editor](editor.md#creating-an-editor)
- [Reading state](editor.md#reading-state)
- [Updating state](editor.md#updating-state)
- [Schema behavior](editor.md#schema-behavior)
- [Subscribing to commits](editor.md#subscribing-to-commits)
- [Extending the editor](editor.md#extending-the-editor)
- [Pure node and location helpers](editor.md#pure-node-and-location-helpers)

## Creating an editor

#### `createEditor(options?) => Editor`

Create an editor.

```javascript
const editor = createEditor({
  extensions: [paragraph(), history()],
})
```

Extensions define schema, normalizers, commit listeners, operation middleware,
feature namespaces, and optional runtime registration.

## Reading state

#### `editor.read(fn) => T`

Read a coherent snapshot of editor state.

```javascript
const selection = editor.read(state => state.selection.get())
```

Use `state` for editor-state queries:

```javascript
editor.read(state => {
  const children = state.children.get()
  const marks = state.marks.get()
  const first = state.nodes.get([0])
  const start = state.points.start([])
  const range = state.ranges.get([])

  return { children, first, marks, range, start }
})
```

Schema policy is read through `state.schema`:

```javascript
const isInline = editor.read(state => state.schema.isInline(element))
```

## Updating state

#### `editor.update(fn, options?) => void`

Run a transaction. The callback receives `tx`, which owns command reads and
writes.

```javascript
editor.update(tx => {
  tx.marks.toggle('bold')
})
```

Use transaction groups for document changes:

```javascript
editor.update(tx => {
  tx.nodes.set({ type: 'heading' })
  tx.text.insert('Title')
  tx.selection.move({ distance: 1 })
})
```

Replay operations through the transaction boundary:

```javascript
editor.update(
  tx => {
    tx.operations.replay(remoteOperations)
  },
  {
    tag: ['collaboration', 'remote-import'],
    metadata: {
      collab: { origin: 'remote', saveToHistory: false },
      history: { mode: 'skip' },
      selection: { dom: 'preserve' },
    },
  }
)
```

`tag` is the cheap lifecycle label. `metadata` is the typed policy channel for
history, collaboration, and model/DOM selection behavior.

## Schema behavior

Schema setup belongs to extensions. Read schema policy through `state.schema`
or `tx.schema`.

```javascript
import { defineEditorExtension, elementProperty } from 'slate'

const tables = defineEditorExtension({
  name: 'tables',
  elements: [
    {
      type: 'table-cell',
      isolating: true,
      keyboardSelectable: true,
      properties: {
        colSpan: elementProperty.number({ default: 1 }),
        rowSpan: elementProperty.number({ default: 1 }),
      },
    },
  ],
})

editor.extend(tables)

editor.read(state => state.schema.isVoid(element))

editor.update(tx => {
  if (tx.schema.isInline(element)) {
    tx.selection.move({ unit: 'character' })
  }
})
```

Common schema checks include:

- `state.schema.getElementBehavior(element)`
- `state.schema.getElementProperty(element, property)`
- `state.schema.getElementPropertyDescriptor(type, property)`
- `state.schema.isAtom(element)`
- `state.schema.isEditableIsland(element)`
- `state.schema.isInline(element)`
- `state.schema.isIsolating(element)`
- `state.schema.isKeyboardSelectable(element)`
- `state.schema.isReadOnly(element)`
- `state.schema.isVoid(element)`
- `state.schema.markableVoid(element)`
- `state.schema.isSelectable(element)`
- `state.schema.isElementPropertyEqual(type, property, left, right)`

Element property descriptors provide defaults and equality for extension-owned
element fields. Reading a default does not write that property into the
document. The Slate value remains plain JSON until your transaction writes a
field.

## Subscribing to commits

#### `editor.subscribe(listener) => () => void`

Subscribe to committed editor changes. The listener receives the current
snapshot and commit metadata.

```javascript
const unsubscribe = editor.subscribe((snapshot, commit) => {
  if (commit.childrenChanged) {
    save(snapshot.children)
  }
})
```

Call the returned function to unsubscribe.

## Extending the editor

#### `editor.extend(extension) => () => void`

Install an extension and return a cleanup function.

```javascript
const removeExtension = editor.extend(myExtension)
```

Extensions add typed `state` and `tx` namespaces. They should not add methods to
the editor object.

```javascript
editor.update(tx => {
  tx.links.toggle({ href })
})
```

## Pure node and location helpers

Pure helpers stay on their own namespaces because they do not read editor
runtime state.

```javascript
NodeApi.string(node)
ElementApi.isElement(value)
TextApi.isText(value)
PathApi.next(path)
PointApi.equals(point, other)
RangeApi.isCollapsed(range)
OperationApi.isOperation(value)
```

Use `editor.read(...)` or `editor.update(...)` when a helper needs editor
state.
