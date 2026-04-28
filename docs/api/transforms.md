# Editor Method API

Slate writes go through `editor.update(...)` and editor methods.

This page lists the flexible primitive method families. They are the public way
to express custom document changes without inventing a new method for every
node type.

- [Node options](transforms.md#node-options)
- [Node methods](transforms.md#node-methods)
- [Selection methods](transforms.md#selection-methods)
- [Text methods](transforms.md#text-methods)
- [Operation methods](transforms.md#operation-methods)

## Node options

Many node methods accept an `options` object.

```typescript
interface NodeOptions {
  at?: Location
  match?: (node: Node, path: Location) => boolean
  mode?: 'highest' | 'lowest'
  voids?: boolean
}
```

- `at?: Location`: The explicit location to change. When omitted inside
  `editor.update(...)`, selection-sensitive methods use the transaction target.
- `match?: (node, path) => boolean`: Filters which nodes are changed.
- `mode?: 'highest' | 'lowest'`: Controls which matching node level is used.
- `voids?: boolean`: Includes void elements when `true`.

## Node methods

Use node methods inside `editor.update(...)`.

#### `editor.insertFragment(fragment: Node[], options?)`

Insert a fragment at `options.at` or the transaction target.

#### `editor.insertNodes(nodes: Node | Node[], options?)`

Insert nodes at `options.at` or the transaction target.

```javascript
editor.update(() => {
  editor.insertNodes(
    { type: targetType, children: [{ text: '' }] },
    { at: [editor.getChildren().length] }
  )
})
```

#### `editor.removeNodes(options?)`

Remove nodes at `options.at` or the transaction target.

#### `editor.mergeNodes(options?)`

Merge a node with the previous node at the same depth.

#### `editor.splitNodes(options?)`

Split nodes at a location.

#### `editor.wrapNodes(element: Element, options?)`

Wrap matching nodes in `element`.

#### `editor.unwrapNodes(options?)`

Unwrap matching nodes.

#### `editor.setNodes(props: Partial<Node>, options?)`

Set properties on matching nodes.

#### `editor.unsetNodes(props: string | string[], options?)`

Unset properties on matching nodes.

#### `editor.liftNodes(options?)`

Lift matching nodes upward in the document tree.

#### `editor.moveNodes(options)`

Move nodes from `options.at` to `options.to`.

## Selection methods

#### `editor.collapse(options?)`

Collapse the selection to a single point.

#### `editor.select(target: Location)`

Set the selection to a new target.

```javascript
editor.update(() => {
  editor.select({
    anchor: Editor.start(editor, []),
    focus: Editor.end(editor, []),
  })
})
```

#### `editor.deselect()`

Unset the selection.

#### `editor.move(options?)`

Move the selection by offset, character, word, line, or block.

#### `editor.setPoint(props: Partial<Point>, options?)`

Set properties on one selection point.

#### `editor.setSelection(props: Partial<Range>)`

Set properties on an active selection.

## Text methods

#### `editor.delete(options?)`

Delete text at `options.at` or the transaction target.

#### `editor.insertText(text: string, options?)`

Insert text at `options.at` or the transaction target.

## Operation methods

#### `editor.applyOperations(operations: Operation[], options?)`

Replay operations through one explicit editor write boundary. This is for
operation replay, history, collaboration, and test fixtures. Prefer
`editor.update(...)` with editor methods for normal document changes.
