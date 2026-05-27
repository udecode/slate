import { afterEach, describe, expect, it, vi } from 'vitest'
import { focusSlateEditable } from '../src/hooks/focus-slate-editable'
import { createSlateProjectionGraph } from '../src/projection-graph'
import {
  createSlateViewSelection,
  writeSlateViewSelection,
} from '../src/view-selection'

const createProjectedSelection = () => {
  const graph = createSlateProjectionGraph([
    { path: [0], root: 'main' },
    { path: [0], root: 'side' },
  ])

  return createSlateViewSelection(graph, {
    anchor: { point: { path: [0, 0], offset: 0 } },
    focus: { point: { path: [0, 0], root: 'side', offset: 1 } },
  })
}

const createFocusableEditor = () => {
  const element = document.createElement('div')

  element.tabIndex = 0
  document.body.appendChild(element)

  const focus = vi.fn(() => {
    element.focus({ preventScroll: true })
  })
  const editor = Object.assign(element, {
    api: {
      dom: {
        assertDOMNode: () => element,
        focus,
      },
    },
  }) as unknown as Parameters<typeof focusSlateEditable>[0]

  return { editor, element, focus }
}

afterEach(() => {
  document.body.textContent = ''
})

describe('focusSlateEditable', () => {
  it('uses the DOM editor focus path for normal model selections', () => {
    const { editor, element, focus } = createFocusableEditor()

    focusSlateEditable(editor)

    expect(focus).toHaveBeenCalledTimes(1)
    expect(element.ownerDocument.activeElement).toBe(element)
  })

  it('does not export a model selection over an active projected view selection', () => {
    const { editor, element, focus } = createFocusableEditor()

    writeSlateViewSelection(editor, createProjectedSelection())

    focusSlateEditable(editor)

    expect(focus).not.toHaveBeenCalled()
    expect(element.ownerDocument.activeElement).toBe(element)
  })
})
