# Installing Slate

Slate is split into small packages. For a React editor, install the core editor, the DOM helpers, the React renderer, and React itself.

```text
npm install slate slate-dom slate-react react react-dom
```

Use the equivalent command for your package manager if your project uses pnpm, Yarn, or Bun.

Once the packages are installed, import the editor factory from `slate` and the React pieces from `slate-react`.

```tsx
import { useState } from 'react'
import { Editable, Slate, createReactEditor, type SlateChange } from 'slate-react'
```

Before we render anything, let's define the document shape for this editor.

```tsx
type CustomText = { text: string }
type ParagraphElement = { type: 'paragraph'; children: CustomText[] }
type CustomValue = ParagraphElement[]

const initialValue: CustomValue = [
  {
    type: 'paragraph',
    children: [{ text: 'A line of text in a paragraph.' }],
  },
]
```

`CustomValue` is the TypeScript shape of this editor's main root. Passing it
to `createReactEditor` keeps element and text types attached to the editor API.

Create the editor inside `useState` so React keeps the same editor object for
the lifetime of the component.

Now we can render the editor with `<Slate>` and `<Editable>`.

```tsx
const App = () => {
  const [editor] = useState(() => createReactEditor<CustomValue>({ initialValue }))

  return (
    <Slate editor={editor}>
      <Editable />
    </Slate>
  )
}
```

`<Slate>` provides the editor to everything underneath it. `initialValue` seeds the document when the editor is first mounted, and `<Editable>` renders the editable document surface.

This is the smallest useful Slate editor. If you render `App`, you should see a paragraph with the text `A line of text in a paragraph.` When you type, Slate updates the document through the editor runtime.

## Listening for changes

Most applications save the document value somewhere. Pass `onChange` to `<Slate>` and save when `change.valueChanged` is true.

```tsx
const App = () => {
  const [editor] = useState(() => createReactEditor<CustomValue>({ initialValue }))

  const handleChange = (
    nextValue: CustomValue,
    change: SlateChange<CustomValue>
  ) => {
    if (!change.valueChanged) return

    localStorage.setItem('content', JSON.stringify(nextValue))
  }

  return (
    <Slate
      editor={editor}
      onChange={handleChange}
    >
      <Editable />
    </Slate>
  )
}
```

Use `initialValue` as the initial document. If your app needs to replace the whole document after the editor is mounted, use an explicit editor update instead of treating `<Slate>` like a controlled `<textarea>`.

## Next steps

The editor is rendering plain text. Next, add event handlers so the editor can
respond to keyboard shortcuts.
