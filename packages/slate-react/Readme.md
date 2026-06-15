# slate-react

React runtime for Slate editors.

`slate-react` owns `createReactEditor`, the `Slate` provider, `Editable`, React
hooks, DOM selection synchronization, browser input handling, void shells,
decoration sources, annotations, widgets, and large-document DOM strategies.

## Start Here

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

The lower-level `createReactEditor` factory installs the React, DOM, clipboard,
and history extensions. Use it outside React component ownership, or inside a
custom hook that owns the same one-shot lifetime.

## Public Surface

- `Slate` provides editor context, change callbacks, decoration sources,
  annotation stores, and widget stores.
- `Editable` renders the contenteditable surface and owns browser editing
  events.
- `SlateElement`, `SlateText`, `SlateLeaf`, and `SlatePlaceholder` carry the
  DOM attributes needed by custom renderers.
- Hooks such as `useEditor`, `useEditorState`, `useElement`,
  `useElementSelected`, `useSlateDecorationSource`,
  `useSlateRangeDecorationSource`, and
  `useSlateAnnotationStore` subscribe to editor/runtime state.
- Runtime and root hooks such as `useSlateRuntimeState`,
  `useSlateRootState`, `useSlateRootEditor`, `useSlateActiveEditor`,
  `useSlateCommandCallback`, and `useSlateRootEffect` support multi-root
  editors and external chrome.
- Advanced hooks such as `useSlateNodeRef` and
  `useDOMStrategyVirtualOffset` support custom DOM shells and virtualized
  layout renderers.
- Host APIs live on `editor.api.dom`, `editor.api.clipboard`,
  `editor.api.react`, and `editor.api.history`.
