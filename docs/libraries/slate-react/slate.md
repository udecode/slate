# Slate Component

`Slate` provides a React context for one editor. Render it above `Editable`, toolbars, sidebars, and any component that needs editor state.

```tsx
<Slate editor={editor} initialValue={initialValue} onChange={handleChange}>
  <Toolbar />
  <Editable />
</Slate>
```

## Props

```typescript
type SlateProps = {
  annotationStores?: readonly SlateAnnotationStore[] | null
  children: React.ReactNode
  decorationSources?: readonly SlateDecorationSource[] | null
  editor: ReactEditor
  initialValue?: Descendant[]
  onChange?: (value: Descendant[], change: SlateChange) => void
}

type SlateChange = {
  commit: EditorCommit
  marksChanged: boolean
  operations: readonly Operation[]
  selection: Range | null
  selectionChanged: boolean
  snapshot: EditorSnapshot
  tags: readonly string[]
  value: Descendant[]
  valueChanged: boolean
}
```

### `editor`

Pass the editor created with `withReact(createEditor())`.

```tsx
const [editor] = useState(() => withReact(createEditor<CustomValue>()))
```

### `initialValue`

Pass the document used to seed the editor when the provider mounts.

```tsx
<Slate editor={editor} initialValue={initialValue}>
  <Editable />
</Slate>
```

Use editor APIs for later document replacement. `initialValue` is not a controlled value prop.

### `children`

Render `Editable` and any editor UI inside the provider.

```tsx
<Slate editor={editor} initialValue={initialValue}>
  <Toolbar />
  <Editable />
</Slate>
```

### `onChange`

Use `onChange` when you need to hear about every committed editor change. It fires for document changes, selection changes, marks changes, and operation replay.

```tsx
<Slate
  editor={editor}
  initialValue={initialValue}
  onChange={(value, change) => {
    if (change.selectionChanged) {
      updateToolbar(change.selection)
    }

    if (change.valueChanged) {
      localStorage.setItem('content', JSON.stringify(value))
    }
  }}
>
  <Editable />
</Slate>
```

Use `editor.subscribe(...)` for low-level commit subscribers that do not belong in React render props.

### Saving Value Changes

Use `onChange` and `change.valueChanged` when you only need committed document-value changes.

```tsx
<Slate
  editor={editor}
  initialValue={initialValue}
  onChange={(value, change) => {
    if (!change.valueChanged) return

    localStorage.setItem('content', JSON.stringify(value))
  }}
>
  <Editable />
</Slate>
```

### Selection Changes

Use `onChange` and `change.selectionChanged` for UI that follows the model selection.

```tsx
<Slate
  editor={editor}
  initialValue={initialValue}
  onChange={(_, change) => {
    if (!change.selectionChanged) return

    updateToolbar(change.selection)
  }}
>
  <Editable />
</Slate>
```

### `decorationSources`

Decoration sources publish transient render-time ranges such as search matches, diagnostics, and code highlights.

```tsx
const searchSource = useMemo(
  () =>
    createDecorationSource(editor, {
      id: 'search',
      read: ({ snapshot }) => findSearchMatches(snapshot, query),
    }),
  [editor, query]
)

<Slate decorationSources={[searchSource]} editor={editor}>
  <Editable renderSegment={renderSearchMatch} />
</Slate>
```

Prefer provider-owned `decorationSources` so every `Editable` and overlay UI reads from the same projection source.

### `annotationStores`

Annotation stores publish anchor-backed annotations to text rendering and annotation UI hooks.

```tsx
const annotations = comments.map((comment) => ({
  anchor: comment.anchor,
  data: comment,
  id: comment.id,
  projection: {
    status: comment.status,
    tone: comment.tone,
  },
}))

const annotationStore = useSlateAnnotationStore(editor, annotations)

<Slate annotationStores={[annotationStore]} editor={editor}>
  <Editable renderSegment={renderCommentSegment} />
  <CommentsSidebar store={annotationStore} />
</Slate>
```
