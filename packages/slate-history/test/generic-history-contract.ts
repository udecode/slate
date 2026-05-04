import { createEditor, type Operation, type ValueOf } from 'slate'
import { type HistoryEditor, withHistory } from 'slate-history'

type CustomText = {
  text: string
  bold?: true
}

type ParagraphElement = {
  type: 'paragraph'
  children: CustomText[]
}

type CustomValue = ParagraphElement[]

const editor = withHistory(createEditor<CustomValue>())
const historyEditor: HistoryEditor<CustomValue> = editor

editor.update((tx) => {
  tx.text.insert('a')
})

const operation: Operation<ValueOf<typeof editor>> | undefined =
  editor.history.undos[0]?.operations[0]

void historyEditor
void operation
