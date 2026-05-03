import {
  addMark,
  deleteFragment,
  type Editor,
  extendEditor,
  getDirtyPaths,
  getFragment,
  insertBreak,
  insertFragment,
  insertNode,
  insertSoftBreak,
  insertText,
  normalizeNode,
  removeMark,
  shouldNormalize,
  toggleMark,
} from './'
import { apply } from './core'
import {
  type InternalEditorExtensionRuntime,
  type InternalEditorQueryRuntime,
  type InternalEditorRefRuntime,
  type InternalEditorRuntime,
  type InternalEditorSnapshotRuntime,
  type InternalEditorTransactionRuntime,
  type InternalEditorTransformRuntime,
  setEditorRuntime,
} from './core/editor-runtime'
import {
  getExtensionRegistry,
  registerElementSpec,
} from './core/extension-registry'
import {
  getChildren,
  getLastCommit,
  getLiveSelection,
  getOperationDirtiness,
  getOperations,
  getPathByRuntimeId,
  getRuntimeId,
  getSnapshot,
  initializePublicState,
  readEditor,
  setBaseApply,
  subscribe,
  updateEditor,
} from './core/public-state'
import { setEditorTransformRegistry } from './core/transform-registry'
import {
  above,
  after,
  before,
  bookmark,
  deleteBackward,
  deleteForward,
  edges,
  elementReadOnly,
  first,
  fragment,
  getVoid,
  hasBlocks,
  hasInlines,
  hasPath,
  hasTexts,
  isBlock,
  isEdge,
  isEmpty,
  isEnd,
  isNormalizing,
  isStart,
  last,
  leaf,
  levels,
  next,
  normalize,
  parent,
  path,
  pathRef,
  pathRefs,
  point,
  pointRef,
  pointRefs,
  positions,
  previous,
  projectRange,
  range,
  rangeRef,
  rangeRefs,
  setNormalizing,
  shouldMergeNodesRemovePrevNode,
  string,
  unhangRange,
  withoutNormalizing,
} from './editor'
import type {
  EditorElementBehavior,
  EditorElementPropertyDescriptor,
  EditorElementSpec,
  EditorSchemaApi,
  EditorTransformRegistry,
  EditorUpdateOptions,
  EditorUpdateTransaction,
  Element,
  Value,
} from './interfaces'
import {
  insertNodes,
  liftNodes,
  mergeNodes,
  moveNodes,
  removeNodes,
  setNodes,
  splitNodes,
  unsetNodes,
  unwrapNodes,
  wrapNodes,
} from './transforms-node'
import {
  collapse,
  deselect,
  move,
  select,
  setPoint,
  setSelection,
} from './transforms-selection'
import { deleteText } from './transforms-text'

/**
 * Create a new Slate `Editor` object.
 */
const normalizeElementSpecs = (
  specs: EditorElementSpec | readonly EditorElementSpec[]
) => (Array.isArray(specs) ? specs : [specs])

const getElementType = (element: { type?: unknown }) =>
  typeof element.type === 'string' ? element.type : null

const isInlineVoidKind = (kind: EditorElementSpec['void']) =>
  kind === 'inline' || kind === 'markable-inline'

const isVoidKind = (kind: EditorElementSpec['void']) => Boolean(kind)

const isEditableIslandVoidKind = (kind: EditorElementSpec['void']) =>
  kind === 'editable-island'

const mergeElementSpecs = (
  base: EditorElementSpec,
  overlay: EditorElementSpec
): EditorElementSpec => ({
  ...base,
  ...overlay,
  properties: Object.freeze({
    ...(base.properties ?? {}),
    ...(overlay.properties ?? {}),
  }),
  type: base.type,
})

const getDefaultElementProperty = (
  descriptor: EditorElementPropertyDescriptor | null
) => {
  const defaultValue = descriptor?.default

  return typeof defaultValue === 'function' ? defaultValue() : defaultValue
}

const getOwnElementProperty = (element: Element, property: string) => {
  if (!Object.hasOwn(element, property)) {
    return undefined
  }

  return (element as unknown as Record<string, unknown>)[property]
}

