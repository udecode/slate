import { type KeyboardEvent, useCallback, useMemo } from 'react'
import { Node, Path, Point, Range, type Element as SlateElement } from 'slate'
import { withHistory } from 'slate-history'
import {
  Editable,
  type EditableInputRule,
  type RenderElementProps,
  Slate,
  useSlateEditor,
} from 'slate-react'

import type {
  BulletedListElement,
  CustomEditor,
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
  const renderElement = useCallback(
    (props: RenderElementProps) => <Element {...props} />,
    []
  )
  const editor = useSlateEditor<CustomValue, CustomEditor>({
    withEditor: (editor) => withHistory(editor),
    initialValue,
  })
  const inputRules = useMemo<readonly EditableInputRule[]>(
    () => [
      ({ data, inputType }) => {
        if (inputType === 'insertText' && typeof data === 'string') {
          return applyMarkdownTextShortcut(editor, data)
        }
      },
    ],
    [editor]
  )
  const handleDOMBeforeInput = useCallback(
    (e: InputEvent) => {
      queueMicrotask(() => {
        const pendingDiffs = editor.dom.androidPendingDiffs()

        const scheduleFlush = pendingDiffs?.some(({ diff, path }) => {
          if (!diff.text.endsWith(' ')) {
            return false
          }

          const { text } = Node.leaf(editor, path)
          const beforeText = text.slice(0, diff.start) + diff.text.slice(0, -1)
          if (!(beforeText in SHORTCUTS)) {
            return false
          }

          const blockEntry = editor.read((state) =>
            state.nodes.above({
              at: path,
              match: (n) => Node.isElement(n) && state.nodes.isBlock(n),
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
          editor.dom.androidScheduleFlush()
        }
      })
    },
    [editor]
  )
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter' && applyMarkdownHeadingStartEnter(editor)) {
        event.preventDefault()
        return true
      }

      if (event.key === 'Backspace' && applyMarkdownBackspaceShortcut(editor)) {
        return true
      }
    },
    [editor]
  )

  return (
    <Slate editor={editor}>
      <Editable
        autoFocus
        inputRules={inputRules}
        onDOMBeforeInput={handleDOMBeforeInput}
        onKeyDown={handleKeyDown}
        placeholder="Write some markdown..."
        renderElement={renderElement}
        spellCheck
      />
    </Slate>
  )
}

const applyMarkdownTextShortcut = (editor: CustomEditor, text: string) => {
  const selection = editor.read((state) => state.selection.get())

  if (!text.endsWith(' ') || !selection || !Range.isCollapsed(selection)) {
    return false
  }

  const { anchor } = selection
  const block = editor.read((state) =>
    state.nodes.above({
      match: (n) => Node.isElement(n) && state.nodes.isBlock(n),
    })
  )
  const path = block ? block[1] : []
  const start = editor.read((state) => state.points.start(path))
  const range = { anchor, focus: start }
  const beforeText =
    editor.read((state) => state.text.string(range)) + text.slice(0, -1)
  const orderedListMatch = ORDERED_LIST_SHORTCUT.exec(beforeText)
  const type = orderedListMatch ? 'list-item' : SHORTCUTS[beforeText]

  if (!type) {
    return false
  }

  const newProperties: Partial<SlateElement> = {
    type,
  }

  editor.update((tx) => {
    tx.selection.set(range)

    if (!Range.isCollapsed(range)) {
      tx.text.delete()
    }

    tx.nodes.set(newProperties, {
      match: (n) => Node.isElement(n) && tx.nodes.isBlock(n),
    })

    if (type === 'list-item') {
      const list = createListElement(beforeText, orderedListMatch)

      tx.nodes.wrap(list, {
        match: (n) => Node.isElement(n) && n.type === 'list-item',
      })

      if (list.type === 'bulleted-list') {
        mergeAdjacentBulletedLists(editor, tx)
      }
    }

    selectCurrentBlockStart(editor)
  })
  editor.dom.focus()

  return true
}

const applyMarkdownHeadingStartEnter = (editor: CustomEditor) => {
  const selection = editor.read((state) => state.selection.get())

  if (!selection || !Range.isCollapsed(selection)) {
    return false
  }

  const blockEntry = editor.read((state) =>
    state.nodes.above({
      at: selection,
      match: (n) => Node.isElement(n) && state.nodes.isBlock(n),
    })
  )

  if (!blockEntry) {
    return false
  }

  const [block, blockPath] = blockEntry

  if (
    !Node.isElement(block) ||
    !HEADING_TYPES.has(block.type as CustomElementType)
  ) {
    return false
  }

  const start = editor.read((state) => state.points.start(blockPath))

  if (!Point.equals(selection.anchor, start)) {
    return false
  }

  editor.update((tx) => {
    tx.break.insert()
    tx.nodes.set(
      { type: 'paragraph' },
      {
        at: blockPath,
        match: (n) => Node.isElement(n) && tx.nodes.isBlock(n),
      }
    )
  })

  return true
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
      match: (n) => Node.isElement(n) && n.type === 'bulleted-list',
    })
  )

  if (!listEntry) {
    return
  }

  let [, listPath] = listEntry

  if (Path.hasPrevious(listPath)) {
    const previousPath = Path.previous(listPath)
    const [previousNode] = editor.read((state) =>
      state.nodes.hasPath(previousPath)
        ? state.nodes.get(previousPath)
        : [null, previousPath]
    )

    if (
      previousNode &&
      Node.isElement(previousNode) &&
      previousNode.type === 'bulleted-list'
    ) {
      tx.nodes.merge({ at: listPath })
      listPath = previousPath
    }
  }

  const nextPath = Path.next(listPath)
  const [nextNode] = editor.read((state) =>
    state.nodes.hasPath(nextPath) ? state.nodes.get(nextPath) : [null, nextPath]
  )

  if (
    nextNode &&
    Node.isElement(nextNode) &&
    nextNode.type === 'bulleted-list'
  ) {
    tx.nodes.merge({ at: nextPath })
  }
}

