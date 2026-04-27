import type {
  BaseEditor,
  Editor,
  EditorExtension,
  EditorExtensionInput,
  EditorExtensionMethodMap,
} from '../interfaces/editor'
import { registerCommand } from './command-registry'
import {
  getExtensionRegistry,
  registerCapability,
  registerCommitListener,
  registerNormalizer,
  registerOperationMiddleware,
} from './extension-registry'

type ExtensionRecord = {
  cleanups: Array<() => void>
  extension: EditorExtension<Editor>
  order: number
}

type ExtensionState = {
  originalMethods: Map<string, unknown>
  records: Map<string, ExtensionRecord>
}

const EXTENSION_STATE = new WeakMap<Editor, ExtensionState>()

let extensionOrder = 0

const getExtensionState = (editor: Editor) => {
  let state = EXTENSION_STATE.get(editor)

  if (!state) {
    state = {
      originalMethods: new Map(),
      records: new Map(),
    }
    EXTENSION_STATE.set(editor, state)
  }

  return state
}

const normalizeExtensionInput = <TEditor extends Editor>(
  input: EditorExtensionInput<TEditor>
) =>
  (Array.isArray(input)
    ? input
    : [input]) as readonly EditorExtension<TEditor>[]

const getMutableEditorRecord = (editor: Editor) =>
  editor as unknown as Record<string, unknown>

export const defineEditorExtension = <TEditor extends BaseEditor<any> = Editor>(
  extension: EditorExtension<TEditor>
) => extension

const resolveExtensionOrder = (
  state: ExtensionState,
  extensions: readonly EditorExtension<Editor>[]
) => {
  const pending = new Map<string, EditorExtension<Editor>>()
  const ordered: EditorExtension<Editor>[] = []
  const visiting = new Set<string>()
  const visited = new Set<string>()

  for (const extension of extensions) {
    if (!extension.name) {
      throw new Error('Editor extension must have a name.')
    }

    if (pending.has(extension.name) || state.records.has(extension.name)) {
      throw new Error(
        `Editor extension "${extension.name}" is already installed.`
      )
    }

    pending.set(extension.name, extension)
  }

  const visit = (extension: EditorExtension<Editor>) => {
    if (visited.has(extension.name)) {
      return
    }

    if (visiting.has(extension.name)) {
      throw new Error(
        `Editor extension "${extension.name}" has a cyclic dependency.`
      )
    }

    visiting.add(extension.name)

    for (const dependency of extension.dependencies ?? []) {
      const pendingDependency = pending.get(dependency)

      if (pendingDependency) {
        visit(pendingDependency)
        continue
      }

      if (!state.records.has(dependency)) {
        throw new Error(
          `Editor extension "${extension.name}" has missing dependency "${dependency}".`
        )
      }
    }

    visiting.delete(extension.name)
    visited.add(extension.name)
    ordered.push(extension)
  }

  for (const extension of extensions) {
    visit(extension)
  }

  return ordered
}

const getRegisteredRecordsInOrder = (state: ExtensionState) =>
  [...state.records.values()].sort((a, b) => a.order - b.order)

const resolveMethods = (
  editor: Editor,
  extension: EditorExtension<Editor>
): EditorExtensionMethodMap => {
  if (!extension.methods) {
    return {}
  }

  return typeof extension.methods === 'function'
    ? extension.methods(editor)
    : extension.methods
}

const restoreOriginalMethods = (editor: Editor, state: ExtensionState) => {
  const registry = getExtensionRegistry(editor)

  for (const methodName of registry.methodNames) {
    const originalMethod = state.originalMethods.get(methodName)
    const editorRecord = getMutableEditorRecord(editor)

    if (originalMethod === undefined) {
      delete editorRecord[methodName]
    } else {
      editorRecord[methodName] = originalMethod
    }
  }

  registry.methodNames.clear()
}

