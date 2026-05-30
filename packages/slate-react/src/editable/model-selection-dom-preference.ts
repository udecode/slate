import { RangeApi, type Range as SlateRange } from 'slate'
import type { DOMRange } from 'slate-dom'

export type ModelSelectionDOMPoint = {
  node: globalThis.Node
  offset: number
}

type ModelSelectionDOMPreference = {
  anchor: ModelSelectionDOMPoint
  focus: ModelSelectionDOMPoint
  selection: SlateRange
}

const MODEL_SELECTION_DOM_PREFERENCES = new WeakMap<
  object,
  ModelSelectionDOMPreference
>()

const isConnectedInsideEditor = (
  editorElement: HTMLElement,
  point: ModelSelectionDOMPoint
) => point.node.isConnected && editorElement.contains(point.node)

export const writeCollapsedModelSelectionDOMPreference = (
  editor: object,
  selection: SlateRange,
  point: ModelSelectionDOMPoint | null
) => {
  if (!point || !RangeApi.isCollapsed(selection)) {
    MODEL_SELECTION_DOM_PREFERENCES.delete(editor)
    return
  }

  MODEL_SELECTION_DOM_PREFERENCES.set(editor, {
    anchor: point,
    focus: point,
    selection,
  })
}

export const takeModelSelectionDOMPreference = ({
  editor,
  editorElement,
  selection,
}: {
  editor: object
  editorElement: HTMLElement
  selection: SlateRange
}): DOMRange | null => {
  const preference = MODEL_SELECTION_DOM_PREFERENCES.get(editor)

  if (!preference) {
    return null
  }

  MODEL_SELECTION_DOM_PREFERENCES.delete(editor)

  if (!RangeApi.equals(preference.selection, selection)) {
    return null
  }

  if (
    !isConnectedInsideEditor(editorElement, preference.anchor) ||
    !isConnectedInsideEditor(editorElement, preference.focus)
  ) {
    return null
  }

  try {
    const domRange = editorElement.ownerDocument.createRange()

    domRange.setStart(preference.anchor.node, preference.anchor.offset)
    domRange.setEnd(preference.focus.node, preference.focus.offset)

    return domRange
  } catch {
    return null
  }
}
