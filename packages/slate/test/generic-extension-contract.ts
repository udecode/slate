import {
  createEditor,
  defineEditorExtension,
  type Editor,
  type Operation,
  type ValueOf,
} from 'slate'

type CustomText = {
  text: string
  bold?: true
}

type ParagraphElement = {
  type: 'paragraph'
  children: CustomText[]
}

type CustomValue = ParagraphElement[]

type CustomEditor = Editor<CustomValue>

const initialValue: CustomValue = [
  { type: 'paragraph', children: [{ text: 'paragraph' }] },
]

const extension = defineEditorExtension<CustomEditor>()({
  name: 'generic-extension',
  operationMiddlewares: [
    (context, next) => {
      const operation: Operation<CustomValue> = context.operation
      const value: ValueOf<typeof context.editor> = context.editor.read(
        (state) => state.value.get()
      )

      next(operation)
      void value
    },
  ],
  commitListeners: [
    (commit, snapshot) => {
      const operation: Operation<CustomValue> | undefined = commit.operations[0]
      const children: CustomValue = snapshot.children

      void operation
      void children
    },
  ],
})

const editor = createEditor({ extensions: [extension], initialValue })
const value: CustomValue = editor.read((state) => state.value.get())

void value
