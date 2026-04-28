# Editor Methods

Slate changes the document through editor methods inside `editor.update(...)`.
The editor records operations and publishes one commit when the update exits.

```javascript
editor.update(() => {
  editor.unwrapNodes({
    at: [],
    match: node =>
      !Editor.isEditor(node) &&
      node.children?.every(child => Editor.isBlock(editor, child)),
    mode: 'all',
  })
})
```

Use the flexible primitive methods for custom structures:

- `editor.insertNodes(...)`
- `editor.removeNodes(...)`
- `editor.mergeNodes(...)`
- `editor.splitNodes(...)`
- `editor.wrapNodes(...)`
- `editor.unwrapNodes(...)`
- `editor.setNodes(...)`
- `editor.unsetNodes(...)`
- `editor.liftNodes(...)`
- `editor.moveNodes(...)`
- `editor.insertText(...)`
- `editor.delete(...)`
- `editor.select(...)`
- `editor.move(...)`

## Selection

Use `editor.select(...)`, `editor.deselect(...)`, `editor.collapse(...)`, and
`editor.move(...)` to update selection.

```javascript
editor.update(() => {
  editor.select({
    anchor: { path: [0, 0], offset: 0 },
    focus: { path: [1, 0], offset: 2 },
  })
})
```

Move the cursor backward by three words:

```javascript
editor.update(() => {
  editor.move({
    distance: 3,
    unit: 'word',
    reverse: true,
  })
})
```

Read selection with `editor.getSelection()` or `Editor.getSelection(editor)`.
Do not write the selection mirror directly.

## Text

Insert text at the current transaction target:

```javascript
editor.update(() => {
  editor.insertText('some words')
})
```

Insert text at an explicit point:

```javascript
editor.update(() => {
  editor.insertText('some words', {
    at: { path: [0, 0], offset: 3 },
  })
})
```

Delete a range:

```javascript
editor.update(() => {
  editor.delete({
    at: {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [1, 0], offset: 2 },
    },
  })
})
```

## Nodes

Insert a node at an explicit path:

```javascript
editor.update(() => {
  editor.insertNodes(
    {
      text: 'A new string of text.',
    },
    {
      at: [0, 1],
    }
  )
})
```

Move a node:

```javascript
editor.update(() => {
  editor.moveNodes({
    at: [0, 0],
    to: [0, 1],
  })
})
```

## The `at` Option

When `at` is omitted, selection-sensitive methods use the transaction target.
When `at` is provided, Slate uses that exact location and does not import or
refresh browser selection.

```javascript
editor.update(() => {
  editor.insertText('some words')
})

editor.update(() => {
  editor.insertText('some words', {
    at: { path: [0, 0], offset: 3 },
  })
})
```

`at` can be a `Path`, `Point`, or `Range`.

```javascript
editor.update(() => {
  editor.insertText('some words', {
    at: {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 3 },
    },
  })
})
```

## The `match` Option

Node methods accept a `match` function to restrict which nodes are changed.

```javascript
editor.update(() => {
  editor.moveNodes({
    at: [2],
    match: (node, path) => path.length === 2,
    to: [5],
  })
})
```

Add a bold mark to text nodes that are not italic:

```javascript
editor.update(() => {
  editor.setNodes(
    { bold: true },
    {
      at: [],
      match: node => Text.isText(node) && node.italic !== true,
    }
  )
})
```

The `match` function can examine `node.children`, or use `Node.parent` to
inspect surrounding structure.

## Normalization

Wrap multiple structural writes in one `editor.update(...)`. Use
`Editor.withoutNormalizing(editor, fn)` when the tree should not normalize
between method calls.

```javascript
editor.update(() => {
  Editor.withoutNormalizing(editor, () => {
    editor.unwrapNodes({ match: isList })
    editor.setNodes({ type: 'list-item' })
    editor.wrapNodes({ type: 'bulleted-list', children: [] })
  })
})
```

If you already have operations, apply them through the explicit operation
writer:

```javascript
editor.applyOperations(operations)
```
