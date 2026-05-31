import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from '@testing-library/react'
import type { Descendant } from 'slate'
import { afterEach, vi } from 'vitest'

import { createReactEditor, Editable, Slate } from '../src'
import {
  applyDragAutoScrollFrame,
  canScrollY,
  getDragAutoScrollTarget,
  type RootInteractionEditor,
  useRootInteractionController,
} from '../src/editable/root-interaction-controller'

const paragraph = (text: string): Descendant => ({
  type: 'paragraph',
  children: [{ text }],
})

const rect = ({
  bottom = 20,
  left,
  right,
  top = 0,
}: {
  bottom?: number
  left: number
  right: number
  top?: number
}) =>
  ({
    bottom,
    height: bottom - top,
    left,
    right,
    top,
    width: right - left,
    x: left,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect

const rangeDescriptor = Object.getOwnPropertyDescriptor(
  Range.prototype,
  'getClientRects'
)

const createMouseCaptureEvent = ({
  clientX,
  clientY,
  currentTarget,
  target,
}: {
  clientX: number
  clientY: number
  currentTarget: HTMLElement
  target: Element
}) =>
  ({
    buttons: 1,
    clientX,
    clientY,
    currentTarget,
    defaultPrevented: false,
    nativeEvent: {},
    preventDefault: vi.fn(),
    target,
  }) as unknown as React.MouseEvent<HTMLElement>

afterEach(() => {
  if (rangeDescriptor) {
    Object.defineProperty(Range.prototype, 'getClientRects', rangeDescriptor)
  } else {
    delete (Range.prototype as Partial<Range>).getClientRects
  }
})

describe('root interaction controller', () => {
  const createScrollableElement = () => {
    const scroller = document.createElement('div')

    scroller.style.overflowY = 'auto'
    scroller.getBoundingClientRect = () =>
      rect({ bottom: 100, left: 0, right: 100, top: 0 })
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 200 },
    })

    return scroller
  }

  test('does not treat hidden vertical overflow as drag autoscrollable', () => {
    const scroller = document.createElement('div')

    scroller.style.overflowX = 'auto'
    scroller.style.overflowY = 'hidden'
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 200 },
    })

    expect(canScrollY(scroller)).toBe(false)

    scroller.style.overflowY = 'auto'

    expect(canScrollY(scroller)).toBe(true)
  })

  test('resolves drag autoscroll ranges inside the scrollport edge', () => {
    const scroller = createScrollableElement()
    const target = getDragAutoScrollTarget({
      clientX: 50,
      clientY: 130,
      rootElement: scroller,
    })

    expect(target?.clientX).toBe(50)
    expect(target?.clientY).toBe(99)
    expect(target?.scroll()).toBe(true)
    expect(scroller.scrollTop).toBeGreaterThan(0)
  })

  test('stops drag autoscroll when the scrolled frame cannot resolve a range', () => {
    const scroller = createScrollableElement()
    const previousElementFromPoint = document.elementFromPoint
    const resolveEventRange = vi.fn(() => null)
    const startRange = {
      anchor: { offset: 0, path: [0, 0] },
      focus: { offset: 0, path: [0, 0] },
    }

    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => scroller),
    })

    const continued = applyDragAutoScrollFrame({
      animationFrame: null,
      clientX: 50,
      clientY: 130,
      editor: {
        api: {
          dom: {
            hasDOMNode: vi.fn(() => true),
            resolveEventRange,
          },
        },
      } as unknown as RootInteractionEditor,
      releaseCleanup: null,
      root: 'main',
      rootElement: scroller,
      startRange,
    })

    if (previousElementFromPoint) {
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: previousElementFromPoint,
      })
    } else {
      delete (document as Partial<Document>).elementFromPoint
    }

    expect(continued).toBe(false)
    expect(scroller.scrollTop).toBeGreaterThan(0)
    expect(resolveEventRange).toHaveBeenCalledWith(
      expect.objectContaining({
        clientX: 50,
        clientY: 99,
      })
    )
  })

  test('prevents native fallback on focused blank editable-root clicks', async () => {
    const editor = createReactEditor({
      initialValue: {
        roots: {
          main: [paragraph('body')],
        },
      },
    })

    render(
      <Slate editor={editor}>
        <Editable aria-label="Main editor" layout={{}} />
      </Slate>
    )

    const editable = screen.getByLabelText('Main editor')

    await act(async () => {
      editable.focus()
    })

    expect(document.activeElement).toBe(editable)
    expect(fireEvent.mouseDown(editable)).toBe(false)
  })

  test('owns focused native-editable coordinate placements in layout mode', async () => {
    const editor = createReactEditor({
      initialValue: {
        roots: {
          main: [paragraph('body')],
        },
      },
    })

    render(
      <Slate editor={editor}>
        <Editable aria-label="Main editor" layout={{}} />
      </Slate>
    )

    const editable = screen.getByLabelText('Main editor')
    const string = editable.querySelector<HTMLElement>('[data-slate-string]')

    expect(string).toBeTruthy()

    Object.defineProperty(string!, 'getClientRects', {
      configurable: true,
      value: () => [rect({ left: 10, right: 80 })],
    })
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: () => [rect({ left: 10, right: 30 })],
    })

    await act(async () => {
      editable.focus()
    })

    expect(document.activeElement).toBe(editable)
    expect(fireEvent.mouseDown(string!, { clientX: 8, clientY: 10 })).toBe(
      false
    )
  })

  test('preserves dragged coordinate selection when mouseup has no range', () => {
    const editable = document.createElement('div')
    const string = document.createElement('span')
    const startRange = {
      anchor: { path: [0, 0], offset: 1 },
      focus: { path: [0, 0], offset: 1 },
    }
    const endRange = {
      anchor: { path: [1, 0], offset: 4 },
      focus: { path: [1, 0], offset: 4 },
    }
    const resolvedRanges = [startRange, null, endRange, null]
    let selection: unknown = null

    editable.dataset.slateEditor = 'true'
    editable.dataset.slateRoot = 'main'
    string.dataset.slateString = 'true'
    editable.append(string)
    document.body.append(editable)

    const editor = {
      api: {
        dom: {
          assertDOMNode: () => editable,
          focus: vi.fn(),
          resolveDOMNode: () => editable,
          resolveEventRange: vi.fn(() => resolvedRanges.shift() ?? null),
        },
      },
      read: (reader: (state: unknown) => unknown) =>
        reader({
          points: {
            end: () => ({ path: [1, 0], offset: 4 }),
          },
          schema: {
            getElementSpec: () => null,
          },
          selection: {
            get: () => selection,
          },
          value: {
            get: () => ({
              roots: {
                main: [paragraph('first'), paragraph('second')],
              },
            }),
          },
        }),
      update: (writer: (tx: unknown) => void) => {
        writer({
          selection: {
            set: (range: unknown) => {
              selection = range
            },
          },
        })
      },
    }

    const { result, unmount } = renderHook(() =>
      useRootInteractionController({
        disabled: false,
        editor: editor as never,
        getLastSelectionForRoot: () => startRange,
        getMountedViewEditor: () => editor as never,
        root: 'main',
        selection: 'restore',
      })
    )

    act(() => {
      result.current.onMouseDownCapture(
        createMouseCaptureEvent({
          clientX: 10,
          clientY: 10,
          currentTarget: editable,
          target: string,
        })
      )
      result.current.onMouseMoveCapture(
        createMouseCaptureEvent({
          clientX: 80,
          clientY: 10,
          currentTarget: editable,
          target: string,
        })
      )
    })

    expect(selection).toEqual({
      anchor: { path: [0, 0], offset: 1 },
      focus: { path: [1, 0], offset: 4 },
    })

    act(() => {
      result.current.onMouseUpCapture(
        createMouseCaptureEvent({
          clientX: 80,
          clientY: 10,
          currentTarget: editable,
          target: string,
        })
      )
    })

    expect(selection).toEqual({
      anchor: { path: [0, 0], offset: 1 },
      focus: { path: [1, 0], offset: 4 },
    })

    unmount()
    editable.remove()
  })
})
