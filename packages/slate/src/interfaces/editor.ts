import type {
  Ancestor,
  Bookmark,
  BookmarkOptions,
  Descendant,
  DescendantIn,
  Element,
  Location,
  Node,
  NodeEntry,
  NodeProps,
  Operation,
  Path,
  PathRef,
  Point,
  PointRef,
  Range,
  RangeRef,
  Span,
  TElement,
  Text,
  TextIn,
} from '..'
import { registerCommand as registerEditorCommand } from '../core/command-registry'
import {
  defineEditorExtension as defineEditorExtensionCore,
  extendEditor as extendEditorCore,
} from '../core/editor-extension'
import {
  getExtensionRegistry as getEditorExtensionRegistry,
  registerCapability as registerEditorCapability,
  registerCommitListener as registerEditorCommitListener,
  registerNormalizer as registerEditorNormalizer,
} from '../core/extension-registry'
import { isEditor } from '../editor/is-editor'
import type {
  LeafEdge,
  MaximizeMode,
  RangeDirection,
  SelectionMode,
  TextDirection,
  TextUnit,
  TextUnitAdjustment,
} from '../types/types'
import type { OmitFirstArg } from '../utils/types'
import type {
  NodeInsertNodesOptions,
  NodeMutationMethods,
} from './transforms/node'
import type { SelectionMutationMethods } from './transforms/selection'
import type {
  TextInsertFragmentOptions,
  TextInsertTextOptions,
  TextMutationMethods,
} from './transforms/text'

/**
 * The `Editor` interface exposes the runtime API of a Slate editor. Document
 * state is read through editor methods and mutated through `editor.update`.
 */
export type Value = TElement[]

type BivariantMethod<TArgs extends readonly unknown[], TResult> = {
  bivarianceHack(...args: TArgs): TResult
}['bivarianceHack']

export interface BaseEditor<V extends Value = Value> {
  // Overrideable core methods.

  applyOperations: BivariantMethod<
    [
      operations: readonly Operation<any>[],
      options?: EditorApplyOperationsOptions,
    ],
    void
  >
  getChildren: () => V
  getDirtyPaths: BivariantMethod<[operation: Operation<any>], Path[]>
  getFragment: () => DescendantIn<V>[]
  getLastCommit: () => EditorCommit<V> | null
  getOperationDirtiness: BivariantMethod<
    [
      operations: readonly Operation<any>[],
      options?: EditorOperationDirtinessOptions<any>,
    ],
    SnapshotChange<any>
  >
  getOperations: (startIndex?: number) => readonly Operation<V>[]
  getPathByRuntimeId: (runtimeId: RuntimeId) => Path | null
  getRuntimeId: (path: Path) => RuntimeId | null
  read: <T>(fn: () => T) => T
  getSelection: () => Selection
  getSnapshot: () => EditorSnapshot<V>
  isElementReadOnly(element: Element): boolean
  isSelectable(element: Element): boolean
  markableVoid(element: Element): boolean
  normalizeNode: (
    entry: NodeEntry,
    options?: {
      operation?: Operation
      fallbackElement?: Element | (() => Element)
      explicit?: boolean
      force?: boolean
    }
  ) => void
  shouldNormalize: ({
    explicit,
    iteration,
    operation,
  }: {
    explicit?: boolean
    iteration: number
    operation?: Operation
  }) => boolean

  // Overrideable core transforms.

  addMark: OmitFirstArg<typeof Editor.addMark>
  bookmark: (range: Range, options?: BookmarkOptions) => Bookmark
  collapse: OmitFirstArg<SelectionMutationMethods['collapse']>
  delete: OmitFirstArg<TextMutationMethods<V>['delete']>
  deleteBackward: (unit: TextUnit) => void
  deleteForward: (unit: TextUnit) => void
  deleteFragment: OmitFirstArg<typeof Editor.deleteFragment>
  deselect: OmitFirstArg<SelectionMutationMethods['deselect']>
  insertBreak: OmitFirstArg<typeof Editor.insertBreak>
  insertFragment: OmitFirstArg<TextMutationMethods['insertFragment']>
  insertNode: OmitFirstArg<typeof Editor.insertNode>
  insertNodes: OmitFirstArg<NodeMutationMethods['insertNodes']>
  insertSoftBreak: OmitFirstArg<typeof Editor.insertSoftBreak>
  insertText: OmitFirstArg<TextMutationMethods<V>['insertText']>
  liftNodes: OmitFirstArg<NodeMutationMethods<V>['liftNodes']>
  mergeNodes: OmitFirstArg<NodeMutationMethods<V>['mergeNodes']>
  move: OmitFirstArg<SelectionMutationMethods['move']>
  moveNodes: OmitFirstArg<NodeMutationMethods<V>['moveNodes']>
  normalize: OmitFirstArg<typeof Editor.normalize>
  removeMark: OmitFirstArg<typeof Editor.removeMark>
  setBlock: OmitFirstArg<typeof Editor.setBlock>
  toggleAlignment: OmitFirstArg<typeof Editor.toggleAlignment>
  toggleMark: OmitFirstArg<typeof Editor.toggleMark>
  toggleBlock: OmitFirstArg<typeof Editor.toggleBlock>
  toggleList: OmitFirstArg<typeof Editor.toggleList>
  removeNodes: OmitFirstArg<NodeMutationMethods<V>['removeNodes']>
  select: OmitFirstArg<SelectionMutationMethods['select']>
  setNodes: <T extends Node>(
    props: Partial<NodeProps<T>>,
    options?: {
      at?: Location
      match?: NodeMatch<T>
      mode?: MaximizeMode
      hanging?: boolean
      split?: boolean
      voids?: boolean
      compare?: PropsCompare
      merge?: PropsMerge
    }
  ) => void
  setNormalizing: OmitFirstArg<typeof Editor.setNormalizing>
  setPoint: OmitFirstArg<SelectionMutationMethods['setPoint']>
  setSelection: OmitFirstArg<SelectionMutationMethods['setSelection']>
  splitNodes: OmitFirstArg<NodeMutationMethods<V>['splitNodes']>
  unsetNodes: OmitFirstArg<NodeMutationMethods<V>['unsetNodes']>
  unwrapNodes: OmitFirstArg<NodeMutationMethods<V>['unwrapNodes']>
  withoutNormalizing: OmitFirstArg<typeof Editor.withoutNormalizing>
  wrapNodes: OmitFirstArg<NodeMutationMethods['wrapNodes']>

