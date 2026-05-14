import {
  apply,
  extendEditor,
  getDirtyPaths,
  getFragment,
  normalizeNode,
  shouldNormalize,
} from './core'
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
  addMark,
  after,
  before,
  bookmark,
  deleteBackward,
  deleteForward,
  deleteFragment,
  edges,
  elementReadOnly,
  first,
  fragment,
  getVoid,
  hasBlocks,
  hasInlines,
  hasPath,
  hasTexts,
  insertBreak,
  insertNode,
  insertSoftBreak,
  insertText,
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
  removeMark,
  setNormalizing,
  shouldMergeNodesRemovePrevNode,
  string,
  toggleMark,
  unhangRange,
  withoutNormalizing,
} from './editor'
import type {
  Ancestor,
  CreateEditorOptions,
  Descendant,
  DescendantIn,
  Editor,
  EditorAboveOptions,
  EditorCommit,
  EditorElementBehavior,
  EditorElementPropertyDescriptor,
  EditorElementSpec,
  EditorLevelsOptions,
  EditorNextOptions,
  EditorPreviousOptions,
  EditorSchemaApi,
  EditorSnapshot,
  EditorTransformRegistry,
  EditorUpdateOptions,
  EditorUpdateTransaction,
  Element,
  Node,
  Operation,
  SnapshotChange,
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
import { insertFragment } from './transforms-text/insert-fragment'

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

const isVoidKind = (kind: EditorElementSpec['void']) =>
  kind === 'block' ||
  kind === 'editable-island' ||
  kind === 'inline' ||
  kind === 'markable-inline'

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
    isInline: (element) => getElementBehavior(element).inline,
    isIsolating: (element) => getElementBehavior(element).isolating,
    isKeyboardSelectable: (element) =>
      getElementBehavior(element).keyboardSelectable,
    isReadOnly: (element) => getElementBehavior(element).readOnly,
    isSelectable: (element) => getElementBehavior(element).selectable,
    isVoid: (element) => getElementBehavior(element).void,
    markableVoid: (element) => getElementBehavior(element).markableVoid,
  })
}

type EditorMethod = (editor: Editor, ...args: any[]) => unknown

type BoundEditorMethod<T extends EditorMethod> = T extends (
  editor: Editor,
  ...args: infer Args
) => infer Result
  ? (...args: Args) => Result
  : never

const bindEditorMethod = <T extends EditorMethod>(
  getEditor: () => Editor,
  method: T
): BoundEditorMethod<T> =>
  ((...args: Parameters<BoundEditorMethod<T>>) =>
    method(getEditor(), ...args)) as BoundEditorMethod<T>

const createEditorTransformRegistry = <V extends Value>(
  getEditor: () => Editor<V>
): EditorTransformRegistry<V> => {
  const getRuntimeEditor = () => getEditor() as Editor
  const bind = <T extends EditorMethod>(method: T) =>
    bindEditorMethod(getEditor, method)
  const bindRuntime = <T extends EditorMethod>(method: T) =>
    bindEditorMethod(getRuntimeEditor, method)

  return Object.freeze({
    addMark: bind(addMark),
    bookmark: bind(bookmark),
    collapse: bind(collapse),
    delete: bindRuntime(deleteText),
    deleteBackward: bind(deleteBackward),
    deleteForward: bind(deleteForward),
    deleteFragment: bind(deleteFragment),
    deselect: bind(deselect),
    insertBreak: bind(insertBreak),
    insertFragment: bindRuntime(insertFragment),
    insertNode: bindRuntime(insertNode),
    insertNodes: bindRuntime(insertNodes),
    insertSoftBreak: bind(insertSoftBreak),
    insertText: bind(insertText),
    liftNodes: bindRuntime(liftNodes),
    mergeNodes: bindRuntime(mergeNodes),
    move: bind(move),
    moveNodes: bindRuntime(moveNodes),
    normalize: bind(normalize),
    removeMark: bind(removeMark),
    removeNodes: bindRuntime(removeNodes),
    select: bind(select),
    setNodes: bindRuntime(setNodes),
    setNormalizing: bind(setNormalizing),
    setPoint: bind(setPoint),
    setSelection: bind(setSelection),
    splitNodes: bindRuntime(splitNodes),
    toggleMark: bind(toggleMark),
    unsetNodes: bindRuntime(unsetNodes),
    unwrapNodes: bindRuntime(unwrapNodes),
    withoutNormalizing: bind(withoutNormalizing),
    wrapNodes: bindRuntime(wrapNodes),
  } satisfies EditorTransformRegistry<V>)
}

