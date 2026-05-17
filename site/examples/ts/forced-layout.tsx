import {
  defineEditorExtension,
  NodeApi,
  type Element as SlateElement,
} from 'slate'
import {
  Editable,
  type RenderElementProps,
  Slate,
  useSlateEditor,
} from 'slate-react'
import type {
  CustomEditor,
  CustomElementType,
  ParagraphElement,
  TitleElement,
} from './custom-types.d'

const ENFORCING_LAYOUT = new WeakSet<CustomEditor>()

const createTitle = (): TitleElement => ({
  type: 'title',
  children: [{ text: 'Untitled' }],
})

const createParagraph = (): ParagraphElement => ({
  type: 'paragraph',
  children: [{ text: '' }],
})

const setType = (type: CustomElementType) =>
  ({ type }) satisfies Partial<SlateElement>

const enforceLayout = (editor: CustomEditor) => {
  if (ENFORCING_LAYOUT.has(editor)) {
    return
  }

  const children = editor.read((state) => state.value.get())
  const plannedChildren = [...children]
  const firstText = plannedChildren[0] ? NodeApi.string(plannedChildren[0]) : ''
  const insertTitle = plannedChildren.length <= 1 && firstText === ''

  if (insertTitle) {
    plannedChildren.splice(0, 0, createTitle())
  }

  const insertParagraph = plannedChildren.length < 2

  if (insertParagraph) {
    plannedChildren.splice(1, 0, createParagraph())
  }

  const first = plannedChildren[0]
  const second = plannedChildren[1]
  const enforceTitle =
    NodeApi.isElement(first) &&
    first.type !== ('title' satisfies CustomElementType)
  const enforceParagraph =
    NodeApi.isElement(second) &&
    second.type !== ('paragraph' satisfies CustomElementType)

  if (!insertTitle && !insertParagraph && !enforceTitle && !enforceParagraph) {
    return
  }

  ENFORCING_LAYOUT.add(editor)

  try {
    editor.update((tx) => {
      if (insertTitle) {
        tx.nodes.insert(createTitle(), {
          at: [0],
          select: true,
        })
      }

      if (insertParagraph) {
        tx.nodes.insert(createParagraph(), { at: [1] })
      }

      if (enforceTitle) {
        tx.nodes.set(setType('title'), { at: [0] })
      }

      if (enforceParagraph) {
        tx.nodes.set(setType('paragraph'), { at: [1] })
      }
    })
  } finally {
    ENFORCING_LAYOUT.delete(editor)
  }
}

const layout = () =>
  defineEditorExtension<CustomEditor>()({
    name: 'forced-layout',
    register({ editor }) {
      enforceLayout(editor)

      return {
        commitListeners: [() => enforceLayout(editor)],
      }
    },
  })

const ForcedLayoutExample = () => {
  const editor = useSlateEditor({
    extensions: [layout()],
    initialValue: [
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
    ],
  })
  return (
    <Slate editor={editor}>
      <Editable
        autoFocus
        placeholder="Enter a title…"
        renderElement={Element}
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

export default ForcedLayoutExample
