# Plugins

Slate plugins are named editor extensions. They package behavior that should be installed, ordered, and removed as one unit.

Use `defineEditorExtension(...)` to define an extension and `editor.extend(...)` to install it.

```javascript
import { createEditor, defineEditorExtension } from 'slate'

const editor = createEditor()

const links = defineEditorExtension({
  name: 'links',
  state: {
    link(state) {
      return {
        selectedHref() {
          const selection = state.selection.get()
          return selection ? findSelectedLinkHref(selection) : null
        },
      }
    },
  },
  tx: {
    link(tx) {
      return {
        setHref(href) {
          tx.nodes.set({ url: href })
        },
      }
    },
  },
})

editor.extend(links)
```

The `state` group is available inside `editor.read(...)`. The `tx` group is available inside `editor.update(...)`.

```javascript
const href = editor.read((state) => state.link.selectedHref())

editor.update((tx) => {
  tx.link.setHref('https://example.com')
})
```

## Extension Order

Extensions are named so Slate can compose them deterministically. Use `dependencies` when one extension needs another extension installed first.

```javascript
const mentions = defineEditorExtension({
  name: 'mentions',
  dependencies: ['links'],
  tx: {
    mention(tx) {
      return {
        insert(character) {
          tx.nodes.insert({
            type: 'mention',
            character,
            children: [{ text: '' }],
          })
        },
      }
    },
  },
})

editor.extend([mentions, links])
```

Slate installs `links` before `mentions` because `mentions` declares the dependency.

## Runtime Setup

Use `setup(context)` when an extension needs install-time options,
extension-local runtime state, cleanup, or hooks that share one setup context.
The returned slots are the same raw Slate slots as top-level `state`, `tx`,
`onCommit`, `operations`, `api`, and package-owned facets such as `clipboard`.

```javascript
const tables = defineEditorExtension({
  name: 'tables',
  peerDependencies: ['collaboration'],
  conflicts: ['legacy-tables'],
  options: {
    navigation: 'cell-boundary',
  },
  setup(context) {
    const mode = context.runtimeState('text')

    context.signal.addEventListener('abort', () => {
      mode.set('text')
    })

    return {
      state: {
        table(state) {
          return {
            currentCell() {
              return mode.get() === 'cell'
                ? findCurrentCell(state.selection.get())
                : null
            },
          }
        },
      },
      tx: {
        table(tx) {
          return {
            insertRow() {
              tx.nodes.insert({
                type: 'table-row',
                children: [{ type: 'table-cell', children: [{ text: '' }] }],
              })
            },
          }
        },
      },
      onCommit({ commit }) {
        if (commit.tags.includes('collaboration')) {
          syncTableOverlay(commit)
        }
        if (commit.selectionChanged) {
          mode.set('cell')
        }
      },
    }
  },
})
```

`dependencies` control install order. `peerDependencies` require a companion
extension without forcing order. `conflicts` prevents incompatible extensions
from being installed together. The cleanup function returned by
`editor.extend(...)` aborts `context.signal`, runs setup cleanup, removes
extension-local state, and unregisters the extension slots.

## State And Tx Groups

Use `state` for read helpers.

```javascript
const comments = defineEditorExtension({
  name: 'comments',
  state: {
    comments(state) {
      return {
        hasSelection() {
          return state.selection.get() !== null
        },
      }
    },
  },
})
```

Use `tx` for write helpers.

```javascript
const media = defineEditorExtension({
  name: 'media',
  tx: {
    media(tx) {
      return {
        insertImage(src) {
          tx.nodes.insert({
            type: 'image',
            src,
            children: [{ text: '' }],
          })
        },
      }
    },
  },
})
```

This split matters. Read helpers cannot accidentally write, and write helpers can read transaction-local state after earlier writes in the same update.

## Transform Middleware

Use `transforms` when an extension changes the behavior of a Slate transform.
Backspace, Delete, Enter, paste insertion, and text insertion policies belong
here when the behavior should apply beyond one React keyboard handler.

```javascript
import { defineEditorExtension, ElementApi, PointApi, RangeApi } from 'slate'

const table = defineEditorExtension({
  name: 'table',
  transforms: {
    deleteBackward({ editor, next, unit }) {
      const selection = editor.read(state => state.selection.get())

      if (selection && RangeApi.isCollapsed(selection)) {
        const cell = editor.read(state =>
          state.nodes.find({
            match: node =>
              ElementApi.isElement(node) && node.type === 'table-cell',
          })
        )

        if (cell) {
          const [, cellPath] = cell
          const start = editor.read(state => state.points.start(cellPath))

          if (PointApi.equals(selection.anchor, start)) {
            return true
          }
        }
      }

      return next({ unit })
    },
    insertBreak({ editor, next }) {
      const selection = editor.read(state => state.selection.get())

      if (selection && RangeApi.isCollapsed(selection)) {
        const cell = editor.read(state =>
          state.nodes.find({
            match: node =>
              ElementApi.isElement(node) && node.type === 'table-cell',
          })
        )

        if (cell) {
          return true
        }
      }

      return next()
    },
  },
})
```

Use `Editable onKeyDown` for UI shortcuts that are specifically keyboard
commands. Use transform middleware for behavior equivalent to Slate transform
names such as `deleteBackward`, `deleteForward`, `insertBreak`, and
`insertText`.

## Element Specs

Use `elements` when an extension owns editor behavior for an element type.

```javascript
import { defineEditorExtension, elementProperty } from 'slate'

const tables = defineEditorExtension({
  name: 'tables',
  elements: [
    {
      type: 'table-cell',
      isolating: true,
      keyboardSelectable: true,
      properties: {
        colSpan: elementProperty.number({ default: 1 }),
        rowSpan: elementProperty.number({ default: 1 }),
      },
    },
  ],
  state: {
    table(state) {
      return {
        selectedCellColSpan(element) {
          return state.schema.getElementProperty(element, 'colSpan')
        },
      }
    },
  },
})
```

Specs can describe behavior such as `inline`, `void`, `atom`, `isolating`,
`keyboardSelectable`, `readOnly`, `selectable`, and `markableVoid`.
`void: 'editable-island'` keeps the element void for rendering policy while
allowing Slate cursor projection to enter its text children.

`properties` are descriptors for extension-owned element fields. A descriptor
can provide a default and equality function. Defaults are read through
`state.schema` or `tx.schema`; they do not mutate the document unless a
transaction writes the property.

## Other Extension Slots

Extensions can also register lower-level runtime hooks:

| Slot | Use it for |
| --- | --- |
| `elements` | element schema specs |
| `normalizers` | named normalizer entries |
| `onCommit` | observing committed changes |
| `operations.apply` | operation import/export policy |
| `api` | mounted runtime handles exposed through `editor.api` |
| `clipboard` | DataTransfer ingress hooks |

Keep product-specific APIs above these raw slots. Plate, for example, can build richer plugin conventions on top of Slate's smaller extension substrate.

## Helper Namespaces

You can still create plain helper namespaces for stateless checks.

```javascript
import { ElementApi } from 'slate'

const MyElement = {
  isImage(value) {
    return ElementApi.isElement(value) && value.type === 'image'
  },
}
```

Use helper namespaces for pure utilities. Use `editor.extend(...)` for behavior that changes how the editor reads, writes, normalizes, or renders content.
