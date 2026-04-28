# Saving to a Database

Now that you've learned the basics of how to add functionality to the Slate editor, you might be wondering how you'd go about saving the content you've been editing, such that you can come back to your app later and have it load.

In this guide, we'll show you how to add logic to save your Slate content to a database for storage and retrieval later.

Let's start with a basic editor:

```jsx
const initialValue = [
  {
    type: 'paragraph',
    children: [{ text: 'A line of text in a paragraph.' }],
  },
]

const App = () => {
  const [editor] = useState(() => withReact(createEditor()))

  return (
    <Slate editor={editor} initialValue={initialValue}>
      <Editable />
    </Slate>
  )
}
```

That will render a basic Slate editor on your page, and when you type things will change. But if you refresh the page, everything will be reverted back to its original value—nothing saves!

What we need to do is save the changes you make somewhere. For this example, we'll just be using [Local Storage](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage), but it will give you an idea for where you'd need to add your own database hooks.

Use `onValueChange` to save committed document changes:

```jsx
const initialValue = [
  {
    type: 'paragraph',
    children: [{ text: 'A line of text in a paragraph.' }],
  },
]

const App = () => {
  const [editor] = useState(() => withReact(createEditor()))

  return (
    <Slate
      editor={editor}
      initialValue={initialValue}
      onValueChange={value => {
        const content = JSON.stringify(value)
        localStorage.setItem('content', content)
      }}
    >
      <Editable />
    </Slate>
  )
}
```

Now whenever you edit the page, if you look in Local Storage, you should see the `content` value changing.

But... if you refresh the page, everything is still reset. That's because we need to make sure the initial value is pulled from that same Local Storage location, like so:

```jsx
const App = () => {
  const [editor] = useState(() => withReact(createEditor()))
  // Update the initial content to be pulled from Local Storage if it exists.
  const initialValue = useMemo(
    () =>
      JSON.parse(localStorage.getItem('content')) || [
        {
          type: 'paragraph',
          children: [{ text: 'A line of text in a paragraph.' }],
        },
      ],
    []
  )

  return (
    <Slate
      editor={editor}
      initialValue={initialValue}
      onValueChange={value => {
        const content = JSON.stringify(value)
        localStorage.setItem('content', content)
      }}
    >
      <Editable />
    </Slate>
  )
}
```

Now you should be able to save changes across refreshes!

Success—you've got JSON in your database.

But what if you want something other than JSON? Well, you'd need to serialize your value differently. For example, if you want to save your content as plain text instead of JSON, we can write some logic to serialize and deserialize plain text values:

```jsx
// Import the `Node` helper interface from Slate.
import { Node } from 'slate'

// Define a serializing function that takes a value and returns a string.
const serialize = value => {
  return (
    value
      // Return the string content of each paragraph in the value's children.
      .map(n => Node.string(n))
      // Join them all with line breaks denoting paragraphs.
      .join('\n')
  )
}

// Define a deserializing function that takes a string and returns a value.
const deserialize = string => {
  // Return a value array of children derived by splitting the string.
  return string.split('\n').map(line => {
    return {
      children: [{ text: line }],
    }
  })
}

const App = () => {
  const [editor] = useState(() => withReact(createEditor()))
  // Use our deserializing function to read the data from Local Storage.
  const initialValue = useMemo(
    deserialize(localStorage.getItem('content')) || '',
    []
  )

  return (
    <Slate
      editor={editor}
      initialValue={initialValue}
      onValueChange={value => {
        localStorage.setItem('content', serialize(value))
      }}
    >
      <Editable />
    </Slate>
  )
}
```

That works! Now you're working with plain text.

You can emulate this strategy for any format you like. You can serialize to HTML, to Markdown, or even to your own custom JSON format that is tailored to your use case.

> 🤖 Note that even though you _can_ serialize your content however you like, there are tradeoffs. The serialization process has a cost itself, and certain formats may be harder to work with than others. In general we recommend writing your own format only if your use case has a specific need for it. Otherwise, you're often better leaving the data in the format Slate uses.

If you want to update the editor's content in response to events from outside of Slate, replace the editor value through an explicit editor API.

```javascript
  /**
  * resetNodes resets the value of the editor.
  * It should be noted that passing the `at` parameter may cause a "Cannot resolve a DOM point from Slate point" error.
  */
  resetNodes<T extends Node>(
    editor: Editor,
    options: {
      nodes?: Node | Node[],
      at?: Location
    } = {}
  ): void {
    const nodes = options.nodes
      ? Node.isNode(options.nodes)
        ? [options.nodes]
        : options.nodes
      : []

    Editor.replace(editor, {
      children: nodes,
      selection: null,
    })

    const point = options.at && Point.isPoint(options.at)
      ? options.at
      : Editor.end(editor, [])

    if (point) {
      editor.update(() => {
        editor.select(point)
      })
    }
  }
```
