import { history } from 'slate-history'

import {
  attachSlateBrowserHandle,
  type SlateBrowserHandleElement,
} from '../src/editable/browser-handle'
import {
  createEditableInputController,
  createEditableInputControllerState,
} from '../src/editable/input-controller'
import { createReactEditor } from '../src/plugin/with-react'

const createInputController = () =>
  createEditableInputController({
    preferModelSelectionForInputRef: { current: false },
    state: createEditableInputControllerState(),
  })

test('browser handle undo and redo no-op when history is disabled', () => {
  const editor = createReactEditor({
    extensions: [history({ enabled: false })],
  })
  const element = document.createElement('div') as SlateBrowserHandleElement
  const forceRender = vi.fn()

  attachSlateBrowserHandle({
    browserHandleNextId: { current: 0 },
    browserHandleRangeRefs: { current: new Map() },
    editor,
    element,
    forceRender,
    inputController: createInputController(),
    isPartialDOMBackedSelection: () => false,
    setExplicitPartialDOMBackedSelection: vi.fn(),
  })

  expect(() => element.__slateBrowserHandle?.undo()).not.toThrow()
  expect(() => element.__slateBrowserHandle?.redo()).not.toThrow()
  expect(forceRender).not.toHaveBeenCalled()
})

test('browser handle selectAll selects the whole editor', () => {
  const editor = createReactEditor({
    initialValue: [
      { type: 'paragraph', children: [{ text: 'one' }] },
      { type: 'paragraph', children: [{ text: 'two' }] },
    ],
  })
  const element = document.createElement('div') as SlateBrowserHandleElement

  attachSlateBrowserHandle({
    browserHandleNextId: { current: 0 },
    browserHandleRangeRefs: { current: new Map() },
    editor,
    element,
    forceRender: vi.fn(),
    inputController: createInputController(),
    isPartialDOMBackedSelection: () => false,
    setExplicitPartialDOMBackedSelection: vi.fn(),
  })

  element.__slateBrowserHandle?.selectAll()

  expect(element.__slateBrowserHandle?.getSelection()).toEqual({
    anchor: { offset: 0, path: [0, 0] },
    focus: { offset: 3, path: [1, 0] },
  })
})
