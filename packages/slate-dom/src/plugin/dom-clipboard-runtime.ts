import { type DescendantIn, Range, Node as SlateNode, type Value } from 'slate'
import { Editor, getEditorTransformRegistry } from 'slate/internal'
import {
  getPlainText,
  getSlateFragmentAttribute,
  isDOMText,
} from '../utils/dom'
import { DOMCoverage } from './dom-coverage'
import { DOMEditor } from './dom-editor'

const NEWLINE_SPLIT_RE = /\r\n|\r|\n/

const EDITOR_TO_CLIPBOARD_FORMAT_KEY = new WeakMap<DOMEditor<any>, string>()

export type DOMClipboardInsertDataHandler = (
  editor: DOMEditor<any>,
  data: DataTransfer
) => boolean | void

const stripRenderOnlyLeafWrappers = (root: ParentNode) => {
  const candidates = Array.from(
    root.querySelectorAll(
      '[data-slate-leaf] span:not([data-slate-string]):not([data-slate-zero-width])'
    )
  )

  candidates.forEach((candidate) => {
    if (candidate.closest('[data-slate-leaf]')) {
      candidate.replaceWith(...Array.from(candidate.childNodes))
    }
  })
}

export const setDOMClipboardFormatKey = (
  editor: DOMEditor<any>,
  clipboardFormatKey: string
) => {
  EDITOR_TO_CLIPBOARD_FORMAT_KEY.set(editor, clipboardFormatKey)
}

const getDOMClipboardFormatKey = (editor: DOMEditor<any>) =>
  EDITOR_TO_CLIPBOARD_FORMAT_KEY.get(editor) ?? 'x-slate-fragment'

const escapeHtmlText = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

const getFragmentText = <V extends Value>(
  fragment: readonly DescendantIn<V>[]
) => fragment.map((node) => SlateNode.string(node)).join('\n')

const writeModelBackedSelectionData = <V extends Value>(
  editor: DOMEditor<V>,
  data: Pick<DataTransfer, 'setData'>,
  clipboardFormatKey: string
) => {
  const fragment = editor.read((state) => state.fragment.get())
  const string = JSON.stringify(fragment)
  const encoded = DOMEditor.getWindow(editor).btoa(encodeURIComponent(string))
  const text = getFragmentText(fragment)

  data.setData(`application/${clipboardFormatKey}`, encoded)
  data.setData('text/plain', text)
  data.setData(
    'text/html',
    `<span data-slate-fragment="${encoded}">${escapeHtmlText(text)}</span>`
  )
}

