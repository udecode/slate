import {
  apply,
  extendEditor,
  getDirtyPaths,
  getFragment,
  isEditorExtensionInstalled,
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
import { executeQueryMiddleware } from './core/query-middleware'
import { executeTransformMiddleware } from './core/transform-middleware'
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
  EditorExtension,
  EditorExtensionInput,
  EditorLevelsOptions,
  EditorNextOptions,
  EditorPreviousOptions,
  EditorPublicTransformMiddlewareKey,
  EditorSchemaApi,
  EditorSnapshot,
  EditorTransformMiddlewareArgs,
  EditorTransformRegistry,
  EditorUpdateOptions,
  EditorUpdateTransaction,
  Element,
  Node,
  NodeEntry,
  Operation,
  SnapshotChange,
  Value,
} from './interfaces'
import { RangeApi } from './interfaces'
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
      const cleanups: Array<() => void> = []
      const cleanupRegisteredSpecs = () => {
        for (const cleanup of cleanups.slice().reverse()) {
          cleanup()
        }
      }

      try {
        for (const spec of normalizeElementSpecs(specs)) {
          cleanups.push(
            registerElementSpec(getEditor(), options?.source ?? 'schema', spec)
          )
        }
      } catch (error) {
        cleanupRegisteredSpecs()
        throw error
      }

      return cleanupRegisteredSpecs
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
  const runMiddleware = <TKey extends EditorPublicTransformMiddlewareKey>(
    key: TKey,
    args: EditorTransformMiddlewareArgs<V>[TKey],
    applyDefault: (args: EditorTransformMiddlewareArgs<V>[TKey]) => void
  ) => {
    executeTransformMiddleware(getEditor(), key, args, applyDefault)
  }

  return Object.freeze({
    addMark: (key, value) =>
      runMiddleware('addMark', { key, value }, (args) =>
        addMark(getEditor(), args.key, args.value)
      ),
    bookmark: bind(bookmark),
    collapse: (options) =>
      runMiddleware('collapse', { options }, (args) =>
        collapse(getEditor(), args.options)
      ),
    delete: (options) =>
      runMiddleware('delete', { options }, (args) =>
        deleteText(getRuntimeEditor(), args.options)
      ),
    deleteBackward: (unit) =>
      runMiddleware('deleteBackward', { unit }, (args) =>
        deleteBackward(getEditor(), args.unit)
      ),
    deleteForward: (unit) =>
      runMiddleware('deleteForward', { unit }, (args) =>
        deleteForward(getEditor(), args.unit)
      ),
    deleteFragment: (options) =>
      runMiddleware('deleteFragment', { options }, (args) =>
        deleteFragment(getEditor(), args.options)
      ),
    deselect: () => runMiddleware('deselect', {}, () => deselect(getEditor())),
    insertBreak: () =>
      runMiddleware('insertBreak', {}, () => insertBreak(getEditor())),
    insertFragment: (fragment, options) =>
      runMiddleware('insertFragment', { fragment, options }, (args) =>
        insertFragment(getRuntimeEditor(), args.fragment, args.options)
      ),
    insertNode: (node, options) =>
      runMiddleware('insertNode', { node, options }, (args) =>
        insertNode(getRuntimeEditor(), args.node, args.options)
      ),
    insertNodes: (nodes, options) =>
      runMiddleware('insertNodes', { nodes, options }, (args) =>
        insertNodes(getRuntimeEditor(), args.nodes, args.options)
      ),
    insertSoftBreak: () =>
      runMiddleware('insertSoftBreak', {}, () => insertSoftBreak(getEditor())),
    insertText: (text, options) =>
      runMiddleware('insertText', { options, text }, (args) =>
        insertText(getEditor(), args.text, args.options)
      ),
    liftNodes: (options) =>
      runMiddleware('liftNodes', { options }, (args) =>
        liftNodes(getRuntimeEditor(), args.options)
      ),
    mergeNodes: (options) =>
      runMiddleware('mergeNodes', { options }, (args) =>
        mergeNodes(getRuntimeEditor(), args.options)
      ),
    move: (options) =>
      runMiddleware('move', { options }, (args) =>
        move(getEditor(), args.options)
      ),
    moveNodes: (options) =>
      runMiddleware('moveNodes', { options }, (args) =>
        moveNodes(getRuntimeEditor(), args.options)
      ),
    normalize: bind(normalize),
    removeMark: (key) =>
      runMiddleware('removeMark', { key }, (args) =>
        removeMark(getEditor(), args.key)
      ),
    removeNodes: (options) =>
      runMiddleware('removeNodes', { options }, (args) =>
        removeNodes(getRuntimeEditor(), args.options)
      ),
    select: (target) =>
      runMiddleware('select', { target }, (args) =>
        select(getEditor(), args.target)
      ),
    setNodes: (props, options) =>
      runMiddleware(
        'setNodes',
        {
          options:
            options as EditorTransformMiddlewareArgs<V>['setNodes']['options'],
          props: props as EditorTransformMiddlewareArgs<V>['setNodes']['props'],
        },
        (args) =>
          setNodes(
            getRuntimeEditor(),
            args.props as EditorTransformMiddlewareArgs['setNodes']['props'],
            args.options as EditorTransformMiddlewareArgs['setNodes']['options']
          )
      ),
    setNormalizing: bind(setNormalizing),
    setPoint: (props, options) =>
      runMiddleware('setPoint', { options, props }, (args) =>
        setPoint(getEditor(), args.props, args.options)
      ),
    setSelection: (props) =>
      runMiddleware('setSelection', { props }, (args) =>
        setSelection(getEditor(), args.props)
      ),
    splitNodes: (options) =>
      runMiddleware('splitNodes', { options }, (args) =>
        splitNodes(getRuntimeEditor(), args.options)
      ),
    toggleMark: (key, value) =>
      runMiddleware('toggleMark', { key, value }, (args) =>
        toggleMark(getEditor(), args.key, args.value)
      ),
    unsetNodes: (props, options) =>
      runMiddleware('unsetNodes', { options, props }, (args) =>
        unsetNodes(getRuntimeEditor(), args.props, args.options)
      ),
    unwrapNodes: (options) =>
      runMiddleware('unwrapNodes', { options }, (args) =>
        unwrapNodes(getRuntimeEditor(), args.options)
      ),
    withoutNormalizing: bind(withoutNormalizing),
    wrapNodes: (element, options) =>
      runMiddleware('wrapNodes', { element, options }, (args) =>
        wrapNodes(getRuntimeEditor(), args.element, args.options)
      ),
  } satisfies EditorTransformRegistry<V>)
}

