import { useCallback, useContext, useState } from 'react'
import type { Path, RuntimeId, Node as SlateNode } from 'slate'
import {
  EDITOR_TO_KEY_TO_ELEMENT,
  ELEMENT_TO_NODE,
  IS_COMPOSING,
  NODE_TO_ELEMENT,
  NODE_TO_RUNTIME_ID,
} from 'slate-dom'
import { EditorContext } from '../context'
import { Editor } from '../editable/runtime-editor-api'
import { recordSlateReactRender } from '../render-profiler'
import { useIsomorphicLayoutEffect } from './use-isomorphic-layout-effect'

const EDITOR_TO_PATH_TO_ELEMENT = new WeakMap<
  Editor,
  Map<string, HTMLElement>
>()
const EDITOR_TO_SYNCED_TEXT_PATHS = new WeakMap<Editor, Set<string>>()
const ELEMENT_TO_PATH = new WeakMap<HTMLElement, Path>()
const DOM_TEXT_SYNC_MUTATION_TARGETS = new WeakSet<Node>()

const pathKey = (path: readonly number[]) => path.join('.')

const recordDOMTextSyncProfile = (id: string) => {
  recordSlateReactRender({
    id,
    kind: 'dom-text-sync',
  })
}

const parsePathKey = (key: string): Path =>
  (key === ''
    ? []
    : key.split('.').map((part) => Number.parseInt(part, 10))) as Path

const getPathElementMap = (editor: Editor) => {
  const existing = EDITOR_TO_PATH_TO_ELEMENT.get(editor)

  if (existing) {
    return existing
  }

  const next = new Map<string, HTMLElement>()
  EDITOR_TO_PATH_TO_ELEMENT.set(editor, next)
  return next
}

export const getSlateNodeElementByPath = (
  editor: Editor,
  path: readonly number[]
) => {
  const element = EDITOR_TO_PATH_TO_ELEMENT.get(editor)?.get(pathKey(path))

  if (!element?.isConnected) {
    return null
  }

  return element.getAttribute('data-slate-path') === path.join(',')
    ? element
    : null
}

export const didSyncTextPathToDOM = (editor: Editor, path: readonly number[]) =>
  EDITOR_TO_SYNCED_TEXT_PATHS.get(editor)?.has(pathKey(path)) ?? false

const markDOMTextSyncMutationTarget = (target: Node) => {
  DOM_TEXT_SYNC_MUTATION_TARGETS.add(target)
  setTimeout(() => {
    DOM_TEXT_SYNC_MUTATION_TARGETS.delete(target)
  })
}

export const isDOMTextSyncMutation = (mutation: MutationRecord) =>
  DOM_TEXT_SYNC_MUTATION_TARGETS.has(mutation.target)

const parseDOMPath = (value: string | null): Path | null => {
  if (!value) {
    return null
  }

  const path = value.split(',').map((part) => Number.parseInt(part, 10))

  return path.every(Number.isFinite) ? (path as Path) : null
}

export const getSlateNodePathFromDOMElement = (
  element: Element
): Path | null =>
  element instanceof HTMLElement
    ? (ELEMENT_TO_PATH.get(element) ??
      parseDOMPath(element.getAttribute('data-slate-path')))
    : null

