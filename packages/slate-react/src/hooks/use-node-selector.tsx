import { useCallback, useContext } from 'react'
import {
  type Node,
  type Operation,
  type Path,
  type RuntimeId,
  type SnapshotChange,
  Text,
} from 'slate'
import { NodeRuntimeIdContext } from '../context'
import { readRuntimeNodeById } from '../editable/runtime-live-state'
import type { ReactEditor } from '../plugin/react-editor'
import { useSlateSelector } from './use-slate-selector'

const refEquality = (a: unknown, b: unknown) => a === b

export type SlateNodeSelectorContext = {
  editor: ReactEditor
  node: Node | null
  path: Path | null
  runtimeId: RuntimeId | null
}

export type SlateTextSelectorContext = SlateNodeSelectorContext & {
  text: Text | null
}

export type SlateRuntimeSelectorOptions = {
  deferred?: boolean
  runtimeId?: RuntimeId | null
}

type SlateRuntimeSelectorUpdatePolicy =
  | 'model-truth'
  | 'skip-synced-text-render'

type InternalSlateRuntimeSelectorOptions = SlateRuntimeSelectorOptions & {
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
  selector: (context: SlateNodeSelectorContext) => T,
  equalityFn: (a: T | null, b: T) => boolean = refEquality,
  {
    deferred = false,
    runtimeId: runtimeIdProp,
    updatePolicy = 'model-truth',
  }: InternalSlateRuntimeSelectorOptions = {}
): T {
  const contextRuntimeId = useContext(NodeRuntimeIdContext)
  const runtimeId = runtimeIdProp ?? contextRuntimeId
  const nodeSelector = useCallback(
    (editor: ReactEditor) => {
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

  return useSlateSelector(nodeSelector, equalityFn, {
    deferred,
    shouldUpdate,
  })
}

export function useNodeSelector<T>(
  selector: (context: SlateNodeSelectorContext) => T,
  equalityFn: (a: T | null, b: T) => boolean = refEquality,
  options: SlateRuntimeSelectorOptions = {}
): T {
  return useRuntimeNodeSelector(selector, equalityFn, options)
}

export function useMountedNodeRenderSelector<T>(
  selector: (context: SlateNodeSelectorContext) => T,
  equalityFn: (a: T | null, b: T) => boolean = refEquality,
  options: SlateRuntimeSelectorOptions = {}
): T {
  return useRuntimeNodeSelector(selector, equalityFn, {
    ...options,
    updatePolicy: 'skip-synced-text-render',
  })
}

export function useTextSelector<T>(
  selector: (context: SlateTextSelectorContext) => T,
  equalityFn: (a: T | null, b: T) => boolean = refEquality,
  options: SlateRuntimeSelectorOptions = {}
): T {
  const textSelector = useCallback(
    (context: SlateNodeSelectorContext) =>
      selector({
        ...context,
        text: context.node && Text.isText(context.node) ? context.node : null,
      }),
    [selector]
  )

  return useNodeSelector(textSelector, equalityFn, options)
}

export function useMountedTextRenderSelector<T>(
  selector: (context: SlateTextSelectorContext) => T,
  equalityFn: (a: T | null, b: T) => boolean = refEquality,
  options: SlateRuntimeSelectorOptions = {}
): T {
  const textSelector = useCallback(
    (context: SlateNodeSelectorContext) =>
      selector({
        ...context,
        text: context.node && Text.isText(context.node) ? context.node : null,
      }),
    [selector]
  )

  return useMountedNodeRenderSelector(textSelector, equalityFn, options)
}
