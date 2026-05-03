/** @jsx jsx */

import { Element } from 'slate'

export const input = [
  {
    children: [],
    operations: [],
    selection: null,
    marks: null,
    addMark() {},
    deleteBackward() {},
    deleteForward() {},
    deleteFragment() {},
    insertBreak() {},
    insertSoftBreak() {},
    insertFragment() {},
    insertNode() {},
    insertText() {},
    isElementReadOnly() {},
    isInline() {},
    isSelectable() {},
    isVoid() {},
    normalizeNode() {},
    removeMark() {},
    getDirtyPaths() {},
  },
]
export const test = (value) => {
  return Element.isElementList(value)
}
export const output = false
