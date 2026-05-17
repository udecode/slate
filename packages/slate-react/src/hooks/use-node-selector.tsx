import { useCallback, useContext } from 'react'
import {
  type Node,
  type Operation,
  type Path,
  type RuntimeId,
  type SnapshotChange,
  type Text,
  TextApi,
} from 'slate'
import { NodeRuntimeIdContext } from '../context'
import { readRuntimeNodeById } from '../editable/runtime-live-state'
import type { ReactRuntimeEditor } from '../plugin/react-editor'
import { useEditorSelector } from './use-editor-selector'

const refEquality = (a: unknown, b: unknown) => a === b

export type EditorNodeSelectorContext = {
  editor: ReactRuntimeEditor
  node: Node | null
  path: Path | null
  runtimeId: RuntimeId | null
}

export type EditorTextSelectorContext = EditorNodeSelectorContext & {
  text: Text | null
}

export type EditorRuntimeSelectorOptions = {
  deferred?: boolean
  runtimeId?: RuntimeId | null
}

type SlateRuntimeSelectorUpdatePolicy =
  | 'model-truth'
  | 'skip-synced-text-render'

type InternalEditorRuntimeSelectorOptions = EditorRuntimeSelectorOptions & {
  updatePolicy?: SlateRuntimeSelectorUpdatePolicy
}

const shouldUpdateRuntimeNode = (
  runtimeId: RuntimeId | null,
  operations?: readonly Operation[],
  change?: SnapshotChange,
  updatePolicy: SlateRuntimeSelectorUpdatePolicy = 'model-truth'
) => {
  if (
    updatePolicy === 'skip-synced-text-render' &&
    operations &&
    operations.length > 0 &&
    operations.every(
      (operation) =>
        operation.type === 'insert_text' ||
        operation.type === 'remove_text' ||
        operation.type === 'set_selection'
    )
  ) {
    return false
  }

  if (!runtimeId || !change) {
    return true
  }

  if (change.nodeImpactRuntimeIds === null) {
    return true
  }

  return change.nodeImpactRuntimeIds.includes(runtimeId)
}

function useRuntimeNodeSelector<T>(
  selector: (context: EditorNodeSelectorContext) => T,
  equalityFn: (a: T | null, b: T) => boolean = refEquality,
  {
    deferred = false,
    runtimeId: runtimeIdProp,
    updatePolicy = 'model-truth',
  }: InternalEditorRuntimeSelectorOptions = {}
): T {
  const contextRuntimeId = useContext(NodeRuntimeIdContext)
  const runtimeId = runtimeIdProp ?? contextRuntimeId
  const nodeSelector = useCallback(
    (editor: ReactRuntimeEditor) => {
      const { node, path } = readRuntimeNodeById(editor, runtimeId)

      return selector({
        editor,
        node,
        path,
        runtimeId,
      })
    },
    [runtimeId, selector]
  )
  const shouldUpdate = useCallback(
    (operations?: readonly Operation[], change?: SnapshotChange) =>
      shouldUpdateRuntimeNode(runtimeId, operations, change, updatePolicy),
    [runtimeId, updatePolicy]
  )

  return useEditorSelector(nodeSelector, equalityFn, {
    deferred,
    profileId: runtimeId ? 'runtime-node' : 'runtime-node-missing-id',
    runtimeId,
    shouldUpdate,
  })
}

export function useNodeSelector<T>(
  selector: (context: EditorNodeSelectorContext) => T,
  equalityFn: (a: T | null, b: T) => boolean = refEquality,
  options: EditorRuntimeSelectorOptions = {}
): T {
  return useRuntimeNodeSelector(selector, equalityFn, options)
}

export function useMountedNodeRenderSelector<T>(
  selector: (context: EditorNodeSelectorContext) => T,
  equalityFn: (a: T | null, b: T) => boolean = refEquality,
  options: EditorRuntimeSelectorOptions = {}
): T {
  return useRuntimeNodeSelector(selector, equalityFn, {
    ...options,
    updatePolicy: 'skip-synced-text-render',
  })
}

export function useTextSelector<T>(
  selector: (context: EditorTextSelectorContext) => T,
  equalityFn: (a: T | null, b: T) => boolean = refEquality,
  options: EditorRuntimeSelectorOptions = {}
): T {
  const textSelector = useCallback(
    (context: EditorNodeSelectorContext) =>
      selector({
        ...context,
        text:
          context.node && TextApi.isText(context.node) ? context.node : null,
      }),
    [selector]
  )

  return useNodeSelector(textSelector, equalityFn, options)
}

export function useMountedTextRenderSelector<T>(
  selector: (context: EditorTextSelectorContext) => T,
  equalityFn: (a: T | null, b: T) => boolean = refEquality,
  options: EditorRuntimeSelectorOptions = {}
): T {
  const textSelector = useCallback(
    (context: EditorNodeSelectorContext) =>
      selector({
        ...context,
        text:
          context.node && TextApi.isText(context.node) ? context.node : null,
      }),
    [selector]
  )

  return useMountedNodeRenderSelector(textSelector, equalityFn, options)
}
