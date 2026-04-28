# Slate Component

## `Slate(props: SlateProps): React.JSX.Element`

The `Slate` component must include somewhere in its `children` the `Editable` component.

### Props

```typescript
type SlateProps = {
  editor: ReactEditor
  initialValue?: Descendant[]
  children: React.ReactNode
  onSelectionChange?: (selection: Selection) => void
  onSnapshotChange?: (snapshot: EditorSnapshot, commit: EditorCommit | null) => void
  onValueChange?: (value: Descendant[]) => void
}
```

#### `props.editor: ReactEditor`

An instance of `ReactEditor`

#### `props.initialValue?: Descendant[]`

The initial value of the editor.

#### `props.children: React.ReactNode`

The `children` which must contain an `Editable` component.

#### `props.onValueChange?: (value: Descendant[]) => void`

A callback that runs after committed document-value changes.

#### `props.onSelectionChange?: (selection: Selection) => void`

A callback that runs after committed selection changes.

#### `props.onSnapshotChange?: (snapshot: EditorSnapshot, commit: EditorCommit | null) => void`

A callback that runs after every committed editor snapshot. Use this when a React integration needs both document and selection updates from the adapter layer.
