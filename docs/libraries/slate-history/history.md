# History

The `history()` extension tracks undo and redo batches for an editor.

```typescript
import { createEditor } from 'slate'
import { history } from 'slate-history'

const editor = createEditor({
  extensions: [history()],
})

editor.read((state) => state.history.undos())

editor.update((tx) => {
  tx.history.undo()
})

editor.api.history.withoutSaving(() => {
  editor.update((tx) => {
    tx.text.insert('draft')
  })
})
```

## History Object

```typescript
export interface History {
  redos: Batch[]
  undos: Batch[]
}

interface Batch {
  operations: Operation[]
  selectionBefore: Range | null
}
```

## Static Methods

#### `History.isHistory(value: any): value is History`

Returns `true` if the passed in `value` is a `History` object and acts as a
type guard.

## Editor API

#### `state.history.get(): History`

Read the current undo and redo stacks.

#### `state.history.undos(): Batch[]`

Read the undo stack.

#### `state.history.redos(): Batch[]`

Read the redo stack.

#### `tx.history.undo(): void`

Undo the previous history batch.

#### `tx.history.redo(): void`

Redo the next history batch.

#### `editor.api.history.withMerging(fn: () => void): void`

Run updates that merge into the previous history batch.

#### `editor.api.history.withNewBatch(fn: () => void): void`

Run updates where the first operation starts a new history batch.

#### `editor.api.history.withoutMerging(fn: () => void): void`

Run updates without merging the new operations into the previous batch.

#### `editor.api.history.withoutSaving(fn: () => void): void`

Run updates without saving operations to history.

#### `editor.api.history.isMerging(): boolean | undefined`

Read the current merge flag.

#### `editor.api.history.isSaving(): boolean | undefined`

Read the current saving flag.
