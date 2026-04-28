# Plugins

Plugins package editor behavior into named extensions. An extension can add
domain methods, compose existing editor methods, register capabilities, install
normalizers, listen to commits, or register command middleware.

Define extensions with `defineEditorExtension(...)` and install them with
`editor.extend(...)`.

```javascript
import { createEditor, defineEditorExtension } from 'slate'

const images = defineEditorExtension({
  name: 'images',
  capabilities: {
    void: { type: 'image' },
  },
  methods(editor) {
    const nextIsVoid = editor.isVoid

    return {
      insertImage(url) {
        editor.update(() => {
          editor.insertNode({
            type: 'image',
            url,
            children: [{ text: '' }],
          })
        })
      },
      isVoid(element) {
        return element.type === 'image' || nextIsVoid(element)
      },
    }
  },
})

const editor = createEditor()
const unextendImages = editor.extend(images)
```

Extensions are named so Slate can compose them deterministically. Dependencies
run before dependents, even when they are passed in a different order:

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

const mentions = defineEditorExtension({
  name: 'mentions',
  dependencies: ['links'],
  methods(editor) {
    const nextIsInline = editor.isInline
    const nextIsVoid = editor.isVoid

    return {
      insertMention(character) {
        editor.update(() => {
          editor.insertNode({
            type: 'mention',
            character,
            children: [{ text: '' }],
          })
        })
      },
      isInline(element) {
        return element.type === 'mention' || nextIsInline(element)
      },
      isVoid(element) {
        return element.type === 'mention' || nextIsVoid(element)
      },
    }
  },
})

editor.extend([mentions, links])
```

## Domain Methods

Domain methods should be ordinary editor methods. Put writes inside
`editor.update(...)` so selection, operations, history, collaboration, and
rendering observe one commit.

```javascript
const todos = defineEditorExtension({
  name: 'todos',
  methods(editor) {
    return {
      toggleTodo(checked = true) {
        editor.update(() => {
          editor.setNodes({ type: 'todo', checked })
        })
      },
    }
  },
})
```

Primitive methods stay flexible for custom node types. Use them inside your
domain method instead of waiting for Slate core to grow a semantic helper for
every schema.

## Method Composition

When an extension changes an existing method, capture the current method from
the `methods(editor)` factory and call it when the default behavior should
continue.

```javascript
const smartLinks = defineEditorExtension({
  name: 'smart-links',
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

This keeps extension order explicit and avoids ad-hoc method replacement in app
setup code.

## Helper Namespaces

You can still create helper namespaces for pure checks and shared utilities:

```javascript
import { Element } from 'slate'

const MyElement = {
  ...Element,
  isImageElement(value) {
    return Element.isElement(value) && value.type === 'image'
  },
}
```

Use namespaces for stateless helpers. Use `editor.extend(...)` for behavior
that changes the editor.
