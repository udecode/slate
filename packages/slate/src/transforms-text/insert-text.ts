import {
  applyOperation,
  getPublicSelection,
  syncImplicitTargetToCurrentSelection,
} from '../core/public-state'
import { getEditorTransformRegistry } from '../core/transform-registry'
import { elementReadOnly } from '../editor/element-read-only'
import {
  Location,
  Range,
  type Editor as SlateEditor,
  type Value,
} from '../interfaces'
import { Editor } from '../interfaces/editor'
import type {
  TextInsertTextOptions,
  TextMutationMethods,
} from '../interfaces/transforms/text'
import { getDefaultInsertLocation } from '../utils'

const samePoint = (
  left: { offset: number; path: readonly number[] },
  right: { offset: number; path: readonly number[] }
) =>
  left.offset === right.offset &&
  left.path.length === right.path.length &&
  left.path.every((segment, index) => segment === right.path[index])

const isFullDocumentRange = (editor: SlateEditor, range: Range) => {
  if (Editor.getChildren(editor).length === 0) {
    return false
  }

  const start = Editor.point(editor, [], { edge: 'start' })
  const end = Editor.point(editor, [], { edge: 'end' })

  return (
    (samePoint(range.anchor, start) && samePoint(range.focus, end)) ||
    (samePoint(range.anchor, end) && samePoint(range.focus, start))
  )
}

const createFullDocumentTextReplacement = (
  editor: SlateEditor,
  text: string
) => {
  const first = Editor.getChildren(editor)[0]

  if (first && 'children' in first) {
    return [
      {
        ...first,
        children: [{ text }],
      },
    ]
  }

  return [{ text }]
}

export const applyInsertText: TextMutationMethods['insertText'] = (
  editor,
  text,
  options: TextInsertTextOptions = {}
) => {
  const { voids = false } = options
  const defaultAt = options.at ?? getDefaultInsertLocation(editor)
  const preflightAt = (() => {
    if (Location.isPath(defaultAt)) {
      return Editor.range(editor, defaultAt)
    }

    if (Location.isRange(defaultAt) && Range.isCollapsed(defaultAt)) {
      return defaultAt.anchor
    }

    return defaultAt
  })()

  if (
    Location.isPoint(preflightAt) &&
    ((!voids && Editor.void(editor, { at: preflightAt })) ||
      elementReadOnly(editor, { at: preflightAt }))
  ) {
    return
  }

  if (
    text.length > 0 &&
    Location.isRange(defaultAt) &&
    !Range.isCollapsed(defaultAt) &&
    isFullDocumentRange(editor, defaultAt)
  ) {
    applyOperation(editor, {
      children: [...Editor.getChildren(editor)] as Value,
      index: 0,
      newChildren: createFullDocumentTextReplacement(editor, text) as Value,
      newSelection: {
        anchor: { path: [0, 0], offset: text.length },
        focus: { path: [0, 0], offset: text.length },
      },
      path: [],
      selection: getPublicSelection(editor),
      type: 'replace_children',
    })
    syncImplicitTargetToCurrentSelection(editor)
    return
  }

  Editor.withoutNormalizing(editor, () => {
    const transforms = getEditorTransformRegistry(editor)
    const preserveNullSelection =
      options.at != null && getPublicSelection(editor) == null
    let { at = getDefaultInsertLocation(editor) } = options

    if (Location.isPath(at)) {
      at = Editor.range(editor, at)
    }

    if (Location.isRange(at)) {
      if (Range.isCollapsed(at)) {
        at = at.anchor
      } else {
        const end = Range.end(at)
        if (!voids && Editor.void(editor, { at: end })) {
          return
        }
        const start = Range.start(at)
        const startRef = Editor.pointRef(editor, start)
        const endRef = Editor.pointRef(editor, end)
        transforms.delete({ at, voids })
        const selectionAfterDelete = getPublicSelection(editor)
        const selectionPointAfterDelete =
          selectionAfterDelete && Range.isCollapsed(selectionAfterDelete)
            ? {
                offset: selectionAfterDelete.anchor.offset,
                path: [...selectionAfterDelete.anchor.path],
              }
            : null
        const startPoint = startRef.unref()
        const endPoint = endRef.unref()
        const nextAt = selectionPointAfterDelete ?? startPoint ?? endPoint

        if (!nextAt) {
          return
        }

        at = nextAt

        if (options.at == null) {
          transforms.setSelection({ anchor: nextAt, focus: nextAt })
        } else if (preserveNullSelection) {
          transforms.deselect()
        }
      }
    }

    if (!Location.isPoint(at)) {
      return
    }

    if (
      (!voids && Editor.void(editor, { at })) ||
      elementReadOnly(editor, { at })
    ) {
      return
    }

    const { path, offset } = at
    if (text.length > 0) {
      applyOperation(editor, { type: 'insert_text', path, offset, text })
    }
  })
}
