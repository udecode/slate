import { useCallback, useContext } from 'react'
import { type Operation, Path, Range, type SnapshotChange } from 'slate'
import { ElementPathContext, NodeRuntimeIdContext } from '../context'
import { Editor } from '../editable/runtime-editor-api'
import { readRuntimeSelection } from '../editable/runtime-selection-state'
import { ReactEditor } from '../plugin/react-editor'
import { useEditorSelector } from './use-editor-selector'
import { useOptionalElementContext } from './use-element'

export type UseElementSelectedMode = 'collapsed' | 'intersects'

export type UseElementSelectedOptions = {
  at?: Path | null
  mode?: UseElementSelectedMode
}

const isUseElementSelectedOptions = (
  value: Path | UseElementSelectedOptions | undefined
): value is UseElementSelectedOptions => Boolean(value && !Path.isPath(value))

export const useElementSelected = (
  target?: Path | UseElementSelectedOptions
): boolean => {
  const element = useOptionalElementContext()
  const contextPath = useContext(ElementPathContext)
  const runtimeId = useContext(NodeRuntimeIdContext)
  let path: Path | null | undefined
  let mode: UseElementSelectedMode = 'intersects'

  if (isUseElementSelectedOptions(target)) {
    path = target.at
    mode = target.mode ?? 'intersects'
  } else {
    path = target
  }

  const selector = useCallback(
    (editor: ReactEditor) => {
      if (!element && !path) return false

      const selection = readRuntimeSelection(editor)

      if (!selection) return false
      if (mode === 'collapsed' && !Range.isCollapsed(selection)) return false
      const selectedPath =
        path ??
        contextPath ??
        (element ? ReactEditor.findPath(editor, element) : null)
      if (!selectedPath) return false
      if (!Editor.hasPath(editor, selectedPath)) return false

      const range = Editor.range(editor, selectedPath)
      return !!Range.intersection(range, selection)
    },
    [contextPath, element, mode, path]
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
