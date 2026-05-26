import { type Descendant, NodeApi, RangeApi } from 'slate'
import { getDOMClipboardFormatKey } from 'slate-dom/internal'

import {
  isSlateViewSelectionCollapsed,
  readSlateViewSelection,
} from '../view-selection'
import { createProjectedSelectionTarget } from './projected-selection-target'
import type { Editor as RuntimeEditor } from './runtime-editor-api'

const SLATE_FRAGMENT_FORMAT_ATTRIBUTE = 'data-slate-fragment-format'

const escapeHtmlText = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

const escapeHtmlAttribute = (text: string) =>
  escapeHtmlText(text).replaceAll('"', '&quot;')

const getFragmentText = (fragment: readonly Descendant[]) =>
  fragment.map((node) => NodeApi.string(node)).join('\n')

const encodeClipboardFragment = (fragment: readonly Descendant[]) =>
  globalThis.btoa(encodeURIComponent(JSON.stringify(fragment)))

export const getProjectedViewSelectionFragment = (
  editor: RuntimeEditor
): Descendant[] | null => {
  const viewSelection = readSlateViewSelection(editor)

  if (!viewSelection || isSlateViewSelectionCollapsed(viewSelection)) {
    return null
  }

  const target = createProjectedSelectionTarget(editor, viewSelection)

  if (!target) {
    return null
  }

  return editor.read((state) =>
    target.ranges.flatMap((range) =>
      RangeApi.isCollapsed(range) ? [] : state.fragment.get({ at: range })
    )
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
  const clipboardFormatKey = getDOMClipboardFormatKey(editor)
  const escapedClipboardFormatKey = escapeHtmlAttribute(clipboardFormatKey)

  data.setData(`application/${clipboardFormatKey}`, encoded)
  data.setData('text/plain', text)
  data.setData(
    'text/html',
    `<span data-slate-fragment="${encoded}" ${SLATE_FRAGMENT_FORMAT_ATTRIBUTE}="${escapedClipboardFormatKey}">${escapeHtmlText(text)}</span>`
  )

  return true
}
