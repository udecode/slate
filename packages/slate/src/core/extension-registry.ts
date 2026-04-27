import type {
  Editor,
  EditorCommitListener,
  EditorOperationMiddleware,
  RegisteredEditorExtension,
  ValueOf,
} from '../interfaces/editor'

export type ExtensionRegistry<TEditor extends Editor = Editor> = {
  capabilities: Map<string, unknown[]>
  commands: Map<string, unknown[]>
  commitListeners: Set<EditorCommitListener<ValueOf<TEditor>>>
  extensions: Map<string, RegisteredEditorExtension>
  methodNames: Set<string>
  normalizers: Map<string, unknown>
  operationMiddlewares: Set<EditorOperationMiddleware<TEditor>>
}

const EXTENSION_REGISTRIES = new WeakMap<Editor, ExtensionRegistry>()

export const getExtensionRegistry = <TEditor extends Editor>(
  editor: TEditor
): ExtensionRegistry<TEditor> => {
  let registry = EXTENSION_REGISTRIES.get(editor)

  if (!registry) {
    registry = {
      capabilities: new Map(),
      commands: new Map(),
      commitListeners: new Set(),
      extensions: new Map(),
      methodNames: new Set(),
      normalizers: new Map(),
      operationMiddlewares: new Set(),
    }
    EXTENSION_REGISTRIES.set(editor, registry)
  }

  return registry as ExtensionRegistry<TEditor>
}

export const registerCapability = (
  editor: Editor,
  name: string,
  capability: unknown
) => {
  const registry = getExtensionRegistry(editor)
  const capabilities = registry.capabilities.get(name) ?? []

  capabilities.push(capability)
  registry.capabilities.set(name, capabilities)

  return () => {
    const current = registry.capabilities.get(name)

    if (!current) {
      return
    }

    const index = current.indexOf(capability)
    if (index >= 0) {
      current.splice(index, 1)
    }

    if (current.length === 0) {
      registry.capabilities.delete(name)
    }
  }
}

export const registerNormalizer = (
  editor: Editor,
  id: string,
  normalizer: unknown
) => {
  const registry = getExtensionRegistry(editor)
  registry.normalizers.set(id, normalizer)

  return () => {
    if (registry.normalizers.get(id) === normalizer) {
      registry.normalizers.delete(id)
    }
  }
}

export const registerCommitListener = <TEditor extends Editor>(
  editor: TEditor,
  listener: EditorCommitListener<ValueOf<TEditor>>
) => {
  const registry = getExtensionRegistry(editor)
  registry.commitListeners.add(listener)

  return () => {
    registry.commitListeners.delete(listener)
  }
}

export const registerOperationMiddleware = <TEditor extends Editor>(
  editor: TEditor,
  middleware: EditorOperationMiddleware<TEditor>
) => {
  const registry = getExtensionRegistry(editor)
  registry.operationMiddlewares.add(middleware)

  return () => {
    registry.operationMiddlewares.delete(middleware)
  }
}