  // Overrideable core queries.

  above: <T extends Ancestor>(
    options?: EditorAboveOptions<T>
  ) => NodeEntry<T> | undefined
  after: OmitFirstArg<typeof Editor.after>
  before: OmitFirstArg<typeof Editor.before>
  edges: OmitFirstArg<typeof Editor.edges>
  elementReadOnly: OmitFirstArg<typeof Editor.elementReadOnly>
  end: OmitFirstArg<typeof Editor.end>
  first: OmitFirstArg<typeof Editor.first>
  fragment: OmitFirstArg<typeof Editor.fragment>
  getMarks: OmitFirstArg<typeof Editor.marks>
  hasBlocks: OmitFirstArg<typeof Editor.hasBlocks>
  hasInlines: OmitFirstArg<typeof Editor.hasInlines>
  hasPath: OmitFirstArg<typeof Editor.hasPath>
  hasTexts: OmitFirstArg<typeof Editor.hasTexts>
  isBlock: OmitFirstArg<typeof Editor.isBlock>
  isEdge: OmitFirstArg<typeof Editor.isEdge>
  isEmpty: OmitFirstArg<typeof Editor.isEmpty>
  isEnd: OmitFirstArg<typeof Editor.isEnd>
  isInline(element: Element): boolean
  isNormalizing: OmitFirstArg<typeof Editor.isNormalizing>
  isStart: OmitFirstArg<typeof Editor.isStart>
  isVoid(element: Element): boolean
  last: OmitFirstArg<typeof Editor.last>
  leaf: OmitFirstArg<typeof Editor.leaf>
  levels: <T extends Node>(
    options?: EditorLevelsOptions<T>
  ) => Generator<NodeEntry<T>, void, undefined>
  next: <T extends Descendant>(
    options?: EditorNextOptions<T>
  ) => NodeEntry<T> | undefined
  node: OmitFirstArg<typeof Editor.node>
  nodes: <T extends Node>(
    options?: EditorNodesOptions<T>
  ) => Generator<NodeEntry<T>, void, undefined>
  parent: OmitFirstArg<typeof Editor.parent>
  path: OmitFirstArg<typeof Editor.path>
  pathRef: OmitFirstArg<typeof Editor.pathRef>
  pathRefs: OmitFirstArg<typeof Editor.pathRefs>
  point: OmitFirstArg<typeof Editor.point>
  pointRef: OmitFirstArg<typeof Editor.pointRef>
  pointRefs: OmitFirstArg<typeof Editor.pointRefs>
  positions: OmitFirstArg<typeof Editor.positions>
  previous: <T extends Node>(
    options?: EditorPreviousOptions<T>
  ) => NodeEntry<T> | undefined
  projectRange: (range: Range) => readonly ProjectedRangeSegment[]
  range: OmitFirstArg<typeof Editor.range>
  rangeRef: OmitFirstArg<typeof Editor.rangeRef>
  rangeRefs: OmitFirstArg<typeof Editor.rangeRefs>
  replace: BivariantMethod<[input: SnapshotInput<any>], void>
  reset: BivariantMethod<[input: SnapshotInput<any>], void>
  start: OmitFirstArg<typeof Editor.start>
  string: OmitFirstArg<typeof Editor.string>
  subscribe: (listener: SnapshotListener<any>) => () => void
  update: (fn: () => void, options?: EditorUpdateOptions) => void
  extend: (extension: EditorExtensionInput<any>) => () => void
  unhangRange: OmitFirstArg<typeof Editor.unhangRange>
  void: OmitFirstArg<typeof Editor.void>
  withTransaction: BivariantMethod<
    [fn: (transaction: EditorTransaction<any>) => void],
    void
  >
  shouldMergeNodesRemovePrevNode: OmitFirstArg<
    typeof Editor.shouldMergeNodesRemovePrevNode
  >
}

export type Editor<V extends Value = any> = BaseEditor<V>

type IsAny<T> = 0 extends 1 & T ? true : false

export type ValueOf<E> = E extends { getChildren: () => infer V }
  ? IsAny<V> extends true
    ? Value
    : V extends Value
      ? V
      : Value
  : Value

export type BaseSelection = Range | null

export type Selection = BaseSelection

export type EditorMarks<V extends Value = Value> = Partial<
  Omit<TextIn<V>, 'text'>
>

export type EditorMarksOf<E extends BaseEditor<any> = Editor> = EditorMarks<
  ValueOf<E>
>

export type RuntimeId = string

export type SnapshotIndex = {
  idToPath: Record<RuntimeId, Path>
  pathToId: Record<string, RuntimeId>
}

export type ProjectedRangeSegment = {
  path: Path
  runtimeId: RuntimeId
  start: number
  end: number
}

