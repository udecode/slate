import { Editor } from 'slate/internal'
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
  createDOMRepairQueue,
  isDOMRepairFrameCurrent,
} from '../src/editable/dom-repair-queue'
import { createEditableInputControllerState } from '../src/editable/input-state'
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

test('stale repair frames cannot replace the active frame', () => {
  const state = createDOMRepairFrameState()

  beginDOMRepairFrame(state, 2)
  cancelDOMRepairBefore(state, 2)
  beginDOMRepairFrame(state, 1)

  expect(isDOMRepairFrameCurrent(state, 1)).toBe(false)
  expect(isDOMRepairFrameCurrent(state, 2)).toBe(true)
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

test('native input repair skips already synced local text inside partial DOM roots', () => {
  const editor = createReactEditor()
  const root = mountEditorRoot(editor)

  Editor.replace(editor, {
    children: [
      {
        type: 'paragraph',
        children: [{ text: 'alpha' }],
      },
      {
        type: 'paragraph',
        children: [{ text: 'beta' }],
      },
    ],
    selection: {
      anchor: { path: [1, 0], offset: 5 },
      focus: { path: [1, 0], offset: 5 },
    },
  })

  const textHost = document.createElement('span')
  const string = document.createElement('span')
  const text = document.createTextNode('betax')
  const range = document.createRange()
  const selection = window.getSelection()
  const queue = createDOMRepairQueue({
    editor,
    inputController: {
      preferModelSelectionForInputRef: { current: false },
      state: createEditableInputControllerState(),
    },
    scrollSelectionIntoView: () => {},
    syncDOMSelectionToEditor: () => {},
  })

  textHost.setAttribute('data-slate-node', 'text')
  textHost.setAttribute('data-slate-path', '1,0')
  string.setAttribute('data-slate-string', 'true')
  string.append(text)
  textHost.append(string)
  root.append(textHost)

  range.setStart(text, 5)
  range.collapse(true)
  selection?.removeAllRanges()
  selection?.addRange(range)

  queue.repairDOMInput({ data: 'x', inputType: 'insertText' }, root, 1)
  expect(editor.read((state) => state.text.string([1]))).toBe('betax')

  queue.repairDOMInput({ data: 'x', inputType: 'insertText' }, root, 2)
  expect(editor.read((state) => state.text.string([1]))).toBe('betax')

  root.remove()
})

test('native input repair imports a burst DOM text delta once', () => {
  const editor = createReactEditor()
  const root = mountEditorRoot(editor)
  const prefix = 'Release '
  const burstText = 'abcdefghijklmnop'
  const originalText = `${prefix}readiness memo`
  const domText = `${prefix}${burstText}readiness memo`

  Editor.replace(editor, {
    children: [
      {
        type: 'paragraph',
        children: [{ text: originalText }],
      },
    ],
    selection: {
      anchor: { path: [0, 0], offset: prefix.length },
      focus: { path: [0, 0], offset: prefix.length },
    },
  })

  const textHost = document.createElement('span')
  const string = document.createElement('span')
  const text = document.createTextNode(domText)
  const range = document.createRange()
  const selection = window.getSelection()
  const queue = createDOMRepairQueue({
    editor,
    inputController: {
      preferModelSelectionForInputRef: { current: false },
      state: createEditableInputControllerState(),
    },
    scrollSelectionIntoView: () => {},
    syncDOMSelectionToEditor: () => {},
  })

  textHost.setAttribute('data-slate-node', 'text')
  textHost.setAttribute('data-slate-path', '0,0')
  string.setAttribute('data-slate-string', 'true')
  string.append(text)
  textHost.append(string)
  root.append(textHost)

  range.setStart(text, prefix.length + burstText.length)
  range.collapse(true)
  selection?.removeAllRanges()
  selection?.addRange(range)

  queue.repairDOMInput({ data: 'p', inputType: 'insertText' }, root, 1)

  expect(editor.read((state) => state.text.string([0]))).toBe(domText)
  expect(editor.read((state) => state.selection.get())).toEqual({
    anchor: { path: [0, 0], offset: prefix.length + burstText.length },
    focus: { path: [0, 0], offset: prefix.length + burstText.length },
  })

  queue.repairDOMInput({ data: 'p', inputType: 'insertText' }, root, 2)

  expect(editor.read((state) => state.text.string([0]))).toBe(domText)

  root.remove()
})

test('native input repair reconciles captured burst targets against partially synced model text', () => {
  const editor = createReactEditor()
  const root = mountEditorRoot(editor)
  const prefix = 'This '
  const syncedPrefix = 'abc'
  const remainingText = 'def'
  const burstText = `${syncedPrefix}${remainingText}`
  const suffix = ' note'
  const partialModelText = `${prefix}${syncedPrefix}${suffix}`
  const domText = `${prefix}${burstText}${suffix}`
  const nextOffset = prefix.length + burstText.length

  Editor.replace(editor, {
    children: [
      {
        type: 'paragraph',
        children: [{ text: partialModelText }],
      },
    ],
    selection: {
      anchor: { path: [0, 0], offset: prefix.length + syncedPrefix.length },
      focus: { path: [0, 0], offset: prefix.length + syncedPrefix.length },
    },
  })

  const textHost = document.createElement('span')
  const string = document.createElement('span')
  const text = document.createTextNode(domText)
  const range = document.createRange()
  const selection = window.getSelection()
  const queue = createDOMRepairQueue({
    editor,
    inputController: {
      preferModelSelectionForInputRef: { current: false },
      state: createEditableInputControllerState(),
    },
    scrollSelectionIntoView: () => {},
    syncDOMSelectionToEditor: () => {},
  })

  textHost.setAttribute('data-slate-node', 'text')
  textHost.setAttribute('data-slate-path', '0,0')
  string.setAttribute('data-slate-string', 'true')
  string.append(text)
  textHost.append(string)
  root.append(textHost)

  range.setStart(text, nextOffset)
  range.collapse(true)
  selection?.removeAllRanges()
  selection?.addRange(range)

  queue.repairDOMInput(
    {
      data: remainingText.at(-1)!,
      inputType: 'insertText',
      target: {
        insert: { offset: prefix.length, text: burstText },
        path: [0, 0],
        selectionOffset: nextOffset,
        text: domText,
      },
    },
    root,
    1
  )

  expect(editor.read((state) => state.text.string([0]))).toBe(domText)
  expect(editor.read((state) => state.selection.get())).toEqual({
    anchor: { path: [0, 0], offset: nextOffset },
    focus: { path: [0, 0], offset: nextOffset },
  })

  root.remove()
})

test('native input repair moves model selection when the captured target still owns the DOM caret', () => {
  const editor = createReactEditor()
  const root = mountEditorRoot(editor)
  const prefix = 'Release '
  const burstText = 'abcdefghijklmnop'
  const originalText = `${prefix}readiness memo`
  const domText = `${prefix}${burstText}readiness memo`
  const nextOffset = prefix.length + burstText.length

  Editor.replace(editor, {
    children: [
      {
        type: 'paragraph',
        children: [{ text: originalText }],
      },
    ],
    selection: {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    },
  })

  const textHost = document.createElement('span')
  const string = document.createElement('span')
  const text = document.createTextNode(domText)
  const range = document.createRange()
  const selection = window.getSelection()
  const queue = createDOMRepairQueue({
    editor,
    inputController: {
      preferModelSelectionForInputRef: { current: false },
      state: createEditableInputControllerState(),
    },
    scrollSelectionIntoView: () => {},
    syncDOMSelectionToEditor: () => {},
  })

  textHost.setAttribute('data-slate-node', 'text')
  textHost.setAttribute('data-slate-path', '0,0')
  string.setAttribute('data-slate-string', 'true')
  string.append(text)
  textHost.append(string)
  root.append(textHost)

  range.setStart(text, nextOffset)
  range.collapse(true)
  selection?.removeAllRanges()
  selection?.addRange(range)

  queue.repairDOMInput(
    {
      data: burstText.at(-1)!,
      inputType: 'insertText',
      target: {
        path: [0, 0],
        selectionOffset: nextOffset,
        text: domText,
      },
    },
    root,
    1
  )

  expect(editor.read((state) => state.text.string([0]))).toBe(domText)
  expect(editor.read((state) => state.selection.get())).toEqual({
    anchor: { path: [0, 0], offset: nextOffset },
    focus: { path: [0, 0], offset: nextOffset },
  })

  root.remove()
})

test('native input repair guards virtualized DOM replacement selectionchanges', () => {
  vi.useFakeTimers()

  try {
    const editor = createReactEditor()
    const root = mountEditorRoot(editor)
    const inputController = {
      preferModelSelectionForInputRef: { current: false },
      state: createEditableInputControllerState(),
    }

    Editor.replace(editor, {
      children: [
        {
          type: 'paragraph',
          children: [{ text: 'abc' }],
        },
      ],
      selection: {
        anchor: { path: [0, 0], offset: 1 },
        focus: { path: [0, 0], offset: 1 },
      },
    })

    const textHost = document.createElement('span')
    const string = document.createElement('span')
    const text = document.createTextNode('aXbc')
    const range = document.createRange()
    const selection = window.getSelection()
    const queue = createDOMRepairQueue({
      editor,
      inputController,
      scrollSelectionIntoView: () => {},
      syncDOMSelectionToEditor: () => {},
    })

    textHost.setAttribute('data-slate-node', 'text')
    textHost.setAttribute('data-slate-path', '0,0')
    string.setAttribute('data-slate-string', 'true')
    string.append(text)
    textHost.append(string)
    root.append(textHost)

    range.setStart(text, 2)
    range.collapse(true)
    selection?.removeAllRanges()
    selection?.addRange(range)

    queue.repairDOMInput({ data: 'X', inputType: 'insertText' }, root, 1)

    expect(editor.read((state) => state.text.string([0]))).toBe('aXbc')
    expect(editor.read((state) => state.selection.get())).toEqual({
      anchor: { path: [0, 0], offset: 2 },
      focus: { path: [0, 0], offset: 2 },
    })
    expect(inputController.state.selectionChangeOrigin).toBe('repair-induced')

    vi.advanceTimersByTime(151)

    expect(inputController.state.selectionChangeOrigin).toBe(null)

    root.remove()
  } finally {
    vi.useRealTimers()
  }
})

test('native text repair keeps model authority inside virtualized pages', () => {
  const editor = createReactEditor()
  const root = mountEditorRoot(editor)
  const inputController = {
    preferModelSelectionForInputRef: { current: false },
    state: createEditableInputControllerState(),
  }

  Editor.replace(editor, {
    children: [
      {
        type: 'paragraph',
        children: [{ text: 'abc' }],
      },
    ],
    selection: {
      anchor: { path: [0, 0], offset: 1 },
      focus: { path: [0, 0], offset: 1 },
    },
  })

  const page = document.createElement('div')
  const textHost = document.createElement('span')
  const string = document.createElement('span')
  const text = document.createTextNode('aXbc')
  const range = document.createRange()
  const selection = window.getSelection()
  const queue = createDOMRepairQueue({
    editor,
    inputController,
    scrollSelectionIntoView: () => {},
    syncDOMSelectionToEditor: () => {},
  })

  page.setAttribute('data-slate-dom-strategy-virtual-row', 'true')
  textHost.setAttribute('data-slate-node', 'text')
  textHost.setAttribute('data-slate-path', '0,0')
  string.setAttribute('data-slate-string', 'true')
  string.append(text)
  textHost.append(string)
  page.append(textHost)
  root.append(page)

  range.setStart(text, 2)
  range.collapse(true)
  selection?.removeAllRanges()
  selection?.addRange(range)

  queue.repairDOMInput({ data: 'X', inputType: 'insertText' }, root, 1)

  expect(editor.read((state) => state.text.string([0]))).toBe('aXbc')
  expect(editor.read((state) => state.selection.get())).toEqual({
    anchor: { path: [0, 0], offset: 2 },
    focus: { path: [0, 0], offset: 2 },
  })
  expect(inputController.preferModelSelectionForInputRef.current).toBe(true)
  expect(inputController.state.selectionSource).toBe('model-owned')
  expect(inputController.state.modelOwnedTextInputGuard).toBeGreaterThan(0)

  root.remove()
})

test('native text repair keeps same virtualized target DOM-owned', () => {
  const editor = createReactEditor()
  const root = mountEditorRoot(editor)
  const inputController = {
    preferModelSelectionForInputRef: { current: true },
    state: createEditableInputControllerState(),
  }

  inputController.state.selectionSource = 'model-owned'

  Editor.replace(editor, {
    children: [
      {
        type: 'paragraph',
        children: [{ text: 'abc' }],
      },
    ],
    selection: {
      anchor: { path: [0, 0], offset: 1 },
      focus: { path: [0, 0], offset: 1 },
    },
  })

  const page = document.createElement('div')
  const textHost = document.createElement('span')
  const string = document.createElement('span')
  const text = document.createTextNode('aXbc')
  const range = document.createRange()
  const selection = window.getSelection()
  const setBaseAndExtentSpy = vi.spyOn(Selection.prototype, 'setBaseAndExtent')
  const queue = createDOMRepairQueue({
    editor,
    inputController,
    scrollSelectionIntoView: () => {},
    syncDOMSelectionToEditor: () => {},
  })

  page.setAttribute('data-slate-dom-strategy-virtual-row', 'true')
  textHost.setAttribute('data-slate-node', 'text')
  textHost.setAttribute('data-slate-path', '0,0')
  string.setAttribute('data-slate-string', 'true')
  string.append(text)
  textHost.append(string)
  page.append(textHost)
  root.append(page)

  range.setStart(text, 2)
  range.collapse(true)
  selection?.removeAllRanges()
  selection?.addRange(range)

  try {
    queue.repairDOMInput(
      {
        data: 'X',
        inputType: 'insertText',
        target: {
          insert: { offset: 1, text: 'X' },
          path: [0, 0],
          preferCapturedInsert: true,
          selectionOffset: 2,
          text: 'aXbc',
        },
      },
      root,
      1
    )

    expect(editor.read((state) => state.text.string([0]))).toBe('aXbc')
    expect(editor.read((state) => state.selection.get())).toEqual({
      anchor: { path: [0, 0], offset: 2 },
      focus: { path: [0, 0], offset: 2 },
    })
    expect(inputController.preferModelSelectionForInputRef.current).toBe(false)
    expect(inputController.state.selectionSource).toBe('dom-current')
    expect(inputController.state.modelOwnedTextInputGuard).toBe(0)
    expect(setBaseAndExtentSpy).not.toHaveBeenCalled()
  } finally {
    setBaseAndExtentSpy.mockRestore()
  }

  root.remove()
})

test('native input repair trusts captured coalesced inserts when projected DOM interleaves suffix text', () => {
  const editor = createReactEditor()
  const root = mountEditorRoot(editor)
  const originalText = 'This mixed'
  const domText = 'This qmrixed'
  const repairedText = 'This qrmixed'
  const nextOffset = 'This qr'.length

  Editor.replace(editor, {
    children: [
      {
        type: 'paragraph',
        children: [{ text: originalText }],
      },
    ],
    selection: {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    },
  })

  const textHost = document.createElement('span')
  const string = document.createElement('span')
  const text = document.createTextNode(domText)
  const range = document.createRange()
  const selection = window.getSelection()
  const queue = createDOMRepairQueue({
    editor,
    inputController: {
      preferModelSelectionForInputRef: { current: false },
      state: createEditableInputControllerState(),
    },
    scrollSelectionIntoView: () => {},
    syncDOMSelectionToEditor: () => {},
  })

  textHost.setAttribute('data-slate-node', 'text')
  textHost.setAttribute('data-slate-path', '0,0')
  string.setAttribute('data-slate-string', 'true')
  string.append(text)
  textHost.append(string)
  root.append(textHost)

  range.setStart(text, 'This qmr'.length)
  range.collapse(true)
  selection?.removeAllRanges()
  selection?.addRange(range)

  queue.repairDOMInput(
    {
      data: 'r',
      inputType: 'insertText',
      target: {
        insert: { offset: 'This '.length, text: 'qr' },
        path: [0, 0],
        preferCapturedInsert: true,
        selectionOffset: 'This qmr'.length,
        text: domText,
      },
    },
    root,
    1
  )

  expect(editor.read((state) => state.text.string([0]))).toBe(repairedText)
  expect(editor.read((state) => state.selection.get())).toEqual({
    anchor: { path: [0, 0], offset: nextOffset },
    focus: { path: [0, 0], offset: nextOffset },
  })

  root.remove()
})

test('native input repair rebases later captured same-path inserts against repaired model text', () => {
  const editor = createReactEditor()
  const root = mountEditorRoot(editor)
  const firstDOMText = 'Xabc'
  const finalDOMText = 'XabcY'

  Editor.replace(editor, {
    children: [
      {
        type: 'paragraph',
        children: [{ text: 'abc' }],
      },
    ],
    selection: {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    },
  })

  const textHost = document.createElement('span')
  const string = document.createElement('span')
  const text = document.createTextNode(finalDOMText)
  const range = document.createRange()
  const selection = window.getSelection()
  const queue = createDOMRepairQueue({
    editor,
    inputController: {
      preferModelSelectionForInputRef: { current: false },
      state: createEditableInputControllerState(),
    },
    scrollSelectionIntoView: () => {},
    syncDOMSelectionToEditor: () => {},
  })

  textHost.setAttribute('data-slate-node', 'text')
  textHost.setAttribute('data-slate-path', '0,0')
  string.setAttribute('data-slate-string', 'true')
  string.append(text)
  textHost.append(string)
  root.append(textHost)

  range.setStart(text, finalDOMText.length)
  range.collapse(true)
  selection?.removeAllRanges()
  selection?.addRange(range)

  queue.repairDOMInput(
    {
      data: 'X',
      inputType: 'insertText',
      target: {
        insert: { offset: 0, text: 'X' },
        path: [0, 0],
        selectionOffset: 1,
        text: firstDOMText,
      },
    },
    root,
    1
  )
  queue.repairDOMInput(
    {
      data: 'Y',
      inputType: 'insertText',
      target: {
        insert: { offset: 3, text: 'Y' },
        path: [0, 0],
        selectionOffset: finalDOMText.length,
        text: finalDOMText,
      },
    },
    root,
    2
  )

  expect(editor.read((state) => state.text.string([0]))).toBe(finalDOMText)
  expect(editor.read((state) => state.selection.get())).toEqual({
    anchor: { path: [0, 0], offset: finalDOMText.length },
    focus: { path: [0, 0], offset: finalDOMText.length },
  })

  root.remove()
})

test('native input repair does not repair the caret for stale captured targets', () => {
  const editor = createReactEditor()
  const root = mountEditorRoot(editor)
  const prefix = 'This '
  const capturedBurst = 'abc'
  const liveSuffix = 'def'
  const suffix = ' note'
  const originalText = `${prefix}${suffix}`
  const capturedText = `${prefix}${capturedBurst}${suffix}`
  const liveText = `${prefix}${capturedBurst}${liveSuffix}${suffix}`
  const capturedOffset = prefix.length + capturedBurst.length
  const liveOffset = prefix.length + capturedBurst.length + liveSuffix.length
  let scrollCalls = 0

  Editor.replace(editor, {
    children: [
      {
        type: 'paragraph',
        children: [{ text: originalText }],
      },
    ],
    selection: {
      anchor: { path: [0, 0], offset: prefix.length },
      focus: { path: [0, 0], offset: prefix.length },
    },
  })

  const textHost = document.createElement('span')
  const string = document.createElement('span')
  const text = document.createTextNode(liveText)
  const range = document.createRange()
  const selection = window.getSelection()
  const queue = createDOMRepairQueue({
    editor,
    inputController: {
      preferModelSelectionForInputRef: { current: false },
      state: createEditableInputControllerState(),
    },
    scrollSelectionIntoView: () => {
      scrollCalls++
    },
    syncDOMSelectionToEditor: () => {},
  })

  textHost.setAttribute('data-slate-node', 'text')
  textHost.setAttribute('data-slate-path', '0,0')
  string.setAttribute('data-slate-string', 'true')
  string.append(text)
  textHost.append(string)
  root.append(textHost)

  range.setStart(text, liveOffset)
  range.collapse(true)
  selection?.removeAllRanges()
  selection?.addRange(range)

  queue.repairDOMInput(
    {
      data: capturedBurst.at(-1)!,
      inputType: 'insertText',
      target: {
        insert: { offset: prefix.length, text: capturedBurst },
        path: [0, 0],
        selectionOffset: capturedOffset,
        text: capturedText,
      },
    },
    root,
    1
  )

  expect(editor.read((state) => state.text.string([0]))).toBe(capturedText)
  expect(scrollCalls).toBe(0)

  root.remove()
})

test('native input repair does not move selection for stale coalesced targets', () => {
  const editor = createReactEditor()
  const root = mountEditorRoot(editor)
  const prefix = 'This '
  const capturedBurst = 'abc'
  const suffix = ' note'
  const originalText = `${prefix}${suffix}`
  const capturedText = `${prefix}${capturedBurst}${suffix}`
  const clickedText = 'clicked'
  const capturedOffset = prefix.length + capturedBurst.length
  let scrollCalls = 0

  Editor.replace(editor, {
    children: [
      {
        type: 'paragraph',
        children: [{ text: originalText }],
      },
      {
        type: 'paragraph',
        children: [{ text: clickedText }],
      },
    ],
    selection: {
      anchor: { path: [1, 0], offset: 0 },
      focus: { path: [1, 0], offset: 0 },
    },
  })

  const targetTextHost = document.createElement('span')
  const targetString = document.createElement('span')
  const targetText = document.createTextNode(capturedText)
  const clickedTextHost = document.createElement('span')
  const clickedString = document.createElement('span')
  const clickedNode = document.createTextNode(clickedText)
  const range = document.createRange()
  const selection = window.getSelection()
  const queue = createDOMRepairQueue({
    editor,
    inputController: {
      preferModelSelectionForInputRef: { current: false },
      state: createEditableInputControllerState(),
    },
    scrollSelectionIntoView: () => {
      scrollCalls++
    },
    syncDOMSelectionToEditor: () => {},
  })

  targetTextHost.setAttribute('data-slate-node', 'text')
  targetTextHost.setAttribute('data-slate-path', '0,0')
  targetString.setAttribute('data-slate-string', 'true')
  targetString.append(targetText)
  targetTextHost.append(targetString)
  clickedTextHost.setAttribute('data-slate-node', 'text')
  clickedTextHost.setAttribute('data-slate-path', '1,0')
  clickedString.setAttribute('data-slate-string', 'true')
  clickedString.append(clickedNode)
  clickedTextHost.append(clickedString)
  root.append(targetTextHost, clickedTextHost)

  range.setStart(clickedNode, 0)
  range.collapse(true)
  selection?.removeAllRanges()
  selection?.addRange(range)

  queue.repairDOMInput(
    {
      data: capturedBurst.at(-1)!,
      inputType: 'insertText',
      target: {
        insert: { offset: prefix.length, text: capturedBurst },
        path: [0, 0],
        preferCapturedInsert: true,
        selectionOffset: capturedOffset,
        text: capturedText,
      },
    },
    root,
    1
  )

  expect(editor.read((state) => state.text.string([0]))).toBe(capturedText)
  expect(editor.read((state) => state.selection.get())).toEqual({
    anchor: { path: [1, 0], offset: 0 },
    focus: { path: [1, 0], offset: 0 },
  })
  expect(scrollCalls).toBe(0)

  root.remove()
})

test('native input repair replaces expanded model selections and collapses at the DOM caret', () => {
  const editor = createReactEditor()
  const root = mountEditorRoot(editor)
  const originalText = 'This is editable plain text'
  const replacementText = 'foo'

  Editor.replace(editor, {
    children: [
      {
        type: 'paragraph',
        children: [{ text: originalText }],
      },
    ],
    selection: {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: originalText.length },
    },
  })

  const textHost = document.createElement('span')
  const string = document.createElement('span')
  const text = document.createTextNode(replacementText)
  const range = document.createRange()
  const selection = window.getSelection()
  const queue = createDOMRepairQueue({
    editor,
    inputController: {
      preferModelSelectionForInputRef: { current: true },
      state: createEditableInputControllerState(),
    },
    scrollSelectionIntoView: () => {},
    syncDOMSelectionToEditor: () => {},
  })

  textHost.setAttribute('data-slate-node', 'text')
  textHost.setAttribute('data-slate-path', '0,0')
  string.setAttribute('data-slate-string', 'true')
  string.append(text)
  textHost.append(string)
  root.append(textHost)

  range.setStart(text, replacementText.length)
  range.collapse(true)
  selection?.removeAllRanges()
  selection?.addRange(range)

  queue.repairDOMInput({ data: replacementText, inputType: 'insertText' }, root)

  expect(editor.read((state) => state.text.string([0]))).toBe(replacementText)
  expect(editor.read((state) => state.selection.get())).toEqual({
    anchor: { path: [0, 0], offset: replacementText.length },
    focus: { path: [0, 0], offset: replacementText.length },
  })

  root.remove()
})

test('text insert caret repair waits until rendered text matches the model', () => {
  const editor = createReactEditor()
  const root = mountEditorRoot(editor)
  const inputController = {
    preferModelSelectionForInputRef: { current: true },
    state: createEditableInputControllerState(),
  }
  inputController.state.selectionSource = 'model-owned'
  const originalText = 'This is editable'
  const modelText = `C${originalText}`
  const textHost = document.createElement('span')
  const string = document.createElement('span')
  const text = document.createTextNode(originalText)
  const range = document.createRange()
  const selection = window.getSelection()
  const requestAnimationFrameSpy = vi
    .spyOn(window, 'requestAnimationFrame')
    .mockImplementation(() => 1)
  const setTimeoutSpy = vi
    .spyOn(window, 'setTimeout')
    .mockImplementation(() => 1)

  Editor.replace(editor, {
    children: [
      {
        type: 'paragraph',
        children: [{ text: modelText }],
      },
    ],
    selection: {
      anchor: { path: [0, 0], offset: 1 },
      focus: { path: [0, 0], offset: 1 },
    },
  })

  textHost.setAttribute('data-slate-node', 'text')
  textHost.setAttribute('data-slate-path', '0,0')
  string.setAttribute('data-slate-string', 'true')
  string.append(text)
  textHost.append(string)
  root.append(textHost)

  range.setStart(text, 0)
  range.collapse(true)
  selection?.removeAllRanges()
  selection?.addRange(range)

  const queue = createDOMRepairQueue({
    editor,
    inputController,
    scrollSelectionIntoView: () => {},
    syncDOMSelectionToEditor: () => {},
  })

  try {
    queue.repairCaretAfterModelTextInsert()

    expect(selection?.anchorOffset).toBe(0)
    expect(inputController.preferModelSelectionForInputRef.current).toBe(true)
    expect(inputController.state.selectionSource).toBe('model-owned')
  } finally {
    requestAnimationFrameSpy.mockRestore()
    setTimeoutSpy.mockRestore()
    root.remove()
  }
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
