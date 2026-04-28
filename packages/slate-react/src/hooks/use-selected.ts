import { useCallback, useContext } from 'react'
import { Editor, type Operation, Range, type SnapshotChange } from 'slate'
import { ElementPathContext, NodeRuntimeIdContext } from '../context'
import { readRuntimeSelection } from '../editable/runtime-selection-state'
import { ReactEditor } from '../plugin/react-editor'
import { useElementIf } from './use-element'
import { useSlateSelector } from './use-slate-selector'

export const useSelected = (): boolean => {
  const element = useElementIf()
  const contextPath = useContext(ElementPathContext)
  const runtimeId = useContext(NodeRuntimeIdContext)

  if (!element) return false

  const selector = useCallback(
    (editor: ReactEditor) => {
      const selection = readRuntimeSelection(editor)

      if (!selection) return false
      const path = contextPath ?? ReactEditor.findPath(editor, element)
      const range = Editor.range(editor, path)
      return !!Range.intersection(range, selection)
    },
    [contextPath, element]
  )

  const shouldUpdate = useCallback(
    (_operations?: readonly Operation[], change?: SnapshotChange) => {
      if (!runtimeId || !change) {
        return true
      }

      if (change.selectionImpactRuntimeIds === null) {
        return true
      }

      return change.selectionImpactRuntimeIds.includes(runtimeId)
    },
    [runtimeId]
  )

  return useSlateSelector(selector, undefined, {
    deferred: true,
    shouldUpdate,
  })
}
