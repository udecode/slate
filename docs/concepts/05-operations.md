# Operations

Operations are the granular, low-level actions that occur while invoking editor methods. One method call can produce many operations.

Slate's core defines all of the possible operations that can occur on a richtext document. For example:

```javascript
editor.update(tx => {
  tx.operations.replay([
    {
      type: 'insert_text',
      path: [0, 0],
      offset: 15,
      text: 'A new string of text to be inserted.',
    },
    {
      type: 'remove_node',
      path: [0, 0],
      node: {
        text: 'A line of text!',
      },
    },
    {
      type: 'set_selection',
      properties: {
        anchor: { path: [0, 0], offset: 0 },
      },
      newProperties: {
        anchor: { path: [0, 0], offset: 15 },
      },
    },
  ])
})
```

Under the covers Slate converts editor method calls into low-level operations and applies them automatically. You usually think about operations only when implementing collaborative editing, history, or import/export tooling.

Bulk edits can still be one operation. For example, paste can produce a
`replace_fragment` operation that replaces a child slice and moves the model
selection to the end of the inserted fragment. Collaboration adapters can replay
that operation directly, or translate it into their own CRDT representation at
the adapter boundary.

> 🤖 Slate's editing behaviors being defined as operations is what makes things like collaborative editing possible, because each change is easily define-able, apply-able, compose-able and even undo-able!
