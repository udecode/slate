# Editor

An editor owns the document runtime. It is the root node of the document, and
its path is `[]`.

The public editor object is intentionally small:

```typescript
interface Editor<TExtensions extends readonly unknown[] = []> {
  api: Readonly<InstalledApiGroups<TExtensions>>
  getApi(extension: EditorExtension): unknown
  read<T>(fn: (state: EditorState) => T): T
  subscribe(listener: EditorListener): () => void
  subscribeCommit(listener: EditorCommitListener): () => void
  update(
    fn: (tx: EditorTransaction, context: EditorUpdateContext) => void,
    options?: EditorUpdateOptions
  ): void
  extend(extension: EditorExtension | EditorExtension[]): () => void
}
```

- [Creating an editor](editor.md#creating-an-editor)
- [Reading state](editor.md#reading-state)
- [Updating state](editor.md#updating-state)
- [Document roots](editor.md#document-roots)
- [Document state](editor.md#document-state)
- [Schema behavior](editor.md#schema-behavior)
- [Runtime APIs](editor.md#runtime-apis)
- [Subscribing to commits](editor.md#subscribing-to-commits)
- [Extending the editor](editor.md#extending-the-editor)
- [Pure node and location helpers](editor.md#pure-node-and-location-helpers)

## Creating an editor

#### `createEditor(options?) => Editor`

Create an editor.

```javascript
const editor = createEditor({
  initialValue: [{ type: 'paragraph', children: [{ text: 'Body' }] }],
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
  const children = state.nodes.children()
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

The update callback also receives a context object for local post-commit hooks:

```javascript
editor.update((tx, { afterCommit }) => {
  tx.text.insert('Saved')

  afterCommit((change) => {
    analytics.track('editor-change', change.source)
  })
})
```

## Document roots

The default document root is `main`. A plain block array initializes `main`.
Pass `initialValue.roots` when one editor owns multiple roots.

```javascript
const editor = createEditor({
  initialValue: {
    roots: {
      header: [{ type: 'paragraph', children: [{ text: 'Draft' }] }],
      main: [{ type: 'paragraph', children: [{ text: 'Body' }] }],
      footer: [{ type: 'paragraph', children: [{ text: 'Internal' }] }],
    },
  },
})
```

Read roots from `state.value.get().roots`.

```javascript
const footer = editor.read((state) => state.value.get().roots.footer)
```

Create, replace, or delete non-main roots with `tx.roots`.

```javascript
editor.update((tx) => {
  tx.roots.create('aside:1', [
    { type: 'paragraph', children: [{ text: 'Aside' }] },
  ])
})
```

Use normal node and text transforms for the `main` root. See
[Roots](../../concepts/13-roots.md) for React rendering, root chrome, and
content roots.

## Document state

`state.value.get()` returns the persisted document value.

```ts
type EditorDocumentValue = {
  roots: Record<string, Descendant[]>
  state?: Record<string, unknown>
}
```

Use it for database persistence because it includes named roots and persistent
state fields.

```javascript
const documentValue = editor.read((state) => state.value.get())
```

State fields are registered with `defineStateField` and read through
`state.getField(field)`.

```javascript
const title = editor.read((state) => state.getField(documentTitle))
```

Write state fields with `tx.setField`.

```javascript
editor.update((tx) => {
  tx.setField(documentTitle, 'Q3 Launch Brief')
})
```

State-field writes appear in `commit.statePatches` and
`commit.dirtyStateKeys`. Collaboration adapters should export only shared
state-patch keys. Replay remote state patches with `tx.statePatches.replay(...)`.

```javascript
editor.update(
  (tx) => {
    tx.statePatches.replay(remoteStatePatches)
  },
  {
    metadata: {
      collab: { origin: 'remote', saveToHistory: false },
      history: { mode: 'skip' },
      selection: { dom: 'preserve' },
    },
    tag: ['collaboration', 'remote-state'],
  }
)
```

See [Document State](../../concepts/14-document-state.md) for persistence
patterns and comments ownership.

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

## Runtime APIs

Extensions expose mounted host handles through `editor.api`.

```javascript
editor.api.dom.focus()
editor.api.clipboard.insertTextData(dataTransfer)
editor.api.history.withoutSaving(() => {
  editor.update((tx) => {
    tx.text.insert('Imported')
  })
})
```

Use `editor.getApi(extension)` when the call site owns the extension token and
needs the typed API for that extension.

## Subscribing to commits

#### `editor.subscribe(listener) => () => void`

Subscribe to editor snapshots. The listener receives the current snapshot and an
optional change summary.

```javascript
const unsubscribe = editor.subscribe((_snapshot, change) => {
  if (change?.childrenChanged || change?.dirtyStateKeys.length) {
    const documentValue = editor.read((state) => state.value.get())

    save(documentValue)
  }
})
```

#### `editor.subscribeCommit(listener) => () => void`

Subscribe only to committed changes. The listener receives the change summary
for each commit.

```javascript
const unsubscribe = editor.subscribeCommit((change) => {
  if (change.selectionChanged) {
    syncSelection(change.selection)
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
