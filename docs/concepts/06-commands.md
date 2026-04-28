# Commands

While editing richtext content, your users will be doing things like inserting text, deleting text, splitting paragraphs, and adding formatting. Under the cover these edits are expressed as operations. At the public API level, write them with `editor.update(...)` and editor methods.

Commands are the high-level actions that represent a specific intent of the user. They are represented as helper functions on the `Editor` interface. A handful of helpers are included in core for common richtext behaviors, but you are encouraged to write your own that model your specific domain.

For example, here are some of the built-in commands:

```javascript
editor.update(() => {
  editor.insertText('A new string of text to be inserted.')
})

editor.update(() => {
  editor.deleteBackward('word')
})

editor.update(() => {
  editor.insertBreak()
})
```

But you can \(and will!\) also define your own custom commands that model your domain. For example, you might want to define a `formatQuote` command, or an `insertImage` command, or a `toggleBold` command depending on what types of content you allow.

Commands always describe an action to be taken as if the **user** was performing the action. For that reason, they never need to define a location to perform the command, because they always act on the user's current selection.

> 🤖 The concept of commands is loosely based on the DOM's built-in [`execCommand`](https://developer.mozilla.org/en-US/docs/Web/API/Document/execCommand) APIs. However Slate defines its own simpler \(and extendable!\) version of the API, because the DOM's version is too opinionated and inconsistent.

Under the covers, Slate takes care of converting each command into a set of low-level "operations" that are applied to produce a new value. This is what makes collaborative editing implementations possible. But you don't have to worry about that, because it happens automatically.

## Custom Commands

When defining custom commands, you can create your own namespace:

```javascript
const MyEditor = {
  ...Editor,

  insertParagraph(editor) {
    // ...
  },
}
```

When writing your own commands, compose primitive editor methods inside one update:

```javascript
editor.update(() => {
  editor.setNodes(
    { bold: true },
    {
      at: range,
      match: node => Text.isText(node),
      split: true,
    }
  )

  editor.wrapNodes(
    { type: 'quote', children: [] },
    {
      at: point,
      match: node => Editor.isBlock(editor, node),
      mode: 'lowest',
    }
  )

  editor.insertText('A new string of text.', { at: path })
})
```

Primitive editor methods are designed to be composed together. Keep related writes in the same `editor.update(...)` so selection, operations, history, and React rendering share one commit.
