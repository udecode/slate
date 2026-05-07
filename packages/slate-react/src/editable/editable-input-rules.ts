import type { EditableInputRule } from '../components/editable'
import { type Editor, getEditorExtensionRegistry } from './runtime-editor-api'

export const EDITABLE_INPUT_RULE_CAPABILITY = 'slate-react.editable.inputRule'

export const editableInputRules = (
  ...rules: readonly EditableInputRule[]
): Record<string, readonly EditableInputRule[]> => ({
  [EDITABLE_INPUT_RULE_CAPABILITY]: rules,
})

const isEditableInputRule = (value: unknown): value is EditableInputRule =>
  typeof value === 'function'

export const getEditableInputRules = (
  editor: Editor,
  inputRules?: readonly EditableInputRule[]
): readonly EditableInputRule[] => {
  const extensionInputRules = (
    getEditorExtensionRegistry(editor).capabilities.get(
      EDITABLE_INPUT_RULE_CAPABILITY
    ) ?? []
  ).filter(isEditableInputRule)

  if (!inputRules?.length) {
    return extensionInputRules
  }

  if (!extensionInputRules.length) {
    return inputRules
  }

  return [...inputRules, ...extensionInputRules]
}
