import {
  defineEditorExtension,
  NodeApi,
  PathApi,
  PointApi,
  RangeApi,
  type Element as SlateElement,
} from 'slate'
import { Editable, editableRenderers, Slate, useSlateEditor } from 'slate-react'

import type {
  BulletedListElement,
  CustomEditor,
  CustomElement,
  CustomElementType,
  CustomValue,
  NumberedListItemElement,
} from './custom-types.d'

const SHORTCUTS: Record<string, CustomElementType> = {
  '+': 'list-item',
  '*': 'list-item',
  '-': 'list-item',
  '>': 'block-quote',
  '#': 'heading-one',
  '##': 'heading-two',
  '###': 'heading-three',
  '####': 'heading-four',
  '#####': 'heading-five',
  '######': 'heading-six',
} as const
const BULLETED_LIST_SHORTCUTS = new Set(['*', '-', '+'])
const HEADING_TYPES = new Set<CustomElementType>([
  'heading-one',
  'heading-two',
  'heading-three',
  'heading-four',
  'heading-five',
  'heading-six',
])
const ORDERED_LIST_SHORTCUT = /^(\d+)\.$/

const MarkdownShortcutsExample = () => {
  const initialValue: CustomValue = [
    {
      type: 'paragraph',
      children: [
        {
          text: 'The editor gives you full control over the logic you can add. For example, it\'s fairly common to want to add markdown-like shortcuts to editors. So that, when you start a line with "> " you get a blockquote that looks like this:',
        },
      ],
    },
    {
      type: 'block-quote',
      children: [{ text: 'A wise quote.' }],
    },
    {
      type: 'paragraph',
      children: [
        {
          text: 'Order when you start a line with "## " you get a level-two heading, like this:',
        },
      ],
    },
    {
      type: 'heading-two',
      children: [{ text: 'Try it out!' }],
    },
    {
      type: 'paragraph',
      children: [
        {
          text: 'Try it out for yourself! Try starting a new line with ">", "-", or "#"s.',
        },
      ],
    },
  ]
  const editor = useSlateEditor({
    extensions: [markdownShortcuts()],
    initialValue,
  })
  return (
    <Slate editor={editor}>
      <Editable
        autoFocus
        onCommand={(command) => {
          if (command.kind === 'insert-break') {
            const selection = editor.read((state) => state.selection.get())

            if (selection && RangeApi.isCollapsed(selection)) {
              const blockEntry = editor.read((state) =>
                state.nodes.above({
                  at: selection,
                  match: (n) => NodeApi.isElement(n) && state.nodes.isBlock(n),
                })
              )

              if (blockEntry) {
                const [block, blockPath] = blockEntry

                if (
                  NodeApi.isElement(block) &&
                  HEADING_TYPES.has(block.type as CustomElementType)
                ) {
                  const start = editor.read((state) =>
                    state.points.start(blockPath)
                  )

                  if (PointApi.equals(selection.anchor, start)) {
                    editor.update((tx) => {
                      tx.break.insert()
                      tx.nodes.set(
                        { type: 'paragraph' },
                        {
                          at: blockPath,
                          match: (n) =>
                            NodeApi.isElement(n) && tx.nodes.isBlock(n),
                        }
                      )
                    })

                    return true
                  }
                }
              }
            }
          }

          if (command.kind === 'delete' && command.direction === 'backward') {
            const selection = editor.read((state) => state.selection.get())

            if (selection && RangeApi.isCollapsed(selection)) {
              const match = editor.read((state) =>
                state.nodes.above({
                  match: (n) => NodeApi.isElement(n) && state.nodes.isBlock(n),
                })
              )

              if (match) {
                const [block, path] = match
                const start = editor.read((state) => state.points.start(path))

                if (
                  NodeApi.isElement(block) &&
                  block.type !== 'paragraph' &&
                  PointApi.equals(selection.anchor, start)
                ) {
                  const newProperties: Partial<SlateElement> = {
                    type: 'paragraph',
                  }

                  editor.update((tx) => {
                    tx.nodes.set(newProperties)

                    if (block.type === 'list-item') {
                      tx.nodes.unwrap({
                        match: (n) =>
                          NodeApi.isElement(n) &&
                          (n.type === 'bulleted-list' ||
                            n.type === 'numbered-list'),
                        split: true,
                      })
                    }

                    selectCurrentBlockStart(editor)
                  })
                  editor.api.dom.focus()

                  return true
                }
              }
            }
          }
        }}
        onDOMBeforeInput={() => scheduleAndroidMarkdownShortcutFlush(editor)}
        placeholder="Write some markdown..."
        spellCheck
      />
    </Slate>
  )
}

