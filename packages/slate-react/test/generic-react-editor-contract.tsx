import { createEditor, type Operation, type ValueOf } from 'slate'
import { type ReactEditor, useEditorSelector, withReact } from 'slate-react'

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

editor.extend({
  elements: [{ inline: true, type: 'link' }],
  name: 'generic-react-editor-contract',
})

type _Value = ValueOf<typeof reactEditor>

const value: _Value = [
  { type: 'paragraph', children: [{ text: 'one', bold: true }] },
]

const SelectorProbe = () => {
  const selected = useEditorSelector<number, typeof reactEditor>(
    (selectedEditor, operations) => {
      const valueFromSelector: CustomValue = selectedEditor.read((state) =>
        state.value.get()
      )
      const typedOperations: readonly Operation<CustomValue>[] | undefined =
        operations

      void valueFromSelector
      void typedOperations

      return valueFromSelector.length
    }
  )

  void selected

  return null
}

void value
void baseValue
void SelectorProbe
