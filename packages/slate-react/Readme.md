# slate-react

React runtime for Slate editors.

`slate-react` owns `createReactEditor`, the `Slate` provider, `Editable`, React
hooks, DOM selection synchronization, browser input handling, void shells,
projection stores, annotations, widgets, and large-document DOM strategies.

## Start Here

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

`createReactEditor` installs the React, DOM, clipboard, and history extensions.
Use `useSlateEditor` when the editor is owned by one React component.

## Public Surface

- `Slate` provides editor context, change callbacks, decoration sources,
  annotation stores, and widget stores.
- `Editable` renders the contenteditable surface and owns browser editing
  events.
- Hooks such as `useEditor`, `useEditorState`, `useElement`,
  `useElementSelected`, `useSlateDecorationSource`, and
  `useSlateAnnotationStore` subscribe to editor/runtime state.
- Host APIs live on `editor.api.dom`, `editor.api.clipboard`,
  `editor.api.react`, and `editor.api.history`.
