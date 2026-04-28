import { type KeyboardEvent, useCallback, useMemo } from 'react'
import {
  createEditor,
  Editor,
  Node,
  Point,
  Range,
  type Element as SlateElement,
} from 'slate'
import { withHistory } from 'slate-history'
import {
  Editable,
  type EditableInputRule,
  ReactEditor,
  type RenderElementProps,
  Slate,
  withReact,
} from 'slate-react'

import type {
  BulletedListElement,
  CustomEditor,
  CustomElementType,
  CustomValue,
} from './custom-types.d'

const SHORTCUTS: Record<string, CustomElementType> = {
  '*': 'list-item',
  '-': 'list-item',
  '+': 'list-item',
  '>': 'block-quote',
  '#': 'heading-one',
  '##': 'heading-two',
  '###': 'heading-three',
  '####': 'heading-four',
  '#####': 'heading-five',
  '######': 'heading-six',
} as const

const MarkdownShortcutsExample = () => {
  const renderElement = useCallback(
    (props: RenderElementProps) => <Element {...props} />,
    []
  )
  const editor = useMemo(
    () => withReact(withHistory(createEditor<CustomValue>())) as CustomEditor,
    []
  )
  const inputRules = useMemo<readonly EditableInputRule[]>(
    () => [
      ({ data, editor: ruleEditor, inputType }) =>
        inputType === 'insertText' &&
        typeof data === 'string' &&
        applyMarkdownTextShortcut(ruleEditor as CustomEditor, data),
    ],
    []
  )

  const handleDOMBeforeInput = useCallback(
    (e: InputEvent) => {
      queueMicrotask(() => {
        const pendingDiffs = ReactEditor.androidPendingDiffs(editor)

        const scheduleFlush = pendingDiffs?.some(({ diff, path }) => {
          if (!diff.text.endsWith(' ')) {
            return false
          }

          const { text } = Node.leaf(editor, path)
          const beforeText = text.slice(0, diff.start) + diff.text.slice(0, -1)
          if (!(beforeText in SHORTCUTS)) {
            return false
          }

          const blockEntry = Editor.above(editor, {
            at: path,
            match: (n) => Node.isElement(n) && Editor.isBlock(editor, n),
          })
          if (!blockEntry) {
            return false
          }

          const [, blockPath] = blockEntry
          return Editor.isStart(editor, Editor.start(editor, path), blockPath)
        })

        if (scheduleFlush) {
          ReactEditor.androidScheduleFlush(editor)
        }
      })
    },
    [editor]
  )
  const handleKeyCommand = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Backspace' && applyMarkdownBackspaceShortcut(editor)) {
        return true
      }
    },
    [editor]
  )

  return (
    <Slate editor={editor} initialValue={initialValue}>
      <Editable
        autoFocus
        inputRules={inputRules}
        onDOMBeforeInput={handleDOMBeforeInput}
        onKeyCommand={handleKeyCommand}
        placeholder="Write some markdown..."
        renderElement={renderElement}
        spellCheck
      />
    </Slate>
  )
}

const applyMarkdownTextShortcut = (editor: CustomEditor, text: string) => {
  const selection = editor.getSelection()

  if (!text.endsWith(' ') || !selection || !Range.isCollapsed(selection)) {
    return false
  }

  const { anchor } = selection
  const block = Editor.above(editor, {
    match: (n) => Node.isElement(n) && Editor.isBlock(editor, n),
  })
  const path = block ? block[1] : []
  const start = Editor.start(editor, path)
  const range = { anchor, focus: start }
  const beforeText = Editor.string(editor, range) + text.slice(0, -1)
  const type = SHORTCUTS[beforeText]

  if (!type) {
    return false
  }

  const newProperties: Partial<SlateElement> = {
    type,
  }

  editor.update(() => {
    editor.select(range)

    if (!Range.isCollapsed(range)) {
      editor.delete()
    }

    editor.setNodes<SlateElement>(newProperties, {
      match: (n) => Node.isElement(n) && Editor.isBlock(editor, n),
    })

    if (type === 'list-item') {
      const list: BulletedListElement = {
        type: 'bulleted-list',
        children: [],
      }
      editor.wrapNodes(list, {
        match: (n) => Node.isElement(n) && n.type === 'list-item',
      })
    }

    selectCurrentBlockStart(editor)
  })
  ReactEditor.focus(editor)

  return true
}

const applyMarkdownBackspaceShortcut = (editor: CustomEditor) => {
  const selection = editor.getSelection()

  if (!selection || !Range.isCollapsed(selection)) {
    return false
  }

  const match = Editor.above(editor, {
    match: (n) => Node.isElement(n) && Editor.isBlock(editor, n),
  })

  if (!match) {
    return false
  }

  const [block, path] = match
  const start = Editor.start(editor, path)

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
  editor.update(() => {
    editor.setNodes(newProperties)

    if (block.type === 'list-item') {
      editor.unwrapNodes({
        match: (n) => Node.isElement(n) && n.type === 'bulleted-list',
        split: true,
      })
    }

    selectCurrentBlockStart(editor)
  })
  ReactEditor.focus(editor)

  return true
}

const selectCurrentBlockStart = (editor: CustomEditor) => {
  const block = Editor.above(editor, {
    match: (n) => Node.isElement(n) && Editor.isBlock(editor, n),
  })

  if (block) {
    editor.update(() => {
      editor.select(Editor.start(editor, block[1]))
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