export function createEditor<
  V extends Value = Value,
  const TExtensions extends readonly unknown[] = readonly [],
>(options?: CreateEditorOptions<V, TExtensions>): Editor<V, TExtensions>

export function createEditor<
  V extends Value = Value,
  const TExtensions extends readonly unknown[] = readonly [],
>(options: CreateEditorOptions<V, TExtensions> = {}): Editor<V, TExtensions> {
  let editor!: Editor<V, TExtensions>
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
  } satisfies InternalEditorTransformRuntime<V>

  const queryRuntime = {
    above: <T extends Ancestor>(options?: EditorAboveOptions<T>) =>
      executeQueryMiddleware(
        editor,
        'nodes',
        'above',
        { options },
        ({ options }) => above(editor, options)
      ) as NodeEntry<T> | undefined,
    after: (at, options) =>
      executeQueryMiddleware(
        editor,
        'points',
        'after',
        { at, options },
        ({ at, options }) => after(editor, at, options)
      ),
    before: (at, options) =>
      executeQueryMiddleware(
        editor,
        'points',
        'before',
        { at, options },
        ({ at, options }) => before(editor, at, options)
      ),
    edges: (at) =>
      executeQueryMiddleware(editor, 'ranges', 'edges', { at }, ({ at }) =>
        edges(editor, at)
      ),
    elementReadOnly: (options) =>
      executeQueryMiddleware(
        editor,
        'nodes',
        'elementReadOnly',
        { options },
        ({ options }) => elementReadOnly(editor, options)
      ),
    first: (at) =>
      executeQueryMiddleware(editor, 'nodes', 'first', { at }, ({ at }) =>
        first(editor, at)
      ),
    fragment: (at) =>
      executeQueryMiddleware(
        editor,
        'fragment',
        'get',
        { options: { at: range(editor, at) } },
        ({ options }) =>
          options?.at && RangeApi.isCollapsed(options.at)
            ? []
            : (getFragment(editor, options) as DescendantIn<V>[])
      ),
    hasBlocks: (element) =>
      executeQueryMiddleware(
        editor,
        'nodes',
        'hasBlocks',
        { element },
        ({ element }) => hasBlocks(editor, element)
      ),
    hasInlines: (element) =>
      executeQueryMiddleware(
        editor,
        'nodes',
        'hasInlines',
        { element },
        ({ element }) => hasInlines(editor, element)
      ),
    hasPath: (path) =>
      executeQueryMiddleware(editor, 'nodes', 'hasPath', { path }, ({ path }) =>
        hasPath(editor, path)
      ),
    hasTexts: (element) =>
      executeQueryMiddleware(
        editor,
        'nodes',
        'hasTexts',
        { element },
        ({ element }) => hasTexts(editor, element)
      ),
    isBlock: (element) =>
      executeQueryMiddleware(
        editor,
        'nodes',
        'isBlock',
        { element },
        ({ element }) => isBlock(editor, element)
      ),
    isEdge: (point, at) =>
      executeQueryMiddleware(
        editor,
        'points',
        'isEdge',
        { at, point },
        ({ at, point }) => isEdge(editor, point, at)
      ),
    isEmpty: (element) =>
      executeQueryMiddleware(
        editor,
        'nodes',
        'isEmpty',
        { element },
        ({ element }) => isEmpty(editor, element)
      ),
    isEnd: (point, at) =>
      executeQueryMiddleware(
        editor,
        'points',
        'isEnd',
        { at, point },
        ({ at, point }) => isEnd(editor, point, at)
      ),
    isNormalizing: bind(isNormalizing),
    isStart: (point, at) =>
      executeQueryMiddleware(
        editor,
        'points',
        'isStart',
        { at, point },
        ({ at, point }) => isStart(editor, point, at)
      ),
    last: (at) =>
      executeQueryMiddleware(editor, 'nodes', 'last', { at }, ({ at }) =>
        last(editor, at)
      ),
    leaf: (at, options) =>
      executeQueryMiddleware(
        editor,
        'nodes',
        'leaf',
        { at, options },
        ({ at, options }) => leaf(editor, at, options)
      ),
    levels: <T extends Node>(options?: EditorLevelsOptions<T>) =>
      executeQueryMiddleware(
        editor,
        'nodes',
        'levels',
        { options: options as EditorLevelsOptions<Node> | undefined },
        ({ options }) => levels(editor, options)
      ) as Generator<NodeEntry<T>, void, undefined>,
    next: <T extends Descendant>(options?: EditorNextOptions<T>) =>
      executeQueryMiddleware(
        editor,
        'nodes',
        'next',
        { options: options as EditorNextOptions<Descendant> | undefined },
        ({ options }) => next(editor, options)
      ) as NodeEntry<T> | undefined,
    parent: (at, options) =>
      executeQueryMiddleware(
        editor,
        'nodes',
        'parent',
        { at, options },
        ({ at, options }) => parent(editor, at, options)
      ),
    path: (at, options) =>
      executeQueryMiddleware(
        editor,
        'nodes',
        'path',
        { at, options },
        ({ at, options }) => path(editor, at, options)
      ),
    point: (at, options) =>
      executeQueryMiddleware(
        editor,
        'points',
        'get',
        { at, options },
        ({ at, options }) => point(editor, at, options)
      ),
    positions: (options) =>
      executeQueryMiddleware(
        editor,
        'points',
        'positions',
        { options },
        ({ options }) => positions(editor, options)
      ),
    previous: <T extends Node>(options?: EditorPreviousOptions<T>) =>
      executeQueryMiddleware(
        editor,
        'nodes',
        'previous',
        { options: options as EditorPreviousOptions<Node> | undefined },
        ({ options }) => previous(editor, options)
      ) as NodeEntry<T> | undefined,
    projectRange: (range) =>
      executeQueryMiddleware(
        editor,
        'ranges',
        'project',
        { range },
        ({ range }) => projectRange(editor, range)
      ),
    range: (at, to) =>
      executeQueryMiddleware(
        editor,
        'ranges',
        'get',
        { at, to },
        ({ at, to }) => range(editor, at, to)
      ),
    string: (at, options) =>
      executeQueryMiddleware(
        editor,
        'text',
        'string',
        { at, options },
        ({ at, options }) => string(editor, at, options)
      ),
    unhangRange: (range, options) =>
      executeQueryMiddleware(
        editor,
        'ranges',
        'unhang',
        { options, range },
        ({ options, range }) => unhangRange(editor, range, options)
      ),
    void: (options) =>
      executeQueryMiddleware(
        editor,
        'nodes',
        'void',
        { options },
        ({ options }) => getVoid(editor, options)
      ),
    shouldMergeNodesRemovePrevNode: (previous, current) =>
      executeQueryMiddleware(
        editor,
        'nodes',
        'shouldMergeNodesRemovePrevNode',
        { current, previous },
        ({ current, previous }) =>
          shouldMergeNodesRemovePrevNode(editor, previous, current)
      ),
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

  const api = new Proxy(Object.create(null) as Record<string, unknown>, {
    get(_target, property) {
      if (typeof property !== 'string') {
        return undefined
      }

      const capabilities = getExtensionRegistry(
        editor as Editor
      ).capabilities.get(property)

      if (!capabilities || capabilities.length === 0) {
        return undefined
      }

      if (capabilities.length === 1) {
        return capabilities[0]
      }

      return Object.freeze(Object.assign({}, ...capabilities))
    },
  }) as Editor<V, TExtensions>['api']

  const getApi = (extension: EditorExtension<any, any>) => {
    if (!isEditorExtensionInstalled(editor as Editor, extension)) {
      throw new Error(
        `Editor extension "${extension.name}" is not installed on this editor.`
      )
    }

    const apiNames = Object.keys(extension.api ?? {})
    const capabilityName = apiNames.includes(extension.name)
      ? extension.name
      : (apiNames[0] ?? extension.name)

    if (apiNames.length > 1 && !apiNames.includes(extension.name)) {
      throw new Error(
        `Editor extension "${extension.name}" must expose exactly one capability or a capability matching its extension name to be used with editor.getApi().`
      )
    }

    const capability = api[capabilityName as keyof typeof api]

    if (capability === undefined) {
      throw new Error(
        `Editor extension "${extension.name}" capability "${capabilityName}" is not installed.`
      )
    }

    return capability
  }

  const baseEditor: Editor<V, TExtensions> = {
    api,
    getApi: getApi as Editor<V, TExtensions>['getApi'],
    read: (fn) => readEditor(editor, fn),
    subscribe: (listener) => subscribe(editor, listener),
    update: (
      fn: (transaction: EditorUpdateTransaction<V, TExtensions>) => void,
      options
    ) =>
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

  if (options.extensions) {
    extendEditor(editor as Editor, options.extensions as EditorExtensionInput)
  }

  return editor
}
