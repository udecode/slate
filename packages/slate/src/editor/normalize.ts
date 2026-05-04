import { batchDirtyPaths } from '../core/batch-dirty-paths'
import { getEditorRuntime } from '../core/editor-runtime'
import {
  canUseTextFastPath,
  getChildren,
  getCurrentMarks,
  getCurrentSelection,
  getMutationVersion,
  isInTransaction,
  runEditorTransaction,
} from '../core/public-state'
import type { Editor, EditorStaticApi } from '../interfaces/editor'
import { Node, type NodeEntry } from '../interfaces/node'
import type { Operation } from '../interfaces/operation'
import { DIRTY_PATH_KEYS, DIRTY_PATHS } from '../utils/weak-maps'
import { isNormalizing } from './is-normalizing'
import { node } from './node'
import { setNormalizing } from './set-normalizing'

export const normalize: EditorStaticApi['normalize'] = (
  editor,
  options = {}
) => {
  const {
    explicit = true,
    force = explicit,
    operation,
  } = options as {
    explicit?: boolean
    force?: boolean
    operation?: Operation
  }
  const getDirtyPaths = (editor: Editor) => {
    return DIRTY_PATHS.get(editor) || []
  }

  const clearDirtyPaths = (editor: Editor) => {
    DIRTY_PATHS.set(editor, [])
    DIRTY_PATH_KEYS.set(editor, new Set())
  }

  const canSkipDefaultTextNormalization = () => {
    if (
      explicit ||
      force ||
      !operation ||
      (operation.type !== 'insert_text' && operation.type !== 'remove_text') ||
      !canUseTextFastPath(editor)
    ) {
      return false
    }

    const expectedDirtyPathKeys = new Set(
      [[], operation.path.slice(0, -1), operation.path].map((path) =>
        path.join(',')
      )
    )

    return getDirtyPaths(editor).every((path) =>
      expectedDirtyPathKeys.has(path.join(','))
    )
  }

  const createPassSignature = () =>
    JSON.stringify({
      children: getChildren(editor),
      marks: getCurrentMarks(editor),
      selection: getCurrentSelection(editor),
    })

  const collectNormalizeEntries = (): NodeEntry[] =>
    Array.from(Node.nodes(editor), ([node, path]) => [node, path] as NodeEntry)

  const collectDirtyNormalizeEntries = (): NodeEntry[] =>
    getDirtyPaths(editor)
      .filter((path) => Node.has(editor, path))
      .map((path) => node(editor, path))

  const runNormalizePasses = () => {
    if (!isNormalizing(editor)) {
      return
    }

    if (canSkipDefaultTextNormalization()) {
      clearDirtyPaths(editor)
      return
    }

    if (force) {
      const allPaths = Array.from(Node.nodes(editor), ([, p]) => p)
      const allPathKeys = new Set(allPaths.map((p) => p.join(',')))
      DIRTY_PATHS.set(editor, allPaths)
      DIRTY_PATH_KEYS.set(editor, allPathKeys)
    }

    if (getDirtyPaths(editor).length === 0) {
      return
    }

    const wasNormalizing = isNormalizing(editor)
    setNormalizing(editor, false)

    try {
      const initialEntryCount = force
        ? collectNormalizeEntries().length
        : getDirtyPaths(editor).length
      const maxIterations = Math.max(8, initialEntryCount * 4)
      const seenSignatures = new Set<string>()
      let iteration = 0

      while (true) {
        const entries = force
          ? collectNormalizeEntries()
          : collectDirtyNormalizeEntries()

        if (entries.length === 0) {
          clearDirtyPaths(editor)
          return
        }

        const signature = JSON.stringify({
          state: createPassSignature(),
          entries: entries.map(([, path]) => path),
        })

        if (seenSignatures.has(signature)) {
          throw new Error(
            `normalizeNode revisited an earlier draft state after ${iteration} passes without reaching fixpoint`
          )
        }

        seenSignatures.add(signature)

        if (
          !getEditorRuntime(editor).shouldNormalize({
            explicit,
            iteration,
            operation,
          })
        ) {
          return
        }
        let changed = false

        for (const entry of entries) {
          const beforeMutation = getMutationVersion(editor)
          getEditorRuntime(editor).normalizeNode(entry, { explicit, operation })
          const afterMutation = getMutationVersion(editor)

          if (beforeMutation !== afterMutation) {
            changed = true

            if (!explicit) {
              break
            }
          }
        }

        if (!changed) {
          clearDirtyPaths(editor)
          return
        }

        iteration += 1

        if (iteration > maxIterations) {
          throw new Error(
            `normalizeNode exhausted derived pass budget (${maxIterations}) without reaching fixpoint`
          )
        }
      }
    } finally {
      setNormalizing(editor, wasNormalizing)
    }
  }

  if (explicit && !isInTransaction(editor)) {
    runEditorTransaction(
      editor,
      () => {
        normalize(editor, options)
      },
      { skipNormalize: true }
    )
    return
  }

  if (force) {
    batchDirtyPaths(editor, runNormalizePasses, () => {})
    return
  }

  runNormalizePasses()
}
