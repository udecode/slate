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
    isShellBackedSelection: () => false,
    setExplicitShellBackedSelection: vi.fn(),
  })

  expect(() => element.__slateBrowserHandle?.undo()).not.toThrow()
  expect(() => element.__slateBrowserHandle?.redo()).not.toThrow()
  expect(forceRender).not.toHaveBeenCalled()
})
