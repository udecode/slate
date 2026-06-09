# Slate Component

`Slate` provides a React context for one editor. Render it above `Editable`,
toolbars, sidebars, and any component that needs editor state.

```tsx
<Slate editor={editor} onChange={handleChange}>
  <Toolbar />
  <Editable />
</Slate>
```

## Props

```typescript
type SlateBaseProps = {
  annotationStore?: SlateAnnotationStore | null
  children: React.ReactNode
  decorationSources?: readonly SlateDecorationSource[] | null
  onChange?: (value: Descendant[], change: SlateChange) => void
  readOnly?: boolean
}

type SlateProps =
  | (SlateBaseProps & { editor: ReactEditor; root?: never })
  | (SlateBaseProps & { editor?: never; root: string })

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

Pass `editor` for the top-level provider. Use the `root`-only form only inside
an existing Slate runtime, when a nested provider should bind its callbacks and
context to another root.

### `editor`

Pass the editor created with `createReactEditor` or `useSlateEditor`.

```tsx
const [editor] = useState(() =>
  createReactEditor<CustomValue>({ initialValue })
)
```

### `initialValue`

Pass the document used to seed the editor when the provider mounts.

```tsx
<Slate editor={editor}>
  <Editable />
</Slate>
```

Use editor APIs for later document replacement. `initialValue` is not a controlled value prop.

### `children`

Render `Editable` and any editor UI inside the provider.

```tsx
<Slate editor={editor}>
  <Toolbar />
  <Editable />
</Slate>
```

### `onChange`

Use `onChange` when React UI needs current-root value, selection, or marks
changes. Use `editor.subscribe(...)` for state-field changes, operation replay,
and persistence services.

```tsx
<Slate
  editor={editor}
  onChange={(value, change) => {
    if (change.selectionChanged) {
      updateToolbar(change.selection)
    }

    if (change.valueChanged) {
      updateCurrentRootPreview(value)
    }
  }}
>
  <Editable />
</Slate>
```

Use `editor.subscribe(...)` for low-level commit subscribers that do not belong in React render props.

### Saving Provider Root Changes

Use `onChange` and `change.valueChanged` when you only need committed changes
for the provider root's block array. For `<Slate editor={editor}>`, that is
`main`. This is the single-root shortcut, not the full document persistence
path.

```tsx
<Slate
  editor={editor}
  onChange={(value, change) => {
    if (!change.valueChanged) return

    localStorage.setItem('slate.children', JSON.stringify(value))
  }}
>
  <Editable />
</Slate>
```

The `value` argument is a root value, not the full persisted document. Use
`editor.subscribe(...)` and `editor.read((state) => state.value.get())` when
you need named roots or persistent state fields.

```tsx
useEffect(() => {
  return editor.subscribe((_snapshot, commit) => {
    if (!commit) return

    if (!commit.childrenChanged && commit.dirtyStateKeys.length === 0) {
      return
    }

    const documentValue = editor.read((state) => state.value.get())

    localStorage.setItem('slate.document', JSON.stringify(documentValue))
  })
}, [editor])
```

See [Document State](../../concepts/14-document-state.md) for the full
persistence shape.

### Selection Changes

Use `onChange` and `change.selectionChanged` for UI that follows the model selection.

```tsx
<Slate
  editor={editor}
  onChange={(_, change) => {
    if (!change.selectionChanged) return

    updateToolbar(change.selection)
  }}
>
  <Editable />
</Slate>
```

### `decorationSources`

Decoration sources publish transient render-time ranges such as search matches,
diagnostics, and code highlights.

```tsx
const searchSource = useSlateDecorationSource(editor, {
  id: 'search',
  read: ({ snapshot }) => findSearchMatches(snapshot, query),
})

<Slate decorationSources={[searchSource]} editor={editor}>
  <Editable renderSegment={renderSearchMatch} />
</Slate>
```

Use provider-owned `decorationSources` so every `Editable` and overlay UI reads
from the same projection source. Use `Editable.decorate` for a simple
editor-local decoration callback.

### `annotationStore`

The annotation store publishes anchor-backed annotations to text rendering and annotation UI hooks.

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

<Slate annotationStore={annotationStore} editor={editor}>
  <Editable renderSegment={renderCommentSegment} />
  <CommentsSidebar />
</Slate>
```