export const createEditor = <V extends Value = Value>(
  options: CreateEditorOptions<V> = {}
): Editor<V> => {
  let editor!: Editor<V>
  const runtimeEditor = () => editor as Editor
  const bind = <T extends EditorMethod>(method: T) =>
    bindEditorMethod(runtimeEditor, method)
  const schema = createEditorSchema(runtimeEditor)

  const extensionRuntime = {
    schema,
    extend: (extension) => extendEditor(editor, extension),
  } satisfies InternalEditorExtensionRuntime<V>

  const snapshotRuntime = {
    getChildren: () => getChildren(editor),
    getDirtyPaths: (operation) => getDirtyPaths(editor, operation),
    getFragment: () => getFragment(editor) as DescendantIn<V>[],
    getLastCommit: () => getLastCommit(editor) as EditorCommit<V> | null,
    getOperationDirtiness: (operations, options) =>
      getOperationDirtiness(editor, operations, options) as SnapshotChange<V>,
    getOperations: (startIndex) =>
      getOperations(editor, startIndex) as readonly Operation<V>[],
    getPathByRuntimeId: (runtimeId) => getPathByRuntimeId(editor, runtimeId),
    getRuntimeId: (path) => getRuntimeId(editor, path),
    getSelection: () => getLiveSelection(editor),
    getSnapshot: () => getSnapshot(editor) as EditorSnapshot<V>,
  } satisfies InternalEditorSnapshotRuntime<V>

  const transactionRuntime = {
    read: (fn) => readEditor(editor, fn),
    subscribe: (listener) => subscribe(editor, listener),
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
    normalizeNode: (entry, options) => normalizeNode(editor, entry, options),
    shouldNormalize: (options) => shouldNormalize(editor, options),
  } satisfies InternalEditorTransformRuntime

  const queryRuntime = {
    above: <T extends Ancestor>(options?: EditorAboveOptions<T>) =>
      above(editor, options),
    after: bind(after),
    before: bind(before),
    edges: bind(edges),
    elementReadOnly: bind(elementReadOnly),
    first: bind(first),
    fragment: bind(fragment),
    hasBlocks: bind(hasBlocks),
    hasInlines: bind(hasInlines),
    hasPath: bind(hasPath),
    hasTexts: bind(hasTexts),
    isBlock: bind(isBlock),
    isEdge: bind(isEdge),
    isEmpty: bind(isEmpty),
    isEnd: bind(isEnd),
    isNormalizing: bind(isNormalizing),
    isStart: bind(isStart),
    last: bind(last),
    leaf: bind(leaf),
    levels: <T extends Node>(options?: EditorLevelsOptions<T>) =>
      levels(editor, options),
    next: <T extends Descendant>(options?: EditorNextOptions<T>) =>
      next(editor, options),
    parent: bind(parent),
    path: bind(path),
    point: bind(point),
    positions: bind(positions),
    previous: <T extends Node>(options?: EditorPreviousOptions<T>) =>
      previous(editor, options),
    projectRange: bind(projectRange),
    range: bind(range),
    string: bind(string),
    unhangRange: bind(unhangRange),
    void: bind(getVoid),
    shouldMergeNodesRemovePrevNode: bind(shouldMergeNodesRemovePrevNode),
  } satisfies InternalEditorQueryRuntime

  const refRuntime = {
    pathRef: bind(pathRef),
    pathRefs: bind(pathRefs),
    pointRef: bind(pointRef),
    pointRefs: bind(pointRefs),
    rangeRef: bind(rangeRef),
    rangeRefs: bind(rangeRefs),
  } satisfies InternalEditorRefRuntime

  const runtime = {
    ...extensionRuntime,
    ...queryRuntime,
    ...refRuntime,
    ...snapshotRuntime,
    ...transactionRuntime,
    ...transformRuntime,
  } satisfies InternalEditorRuntime<V>

  const baseEditor: Editor<V> = {
    read: (fn) => readEditor(editor, fn),
    subscribe: (listener) => subscribe(editor, listener),
    update: (fn: (transaction: EditorUpdateTransaction<V>) => void, options) =>
      updateEditor(
        editor,
        fn as (transaction: EditorUpdateTransaction<V>) => void,
        options
      ),
    extend: (extension) => extendEditor(editor, extension),
  }

  editor = baseEditor

  setEditorRuntime(editor, runtime)

  setEditorTransformRegistry(
    editor,
    createEditorTransformRegistry(runtimeEditor)
  )
  setBaseApply(editor, (...args) => apply(editor, ...args))

  initializePublicState(editor, options)

  return editor
}
