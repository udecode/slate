import type { ClipboardEvent, DragEvent } from 'react'
import { createEditor, type Descendant } from 'slate'
import { Editor } from 'slate/internal'
import {
  EDITOR_TO_ELEMENT,
  EDITOR_TO_WINDOW,
  ELEMENT_TO_NODE,
  NODE_TO_ELEMENT,
} from 'slate-dom'
import { DOMCoverage } from 'slate-dom/internal'

import { withReact } from '../src'
import {
  applyEditableCopy,
  applyEditableDragStart,
  applyEditablePaste,
} from '../src/editable/clipboard-input-strategy'
import type { ReactEditor } from '../src/plugin/react-editor'

class FakeDataTransfer {
  private readonly data = new Map<string, string>()

  get types() {
    return Array.from(this.data.keys())
  }

  getData(type: string) {
    return this.data.get(type) ?? ''
  }

  setData(type: string, value: string) {
    this.data.set(type, value)
  }
}

const createChildren = (): Descendant[] => [
  {
    type: 'section',
    children: [
      {
        type: 'summary',
        children: [{ text: 'Summary' }],
      },
      {
        type: 'paragraph',
        children: [{ text: 'Hidden alpha' }],
      },
    ],
  },
  {
    type: 'paragraph',
    children: [{ text: 'Visible beta' }],
  },
]

const getRuntimeId = (editor: ReactEditor, path: number[]) => {
  const runtimeId = Editor.getRuntimeId(editor, path)

  if (!runtimeId) {
    throw new Error(`Missing runtime id at ${path.join('.')}`)
  }

  return runtimeId
}

const mountEditorRoot = (editor: ReactEditor) => {
  const root = document.createElement('div')

  root.setAttribute('contenteditable', 'true')
  root.setAttribute('data-slate-editor', 'true')
  Object.defineProperty(root, 'isContentEditable', {
    configurable: true,
    value: true,
  })
  document.body.append(root)

  EDITOR_TO_ELEMENT.set(editor, root)
  EDITOR_TO_WINDOW.set(editor, window)
  ELEMENT_TO_NODE.set(root, editor)
  NODE_TO_ELEMENT.set(editor, root)

  return root
}

const mountVisibleDragTarget = (root: HTMLElement) => {
  const target = document.createElement('p')

  target.setAttribute('data-slate-node', 'element')
  target.setAttribute('data-slate-path', '1')
  root.append(target)

  return target
}

const createHiddenSelectionEditor = () => {
  const editor = withReact(createEditor())

  Editor.replace(editor, {
    children: createChildren(),
    selection: {
      anchor: { offset: 0, path: [0, 1, 0] },
      focus: { offset: 'Hidden alpha'.length, path: [0, 1, 0] },
    },
  })

  DOMCoverage.registerBoundary(editor, {
    anchor: { runtimeId: getRuntimeId(editor, [0, 0]), type: 'summary-slot' },
    boundaryId: 'section-body',
    copyPolicy: 'include-model',
    coveredPathRanges: [{ anchor: [0, 1], focus: [0, 1] }],
    coveredRuntimeRanges: [
      {
        anchor: getRuntimeId(editor, [0, 1]),
        focus: getRuntimeId(editor, [0, 1]),
      },
    ],
    findPolicy: 'not-native-until-mounted',
    ownerPath: [0],
    ownerRuntimeId: getRuntimeId(editor, [0]),
    reason: 'app-collapse',
    selectionPolicy: 'boundary',
    state: 'intentionally-hidden',
    version: 1,
  })

  return editor
}

const cleanupEditorRoot = (editor: ReactEditor, root: HTMLElement) => {
  DOMCoverage.clear(editor)
  EDITOR_TO_ELEMENT.delete(editor)
  EDITOR_TO_WINDOW.delete(editor)
  ELEMENT_TO_NODE.delete(root)
  NODE_TO_ELEMENT.delete(editor)
  root.remove()
}

const createClipboardEvent = (
  target: EventTarget,
  clipboardData: FakeDataTransfer
) =>
  ({
    clipboardData,
    nativeEvent: { clipboardData },
    preventDefault: jest.fn(),
    target,
  }) as unknown as ClipboardEvent<HTMLDivElement>

const createDragEvent = (target: EventTarget, dataTransfer: FakeDataTransfer) =>
  ({
    dataTransfer,
    preventDefault: jest.fn(),
    target,
  }) as unknown as DragEvent<HTMLDivElement>

describe('DOM coverage native bridge', () => {
  test('copy writes model-backed data when native selection crosses hidden content', () => {
    const editor = createHiddenSelectionEditor()
    const root = mountEditorRoot(editor)
    const clipboard = new FakeDataTransfer()
    const staleDom = document.createElement('span')

    staleDom.textContent = 'STALE HIDDEN DOM'
    document.body.append(staleDom)

    try {
      applyEditableCopy({
        editor,
        event: createClipboardEvent(root, clipboard),
      })

      expect(clipboard.getData('text/plain')).toBe('Hidden alpha')
      expect(clipboard.getData('text/html')).toContain('Hidden alpha')
      expect(clipboard.getData('text/html')).not.toContain('STALE')
      expect(clipboard.getData('application/x-slate-fragment')).not.toBe('')
    } finally {
      staleDom.remove()
      cleanupEditorRoot(editor, root)
    }
  })

  test('paste over a hidden native selection mutates the model without stale DOM', () => {
    const editor = createHiddenSelectionEditor()
    const root = mountEditorRoot(editor)
    const clipboard = new FakeDataTransfer()
    const staleDom = document.createElement('span')

    clipboard.setData('text/plain', 'Pasted alpha')
    staleDom.textContent = 'STALE HIDDEN DOM'
    document.body.append(staleDom)

    try {
      const result = applyEditablePaste({
        editor,
        event: createClipboardEvent(root, clipboard),
        readOnly: false,
        shellBackedSelection: false,
      })

      expect(result.command).toMatchObject({ kind: 'insert-data' })
      expect(Editor.string(editor, [0, 1])).toBe('Pasted alpha')
      expect(staleDom.textContent).toBe('STALE HIDDEN DOM')
    } finally {
      staleDom.remove()
      cleanupEditorRoot(editor, root)
    }
  })

  test('drag start serializes hidden-range selections through the model-backed clipboard path', () => {
    const editor = createHiddenSelectionEditor()
    const root = mountEditorRoot(editor)
    const target = mountVisibleDragTarget(root)
    const dataTransfer = new FakeDataTransfer()
    const state = { isDraggingInternally: false }

    try {
      applyEditableDragStart({
        editor,
        event: createDragEvent(target, dataTransfer),
        readOnly: false,
        state,
      })

      expect(state.isDraggingInternally).toBe(true)
      expect(dataTransfer.getData('text/plain')).toBe('Hidden alpha')
      expect(dataTransfer.getData('text/html')).toContain('Hidden alpha')
    } finally {
      cleanupEditorRoot(editor, root)
    }
  })
})
