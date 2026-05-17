import type { ReactRuntimeEditor } from '../plugin/react-editor'

const getLastCommit = (editor: ReactRuntimeEditor) =>
  editor.read((state) => state.value.lastCommit())

export const shouldSkipSelectionScroll = (editor: ReactRuntimeEditor) => {
  const commit = getLastCommit(editor)

  return Boolean(
    commit?.tags.includes('skip-scroll-into-view') ||
      commit?.metadata.selection?.scroll === false
  )
}

export const shouldSkipSelectionFocus = (editor: ReactRuntimeEditor) => {
  const commit = getLastCommit(editor)

  return Boolean(
    commit?.tags.includes('skip-selection-focus') ||
      commit?.metadata.selection?.focus === false
  )
}
