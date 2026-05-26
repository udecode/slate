import { css } from '@emotion/css'
import type { PointerEvent } from 'react'
import { defineEditorExtension } from 'slate'
import {
  Editable,
  type RenderElementProps,
  type RenderLeafProps,
  type RenderVoidProps,
  Slate,
  useEditor,
  useSlateChildRoot,
  useSlateContentRoot,
  useSlateEditor,
  useSlateRootChrome,
} from 'slate-react'

import { Button, Icon, Toolbar } from './components'
import type {
  BlockQuoteElement,
  CustomEditor,
  CustomElement,
  CustomText,
  CustomValue,
  EditableSectionElement,
  EditableVoidElement,
  ParagraphElement as ParagraphElementType,
} from './custom-types.d'

let editableVoidId = 0
let editableSectionId = 0

const paragraph = (text: string): ParagraphElementType => ({
  type: 'paragraph',
  children: [{ text }],
})

const nextEditableVoidRoot = () => {
  editableVoidId += 1

  return `editable-void:${editableVoidId}:body`
}

const nextEditableSectionRoot = () => {
  editableSectionId += 1

  return `editable-section:${editableSectionId}:body`
}

const createEditableVoid = (bodyRoot: string): EditableVoidElement => ({
  type: 'editable-void',
  childRoots: { body: bodyRoot },
  children: [{ text: '' }],
})

const createEditableSection = (bodyRoot: string): EditableSectionElement => ({
  type: 'editable-section',
  childRoots: { body: bodyRoot },
  children: [{ text: '' }],
})

const createEditableVoidBody = (): CustomValue => [
  {
    type: 'paragraph',
    children: [
      { text: 'This is editable ' },
      { text: 'rich', bold: true },
      { text: ' text, much better than a ' },
      { text: '<textarea>', code: true },
      { text: '!' },
    ],
  },
  paragraph(
    "Since it's rich text, it can live in a same-runtime child root instead of a nested independent editor."
  ),
  {
    type: 'block-quote',
    children: [{ text: 'A wise quote.' }],
  },
]

const createEmptyEditableVoidBody = (): CustomValue => [paragraph('')]
const createEditableSectionBody = (): CustomValue => [
  paragraph('This editor-only root behaves like document flow.'),
  paragraph('Arrow keys cross its root boundary like sibling blocks.'),
]
const createEmptyEditableSectionBody = (): CustomValue => [paragraph('')]

const EditableVoidsExample = () => {
  const editor = useSlateEditor({
    extensions: [editableVoid()],
    initialValue: {
      roots: {
        'editable-section:initial:body': createEditableSectionBody(),
        'editable-void:initial:body': createEditableVoidBody(),
        main: [
          {
            type: 'paragraph',
            children: [
              {
                text: 'In addition to nodes that contain editable text, you can insert void nodes, which can also contain editable elements, inputs, or rich same-runtime child roots.',
              },
            ],
          },
          createEditableSection('editable-section:initial:body'),
          paragraph('Back in the main root after the editor-only section.'),
          createEditableVoid('editable-void:initial:body'),
          {
            type: 'paragraph',
            children: [
              {
                text: '',
              },
            ],
          },
        ],
      },
    },
  })

  return (
    <Slate editor={editor}>
      <Toolbar>
        <InsertEditableSectionButton />
        <InsertEditableVoidButton />
      </Toolbar>

      <Editable
        placeholder="Enter some text..."
        renderElement={renderElement}
        renderLeaf={renderLeaf}
        renderVoid={renderVoid}
      />
    </Slate>
  )
}

const editableVoid = () =>
  defineEditorExtension({
    name: 'editable-voids',
    elements: [
      {
        type: 'editable-section',
        contentRoot: { slot: 'body' },
        void: 'editable-island',
      },
      {
        type: 'editable-void',
        contentRoot: { slot: 'body' },
        void: 'editable-island',
      },
    ],
  })

const renderElement = (props: RenderElementProps<CustomElement>) => {
  switch (props.element.type) {
    case 'block-quote':
      return (
        <BlockQuote {...(props as RenderElementProps<BlockQuoteElement>)} />
      )
    case 'paragraph':
      return (
        <ParagraphElement
          {...(props as RenderElementProps<ParagraphElementType>)}
        />
      )
    default:
      return <p {...props.attributes}>{props.children}</p>
  }
}