const createEditorSchema = (getEditor: () => Editor<any>): EditorSchemaApi => {
  const getSpec = (element: { type?: unknown }) => {
    const type = getElementType(element)
    const registry = getExtensionRegistry(getEditor())
    const exactSpec = type
      ? (registry.elementSpecs.get(type)?.spec ?? null)
      : null

    let spec = exactSpec

    for (const registration of registry.elementMatchers) {
      if (registration.spec.match?.(element as Element)) {
        spec = spec
          ? mergeElementSpecs(spec, registration.spec)
          : registration.spec
      }
    }

    return spec
  }

  const getElementBehavior = (element: Element): EditorElementBehavior => {
    const spec = getSpec(element)
    const voidNode = isVoidKind(spec?.void)
    const inline = spec
      ? spec.inline === true || isInlineVoidKind(spec.void)
      : getElementType(element) === 'link'
    const markableVoid =
      spec?.markableVoid === true || spec?.void === 'markable-inline'
    const editableIsland = isEditableIslandVoidKind(spec?.void)
    const selectable = spec?.selectable !== false
    const atom = spec?.atom === true || (voidNode && !editableIsland)

    return Object.freeze({
      atom,
      editableIsland,
      inline,
      isolating: spec?.isolating === true,
      keyboardSelectable:
        spec?.keyboardSelectable === true || (selectable && atom),
      markableVoid,
      readOnly: spec?.readOnly === true,
      selectable,
      void: voidNode,
    })
  }

  const getElementPropertyDescriptor = (
    type: string,
    property: string
  ): EditorElementPropertyDescriptor | null =>
    getExtensionRegistry(getEditor()).elementSpecs.get(type)?.spec.properties?.[
      property
    ] ?? null

  const getResolvedElementPropertyDescriptor = (
    element: Element,
    property: string
  ): EditorElementPropertyDescriptor | null =>
    getSpec(element)?.properties?.[property] ?? null

  const getElementProperty = <T = unknown>(
    element: Element,
    property: string
  ): T | undefined => {
    const ownValue = getOwnElementProperty(element, property)

    if (ownValue !== undefined) {
      return ownValue as T
    }

    const type = getElementType(element)

    if (!type) {
      return undefined
    }

    return getDefaultElementProperty(
      getResolvedElementPropertyDescriptor(element, property)
    ) as T | undefined
  }

  const getComparableElementProperty = (
    type: string,
    property: string,
    value: unknown
  ) => {
    if (value !== undefined) {
      return value
    }

    return getDefaultElementProperty(
      getElementPropertyDescriptor(type, property)
    )
  }

  const isElementPropertyEqual = (
    type: string,
    property: string,
    left: unknown,
    right: unknown
  ) => {
    const descriptor = getElementPropertyDescriptor(type, property)
    const leftValue = getComparableElementProperty(type, property, left)
    const rightValue = getComparableElementProperty(type, property, right)

    if (descriptor?.equals) {
      return descriptor.equals(leftValue, rightValue)
    }

    return Object.is(leftValue, rightValue)
  }

  return Object.freeze({
    define: (specs, options) => {
      const cleanups = normalizeElementSpecs(specs).map((spec) =>
        registerElementSpec(getEditor(), options?.source ?? 'schema', spec)
      )

      return () => {
        for (const cleanup of cleanups.slice().reverse()) {
          cleanup()
        }
      }
    },
    getElementSpec: (type) =>
      getExtensionRegistry(getEditor()).elementSpecs.get(type)?.spec ?? null,
    getElementBehavior,
    getElementProperty,
    getElementPropertyDescriptor,
    isAtom: (element) => getElementBehavior(element).atom,
    isBlock: (element) => {
      return !getElementBehavior(element).inline
    },
    isEditableIsland: (element) => getElementBehavior(element).editableIsland,
    isElementPropertyEqual,
    isElementReadOnly: (element) => getElementBehavior(element).readOnly,
    isInline: (element) => getElementBehavior(element).inline,
    isIsolating: (element) => getElementBehavior(element).isolating,
    isKeyboardSelectable: (element) =>
      getElementBehavior(element).keyboardSelectable,
    isSelectable: (element) => getElementBehavior(element).selectable,
    isVoid: (element) => getElementBehavior(element).void,
    markableVoid: (element) => getElementBehavior(element).markableVoid,
  })
}

