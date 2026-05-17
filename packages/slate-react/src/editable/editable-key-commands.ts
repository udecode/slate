import type React from 'react'
import type { Range } from 'slate'
import type { EditableHandlerResult } from '../components/editable'
import type { ReactRuntimeEditor } from '../plugin/react-editor'
import { type Editor, getEditorExtensionRegistry } from './runtime-editor-api'

export const EDITABLE_KEY_COMMAND_CAPABILITY = 'slate-react.editable.keyCommand'

export type EditableKeyCommandContext = {
  editor: ReactRuntimeEditor
  event: React.KeyboardEvent<HTMLDivElement>
  selection: Range | null
}

export type EditableKeyCommand = (
  context: EditableKeyCommandContext
) => EditableHandlerResult

export const editableKeyCommands = (
  ...commands: readonly EditableKeyCommand[]
): Record<string, readonly EditableKeyCommand[]> => ({
  [EDITABLE_KEY_COMMAND_CAPABILITY]: commands,
})

const isEditableKeyCommand = (value: unknown): value is EditableKeyCommand =>
  typeof value === 'function'

export const getEditableKeyCommands = (
  editor: Editor
): readonly EditableKeyCommand[] =>
  (
    getEditorExtensionRegistry(editor).capabilities.get(
      EDITABLE_KEY_COMMAND_CAPABILITY
    ) ?? []
  ).filter(isEditableKeyCommand)
