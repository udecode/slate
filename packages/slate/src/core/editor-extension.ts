import type {
  BaseEditor,
  Editor,
  EditorExtension,
  EditorExtensionInput,
  EditorExtensionRegistrationContext,
  EditorExtensionRegistrationOutput,
  EditorExtensionRuntimeState,
} from '../interfaces/editor'
import {
  getExtensionRegistry,
  registerCapability,
  registerCommitListener,
  registerEditorGroup,
  registerElementSpec,
  registerNormalizer,
  registerOperationMiddleware,
  registerStateGroup,
  registerTxGroup,
} from './extension-registry'

type ExtensionRecord = {
  cleanups: Array<() => void>
  extension: EditorExtension<Editor>
  order: number
}

type ExtensionState = {
  records: Map<string, ExtensionRecord>
}

const EXTENSION_STATE = new WeakMap<Editor, ExtensionState>()

let extensionOrder = 0

const getExtensionState = (editor: Editor) => {
  let state = EXTENSION_STATE.get(editor)

  if (!state) {
    state = {
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

export const defineEditorExtension = <TEditor extends BaseEditor<any> = Editor>(
  extension: EditorExtension<TEditor, any>
) => extension

const assertNoLegacySlots = (extension: EditorExtension<Editor, any>) => {
  const legacyMethods = (extension as unknown as { methods?: unknown }).methods
  const publicCommands = (extension as unknown as { commands?: unknown })
    .commands

  if (legacyMethods !== undefined) {
    throw new Error(
      `Editor extension "${extension.name}" cannot use methods. Add state or tx groups instead.`
    )
  }

  if (publicCommands !== undefined) {
    throw new Error(
      `Editor extension "${extension.name}" cannot use commands. Add state or tx groups instead.`
    )
  }
}

const createRuntimeState = <TValue>(
  initialValue: TValue | (() => TValue)
): EditorExtensionRuntimeState<TValue> & { cleanup: () => void } => {
  let active = true
  let current =
    typeof initialValue === 'function'
      ? (initialValue as () => TValue)()
      : initialValue

  const assertActive = () => {
    if (!active) {
      throw new Error('Editor extension runtime state has been cleaned up.')
    }
  }

  return {
    cleanup() {
      active = false
      current = undefined as TValue
    },
    get() {
      assertActive()

      return current
    },
    set(value) {
      assertActive()
      current =
        typeof value === 'function'
          ? (value as (previous: TValue) => TValue)(current)
          : value
    },
  }
}

const hasExtensionNamed = (
  state: ExtensionState,
  pending: Map<string, EditorExtension<Editor, any>>,
  name: string
) => state.records.has(name) || pending.has(name)

const getInstalledConflict = (
  state: ExtensionState,
  extension: EditorExtension<Editor, any>
) => {
  for (const [installedName, record] of state.records) {
    if (
      extension.conflicts?.includes(installedName) ||
      record.extension.conflicts?.includes(extension.name)
    ) {
      return installedName
    }
  }

  return null
}

const getPendingConflict = (
  extension: EditorExtension<Editor, any>,
  pending: Map<string, EditorExtension<Editor, any>>
) => {
  for (const [pendingName, pendingExtension] of pending) {
    if (pendingName === extension.name) {
      continue
    }

    if (
      extension.conflicts?.includes(pendingName) ||
      pendingExtension.conflicts?.includes(extension.name)
    ) {
      return pendingName
    }
  }

  return null
}

const resolveExtensionOrder = (
  state: ExtensionState,
  extensions: readonly EditorExtension<Editor, any>[]
) => {
  const pending = new Map<string, EditorExtension<Editor, any>>()
  const ordered: EditorExtension<Editor, any>[] = []
  const visiting = new Set<string>()
  const visited = new Set<string>()

  for (const extension of extensions) {
    assertNoLegacySlots(extension)

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

  for (const extension of extensions) {
    const installedConflict = getInstalledConflict(state, extension)

    if (installedConflict) {
      throw new Error(
        `Editor extension "${extension.name}" conflicts with "${installedConflict}".`
      )
    }

    const pendingConflict = getPendingConflict(extension, pending)

    if (pendingConflict) {
      throw new Error(
        `Editor extension "${extension.name}" conflicts with "${pendingConflict}".`
      )
    }

    for (const peerDependency of extension.peerDependencies ?? []) {
      if (!hasExtensionNamed(state, pending, peerDependency)) {
        throw new Error(
          `Editor extension "${extension.name}" has missing peer dependency "${peerDependency}".`
        )
      }
    }
  }

  const visit = (extension: EditorExtension<Editor, any>) => {
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

const registerExtensionSlots = <TEditor extends Editor>(
  editor: TEditor,
  extension: EditorExtension<TEditor, any>
) => {
  const cleanups: Array<() => void> = []
  const runtimeStateCleanups: Array<() => void> = []
  const abortController = new AbortController()

  const context = {
    editor,
    name: extension.name,
    options: extension.options,
    runtimeState(initialValue) {
      const state = createRuntimeState(initialValue)
      runtimeStateCleanups.push(state.cleanup)

      return state
    },
    signal: abortController.signal,
  } satisfies EditorExtensionRegistrationContext<TEditor, any>

  const registerSlots = (slots: EditorExtensionRegistrationOutput<TEditor>) => {
    for (const [name, value] of Object.entries(slots.capabilities ?? {})) {
      const values = Array.isArray(value) ? value : [value]

      for (const capability of values) {
        cleanups.push(registerCapability(editor, name, capability))
      }
    }

    for (const [groupName, factory] of Object.entries(slots.editor ?? {})) {
      cleanups.push(
        registerEditorGroup(editor, extension.name, groupName, factory as any)
      )
    }

    for (const spec of slots.elements ?? []) {
      cleanups.push(registerElementSpec(editor, extension.name, spec))
    }

    for (const [id, normalizer] of Object.entries(slots.normalizers ?? {})) {
      cleanups.push(registerNormalizer(editor, id, normalizer))
    }

    for (const listener of slots.commitListeners ?? []) {
      cleanups.push(registerCommitListener(editor, listener))
    }

    for (const middleware of slots.operationMiddlewares ?? []) {
      cleanups.push(registerOperationMiddleware(editor, middleware))
    }

    for (const [groupName, factory] of Object.entries(slots.state ?? {})) {
      cleanups.push(
        registerStateGroup(editor, extension.name, groupName, factory as any)
      )
    }

    for (const [groupName, factory] of Object.entries(slots.tx ?? {})) {
      cleanups.push(
        registerTxGroup(editor, extension.name, groupName, factory as any)
      )
    }
  }

  try {
    const registrationOutput = extension.register?.(context) ?? {}

    registerSlots(extension)
    registerSlots(registrationOutput)

    for (const cleanup of runtimeStateCleanups) {
      cleanups.push(cleanup)
    }

    if (registrationOutput.cleanup) {
      cleanups.push(registrationOutput.cleanup)
    }

    cleanups.push(() => abortController.abort())
  } catch (error) {
    for (const cleanup of cleanups.slice().reverse()) {
      cleanup()
    }
    for (const cleanup of runtimeStateCleanups.slice().reverse()) {
      cleanup()
    }
    abortController.abort()

    throw error
  }

  return cleanups
}

const cleanupInstalledExtensions = (
  state: ExtensionState,
  registry: { extensions: { delete: (name: string) => boolean } },
  installedNames: readonly string[]
) => {
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
    extensions as readonly EditorExtension<Editor, any>[]
  )
  const installedNames: string[] = []

  try {
    for (const extension of orderedExtensions) {
      const order = extensionOrder++
      const cleanups = registerExtensionSlots(
        editor,
        extension as EditorExtension<TEditor, any>
      )

      state.records.set(extension.name, {
        cleanups,
        extension: extension as EditorExtension<Editor, any>,
        order,
      })
      registry.extensions.set(extension.name, {
        conflicts: Object.freeze([...(extension.conflicts ?? [])]),
        dependencies: Object.freeze([...(extension.dependencies ?? [])]),
        name: extension.name,
        order,
        peerDependencies: Object.freeze([
          ...(extension.peerDependencies ?? []),
        ]),
      })
      installedNames.push(extension.name)
    }
  } catch (error) {
    cleanupInstalledExtensions(state, registry, installedNames)
    throw error
  }

  return () => {
    cleanupInstalledExtensions(state, registry, installedNames)
  }
}
