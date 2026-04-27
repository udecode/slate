import {
  isInTransaction,
  updateEditor,
  withTransaction,
} from '../core/public-state'
import { Editor, type EditorInterface } from '../interfaces/editor'
import type { Location } from '../interfaces/location'
import { Node } from '../interfaces/node'

const DEFAULT_LIST_TYPES = ['numbered-list', 'bulleted-list'] as const

const runBlockCommand = (editor: Editor, fn: () => void) =>
  isInTransaction(editor) ? fn() : updateEditor(editor, fn)

const isBlockTypeActive = (editor: Editor, type: string, at: Location) => {
  const [match] = Editor.nodes(editor, {
    at,
    match: (node) =>
      Node.isElement(node) &&
      Editor.isBlock(editor, node) &&
      (node as unknown as Record<string, unknown>).type === type,
  })

  return Boolean(match)
}

const isBlockPropertyActive = (
  editor: Editor,
  key: string,
  value: unknown,
  at: Location
) => {
  const [match] = Editor.nodes(editor, {
    at,
    match: (node) =>
      Node.isElement(node) &&
      Editor.isBlock(editor, node) &&
      (node as unknown as Record<string, unknown>)[key] === value,
  })

  return Boolean(match)
}

export const setBlock: EditorInterface['setBlock'] = (
  editor,
  props,
  options = {}
) => {
  runBlockCommand(editor, () => {
    withTransaction(editor, (tx) => {
      const at = tx.resolveTarget({ at: options.at })

      if (!at) {
        return
      }

      editor.setNodes(props, {
        ...options,
        at,
        match: (node) => Node.isElement(node) && Editor.isBlock(editor, node),
      })
    })
  })
}

export const toggleBlock: EditorInterface['toggleBlock'] = (
  editor,
  type,
  { defaultType = 'paragraph', ...options } = {}
) => {
  runBlockCommand(editor, () => {
    withTransaction(editor, (tx) => {
      const at = tx.resolveTarget({ at: options.at })

      if (!at) {
        return
      }

      editor.setBlock(
        {
          type: isBlockTypeActive(editor, type, at) ? defaultType : type,
        } as never,
        {
          ...options,
          at,
        }
      )
    })
  })
}

export const toggleAlignment: EditorInterface['toggleAlignment'] = (
  editor,
  align,
  options = {}
) => {
  runBlockCommand(editor, () => {
    withTransaction(editor, (tx) => {
      const at = tx.resolveTarget({ at: options.at })

      if (!at) {
        return
      }

      editor.setBlock(
        {
          align: isBlockPropertyActive(editor, 'align', align, at)
            ? undefined
            : align,
        } as never,
        {
          ...options,
          at,
        }
      )
    })
  })
}

export const toggleList: EditorInterface['toggleList'] = (
  editor,
  type,
  { itemType = 'list-item', listTypes = DEFAULT_LIST_TYPES, ...options } = {}
) => {
  runBlockCommand(editor, () => {
    withTransaction(editor, (tx) => {
      const at = tx.resolveTarget({ at: options.at })

      if (!at) {
        return
      }

      const isActive = isBlockTypeActive(editor, type, at)

      editor.unwrapNodes({
        at,
        match: (node) =>
          Node.isElement(node) &&
          listTypes.includes(
            (node as unknown as Record<string, unknown>).type as string
          ),
        split: true,
      })
      editor.setBlock(
        {
          type: isActive ? 'paragraph' : itemType,
        } as never,
        {
          ...options,
          at,
        }
      )

      if (!isActive) {
        editor.wrapNodes({ type, children: [] } as never, {
          ...options,
          at,
        })
      }
    })
  })
}
