import {
  type Node,
  type Path,
  type RuntimeId,
  NodeApi as SlateNode,
  type Text as SlateText,
  TextApi,
} from 'slate'
import {
  Editor,
  getEditorLiveNode,
  getEditorLiveText,
} from './runtime-editor-api'

export type RuntimeNodeBinding = {
  node: Node | null
  path: Path | null
  runtimeId: RuntimeId | null
}

export const readRuntimeNode = (editor: Editor, path: Path): Node | null =>
  getEditorLiveNode(editor, path) ?? null

export const readRuntimeText = (editor: Editor, path: Path): SlateText | null =>
  getEditorLiveText(editor, path) ?? null

export const readRuntimeNodeById = (
  editor: Editor,
  runtimeId: RuntimeId | null
): RuntimeNodeBinding => {
  if (!runtimeId) {
    return { node: null, path: null, runtimeId: null }
  }

  const snapshot = Editor.getSnapshot(editor)
  const path =
    Editor.getPathByRuntimeId(editor, runtimeId) ??
    snapshot.index.idToPath[runtimeId] ??
    null

  if (!path) {
    return { node: null, path: null, runtimeId }
  }

  const editorRoot = editor as unknown as Node
  const snapshotRoot = { children: snapshot.children } as unknown as Node
  const node =
    readRuntimeNode(editor, path) ??
    SlateNode.getIf(editorRoot, path) ??
    SlateNode.getIf(snapshotRoot, path) ??
    null

  return { node, path, runtimeId }
}

export const readRuntimeTextById = (
  editor: Editor,
  runtimeId: RuntimeId | null
): RuntimeNodeBinding & { text: SlateText | null } => {
  const binding = readRuntimeNodeById(editor, runtimeId)

  return {
    ...binding,
    text: binding.node && TextApi.isText(binding.node) ? binding.node : null,
  }
}
