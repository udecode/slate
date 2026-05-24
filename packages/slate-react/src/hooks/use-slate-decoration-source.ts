import { useEffect, useMemo, useRef } from 'react'
import type { Editor as SlateEditor } from 'slate'

import {
  createDecorationSource,
  type SlateDecorationSource,
  type SlateDecorationSourceOptions,
  type SlateRangeDecorationSourceOptions,
  toSlateRangeDecorations,
} from '../decoration-source'
import { ReactEditor, type ReactRuntimeEditor } from '../plugin/react-editor'
import type { SlateSourceDirtiness } from '../projection-store'

export type UseSlateDecorationSourceOptions<T = unknown> =
  SlateDecorationSourceOptions<T> & {
    /**
     * Controls when the hook refreshes the source for inline option closures.
     */
    deps?: readonly unknown[]
  }

export type UseSlateRangeDecorationSourceOptions<T = unknown> =
  SlateRangeDecorationSourceOptions<T> & {
    /**
     * Controls when the hook refreshes the source for inline option closures.
     */
    deps?: readonly unknown[]
  }

const getDirtinessIdentity = (dirtiness: SlateSourceDirtiness | undefined) => {
  if (!Array.isArray(dirtiness)) {
    return dirtiness
  }

  return `list:${[...new Set(dirtiness)].sort().join('|')}`
}

const useStableDirtiness = (dirtiness: SlateSourceDirtiness | undefined) => {
  const dirtinessIdentity = getDirtinessIdentity(dirtiness)

  // Structural dirtiness owns source identity for inline class lists.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => dirtiness, [dirtinessIdentity])
}

const isReactEditorFocused = (editor: SlateEditor) =>
  ReactEditor.isFocused(editor as unknown as ReactRuntimeEditor)

export const useSlateDecorationSource = <T = unknown>(
  editor: SlateEditor,
  options: UseSlateDecorationSourceOptions<T>
): SlateDecorationSource<T> => {
  const optionsCell = useRef(options)
  optionsCell.current = options
  const optionsId = options.id
  const dirtiness = useStableDirtiness(options.dirtiness)
  const refreshDeps = options.deps ?? [options]
  const runtimeScope = options.runtimeScope

  const source = useMemo(() => {
    return createDecorationSource<T>(editor, {
      dirtiness,
      id: optionsId,
      read: (context) => optionsCell.current.read(context),
      runtimeScope: runtimeScope
        ? (context) => {
            const runtimeScope = optionsCell.current.runtimeScope

            if (!runtimeScope) {
              return null
            }

            return typeof runtimeScope === 'function'
              ? runtimeScope(context)
              : runtimeScope
          }
        : undefined,
    })
  }, [dirtiness, editor, optionsCell, optionsId, runtimeScope])

  useEffect(() => () => source.destroy(), [source])
  useEffect(() => {
    source.refresh({
      forceInvalidate: true,
      reason: 'external',
      requiresDOMSelectionExport: isReactEditorFocused(editor),
    })
    // `deps` intentionally owns inline option closure freshness.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, refreshDeps)

  return source
}

export const useSlateRangeDecorationSource = <T = unknown>(
  editor: SlateEditor,
  options: UseSlateRangeDecorationSourceOptions<T>
): SlateDecorationSource<T> => {
  const optionsCell = useRef(options)
  optionsCell.current = options
  const optionsId = options.id
  const dirtiness = useStableDirtiness(options.dirtiness)
  const refreshDeps = options.deps ?? [options]
  const runtimeScope = options.runtimeScope

  const source = useMemo(() => {
    return createDecorationSource<T>(editor, {
      dirtiness,
      id: optionsId,
      read: (context) =>
        toSlateRangeDecorations(optionsCell.current.read(context), {
          data: optionsCell.current.data,
          id: optionsId,
        }),
      runtimeScope: runtimeScope
        ? (context) => {
            const runtimeScope = optionsCell.current.runtimeScope

            if (!runtimeScope) {
              return null
            }

            return typeof runtimeScope === 'function'
              ? runtimeScope(context)
              : runtimeScope
          }
        : undefined,
    })
  }, [dirtiness, editor, optionsCell, optionsId, runtimeScope])

  useEffect(() => () => source.destroy(), [source])
  useEffect(() => {
    source.refresh({
      forceInvalidate: true,
      reason: 'external',
      requiresDOMSelectionExport: isReactEditorFocused(editor),
    })
    // `deps` intentionally owns inline option closure freshness.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, refreshDeps)

  return source
}
