import {
  createEditor,
  type ElementOf,
  type Operation,
  type ValueOf,
} from 'slate'
import { type ReactEditor, useSlateSelector, withReact } from 'slate-react'

type CustomText = {
  text: string
  bold?: true
}

type ParagraphElement = {
  type: 'paragraph'
  children: CustomText[]
}

type LinkElement = {
  type: 'link'
  url: string
  children: CustomText[]
}

type CustomValue = (ParagraphElement | LinkElement)[]

const baseEditor = createEditor<CustomValue>()
const editor = withReact(baseEditor)
const reactEditor: ReactEditor<CustomValue> = editor

const baseValue: ValueOf<typeof baseEditor> = [
  { type: 'paragraph', children: [{ text: 'one', bold: true }] },
]

editor.isInline = (element: ElementOf<typeof editor>) => element.type === 'link'

type _Value = ValueOf<typeof reactEditor>

const value: _Value = [
  { type: 'paragraph', children: [{ text: 'one', bold: true }] },
]
const selected = useSlateSelector<number, typeof reactEditor>(
  (selectedEditor, operations) => {
    const valueFromSelector: CustomValue = selectedEditor.getChildren()
    const typedOperations: readonly Operation<CustomValue>[] | undefined =
      operations

    void valueFromSelector
    void typedOperations

    return selectedEditor.getChildren().length
  }
)

void value
void baseValue
void selected