export const writeDOMSelectionData = <V extends Value>(
  editor: DOMEditor<V>,
  data: Pick<DataTransfer, 'getData' | 'setData'>
) => {
  const clipboardFormatKey = getDOMClipboardFormatKey(editor)
  const selection = editor.read((state) => state.selection.get())

  if (!selection) {
    return
  }

  const [start, end] = Range.edges(selection)
  const startVoid = Editor.void(editor, { at: start.path })
  const endVoid = Editor.void(editor, { at: end.path })

  if (Range.isCollapsed(selection) && !startVoid) {
    return
  }

  const coveredBoundaries = DOMCoverage.getBoundariesForRange(editor, selection)

  if (coveredBoundaries.some((boundary) => boundary.copyPolicy !== 'exclude')) {
    writeModelBackedSelectionData(editor, data, clipboardFormatKey)
    return
  }

  // Create a fake selection so that we can add a Base64-encoded copy of the
  // fragment to the HTML, to decode on future pastes.
  let domRange: globalThis.Range

  try {
    domRange = DOMEditor.toDOMRange(editor, selection)
  } catch {
    writeModelBackedSelectionData(editor, data, clipboardFormatKey)
    return
  }
  let contents = domRange.cloneContents()
  let attach = contents.childNodes[0] as HTMLElement

  // Make sure attach is non-empty, since empty nodes will not get copied.
  contents.childNodes.forEach((node) => {
    if (node.textContent && node.textContent.trim() !== '') {
      attach = node as HTMLElement
    }
  })

  // COMPAT: If the end node is a void node, we need to move the end of the
  // range from the void node's spacer span, to the end of the void node's
  // content, since the spacer is before void's content in the DOM.
  if (endVoid) {
    const [voidNode] = endVoid
    const r = domRange.cloneRange()
    const domNode = DOMEditor.toDOMNode(editor, voidNode)
    r.setEndAfter(domNode)
    contents = r.cloneContents()
  }

  // COMPAT: If the start node is a void node, we need to attach the encoded
  // fragment to the void node's content node instead of the spacer, because
  // attaching it to empty `<div>/<span>` nodes will end up having it erased by
  // most browsers. (2018/04/27)
  if (startVoid) {
    attach = contents.querySelector('[data-slate-spacer]')! as HTMLElement
  }

  // Remove any zero-width space spans from the cloned DOM so that they don't
  // show up elsewhere when pasted.
  Array.from(contents.querySelectorAll('[data-slate-zero-width]')).forEach(
    (zw) => {
      const isNewline = zw.getAttribute('data-slate-zero-width') === 'n'
      zw.textContent = isNewline ? '\n' : ''
    }
  )

  stripRenderOnlyLeafWrappers(contents)

  // Set a `data-slate-fragment` attribute on a non-empty node, so it shows up
  // in the HTML, and can be used for intra-Slate pasting. If it's a text
  // node, wrap it in a `<span>` so we have something to set an attribute on.
  if (isDOMText(attach)) {
    const span = attach.ownerDocument.createElement('span')
    // COMPAT: In Chrome and Safari, if we don't add the `white-space` style
    // then leading and trailing spaces will be ignored. (2017/09/21)
    span.style.whiteSpace = 'pre'
    span.appendChild(attach)
    contents.appendChild(span)
    attach = span
  }

  const fragment = editor.read((state) => state.fragment.get())
  const string = JSON.stringify(fragment)
  const encoded = DOMEditor.getWindow(editor).btoa(encodeURIComponent(string))
  attach.setAttribute('data-slate-fragment', encoded)
  data.setData(`application/${clipboardFormatKey}`, encoded)

  // Add the content to a <div> so that we can get its inner HTML.
  const div = contents.ownerDocument.createElement('div')
  div.appendChild(contents)
  div.setAttribute('hidden', 'true')
  contents.ownerDocument.body.appendChild(div)
  data.setData('text/html', div.innerHTML)
  data.setData('text/plain', getPlainText(div))
  contents.ownerDocument.body.removeChild(div)
  return data
}

export const insertDOMData = <V extends Value>(
  editor: DOMEditor<V>,
  data: DataTransfer
) => {
  const handlers = Editor.getExtensionRegistry(editor).capabilities.get(
    'dom.clipboard.insertData'
  ) as DOMClipboardInsertDataHandler[] | undefined

  for (const handler of handlers ?? []) {
    if (handler(editor, data)) {
      return
    }
  }

  if (!insertDOMFragmentData(editor, data)) {
    insertDOMTextData(editor, data)
  }
}

export const insertDOMFragmentData = <V extends Value>(
  editor: DOMEditor<V>,
  data: DataTransfer
): boolean => {
  const clipboardFormatKey = getDOMClipboardFormatKey(editor)
  const fragment =
    data.getData(`application/${clipboardFormatKey}`) ||
    getSlateFragmentAttribute(data)

  if (fragment) {
    const decoded = decodeURIComponent(
      DOMEditor.getWindow(editor).atob(fragment)
    )
    const parsed = JSON.parse(decoded) as DescendantIn<V>[]
    getEditorTransformRegistry(editor).insertFragment(parsed)
    return true
  }
  return false
}

export const insertDOMTextData = (
  editor: DOMEditor<any>,
  data: DataTransfer
): boolean => {
  const text = data.getData('text/plain')

  if (text) {
    const lines = text.split(NEWLINE_SPLIT_RE)
    let split = false

    for (const line of lines) {
      if (split) {
        getEditorTransformRegistry(editor).splitNodes({ always: true })
      }

      getEditorTransformRegistry(editor).insertText(line)
      split = true
    }
    return true
  }
  return false
}
