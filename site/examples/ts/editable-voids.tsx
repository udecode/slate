import { css } from '@emotion/css'
import type React from 'react'
import { type PointerEvent, useMemo, useState } from 'react'
import { createEditor, defineEditorExtension } from 'slate'
import { withHistory } from 'slate-history'
import {
  Editable,
  type RenderElementProps,
  Slate,
  useSlateStatic,
  withReact,
} from 'slate-react'

import { Button, Icon, Toolbar } from './components'
import type {
  CustomEditor,
  CustomValue,
  EditableVoidElement,
} from './custom-types.d'
import RichTextEditor from './richtext'

const EditableVoidsExample = () => {
  const editor = useMemo(
    () =>
      withEditableVoids(withHistory(withReact(createEditor<CustomValue>()))),
    []
  )

  return (
    <Slate editor={editor} initialValue={initialValue}>
      <Toolbar>
        <InsertEditableVoidButton />
      </Toolbar>

      <Editable
        placeholder="Enter some text..."
        renderElement={(props: RenderElementProps) => <Element {...props} />}
        renderVoid={() => <EditableVoid />}
      />
    </Slate>
  )
}

const editableVoidsExtension = defineEditorExtension<CustomEditor>({
  name: 'editable-voids',
  methods(editor) {
    const nextIsVoid = editor.isVoid

    return {
      isVoid(element) {
        return element.type === 'editable-void' ? true : nextIsVoid(element)
      },
    }
  },
})

const withEditableVoids = (editor: CustomEditor) => {
  editor.extend(editableVoidsExtension)
  return editor
}

const insertEditableVoid = (editor: CustomEditor) => {
  const text = { text: '' }
  const voidNode: EditableVoidElement = {
    type: 'editable-void',
    children: [text],
  }
  editor.update(() => {
    editor.insertNodes(voidNode)
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
  const editor = useSlateStatic<CustomEditor>()
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

const initialValue: CustomValue = [
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
]

export default EditableVoidsExample