export type EditorSnapshot<V extends Value = Value> = {
  children: V
  index: SnapshotIndex
  marks: EditorMarks<V> | null
  selection: Selection
  version: number
}

export type SnapshotChangeClass =
  | 'text'
  | 'selection'
  | 'mark'
  | 'structural'
  | 'replace'

export type OperationClass = SnapshotChangeClass

export type SnapshotDirtyScope = 'none' | 'paths' | 'all'

export type SnapshotInput<V extends Value = Value> = {
  children: V
  selection?: Selection
  marks?: EditorMarks<V> | null
}

export type SnapshotListener<V extends Value = Value> = (
  snapshot: EditorSnapshot<V>,
  change?: SnapshotChange<V>
) => void

export type EditorUpdateOptions = {
  skipNormalize?: boolean
  tag?: string | string[]
}

export type EditorApplyOperationsOptions = EditorUpdateOptions

export type EditorOperationDirtinessOptions<V extends Value = Value> = {
  command?: EditorCommitCommand | null
  marksBefore?: EditorMarks<V> | null
  previousIndex?: SnapshotIndex
  previousVersion?: number
  reason?: 'replace' | null
  selectionBefore?: Selection
}

export type EditorTransaction<V extends Value = Value> = {
  apply: (operation: Operation<V>) => void
  readonly children: V
  getModelSelection: () => Selection
  readonly marks: EditorMarks<V> | null
  readonly operations: readonly Operation<V>[]
  resolveTarget: (options?: { at?: Location }) => Location | null
  readonly selection: Selection
  setMarks: (marks: EditorMarks<V> | null) => void
  setSelection: (selection: Selection) => void
}

export type TargetFreshnessRequest = {
  fallback: Selection
  reason: 'implicit-target'
}

export type EditorTargetRuntime = {
  resolveImplicitTarget: (
    editor: Editor,
    request: TargetFreshnessRequest
  ) => Selection
}

export type EditorCommand = {
  type: string
}

export type EditorCommitCommand = {
  origin: 'command'
  type: string
}

export type EditorCommandContext<
  TCommand extends EditorCommand,
  TEditor extends Editor = Editor,
> = {
  command: TCommand
  editor: TEditor
}

export type EditorCommandResult = {
  handled: boolean
}

export type EditorCommandNext<TCommand extends EditorCommand> = (
  command?: TCommand
) => EditorCommandResult

export type EditorCommandHandler<
  TCommand extends EditorCommand,
  TEditor extends Editor = Editor,
> = (
  context: EditorCommandContext<TCommand, TEditor>,
  next: EditorCommandNext<TCommand>
) => EditorCommandResult | void

export type EditorOperationContext<TEditor extends BaseEditor<any> = Editor> = {
  editor: TEditor
  operation: Operation<ValueOf<TEditor>>
}

export type EditorOperationNext<TEditor extends BaseEditor<any> = Editor> = (
  operation?: Operation<ValueOf<TEditor>>
) => void

export type EditorOperationMiddleware<
  TEditor extends BaseEditor<any> = Editor,
> = (
  context: EditorOperationContext<TEditor>,
  next: EditorOperationNext<TEditor>
) => void

export type EditorCommandOptions = {
  priority?: number
}

export type EditorExtensionCommand<
  TCommand extends EditorCommand = EditorCommand,
  TEditor extends Editor = Editor,
> = {
  handler: EditorCommandHandler<TCommand, TEditor>
  options?: EditorCommandOptions
  type: TCommand['type']
}

export type EditorExtensionMethod<TEditor extends BaseEditor<any> = Editor> = (
  this: TEditor,
  ...args: any[]
) => any

export type EditorExtensionMethodMap<TEditor extends BaseEditor<any> = Editor> =
  Record<string, EditorExtensionMethod<TEditor>>

export type EditorExtensionMethods<TEditor extends BaseEditor<any> = Editor> =
  | EditorExtensionMethodMap<TEditor>
  | ((editor: TEditor) => EditorExtensionMethodMap<TEditor>)

export type EditorExtension<TEditor extends BaseEditor<any> = Editor> = {
  capabilities?: Record<string, unknown | readonly unknown[]>
  commands?: readonly EditorExtensionCommand<
    EditorCommand,
    Extract<TEditor, Editor>
  >[]
  commitListeners?: readonly EditorCommitListener<ValueOf<TEditor>>[]
  dependencies?: readonly string[]
  methods?: EditorExtensionMethods<TEditor>
  name: string
  normalizers?: Record<string, unknown>
  operationMiddlewares?: readonly EditorOperationMiddleware<TEditor>[]
}

export type EditorExtensionInput<TEditor extends BaseEditor<any> = Editor> =
  | EditorExtension<TEditor>
  | readonly EditorExtension<TEditor>[]

export type RegisteredEditorExtension = {
  dependencies: readonly string[]
  name: string
  order: number
}

export type EditorExtensionRegistry = {
  capabilities: Map<string, unknown[]>
  commands: Map<string, unknown[]>
  commitListeners: Set<EditorCommitListener>
  extensions: Map<string, RegisteredEditorExtension>
  methodNames: Set<string>
  normalizers: Map<string, unknown>
  operationMiddlewares: Set<EditorOperationMiddleware>
}

export type EditorCommitListener<V extends Value = Value> = (
  commit: EditorCommit<V>,
  snapshot: EditorSnapshot<V>
) => void

export type DirtyRegion = {
  paths: readonly Path[]
  runtimeIds: readonly RuntimeId[]
  topLevelRange: readonly [number, number] | null
  wholeDocument: boolean
}

