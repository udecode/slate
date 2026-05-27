import { act, render } from '@testing-library/react'
import { useRef } from 'react'
import { Editor } from 'slate/internal'
import { DOMCoverage } from 'slate-dom/internal'

import {
  createEditableInputController,
  createEditableInputControllerState,
} from '../src/editable/input-controller'
import {
  applyEditableClick,
  useEditableSelectionReconciler,
} from '../src/editable/selection-reconciler'
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

test('selection reconciler keeps DOM coverage boundary selections model-backed', () => {
  const editor = createReactEditor()
  const inputController = createEditableInputController({
    preferModelSelectionForInputRef: { current: true },
    state: createEditableInputControllerState(),
  })
  const state = inputController.state
  const androidInputManagerRef = { current: null }
  let renderTick = 0

  Editor.replace(editor, {
    children: [
      { type: 'paragraph', children: [{ text: 'one' }] },
      { type: 'hidden', children: [{ text: 'secret' }] },
      { type: 'paragraph', children: [{ text: 'two' }] },
    ],
    selection: {
      anchor: { path: [0, 0], offset: 3 },
      focus: { path: [2, 0], offset: 0 },
    },
  })
  DOMCoverage.registerBoundary(editor, {
    anchor: { type: 'placeholder' },
    boundaryId: 'hidden-block',
    copyPolicy: 'include-model',
    coveredPathRanges: [{ anchor: [1], focus: [1] }],
    coveredRuntimeRanges: [],
    findPolicy: 'not-native-until-mounted',
    ownerPath: [],
    ownerRuntimeId: null,
    reason: 'app-hidden',
    selectionPolicy: 'boundary',
    state: 'intentionally-hidden',
    version: 1,
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
        <span>one</span>
        <button type="button">hidden shell</button>
        <span>two</span>
      </div>
    )
  }

  try {
    const { container, rerender } = render(<Harness />)
    const firstText = container.querySelector('span')?.firstChild
    const domSelection = document.getSelection()

    if (!firstText || !domSelection) {
      throw new Error('Expected rendered text and document selection')
    }

    domSelection.removeAllRanges()
    domSelection.setBaseAndExtent(firstText, 3, firstText, 3)

    vi.spyOn(ReactEditor, 'findDocumentOrShadowRoot').mockReturnValue(document)
    vi.spyOn(ReactEditor, 'resolveSlateRange').mockReturnValue(null)
    vi.spyOn(ReactEditor, 'hasRange').mockReturnValue(true)
    const resolveDOMRange = vi.spyOn(ReactEditor, 'resolveDOMRange')

    act(() => {
      renderTick++
      rerender(<Harness />)
    })

    expect(domSelection.rangeCount).toBe(0)
    expect(resolveDOMRange).not.toHaveBeenCalled()
    expect(state.isUpdatingSelection).toBe(false)
  } finally {
    DOMCoverage.clear(editor)
    vi.restoreAllMocks()
  }
})

test('read-only triple-click stays native and does not update model selection', () => {
  const editor = createReactEditor()
  const inputController = createEditableInputController({
    preferModelSelectionForInputRef: { current: true },
    state: createEditableInputControllerState(),
  })

  Editor.replace(editor, {
    children: [{ type: 'paragraph', children: [{ text: 'abc' }] }],
    selection: {
      anchor: { path: [0, 0], offset: 1 },
      focus: { path: [0, 0], offset: 1 },
    },
  })

  const target = document.createElement('span')
  target.setAttribute('data-slate-node', 'element')
  target.setAttribute('data-slate-path', '0')
  document.body.append(target)

  const update = vi.spyOn(editor, 'update')

  try {
    applyEditableClick({
      editor,
      event: {
        defaultPrevented: false,
        detail: 3,
        isDefaultPrevented: () => false,
        isPropagationStopped: () => false,
        target,
      } as any,
      inputController,
      readOnly: true,
    })

    expect(update).not.toHaveBeenCalled()
    expect(Editor.getSelection(editor)).toEqual({
      anchor: { path: [0, 0], offset: 1 },
      focus: { path: [0, 0], offset: 1 },
    })
  } finally {
    target.remove()
    update.mockRestore()
  }
})