const createEditorTransformRegistry = <V extends Value>(
  getEditor: () => Editor<V>
): EditorTransformRegistry<V> => {
  const getRuntimeEditor = () => getEditor() as Editor<any>

  const registry: EditorTransformRegistry<V> = {
    addMark: (...args: any[]) => (addMark as any)(getEditor(), ...args),
    bookmark: (...args: any[]) => (bookmark as any)(getEditor(), ...args),
    collapse: (...args: any[]) => (collapse as any)(getEditor(), ...args),
    delete: (...args: any[]) =>
      (deleteText as any)(getRuntimeEditor(), ...args),
    deleteBackward: (...args: any[]) =>
      (deleteBackward as any)(getEditor(), ...args),
    deleteForward: (...args: any[]) =>
      (deleteForward as any)(getEditor(), ...args),
    deleteFragment: (...args: any[]) =>
      (deleteFragment as any)(getEditor(), ...args),
    deselect: (...args: any[]) => (deselect as any)(getEditor(), ...args),
    insertBreak: (...args: any[]) => (insertBreak as any)(getEditor(), ...args),
    insertFragment: (...args: any[]) =>
      (insertFragment as any)(getRuntimeEditor(), ...args),
    insertNode: (...args: any[]) =>
      (insertNode as any)(getRuntimeEditor(), ...args),
    insertNodes: (...args: any[]) =>
      (insertNodes as any)(getRuntimeEditor(), ...args),
    insertSoftBreak: (...args: any[]) =>
      (insertSoftBreak as any)(getEditor(), ...args),
    insertText: (...args: any[]) => (insertText as any)(getEditor(), ...args),
    liftNodes: (...args: any[]) =>
      (liftNodes as any)(getRuntimeEditor(), ...args),
    mergeNodes: (...args: any[]) =>
      (mergeNodes as any)(getRuntimeEditor(), ...args),
    move: (...args: any[]) => (move as any)(getEditor(), ...args),
    moveNodes: (...args: any[]) =>
      (moveNodes as any)(getRuntimeEditor(), ...args),
    normalize: (...args: any[]) => (normalize as any)(getEditor(), ...args),
    removeMark: (...args: any[]) => (removeMark as any)(getEditor(), ...args),
    removeNodes: (...args: any[]) =>
      (removeNodes as any)(getRuntimeEditor(), ...args),
    select: (...args: any[]) => (select as any)(getEditor(), ...args),
    setNodes: (...args: any[]) =>
      (setNodes as any)(getRuntimeEditor(), ...args),
    setNormalizing: (...args: any[]) =>
      (setNormalizing as any)(getEditor(), ...args),
    setPoint: (...args: any[]) => (setPoint as any)(getEditor(), ...args),
    setSelection: (...args: any[]) =>
      (setSelection as any)(getEditor(), ...args),
    splitNodes: (...args: any[]) =>
      (splitNodes as any)(getRuntimeEditor(), ...args),
    toggleMark: (...args: any[]) => (toggleMark as any)(getEditor(), ...args),
    unsetNodes: (...args: any[]) =>
      (unsetNodes as any)(getRuntimeEditor(), ...args),
    unwrapNodes: (...args: any[]) =>
      (unwrapNodes as any)(getRuntimeEditor(), ...args),
    withoutNormalizing: (...args: any[]) =>
      (withoutNormalizing as any)(getEditor(), ...args),
    wrapNodes: (...args: any[]) =>
      (wrapNodes as any)(getRuntimeEditor(), ...args),
  }

  return Object.freeze(registry)
}

