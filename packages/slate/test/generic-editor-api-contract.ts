import {
  createEditor,
  Editor,
  type EditorCommit,
  type EditorMarksOf,
  type ElementOf,
  type Operation,
  type TextOf,
} from 'slate'

type CustomText = {
  text: string
  bold?: true
  code?: true
}

type ParagraphElement = {
  type: 'paragraph'
  children: CustomText[]
}

type QuoteElement = {
  type: 'quote'
  children: CustomText[]
}

type CustomValue = (ParagraphElement | QuoteElement)[]

const editor = createEditor<CustomValue>()

editor.update(() => {
  editor.setNodes<ElementOf<typeof editor>>({ type: 'quote' })
  editor.addMark('bold' satisfies keyof EditorMarksOf<typeof editor>, true)
  editor.insertText('typed')
})

const leaf: TextOf<typeof editor> = { text: 'typed', bold: true }
const marks: EditorMarksOf<typeof editor> = { code: true }
const staticChildren: CustomValue = Editor.getChildren(editor)
const operations: readonly Operation<CustomValue>[] =
  Editor.getOperations(editor)
const commit: EditorCommit<CustomValue> | null = Editor.getLastCommit(editor)

Editor.reset(editor, { children: staticChildren, selection: null, marks })
Editor.setChildren(editor, staticChildren)

void leaf
void marks
void operations
void commit