export const syncTextOperationsToDOM = (
  editor: Editor,
  operations: readonly { path?: number[]; type: string }[]
) => {
  const synced = new Set<string>()
  const pathToElement = EDITOR_TO_PATH_TO_ELEMENT.get(editor)
  const textOperationCount = operations.filter(
    (operation) =>
      operation.type === 'insert_text' || operation.type === 'remove_text'
  ).length
  const result = () => ({
    syncedTextOperationCount: operations.filter(
      (operation) =>
        (operation.type === 'insert_text' ||
          operation.type === 'remove_text') &&
        operation.path &&
        synced.has(pathKey(operation.path))
    ).length,
    textOperationCount,
  })

  if (textOperationCount > 0) {
    recordDOMTextSyncProfile('attempt')
  }

  if (IS_COMPOSING.get(editor)) {
    recordDOMTextSyncProfile('skip-composition')
    EDITOR_TO_SYNCED_TEXT_PATHS.set(editor, synced)
    return result()
  }

  if (!pathToElement) {
    recordDOMTextSyncProfile('skip-no-path-map')
    EDITOR_TO_SYNCED_TEXT_PATHS.set(editor, synced)
    return result()
  }

  for (const operation of operations) {
    if (operation.type !== 'insert_text' && operation.type !== 'remove_text') {
      continue
    }

    const path = operation.path

    if (!path) {
      recordDOMTextSyncProfile('skip-no-path')
      continue
    }

    const element = pathToElement.get(pathKey(path))
    if (!element?.isConnected) {
      recordDOMTextSyncProfile('skip-no-element')
      continue
    }

    const canUseDOMTextSync =
      element.getAttribute('data-slate-dom-sync') === 'true'
    const strings = element?.querySelectorAll('[data-slate-string="true"]')

    if (!canUseDOMTextSync || !element || strings?.length !== 1) {
      recordDOMTextSyncProfile('skip-disabled')
      continue
    }

    if (!Editor.hasPath(editor, path)) {
      recordDOMTextSyncProfile('skip-missing-path')
      continue
    }

    const [node] = editor.read((state) => state.nodes.get(path))
    const text =
      'text' in node && typeof node.text === 'string' ? node.text : null

    if (text === null) {
      recordDOMTextSyncProfile('skip-non-text')
      continue
    }

    const stringElement = strings[0]!

    if (text.length === 0) {
      markDOMTextSyncMutationTarget(stringElement)
      stringElement.textContent = ''
      recordDOMTextSyncProfile('skip-empty-text')
      continue
    }

    const textNode = Array.from(stringElement.childNodes).find(
      (child) => child.nodeType === Node.TEXT_NODE
    )

    if (textNode) {
      markDOMTextSyncMutationTarget(textNode)
      textNode.nodeValue = text
    } else {
      markDOMTextSyncMutationTarget(stringElement)
      stringElement.textContent = text
    }

    synced.add(pathKey(path))
    recordDOMTextSyncProfile('success')
  }

  EDITOR_TO_SYNCED_TEXT_PATHS.set(editor, synced)
  return result()
}

export const useSlateNodeRef = (
  runtimeId: RuntimeId | null,
  options: {
    path?: Path | null
    slateNode?: SlateNode | null
  } = {}
) => {
  const editor = useContext(EditorContext)
  const [node, setNode] = useState<Node | null>(null)
  const providedPathKey = options.path == null ? null : pathKey(options.path)
  const providedSlateNode = options.slateNode ?? null

  useIsomorphicLayoutEffect(() => {
    if (!editor || !node || !runtimeId) {
      return
    }

    const path =
      providedPathKey == null
        ? Editor.getPathByRuntimeId(editor, runtimeId)
        : parsePathKey(providedPathKey)

    if (!path || !(node instanceof HTMLElement)) {
      return
    }

    const slateNode =
      providedSlateNode ?? editor.read((state) => state.nodes.get(path))[0]
    const nextPathKey = pathKey(path)
    const key = editor.api.dom.findKey(slateNode)
    const keyToElement = EDITOR_TO_KEY_TO_ELEMENT.get(editor) ?? new WeakMap()

    if (!EDITOR_TO_KEY_TO_ELEMENT.has(editor)) {
      EDITOR_TO_KEY_TO_ELEMENT.set(editor, keyToElement)
    }

    keyToElement.set(key, node)
    NODE_TO_ELEMENT.set(slateNode, node)
    NODE_TO_RUNTIME_ID.set(slateNode, runtimeId)
    ELEMENT_TO_NODE.set(node, slateNode)
    ELEMENT_TO_PATH.set(node, [...path] as Path)
    node.setAttribute('data-slate-path', path.join(','))
    node.setAttribute('data-slate-runtime-id', runtimeId)
    getPathElementMap(editor).set(nextPathKey, node)

    return () => {
      if (keyToElement.get(key) === node) {
        keyToElement.delete(key)
      }

      if (NODE_TO_ELEMENT.get(slateNode) === node) {
        NODE_TO_ELEMENT.delete(slateNode)

        if (NODE_TO_RUNTIME_ID.get(slateNode) === runtimeId) {
          NODE_TO_RUNTIME_ID.delete(slateNode)
        }
      }

      if (ELEMENT_TO_NODE.get(node) === slateNode) {
        ELEMENT_TO_NODE.delete(node)
      }

      const currentPath = ELEMENT_TO_PATH.get(node)
      if (currentPath && pathKey(currentPath) === nextPathKey) {
        ELEMENT_TO_PATH.delete(node)
      }

      if (node.getAttribute('data-slate-path') === path.join(',')) {
        node.removeAttribute('data-slate-path')
      }

      if (node.getAttribute('data-slate-runtime-id') === runtimeId) {
        node.removeAttribute('data-slate-runtime-id')
      }

      const pathElementMap = getPathElementMap(editor)
      if (pathElementMap.get(nextPathKey) === node) {
        pathElementMap.delete(nextPathKey)
      }
    }
  }, [editor, node, providedPathKey, providedSlateNode, runtimeId])

  return useCallback((nextNode: Node | null) => {
    setNode(nextNode)
  }, [])
}
