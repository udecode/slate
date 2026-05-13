# Commands

While editing richtext content, your users will be doing things like inserting text, deleting text, splitting paragraphs, and adding formatting. Under the cover these edits are expressed as operations. At the public API level, write them with `editor.update(...)` and transaction methods.

Commands are the high-level actions that represent a specific intent of the user. In Slate, command helpers are ordinary functions that run related transaction writes inside `editor.update(...)`.

For example, here are some of the built-in commands:

```javascript
editor.update((tx) => {
  tx.text.insert('A new string of text to be inserted.')
})

editor.update((tx) => {
  tx.text.delete({ reverse: true, unit: 'word' })
})

editor.update((tx) => {
  tx.nodes.split({ always: true })
})
```

But you can \(and will!\) also define your own custom commands that model your domain. For example, you might want to define a `formatQuote` command, or an `insertImage` command, or a `toggleBold` command depending on what types of content you allow.

Commands always describe an action to be taken as if the **user** was performing the action. For that reason, they never need to define a location to perform the command, because they always act on the user's current selection.

> 🤖 The concept of commands is loosely based on the DOM's built-in [`execCommand`](https://developer.mozilla.org/en-US/docs/Web/API/Document/execCommand) APIs. However Slate defines its own simpler \(and extendable!\) version of the API, because the DOM's version is too opinionated and inconsistent.

Under the covers, Slate takes care of converting each command into a set of low-level "operations" that are applied to produce a new value. This is what makes collaborative editing implementations possible. But you don't have to worry about that, because it happens automatically.

## Custom Commands

When defining custom commands, pass the editor into a function and keep the writes grouped:

```javascript
function insertParagraph(editor) {
  editor.update((tx) => {
    tx.nodes.insert({ type: 'paragraph', children: [{ text: '' }] })
  })
}
```

When writing your own commands, compose transaction methods inside one update:

```javascript
editor.update((tx) => {
  tx.nodes.set(
    { bold: true },
    {
      at: range,
      match: node => TextApi.isText(node),
      split: true,
    }
  )

  tx.nodes.wrap(
    { type: 'quote', children: [] },
    {
      at: point,
      match: node => ElementApi.isElement(node) && tx.schema.isBlock(node),
      mode: 'lowest',
    }
  )

  tx.text.insert('A new string of text.', { at: path })
})
```

Transaction methods are designed to be composed together. Keep related writes in the same `editor.update(...)` so selection, operations, history, and React rendering share one commit.