const applyMarkdownBackspaceShortcut = (editor: CustomEditor) => {
  const selection = editor.read((state) => state.selection.get())

  if (!selection || !Range.isCollapsed(selection)) {
    return false
  }

  const match = editor.read((state) =>
    state.nodes.above({
      match: (n) => Node.isElement(n) && state.nodes.isBlock(n),
    })
  )

  if (!match) {
    return false
  }

  const [block, path] = match
  const start = editor.read((state) => state.points.start(path))

  if (
    !Node.isElement(block) ||
    block.type === 'paragraph' ||
    !Point.equals(selection.anchor, start)
  ) {
    return false
  }

  const newProperties: Partial<SlateElement> = {
    type: 'paragraph',
  }
  editor.update((tx) => {
    tx.nodes.set(newProperties)

    if (block.type === 'list-item') {
      tx.nodes.unwrap({
        match: (n) =>
          Node.isElement(n) &&
          (n.type === 'bulleted-list' || n.type === 'numbered-list'),
        split: true,
      })
    }

    selectCurrentBlockStart(editor)
  })
  editor.dom.focus()

  return true
}

const selectCurrentBlockStart = (editor: CustomEditor) => {
  const block = editor.read((state) =>
    state.nodes.above({
      match: (n) => Node.isElement(n) && state.nodes.isBlock(n),
    })
  )

  if (block) {
    const start = editor.read((state) => state.points.start(block[1]))

    editor.update((tx) => {
      tx.selection.set(start)
    })
  }
}

const Element = ({ attributes, children, element }: RenderElementProps) => {
  switch (element.type) {
    case 'block-quote':
      return <blockquote {...attributes}>{children}</blockquote>
    case 'bulleted-list':
      return <ul {...attributes}>{children}</ul>
    case 'heading-one':
      return <h1 {...attributes}>{children}</h1>
    case 'heading-two':
      return <h2 {...attributes}>{children}</h2>
    case 'heading-three':
      return <h3 {...attributes}>{children}</h3>
    case 'heading-four':
      return <h4 {...attributes}>{children}</h4>
    case 'heading-five':
      return <h5 {...attributes}>{children}</h5>
    case 'heading-six':
      return <h6 {...attributes}>{children}</h6>
    case 'list-item':
      return <li {...attributes}>{children}</li>
    case 'numbered-list':
      return (
        <ol start={element.start} {...attributes}>
          {children}
        </ol>
      )
    default:
      return <p {...attributes}>{children}</p>
  }
}

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

export default MarkdownShortcutsExample