const markdownShortcuts = () =>
  defineEditorExtension<CustomEditor>()({
    capabilities: editableRenderers<unknown, CustomElement>({
      elements: {
        'block-quote': ({ attributes, children }) => (
          <blockquote {...attributes}>{children}</blockquote>
        ),
        'bulleted-list': ({ attributes, children }) => (
          <ul {...attributes}>{children}</ul>
        ),
        'heading-five': ({ attributes, children }) => (
          <h5 {...attributes}>{children}</h5>
        ),
        'heading-four': ({ attributes, children }) => (
          <h4 {...attributes}>{children}</h4>
        ),
        'heading-one': ({ attributes, children }) => (
          <h1 {...attributes}>{children}</h1>
        ),
        'heading-six': ({ attributes, children }) => (
          <h6 {...attributes}>{children}</h6>
        ),
        'heading-three': ({ attributes, children }) => (
          <h3 {...attributes}>{children}</h3>
        ),
        'heading-two': ({ attributes, children }) => (
          <h2 {...attributes}>{children}</h2>
        ),
        'list-item': ({ attributes, children }) => (
          <li {...attributes}>{children}</li>
        ),
        'numbered-list': ({ attributes, children, element }) => (
          <ol start={element.start} {...attributes}>
            {children}
          </ol>
        ),
        paragraph: ({ attributes, children }) => (
          <p {...attributes}>{children}</p>
        ),
      },
    }),
    name: 'markdown-shortcuts',
    transforms: {
      insertText({ editor, next, text }) {
        const selection = editor.read((state) => state.selection.get())

        if (
          text.endsWith(' ') &&
          selection &&
          RangeApi.isCollapsed(selection)
        ) {
          const { anchor } = selection
          const block = editor.read((state) =>
            state.nodes.above({
              match: (n) => NodeApi.isElement(n) && state.nodes.isBlock(n),
            })
          )
          const path = block ? block[1] : []
          const start = editor.read((state) => state.points.start(path))
          const range = { anchor, focus: start }
          const beforeText =
            editor.read((state) => state.text.string(range)) + text.slice(0, -1)
          const orderedListMatch = ORDERED_LIST_SHORTCUT.exec(beforeText)
          const type = orderedListMatch ? 'list-item' : SHORTCUTS[beforeText]

          if (type) {
            const newProperties: Partial<SlateElement> = {
              type,
            }

            editor.update((tx) => {
              tx.selection.set(range)

              if (!RangeApi.isCollapsed(range)) {
                tx.text.delete()
              }

              tx.nodes.set(newProperties, {
                match: (n) => NodeApi.isElement(n) && tx.nodes.isBlock(n),
              })

              if (type === 'list-item') {
                const list = createListElement(beforeText, orderedListMatch)

                tx.nodes.wrap(list, {
                  match: (n) => NodeApi.isElement(n) && n.type === 'list-item',
                })

                if (list.type === 'bulleted-list') {
                  mergeAdjacentBulletedLists(editor, tx)
                }
              }

              selectCurrentBlockStart(editor)
            })
            editor.api.dom.focus()

            return
          }
        }

        next()
      },
    },
  })

const scheduleAndroidMarkdownShortcutFlush = (editor: CustomEditor) => {
  queueMicrotask(() => {
    const pendingDiffs = editor.api.dom.androidPendingDiffs()

    const scheduleFlush = pendingDiffs?.some(({ diff, path }) => {
      if (!diff.text.endsWith(' ')) {
        return false
      }

      const { text } = NodeApi.leaf(editor, path)
      const beforeText = text.slice(0, diff.start) + diff.text.slice(0, -1)
      if (!(beforeText in SHORTCUTS)) {
        return false
      }

      const blockEntry = editor.read((state) =>
        state.nodes.above({
          at: path,
          match: (n) => NodeApi.isElement(n) && state.nodes.isBlock(n),
        })
      )
      if (!blockEntry) {
        return false
      }

      const [, blockPath] = blockEntry
      const start = editor.read((state) => state.points.start(path))
      return editor.read((state) => state.points.isStart(start, blockPath))
    })

    if (scheduleFlush) {
      editor.api.dom.androidScheduleFlush()
    }
  })
}

const createListElement = (
  shortcut: string,
  orderedListMatch: RegExpExecArray | null
): BulletedListElement | NumberedListItemElement => {
  if (orderedListMatch) {
    return {
      type: 'numbered-list',
      start: Number(orderedListMatch[1]),
      children: [],
    }
  }

  if (!BULLETED_LIST_SHORTCUTS.has(shortcut)) {
    throw new Error(`Unsupported list shortcut: ${shortcut}`)
  }

  return {
    type: 'bulleted-list',
    children: [],
  }
}

const mergeAdjacentBulletedLists = (
  editor: CustomEditor,
  tx: Parameters<Parameters<CustomEditor['update']>[0]>[0]
) => {
  const selection = editor.read((state) => state.selection.get())

  if (!selection) {
    return
  }

  const listEntry = editor.read((state) =>
    state.nodes.above({
      at: selection,
      match: (n) => NodeApi.isElement(n) && n.type === 'bulleted-list',
    })
  )

  if (!listEntry) {
    return
  }

  let [, listPath] = listEntry

  if (PathApi.hasPrevious(listPath)) {
    const previousPath = PathApi.previous(listPath)
    const [previousNode] = editor.read((state) =>
      state.nodes.hasPath(previousPath)
        ? state.nodes.get(previousPath)
        : [null, previousPath]
    )

    if (
      previousNode &&
      NodeApi.isElement(previousNode) &&
      previousNode.type === 'bulleted-list'
    ) {
      tx.nodes.merge({ at: listPath })
      listPath = previousPath
    }
  }

  const nextPath = PathApi.next(listPath)
  const [nextNode] = editor.read((state) =>
    state.nodes.hasPath(nextPath) ? state.nodes.get(nextPath) : [null, nextPath]
  )

  if (
    nextNode &&
    NodeApi.isElement(nextNode) &&
    nextNode.type === 'bulleted-list'
  ) {
    tx.nodes.merge({ at: nextPath })
  }
}

const selectCurrentBlockStart = (editor: CustomEditor) => {
  const block = editor.read((state) =>
    state.nodes.above({
      match: (n) => NodeApi.isElement(n) && state.nodes.isBlock(n),
    })
  )

  if (block) {
    const start = editor.read((state) => state.points.start(block[1]))

    editor.update((tx) => {
      tx.selection.set(start)
    })
  }
}

export default MarkdownShortcutsExample
