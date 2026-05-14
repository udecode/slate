import { NodeApi, type Range, RangeApi } from 'slate'
import { type DOMText, IS_NODE_MAP_DIRTY } from 'slate-dom'
import { ReactEditor } from '../plugin/react-editor'
import { getInputEventData } from './dom-input-event'
import { Editor } from './runtime-editor-api'

const NATIVE_CHAR_RE = /[a-z ]/i

const hasNativeBlockingMarks = (marks: Record<string, unknown> | null) =>
  marks != null && Object.keys(marks).length > 0

export const canUseNativeSingleCharacterInput = ({
  editor,
  eventData,
  hasAppInputPolicy,
  selection,
}: {
  editor: ReactEditor
  eventData: string | null
  hasAppInputPolicy: boolean
  selection: Range | null
}) => {
  if (
    !selection ||
    !RangeApi.isCollapsed(selection) ||
    // Only use native character insertion for single characters a-z or space for now.
    // Long-press events (hold a + press 4 = ä) to choose a special character otherwise
    // causes duplicate inserts.
    !eventData ||
    eventData.length !== 1 ||
    !NATIVE_CHAR_RE.test(eventData) ||
    hasAppInputPolicy ||
    // Chrome has issues correctly editing the start of nodes: https://bugs.chromium.org/p/chromium/issues/detail?id=1249405
    // When there is an inline element, e.g. a link, and you select
    // right after it (the start of the next node).
    selection.anchor.offset === 0
  ) {
    return false
  }

  // Skip native if there are marks, as
  // `insertText` will insert a node, not just text.
  if (hasNativeBlockingMarks(editor.read((state) => state.marks.get()))) {
    return false
  }

  // If the NODE_MAP is dirty, we can't trust the selection anchor's DOM projection.
  if (IS_NODE_MAP_DIRTY.get(editor)) {
    return false
  }

  // Chrome also has issues correctly editing the end of anchor elements: https://bugs.chromium.org/p/chromium/issues/detail?id=1259100
  // Therefore we don't allow native events to insert text at the end of anchor nodes.
  const { anchor } = selection

  const domPoint = ReactEditor.resolveDOMPoint(editor, anchor)

  if (!domPoint) {
    return false
  }

  const [node, offset] = domPoint
  const textHost = node.parentElement?.closest('[data-slate-node="text"]')

  if (textHost?.getAttribute('data-slate-dom-sync') !== 'true') {
    return false
  }

  const anchorNode = node.parentElement?.closest('a')
  const window = ReactEditor.getWindow(editor)

  if (anchorNode && ReactEditor.hasDOMNode(editor, anchorNode)) {
    // Find the last text node inside the anchor.
    const lastText = window?.document
      .createTreeWalker(anchorNode, NodeFilter.SHOW_TEXT)
      .lastChild() as DOMText | null

    if (lastText === node && lastText.textContent?.length === offset) {
      return false
    }
  }

  // Chrome has issues with the presence of tab characters inside elements with whiteSpace = 'pre'
  // causing abnormal insert behavior: https://bugs.chromium.org/p/chromium/issues/detail?id=1219139
  if (
    node.parentElement &&
    window?.getComputedStyle(node.parentElement)?.whiteSpace === 'pre'
  ) {
    const block = Editor.above(editor, {
      at: anchor.path,
      match: (n) => NodeApi.isElement(n) && Editor.isBlock(editor, n),
    })

    if (block && NodeApi.string(block[0]).includes('\t')) {
      return false
    }
  }

  return true
}

export const getNativeBeforeInputDecision = ({
  editor,
  event,
  hasAppInputPolicy,
  selection,
}: {
  editor: ReactEditor
  event: InputEvent
  hasAppInputPolicy: boolean
  selection: Range | null
}) => {
  const { inputType } = event
  const data = getInputEventData(event) ?? undefined
  const isCompositionChange =
    inputType === 'insertCompositionText' ||
    inputType === 'deleteCompositionText'

  // COMPAT: use composition change events as a hint to where we should insert
  // composition text if we aren't composing to work around https://github.com/ianstormtaylor/slate/issues/5038
  const shouldAbortForCompositionChange =
    isCompositionChange && ReactEditor.isComposing(editor)

  return {
    data,
    inputType,
    isCompositionChange,
    native:
      inputType === 'insertText' &&
      canUseNativeSingleCharacterInput({
        editor,
        eventData: event.data,
        hasAppInputPolicy,
        selection,
      }),
    shouldAbortForCompositionChange,
  }
}