const recomposeEditorMethods = (editor: Editor) => {
  const state = getExtensionState(editor)
  const registry = getExtensionRegistry(editor)
  const methodOwners = new Map<string, string>()

  restoreOriginalMethods(editor, state)

  for (const record of getRegisteredRecordsInOrder(state)) {
    const methods = resolveMethods(editor, record.extension)

    for (const [methodName, method] of Object.entries(methods)) {
      if (methodName === 'apply' || methodName === 'onChange') {
        throw new Error(
          `Editor extension "${record.extension.name}" cannot replace legacy extension point "${methodName}". Use operation middleware, commit listeners, or editor methods instead.`
        )
      }

      const owner = methodOwners.get(methodName)

      if (owner && !record.extension.dependencies?.includes(owner)) {
        throw new Error(
          `Editor extension method "${methodName}" from "${record.extension.name}" conflicts with "${owner}". Declare "${owner}" as a dependency to compose it.`
        )
      }

      const editorRecord = getMutableEditorRecord(editor)

      if (!state.originalMethods.has(methodName)) {
        state.originalMethods.set(methodName, editorRecord[methodName])
      }

      editorRecord[methodName] = method
      registry.methodNames.add(methodName)
      methodOwners.set(methodName, record.extension.name)
    }
  }
}

const registerExtensionSlots = <TEditor extends Editor>(
  editor: TEditor,
  extension: EditorExtension<TEditor>
) => {
  const cleanups: Array<() => void> = []

  for (const command of extension.commands ?? []) {
    cleanups.push(
      registerCommand(
        editor,
        command.type,
        command.handler as any,
        command.options
      )
    )
  }

  for (const [name, value] of Object.entries(extension.capabilities ?? {})) {
    const values = Array.isArray(value) ? value : [value]

    for (const capability of values) {
      cleanups.push(registerCapability(editor, name, capability))
    }
  }

  for (const [id, normalizer] of Object.entries(extension.normalizers ?? {})) {
    cleanups.push(registerNormalizer(editor, id, normalizer))
  }

  for (const listener of extension.commitListeners ?? []) {
    cleanups.push(registerCommitListener(editor, listener))
  }

  for (const middleware of extension.operationMiddlewares ?? []) {
    cleanups.push(registerOperationMiddleware(editor, middleware))
  }

  return cleanups
}

export const extendEditor = <TEditor extends Editor>(
  editor: TEditor,
  input: EditorExtensionInput<TEditor>
): (() => void) => {
  const state = getExtensionState(editor)
  const registry = getExtensionRegistry(editor)
  const extensions = normalizeExtensionInput(input)
  const orderedExtensions = resolveExtensionOrder(
    state,
    extensions as readonly EditorExtension<Editor>[]
  )
  const installedNames: string[] = []

  for (const extension of orderedExtensions) {
    const order = extensionOrder++
    const cleanups = registerExtensionSlots(
      editor,
      extension as EditorExtension<TEditor>
    )

    state.records.set(extension.name, {
      cleanups,
      extension: extension as EditorExtension<Editor>,
      order,
    })
    registry.extensions.set(extension.name, {
      dependencies: Object.freeze([...(extension.dependencies ?? [])]),
      name: extension.name,
      order,
    })
    installedNames.push(extension.name)
  }

  try {
    recomposeEditorMethods(editor)
  } catch (error) {
    for (const name of installedNames.slice().reverse()) {
      const record = state.records.get(name)

      if (!record) {
        continue
      }

      for (const cleanup of record.cleanups.slice().reverse()) {
        cleanup()
      }

      state.records.delete(name)
      registry.extensions.delete(name)
    }

    recomposeEditorMethods(editor)
    throw error
  }

  return () => {
    for (const name of installedNames.slice().reverse()) {
      const record = state.records.get(name)

      if (!record) {
        continue
      }

      for (const cleanup of record.cleanups.slice().reverse()) {
        cleanup()
      }

      state.records.delete(name)
      registry.extensions.delete(name)
    }

    recomposeEditorMethods(editor)
  }
}
