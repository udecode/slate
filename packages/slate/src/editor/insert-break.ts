import { executeCommand } from '../core/command-registry'
import { getEditorTransformRegistry } from '../core/transform-registry'
import type { EditorStaticApi } from '../interfaces/editor'
import { Editor } from '../interfaces/editor'
import { PathApi } from '../interfaces/path'
import { RangeApi } from '../interfaces/range'

type InsertBreakCommand = {
  type: 'insert_break'
}

const getNextSoftBreakRange = (
  editor: Parameters<EditorStaticApi['insertBreak']>[0]
) => {
  const selection = Editor.getSelection(editor)

  if (!selection || !RangeApi.isCollapsed(selection)) {
    return null
  }

  const point = selection.anchor
  const [leaf] = Editor.leaf(editor, point)

  if (leaf.text[point.offset] !== '\n') {
    return null
  }

  return {
    anchor: point,
    focus: { ...point, offset: point.offset + 1 },
  }
}

const applyInsertBreak: EditorStaticApi['insertBreak'] = (editor) => {
  const transforms = getEditorTransformRegistry(editor)
  const softBreakRange = getNextSoftBreakRange(editor)
  const selection = Editor.getSelection(editor)

  if (softBreakRange) {
    transforms.delete({ at: softBreakRange, hanging: true })
  }

  if (selection && RangeApi.isCollapsed(selection)) {
    const voidEntry = Editor.void(editor, {
      at: selection.anchor,
      mode: 'highest',
    })

    if (voidEntry) {
      const [voidNode, voidPath] = voidEntry

      if (!Editor.isInline(editor, voidNode)) {
        transforms.insertNodes(
          {
            type: 'paragraph',
            children: [{ text: '' }],
          },
          {
            at: PathApi.next(voidPath),
            select: true,
            voids: true,
          }
        )
        return
      }
    }
  }

  transforms.splitNodes({ always: true })
}

export const insertBreak: EditorStaticApi['insertBreak'] = (editor) => {
  executeCommand<InsertBreakCommand>(editor, { type: 'insert_break' }, () => {
    applyInsertBreak(editor)
    return true
  })
}
