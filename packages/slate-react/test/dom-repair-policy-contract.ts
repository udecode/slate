import {
  EDITOR_TO_ELEMENT,
  EDITOR_TO_WINDOW,
  ELEMENT_TO_NODE,
  NODE_TO_ELEMENT,
} from 'slate-dom'
import { createReactEditor } from '../src'
import { createRestoreDomManager } from '../src/components/restore-dom/restore-dom-manager'
import {
  beginDOMRepairFrame,
  cancelDOMRepairBefore,
  createDOMRepairFrameState,
  isDOMRepairFrameCurrent,
} from '../src/editable/dom-repair-queue'
import { executeEditableRepairPolicy } from '../src/editable/mutation-controller'

const asNodeList = (nodes: Node[]) => nodes as unknown as NodeList

const createChildListMutation = ({
  addedNodes = [],
  nextSibling = null,
  removedNodes = [],
  target,
}: {
  addedNodes?: Node[]
  nextSibling?: Node | null
  removedNodes?: Node[]
  target: Node
}) =>
  ({
    addedNodes: asNodeList(addedNodes),
    attributeName: null,
    attributeNamespace: null,
    nextSibling,
    oldValue: null,
    previousSibling: null,
    removedNodes: asNodeList(removedNodes),
    target,
    type: 'childList',
  }) as MutationRecord

const createCharacterDataMutation = (target: Node) =>
  ({
    addedNodes: asNodeList([]),
    attributeName: null,
    attributeNamespace: null,
    nextSibling: null,
    oldValue: 'Hello',
    previousSibling: null,
    removedNodes: asNodeList([]),
    target,
    type: 'characterData',
  }) as MutationRecord

const markEditable = (element: HTMLElement) => {
  Object.defineProperty(element, 'isContentEditable', {
    configurable: true,
    value: true,
  })
}

const mountEditorRoot = (editor: ReturnType<typeof createReactEditor>) => {
  const root = document.createElement('div')

  root.setAttribute('contenteditable', 'true')
  root.setAttribute('data-slate-editor', 'true')
  markEditable(root)
  document.body.append(root)

  EDITOR_TO_ELEMENT.set(editor, root)
  EDITOR_TO_WINDOW.set(editor, window)
  ELEMENT_TO_NODE.set(root, editor)
  NODE_TO_ELEMENT.set(editor, root)

  return root
}

test('repair frame state rejects work scheduled by an older frame', () => {
  const state = createDOMRepairFrameState()

  beginDOMRepairFrame(state, 3)
  expect(isDOMRepairFrameCurrent(state, 3)).toBe(true)

  cancelDOMRepairBefore(state, 4)
  expect(isDOMRepairFrameCurrent(state, 3)).toBe(false)

  beginDOMRepairFrame(state, 4)
  expect(isDOMRepairFrameCurrent(state, 4)).toBe(true)
})

test('restore manager rolls back structural DOM mutations and leaves text sync mutations', () => {
  const editor = createReactEditor()
  const root = mountEditorRoot(editor)
  const paragraph = document.createElement('p')
  const textWrapper = document.createElement('span')
  const text = document.createTextNode('Hello')
  const rogue = document.createElement('span')

  markEditable(paragraph)
  markEditable(textWrapper)
  textWrapper.append(text)
  paragraph.append(textWrapper)
  root.append(paragraph)

  const manager = createRestoreDomManager(editor, { current: true })

  paragraph.remove()
  rogue.textContent = 'rogue'
  root.append(rogue)
  text.nodeValue = 'Bonjour'

  manager.registerMutations([
    createChildListMutation({
      removedNodes: [paragraph],
      target: root,
    }),
    createChildListMutation({
      addedNodes: [rogue],
      target: root,
    }),
    createCharacterDataMutation(text),
  ])
  manager.restoreDOM()

  expect(root.firstChild).toBe(paragraph)
  expect(root.contains(rogue)).toBe(false)
  expect(text.nodeValue).toBe('Bonjour')

  root.remove()
})

test('repair execution is skipped for none policy', () => {
  let calls = 0

  expect(
    executeEditableRepairPolicy({
      repair: () => {
        calls++
      },
      repairPolicy: { kind: 'none', reason: 'not-requested' },
    })
  ).toBe(false)
  expect(calls).toBe(0)
})

test('repair execution runs for explicit repair policy', () => {
  let calls = 0

  expect(
    executeEditableRepairPolicy({
      repair: () => {
        calls++
      },
      repairPolicy: { kind: 'repair-caret', reason: 'repair-caret' },
    })
  ).toBe(true)
  expect(calls).toBe(1)
})
