import {
  createEditor,
  type InsertNodeOperation,
  type InsertTextOperation,
  Operation,
  type ReplaceChildrenOperation,
  type Operation as SlateOperation,
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

editor.update((tx) => {
  tx.value.replace({
    children: [{ type: 'paragraph', children: [{ text: '' }] }],
    selection: null,
    marks: null,
  })
})

const insertText: SlateOperation<CustomValue> = {
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

const unknownOperation: unknown = {
  type: 'insert_text',
  path: [0, 0],
  offset: 0,
  text: 'b',
}

if (Operation.isInsertTextOperation(unknownOperation)) {
  const narrowed: InsertTextOperation = unknownOperation
  void narrowed.text
}

const unknownReplaceChildren: unknown = {
  type: 'replace_children',
  path: [],
  index: 0,
  children: [],
  newChildren: [{ type: 'paragraph', children: [{ text: 'next' }] }],
  selection: null,
  newSelection: null,
}

if (Operation.isReplaceChildrenOperation<CustomValue>(unknownReplaceChildren)) {
  const narrowed: ReplaceChildrenOperation<CustomValue> = unknownReplaceChildren
  void narrowed.newChildren[0]?.children
}

editor.update((tx) => {
  tx.operations.replay([insertText, insertNode])
})

if (!('children' in insertNode.node)) {
  throw new Error('Expected inserted node to be an element')
}

const text: TextOf<typeof editor> = insertNode.node.children[0]

void text