export type EditorCommit<V extends Value = Value> = {
  childrenChanged: boolean
  classes: readonly OperationClass[]
  command: EditorCommitCommand | null
  decorationImpactRuntimeIds: readonly RuntimeId[] | null
  dirty: DirtyRegion
  dirtyPaths: readonly Path[]
  dirtyScope: SnapshotDirtyScope
  marksAfter: EditorMarks<V> | null
  marksBefore: EditorMarks<V> | null
  marksChanged: boolean
  nodeImpactRuntimeIds: readonly RuntimeId[] | null
  operations: readonly Operation<V>[]
  previousVersion: number
  replaceEpoch: number
  selectionAfter: Selection
  selectionBefore: Selection
  selectionChanged: boolean
  selectionImpactRuntimeIds: readonly RuntimeId[] | null
  snapshotChanged: boolean
  structureChanged: boolean
  textChanged: boolean
  touchedRuntimeIds: readonly RuntimeId[] | null
  tags: readonly string[]
  version: number
}

export type SnapshotChange<V extends Value = Value> = EditorCommit<V>

export interface EditorAboveOptions<T extends Ancestor> {
  at?: Location
  match?: NodeMatch<T>
  mode?: MaximizeMode
  voids?: boolean
}

export interface EditorAfterOptions {
  distance?: number
  unit?: TextUnitAdjustment
  voids?: boolean
}

export interface EditorBeforeOptions {
  distance?: number
  unit?: TextUnitAdjustment
  voids?: boolean
}

export interface EditorDirectedDeletionOptions {
  unit?: TextUnit
}

export interface EditorElementReadOnlyOptions {
  at?: Location
  mode?: MaximizeMode
  voids?: boolean
}

export interface EditorFragmentDeletionOptions {
  direction?: TextDirection
}

export interface EditorIsEditorOptions {
  deep?: boolean
}

export interface EditorLeafOptions {
  depth?: number
  edge?: LeafEdge
}

export interface EditorLevelsOptions<T extends Node> {
  at?: Location
  match?: NodeMatch<T>
  reverse?: boolean
  voids?: boolean
}

export interface EditorNextOptions<T extends Descendant> {
  at?: Location
  match?: NodeMatch<T>
  mode?: SelectionMode
  voids?: boolean
}

export interface EditorNodeOptions {
  depth?: number
  edge?: LeafEdge
}

export interface EditorNodesOptions<T extends Node> {
  at?: Location | Span
  match?: NodeMatch<T>
  mode?: SelectionMode
  universal?: boolean
  reverse?: boolean
  voids?: boolean
  pass?: (entry: NodeEntry) => boolean
}

export interface EditorNormalizeOptions {
  explicit?: boolean
  force?: boolean
  operation?: Operation
}

export interface EditorParentOptions {
  depth?: number
  edge?: LeafEdge
}

export interface EditorPathOptions {
  depth?: number
  edge?: LeafEdge
}

export interface EditorPathRefOptions {
  affinity?: TextDirection | null
}

export interface EditorPointOptions {
  edge?: LeafEdge
}

export interface EditorPointRefOptions {
  affinity?: TextDirection | null
}

export interface EditorPositionsOptions {
  at?: Location
  unit?: TextUnitAdjustment
  reverse?: boolean
  voids?: boolean
}

export interface EditorPreviousOptions<T extends Node> {
  at?: Location
  match?: NodeMatch<T>
  mode?: SelectionMode
  voids?: boolean
}

export interface EditorRangeRefOptions {
  affinity?: RangeDirection | null
}

export interface EditorStringOptions {
  voids?: boolean
}

export interface EditorUnhangRangeOptions {
  voids?: boolean
}

export interface EditorVoidOptions {
  at?: Location
  mode?: MaximizeMode
  voids?: boolean
}

export interface EditorInterface {
  /**
   * Get the ancestor above a location in the document.
   */
  above: <T extends Ancestor>(
    editor: Editor,
    options?: EditorAboveOptions<T>
  ) => NodeEntry<T> | undefined

  /**
   * Add a custom property to the leaf text nodes in the current selection.
   *
   * If the selection is currently collapsed, the marks are stored by the
   * editor runtime and applied when text is inserted next.
   */
  addMark: (editor: Editor, key: string, value: any) => void

  /**
   * Import or replay operations through the transaction runtime.
   */
  applyOperations: <V extends Value>(
    editor: Editor<V>,
    operations: readonly Operation<V>[],
    options?: EditorApplyOperationsOptions
  ) => void

  /**
   * Create a hidden, op-rebased bookmark for a range.
   */
  bookmark: (
    editor: Editor,
    range: Range,
    options?: BookmarkOptions
  ) => Bookmark

  /**
   * Get the point after a location.
   */
  after: (
    editor: Editor,
    at: Location,
    options?: EditorAfterOptions
  ) => Point | undefined

  /**
   * Get the point before a location.
   */
  before: (
    editor: Editor,
    at: Location,
    options?: EditorBeforeOptions
  ) => Point | undefined

  /**
   * Delete content in the editor backward from the current selection.
   */
  deleteBackward: (
    editor: Editor,
    options?: EditorDirectedDeletionOptions
  ) => void

  /**
   * Delete content in the editor forward from the current selection.
   */
  deleteForward: (
    editor: Editor,
    options?: EditorDirectedDeletionOptions
  ) => void

  /**
   * Delete the content in the current selection.
   */
  deleteFragment: (
    editor: Editor,
    options?: EditorFragmentDeletionOptions
  ) => void

