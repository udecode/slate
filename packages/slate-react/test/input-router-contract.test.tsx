import { render, renderHook } from '@testing-library/react'
import { useMemo, useRef } from 'react'
import { Editor } from 'slate/internal'

import {
  createEditableInputController,
  createEditableInputControllerState,
} from '../src/editable/input-controller'
import {
  getDOMInputRepairTarget,
  useEditableDOMInputHandler,
  useEditableRootRef,
} from '../src/editable/input-router'
import { useRuntimeInputEvents } from '../src/editable/runtime-input-events'
import { createReactEditor } from '../src/plugin/with-react'

const cancelable = () => ({ cancel: () => {} })

const RootRefProbe = ({
  onDOMBeforeInput,
}: {
  onDOMBeforeInput: (event: InputEvent) => void
}) => {
  const editor = useMemo(() => createReactEditor(), [])
  const detachNativeInputListenersRef = useRef<(() => void) | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const lifecycle = useMemo(cancelable, [])
  const ref = useEditableRootRef({
    detachNativeInputListenersRef,
    editor,
    onDOMBeforeInput,
    onDOMInput: () => {},
    onDOMSelectionChange: lifecycle,
    rootRef,
    scheduleOnDOMSelectionChange: lifecycle,
  })

  return <div data-testid="root" ref={ref} />
}

test('native input listeners attach once while reading the latest beforeinput handler', () => {
  const firstHandler = jest.fn()
  const secondHandler = jest.fn()
  const addEventListener = jest.spyOn(HTMLElement.prototype, 'addEventListener')
  const removeEventListener = jest.spyOn(
    HTMLElement.prototype,
    'removeEventListener'
  )

  try {
    const rendered = render(<RootRefProbe onDOMBeforeInput={firstHandler} />)
    rendered.rerender(<RootRefProbe onDOMBeforeInput={secondHandler} />)

    rendered.getByTestId('root').dispatchEvent(
      new Event('beforeinput', {
        bubbles: true,
        cancelable: true,
      })
    )

    expect(
      addEventListener.mock.calls.filter(([type]) => type === 'beforeinput')
    ).toHaveLength(1)
    expect(
      removeEventListener.mock.calls.filter(([type]) => type === 'beforeinput')
    ).toHaveLength(0)
    expect(firstHandler).not.toHaveBeenCalled()
    expect(secondHandler).toHaveBeenCalledTimes(1)
  } finally {
    addEventListener.mockRestore()
    removeEventListener.mockRestore()
  }
})

test('read-only native input repairs leaked DOM mutations', () => {
  const editor = createReactEditor()
  const root = document.createElement('div')
  root.innerHTML =
    '<span data-slate-node="text" data-slate-path="0,0"><span data-slate-string="true">axbc</span></span>'
  const repairDOMInput = vi.fn()
  const onReadOnlyDOMInput = vi.fn()
  const event = new Event('input', {
    bubbles: true,
    cancelable: true,
  }) as InputEvent

  Object.defineProperties(event, {
    data: { value: 'x' },
    inputType: { value: 'insertText' },
  })
  Editor.replace(editor, {
    children: [{ type: 'paragraph', children: [{ text: 'abc' }] }],
    selection: {
      anchor: { path: [0, 0], offset: 1 },
      focus: { path: [0, 0], offset: 1 },
    },
  })
  const stopImmediatePropagation = vi.spyOn(event, 'stopImmediatePropagation')

  const { result } = renderHook(() =>
    useEditableDOMInputHandler({
      editor,
      onReadOnlyDOMInput,
      readOnly: true,
      repairDOMInput,
      rootRef: { current: root },
    })
  )

  result.current(event)

  expect(event.defaultPrevented).toBe(true)
  expect(stopImmediatePropagation).toHaveBeenCalled()
  expect(repairDOMInput).not.toHaveBeenCalled()
  expect(root.textContent).toBe('abc')
  expect(onReadOnlyDOMInput).toHaveBeenCalledTimes(1)
})

test('read-only native input repairs split decorated text strings', () => {
  const editor = createReactEditor()
  const root = document.createElement('div')
  root.innerHTML =
    '<span data-slate-node="text" data-slate-path="0,0"><span data-slate-string="true">axb</span><span data-slate-string="true">c</span></span>'
  const repairDOMInput = vi.fn()
  const event = new Event('input', {
    bubbles: true,
    cancelable: true,
  }) as InputEvent

  Object.defineProperties(event, {
    data: { value: 'x' },
    inputType: { value: 'insertText' },
  })
  Editor.replace(editor, {
    children: [{ type: 'paragraph', children: [{ text: 'abc' }] }],
    selection: {
      anchor: { path: [0, 0], offset: 1 },
      focus: { path: [0, 0], offset: 1 },
    },
  })

  const { result } = renderHook(() =>
    useEditableDOMInputHandler({
      editor,
      readOnly: true,
      repairDOMInput,
      rootRef: { current: root },
    })
  )

  result.current(event)

  const strings = root.querySelectorAll('[data-slate-string="true"]')
  expect(repairDOMInput).not.toHaveBeenCalled()
  expect(strings[0]).toHaveTextContent('ab')
  expect(strings[1]).toHaveTextContent('c')
  expect(root.textContent).toBe('abc')
})

