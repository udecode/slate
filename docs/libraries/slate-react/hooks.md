# Slate React Hooks

#### `useEditor(): Editor`

Get the current editor object from React context.

#### `useEditorComposing(): boolean`

Get whether the editor is currently handling a composition session.

#### `useEditorFocused(): boolean`

Get whether the editor is focused. Use this for toolbar or shell UI, not for
every rendered node in a large document.

#### `useEditorReadOnly(): boolean`

Get whether the current editor is read-only.

#### `useEditorSelection(): Range | null`

Get the current editor selection. This hook re-renders when the selection
changes, so keep it out of large rendered node trees.

#### `useEditorState<T>(selector, options?): T`

Subscribe to a derived editor-state value. The selector runs inside
`editor.read`, so toolbar and shell UI do not need to open a read boundary by
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

#### `useElement(): Element`

Get the current element object inside an element renderer.

#### `useElementPath(): Path | null`

Subscribe to the current path of the rendered element. Use this only for UI
that displays or derives live path state during render. Event handlers should
usually call `editor.dom.findPath(element)` when they need the current path.

#### `useElementSelected(pathOrOptions?: Path | UseElementSelectedOptions): boolean`

Subscribe to whether the current element, or an explicit element path,
intersects the current selection. Use `{ mode: 'collapsed' }` when selected UI
should only appear for a collapsed caret inside the element, such as a block
void image ring. Use this only when the component actually draws selected UI.

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

#### `useSlateAnnotationStore<TData, TProjection>(editor, annotations): SlateAnnotationStore<TData, TProjection>`

Create an annotation store for durable anchored ranges such as comments,
suggestions, diagnostics, or external review markers.

Pass the store to `Slate` so `Editable`, sidebars, and widget UI read one
annotation snapshot.

#### `useSlateAnnotations<TData, TProjection>(store?): SlateAnnotationSnapshot<TData, TProjection>`

Read the current annotation snapshot. Without an explicit store, the hook reads
the store from the nearest `Slate` provider.

#### `useSlateAnnotation<TData, TProjection>(id, store?): SlateAnnotationEntry<TData, TProjection> | null`

Read one annotation by id.

#### `useSlateWidgetStore<TWidget, TAnnotation>(editor, widgets, annotationStore?): SlateWidgetStore<TWidget, TAnnotation>`

Create a widget store for UI anchored to nodes, selections, or annotations.

#### `useSlateWidgets<TWidget, TAnnotation>(store): SlateWidgetSnapshot<TWidget, TAnnotation>`

Read every widget in a widget store.

#### `useSlateWidget<TWidget, TAnnotation>(store, id): SlateWidgetEntry<TWidget, TAnnotation> | null`

Read one widget by id.