  /**
   * Get the start and end points of a location.
   */
  edges: (editor: Editor, at: Location) => [Point, Point]

  /**
   * Get the current operation queue through the explicit read seam.
   */
  getOperations: <V extends Value>(
    editor: Editor<V>,
    startIndex?: number
  ) => readonly Operation<V>[]

  /**
   * Derive operation dirtiness metadata without rebuilding a snapshot.
   */
  getOperationDirtiness: <V extends Value>(
    editor: Editor<V>,
    operations: readonly Operation<V>[],
    options?: EditorOperationDirtinessOptions<V>
  ) => SnapshotChange<V>

  /**
   * Get the latest committed transaction metadata.
   */
  getLastCommit: <V extends Value>(editor: Editor<V>) => EditorCommit<V> | null

  /**
   * Get the extension registry for an editor.
   */
  getExtensionRegistry: (editor: Editor) => EditorExtensionRegistry

  /**
   * Resolve the current live path for a runtime id without rebuilding a snapshot.
   */
  getPathByRuntimeId: (editor: Editor, runtimeId: RuntimeId) => Path | null

  /**
   * Get the runtime id for a live node path without rebuilding a snapshot.
   */
  getRuntimeId: (editor: Editor, path: Path) => RuntimeId | null

  /**
   * Run a coherent synchronous read against the current editor/runtime state.
   */
  read: <T>(editor: Editor, fn: () => T) => T

  /**
   * Match a read-only element in the current branch of the editor.
   */
  elementReadOnly: (
    editor: Editor,
    options?: EditorElementReadOnlyOptions
  ) => NodeEntry<Element> | undefined

  /**
   * Get the end point of a location.
   */
  end: (editor: Editor, at: Location) => Point

  /**
   * Get the first node at a location.
   */
  first: (editor: Editor, at: Location) => NodeEntry

  /**
   * Get the current children through the public accessor seam.
   */
  getChildren: <V extends Value>(editor: Editor<V>) => V

  /**
   * Get the current selection through the selection freshness runtime.
   */
  getSelection: (editor: Editor) => Selection

  /**
   * Get the fragment at a location.
   */
  fragment: <V extends Value>(
    editor: Editor<V>,
    at: Location
  ) => DescendantIn<V>[]

  /**
   * Get the current dirty-path derivation for an operation.
   */
  getDirtyPaths: <V extends Value>(
    editor: Editor<V>,
    operation: Operation<V>
  ) => Path[]

  /**
   * Get the fragment at the current selection.
   */
  getFragment: <V extends Value>(editor: Editor<V>) => DescendantIn<V>[]

  /**
   * Get the current immutable snapshot of editor state.
   */
  getSnapshot: <V extends Value>(editor: Editor<V>) => EditorSnapshot<V>

  /**
   * Check if a node has block children.
   */
  hasBlocks: (editor: Editor, element: Element) => boolean

  /**
   * Check if a node has inline and text children.
   */
  hasInlines: (editor: Editor, element: Element) => boolean

  hasPath: (editor: Editor, path: Path) => boolean

  /**
   * Check if a node has text children.
   */
  hasTexts: (editor: Editor, element: Element) => boolean

  /**
   * Insert a block break at the current selection.
   *
   * If the selection is currently expanded, it will be deleted first.
   */
  insertBreak: (editor: Editor) => void

  /**
   * Inserts a fragment
   * at the specified location or (if not defined) the current selection or (if not defined) the end of the document.
   */
  insertFragment: <V extends Value>(
    editor: Editor<V>,
    fragment: DescendantIn<V>[],
    options?: TextInsertFragmentOptions
  ) => void

  /**
   * Atomically inserts `nodes`
   * at the specified location or (if not defined) the current selection or (if not defined) the end of the document.
   */
  insertNode: <V extends Value, T extends DescendantIn<V>>(
    editor: Editor<V>,
    node: T,
    options?: NodeInsertNodesOptions<T>
  ) => void

  /**
   * Insert a soft break at the current selection.
   *
   * If the selection is currently expanded, it will be deleted first.
   */
  insertSoftBreak: (editor: Editor) => void

  /**
   * Insert a string of text
   * at the specified location or (if not defined) the current selection or (if not defined) the end of the document.
   */
  insertText: (
    editor: Editor,
    text: string,
    options?: TextInsertTextOptions
  ) => void

  /**
   * Check if a value is a block `Element` object.
   */
  isBlock: (editor: Editor, value: Element) => boolean

  /**
   * Check if a point is an edge of a location.
   */
  isEdge: (editor: Editor, point: Point, at: Location) => boolean

  /**
   * Check if a value is an `Editor` object.
   */
  isEditor: (value: any, options?: EditorIsEditorOptions) => value is Editor

  /**
   * Check if a value is a read-only `Element` object.
   */
  isElementReadOnly: (editor: Editor, element: Element) => boolean

  /**
   * Check if an element is empty, accounting for void nodes.
   */
  isEmpty: (editor: Editor, element: Element) => boolean

  /**
   * Check if a point is the end point of a location.
   */
  isEnd: (editor: Editor, point: Point, at: Location) => boolean

  /**
   * Check if a value is an inline `Element` object.
   */
  isInline: (editor: Editor, value: Element) => boolean

  /**
   * Check if the editor is currently normalizing after each operation.
   */
  isNormalizing: (editor: Editor) => boolean

  /**
   * Check if a value is a selectable `Element` object.
   */
  isSelectable: (editor: Editor, element: Element) => boolean

