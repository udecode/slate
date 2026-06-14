# Slate React Hooks

## Editor Hooks

#### `useEditor(): Editor`

Get the current editor object from React context.

#### `useEditorComposing(): boolean`

Get whether the editor is currently handling a composition session.

#### `useEditorFocused(): boolean`

Get whether the editor is focused. Use this for toolbar UI, not for
every rendered node in a large document.

#### `useEditorReadOnly(): boolean`

Get whether the current editor is read-only.

#### `useEditorSelection(): Range | null`

Get the current editor selection. This hook re-renders when the selection
changes, so keep it out of large rendered node trees.

#### `useEditorState<T>(selector, options?): T`

Subscribe to a derived editor-state value. The selector runs inside
`editor.read`, so toolbar UI does not need to open a read boundary by
hand.

```typescript
const isBold = useEditorState(state => {
  return state.marks.get()?.bold === true
})
```

Use `options.shouldUpdate` to skip commits that cannot affect the selected
value.

```typescript
const selection = useEditorState(state => state.selection.get(), {
  shouldUpdate: change => Boolean(change?.selectionChanged),
})
```

Pass `options.deps` when the selector closes over component props.

```typescript
const matchingText = useEditorState(
  state => state.text.string([]).includes(query),
  { deps: [query] }
)
```

#### `useStateFieldValue<T>(field, options?): T`

Subscribe to one `defineStateField` value.

```tsx
const title = useStateFieldValue(documentTitle)
```

The hook only re-renders when that field key appears in
`change.dirtyStateKeys`. Use it for document title, page settings, spellcheck,
and other document state controls.

#### `useSetStateField<T>(field): (value, options?) => void`

Create a setter for one `defineStateField` value.

```tsx
const setTitle = useSetStateField(documentTitle)

setTitle('Q3 Launch Brief')
```

The setter writes through `editor.update` and preserves DOM selection by
default. Pass update options when the app needs a tag or collaboration metadata.

#### `useEditorSelector<T>(selector, equalityFn?, options?): T`

Subscribe to a low-level derived editor value.

Use `useEditorState` for normal app-level editor reads. Use
`useEditorSelector` when you intentionally need the editor object or operation
batch passed to the selector. Prefer node-, text-, decoration-, or
element-scoped hooks when rendering editor content.

```typescript
const latestOperationCount = useEditorSelector((_editor, operations) => {
  return operations?.length ?? 0
})
```

#### `useSlateHistory(options?): SlateHistoryController`

Create undo/redo commands and keyboard handling for the active root.

```tsx
const history = useSlateHistory()

return (
  <button disabled={!history.canUndo} onClick={history.undo}>
    Undo
  </button>
)
```

Pass `options.root` to bind history controls to one root. Pass
`focusPolicy: 'preserve-dom'` when undo/redo is controlled from external UI and
DOM focus should stay outside the editor.

## Runtime And Root Hooks

Use these when one editor owns multiple roots or external chrome.

- Runtime hooks read the whole editor runtime.
- View hooks read one root view.
- Root editor hooks return a command-capable editor view for one root.

Prefer `useSlateRootEditor(root)` when UI knows its root. Use
`useSlateActiveEditor()` only for UI that should follow the current selection.

#### `useSlateRuntime(options?): SlateRuntimeValue`

Create a React runtime value, or read the nearest runtime from `SlateRuntime`.
Most app code should use `Slate` directly.

#### `useSlateRuntimeState<T>(selector, options?): T`

Subscribe to whole-runtime editor state. The selector runs in a read view and
re-renders only when the selected value changes.

#### `useSlateViewState<T>(root, selector, options?): T`

Subscribe to one root view's state. The selector skips commits that cannot
affect that root.

#### `useSlateActiveRoot(): RootKey`

Read the root key that owns the current selection.

#### `useSlateRootEditor(root?, options?): SlateRootEditor`

Create a command-capable editor view for one root.

Use this for root-specific toolbar or sidebar commands. Pass `{ readOnly:
true }` when the view should only read state.

#### `useSlateActiveEditor(): SlateRootEditor`

Create a command-capable editor view for the root that owns the selection.

#### `useSlateRootChrome(root?, options?): SlateRootChromeController`

Create root chrome props for mouse interaction outside the editable content,
such as margin clicks and drag selection around a root.

```tsx
const chrome = useSlateRootChrome('body')

return <div {...chrome.props}>{children}</div>
```

Pass `selection: 'end'` for chrome that should place the caret at the end of a
root when clicked.

#### `useSlateContentRoot(element?, options?): SlateContentRootController`

Resolve a schema-owned child content root and its chrome controller.

Use this inside an element renderer for editable voids or nested editor
surfaces.

#### `useSlateChildRoot(element?, slot?): RootKey`

Resolve the stable child-root key for an element and slot.

