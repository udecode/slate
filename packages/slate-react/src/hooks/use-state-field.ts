import { useCallback } from 'react'
import type {
  Editor,
  EditorStateField,
  EditorUpdateOptions,
  StateFieldValueInput,
} from 'slate'

import { useEditor } from './use-editor'
import {
  type EditorStateSelectorOptions,
  useEditorState,
} from './use-editor-selector'

export type UseStateFieldValueOptions<
  TValue,
  TEditor extends Editor<any> = Editor<any>,
> = Pick<EditorStateSelectorOptions<TValue, TEditor>, 'deferred' | 'equalityFn'>

export type StateFieldSetter<TValue> = (
  value: StateFieldValueInput<TValue>,
  options?: EditorUpdateOptions
) => void

const getStateFieldSetterOptions = (
  options: EditorUpdateOptions = {}
): EditorUpdateOptions => ({
  ...options,
  metadata: {
    ...options.metadata,
    selection: {
      dom: 'preserve',
      focus: false,
      scroll: false,
      ...options.metadata?.selection,
    },
  },
})

export function useStateFieldValue<
  TValue,
  TEditor extends Editor<any> = Editor<any>,
>(
  field: EditorStateField<TValue>,
  options: UseStateFieldValueOptions<TValue, TEditor> = {}
): TValue {
  return useEditorState<TValue, TEditor>((state) => state.getField(field), {
    ...options,
    deps: [field],
    shouldUpdate: (change) =>
      Boolean(change?.dirtyStateKeys.includes(field.key)),
  })
}

export function useSetStateField<
  TValue,
  TEditor extends Editor<any> = Editor<any>,
>(field: EditorStateField<TValue>): StateFieldSetter<TValue> {
  const editor = useEditor<TEditor>()

  return useCallback(
    (value: StateFieldValueInput<TValue>, options?: EditorUpdateOptions) => {
      editor.update((tx) => {
        tx.setField(field, value)
      }, getStateFieldSetterOptions(options))
    },
    [editor, field]
  )
}
