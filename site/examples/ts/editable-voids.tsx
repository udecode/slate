import { css } from '@emotion/css'
import type React from 'react'
import { type PointerEvent, useState } from 'react'
import { defineEditorExtension } from 'slate'
import { history } from 'slate-history'
import {
  Editable,
  type RenderElementProps,
  Slate,
  useEditor,
  useSlateEditor,
} from 'slate-react'

import { Button, Icon, Toolbar } from './components'
import type { CustomEditor, EditableVoidElement } from './custom-types.d'
import RichTextEditor from './richtext'

const EditableVoidsExample = () => {
  const editor = useSlateEditor({
    extensions: [history(), editableVoid()],
    initialValue: [
      {
        type: 'paragraph',
        children: [
          {
            text: 'In addition to nodes that contain editable text, you can insert void nodes, which can also contain editable elements, inputs, or an entire other Slate editor.',
          },
        ],
      },
      {
        type: 'editable-void',
        children: [{ text: '' }],
      },
      {
        type: 'paragraph',
        children: [
          {
            text: '',
          },
        ],
      },
    ],
  })

  return (
    <Slate editor={editor}>
      <Toolbar>
        <InsertEditableVoidButton />
      </Toolbar>

      <Editable
        placeholder="Enter some text..."
        renderElement={Element}
        renderVoid={() => <EditableVoid />}
      />
    </Slate>
  )
}

const editableVoid = () =>
  defineEditorExtension({
    name: 'editable-voids',
    elements: [{ type: 'editable-void', void: 'editable-island' }],
  })

const insertEditableVoid = (editor: CustomEditor) => {
  const text = { text: '' }
  const voidNode: EditableVoidElement = {
    type: 'editable-void',
    children: [text],
  }
  editor.update((tx) => {
    tx.nodes.insert(voidNode)
  })
}

const Element = (props: RenderElementProps) => {
  const { attributes, children } = props

  return <p {...attributes}>{children}</p>
}

const unsetWidthStyle = css`
  width: unset;
`

const EditableVoid = () => {
  const [inputValue, setInputValue] = useState('')

  return (
    <div
      className={css`
        box-shadow: 0 0 0 3px #ddd;
        padding: 8px;
      `}
    >
      <h4>Name:</h4>
      <input
        className={css`
          margin: 8px 0;
        `}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
          setInputValue(e.target.value)
        }}
        type="text"
        value={inputValue}
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
      <div
        className={css`
          padding: 20px;
          border: 2px solid #ddd;
        `}
      >
        <RichTextEditor />
      </div>
    </div>
  )
}

const InsertEditableVoidButton = () => {
  const editor = useEditor<CustomEditor>()
  return (
    <Button
      onClick={() => insertEditableVoid(editor)}
      onPointerDown={(event: PointerEvent<HTMLButtonElement>) => {
        event.preventDefault()
      }}
    >
      <Icon>add</Icon>
    </Button>
  )
}

export default EditableVoidsExample