Prefer persisted `childRoots[slot]` when the child root is part of document
data. The runtime fallback is for ephemeral editor islands.

#### `useSlateViewEffect(effect, options?)`

Run after Slate flushes mounted root views. Use this when a command or
measurement needs the live root editor.

#### `useSlateCommandCallback(callback, options?): (...args) => result`

Create a stable callback that resolves the mounted root editor at call time.

```tsx
const toggleTitle = useSlateCommandCallback(editor => {
  editor.update(tx => tx.text.insert('Title'))
})
```

Pass `focus: 'restore-root'` when the command should move focus back to the
editor root before running.

#### `useElement(): Element`

Get the current element object inside an element renderer.

#### `useElementPath(): Path | null`

Subscribe to the current path of the rendered element. Use this only for UI
that displays or derives live path state during render. Event handlers should
usually call `editor.api.dom.resolvePath(element)` and return early when it is
not mounted.

#### `useElementSelected(options?: UseElementSelectedOptions): boolean`

Subscribe to whether the current element, or an explicit element path,
intersects the current selection. Use `{ mode: 'collapsed' }` when selected UI
should only appear for a collapsed caret inside the element, such as a block
void image ring. Pass `{ at: path }` when the component needs to watch an
explicit element path. Use this only when the component actually draws selected
UI.

```ts
type UseElementSelectedOptions = {
  at?: Path | null
  mode?: 'intersects' | 'collapsed'
}
```

#### `useNodeSelector<T>(selector, equalityFn?, options?): T`

Subscribe to a value derived from one mounted node.

Pass `options.runtimeId` to target a specific node, or call it inside an editor
node renderer to use that renderer's runtime target.

#### `useTextSelector<T>(selector, equalityFn?, options?): T`

Subscribe to a value derived from one mounted text node.

Pass `options.runtimeId` to target a specific text node, or call it inside an
editor text renderer to use that renderer's runtime target.

#### `useDecorationSelector<T>(selector, equalityFn?, options?): T`

Subscribe to decoration/projection data for one mounted runtime target.

Pass `options.runtimeId` to target a specific runtime node, or call it inside a
renderer that already has runtime target context.

#### `useSlateDecorationSource<T>(editor, options): SlateDecorationSource<T>`

Create a provider-owned decoration source from React state.

Use this when ranges are shared across the editor surface, sidebars, toolbars,
or other overlay UI. Use `Editable.decorate` for a simple editor-local callback.

```tsx
const searchSource = useSlateDecorationSource(editor, {
  id: 'search',
  read: ({ snapshot }) => findSearchMatches(snapshot, query),
})

return (
  <Slate decorationSources={[searchSource]} editor={editor}>
    <Editable renderSegment={renderSearchMatch} />
  </Slate>
)
```

#### `useSlateAnnotationStore<TData, TProjection>(editor, annotationsOrOptions): SlateAnnotationStore<TData, TProjection>`

Create an annotation store for durable anchored ranges such as comments,
suggestions, diagnostics, or external review markers.

Pass the store to `Slate` so `Editable`, sidebars, and widget UI read one
annotation snapshot.

Pass an array for simple static annotation lists. Pass a projector when
annotations are derived from React state and should refresh from explicit
dependencies.

```tsx
const annotationStore = useSlateAnnotationStore(editor, {
  deps: [comments],
  project: () =>
    comments.map(comment => ({
      anchor: comment.anchor,
      data: comment,
      id: comment.id,
      projection: { tone: comment.tone },
    })),
})
```

#### `useSlateAnnotations<TData, TProjection>(store?): SlateAnnotationSnapshot<TData, TProjection>`

Read the current annotation snapshot. Without an explicit store, the hook reads
the store from the nearest `Slate` provider.

#### `useSlateAnnotation<TData, TProjection>(id, store?): SlateResolvedAnnotation<TData, TProjection> | null`

Read one annotation by id.

#### `useSlateWidgetStore<TWidget, TAnnotation>(editor, widgetsOrOptions, annotationStore?): SlateWidgetStore<TWidget, TAnnotation>`

Create a widget store for UI anchored to nodes, selections, or annotations.

Pass an array for simple static widget lists. Pass a projector when widget
creation depends on React state and should refresh from explicit dependencies.

```tsx
const widgetStore = useSlateWidgetStore(editor, {
  annotationStore,
  deps: [commentId],
  project: () => [
    {
      anchor: { annotationId: commentId, type: 'annotation' },
      data: { label: 'Comment' },
      id: 'comment-widget',
    },
  ],
})
```

#### `useSlateWidgets<TWidget, TAnnotation>(store): SlateWidgetSnapshot<TWidget, TAnnotation>`

Read every widget in a widget store.

#### `useSlateWidget<TWidget, TAnnotation>(store, id): SlateResolvedWidget<TWidget, TAnnotation> | null`

Read one widget by id.
