import {
  createEditor,
  defineEditorExtension,
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

const editor = createEditor<CustomValue>()

const extension = defineEditorExtension<typeof editor>({
  name: 'generic-extension',
  operationMiddlewares: [
    (context, next) => {
      const operation: Operation<CustomValue> = context.operation
      const value: ValueOf<typeof context.editor> = context.editor.getChildren()

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

editor.extend(extension)
