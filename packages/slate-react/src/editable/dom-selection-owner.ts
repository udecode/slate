import { closestShadowAware, type DOMElement, isDOMElement } from 'slate-dom'

const closestSlateEditorElement = (node: globalThis.Node | null) => {
  const element = isDOMElement(node) ? node : node?.parentElement

  return element ? closestShadowAware(element, '[data-slate-editor]') : null
}

export const isDOMSelectionInsideAnotherSlateEditor = ({
  domSelection,
  editorElement,
}: {
  domSelection: globalThis.Selection
  editorElement: DOMElement
}) => {
  if (domSelection.rangeCount === 0) {
    return false
  }

  const anchorEditor = closestSlateEditorElement(domSelection.anchorNode)
  const focusEditor = closestSlateEditorElement(domSelection.focusNode)

  if (anchorEditor === editorElement || focusEditor === editorElement) {
    return false
  }

  return !!anchorEditor || !!focusEditor
}
