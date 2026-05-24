import type {
  EditorStateField,
  StateFieldDescriptor,
} from '../interfaces/editor'
import { registerStateField } from './public-state'

export const defineStateField = <TValue>(
  descriptor: StateFieldDescriptor<TValue>
): EditorStateField<TValue> => {
  const field = {
    ...descriptor,
    name: `state-field:${descriptor.key}`,
    options: descriptor,
    setup({ editor }) {
      registerStateField(editor, field)
    },
  } satisfies EditorStateField<TValue>

  return field
}