const createNativeInsertTextEvent = (data: string) => {
  const event = new Event('input', {
    bubbles: true,
    cancelable: true,
  }) as InputEvent

  Object.defineProperties(event, {
    data: { value: data },
    inputType: { value: 'insertText' },
  })

  return event
}

const appendTextHost = (root: HTMLElement, path: string) => {
  const textHost = document.createElement('span')
  const string = document.createElement('span')
  const text = document.createTextNode('')

  textHost.setAttribute('data-slate-node', 'text')
  textHost.setAttribute('data-slate-path', path)
  string.setAttribute('data-slate-string', 'true')
  string.append(text)
  textHost.append(string)
  root.append(textHost)

  return text
}

const selectTextOffset = (text: Text, offset: number) => {
  const range = document.createRange()
  const selection = document.getSelection()

  range.setStart(text, offset)
  range.collapse(true)
  selection?.removeAllRanges()
  selection?.addRange(range)
}

test('deferred native text input repair coalesces burst input for the same text target', () => {
  const editor = createReactEditor()
  const root = document.createElement('div')
  const repairDOMInput = vi.fn()
  let pendingTimeout: (() => void) | null = null
  const setTimeoutSpy = vi
    .spyOn(window, 'setTimeout')
    .mockImplementation((callback) => {
      pendingTimeout = callback as () => void

      return 1
    }) as unknown as ReturnType<typeof vi.spyOn>
  const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout')
  const text = appendTextHost(root, '0,0')

  Editor.replace(editor, {
    children: [{ type: 'paragraph', children: [{ text: '' }] }],
    selection: null,
  })
  document.body.append(root)

  try {
    const { result } = renderHook(() =>
      useEditableDOMInputHandler({
        deferNativeTextInputRepair: true,
        editor,
        readOnly: false,
        repairDOMInput,
        rootRef: { current: root },
      })
    )

    text.nodeValue = 'x'
    selectTextOffset(text, 1)
    result.current(createNativeInsertTextEvent('x'))

    text.nodeValue = 'xy'
    selectTextOffset(text, 2)
    result.current(createNativeInsertTextEvent('y'))

    expect(setTimeoutSpy).toHaveBeenCalledTimes(2)
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1)
    expect(repairDOMInput).not.toHaveBeenCalled()

    pendingTimeout?.()

    expect(repairDOMInput).toHaveBeenCalledWith(
      {
        data: 'y',
        inputType: 'insertText',
        target: { path: [0, 0], selectionOffset: 2, text: 'xy' },
      },
      root
    )
    expect(repairDOMInput).toHaveBeenCalledTimes(1)
  } finally {
    setTimeoutSpy.mockRestore()
    clearTimeoutSpy.mockRestore()
    root.remove()
  }
})

test('deferred native text input repair preserves inserts across text targets', () => {
  const editor = createReactEditor()
  const root = document.createElement('div')
  const repairDOMInput = vi.fn()
  let pendingTimeout: (() => void) | null = null
  const setTimeoutSpy = vi
    .spyOn(window, 'setTimeout')
    .mockImplementation((callback) => {
      pendingTimeout = callback as () => void

      return 1
    }) as unknown as ReturnType<typeof vi.spyOn>
  const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout')
  const firstText = appendTextHost(root, '0,0')
  const secondText = appendTextHost(root, '1,0')

  Editor.replace(editor, {
    children: [
      { type: 'paragraph', children: [{ text: '' }] },
      { type: 'paragraph', children: [{ text: '' }] },
    ],
    selection: null,
  })
  document.body.append(root)

  try {
    const { result } = renderHook(() =>
      useEditableDOMInputHandler({
        deferNativeTextInputRepair: true,
        editor,
        readOnly: false,
        repairDOMInput,
        rootRef: { current: root },
      })
    )

    firstText.nodeValue = 'x'
    selectTextOffset(firstText, 1)
    result.current(createNativeInsertTextEvent('x'))

    secondText.nodeValue = 'y'
    selectTextOffset(secondText, 1)
    result.current(createNativeInsertTextEvent('y'))

    expect(setTimeoutSpy).toHaveBeenCalledTimes(2)
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1)
    expect(repairDOMInput).not.toHaveBeenCalled()

    pendingTimeout?.()

    expect(repairDOMInput).toHaveBeenNthCalledWith(
      1,
      {
        data: 'x',
        inputType: 'insertText',
        target: { path: [0, 0], selectionOffset: 1, text: 'x' },
      },
      root
    )
    expect(repairDOMInput).toHaveBeenNthCalledWith(
      2,
      {
        data: 'y',
        inputType: 'insertText',
        target: { path: [1, 0], selectionOffset: 1, text: 'y' },
      },
      root
    )
  } finally {
    setTimeoutSpy.mockRestore()
    clearTimeoutSpy.mockRestore()
    root.remove()
  }
})

