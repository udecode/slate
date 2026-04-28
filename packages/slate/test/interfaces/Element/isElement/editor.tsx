import { Element } from 'slate'

export const input = {
  children: [],
  operations: [],
  selection: null,
  marks: null,
  addMark() {},
  applyOperations() {},
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
}
export const test = (value) => {
  return Element.isElement(value)
}
export const output = false
