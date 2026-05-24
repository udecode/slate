import { act, render } from '@testing-library/react'
import { useRef } from 'react'
import { Editor } from 'slate/internal'

import {
  createEditableInputController,
  createEditableInputControllerState,
} from '../src/editable/input-controller'
import { useEditableSelectionReconciler } from '../src/editable/selection-reconciler'
import { ReactEditor } from '../src/plugin/react-editor'
import { createReactEditor } from '../src/plugin/with-react'

test('selection reconciler clears the updating guard when DOM export throws', () => {
  vi.useFakeTimers()

  const editor = createReactEditor()
  const inputController = createEditableInputController({
    preferModelSelectionForInputRef: { current: true },
    state: createEditableInputControllerState(),
  })
  const state = inputController.state
  const androidInputManagerRef = { current: null }
  let renderTick = 0

  Editor.replace(editor, {
    children: [{ type: 'paragraph', children: [{ text: 'abc' }] }],
    selection: {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 1 },
    },
  })

  const Harness = () => {
    const rootRef = useRef<HTMLDivElement | null>(null)

    useEditableSelectionReconciler({
      androidInputManagerRef,
      editor,
      inputController,
      rootRef,
      scrollSelectionIntoView: vi.fn(),
      partialDOMBackedSelection: false,
      state,
    })

    return (
      <div data-render-tick={renderTick} ref={rootRef}>
        <span>abc</span>
      </div>
    )
  }

  try {
    const { container, rerender } = render(<Harness />)
    const textNode = container.querySelector('span')?.firstChild
    const domSelection = document.getSelection()

    if (!textNode || !domSelection) {
      throw new Error('Expected rendered text and document selection')
    }

    const domRange = document.createRange()
    domRange.setStart(textNode, 0)
    domRange.setEnd(textNode, 1)

    domSelection.removeAllRanges()
    domSelection.setBaseAndExtent(textNode, 0, textNode, 0)

    vi.spyOn(ReactEditor, 'findDocumentOrShadowRoot').mockReturnValue(document)
    vi.spyOn(ReactEditor, 'resolveSlateRange').mockReturnValue(null)
    vi.spyOn(ReactEditor, 'hasRange').mockReturnValue(true)
    vi.spyOn(ReactEditor, 'resolveDOMRange').mockReturnValue(domRange)
    vi.spyOn(ReactEditor, 'isComposing').mockReturnValue(false)
    vi.spyOn(domSelection, 'setBaseAndExtent').mockImplementation(() => {
      throw new Error('stale DOM bridge')
    })

    act(() => {
      renderTick++
      rerender(<Harness />)
    })

    expect(state.isUpdatingSelection).toBe(true)

    act(() => {
      vi.runOnlyPendingTimers()
    })

    expect(state.isUpdatingSelection).toBe(false)
    expect(state.selectionChangeOrigin).toBe('programmatic-export')
  } finally {
    vi.useRealTimers()
    vi.restoreAllMocks()
  }
})
