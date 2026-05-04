import { useCallback } from 'react'
import { Node, type NodeEntry, type Element as SlateElement } from 'slate'
import { getEditorRuntime } from 'slate/internal'
import { withHistory } from 'slate-history'
import {
  Editable,
  type RenderElementProps,
  Slate,
  useSlateEditor,
} from 'slate-react'
import type {
  CustomEditor,
  CustomElementType,
  CustomValue,
  ParagraphElement,
  TitleElement,
} from './custom-types.d'

const withLayout = (editor: CustomEditor) => {
  const runtime = getEditorRuntime(editor)
  const nextNormalizeNode = runtime.normalizeNode

  runtime.normalizeNode = (
    entry: NodeEntry,
    options: Parameters<typeof nextNormalizeNode>[1]
  ) => {
    const [, path] = entry

    if (path.length === 0) {
      if (runtime.getChildren().length <= 1 && runtime.string([0, 0]) === '') {
        const title: TitleElement = {
          type: 'title',
          children: [{ text: 'Untitled' }],
        }
        editor.update((tx) => {
          tx.nodes.insert(title, {
            at: path.concat(0),
            select: true,
          })
        })
      }

      if (runtime.getChildren().length < 2) {
        const paragraph: ParagraphElement = {
          type: 'paragraph',
          children: [{ text: '' }],
        }
        editor.update((tx) => {
          tx.nodes.insert(paragraph, { at: path.concat(1) })
        })
      }

      for (const [child, childPath] of Node.children(
        { children: runtime.getChildren() } as SlateElement,
        path
      )) {
        let type: CustomElementType
        const slateIndex = childPath[0]
        const enforceType = (type: CustomElementType) => {
          if (Node.isElement(child) && child.type !== type) {
            const newProperties: Partial<SlateElement> = { type }
            editor.update((tx) => {
              tx.nodes.set(newProperties, {
                at: childPath,
              })
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

    return nextNormalizeNode(entry, options)
  }

  return editor
}

const ForcedLayoutExample = () => {
  const renderElement = useCallback(
    (props: RenderElementProps) => <Element {...props} />,
    []
  )
  const editor = useSlateEditor<CustomValue, CustomEditor>({
    withEditor: (editor) => withLayout(withHistory(editor) as CustomEditor),
    initialValue,
  })
  return (
    <Slate editor={editor}>
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
