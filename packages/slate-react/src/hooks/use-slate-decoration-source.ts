import { useEffect, useMemo, useState } from 'react'
import type { Editor as SlateEditor } from 'slate'

import {
  createDecorationSource,
  type SlateDecorationSource,
  type SlateDecorationSourceOptions,
} from '../decoration-source'

export const useSlateDecorationSource = <T = unknown>(
  editor: SlateEditor,
  options: SlateDecorationSourceOptions<T>
): SlateDecorationSource<T> => {
  const [optionsCell] = useState(() => ({ current: options }))
  const optionsId = options.id

  const source = useMemo(() => {
    const initialOptions = optionsCell.current

    return createDecorationSource<T>(editor, {
      ...initialOptions,
      id: optionsId,
      read: (context) => optionsCell.current.read(context),
      runtimeScope: initialOptions.runtimeScope
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
  }, [editor, optionsCell, optionsId])

  useEffect(() => () => source.destroy(), [source])
  useEffect(() => {
    optionsCell.current = options
    source.refresh({ forceInvalidate: true, reason: 'external' })
  }, [options, optionsCell, source])

  return source
}
