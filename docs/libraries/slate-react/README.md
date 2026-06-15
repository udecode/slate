# Slate React

`slate-react` owns the React editor runtime: editor creation, the `Slate`
provider, the `Editable` surface, browser event handling, native selection
sync, void shells, hidden DOM coverage, decoration sources, annotations,
widgets, and large-document DOM strategies.

Start with `useSlateEditor`, `Slate`, and `Editable`.

```tsx
import { Slate, Editable, useSlateEditor } from 'slate-react'

const Editor = () => {
  const editor = useSlateEditor({
    initialValue: [{ type: 'paragraph', children: [{ text: '' }] }],
  })

  return (
    <Slate editor={editor}>
      <Editable placeholder="Start typing..." />
    </Slate>
  )
}
```

## Stable Runtime Path

- [React Editor Setup](./react-editor-setup.md): create an editor and install
  the React, DOM, clipboard, and history extensions.
- [Slate Component](./slate.md): provide the editor, value changes, decoration
  sources, annotation stores, and widget stores.
- [Editable Component](./editable.md): render content, marks, voids,
  placeholders, DOM strategies, and editor event handlers.
- [Event Handling](./event-handling.md): customize copy, paste, drop, keyboard,
  input, selection, focus, and drag behavior without replacing Slate's runtime.
- [Hooks](./hooks.md): subscribe to editor state, runtime state, roots,
  mounted nodes, decorations, annotations, widgets, focus, read-only state, and
  selection.

## Runtime Boundaries

- [React Editor](./react-editor.md): DOM, focus, selection, clipboard, and
  React-specific editor APIs.
- Rendering primitives `SlateElement`, `SlateText`, `SlateLeaf`, and
  `SlatePlaceholder` carry Slate's DOM attributes when custom renderers need to
  keep the native editing contract intact.
- [DOM Coverage Boundaries](./dom-coverage-boundaries.md): represent hidden or
  summarized DOM regions for selection, copy, find, and materialization.
- [Annotations](./annotations.md): durable anchored ranges for comments,
  suggestions, diagnostics, and review markers.
- [Hooks](./hooks.md): runtime/root hooks and widget hooks for external chrome
  and overlay UI anchored to roots, nodes, selections, and annotations. Advanced
  hooks include `useSlateNodeRef`, `useDOMStrategyVirtualOffset`, and
  `useSlateRangeDecorationSource`.

## Advanced Lanes

- [Experimental Virtualized Rendering](./experimental-virtualized-rendering.md):
  large-document stress and DOM-budget work. Keep production use behind explicit
  product proof.