export const createEditor = <V extends Value = Value>(): Editor<V> => {
  let editor!: Editor<V>
  const runtimeEditor = () => editor as Editor<any>
  const schema = createEditorSchema(runtimeEditor)

  const extensionRuntime = {
    schema,
    extend: (...args: any[]) => (extendEditor as any)(editor, ...args),
  } satisfies InternalEditorExtensionRuntime<V>

  const snapshotRuntime = {
    getChildren: (...args: any[]) => (getChildren as any)(editor, ...args),
    getDirtyPaths: (...args: any[]) => (getDirtyPaths as any)(editor, ...args),
    getFragment: (...args: any[]) => (getFragment as any)(editor, ...args),
    getLastCommit: (...args: any[]) => (getLastCommit as any)(editor, ...args),
    getOperationDirtiness: (...args: any[]) =>
      (getOperationDirtiness as any)(editor, ...args),
    getOperations: (...args: any[]) => (getOperations as any)(editor, ...args),
    getPathByRuntimeId: (...args: any[]) =>
      (getPathByRuntimeId as any)(editor, ...args),
    getRuntimeId: (...args: any[]) => (getRuntimeId as any)(editor, ...args),
    getSelection: (...args: any[]) =>
      (getLiveSelection as any)(editor, ...args),
    getSnapshot: (...args: any[]) => (getSnapshot as any)(editor, ...args),
  } satisfies InternalEditorSnapshotRuntime<V>

  const transactionRuntime = {
    read: (...args: any[]) => (readEditor as any)(editor, ...args),
    subscribe: (...args: any[]) => (subscribe as any)(editor, ...args),
    update: (
      fn: (transaction: EditorUpdateTransaction<V>) => void,
      options?: EditorUpdateOptions
    ) =>
      updateEditor(
        editor,
        fn as (transaction: EditorUpdateTransaction<V>) => void,
        options
      ),
  } satisfies InternalEditorTransactionRuntime<V>

  const transformRuntime = {
    normalizeNode: (...args: any[]) => (normalizeNode as any)(editor, ...args),
    shouldNormalize: (...args: any[]) =>
      (shouldNormalize as any)(editor, ...args),
  } satisfies InternalEditorTransformRuntime

  const queryRuntime = {
    above: (...args: any[]) => (above as any)(editor, ...args),
    after: (...args: any[]) => (after as any)(editor, ...args),
    before: (...args: any[]) => (before as any)(editor, ...args),
    edges: (...args: any[]) => (edges as any)(editor, ...args),
    elementReadOnly: (...args: any[]) =>
      (elementReadOnly as any)(editor, ...args),
    first: (...args: any[]) => (first as any)(editor, ...args),
    fragment: (...args: any[]) => (fragment as any)(editor, ...args),
    hasBlocks: (...args: any[]) => (hasBlocks as any)(editor, ...args),
    hasInlines: (...args: any[]) => (hasInlines as any)(editor, ...args),
    hasPath: (...args: any[]) => (hasPath as any)(editor, ...args),
    hasTexts: (...args: any[]) => (hasTexts as any)(editor, ...args),
    isBlock: (...args: any[]) => (isBlock as any)(editor, ...args),
    isEdge: (...args: any[]) => (isEdge as any)(editor, ...args),
    isEmpty: (...args: any[]) => (isEmpty as any)(editor, ...args),
    isEnd: (...args: any[]) => (isEnd as any)(editor, ...args),
    isNormalizing: (...args: any[]) => (isNormalizing as any)(editor, ...args),
    isStart: (...args: any[]) => (isStart as any)(editor, ...args),
    last: (...args: any[]) => (last as any)(editor, ...args),
    leaf: (...args: any[]) => (leaf as any)(editor, ...args),
    levels: (...args: any[]) => (levels as any)(editor, ...args),
    next: (...args: any[]) => (next as any)(editor, ...args),
    parent: (...args: any[]) => (parent as any)(editor, ...args),
    path: (...args: any[]) => (path as any)(editor, ...args),
    point: (...args: any[]) => (point as any)(editor, ...args),
    positions: (...args: any[]) => (positions as any)(editor, ...args),
    previous: (...args: any[]) => (previous as any)(editor, ...args),
    projectRange: (...args: any[]) => (projectRange as any)(editor, ...args),
    range: (...args: any[]) => (range as any)(editor, ...args),
    string: (...args: any[]) => (string as any)(editor, ...args),
    unhangRange: (...args: any[]) => (unhangRange as any)(editor, ...args),
    void: (...args: any[]) => (getVoid as any)(editor, ...args),
    shouldMergeNodesRemovePrevNode: (...args: any[]) =>
      (shouldMergeNodesRemovePrevNode as any)(editor, ...args),
  } satisfies InternalEditorQueryRuntime

  const refRuntime = {
    pathRef: (...args: any[]) => (pathRef as any)(editor, ...args),
    pathRefs: (...args: any[]) => (pathRefs as any)(editor, ...args),
    pointRef: (...args: any[]) => (pointRef as any)(editor, ...args),
    pointRefs: (...args: any[]) => (pointRefs as any)(editor, ...args),
    rangeRef: (...args: any[]) => (rangeRef as any)(editor, ...args),
    rangeRefs: (...args: any[]) => (rangeRefs as any)(editor, ...args),
  } satisfies InternalEditorRefRuntime

  const runtime = {
    ...extensionRuntime,
    ...queryRuntime,
    ...refRuntime,
    ...snapshotRuntime,
    ...transactionRuntime,
    ...transformRuntime,
  } satisfies InternalEditorRuntime<V>

  const baseEditor: Editor<any> = {
    read: (...args: any[]) => (readEditor as any)(editor, ...args),
    subscribe: (...args: any[]) => (subscribe as any)(editor, ...args),
    update: (fn: (transaction: EditorUpdateTransaction<V>) => void, options) =>
      updateEditor(
        editor,
        fn as (transaction: EditorUpdateTransaction<V>) => void,
        options
      ),
    extend: (...args: any[]) => (extendEditor as any)(editor, ...args),
  }

  editor = baseEditor as Editor<V>

  setEditorRuntime(editor, runtime)

  setEditorTransformRegistry(
    editor,
    createEditorTransformRegistry(runtimeEditor)
  )
  setBaseApply(editor, (...args) => apply(editor, ...args))

  initializePublicState(editor)

  return editor
}