  /**
   * Check if a point is the start point of a location.
   */
  isStart: (editor: Editor, point: Point, at: Location) => boolean

  /**
   * Check if a value is a void `Element` object.
   */
  isVoid: (editor: Editor, value: Element) => boolean

  /**
   * Get the last node at a location.
   */
  last: (editor: Editor, at: Location) => NodeEntry

  /**
   * Get the leaf text node at a location.
   */
  leaf: (
    editor: Editor,
    at: Location,
    options?: EditorLeafOptions
  ) => NodeEntry<Text>

  /**
   * Iterate through all of the levels at a location.
   */
  levels: <T extends Node>(
    editor: Editor,
    options?: EditorLevelsOptions<T>
  ) => Generator<NodeEntry<T>, void, undefined>

  /**
   * Get the marks that would be added to text at the current selection.
   */
  marks: (editor: Editor) => Omit<Text, 'text'> | null

  /**
   * Get the matching node in the branch of the document after a location.
   */
  next: <T extends Descendant>(
    editor: Editor,
    options?: EditorNextOptions<T>
  ) => NodeEntry<T> | undefined

  /**
   * Get the node at a location.
   */
  node: (editor: Editor, at: Location, options?: EditorNodeOptions) => NodeEntry

  /**
   * Iterate through all of the nodes in the Editor.
   */
  nodes: <T extends Node>(
    editor: Editor,
    options?: EditorNodesOptions<T>
  ) => Generator<NodeEntry<T>, void, undefined>

  /**
   * Normalize any dirty objects in the editor.
   */
  normalize: (editor: Editor, options?: EditorNormalizeOptions) => void

  /**
   * Get the parent node of a location.
   */
  parent: (
    editor: Editor,
    at: Location,
    options?: EditorParentOptions
  ) => NodeEntry<Ancestor>

  /**
   * Get the path of a location.
   */
  path: (editor: Editor, at: Location, options?: EditorPathOptions) => Path

  /**
   * Create a mutable ref for a `Path` object, which will stay in sync as new
   * operations are applied to the editor.
   */
  pathRef: (
    editor: Editor,
    path: Path,
    options?: EditorPathRefOptions
  ) => PathRef

  /**
   * Get the set of currently tracked path refs of the editor.
   */
  pathRefs: (editor: Editor) => Set<PathRef>

  /**
   * Get the start or end point of a location.
   */
  point: (editor: Editor, at: Location, options?: EditorPointOptions) => Point

  /**
   * Create a mutable ref for a `Point` object, which will stay in sync as new
   * operations are applied to the editor.
   */
  pointRef: (
    editor: Editor,
    point: Point,
    options?: EditorPointRefOptions
  ) => PointRef

  /**
   * Get the set of currently tracked point refs of the editor.
   */
  pointRefs: (editor: Editor) => Set<PointRef>

  projectRange: (
    editor: Editor,
    range: Range
  ) => readonly ProjectedRangeSegment[]

  /**
   * Return all the positions in `at` range where a `Point` can be placed.
   *
   * By default, moves forward by individual offsets at a time, but
   * the `unit` option can be used to to move by character, word, line, or block.
   *
   * The `reverse` option can be used to change iteration direction.
   *
   * Note: By default void nodes are treated as a single point and iteration
   * will not happen inside their content unless you pass in true for the
   * `voids` option, then iteration will occur.
   */
  positions: (
    editor: Editor,
    options?: EditorPositionsOptions
  ) => Generator<Point, void, undefined>

  /**
   * Get the matching node in the branch of the document before a location.
   */
  previous: <T extends Node>(
    editor: Editor,
    options?: EditorPreviousOptions<T>
  ) => NodeEntry<T> | undefined

  /**
   * Get a range of a location.
   */
  range: (editor: Editor, at: Location, to?: Location) => Range

  /**
   * Create a mutable ref for a `Range` object, which will stay in sync as new
   * operations are applied to the editor.
   */
  rangeRef: (
    editor: Editor,
    range: Range,
    options?: EditorRangeRefOptions
  ) => RangeRef

  /**
   * Get the set of currently tracked range refs of the editor.
   */
  rangeRefs: (editor: Editor) => Set<RangeRef>

  /**
   * Register a command middleware handler for the editor.
   */
  registerCommand: <TCommand extends EditorCommand>(
    editor: Editor,
    type: TCommand['type'],
    handler: EditorCommandHandler<TCommand>,
    options?: EditorCommandOptions
  ) => () => void

  /**
   * Register an extension capability value.
   */
  registerCapability: (
    editor: Editor,
    name: string,
    capability: unknown
  ) => () => void

  /**
   * Register an extension normalizer placeholder.
   */
  registerNormalizer: (
    editor: Editor,
    id: string,
    normalizer: unknown
  ) => () => void

  /**
   * Register an extension commit listener placeholder.
   */
  registerCommitListener: <V extends Value>(
    editor: Editor<V>,
    listener: EditorCommitListener<V>
  ) => () => void

  extend: <TEditor extends Editor>(
    editor: TEditor,
    extension: EditorExtensionInput<TEditor>
  ) => () => void

  defineEditorExtension: <TEditor extends BaseEditor<any> = Editor>(
    extension: EditorExtension<TEditor>
  ) => EditorExtension<TEditor>

  replace: <V extends Value>(editor: Editor<V>, input: SnapshotInput<V>) => void

  reset: <V extends Value>(editor: Editor<V>, input: SnapshotInput<V>) => void

  setBlock: (
    editor: Editor,
    props: Partial<Element>,
    options?: {
      at?: Location
      hanging?: boolean
      mode?: MaximizeMode
      split?: boolean
      voids?: boolean
    }
  ) => void

