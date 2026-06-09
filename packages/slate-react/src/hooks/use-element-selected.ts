import { useCallback, useContext } from 'react'
import { type Operation, type Path, RangeApi, type SnapshotChange } from 'slate'
import { ElementPathContext, NodeRuntimeIdContext } from '../context'
import { Editor } from '../editable/runtime-editor-api'
import { readRuntimeSelection } from '../editable/runtime-selection-state'
import { ReactEditor, type ReactRuntimeEditor } from '../plugin/react-editor'
import { useEditorSelector } from './use-editor-selector'
import { useOptionalElementContext } from './use-element'

export type UseElementSelectedMode = 'collapsed' | 'intersects'

export type UseElementSelectedOptions = {
  at?: Path | null
  mode?: UseElementSelectedMode
}

export const useElementSelected = ({
  at: path,
  mode = 'intersects',
}: UseElementSelectedOptions = {}): boolean => {
  const element = useOptionalElementContext()
  const contextPath = useContext(ElementPathContext)
  const runtimeId = useContext(NodeRuntimeIdContext)

  const selector = useCallback(
    (editor: ReactRuntimeEditor) => {
      if (!element && !path) return false

      const selection = readRuntimeSelection(editor)

      if (!selection) return false
      if (mode === 'collapsed' && !RangeApi.isCollapsed(selection)) return false
      const selectedPath =
        path ??
        (runtimeId ? Editor.getPathByRuntimeId(editor, runtimeId) : null) ??
        contextPath ??
        (element ? ReactEditor.resolvePath(editor, element) : null)
      if (!selectedPath) return false
      if (!Editor.hasPath(editor, selectedPath)) return false

      const range = Editor.range(editor, selectedPath)
      return !!RangeApi.intersection(range, selection)
    },
    [contextPath, element, mode, path, runtimeId]
  )

  const shouldUpdate = useCallback(
    (_operations?: readonly Operation[], change?: SnapshotChange) => {
      if (path) {
        return (
          !change ||
          change.fullDocumentChanged ||
          change.rootRuntimeIdsChanged ||
          change.selectionChanged ||
          change.structureChanged ||
          change.topLevelOrderChanged
        )
      }

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
    [path, runtimeId]
  )

  return useEditorSelector(selector, undefined, {
    deferred: true,
    profileId: 'element-selected',
    shouldUpdate,
  })
}
