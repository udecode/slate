import type {
  BaseEditor,
  Editor,
  EditorCommandResult,
  EditorDeleteBackwardTransformArgs,
  EditorExtension,
  EditorExtensionInput,
  EditorExtensionRegistrationContext,
  EditorExtensionRegistrationOutput,
  EditorExtensionRuntimeState,
  EditorInsertTextTransformArgs,
} from '../interfaces/editor'
import type { TextInsertTextOptions } from '../interfaces/transforms/text'
import type { TextUnit } from '../types/types'
import { registerCommand } from './command-registry'
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

type DeleteCommand = {
  direction: 'backward' | 'forward'
  type: 'delete'
  unit: TextUnit
}

type InsertTextCommand = {
  options?: TextInsertTextOptions
  text: string
  type: 'insert_text'
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

const resolveTransformResult = (
  result: EditorCommandResult | void,
  delegated: boolean,
  nextResult: EditorCommandResult
): EditorCommandResult => {
  if (result) {
    return result
  }

  return delegated ? nextResult : { handled: true }
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
    if (slots.transforms?.deleteBackward) {
      const middleware = slots.transforms.deleteBackward

      cleanups.push(
        registerCommand<DeleteCommand>(editor, 'delete', (context, next) => {
          if (context.command.direction !== 'backward') {
            return next()
          }

          let delegated = false
          let nextResult: EditorCommandResult = { handled: false }

          const runNext = (
            overrides: Partial<EditorDeleteBackwardTransformArgs> = {}
          ) => {
            if (delegated) {
              throw new Error(
                'Transform middleware next() cannot be called more than once.'
              )
            }

            delegated = true
            nextResult = next({
              ...context.command,
              unit: overrides.unit ?? context.command.unit,
            })

            return nextResult
          }

          const result = middleware({
            editor,
            next: runNext,
            unit: context.command.unit,
          })

          return resolveTransformResult(result, delegated, nextResult)
        })
      )
    }

    if (slots.transforms?.insertText) {
      const middleware = slots.transforms.insertText

      cleanups.push(
        registerCommand<InsertTextCommand>(
          editor,
          'insert_text',
          (context, next) => {
            let delegated = false
            let nextResult: EditorCommandResult = { handled: false }

            const runNext = (
              overrides: Partial<EditorInsertTextTransformArgs> = {}
            ) => {
              if (delegated) {
                throw new Error(
                  'Transform middleware next() cannot be called more than once.'
                )
              }

              delegated = true
              nextResult = next({
                ...context.command,
                options: overrides.options ?? context.command.options,
                text: overrides.text ?? context.command.text,
              })

              return nextResult
            }

            const result = middleware({
              editor,
              next: runNext,
              options: context.command.options,
              text: context.command.text,
            })

            return resolveTransformResult(result, delegated, nextResult)
          }
        )
      )
    }

    for (const [name, value] of Object.entries(slots.capabilities ?? {})) {
      const values = Array.isArray(value) ? value : [value]

      for (const capability of values) {
        cleanups.push(registerCapability(editor, name, capability))
      }
    }

    for (const groupName of Object.keys(slots.editor ?? {})) {
      const factory = slots.editor?.[groupName]

      if (factory) {
        cleanups.push(
          registerEditorGroup(editor, extension.name, groupName, factory)
        )
      }
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

    for (const groupName of Object.keys(slots.state ?? {})) {
      const factory = slots.state?.[groupName]

      if (factory) {
        cleanups.push(
          registerStateGroup(editor, extension.name, groupName, factory)
        )
      }
    }

    for (const groupName of Object.keys(slots.tx ?? {})) {
      const factory = slots.tx?.[groupName]

      if (factory) {
        cleanups.push(
          registerTxGroup(editor, extension.name, groupName, factory)
        )
      }
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
