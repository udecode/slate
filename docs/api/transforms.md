# Transforms API

Transforms are transaction helpers used inside `editor.update(...)`.

```javascript
editor.update(tx => {
  tx.text.insert('Hello')
})
```

- [Node options](transforms.md#node-options)
- [Node methods](transforms.md#node-methods)
- [Fragment methods](transforms.md#fragment-methods)
- [Text methods](transforms.md#text-methods)
- [Selection methods](transforms.md#selection-methods)
- [Mark methods](transforms.md#mark-methods)
- [Operation methods](transforms.md#operation-methods)

## Node options

Many node methods accept an `options` object.

```typescript
interface NodeOptions {
  at?: Location
  match?: (node: Node, path: Path) => boolean
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

Use node methods from `tx.nodes`.

#### `tx.nodes.insert(nodes: Node | Node[], options?)`

Insert nodes at `options.at` or the transaction target.

```javascript
editor.update(tx => {
  tx.nodes.insert(
    { type: targetType, children: [{ text: '' }] },
    { at: [0] }
  )
})
```

#### `tx.nodes.remove(options?)`

Remove nodes at `options.at` or the transaction target.

#### `tx.nodes.merge(options?)`

Merge a node with the previous node at the same depth.

#### `tx.nodes.split(options?)`

Split nodes at a location.

#### `tx.nodes.wrap(element: Element, options?)`

Wrap matching nodes in `element`.

#### `tx.nodes.unwrap(options?)`

Unwrap matching nodes.

#### `tx.nodes.set(props: Partial<Node>, options?)`

Set properties on matching nodes.

#### `tx.nodes.unset(props: string | string[], options?)`

Unset properties on matching nodes.

#### `tx.nodes.lift(options?)`

Lift matching nodes upward in the document tree.

#### `tx.nodes.move(options)`

Move nodes from `options.at` to `options.to`.

## Fragment methods

Use fragment methods from `tx.fragment`.

#### `tx.fragment.get(options?)`

Read the fragment at `options.at` or the current selection.

#### `tx.fragment.insert(fragment: Node[], options?)`

Insert a fragment at `options.at` or the transaction target.

#### `tx.fragment.delete(options?)`

Delete the fragment at `options.at` or the transaction target.

## Text methods

#### `tx.text.insert(text: string, options?)`

Insert text at `options.at` or the transaction target.

#### `tx.text.delete(options?)`

Delete text at `options.at` or the transaction target.

## Selection methods

#### `tx.selection.set(target: Location | null)`

Set the selection to a new target.

```javascript
editor.update(tx => {
  tx.selection.set({
    anchor: { path: [0, 0], offset: 0 },
    focus: { path: [1, 0], offset: 0 },
  })
})
```

#### `tx.selection.clear()`

Clear the selection.

#### `tx.selection.collapse(options?)`

Collapse the selection to a single point.

#### `tx.selection.move(options?)`

Move the selection by offset, character, word, line, or block.

#### `tx.selection.setPoint(props: Partial<Point>, options?)`

Set properties on one selection point.

#### `tx.selection.setRange(props: Partial<Range>)`

Set properties on an active selection.

## Mark methods

#### `tx.marks.get()`

Return the active marks for the transaction.

#### `tx.marks.add(key: string, value: unknown)`

Add a mark to the current selection or pending marks.

#### `tx.marks.remove(key: string)`

Remove a mark from the current selection or pending marks.

#### `tx.marks.toggle(key: string, value?)`

Toggle a mark for the current selection or pending marks.

## Operation methods

#### `tx.operations.replay(operations: Operation[], options?)`

Replay operations through the transaction boundary.

```javascript
editor.update(tx => {
  tx.operations.replay(remoteOperations, {
    tag: 'remote-import',
  })
})
```
