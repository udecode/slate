import type { Editor } from '../interfaces/editor'
import type { WithEditorFirstArg } from '../utils/types'

export const shouldNormalize: WithEditorFirstArg<Editor['shouldNormalize']> = (
  _editor,
  _options
) => true
