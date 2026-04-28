import { useCallback, useMemo } from 'react'
import {
  createEditor,
  defineEditorExtension,
  Editor,
  Node,
  type NodeEntry,
  type Element as SlateElement,
} from 'slate'
import { withHistory } from 'slate-history'
import {
  Editable,
  type RenderElementProps,
  Slate,
  withReact,
} from 'slate-react'
import type {
  CustomEditor,
  CustomElementType,
  CustomValue,
  ParagraphElement,
  TitleElement,
} from './custom-types.d'

const layoutExtension = defineEditorExtension<CustomEditor>({
  name: 'forced-layout',
  methods(editor) {
    const nextNormalizeNode = editor.normalizeNode

    return {
      normalizeNode(entry: NodeEntry) {
        const [, path] = entry

        if (path.length === 0) {
          if (
            Editor.getChildren(editor).length <= 1 &&
            Editor.string(editor, [0, 0]) === ''
          ) {
            const title: TitleElement = {
              type: 'title',
              children: [{ text: 'Untitled' }],
            }
            editor.insertNodes(title, {
              at: path.concat(0),
              select: true,
            })
          }

          if (Editor.getChildren(editor).length < 2) {
            const paragraph: ParagraphElement = {
              type: 'paragraph',
              children: [{ text: '' }],
            }
            editor.insertNodes(paragraph, { at: path.concat(1) })
          }

          for (const [child, childPath] of Node.children(editor, path)) {
            let type: CustomElementType
            const slateIndex = childPath[0]
            const enforceType = (type: CustomElementType) => {
              if (Node.isElement(child) && child.type !== type) {
                const newProperties: Partial<SlateElement> = { type }
                editor.setNodes<SlateElement>(newProperties, {
                  at: childPath,
                })
              }
            }

            switch (slateIndex) {
              case 0:
                type = 'title'
                enforceType(type)
                break
              case 1:
                type = 'paragraph'
                enforceType(type)
                break
              default:
                break
            }
          }
        }

        return nextNormalizeNode(entry)
      },
    }
  },
})

const withLayout = (editor: CustomEditor) => {
  editor.extend(layoutExtension)
  return editor
}

const ForcedLayoutExample = () => {
  const renderElement = useCallback(
    (props: RenderElementProps) => <Element {...props} />,
    []
  )
  const editor = useMemo(
    () => withLayout(withHistory(withReact(createEditor<CustomValue>()))),
    []
  )
  return (
    <Slate editor={editor} initialValue={initialValue}>
      <Editable
        autoFocus
        placeholder="Enter a title…"
        renderElement={renderElement}
        spellCheck
      />
    </Slate>
  )
}

const Element = ({ attributes, children, element }: RenderElementProps) => {
  switch (element.type) {
    case 'title':
      return <h2 {...attributes}>{children}</h2>
    case 'paragraph':
      return <p {...attributes}>{children}</p>
  }
}

const initialValue: CustomValue = [
  {
    type: 'title',
    children: [{ text: 'Enforce Your Layout!' }],
  },
  {
    type: 'paragraph',
    children: [
      {
        text: 'This example shows how to enforce your layout with domain-specific constraints. This document will always have a title block at the top and at least one paragraph in the body. Try deleting them and see what happens!',
      },
    ],
  },
]

export default ForcedLayoutExample
