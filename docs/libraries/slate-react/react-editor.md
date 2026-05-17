# React Editor

`createReactEditor` creates an editor with React, DOM, and clipboard host
capabilities installed. Hooks such as `useSlateEditor` create the same editor
shape.

```typescript
import { createReactEditor } from 'slate-react'

const editor = createReactEditor()

editor.api.dom.focus()
```

- [Checks](react-editor.md#checks)
- [Focus And Selection](react-editor.md#focus-and-selection)
- [DOM Translation](react-editor.md#dom-translation)
- [DataTransfer](react-editor.md#datatransfer)

## Checks

#### `editor.api.react.isComposing(): boolean`

Check if the user is currently composing inside the editor.

#### `editor.api.react.isFocused(): boolean`

Check if the editor is focused.

#### `editor.api.react.isReadOnly(): boolean`

Check if the editor is in read-only mode.

## Focus And Selection

#### `editor.api.dom.blur(): void`

Blur the editor.

#### `editor.api.dom.focus(options?: { retries: number }): void`

Focus the editor.

#### `editor.api.dom.deselect(): void`

Clear the native DOM selection and the Slate selection.

## DOM Translation

#### `editor.api.dom.findKey(node: Node): Key`

Find a key for a Slate node.

#### `editor.api.dom.findPath(node: Node): Path`

Find the path of a Slate node.

#### `editor.api.dom.hasDOMNode(target: DOMNode, options?: { editable?: boolean }): boolean`

Check if a DOM node is within the editor.

#### `editor.api.dom.hasEditableTarget(target: EventTarget | null): target is DOMNode`

Check if the target is editable and in the editor.

#### `editor.api.dom.hasSelectableTarget(target: EventTarget | null): boolean`

Check if the target can be selected by the editor.

#### `editor.api.dom.hasTarget(target: EventTarget | null): target is DOMNode`

Check if the target is in the editor.

#### `editor.api.dom.toDOMNode(node: Node): HTMLElement`

Find the native DOM element for a Slate node.

#### `editor.api.dom.toDOMPoint(point: Point): DOMPoint`

Find a native DOM selection point from a Slate point.

#### `editor.api.dom.toDOMRange(range: Range): DOMRange`

Find a native DOM range from a Slate range.

#### `editor.api.dom.toSlateNode(domNode: DOMNode): Node`

Find a Slate node from a native DOM node.

#### `editor.api.dom.findEventRange(event: unknown): Range`

Get the target range from a DOM event.

#### `editor.api.dom.toSlatePoint(domPoint: DOMPoint, options: { exactMatch: boolean; searchDirection?: 'backward' | 'forward' }): Point`

Find a Slate point from a DOM point.

#### `editor.api.dom.resolveSlatePoint(domPoint: DOMPoint, options: { exactMatch: boolean; searchDirection?: 'backward' | 'forward' }): Point | null`

Resolve a Slate point from a DOM point. Returns `null` when the DOM point is not
currently mappable.

#### `editor.api.dom.toSlateRange(domRange: DOMRange | DOMStaticRange | DOMSelection, options: { exactMatch: boolean }): Range`

Find a Slate range from a DOM range or selection.

#### `editor.api.dom.resolveSlateRange(domRange: DOMRange | DOMStaticRange | DOMSelection, options: { exactMatch: boolean }): Range | null`

Resolve a Slate range from a DOM range or selection. Returns `null` when the DOM
range is not currently mappable.

## DataTransfer

#### `editor.api.clipboard.insertData(data: DataTransfer): void`

Insert data from a `DataTransfer` into the editor.

Slate runs `clipboard.insertData` capability handlers first. A handler that
returns `true` stops the default import path. When no handler claims the data,
Slate tries an internal Slate fragment for the editor's configured
`clipboardFormatKey`, then plain text.

#### `editor.api.clipboard.insertFragmentData(data: DataTransfer): boolean`

Insert Slate fragment data from a `DataTransfer`. Returns `true` when fragment
content was inserted.

#### `editor.api.clipboard.insertTextData(data: DataTransfer): boolean`

Insert plain text data from a `DataTransfer`. Returns `true` when text content
was inserted.

#### `editor.api.clipboard.writeSelection(data: Pick<DataTransfer, 'getData' | 'setData'>): void`

Write the current selection to a `DataTransfer`.

Slate writes plain text, HTML, and an internal Slate fragment payload. The
fragment payload uses `application/${clipboardFormatKey}` and the HTML fallback
is tagged with the same key, so differently configured editors do not blindly
import each other's internal JSON.
