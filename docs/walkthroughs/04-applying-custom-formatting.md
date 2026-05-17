# Applying Custom Formatting

In the previous guide we learned how to create custom block types that render chunks of text inside different containers. But Slate allows for more than just "blocks".

We'll add custom formatting options like **bold**, _italic_, `code`, and ~~strikethrough~~.

So we start with our app from earlier:

```jsx
const renderElement = props => {
  switch (props.element.type) {
    case 'code':
      return <CodeElement {...props} />
    default:
      return <DefaultElement {...props} />
  }
}

const initialValue = [
  {
    type: 'paragraph',
    children: [{ text: 'A line of text in a paragraph.' }],
  },
]

const App = () => {
  const [editor] = useState(() => createReactEditor({ initialValue }))

  return (
    <Slate editor={editor}>
      <Editable
        renderElement={renderElement}
        onKeyDown={event => {
          if (event.key === '`' && event.ctrlKey) {
            event.preventDefault()
            const [match] = editor.read(state =>
              state.nodes.match({
                match: n => n.type === 'code',
              })
            )
            editor.update((tx) => {
              tx.nodes.set(
                { type: match ? 'paragraph' : 'code' },
                {
                  match: n => ElementApi.isElement(n) && tx.schema.isBlock(n),
                }
              )
            })
          }
        }}
      />
    </Slate>
  )
}
```

Next, we'll edit the `onKeyDown` handler to make it so that when you press `control-B`, it adds a `bold` format to the currently selected text:

```jsx
import { defineEditorExtension } from 'slate'
import { renderElement } from 'slate-react'

const initialValue = [
  {
    type: 'paragraph',
    children: [{ text: 'A line of text in a paragraph.' }],
  },
]

const rendering = defineEditorExtension({
  name: 'formatting-rendering',
  api: renderElement({
    elements: {
      code: CodeElement,
      paragraph: DefaultElement,
    },
  }),
})

const App = () => {
  const [editor] = useState(() => {
    const editor = createReactEditor({ initialValue })
    editor.extend(rendering)
    return editor
  })

  return (
    <Slate editor={editor}>
      <Editable
        onKeyDown={event => {
          if (!event.ctrlKey) {
            return
          }

          switch (event.key) {
            // When "`" is pressed, keep our existing code block logic.
            case '`': {
              event.preventDefault()
              const [match] = editor.read(state =>
                state.nodes.match({
                  match: n => n.type === 'code',
                })
              )
              editor.update((tx) => {
                tx.nodes.set(
                  { type: match ? 'paragraph' : 'code' },
                  {
                    match: n =>
                      ElementApi.isElement(n) && tx.schema.isBlock(n),
                  }
                )
              })
              break
            }

            // When "B" is pressed, bold the text in the selection.
            case 'b': {
              event.preventDefault()
              editor.update((tx) => {
                tx.marks.add('bold', true)
              })
              break
            }
          }
        }}
      />
    </Slate>
  )
}
```

Unlike the code format from the previous step, which is a block-level format, bold is a character-level format. Slate manages text contained within blocks (or any other element) using "leaves". Slate's character-level formats/styles are called "marks". Adjacent text with the same marks (styles) applied will be grouped within the same "leaf". When we call `tx.marks.add(...)` inside `editor.update(...)`, Slate breaks up the leaves at the selection boundaries and produces a new leaf with the bold mark added.

Okay, so we've got the hotkey handler setup... but! If you try selecting text and hitting `Ctrl-B`, you won't notice any change. That's because we haven't told Slate how to render a "bold" mark.

For every format you add, you need to tell Slate how to render it, just like for elements. So let's define a `Leaf` component:

```jsx
// Define a React component to render leaves with bold text.
const Leaf = props => {
  return <strong>{props.children}</strong>
}
```

Pretty familiar, right? Registered leaf components render inside Slate's leaf
DOM shell, so the component only needs to return inline content. You can learn
more about leaves in the [Rendering section](../concepts/09-rendering.md#leaves).

Next, let's tell Slate about that leaf. To do that, we'll add it to our
`renderElement(...)` extension capability.

```jsx
import { defineEditorExtension } from 'slate'
import { renderElement } from 'slate-react'

const initialValue = [
  {
    type: 'paragraph',
    children: [{ text: 'A line of text in a paragraph.' }],
  },
]

const rendering = defineEditorExtension({
  name: 'formatting-rendering',
  api: renderElement({
    elements: {
      code: CodeElement,
      paragraph: DefaultElement,
    },
    leaves: {
      bold: Leaf,
    },
  }),
})

const App = () => {
  const [editor] = useState(() => {
    const editor = createReactEditor({ initialValue })
    editor.extend(rendering)
    return editor
  })

  return (
    <Slate editor={editor}>
      <Editable
        onKeyDown={event => {
          if (!event.ctrlKey) {
            return
          }

          switch (event.key) {
            case '`': {
              event.preventDefault()
              const [match] = editor.read(state =>
                state.nodes.match({
                  match: n => n.type === 'code',
                })
              )
              editor.update((tx) => {
                tx.nodes.set(
                  { type: match ? 'paragraph' : 'code' },
                  {
                    match: n =>
                      ElementApi.isElement(n) && tx.schema.isBlock(n),
                  }
                )
              })
              break
            }

            case 'b': {
              event.preventDefault()
              editor.update((tx) => {
                tx.marks.add('bold', true)
              })
              break
            }
          }
        }}
      />
    </Slate>
  )
}

const Leaf = props => {
  return <strong>{props.children}</strong>
}
```

Now, if you try selecting a piece of text and hitting `Ctrl-B` you should see it turn bold! Magic!
