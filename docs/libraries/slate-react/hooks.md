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

#### `useElementIf(): Element | null`

Get the current element object, or `null` when the component is not inside an
element renderer.

#### `useElementSelected(path?: Path): boolean`

Subscribe to whether a specific element path intersects the current
selection. Use this only when the component actually draws selected UI.

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
