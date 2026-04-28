import {
  createEditor,
  Editor,
  type InsertNodeOperation,
  type Operation,
  type TextOf,
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

Editor.replace(editor, {
  children: [{ type: 'paragraph', children: [{ text: '' }] }],
  selection: null,
  marks: null,
})

const insertText: Operation<CustomValue> = {
  type: 'insert_text',
  path: [0, 0],
  offset: 0,
  text: 'a',
}

const insertNode: InsertNodeOperation<CustomValue> = {
  type: 'insert_node',
  path: [0],
  node: { type: 'paragraph', children: [{ text: 'a', bold: true }] },
}

editor.applyOperations([insertText, insertNode])

if (!('children' in insertNode.node)) {
  throw new Error('Expected inserted node to be an element')
}

const text: TextOf<typeof editor> = insertNode.node.children[0]

void text
