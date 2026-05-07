import { useEffect, useMemo, useRef } from 'react'
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
  const optionsRef = useRef(options)
  optionsRef.current = options

  const source = useMemo(() => {
    const initialOptions = optionsRef.current

    return createDecorationSource<T>(editor, {
      ...initialOptions,
      read: (context) => optionsRef.current.read(context),
      runtimeScope: initialOptions.runtimeScope
        ? (context) => {
            const runtimeScope = optionsRef.current.runtimeScope

            if (!runtimeScope) {
              return null
            }

            return typeof runtimeScope === 'function'
              ? runtimeScope(context)
              : runtimeScope
          }
        : undefined,
    })
  }, [editor, options.id])

  useEffect(() => () => source.destroy(), [source])

  return source
}
