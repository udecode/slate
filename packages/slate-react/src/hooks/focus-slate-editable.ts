import type { Node } from 'slate'
import { IS_FOCUSED } from 'slate-dom'

import { readSlateViewSelection } from '../view-selection'
import { scheduleSlateReactFocus } from './focus-scheduler'

type SlateEditableFocusEditor = {
  api: {
    dom: {
      assertDOMNode: (node: Node) => HTMLElement
      focus: (options?: { retries: number }) => void
    }
  }
} & Node

export const focusSlateEditable = (editor: SlateEditableFocusEditor) => {
  let element: HTMLElement | null = null

  try {
    element = editor.api.dom.assertDOMNode(editor)
  } catch {
    // The DOM editor focus path still handles unmounted or dirty node maps.
  }

  if (readSlateViewSelection(editor)) {
    if (element) {
      IS_FOCUSED.set(editor as Parameters<typeof IS_FOCUSED.set>[0], true)
      element.focus({ preventScroll: true })
    }

    return
  }

  editor.api.dom.focus()

  if (element && element.ownerDocument.activeElement !== element) {
    element.focus({ preventScroll: true })
    editor.api.dom.focus()
  }
}

export const focusSlateEditableAfterEventFrame = (
  editor: SlateEditableFocusEditor
) => {
  focusSlateEditable(editor)
  scheduleSlateReactFocus(() => {
    focusSlateEditable(editor)
  })
  globalThis.setTimeout?.(() => {
    focusSlateEditable(editor)
  }, 0)
}
