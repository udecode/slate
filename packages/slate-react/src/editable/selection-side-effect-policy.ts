import type { ReactEditor } from '../plugin/react-editor'

const getLastCommit = (editor: ReactEditor) =>
  editor.read((state) => state.value.lastCommit())

export const shouldSkipSelectionScroll = (editor: ReactEditor) => {
  const commit = getLastCommit(editor)

  return Boolean(
    commit?.tags.includes('skip-scroll-into-view') ||
      commit?.metadata.selection?.scroll === false
  )
}

export const shouldSkipSelectionFocus = (editor: ReactEditor) => {
  const commit = getLastCommit(editor)

  return Boolean(
    commit?.tags.includes('skip-selection-focus') ||
      commit?.metadata.selection?.focus === false
  )
}
