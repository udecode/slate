import type { Node } from 'slate'

type SlateEditableFocusEditor = {
  api: {
    dom: {
      assertDOMNode: (node: Node) => HTMLElement
      focus: (options?: { retries: number }) => void
    }
  }
} & Node

export const focusSlateEditable = (editor: SlateEditableFocusEditor) => {
  try {
    editor.api.dom.assertDOMNode(editor).focus({ preventScroll: true })
  } catch {
    // The DOM editor focus path still handles unmounted or dirty node maps.
  }

  editor.api.dom.focus()
}