  /**
   * Remove a custom property from all of the leaf text nodes in the current
   * selection.
   *
   * If the selection is currently collapsed, the removal is stored by the
   * editor runtime and applied to the text inserted next.
   */
  removeMark: (editor: Editor, key: string) => void

  /**
   * Toggle a custom property on the leaf text nodes in the current selection.
   *
   * If the selection is collapsed, the mark is stored for the next inserted
   * text.
   */
  toggleMark: (editor: Editor, key: string, value?: any) => void

  toggleBlock: (
    editor: Editor,
    type: string,
    options?: {
      at?: Location
      defaultType?: string
      hanging?: boolean
      mode?: MaximizeMode
      split?: boolean
      voids?: boolean
    }
  ) => void

  toggleAlignment: (
    editor: Editor,
    align: string,
    options?: {
      at?: Location
      hanging?: boolean
      mode?: MaximizeMode
      split?: boolean
      voids?: boolean
    }
  ) => void

  toggleList: (
    editor: Editor,
    type: string,
    options?: {
      at?: Location
      itemType?: string
      listTypes?: readonly string[]
      split?: boolean
      voids?: boolean
    }
  ) => void

  /**
   * Manually set if the editor should currently be normalizing.
   *
   * Note: Using this incorrectly can leave the editor in an invalid state.
   *
   */
  setNormalizing: (editor: Editor, isNormalizing: boolean) => void

  /**
   * Get the start point of a location.
   */
  start: (editor: Editor, at: Location) => Point

  /**
   * Get the text string content of a location.
   *
   * Note: by default the text of void nodes is considered to be an empty
   * string, regardless of content, unless you pass in true for the voids option
   */
  string: (
    editor: Editor,
    at: Location,
    options?: EditorStringOptions
  ) => string

  subscribe: <V extends Value>(
    editor: Editor<V>,
    listener: SnapshotListener<V>
  ) => () => void

  update: (
    editor: Editor,
    fn: () => void,
    options?: EditorUpdateOptions
  ) => void

  /**
   * Convert a range into a non-hanging one.
   */
  unhangRange: (
    editor: Editor,
    range: Range,
    options?: EditorUnhangRangeOptions
  ) => Range

  /**
   * Match a void node in the current branch of the editor.
   */
  void: (
    editor: Editor,
    options?: EditorVoidOptions
  ) => NodeEntry<Element> | undefined

  withTransaction: <V extends Value>(
    editor: Editor<V>,
    fn: (transaction: EditorTransaction<V>) => void
  ) => void

  /**
   * Call a function, deferring normalization until after it completes.
   */
  withoutNormalizing: (editor: Editor, fn: () => void) => void

  /**
   *  Call a function, Determine whether or not remove the previous node when merge.
   */
  shouldMergeNodesRemovePrevNode: (
    editor: Editor,
    prevNodeEntry: NodeEntry,
    curNodeEntry: NodeEntry
  ) => boolean
}

