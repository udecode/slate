import { render, renderHook } from '@testing-library/react'
import { useMemo, useRef } from 'react'
import { Editor } from 'slate/internal'

import {
  createEditableInputController,
  createEditableInputControllerState,
} from '../src/editable/input-controller'
import {
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
