import { useCallback, useContext } from 'react'
import { type Operation, type Path, Range, type SnapshotChange } from 'slate'
import { ElementPathContext, NodeRuntimeIdContext } from '../context'
import { Editor } from '../editable/runtime-editor-api'
import { readRuntimeSelection } from '../editable/runtime-selection-state'
import { ReactEditor } from '../plugin/react-editor'
import { useEditorSelector } from './use-editor-selector'
import { useElementIf } from './use-element'

export const useElementSelected = (target?: Path): boolean => {
  const element = useElementIf()
  const contextPath = useContext(ElementPathContext)
  const runtimeId = useContext(NodeRuntimeIdContext)

  if (!element && !target) return false

  const selector = useCallback(
    (editor: ReactEditor) => {
      const selection = readRuntimeSelection(editor)

      if (!selection) return false
      const path =
        target ??
        contextPath ??
        (element ? ReactEditor.findPath(editor, element) : null)
      if (!path) return false

      const range = Editor.range(editor, path)
      return !!Range.intersection(range, selection)
    },
    [contextPath, element, target]
  )

  const shouldUpdate = useCallback(
    (_operations?: readonly Operation[], change?: SnapshotChange) => {
      if (!runtimeId || !change) {
        return true
      }

      if (
        change.fullDocumentChanged ||
        change.rootRuntimeIdsChanged ||
        change.structureChanged ||
        change.topLevelOrderChanged
      ) {
        return true
      }

      if (change.selectionImpactRuntimeIds === null) {
        return true
      }

      return change.selectionImpactRuntimeIds.includes(runtimeId)
    },
    [runtimeId]
  )

  return useEditorSelector(selector, undefined, {
    deferred: true,
    profileId: 'element-selected',
    shouldUpdate,
  })
}