// eslint-disable-next-line no-redeclare
export const Editor: EditorInterface = {
  above(editor, options) {
    return editor.above(options)
  },

  addMark(editor, key, value) {
    editor.addMark(key, value)
  },

  applyOperations(editor, operations, options) {
    editor.applyOperations(operations, options)
  },

  bookmark(editor, range, options) {
    return editor.bookmark(range, options)
  },

  after(editor, at, options) {
    return editor.after(at, options)
  },

  before(editor, at, options) {
    return editor.before(at, options)
  },

  deleteBackward(editor, options = {}) {
    const { unit = 'character' } = options
    editor.deleteBackward(unit)
  },

  deleteForward(editor, options = {}) {
    const { unit = 'character' } = options
    editor.deleteForward(unit)
  },

  deleteFragment(editor, options) {
    editor.deleteFragment(options)
  },

  edges(editor, at) {
    return editor.edges(at)
  },

  elementReadOnly(editor: Editor, options: EditorElementReadOnlyOptions = {}) {
    return editor.elementReadOnly(options)
  },

  end(editor, at) {
    return editor.end(at)
  },

  first(editor, at) {
    return editor.first(at)
  },

  fragment<V extends Value>(editor: Editor<V>, at: Location) {
    return editor.fragment(at) as DescendantIn<V>[]
  },

  getFragment(editor) {
    return editor.getFragment()
  },

  getChildren(editor) {
    return editor.getChildren()
  },

  getLastCommit(editor) {
    return editor.getLastCommit()
  },

  getOperationDirtiness(editor, operations, options) {
    return editor.getOperationDirtiness(operations, options)
  },

  getDirtyPaths(editor, operation) {
    return editor.getDirtyPaths(operation)
  },

  getExtensionRegistry(editor) {
    return getEditorExtensionRegistry(editor)
  },

  getSnapshot(editor) {
    return editor.getSnapshot()
  },

  getOperations<V extends Value>(editor: Editor<V>, startIndex?: number) {
    return editor.getOperations(startIndex) as readonly Operation<V>[]
  },

  getPathByRuntimeId(editor, runtimeId) {
    return editor.getPathByRuntimeId(runtimeId)
  },

  getRuntimeId(editor, path) {
    return editor.getRuntimeId(path)
  },

  read(editor, fn) {
    return editor.read(fn)
  },

  getSelection(editor) {
    return editor.getSelection()
  },

  hasBlocks(editor, element) {
    return editor.hasBlocks(element)
  },

  hasInlines(editor, element) {
    return editor.hasInlines(element)
  },

  hasPath(editor, path) {
    return editor.hasPath(path)
  },

  hasTexts(editor, element) {
    return editor.hasTexts(element)
  },

  insertBreak(editor) {
    editor.insertBreak()
  },

  insertFragment(editor, fragment, options) {
    editor.insertFragment(fragment, options)
  },

  insertNode(editor, node) {
    editor.insertNode(node)
  },

  insertSoftBreak(editor) {
    editor.insertSoftBreak()
  },

  insertText(editor, text) {
    editor.insertText(text)
  },

  isBlock(editor, value) {
    return editor.isBlock(value)
  },

  isEdge(editor, point, at) {
    return editor.isEdge(point, at)
  },

  isEditor,

  isElementReadOnly(editor, element) {
    return editor.isElementReadOnly(element)
  },

  isEmpty(editor, element) {
    return editor.isEmpty(element)
  },

  isEnd(editor, point, at) {
    return editor.isEnd(point, at)
  },

  isInline(editor, value) {
    return editor.isInline(value)
  },

  isNormalizing(editor) {
    return editor.isNormalizing()
  },

  isSelectable(editor: Editor, value: Element) {
    return editor.isSelectable(value)
  },

  isStart(editor, point, at) {
    return editor.isStart(point, at)
  },

  isVoid(editor, value) {
    return editor.isVoid(value)
  },

  last(editor, at) {
    return editor.last(at)
  },

  leaf(editor, at, options) {
    return editor.leaf(at, options)
  },

  levels(editor, options) {
    return editor.levels(options)
  },

  marks(editor) {
    return editor.getMarks()
  },

  next<T extends Descendant>(
    editor: Editor,
    options?: EditorNextOptions<T>
  ): NodeEntry<T> | undefined {
    return editor.next(options)
  },

  node(editor, at, options) {
    return editor.node(at, options)
  },

  nodes(editor, options) {
    return editor.nodes(options)
  },

  normalize(editor, options) {
    editor.normalize(options)
  },

  parent(editor, at, options) {
    return editor.parent(at, options)
  },

  path(editor, at, options) {
    return editor.path(at, options)
  },

  pathRef(editor, path, options) {
    return editor.pathRef(path, options)
  },

  pathRefs(editor) {
    return editor.pathRefs()
  },

  point(editor, at, options) {
    return editor.point(at, options)
  },

  pointRef(editor, point, options) {
    return editor.pointRef(point, options)
  },

  pointRefs(editor) {
    return editor.pointRefs()
  },

  projectRange(editor, range) {
    return editor.projectRange(range)
  },

  positions(editor, options) {
    return editor.positions(options)
  },

  previous(editor, options) {
    return editor.previous(options)
  },

  range(editor, at, to) {
    return editor.range(at, to)
  },

  rangeRef(editor, range, options) {
    return editor.rangeRef(range, options)
  },

  rangeRefs(editor) {
    return editor.rangeRefs()
  },

  registerCommand(editor, type, handler, options) {
    return registerEditorCommand(editor, type, handler, options)
  },

  registerCapability(editor, name, capability) {
    return registerEditorCapability(editor, name, capability)
  },

  registerNormalizer(editor, id, normalizer) {
    return registerEditorNormalizer(editor, id, normalizer)
  },

  registerCommitListener(editor, listener) {
    return registerEditorCommitListener(
      editor,
      listener as EditorCommitListener<ValueOf<typeof editor>>
    )
  },

  extend(editor, extension) {
    return extendEditorCore(editor, extension)
  },

  defineEditorExtension(extension) {
    return defineEditorExtensionCore(extension)
  },

  replace(editor, input) {
    editor.replace(input)
  },

  reset(editor, input) {
    editor.reset(input)
  },

  removeMark(editor, key) {
    editor.removeMark(key)
  },

  toggleMark(editor, key, value = true) {
    editor.toggleMark(key, value)
  },

  setBlock(editor, props, options) {
    editor.setBlock(props, options)
  },

  toggleBlock(editor, type, options) {
    editor.toggleBlock(type, options)
  },

  toggleAlignment(editor, align, options) {
    editor.toggleAlignment(align, options)
  },

  toggleList(editor, type, options) {
    editor.toggleList(type, options)
  },

  setNormalizing(editor, isNormalizing) {
    editor.setNormalizing(isNormalizing)
  },

  start(editor, at) {
    return editor.start(at)
  },

  string(editor, at, options) {
    return editor.string(at, options)
  },

  subscribe(editor, listener) {
    return editor.subscribe(listener)
  },

  update(editor, fn, options) {
    editor.update(fn, options)
  },

  unhangRange(editor, range, options) {
    return editor.unhangRange(range, options)
  },

  void(editor, options) {
    return editor.void(options)
  },

  withTransaction<V extends Value>(
    editor: Editor<V>,
    fn: (transaction: EditorTransaction<V>) => void
  ) {
    editor.withTransaction(fn as (transaction: EditorTransaction<any>) => void)
  },

  withoutNormalizing(editor, fn: () => void) {
    editor.withoutNormalizing(fn)
  },
  shouldMergeNodesRemovePrevNode: (editor, prevNode, curNode) => {
    return editor.shouldMergeNodesRemovePrevNode(prevNode, curNode)
  },
}

/**
 * A helper type for narrowing matched nodes with a predicate.
 */

export type NodeMatch<T extends Node> =
  | ((node: Node, path: Path) => node is T)
  | ((node: Node, path: Path) => boolean)

export type PropsCompare = (prop: unknown, node: unknown) => boolean
export type PropsMerge = (prop: unknown, node: unknown) => object
