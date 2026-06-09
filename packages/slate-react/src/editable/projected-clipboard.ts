import { type Descendant, NodeApi, type Range, RangeApi } from 'slate'
import { getDOMClipboardFormatKey } from 'slate-dom/internal'

import { resolveSlateViewBoundarySegmentEndpoint } from '../view-boundary-graph'
import {
  isSlateViewSelectionCollapsed,
  readSlateViewSelection,
  type SlateViewSelection,
} from '../view-selection'
import type { Editor as RuntimeEditor } from './runtime-editor-api'

const DEFAULT_SLATE_CLIPBOARD_FORMAT_KEY = 'x-slate-fragment'
const SLATE_FRAGMENT_FORMAT_ATTRIBUTE = 'data-slate-fragment-format'

const escapeHtmlText = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

const escapeHtmlAttribute = (text: string) =>
  escapeHtmlText(text).replaceAll('"', '&quot;')

const getFragmentText = (fragment: readonly Descendant[]) =>
  fragment.map((node) => NodeApi.string(node)).join('\n')

const encodeClipboardFragment = (fragment: readonly Descendant[]) =>
  globalThis.btoa(encodeURIComponent(JSON.stringify(fragment)))

const getCanonicalRuntimeEditor = (editor: RuntimeEditor): RuntimeEditor =>
  ((editor as { runtime?: { editor?: RuntimeEditor } }).runtime?.editor ??
    editor) as RuntimeEditor

const getProjectedClipboardFormatKey = (editor: RuntimeEditor) => {
  const viewEditorKey = getDOMClipboardFormatKey(editor)

  return viewEditorKey === DEFAULT_SLATE_CLIPBOARD_FORMAT_KEY
    ? getDOMClipboardFormatKey(getCanonicalRuntimeEditor(editor))
    : viewEditorKey
}

const getProjectedViewSelectionClipboardRanges = (
  editor: RuntimeEditor,
  viewSelection: SlateViewSelection
): Range[] | null =>
  editor.read((state) => {
    const roots = state.value.get().roots
    const ranges: Range[] = []

    for (const segment of viewSelection.segments.parts) {
      const anchor = resolveSlateViewBoundarySegmentEndpoint(
        roots,
        segment,
        segment.start
      )
      const focus = resolveSlateViewBoundarySegmentEndpoint(
        roots,
        segment,
        segment.end
      )

      if (!anchor || !focus) {
        return null
      }

      const range = { anchor, focus }

      if (!RangeApi.isCollapsed(range)) {
        ranges.push(range)
      }
    }

    return ranges
  })

export const getProjectedViewSelectionFragment = (
  editor: RuntimeEditor
): Descendant[] | null => {
  const viewSelection = readSlateViewSelection(editor)

  if (!viewSelection || isSlateViewSelectionCollapsed(viewSelection)) {
    return null
  }

  const ranges = getProjectedViewSelectionClipboardRanges(editor, viewSelection)

  if (!ranges) {
    return null
  }

  return editor.read((state) =>
    ranges.flatMap((range) => state.fragment.get({ at: range }))
  )
}

export const writeProjectedViewSelectionClipboardData = (
  editor: RuntimeEditor,
  data: Pick<DataTransfer, 'setData'>
) => {
  const fragment = getProjectedViewSelectionFragment(editor)

  if (!fragment || fragment.length === 0) {
    return false
  }

  const encoded = encodeClipboardFragment(fragment)
  const text = getFragmentText(fragment)
  const clipboardFormatKey = getProjectedClipboardFormatKey(editor)
  const escapedClipboardFormatKey = escapeHtmlAttribute(clipboardFormatKey)

  data.setData(`application/${clipboardFormatKey}`, encoded)
  data.setData('text/plain', text)
  data.setData(
    'text/html',
    `<span data-slate-fragment="${encoded}" ${SLATE_FRAGMENT_FORMAT_ATTRIBUTE}="${escapedClipboardFormatKey}">${escapeHtmlText(text)}</span>`
  )

  return true
}