const renderVoid = (props: RenderVoidProps<CustomElement>) => {
  switch (props.element.type) {
    case 'editable-section':
      return (
        <EditableSection element={props.element as EditableSectionElement} />
      )
    case 'editable-void':
      return <EditableVoid element={props.element} />
    default:
      return null
  }
}

const renderLeaf = (props: RenderLeafProps<CustomText>) => <Leaf {...props} />

const Leaf = ({ attributes, children, leaf }: RenderLeafProps<CustomText>) => {
  if (leaf.bold) {
    children = <strong>{children}</strong>
  }

  if (leaf.code) {
    children = <code>{children}</code>
  }

  return <span {...attributes}>{children}</span>
}

const BlockQuote = ({
  attributes,
  children,
}: RenderElementProps<BlockQuoteElement>) => (
  <blockquote {...attributes}>{children}</blockquote>
)

const ParagraphElement = ({
  attributes,
  children,
}: RenderElementProps<ParagraphElementType>) => (
  <p {...attributes}>{children}</p>
)

const unsetWidthStyle = css`
  width: unset;
`

const childEditorCss = css`
  min-height: 76px;
  padding: 12px;
  border: 2px solid #ddd;
`

const editorOnlyRootCss = css`
  margin: 12px 0;
  border: 2px solid #555;
`

const EditableSection = ({ element }: { element: EditableSectionElement }) => {
  const { chrome, root } = useSlateContentRoot(element)

  return (
    <div {...chrome.props} className={editorOnlyRootCss}>
      <Editable
        aria-label="Editor-only content root"
        className={childEditorCss}
        renderElement={renderElement}
        renderLeaf={renderLeaf}
        root={root}
      />
    </div>
  )
}

const EditableVoid = ({ element }: { element: EditableVoidElement }) => {
  const bodyRoot = useSlateChildRoot(element, 'body')
  const chrome = useSlateRootChrome(bodyRoot)

  return (
    <div
      className={css`
        box-shadow: 0 0 0 3px #ddd;
        padding: 8px;
      `}
    >
      <div contentEditable={false}>
        <h4>Name:</h4>
        <input
          className={css`
            margin: 8px 0;
          `}
          type="text"
        />
        <h4>Left or right handed:</h4>
        <input
          className={unsetWidthStyle}
          name="handedness"
          type="radio"
          value="left"
        />{' '}
        Left
        <br />
        <input
          className={unsetWidthStyle}
          name="handedness"
          type="radio"
          value="right"
        />{' '}
        Right
        <h4>Tell us about yourself:</h4>
      </div>
      <div {...chrome.props}>
        <Editable
          aria-label="Editable void rich content"
          className={childEditorCss}
          placeholder="Tell us about yourself..."
          renderElement={renderElement}
          renderLeaf={renderLeaf}
          root={bodyRoot}
        />
      </div>
    </div>
  )
}

const InsertEditableSectionButton = () => {
  const editor = useEditor<CustomEditor>()
  return (
    <Button
      onClick={() => {
        const bodyRoot = nextEditableSectionRoot()

        editor.update((tx) => {
          tx.roots.create(bodyRoot, createEmptyEditableSectionBody())
          tx.nodes.insert(createEditableSection(bodyRoot))
        })
      }}
      onPointerDown={(event: PointerEvent<HTMLButtonElement>) => {
        event.preventDefault()
      }}
    >
      <Icon>subject</Icon>
    </Button>
  )
}

const InsertEditableVoidButton = () => {
  const editor = useEditor<CustomEditor>()
  return (
    <Button
      onClick={() => {
        const bodyRoot = nextEditableVoidRoot()

        editor.update((tx) => {
          tx.roots.create(bodyRoot, createEmptyEditableVoidBody())
          tx.nodes.insert(createEditableVoid(bodyRoot))
        })
      }}
      onPointerDown={(event: PointerEvent<HTMLButtonElement>) => {
        event.preventDefault()
      }}
    >
      <Icon>add</Icon>
    </Button>
  )
}

export default EditableVoidsExample
