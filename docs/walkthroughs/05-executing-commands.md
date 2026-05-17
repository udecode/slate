# Executing Commands

So far, the formatting examples have lived directly inside event handlers. That
works for a tiny editor, but it gets repetitive once the same behavior is used
from keyboard shortcuts, toolbar buttons, menu items, or tests.

A command is just reusable editor logic. Keep command reads in
`editor.read(...)` and command writes in `editor.update(...)`.

## Extracting Commands

Start by moving the bold and code-block logic into plain functions:

```jsx
const isBoldActive = editor => {
  return editor.read(state => state.marks.get()?.bold === true)
}

const isCodeBlockActive = editor => {
  return editor.read(state => {
    const [match] = state.nodes.match({
      match: node => ElementApi.isElement(node) && node.type === 'code',
    })

    return Boolean(match)
  })
}

const toggleBold = editor => {
  editor.update(tx => {
    tx.marks.toggle('bold')
  })
}

const toggleCodeBlock = editor => {
  const isActive = isCodeBlockActive(editor)

  editor.update(tx => {
    tx.nodes.set(
      { type: isActive ? 'paragraph' : 'code' },
      {
        match: node => ElementApi.isElement(node) && !tx.schema.isInline(node),
      }
    )
  })
}
```

These functions are not added to the editor object. They are normal JavaScript
functions that receive an editor.

## Using Commands From Editor Events

Use the same commands from Slate's semantic command and key-command surfaces:

```jsx
import { defineEditorExtension } from 'slate'
import { editableKeyCommands, editableRenderers } from 'slate-react'

const rendering = defineEditorExtension({
  name: 'command-guide-rendering',
  capabilities: editableRenderers({
    elements: {
      code: CodeElement,
      paragraph: DefaultElement,
    },
    leaves: {
      bold: Leaf,
    },
  }),
})

const commandHotkeys = defineEditorExtension({
  name: 'command-guide-hotkeys',
  capabilities: editableKeyCommands(({ editor, event }) => {
    if (event.key === '`' && event.ctrlKey) {
      toggleCodeBlock(editor)
      return true
    }
  }),
})

const App = () => {
  const [editor] = useState(() => {
    const editor = createReactEditor({ initialValue })
    editor.extend(rendering)
    editor.extend(commandHotkeys)
    return editor
  })

  return (
    <Slate editor={editor}>
      <Editable
        onCommand={(command, { editor }) => {
          if (command.kind !== 'format') {
            return
          }

          switch (command.format) {
            case 'bold': {
              toggleBold(editor)
              return true
            }
          }
        }}
      />
    </Slate>
  )
}
```

## Using Commands From UI

The same functions can be called from toolbar buttons:

```jsx
const Toolbar = ({ editor }) => {
  return (
    <div>
      <button
        onMouseDown={event => {
          event.preventDefault()
          toggleBold(editor)
        }}
      >
        Bold
      </button>
      <button
        onMouseDown={event => {
          event.preventDefault()
          toggleCodeBlock(editor)
        }}
      >
        Code Block
      </button>
    </div>
  )
}
```

## Extension Commands

Plain functions are enough for app code. Extensions can expose typed `state`
and `tx` namespaces when a behavior needs to be shared by plugins.

Raw Slate does not ship product commands like lists, headings, or links. Those
belong in extensions or higher-level frameworks.
