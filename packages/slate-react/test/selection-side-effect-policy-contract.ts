import { type EditorUpdateOptions } from 'slate'
import { Editor } from 'slate/internal'

import { createEditableInputController } from '../src/editable/input-state'
import { applyEditableRepairRequest } from '../src/editable/mutation-controller'
import {
  shouldSkipSelectionFocus,
  shouldSkipSelectionScroll,
} from '../src/editable/selection-side-effect-policy'
import { ReactEditor } from '../src/plugin/react-editor'
import { createReactEditor } from '../src/plugin/with-react'

const remoteSelectionOptions = {
  metadata: {
    collab: { origin: 'remote', saveToHistory: false },
    history: { mode: 'skip' },
    selection: { dom: 'preserve', focus: false, scroll: false },
  },
  tag: ['collaboration', 'skip-scroll-into-view', 'skip-selection-focus'],
} satisfies EditorUpdateOptions

const createRemoteSelectionEditor = () => {
  const editor = createReactEditor()

  Editor.replace(editor, {
    children: [{ type: 'paragraph', children: [{ text: 'one' }] }],
    selection: {
      anchor: { path: [0, 0], offset: 3 },
      focus: { path: [0, 0], offset: 3 },
    },
  })

  editor.update((tx) => {
    tx.selection.set({
      anchor: { path: [0, 0], offset: 1 },
      focus: { path: [0, 0], offset: 1 },
    })
  }, remoteSelectionOptions)

  return editor
}

test('remote collaboration selection metadata skips scroll and focus side effects', () => {
  const editor = createRemoteSelectionEditor()

  expect(shouldSkipSelectionScroll(editor)).toBe(true)
  expect(shouldSkipSelectionFocus(editor)).toBe(true)
})

test('remote collaboration selection metadata suppresses repair focus without skipping selection sync', () => {
  const editor = createRemoteSelectionEditor()
  const originalFocus = ReactEditor.focus
  const inputController = createEditableInputController({
    preferModelSelectionForInputRef: { current: true },
    state: {
      activeIntent: null,
      isComposing: false,
      isDraggingInternally: false,
      isUpdatingSelection: false,
      latestElement: null,
      pendingDOMSelectionImport: false,
      selectionChangeOrigin: null,
      selectionSource: 'model-owned',
    },
  })
  let focusCalls = 0
  let syncCalls = 0

  ReactEditor.focus = () => {
    focusCalls += 1
  }

  try {
    applyEditableRepairRequest({
      domRepairQueue: {
        beginFrame() {},
        cancelBefore() {},
        repair() {},
        repairCaretAfterModelOperation() {},
        repairCaretAfterModelTextInsert() {},
        repairDOMInput() {},
      },
      editor,
      forceRender() {},
      inputController,
      request: { focus: true, kind: 'sync-selection' },
      syncDOMSelectionToEditor() {
        syncCalls += 1
      },
    })
  } finally {
    ReactEditor.focus = originalFocus
  }

  expect(focusCalls).toBe(0)
  expect(syncCalls).toBe(1)
})
