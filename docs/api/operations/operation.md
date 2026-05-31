# Operation API

`Operation` objects define the low-level instructions that Slate editors use to apply changes to their internal state. Representing all changes as operations is what allows Slate editors to easily implement history, collaboration, and other features.

Node, text, selection, fragment, and `replace_children` operations may include
`root`. When `root` is omitted, Slate resolves the operation against the
active operation/view root, then falls back to `main` for the base editor.
Serialized non-main operations should preserve `root`.

Root lifecycle updates from `tx.roots.create`, `tx.roots.replace`, and
`tx.roots.delete` are represented as `replace_children` operations at `path:
[]`. Those operations carry `root`, `rootWasPresent`, and `rootIsPresent` so
history and collaboration replay can create, replace, or delete the named root
instead of applying the change to `main`.

- [Static methods](operation.md#static-methods)
  - [Manipulation methods](operation.md#manipulation-methods)
  - [Check methods](operation.md#check-methods)

## Static methods

### Manipulation methods

#### `OperationApi.inverse(op: Operation) => Operation`

Invert an operation, returning a new operation that will exactly undo the original when applied.

### Check methods

#### `OperationApi.isNodeOperation(value: any) => boolean`

Check if a value is a `NodeOperation` object. Returns the value as a `NodeOperation` if it is one.

#### `OperationApi.isOperation(value: any) => boolean`

Check if a value is an `Operation` object. Returns the value as an `Operation` if it is one.

#### `OperationApi.isOperationList(value: any) => boolean`

Check if a value is a list of `Operation` objects. Returns the value as an `Operation[]` if it is one.

#### `OperationApi.isSelectionOperation(value: any) => boolean`

Check if a value is a `SelectionOperation` object. Returns the value as a `SelectionOperation` if it is one.

#### `OperationApi.isTextOperation(value: any) => boolean`

Check if a value is a `TextOperation` object. Returns the value as a `TextOperation` if it is one.
