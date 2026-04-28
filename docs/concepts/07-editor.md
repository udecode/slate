# Editor

All of the behaviors, content and state of a Slate editor is rolled up into a single, top-level `Editor` object. It has an interface of:

```typescript
interface Editor {
  // Schema-specific node behaviors.
  isInline: (element: Element) => boolean
  isVoid: (element: Element) => boolean
  markableVoid: (element: Element) => boolean
  normalizeNode: (entry: NodeEntry) => void
  // Public read/write lifecycle.
  read: <T>(fn: () => T) => T
  update: (fn: () => void, options?: EditorUpdateOptions) => void
  getChildren: () => Node[]
  getSelection: () => Range | null
  getOperations: () => readonly Operation[]
  getSnapshot: () => EditorSnapshot
  subscribe: (listener: SnapshotListener) => () => void
  // Core actions.
  addMark: (key: string, value: any) => void
  deleteBackward: (unit: 'character' | 'word' | 'line' | 'block') => void
  deleteForward: (unit: 'character' | 'word' | 'line' | 'block') => void
  deleteFragment: () => void
  insertBreak: () => void
  insertSoftBreak: () => void
  insertFragment: (fragment: Node[]) => void
  insertNode: (node: Node) => void
  insertText: (text: string) => void
  removeMark: (key: string) => void
}
```

It is slightly more complex than the others, because it contains all of the top-level functions that define your custom, domain-specific behaviors.

Read editor state through methods. Use `editor.getChildren()` for the document
tree, `editor.getSelection()` for the current selection,
`editor.getOperations()` for committed operations, and `editor.getMarks()` for
active marks.

Write document and selection state through `editor.update(...)`:

```javascript
editor.update(() => {
  editor.select(Editor.end(editor, []))
  editor.insertText('!')
})
```

The editor also exposes accessor and subscription helpers on the public surface:

- `editor.getChildren()`
- `editor.replace({ children, selection, marks })`
- `Editor.getSnapshot(editor)`
- `Editor.subscribe(editor, listener)`

## Extending Behaviors

Use named editor extensions to package reusable behavior. Extensions add domain
methods and compose existing methods through `editor.extend(...)`.

For example, link elements can be modeled as inline nodes:

```javascript
const links = defineEditorExtension({
  name: 'links',
  methods(editor) {
    const nextIsInline = editor.isInline

    return {
      isInline(element) {
        return element.type === 'link' || nextIsInline(element)
      },
    }
  },
})

editor.extend(links)
```

Or you can compose `insertText` behavior to linkify URLs:

```javascript
const smartLinks = defineEditorExtension({
  name: 'smart-links',
  dependencies: ['links'],
  methods(editor) {
    const nextInsertText = editor.insertText

    return {
      insertText(text, options) {
        if (isUrl(text)) {
          editor.update(() => {
            editor.insertNode({
              type: 'link',
              url: text,
              children: [{ text }],
            })
          })
          return
        }

        nextInsertText(text, options)
      },
    }
  },
})
```

If you have void "mention" elements that can accept marks like bold or italic:

```javascript
const mentions = defineEditorExtension({
  name: 'mentions',
  methods(editor) {
    const nextIsVoid = editor.isVoid
    const nextMarkableVoid = editor.markableVoid

    return {
      isVoid(element) {
        return element.type === 'mention' || nextIsVoid(element)
      },
      markableVoid(element) {
        return element.type === 'mention' || nextMarkableVoid(element)
      },
    }
  },
})
```

Or you can even define custom "normalizations" that take place to ensure that links obey certain constraints:

```javascript
const linkNormalization = defineEditorExtension({
  name: 'link-normalization',
  methods(editor) {
    const nextNormalizeNode = editor.normalizeNode

    return {
      normalizeNode(entry, options) {
        const [node, path] = entry

        if (Element.isElement(node) && node.type === 'link') {
          // ...
          return
        }

        nextNormalizeNode(entry, options)
      },
    }
  },
})
```

Whenever you compose behaviors, call the captured method when the default
behavior should continue.

> 🤖 For more info, check out the [Editor Instance Methods API Reference](../api/nodes/editor.md#schema-specific-instance-methods)

## Helper Functions

The `Editor` interface, like all Slate interfaces, exposes helper functions that are useful when implementing certain behaviors. There are many, many editor-related helpers. For example:

```javascript
// Get the start point of a specific node at path.
const point = Editor.start(editor, [0, 0])

// Get the fragment (a slice of the document) at a range.
const fragment = Editor.fragment(editor, range)
```

There are also many iterator-based helpers, for example:

```javascript
// Iterate over every node in a range.
for (const [node, path] of Editor.nodes(editor, { at: range })) {
  // ...
}

// Iterate over every point in every text node in the current selection.
for (const point of Editor.positions(editor)) {
  // ...
}
```

> 🤖 For more info, check out the [Editor Static Methods API Reference](../api/nodes/editor.md#static-methods)
