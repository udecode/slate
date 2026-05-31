import { act, render } from '@testing-library/react'
import { useRef } from 'react'
import { Editor } from 'slate/internal'
import {
  EDITOR_TO_ELEMENT,
  EDITOR_TO_KEY_TO_ELEMENT,
  EDITOR_TO_WINDOW,
  ELEMENT_TO_NODE,
  NODE_TO_ELEMENT,
} from 'slate-dom'
import { DOMCoverage } from 'slate-dom/internal'
import { applyDOMCoverageSelectionPolicy } from '../src/editable/dom-coverage-selection'
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

test('selection reconciler keeps DOM coverage skip selections model-owned', () => {
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
    copyPolicy: 'model',
    coveredPathRanges: [{ anchor: [1], focus: [1] }],
    coveredRuntimeRanges: [],
    findPolicy: 'native',
    ownerPath: [],
    ownerRuntimeId: null,
    reason: 'app-hidden',
    selectionPolicy: 'skip',
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
    expect(state.selectionChangeOrigin).toBe('programmatic-export')
    expect(state.isUpdatingSelection).toBe(true)

    act(() => {
      vi.runOnlyPendingTimers()
    })

    expect(state.isUpdatingSelection).toBe(false)
  } finally {
    DOMCoverage.clear(editor)
    vi.useRealTimers()
    vi.restoreAllMocks()
  }
})

test('DOM coverage selection materializes every covered materialize boundary with range roles', () => {
  const editor = createReactEditor()
  const materialized: string[] = []

  Editor.replace(editor, {
    children: [
      { type: 'paragraph', children: [{ text: 'anchor' }] },
      { type: 'paragraph', children: [{ text: 'before' }] },
      { type: 'paragraph', children: [{ text: 'middle' }] },
      { type: 'paragraph', children: [{ text: 'after' }] },
      { type: 'paragraph', children: [{ text: 'focus' }] },
    ],
    selection: {
      anchor: { path: [0, 0], offset: 'anchor'.length },
      focus: { path: [4, 0], offset: 0 },
    },
  })

  for (const [boundaryId, path] of [
    ['hidden-anchor', [0]],
    ['hidden-middle', [2]],
    ['hidden-focus', [4]],
  ] as const) {
    DOMCoverage.registerBoundary(editor, {
      anchor: { type: 'placeholder' },
      boundaryId,
      copyPolicy: 'model',
      coveredPathRanges: [{ anchor: path, focus: path }],
      coveredRuntimeRanges: [],
      findPolicy: 'native',
      ownerPath: [],
      ownerRuntimeId: null,
      reason: 'app-hidden',
      selectionPolicy: 'materialize',
      state: 'intentionally-hidden',
      version: 1,
    })
  }

  DOMCoverage.setMaterializeHandler(editor, (boundary, reason, options) => {
    materialized.push(
      `${boundary.boundaryId}:${reason}:${options.rangeRole ?? 'none'}`
    )
    return true
  })

  const domSelection = document.getSelection()
  const selection = Editor.getSelection(editor)

  try {
    if (!domSelection || !selection) {
      throw new Error('Expected document and editor selection')
    }

    expect(
      applyDOMCoverageSelectionPolicy({
        domSelection,
        editor,
        selection,
      })
    ).toBe(true)
    expect(materialized.sort()).toEqual([
      'hidden-anchor:selection:anchor',
      'hidden-focus:selection:focus',
      'hidden-middle:selection:interior',
    ])
  } finally {
    DOMCoverage.clear(editor)
  }
})

