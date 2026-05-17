import {
  defineEditorExtension,
  NodeApi,
  type Element as SlateElement,
} from 'slate'
import {
  Editable,
  editableRenderers,
  type RenderElementProps,
  Slate,
  useSlateEditor,
} from 'slate-react'
import type {
  CustomEditor,
  CustomElement,
  CustomElementType,
  ParagraphElement,
  TitleElement,
} from './custom-types.d'

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

const forcedLayout = () =>
  defineEditorExtension<CustomEditor>()({
    capabilities: editableRenderers<unknown, CustomElement>({
      elements: {
        paragraph: Paragraph,
        title: Title,
      },
    }),
    name: 'forced-layout',
    normalizers: {
      node({ entry, next, tx }) {
        const [node, path] = entry

        if (!NodeApi.isEditor(node) || path.length !== 0) {
          next()
          return
        }

        const children = tx.value.get()
        const first = children[0]
        const second = children[1]
        const firstText = first ? NodeApi.string(first) : ''

        if (children.length <= 1 && firstText === '') {
          tx.nodes.insert(createTitle(), {
            at: [0],
            select: true,
          })
          return
        }

        if (children.length < 2) {
          tx.nodes.insert(createParagraph(), { at: [1] })
          return
        }

        if (
          NodeApi.isElement(first) &&
          first.type !== ('title' satisfies CustomElementType)
        ) {
          tx.nodes.set(setType('title'), { at: [0] })
          return
        }

        if (
          NodeApi.isElement(second) &&
          second.type !== ('paragraph' satisfies CustomElementType)
        ) {
          tx.nodes.set(setType('paragraph'), { at: [1] })
          return
        }

        next()
      },
    },
  })

const ForcedLayoutExample = () => {
  const editor = useSlateEditor({
    extensions: [forcedLayout()],
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
      <Editable autoFocus placeholder="Enter a title…" spellCheck />
    </Slate>
  )
}

const Title = ({ attributes, children }: RenderElementProps<TitleElement>) => (
  <h2 {...attributes}>{children}</h2>
)

const Paragraph = ({
  attributes,
  children,
}: RenderElementProps<ParagraphElement>) => <p {...attributes}>{children}</p>

export default ForcedLayoutExample