test('native input repair prefers a valid DOM text target over stale runtime selection', () => {
  const editor = createReactEditor()
  const root = document.createElement('div')
  const firstText = appendTextHost(root, '0,0')
  const secondText = appendTextHost(root, '1,0')

  firstText.nodeValue = 'xa'
  secondText.nodeValue = 'b'
  Editor.replace(editor, {
    children: [
      { type: 'paragraph', children: [{ text: 'a' }] },
      { type: 'paragraph', children: [{ text: 'b' }] },
    ],
    selection: {
      anchor: { path: [1, 0], offset: 1 },
      focus: { path: [1, 0], offset: 1 },
    },
  })
  document.body.append(root)

  try {
    selectTextOffset(firstText, 1)

    expect(
      getDOMInputRepairTarget(editor, root, {
        data: 'x',
        inputType: 'insertText',
      })
    ).toEqual({
      path: [0, 0],
      selectionOffset: 1,
      text: 'xa',
    })
  } finally {
    root.remove()
  }
})

test('read-only input capture does not schedule model-owning DOM input repair', () => {
  const editor = createReactEditor()
  const inputController = createEditableInputController({
    preferModelSelectionForInputRef: { current: false },
    state: createEditableInputControllerState(),
  })
  const root = document.createElement('div')
  const repairDOMInputAfterFrame = vi.fn()

  const { result } = renderHook(() =>
    useRuntimeInputEvents({
      androidInputManagerRef: { current: null },
      deferredOperations: { current: [] },
      editor,
      handledDOMBeforeInputRef: { current: false },
      inputController,
      readOnly: true,
      repair: {
        forceRender: vi.fn(),
        requestEditableRepair: vi.fn(),
      } as any,
      rootRef: { current: root },
      trace: {
        getCurrentKernelFrameId: () => 1,
        recordKernelEventTrace: vi.fn(),
        repairDOMInputAfterFrame,
      } as any,
    })
  )

  result.current.onInputCapture({
    currentTarget: root,
    nativeEvent: { data: 'x', inputType: 'insertText' },
    stopPropagation: vi.fn(),
    target: null,
  } as any)

  expect(repairDOMInputAfterFrame).not.toHaveBeenCalled()
})

test('deferred native text input repair resets stale same-path offsets after caret moves', () => {
  const editor = createReactEditor()
  const inputController = createEditableInputController({
    preferModelSelectionForInputRef: { current: false },
    state: createEditableInputControllerState(),
  })
  const root = document.createElement('div')
  const text = appendTextHost(root, '0,0')
  const repairDOMInputAfterFrame = vi.fn()
  const setTimeoutSpy = vi
    .spyOn(window, 'setTimeout')
    .mockImplementation(() => 1) as unknown as ReturnType<typeof vi.spyOn>
  const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout')

  Editor.replace(editor, {
    children: [{ type: 'paragraph', children: [{ text: '' }] }],
    selection: {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    },
  })
  document.body.append(root)

  try {
    const { result } = renderHook(() =>
      useRuntimeInputEvents({
        androidInputManagerRef: { current: null },
        deferNativeTextInputRepair: true,
        deferredOperations: { current: [] },
        editor,
        handledDOMBeforeInputRef: { current: false },
        inputController,
        readOnly: false,
        repair: {
          forceRender: vi.fn(),
          requestEditableRepair: vi.fn(),
        } as any,
        rootRef: { current: root },
        trace: {
          getCurrentKernelFrameId: () => 1,
          recordKernelEventTrace: vi.fn(),
          repairDOMInputAfterFrame,
        } as any,
      })
    )

    text.nodeValue = 'x'
    selectTextOffset(text, 1)
    result.current.onInputCapture({
      currentTarget: root,
      nativeEvent: { data: 'x', inputType: 'insertText' },
      stopPropagation: vi.fn(),
      target: null,
    } as any)

    text.nodeValue = 'xy'
    selectTextOffset(text, 2)
    result.current.onInputCapture({
      currentTarget: root,
      nativeEvent: { data: 'y', inputType: 'insertText' },
      stopPropagation: vi.fn(),
      target: null,
    } as any)

    Editor.withoutNormalizing(editor, () => {
      editor.selection = {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 0 },
      }
    })
    text.nodeValue = 'zxy'
    selectTextOffset(text, 1)
    result.current.onInputCapture({
      currentTarget: root,
      nativeEvent: { data: 'z', inputType: 'insertText' },
      stopPropagation: vi.fn(),
      target: null,
    } as any)

    expect(repairDOMInputAfterFrame).toHaveBeenLastCalledWith(
      {
        data: 'z',
        inputType: 'insertText',
        target: {
          insert: { offset: 0, text: 'z' },
          path: [0, 0],
          selectionOffset: 1,
          text: 'zxy',
        },
      },
      root,
      1
    )
    expect(setTimeoutSpy).toHaveBeenCalledTimes(3)
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(2)
  } finally {
    setTimeoutSpy.mockRestore()
    clearTimeoutSpy.mockRestore()
    root.remove()
  }
})