test('selection reconciler preserves visible anchor text across DOM coverage boundaries', () => {
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
    children: [
      { type: 'paragraph', children: [{ text: 'one' }] },
      { type: 'hidden', children: [{ text: 'secret' }] },
      { type: 'paragraph', children: [{ text: 'two' }] },
    ],
    selection: {
      anchor: { path: [0, 0], offset: 1 },
      focus: { path: [2, 0], offset: 1 },
    },
  })
  DOMCoverage.registerBoundary(editor, {
    anchor: { type: 'placeholder' },
    boundaryId: 'hidden-block',
    copyPolicy: 'model',
    coveredPathRanges: [{ anchor: [1], focus: [1] }],
    coveredRuntimeRanges: [],
    findPolicy: 'native',
    ownerPath: [],
    ownerRuntimeId: null,
    reason: 'app-hidden',
    selectionPolicy: 'skip',
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
      <div data-render-tick={renderTick} data-selection-test-root ref={rootRef}>
        <span data-slate-node="text" data-slate-path="0,0">
          <span data-slate-leaf="true">
            <span data-slate-string="true">one</span>
          </span>
        </span>
        <button type="button">hidden shell</button>
        <span data-slate-node="text" data-slate-path="2,0">
          <span data-slate-leaf="true">
            <span data-slate-string="true">two</span>
          </span>
        </span>
      </div>
    )
  }

  try {
    const { container, rerender } = render(<Harness />)
    const root = container.querySelector(
      '[data-selection-test-root]'
    ) as HTMLElement | null
    const [firstString, secondString] = container.querySelectorAll(
      '[data-slate-string]'
    )
    const firstElement = firstString?.closest(
      '[data-slate-node]'
    ) as HTMLElement | null
    const secondElement = secondString?.closest(
      '[data-slate-node]'
    ) as HTMLElement | null
    const firstText = firstString?.firstChild
    const secondText = secondString?.firstChild
    const domSelection = document.getSelection()

    if (
      !root ||
      !firstElement ||
      !secondElement ||
      !firstText ||
      !secondText ||
      !domSelection
    ) {
      throw new Error('Expected rendered text and document selection')
    }

    const [firstNode] = editor.read((state) => state.nodes.get([0, 0]))
    const [secondNode] = editor.read((state) => state.nodes.get([2, 0]))
    const keyToElement = new WeakMap()

    EDITOR_TO_ELEMENT.set(editor, root)
    EDITOR_TO_KEY_TO_ELEMENT.set(editor, keyToElement)
    EDITOR_TO_WINDOW.set(editor, window)
    ELEMENT_TO_NODE.set(root, editor)
    ELEMENT_TO_NODE.set(firstElement, firstNode)
    ELEMENT_TO_NODE.set(secondElement, secondNode)
    NODE_TO_ELEMENT.set(editor, root)
    NODE_TO_ELEMENT.set(firstNode, firstElement)
    NODE_TO_ELEMENT.set(secondNode, secondElement)
    keyToElement.set(editor.api.dom.findKey(firstNode), firstElement)
    keyToElement.set(editor.api.dom.findKey(secondNode), secondElement)

    domSelection.removeAllRanges()
    domSelection.setBaseAndExtent(firstText, 1, firstText, 1)

    vi.spyOn(ReactEditor, 'findDocumentOrShadowRoot').mockReturnValue(document)
    vi.spyOn(ReactEditor, 'resolveSlateRange').mockReturnValue(null)
    vi.spyOn(ReactEditor, 'hasRange').mockReturnValue(true)
    const setBaseAndExtent = vi.spyOn(domSelection, 'setBaseAndExtent')

    act(() => {
      renderTick++
      rerender(<Harness />)
    })

    expect(setBaseAndExtent).toHaveBeenLastCalledWith(
      firstText,
      1,
      secondText,
      1
    )
    expect(state.selectionChangeOrigin).toBe('programmatic-export')
    expect(state.isUpdatingSelection).toBe(true)

    act(() => {
      vi.runOnlyPendingTimers()
    })

    expect(state.isUpdatingSelection).toBe(false)
  } finally {
    DOMCoverage.clear(editor)
    EDITOR_TO_ELEMENT.delete(editor)
    EDITOR_TO_KEY_TO_ELEMENT.delete(editor)
    EDITOR_TO_WINDOW.delete(editor)
    NODE_TO_ELEMENT.delete(editor)
    vi.useRealTimers()
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
