import type { TextareaHTMLAttributes } from 'react'
import React, { type CSSProperties, type ReactNode } from 'react'
import type {
  Ancestor,
  Descendant,
  Path,
  RootKey,
  RuntimeId,
  Element as SlateElementNode,
  Node as SlateNode,
  Range as SlateRange,
  Text as SlateTextNode,
} from 'slate'
import { NodeApi } from 'slate'
import {
  EDITOR_TO_PLACEHOLDER_ELEMENT,
  IS_NODE_MAP_DIRTY,
  NODE_TO_INDEX,
  NODE_TO_PARENT,
} from 'slate-dom'
import {
  DOMCoverage,
  type DOMCoverageBoundary,
  type DOMCoverageCopyPolicy,
  type DOMCoverageFindPolicy,
  type DOMCoverageReason,
  type DOMCoverageSelectionPolicy,
} from 'slate-dom/internal'
import {
  ElementContext,
  ElementPathContext,
  NodeRuntimeIdContext,
  SlateContentRootOwnerContext,
  SlateDOMTextSyncContext,
  SlateEditableRootContext,
} from '../context'
import {
  composeProjectionSources,
  createDecorationSource,
  type SlateDecoration,
  type SlateOverlayProjectionStore,
} from '../decoration-source'
import type { DOMStrategyOptions } from '../dom-strategy/create-segment-plan'
import { DOMStrategySegmentPlaceholder } from '../dom-strategy/segment-placeholder'
import {
  type DOMStrategyVirtualizedConfig,
  getVirtualizerScrollElement,
  useVirtualizedRootPlan,
  type VirtualizedPageLayoutItem,
  type VirtualizedTopLevelLayoutItem,
} from '../dom-strategy/use-virtualized-root-plan'
import { DOMStrategyVirtualizedRangeBoundary } from '../dom-strategy/virtualized-range-boundary'
import { useRootInteractionController } from '../editable/root-interaction-controller'
import {
  type DOMStrategyRootConfig,
  useInternalSegmentDOMStrategyRootSources,
  usePlaceholderValue,
  useRootDocumentEpoch,
  useSelectionPaths,
  useTopLevelSelectionIndex,
} from '../editable/root-selector-sources'
import { Editor } from '../editable/runtime-editor-api'
import { readRuntimeNode } from '../editable/runtime-live-state'
import { useEditor } from '../hooks/use-editor'
import { useEditorReadOnly } from '../hooks/use-editor-read-only'
import { useIsomorphicLayoutEffect } from '../hooks/use-isomorphic-layout-effect'
import { useMountedNodeRenderSelector } from '../hooks/use-node-selector'
import { useSlateContentRoot } from '../hooks/use-slate-content-root'
import { useSlateNodeRef } from '../hooks/use-slate-node-ref'
import { useRequiredSlateRuntimeContext } from '../hooks/use-slate-runtime'
import { ReactEditor, type ReactRuntimeEditor } from '../plugin/react-editor'
import { ProjectionContext } from '../projection-context'
import type {
  SlateProjectionRuntimeScope,
  SlateSourceDirtiness,
} from '../projection-store'
import { recordSlateReactRender } from '../render-profiler'
import {
  type DOMCoverageBoundaryMaterializePayload,
  DOMCoverageBoundaryRange,
  DOMCoverageSelfBoundary,
} from './dom-coverage-boundary'
import {
  type EditableDOMBeforeInputHandler,
  EditableDOMRoot,
  type EditableDOMStrategyCohort,
  type EditableDOMStrategyMetrics,
  type EditableDOMStrategyMetricsBase,
  type EditableKeyDownHandler,
} from './editable'
import { EditableElement } from './editable-element'
import {
  EditableText,
  type EditableTextLeafProps,
  type EditableTextRenderPlaceholderProps,
  type EditableTextRenderTextProps,
  type EditableTextSegment,
} from './editable-text'
import { Slate } from './slate'
import { SlateInlineVoidShell, SlateVoidShell } from './slate-void-shell'

const isText = (value: Descendant): value is SlateTextNode =>
  typeof (value as SlateTextNode).text === 'string'

type ProcessLike = {
  env?: {
    NODE_ENV?: string
  }
}

export const isSlateReactDevelopmentEnvironment = (
  processLike: ProcessLike | undefined = (
    globalThis as { process?: ProcessLike }
  ).process
) =>
  processLike?.env?.NODE_ENV != null &&
  processLike.env.NODE_ENV !== 'production'

const isDevelopment = isSlateReactDevelopmentEnvironment()

const EMPTY_RUNTIME_IDS = Object.freeze([]) as readonly RuntimeId[]
const EMPTY_DIRECT_TEXT_CHILD_NODES = Object.freeze(
  []
) as readonly (SlateTextNode | null)[]
const EMPTY_DECORATIONS = Object.freeze(
  []
) as readonly EditableDecoration<unknown>[]
const ROOT_GROUP_SIZE = 16
const ROOT_GROUP_THRESHOLD = 1000
const ROOT_GROUP_BACKGROUND_MOUNT_INITIAL_DELAY_MS = 500
const ROOT_GROUP_BACKGROUND_MOUNT_DELAY_MS = 16
const ROOT_GROUP_BACKGROUND_MOUNT_BATCH_SIZE = 16

const getSnapshotPathKey = (path: Path) => path.join('.')

const getDOMStrategyType = (
  domStrategyOptions: InternalDOMStrategyOptions | null | undefined
) =>
  typeof domStrategyOptions === 'string'
    ? domStrategyOptions
    : (domStrategyOptions?.type ?? 'auto')

type InternalPartialDOMStrategyOptions = {
  overscan?: number
  previewChars?: number
  threshold?: number
  segmentSize?: number
  type: 'partial-dom'
}

type InternalDOMStrategyOptions =
  | DOMStrategyOptions
  | InternalPartialDOMStrategyOptions

const getInternalPartialDOMStrategyOptions = (
  domStrategyOptions: InternalDOMStrategyOptions | null | undefined
) =>
  typeof domStrategyOptions === 'object' && domStrategyOptions != null
    ? domStrategyOptions.type === 'partial-dom'
      ? domStrategyOptions
      : null
    : null

const getVirtualizedDOMStrategyOptions = (
  domStrategyOptions: DOMStrategyOptions | null | undefined
) =>
  typeof domStrategyOptions === 'object' && domStrategyOptions != null
    ? domStrategyOptions.type === 'virtualized'
      ? domStrategyOptions
      : null
    : null

const isInternalSegmentDOMStrategy = (
  type: ReturnType<typeof getDOMStrategyType>
) => type === 'partial-dom'

const getDOMStrategyCohort = (
  documentSize: number
): EditableDOMStrategyCohort => {
  if (documentSize >= 25_000) return 'pathological'
  if (documentSize >= 10_000) return 'stress'
  if (documentSize >= 5000) return 'large'
  if (documentSize >= 1000) return 'medium'

  return 'normal'
}

const samePath = (left: Path | null, right: Path | null) => {
  if (left === right) return true
  if (!left || !right || left.length !== right.length) return false

  return left.every((segment, index) => segment === right[index])
}

const sameDescendant = (
  left: Descendant | null,
  right: Descendant | null
): boolean => {
  if (left === right) return true
  if (!left || !right) return left === right

  if (isText(left) || isText(right)) {
    if (!isText(left) || !isText(right)) return false

    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)

    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every((key) =>
        Object.is(
          (left as unknown as Record<string, unknown>)[key],
          (right as unknown as Record<string, unknown>)[key]
        )
      )
    )
  }

  const leftKeys = Object.keys(left).filter((key) => key !== 'children')
  const rightKeys = Object.keys(right).filter((key) => key !== 'children')

  return (
    leftKeys.length === rightKeys.length &&
    left.children.length === right.children.length &&
    leftKeys.every((key) =>
      Object.is(
        (left as unknown as Record<string, unknown>)[key],
        (right as unknown as Record<string, unknown>)[key]
      )
    )
  )
}

const sameRuntimeIds = (
  left: readonly RuntimeId[],
  right: readonly RuntimeId[]
) =>
  left.length === right.length &&
  left.every((runtimeId, index) => runtimeId === right[index])

const sameDirectTextChildNodes = (
  left: readonly (SlateTextNode | null)[],
  right: readonly (SlateTextNode | null)[]
) =>
  left.length === right.length &&
  left.every((node, index) => node === right[index])

const sameDescendantBinding = (
  left: {
    childRuntimeIds: readonly RuntimeId[]
    directTextChildNodes: readonly (SlateTextNode | null)[]
    node: Descendant | null
    path: Path | null
  } | null,
  right: {
    childRuntimeIds: readonly RuntimeId[]
    directTextChildNodes: readonly (SlateTextNode | null)[]
    node: Descendant | null
    path: Path | null
  }
) =>
  left != null &&
  samePath(left.path, right.path) &&
  sameDescendant(left.node, right.node) &&
  sameRuntimeIds(left.childRuntimeIds, right.childRuntimeIds) &&
  sameDirectTextChildNodes(
    left.directTextChildNodes,
    right.directTextChildNodes
  )

const getNearestEditableBlockText = (editor: Editor, path: Path) => {
  for (let depth = path.length - 1; depth >= 0; depth -= 1) {
    const ancestorPath = path.slice(0, depth) as Path
    const ancestor =
      ancestorPath.length === 0
        ? editor
        : (readRuntimeNode(editor, ancestorPath) as Ancestor | undefined)

    if (!ancestor || !('children' in ancestor)) {
      continue
    }

    if (Editor.isEditor(ancestor) || !Editor.isInline(editor, ancestor)) {
      return NodeApi.string(ancestor)
    }
  }

  return ''
}

const resolveTextZeroWidth = ({
  editor,
  node,
  path,
}: {
  editor: Editor
  node: SlateTextNode
  path: Path | null
}) => {
  if (!path || node.text !== '') {
    return { isLineBreak: true }
  }

  if (getNearestEditableBlockText(editor, path) !== '') {
    return { isLineBreak: false }
  }

  return { isLineBreak: true }
}

const EditableRenderedElement = <
  TElement extends SlateElementNode = SlateElementNode,
>({
  path,
  props,
  renderElement,
}: {
  path: Path
  props: EditableRenderElementProps<TElement>
  renderElement: RenderElementRenderer<TElement>
}) => {
  const editor = useEditor<ReactRuntimeEditor>()
  const rendered = renderElement(props)

  useIsomorphicLayoutEffect(() => {
    if (!isDevelopment) {
      return
    }

    let cancelled = false
    const timeout = globalThis.setTimeout(() => {
      if (cancelled) {
        return
      }

      assertRenderedElementChildrenHaveDOMOrCoverage(editor, {
        element: props.element,
        path,
      })
    }, 0)

    return () => {
      cancelled = true
      globalThis.clearTimeout(timeout)
    }
  }, [editor, path, props.element])

  return <>{rendered}</>
}

const getFirstTextPath = (node: Descendant, path: Path): Path | null => {
  if (isText(node)) {
    return path
  }

  for (let index = 0; index < node.children.length; index++) {
    const textPath = getFirstTextPath(node.children[index]!, [...path, index])

    if (textPath) {
      return textPath
    }
  }

  return null
}

const assertRenderedElementChildrenHaveDOMOrCoverage = <
  TElement extends SlateElementNode,
>(
  editor: ReactRuntimeEditor,
  { element, path }: { element: TElement; path: Path }
) => {
  element.children.forEach((child, index) => {
    const childPath = [...path, index]
    const textPath = getFirstTextPath(child, childPath)

    if (!textPath) {
      return
    }

    const point = { path: textPath, offset: 0 }

    if (DOMCoverage.getBoundaryForPoint(editor, point)) {
      return
    }

    if (!editor.api.dom.resolveDOMPoint(point)) {
      console.error(
        `Slate renderElement for "${String(
          element.type
        )}" at ${path.join('.')} omitted editable child ${childPath.join(
          '.'
        )} without a DOM coverage boundary. Render children or register a DOMCoverage boundary.`
      )
    }
  })
}

export type EditableDOMCoverageBoundaryScope =
  | {
      from: number
      to?: number
      type: 'children'
    }
  | {
      type: 'self'
    }

export type EditableDOMCoverageBoundaryPlaceholderContext = {
  materialize: () => void
}

export type EditableDOMCoverageBoundaryMaterializePayload =
  DOMCoverageBoundaryMaterializePayload

export type EditableDOMCoverageBoundaryProps = {
  boundaryId?: string
  children?: ReactNode
  copyPolicy?: DOMCoverageCopyPolicy
  findPolicy?: DOMCoverageFindPolicy
  mounted?: boolean
  onMaterialize?: (payload: DOMCoverageBoundaryMaterializePayload) => void
  reason?: DOMCoverageReason
  renderPlaceholder?: (
    context: EditableDOMCoverageBoundaryPlaceholderContext
  ) => ReactNode
  scope: EditableDOMCoverageBoundaryScope
  selectionPolicy?: DOMCoverageSelectionPolicy
}

export type EditableContentRootSlotOptions = {
  ariaLabel?: string
  className?: string
  disableDefaultStyles?: boolean
  id?: string
  placeholder?: ReactNode
  readOnly?: boolean
  spellCheck?: boolean
  style?: CSSProperties
  tabIndex?: number
}

type EditableContentRootSlotRenderers<
  T = unknown,
  TElement extends SlateElementNode = any,
> = {
  renderElement?: RenderElementRenderer<TElement>
  renderLeaf?: (props: EditableTextLeafProps<T>) => ReactNode
  renderPlaceholder?: (props: EditableTextRenderPlaceholderProps) => ReactNode
  renderSegment?: (
    segment: EditableTextSegment<T>,
    children: ReactNode
  ) => ReactNode
  renderText?: (props: EditableTextRenderTextProps) => ReactNode
  renderVoid?: RenderVoidRenderer<TElement>
}

export type EditableElementSlots = {
  children: (range?: { from?: number; to?: number }) => ReactNode
  /**
   * Renders model-present content whose editable DOM may be intentionally
   * absent, such as closed accordion bodies or inactive tab panels.
   */
  contentBoundary: (props: EditableDOMCoverageBoundaryProps) => ReactNode
  contentRoot: (
    slot: string,
    options?: EditableContentRootSlotOptions
  ) => ReactNode
  /**
   * @deprecated Use `contentBoundary`.
   */
  unstableBoundary: (props: EditableDOMCoverageBoundaryProps) => ReactNode
}

const createContentBoundaryId = (
  runtimeId: RuntimeId,
  scope: EditableDOMCoverageBoundaryScope
) => {
  if (scope.type === 'self') {
    return `content-boundary:${runtimeId}:self`
  }

  return `content-boundary:${runtimeId}:children:${scope.from}:${
    scope.to ?? scope.from
  }`
}

const createEditableElementSlots = <
  T,
  TElement extends SlateElementNode = SlateElementNode,
>(
  editor: ReturnType<typeof useEditor>,
  props: {
    element: TElement
    renderElement?: RenderElementRenderer<TElement>
    renderChildren: (from?: number, to?: number) => ReactNode
    renderLeaf?: (props: EditableTextLeafProps<T>) => ReactNode
    renderPlaceholder?: (props: EditableTextRenderPlaceholderProps) => ReactNode
    renderSegment?: (
      segment: EditableTextSegment<T>,
      children: ReactNode
    ) => ReactNode
    renderText?: (props: EditableTextRenderTextProps) => ReactNode
    renderVoid?: RenderVoidRenderer<TElement>
    ownerPath: Path
    runtimeId: RuntimeId
  }
): EditableElementSlots => {
  const renderContentBoundary = ({
    boundaryId,
    children,
    copyPolicy,
    findPolicy,
    mounted = true,
    onMaterialize,
    reason,
    renderPlaceholder,
    scope,
    selectionPolicy,
  }: EditableDOMCoverageBoundaryProps) => {
    const resolvedBoundaryId =
      boundaryId ?? createContentBoundaryId(props.runtimeId, scope)
    const materialize = () => {
      DOMCoverage.materializeBoundary(
        editor,
        resolvedBoundaryId,
        'programmatic'
      )
    }
    const placeholder = renderPlaceholder
      ? renderPlaceholder({ materialize })
      : children
    const hidden = !mounted

    if (scope.type === 'self') {
      const content = mounted ? (children ?? props.renderChildren()) : null

      return (
        <DOMCoverageSelfBoundary
          boundaryId={resolvedBoundaryId}
          content={content}
          copyPolicy={copyPolicy}
          findPolicy={findPolicy}
          hidden={hidden}
          onMaterialize={onMaterialize}
          reason={reason}
          selectionPolicy={selectionPolicy}
        >
          {placeholder}
        </DOMCoverageSelfBoundary>
      )
    }

    const to = scope.to ?? scope.from
    const content = mounted
      ? (children ?? props.renderChildren(scope.from, to))
      : null

    return (
      <DOMCoverageBoundaryRange
        boundaryId={resolvedBoundaryId}
        content={content}
        copyPolicy={copyPolicy}
        findPolicy={findPolicy}
        from={scope.from}
        hidden={hidden}
        onMaterialize={onMaterialize}
        reason={reason}
        selectionPolicy={selectionPolicy}
        to={to}
      >
        {placeholder}
      </DOMCoverageBoundaryRange>
    )
  }

  return {
    children: (range = {}) =>
      props.renderChildren(range.from, range.to ?? range.from),
    contentBoundary: renderContentBoundary,
    contentRoot: (slot, options = {}) => {
      const childCount = props.element.children.length

      return (
        <>
          {childCount > 0
            ? renderContentBoundary({
                boundaryId: `content-root:${props.runtimeId}:${slot}`,
                copyPolicy: 'exclude',
                findPolicy: 'native',
                mounted: false,
                reason: 'app-hidden',
                scope: {
                  from: 0,
                  to: childCount - 1,
                  type: 'children',
                },
                selectionPolicy: 'skip',
              })
            : null}
          <EditableContentRootSlot
            element={props.element}
            options={options}
            ownerPath={props.ownerPath}
            renderers={
              {
                renderElement: props.renderElement,
                renderLeaf: props.renderLeaf,
                renderPlaceholder: props.renderPlaceholder,
                renderSegment: props.renderSegment,
                renderText: props.renderText,
                renderVoid: props.renderVoid,
              } as EditableContentRootSlotRenderers<any, any>
            }
            slot={slot}
          />
        </>
      )
    },
    unstableBoundary: renderContentBoundary,
  }
}

function EditableContentRootSlot({
  element,
  options,
  ownerPath,
  renderers,
  slot,
}: {
  element: SlateElementNode
  options: EditableContentRootSlotOptions
  ownerPath: Path
  renderers: EditableContentRootSlotRenderers
  slot: string
}) {
  const ownerEditor = useEditor<ReactRuntimeEditor>()
  const ownerRoot = ownerEditor.read((state) => state.view.root())
  const { root } = useSlateContentRoot(element, { slot })
  const inheritedReadOnly = useEditorReadOnly()
  const readOnly = Boolean(options.readOnly || inheritedReadOnly)

  return (
    <Slate readOnly={readOnly} root={root}>
      <EditableContentRootView
        options={options}
        ownerPath={ownerPath}
        ownerRoot={ownerRoot}
        renderers={renderers}
        root={root}
        slot={slot}
      />
    </Slate>
  )
}

function EditableContentRootView({
  options,
  ownerPath,
  ownerRoot,
  renderers,
  root,
  slot,
}: {
  options: EditableContentRootSlotOptions
  ownerPath: Path
  ownerRoot: RootKey
  renderers: EditableContentRootSlotRenderers
  root: RootKey
  slot: string
}) {
  const {
    ariaLabel,
    className,
    disableDefaultStyles,
    id,
    placeholder,
    spellCheck,
    style,
    tabIndex = 0,
  } = options
  const {
    renderElement,
    renderLeaf,
    renderPlaceholder,
    renderSegment,
    renderText,
    renderVoid,
  } = renderers
  const editor = useEditor<ReactRuntimeEditor>()
  const inheritedReadOnly = useEditorReadOnly()
  const readOnly = Boolean(options.readOnly || inheritedReadOnly)
  const contentRootOwner = React.useMemo(
    () => ({
      childRoot: root,
      ownerPath,
      ownerRoot,
    }),
    [ownerPath, ownerRoot, root]
  )
  const {
    getLastSelectionForRoot,
    getMountedViewEditor,
    registerContentRootOwner,
    setActiveViewEditor,
  } = useRequiredSlateRuntimeContext()
  useIsomorphicLayoutEffect(() => {
    return registerContentRootOwner(editor, {
      childRoot: root,
      ownerPath,
      ownerRoot,
    })
  }, [editor, ownerPath, ownerRoot, registerContentRootOwner, root])
  const activateRootView = React.useCallback(() => {
    setActiveViewEditor(editor, root)
  }, [editor, root, setActiveViewEditor])
  const rootInteraction = useRootInteractionController({
    disabled: readOnly,
    editor,
    getLastSelectionForRoot,
    getMountedViewEditor,
    root,
    selection: 'restore',
  })
  const onMouseDownCapture = React.useCallback<
    React.MouseEventHandler<HTMLDivElement>
  >(
    (event) => {
      activateRootView()
      rootInteraction.onMouseDownCapture(event)
    },
    [activateRootView, rootInteraction]
  )
  const onMouseUpCapture = React.useCallback<
    React.MouseEventHandler<HTMLDivElement>
  >(
    (event) => {
      activateRootView()
      rootInteraction.onMouseUpCapture(event)
    },
    [activateRootView, rootInteraction]
  )
  const onMouseMoveCapture = React.useCallback<
    React.MouseEventHandler<HTMLDivElement>
  >(
    (event) => {
      activateRootView()
      rootInteraction.onMouseMoveCapture(event)
    },
    [activateRootView, rootInteraction]
  )
  const onFocusCapture = React.useCallback<
    React.FocusEventHandler<HTMLDivElement>
  >(() => {
    activateRootView()
  }, [activateRootView])

  return (
    <div
      contentEditable={false}
      data-slate-content-root-slot={slot}
      onFocusCapture={onFocusCapture}
      onMouseDownCapture={onMouseDownCapture}
      onMouseMoveCapture={onMouseMoveCapture}
      onMouseUpCapture={onMouseUpCapture}
      suppressContentEditableWarning
    >
      <SlateContentRootOwnerContext.Provider value={contentRootOwner}>
        <EditableTextBlocksInner
          aria-label={ariaLabel}
          className={className}
          disableDefaultStyles={disableDefaultStyles}
          id={id}
          placeholder={placeholder}
          readOnly={readOnly}
          renderElement={renderElement}
          renderLeaf={renderLeaf}
          renderPlaceholder={renderPlaceholder}
          renderSegment={renderSegment}
          renderText={renderText}
          renderVoid={renderVoid}
          spellCheck={spellCheck}
          style={style}
          tabIndex={tabIndex}
        />
      </SlateContentRootOwnerContext.Provider>
    </div>
  )
}

const EditableRenderedVoid = <
  TElement extends SlateElementNode = SlateElementNode,
>({
  children,
  element,
  isInline,
  renderVoid,
}: {
  children: ReactNode
  element: TElement
  isInline: boolean
  renderVoid?: RenderVoidRenderer<TElement>
}) => {
  const content = renderVoid?.({ element }) ?? null

  return isInline ? (
    <SlateInlineVoidShell content={content}>{children}</SlateInlineVoidShell>
  ) : (
    <SlateVoidShell content={content}>{children}</SlateVoidShell>
  )
}

export type EditableRenderElementProps<
  TElement extends SlateElementNode = any,
> = TElement extends SlateElementNode
  ? {
      attributes: {
        'data-slate-inline'?: true
        'data-slate-node': 'element'
        'data-slate-path': string
        'data-slate-runtime-id': RuntimeId
        'data-slate-void'?: true
        ref: React.RefCallback<HTMLElement>
      }
      children: ReactNode
      element: TElement
      isInline: boolean
      slots: EditableElementSlots
    }
  : never

export type RenderElementRenderer<TElement extends SlateElementNode = any> = (
  props: EditableRenderElementProps<TElement>
) => ReactNode

export type EditableRenderVoidProps<TElement extends SlateElementNode = any> = {
  element: TElement
}

export type RenderVoidRenderer<TElement extends SlateElementNode = any> = (
  props: EditableRenderVoidProps<TElement>
) => ReactNode

export type EditableDecoration<T = unknown> = Omit<
  SlateDecoration<T>,
  'key'
> & {
  key?: string
}

export type EditableDecorate<T = unknown> = (
  entry: [Descendant, Path],
  editor: Editor
) => readonly EditableDecoration<T>[]

export type EditableLayout = {
  getVirtualizedPageItems?: () => readonly VirtualizedPageLayoutItem[] | null
  getVisibleVirtualizedPageItems?: () =>
    | readonly VirtualizedPageLayoutItem[]
    | null
  getVirtualizedTopLevelItems?: () =>
    | readonly VirtualizedTopLevelLayoutItem[]
    | null
}

export type EditableTextBlocksProps<
  T = unknown,
  TElement extends SlateElementNode = any,
> = {
  autoFocus?: boolean
  className?: string
  decorate?: EditableDecorate<T>
  /**
   * Controls which editor changes recompute `decorate`.
   *
   * Use `external` for decorations derived from an external projection, layout,
   * or annotation source that refreshes the decoration function when it changes.
   */
  decorateDirtiness?: SlateSourceDirtiness
  /**
   * Limits decoration refresh work to the runtime ids affected by the source.
   */
  decorateRuntimeScope?: SlateProjectionRuntimeScope
  disableDefaultStyles?: boolean
  id?: string
  layout?: EditableLayout | null
  /**
   * DOM strategy for large documents. `virtualized` is experimental and
   * must use the object form: `{ type: 'virtualized', ... }`.
   */
  domStrategy?: DOMStrategyOptions | null
  onBeforeInput?: React.FormEventHandler<HTMLDivElement>
  onDOMBeforeInput?: EditableDOMBeforeInputHandler
  onKeyDown?: EditableKeyDownHandler
  onDOMStrategyMetrics?: (metrics: EditableDOMStrategyMetrics) => void
  onPaste?: React.ClipboardEventHandler<HTMLDivElement>
  placeholder?: ReactNode
  readOnly?: boolean
  renderElement?: RenderElementRenderer<TElement>
  renderLeaf?: (props: EditableTextLeafProps<T>) => ReactNode
  renderPlaceholder?: (props: EditableTextRenderPlaceholderProps) => ReactNode
  renderSegment?: (
    segment: EditableTextSegment<T>,
    children: ReactNode
  ) => ReactNode
  renderText?: (props: EditableTextRenderTextProps) => ReactNode
  renderVoid?: RenderVoidRenderer<TElement>
  root?: RootKey
  scrollSelectionIntoView?: (editor: Editor, domRange: globalThis.Range) => void
  spellCheck?: boolean
  style?: CSSProperties
} & Omit<
  TextareaHTMLAttributes<HTMLDivElement>,
  | 'autoFocus'
  | 'children'
  | 'className'
  | 'decorate'
  | 'id'
  | 'onKeyDown'
  | 'onPaste'
  | 'placeholder'
  | 'readOnly'
  | 'spellCheck'
  | 'style'
>

const EditableDescendantNodeInner = <T, TElement extends SlateElementNode>({
  placeholder,
  placeholderRef,
  renderElement,
  renderLeaf,
  renderPlaceholder,
  renderSegment,
  renderText,
  renderVoid,
  runtimeId,
}: {
  placeholder?: ReactNode
  placeholderRef?: React.RefCallback<HTMLElement>
  renderElement?: RenderElementRenderer<TElement>
  renderLeaf?: (props: EditableTextLeafProps<T>) => ReactNode
  renderPlaceholder?: (props: EditableTextRenderPlaceholderProps) => ReactNode
  renderSegment?: (
    segment: EditableTextSegment<T>,
    children: ReactNode
  ) => ReactNode
  renderText?: (props: EditableTextRenderTextProps) => ReactNode
  renderVoid?: RenderVoidRenderer<TElement>
  runtimeId: RuntimeId
}) => {
  const editor = useEditor()
  const projectionStore = React.useContext(ProjectionContext)

  const binding = useMountedNodeRenderSelector(
    ({ editor: editorValue, node, path }) => {
      if (!path || !node || Editor.isEditor(node)) {
        return {
          childRuntimeIds: EMPTY_RUNTIME_IDS,
          directTextChildNodes: EMPTY_DIRECT_TEXT_CHILD_NODES,
          node: null,
          path: null,
        }
      }

      const descendant = node as Descendant
      const snapshot = Editor.getSnapshot(editorValue)
      const usesDirectTextChildren =
        !isText(descendant) &&
        !projectionStore &&
        !renderLeaf &&
        !renderSegment &&
        !renderText

      return {
        childRuntimeIds: isText(descendant)
          ? EMPTY_RUNTIME_IDS
          : (descendant.children
              .map((_, index) => {
                const childPath = [...path, index] as Path

                return (
                  snapshot.index.pathToId[getSnapshotPathKey(childPath)] ??
                  Editor.getRuntimeId(editorValue, childPath) ??
                  ''
                )
              })
              .filter(Boolean) as RuntimeId[]),
        directTextChildNodes: usesDirectTextChildren
          ? descendant.children.map((child) => (isText(child) ? child : null))
          : EMPTY_DIRECT_TEXT_CHILD_NODES,
        node: descendant,
        path,
      }
    },
    sameDescendantBinding,
    { includeRootOrderChanges: true, runtimeId }
  )

  const { childRuntimeIds, node, path } = binding
  const bindNodeRef = useSlateNodeRef(runtimeId, { path, slateNode: node })

  if (!node || !path) {
    return null
  }

  if (path) {
    const parentPath = path.slice(0, -1) as Path
    const parent =
      parentPath.length === 0
        ? editor
        : (readRuntimeNode(editor, parentPath) as Ancestor | undefined)

    if (parent && 'children' in parent) {
      NODE_TO_INDEX.set(node, path.at(-1) ?? 0)
      NODE_TO_PARENT.set(node, parent)
      IS_NODE_MAP_DIRTY.set(editor, false)
    }
  }

  if (isText(node)) {
    const { text: _text, ...marks } = node

    return (
      <EditableText
        marks={marks}
        path={path}
        placeholder={placeholder}
        placeholderRef={placeholderRef}
        renderLeaf={renderLeaf}
        renderPlaceholder={renderPlaceholder}
        renderSegment={renderSegment}
        renderText={renderText}
        runtimeId={runtimeId}
        slateNode={node}
        text={node.text}
        zeroWidth={resolveTextZeroWidth({ editor, node, path })}
      />
    )
  }

  const inline = Editor.isInline(editor, node)
  const voidNode = Editor.isVoid(editor, node)
  const attributes = {
    'data-slate-inline': inline ? (true as const) : undefined,
    'data-slate-node': 'element' as const,
    'data-slate-path': path.join(','),
    'data-slate-runtime-id': runtimeId,
    'data-slate-void': voidNode ? (true as const) : undefined,
    ref: bindNodeRef as React.RefCallback<HTMLElement>,
  }
  const renderChild = (childRuntimeId: RuntimeId) => (
    <EditableDescendantNode
      key={childRuntimeId}
      placeholder={placeholder}
      placeholderRef={placeholderRef}
      renderElement={renderElement}
      renderLeaf={renderLeaf}
      renderPlaceholder={renderPlaceholder}
      renderSegment={renderSegment}
      renderText={renderText}
      renderVoid={renderVoid}
      runtimeId={childRuntimeId}
    />
  )
  const renderChildren = (from = 0, to = childRuntimeIds.length - 1) => {
    if (childRuntimeIds.length === 0 || to < from) {
      return null
    }

    return childRuntimeIds.slice(from, to + 1).map(renderChild)
  }
  const defaultChildren = childRuntimeIds.map((childRuntimeId, index) => {
    const child = node.children[index]

    if (
      child &&
      isText(child) &&
      !projectionStore &&
      !renderLeaf &&
      !renderSegment &&
      !renderText
    ) {
      const childPath = [...path, index] as Path
      const { text: _text, ...marks } = child

      NODE_TO_INDEX.set(child, index)
      NODE_TO_PARENT.set(child, node)
      IS_NODE_MAP_DIRTY.set(editor, false)

      return (
        <EditableText
          key={childRuntimeId}
          marks={marks}
          path={childPath}
          placeholder={placeholder}
          placeholderRef={placeholderRef}
          renderLeaf={renderLeaf}
          renderPlaceholder={renderPlaceholder}
          renderSegment={renderSegment}
          renderText={renderText}
          runtimeId={childRuntimeId}
          slateNode={child}
          text={child.text}
          zeroWidth={resolveTextZeroWidth({
            editor,
            node: child,
            path: childPath,
          })}
        />
      )
    }

    return (
      <EditableDescendantNode
        key={childRuntimeId}
        placeholder={placeholder}
        placeholderRef={placeholderRef}
        renderElement={renderElement}
        renderLeaf={renderLeaf}
        renderPlaceholder={renderPlaceholder}
        renderSegment={renderSegment}
        renderText={renderText}
        renderVoid={renderVoid}
        runtimeId={childRuntimeId}
      />
    )
  })

  if (voidNode) {
    if (!path) {
      return null
    }

    const children = renderChildren()

    return (
      <NodeRuntimeIdContext.Provider key={runtimeId} value={runtimeId}>
        <ElementPathContext.Provider value={path}>
          <ElementContext.Provider value={node}>
            <EditableRenderedVoid
              element={node as TElement}
              isInline={inline}
              renderVoid={renderVoid}
            >
              {children}
            </EditableRenderedVoid>
          </ElementContext.Provider>
        </ElementPathContext.Provider>
      </NodeRuntimeIdContext.Provider>
    )
  }

  const nodeRenderElement = renderElement

  if (nodeRenderElement) {
    if (!path) {
      return null
    }

    const renderElementPropsBase = {
      attributes,
      element: node as TElement,
      isInline: inline,
    }
    const renderElementProps = {
      attributes,
      element: node as TElement,
      get children() {
        return renderChildren()
      },
      isInline: inline,
      slots: createEditableElementSlots(editor, {
        ...renderElementPropsBase,
        renderElement,
        renderChildren,
        renderLeaf,
        renderPlaceholder,
        renderSegment,
        renderText,
        renderVoid,
        ownerPath: path,
        runtimeId,
      }),
    } as unknown as EditableRenderElementProps<TElement>

    return (
      <NodeRuntimeIdContext.Provider key={runtimeId} value={runtimeId}>
        <ElementPathContext.Provider value={path}>
          <ElementContext.Provider value={node}>
            <EditableRenderedElement
              path={path}
              props={renderElementProps}
              renderElement={nodeRenderElement}
            />
          </ElementContext.Provider>
        </ElementPathContext.Provider>
      </NodeRuntimeIdContext.Provider>
    )
  }

  return (
    <NodeRuntimeIdContext.Provider key={runtimeId} value={runtimeId}>
      <ElementPathContext.Provider value={path}>
        <ElementContext.Provider value={node}>
          <EditableElement as={inline ? 'span' : 'div'} isInline={inline}>
            {defaultChildren}
          </EditableElement>
        </ElementContext.Provider>
      </ElementPathContext.Provider>
    </NodeRuntimeIdContext.Provider>
  )
}

const EditableDescendantNode = React.memo(
  EditableDescendantNodeInner
) as typeof EditableDescendantNodeInner

const createRootGroups = (
  runtimeIds: readonly RuntimeId[],
  groupSize = ROOT_GROUP_SIZE
) => {
  const groups: {
    endIndex: number
    groupId: string
    runtimeIds: readonly RuntimeId[]
    startIndex: number
  }[] = []

  for (
    let startIndex = 0;
    startIndex < runtimeIds.length;
    startIndex += groupSize
  ) {
    const endIndex = Math.min(runtimeIds.length - 1, startIndex + groupSize - 1)

    groups.push({
      endIndex,
      groupId: `${startIndex}-${endIndex}`,
      runtimeIds: runtimeIds.slice(startIndex, endIndex + 1),
      startIndex,
    })
  }

  return groups
}

type EditableRootGroupRecord = ReturnType<typeof createRootGroups>[number]

const getRootGroupPlanKey = (
  runtimeIds: readonly RuntimeId[],
  documentEpoch: number
) => `${documentEpoch}:${runtimeIds.join('\u001f')}`

const getActiveRootGroupId = (
  groups: readonly EditableRootGroupRecord[] | null,
  selectedTopLevelIndex: number | null
) => {
  if (!groups || groups.length === 0) {
    return null
  }

  const targetIndex = selectedTopLevelIndex ?? 0
  const targetGroup =
    groups.find(
      (group) =>
        group.startIndex <= targetIndex && group.endIndex >= targetIndex
    ) ?? groups[0]

  return targetGroup.groupId
}

const sameStringSet = (left: ReadonlySet<string>, right: ReadonlySet<string>) =>
  left.size === right.size && [...left].every((value) => right.has(value))

const getRootGroupIdsForBoundary = (
  groups: readonly EditableRootGroupRecord[] | null,
  boundary: DOMCoverageBoundary,
  targetRange?: SlateRange
) => {
  if (!groups || boundary.reason !== 'rendering-staged') {
    return []
  }

  const pathRanges = targetRange
    ? [{ anchor: targetRange.anchor.path, focus: targetRange.focus.path }]
    : boundary.coveredPathRanges

  return groups
    .filter((group) =>
      pathRanges.some((range) => {
        const anchor = range.anchor[0]
        const focus = range.focus[0]

        if (typeof anchor !== 'number' || typeof focus !== 'number') {
          return false
        }

        const start = Math.min(anchor, focus)
        const end = Math.max(anchor, focus)

        return group.startIndex <= end && group.endIndex >= start
      })
    )
    .map((group) => group.groupId)
}

const useMountedRootGroupIds = ({
  activeGroupId,
  groups,
  planKey,
}: {
  activeGroupId: string | null
  groups: readonly EditableRootGroupRecord[] | null
  planKey: string | null
}) => {
  const [mountedState, setMountedState] = React.useState<{
    groupIds: ReadonlySet<string>
    planKey: string | null
  }>(() => ({
    groupIds: new Set(),
    planKey: null,
  }))

  const mountedGroupIds =
    mountedState.planKey === planKey ? mountedState.groupIds : new Set<string>()
  const activeGroupIds = React.useMemo(
    () =>
      activeGroupId == null ? new Set<string>() : new Set([activeGroupId]),
    [activeGroupId]
  )
  const mountGroupIds = React.useCallback(
    (groupIds: readonly string[]) => {
      if (!planKey || groupIds.length === 0) {
        return
      }

      setMountedState((previous) => {
        const nextGroupIds =
          previous.planKey === planKey
            ? new Set(previous.groupIds)
            : new Set<string>()
        let changed = previous.planKey !== planKey

        for (const groupId of groupIds) {
          if (!nextGroupIds.has(groupId)) {
            nextGroupIds.add(groupId)
            changed = true
          }
        }

        return changed ? { groupIds: nextGroupIds, planKey } : previous
      })
    },
    [planKey]
  )

  React.useEffect(() => {
    if (!groups || !planKey) {
      setMountedState((previous) =>
        previous.planKey == null && previous.groupIds.size === 0
          ? previous
          : { groupIds: new Set(), planKey: null }
      )

      return
    }

    setMountedState((previous) => {
      const nextGroupIds =
        previous.planKey === planKey
          ? new Set(previous.groupIds)
          : new Set<string>()

      for (const groupId of activeGroupIds) {
        nextGroupIds.add(groupId)
      }

      return previous.planKey === planKey &&
        sameStringSet(previous.groupIds, nextGroupIds)
        ? previous
        : { groupIds: nextGroupIds, planKey }
    })
  }, [activeGroupIds, groups, planKey])

  React.useEffect(() => {
    if (!groups || !planKey) {
      return
    }

    let cancelled = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let intervalId: ReturnType<typeof setInterval> | null = null

    const mountNextGroup = () => {
      if (cancelled) {
        return
      }

      React.startTransition(() => {
        setMountedState((previous) => {
          const nextGroupIds =
            previous.planKey === planKey
              ? new Set(previous.groupIds)
              : new Set<string>()

          for (const groupId of activeGroupIds) {
            nextGroupIds.add(groupId)
          }

          const nextGroups = groups
            .filter((group) => !nextGroupIds.has(group.groupId))
            .slice(0, ROOT_GROUP_BACKGROUND_MOUNT_BATCH_SIZE)

          if (nextGroups.length === 0) {
            if (intervalId != null) {
              clearInterval(intervalId)
              intervalId = null
            }

            return previous.planKey === planKey &&
              sameStringSet(previous.groupIds, nextGroupIds)
              ? previous
              : { groupIds: nextGroupIds, planKey }
          }

          for (const nextGroup of nextGroups) {
            nextGroupIds.add(nextGroup.groupId)
          }

          if (nextGroupIds.size >= groups.length && intervalId != null) {
            clearInterval(intervalId)
            intervalId = null
          }

          return { groupIds: nextGroupIds, planKey }
        })
      })
    }

    timeoutId = setTimeout(() => {
      mountNextGroup()

      if (!cancelled) {
        intervalId = setInterval(
          mountNextGroup,
          ROOT_GROUP_BACKGROUND_MOUNT_DELAY_MS
        )
      }
    }, ROOT_GROUP_BACKGROUND_MOUNT_INITIAL_DELAY_MS)

    return () => {
      cancelled = true

      if (timeoutId != null) {
        clearTimeout(timeoutId)
      }

      if (intervalId != null) {
        clearInterval(intervalId)
      }
    }
  }, [activeGroupIds, groups, planKey])

  return { activeGroupIds, mountedGroupIds, mountGroupIds }
}

const EditableRootGroupInner = <T, TElement extends SlateElementNode>({
  endIndex,
  groupId,
  placeholder,
  placeholderRef,
  renderElement,
  renderLeaf,
  renderPlaceholder,
  renderSegment,
  renderText,
  renderVoid,
  runtimeIds,
  startIndex,
}: {
  endIndex: number
  groupId: string
  placeholder?: ReactNode
  placeholderRef?: React.RefCallback<HTMLElement>
  renderElement?: RenderElementRenderer<TElement>
  renderLeaf?: (props: EditableTextLeafProps<T>) => ReactNode
  renderPlaceholder?: (props: EditableTextRenderPlaceholderProps) => ReactNode
  renderSegment?: (
    segment: EditableTextSegment<T>,
    children: ReactNode
  ) => ReactNode
  renderText?: (props: EditableTextRenderTextProps) => ReactNode
  renderVoid?: RenderVoidRenderer<TElement>
  runtimeIds: readonly RuntimeId[]
  startIndex: number
}) => {
  recordSlateReactRender({
    id: `${startIndex}-${endIndex}`,
    kind: 'group',
  })

  return (
    <div
      data-slate-root-group="true"
      data-slate-root-group-end={endIndex}
      data-slate-root-group-id={groupId}
      data-slate-root-group-start={startIndex}
      data-slate-root-group-state="fresh-mounted"
      style={{ display: 'contents' }}
    >
      {runtimeIds.map((runtimeId) => (
        <EditableDescendantNode
          key={runtimeId}
          placeholder={placeholder}
          placeholderRef={placeholderRef}
          renderElement={renderElement}
          renderLeaf={renderLeaf}
          renderPlaceholder={renderPlaceholder}
          renderSegment={renderSegment}
          renderText={renderText}
          renderVoid={renderVoid}
          runtimeId={runtimeId}
        />
      ))}
    </div>
  )
}

const EditableRootGroup = React.memo(
  EditableRootGroupInner,
  (previous, next) =>
    previous.endIndex === next.endIndex &&
    previous.groupId === next.groupId &&
    previous.placeholder === next.placeholder &&
    previous.placeholderRef === next.placeholderRef &&
    previous.renderElement === next.renderElement &&
    previous.renderLeaf === next.renderLeaf &&
    previous.renderPlaceholder === next.renderPlaceholder &&
    previous.renderSegment === next.renderSegment &&
    previous.renderText === next.renderText &&
    previous.renderVoid === next.renderVoid &&
    previous.startIndex === next.startIndex &&
    sameRuntimeIds(previous.runtimeIds, next.runtimeIds)
) as typeof EditableRootGroupInner

const EditableRootGroupPlaceholder = ({
  anchorRuntimeId,
  endIndex,
  focusRuntimeId,
  groupId,
  startIndex,
}: {
  anchorRuntimeId: RuntimeId | null
  endIndex: number
  focusRuntimeId: RuntimeId | null
  groupId: string
  startIndex: number
}) => {
  const editor = useEditor()
  const boundaryId = `rendering-staged:${groupId}`
  const boundary = React.useMemo(
    () => ({
      anchor: { type: 'placeholder' as const },
      boundaryId,
      copyPolicy: 'materialize' as const,
      coveredPathRanges: [
        {
          anchor: [startIndex] as Path,
          focus: [endIndex] as Path,
        },
      ],
      coveredRuntimeRanges:
        anchorRuntimeId && focusRuntimeId
          ? [{ anchor: anchorRuntimeId, focus: focusRuntimeId }]
          : [],
      findPolicy: 'native' as const,
      ownerPath: [] as Path,
      ownerRuntimeId: null,
      reason: 'rendering-staged' as const,
      selectionPolicy: 'materialize' as const,
      state: 'pending-mount' as const,
      version: 1,
    }),
    [anchorRuntimeId, boundaryId, endIndex, focusRuntimeId, startIndex]
  )

  useIsomorphicLayoutEffect(
    () => DOMCoverage.registerBoundary(editor, boundary),
    [boundary, editor]
  )

  return (
    <div
      aria-hidden="true"
      contentEditable={false}
      data-slate-dom-coverage-boundary={boundaryId}
      data-slate-dom-coverage-edge="owner"
      data-slate-root-group="true"
      data-slate-root-group-end={endIndex}
      data-slate-root-group-id={groupId}
      data-slate-root-group-start={startIndex}
      data-slate-root-group-state="pending-mount"
      style={{ display: 'none' }}
    />
  )
}

const createRootGroupRenderItems = (
  groups: readonly (EditableRootGroupRecord & { isMounted: boolean })[]
) => {
  const items: (
    | {
        group: EditableRootGroupRecord
        kind: 'mounted'
      }
    | {
        anchorRuntimeId: RuntimeId | null
        endIndex: number
        focusRuntimeId: RuntimeId | null
        groupId: string
        kind: 'pending'
        startIndex: number
      }
  )[] = []
  let pendingStartGroup: EditableRootGroupRecord | null = null
  let pendingEndGroup: EditableRootGroupRecord | null = null

  const flushPendingGroups = () => {
    if (!pendingStartGroup || !pendingEndGroup) {
      return
    }

    items.push({
      anchorRuntimeId: pendingStartGroup.runtimeIds[0] ?? null,
      endIndex: pendingEndGroup.endIndex,
      focusRuntimeId: pendingEndGroup.runtimeIds.at(-1) ?? null,
      groupId: `${pendingStartGroup.groupId}-${pendingEndGroup.groupId}`,
      kind: 'pending',
      startIndex: pendingStartGroup.startIndex,
    })
    pendingStartGroup = null
    pendingEndGroup = null
  }

  for (const group of groups) {
    if (group.isMounted) {
      flushPendingGroups()
      items.push({ group, kind: 'mounted' })
      continue
    }

    pendingStartGroup ??= group
    pendingEndGroup = group
  }

  flushPendingGroups()

  return items
}

const EditableTextBlocksInner = <T, TElement extends SlateElementNode>({
  autoFocus,
  className,
  decorate,
  decorateDirtiness,
  decorateRuntimeScope,
  disableDefaultStyles = false,
  enableVirtualizedRendering = false,
  id,
  layout,
  domStrategy,
  onBeforeInput,
  onDOMBeforeInput,
  onKeyDown,
  onDOMStrategyMetrics,
  onPaste,
  readOnly = false,
  placeholder,
  renderElement,
  renderLeaf,
  renderPlaceholder,
  renderSegment,
  renderText,
  renderVoid,
  scrollSelectionIntoView,
  spellCheck,
  style,
  ...attributes
}: EditableTextBlocksProps<T, TElement> & {
  enableVirtualizedRendering?: boolean
}) => {
  const domStrategyOptions = domStrategy
  const domTextSyncOptions =
    typeof domStrategyOptions === 'object' && domStrategyOptions != null
      ? (domStrategyOptions.textSync ?? null)
      : null
  const editor = useEditor()
  const editableRoot = editor.read((state) => state.view.root())
  const inheritedReadOnly = useEditorReadOnly()
  const effectiveReadOnly = readOnly || inheritedReadOnly
  const upstreamProjectionStore = React.useContext(ProjectionContext)
  const [decorateCell] = React.useState(() => ({ current: decorate }))
  decorateCell.current = decorate
  const hasDecorate = Boolean(decorate)
  const decorateSource = React.useMemo(() => {
    if (!hasDecorate) {
      return null
    }

    return createDecorationSource<T>(editor, {
      dirtiness: decorateDirtiness,
      id: 'editable-decorate',
      read: ({ snapshot }) => {
        const readDecorations = decorateCell.current

        if (!readDecorations) {
          return EMPTY_DECORATIONS as readonly SlateDecoration<T>[]
        }

        const root = { children: snapshot.children } as Ancestor
        const decorations: SlateDecoration<T>[] = []

        for (const [node, path] of NodeApi.nodes(root)) {
          if (path.length === 0) {
            continue
          }

          const entryDecorations = readDecorations(
            [node as Descendant, path],
            editor
          )

          entryDecorations.forEach((decoration, index) => {
            decorations.push({
              ...decoration,
              key:
                decoration.key ??
                `decorate:${path.join('.') || 'root'}:${index}`,
            })
          })
        }

        return decorations
      },
      runtimeScope: decorateRuntimeScope,
    })
  }, [
    decorateCell,
    decorateDirtiness,
    decorateRuntimeScope,
    editor,
    hasDecorate,
  ])
  const projectionStore = React.useMemo(() => {
    if (!decorateSource) {
      return upstreamProjectionStore
    }

    return composeProjectionSources(
      upstreamProjectionStore
        ? [
            upstreamProjectionStore as SlateOverlayProjectionStore<T>,
            decorateSource,
          ]
        : [decorateSource]
    )
  }, [decorateSource, upstreamProjectionStore])
  const [promotedSegmentIndex, setPromotedSegmentIndex] = React.useState<
    number | null
  >(null)
  const [placeholderHeight, setPlaceholderHeight] = React.useState<
    number | null
  >(null)
  const [domStrategyRootElement, setDOMStrategyRootElement] =
    React.useState<HTMLDivElement | null>(null)
  const [
    promotedVirtualizedTopLevelIndex,
    setPromotedVirtualizedTopLevelIndex,
  ] = React.useState<number | null>(null)
  const placeholderResizeObserverRef = React.useRef<ResizeObserver | null>(null)
  const domStrategyType = getDOMStrategyType(domStrategyOptions)
  const internalPartialDOMStrategyOptions =
    getInternalPartialDOMStrategyOptions(domStrategyOptions)
  const virtualizedDOMStrategyOptions =
    getVirtualizedDOMStrategyOptions(domStrategyOptions)
  const internalPartialDOMStrategyOverscan =
    internalPartialDOMStrategyOptions?.overscan ?? 0
  const internalPartialDOMStrategySegmentSize =
    internalPartialDOMStrategyOptions?.segmentSize ?? 100
  const internalPartialDOMStrategyPreviewChars =
    internalPartialDOMStrategyOptions?.previewChars ?? 96
  const internalPartialDOMStrategyThreshold =
    internalPartialDOMStrategyOptions?.threshold ?? 2000
  const domStrategyVirtualizedEstimatedBlockSize =
    virtualizedDOMStrategyOptions?.estimatedBlockSize ?? 32
  const domStrategyVirtualizedOverscan =
    virtualizedDOMStrategyOptions?.overscan ?? 2
  const domStrategyVirtualizedThreshold =
    virtualizedDOMStrategyOptions?.threshold ?? 25_000
  const internalSegmentDOMStrategyConfig = React.useMemo(
    () =>
      isInternalSegmentDOMStrategy(domStrategyType)
        ? ({
            overscan: Math.max(0, internalPartialDOMStrategyOverscan),
            segmentSize: Math.max(1, internalPartialDOMStrategySegmentSize),
            previewChars: Math.max(16, internalPartialDOMStrategyPreviewChars),
            threshold: Math.max(1, internalPartialDOMStrategyThreshold),
          } satisfies DOMStrategyRootConfig)
        : null,
    [
      domStrategyType,
      internalPartialDOMStrategyOverscan,
      internalPartialDOMStrategyPreviewChars,
      internalPartialDOMStrategySegmentSize,
      internalPartialDOMStrategyThreshold,
    ]
  )
  const virtualizedDOMStrategyConfig = React.useMemo(
    () =>
      domStrategyType === 'virtualized'
        ? ({
            estimatedBlockSize: Math.max(
              1,
              domStrategyVirtualizedEstimatedBlockSize
            ),
            overscan: Math.max(0, domStrategyVirtualizedOverscan),
            threshold: Math.max(1, domStrategyVirtualizedThreshold),
          } satisfies DOMStrategyVirtualizedConfig)
        : null,
    [
      domStrategyType,
      domStrategyVirtualizedEstimatedBlockSize,
      domStrategyVirtualizedOverscan,
      domStrategyVirtualizedThreshold,
    ]
  )
  const {
    segmentPlan,
    mountedTopLevelRanges,
    mountedTopLevelRuntimeIds,
    topLevelRuntimeIds,
  } = useInternalSegmentDOMStrategyRootSources({
    internalSegmentDOMStrategyConfig,
    promotedSegmentIndex,
  })
  const selectedVirtualizedTopLevelIndex = useTopLevelSelectionIndex(
    virtualizedDOMStrategyConfig != null
  )
  const selectedVirtualizedPaths = useSelectionPaths(
    virtualizedDOMStrategyConfig != null
  )
  const virtualizedScrollElement = React.useMemo(
    () => getVirtualizerScrollElement(domStrategyRootElement),
    [domStrategyRootElement]
  )
  const virtualizedScrollRootReady =
    virtualizedDOMStrategyConfig != null && virtualizedScrollElement != null
  const virtualizedPageItems = layout?.getVirtualizedPageItems?.() ?? null
  const visibleVirtualizedPageItems =
    layout?.getVisibleVirtualizedPageItems?.() ?? null
  const virtualizedLayoutItems = layout?.getVirtualizedTopLevelItems?.() ?? null
  const virtualizedPlan = useVirtualizedRootPlan({
    config: enableVirtualizedRendering ? virtualizedDOMStrategyConfig : null,
    enabled: enableVirtualizedRendering && virtualizedScrollRootReady,
    pageLayoutItems: virtualizedPageItems,
    promotedTopLevelIndex: promotedVirtualizedTopLevelIndex,
    rootElement: domStrategyRootElement,
    scrollElement: virtualizedScrollElement,
    selectionPaths: selectedVirtualizedPaths,
    selectedTopLevelIndex: selectedVirtualizedTopLevelIndex,
    topLevelLayoutItems: virtualizedLayoutItems,
    topLevelRuntimeIds,
    visiblePageLayoutItems: visibleVirtualizedPageItems,
  })
  const internalSegmentDOMStrategySize =
    internalSegmentDOMStrategyConfig?.segmentSize ?? null
  const rootDocumentEpoch = useRootDocumentEpoch()
  const shouldUseStagedFallback =
    domStrategyType === 'virtualized' && virtualizedPlan == null
  const rootGroups = React.useMemo(() => {
    if (
      (domStrategyType !== 'auto' &&
        domStrategyType !== 'staged' &&
        !shouldUseStagedFallback) ||
      topLevelRuntimeIds.length < ROOT_GROUP_THRESHOLD
    ) {
      return null
    }

    recordSlateReactRender({
      id: 'staged-root-groups',
      kind: 'root-plan',
    })

    return createRootGroups(topLevelRuntimeIds)
  }, [domStrategyType, shouldUseStagedFallback, topLevelRuntimeIds])
  const rootGroupPlanKey = React.useMemo(
    () =>
      rootGroups
        ? getRootGroupPlanKey(topLevelRuntimeIds, rootDocumentEpoch)
        : null,
    [rootDocumentEpoch, rootGroups, topLevelRuntimeIds]
  )
  const selectedRootGroupIndex = useTopLevelSelectionIndex(rootGroups != null)
  const activeRootGroupId = React.useMemo(
    () => getActiveRootGroupId(rootGroups, selectedRootGroupIndex),
    [rootGroups, selectedRootGroupIndex]
  )
  const { activeGroupIds, mountedGroupIds, mountGroupIds } =
    useMountedRootGroupIds({
      activeGroupId: activeRootGroupId,
      groups: rootGroups,
      planKey: rootGroupPlanKey,
    })
  const materializeRootGroupBoundary = React.useCallback(
    (boundary: DOMCoverageBoundary, targetRange?: SlateRange) => {
      const groupIds = getRootGroupIdsForBoundary(
        rootGroups,
        boundary,
        targetRange
      )

      if (groupIds.length === 0) {
        return false
      }

      mountGroupIds(groupIds)
      return true
    },
    [mountGroupIds, rootGroups]
  )

  useIsomorphicLayoutEffect(() => {
    if (!rootGroups) {
      return
    }

    return DOMCoverage.registerMaterializeHandler(
      editor,
      (boundary, _reason, options) =>
        materializeRootGroupBoundary(boundary, options.range)
    )
  }, [editor, materializeRootGroupBoundary, rootGroups])
  const materializeVirtualizedBoundary = React.useCallback(
    (boundary: DOMCoverageBoundary, targetRange?: SlateRange) => {
      const targetIndex =
        targetRange?.anchor.path[0] ?? boundary.coveredPathRanges[0]?.anchor[0]

      if (typeof targetIndex !== 'number') {
        return false
      }

      setPromotedVirtualizedTopLevelIndex(targetIndex)
      if (
        targetRange &&
        virtualizedPlan?.scrollToPath(targetRange.anchor.path, 'center')
      ) {
        return true
      }

      virtualizedPlan?.scrollToTopLevelIndex(targetIndex, 'center')

      return true
    },
    [virtualizedPlan]
  )

  useIsomorphicLayoutEffect(() => {
    if (!virtualizedPlan) {
      return
    }

    return DOMCoverage.registerMaterializeHandler(
      editor,
      (boundary, _reason, options) =>
        materializeVirtualizedBoundary(boundary, options.range)
    )
  }, [editor, materializeVirtualizedBoundary, virtualizedPlan])
  const lastVirtualizedScrollPathKeyRef = React.useRef<string | null>(null)

  useIsomorphicLayoutEffect(() => {
    const anchorPath = selectedVirtualizedPaths?.[0]

    if (!virtualizedPlan || !anchorPath) {
      lastVirtualizedScrollPathKeyRef.current = null
      return
    }

    const anchorPathKey = getSnapshotPathKey(anchorPath)
    const lastCommit = editor.read((state) => state.value.lastCommit())

    if (lastCommit?.textChanged) {
      return
    }

    try {
      const [node] = editor.read((state) => state.nodes.get(anchorPath))

      if (node && editor.api.dom.resolveDOMNode(node as SlateNode)) {
        lastVirtualizedScrollPathKeyRef.current = anchorPathKey
        return
      }
    } catch {
      // If the path is not mounted or temporarily invalid, fall through to
      // page-aware scrolling.
    }

    if (lastVirtualizedScrollPathKeyRef.current === anchorPathKey) {
      return
    }

    if (virtualizedPlan.scrollToPath(anchorPath, 'center')) {
      lastVirtualizedScrollPathKeyRef.current = anchorPathKey
    }
  }, [selectedVirtualizedPaths, virtualizedPlan])
  const renderedRootGroups = React.useMemo(() => {
    if (!rootGroups) {
      return null
    }

    return rootGroups.map((group) => ({
      ...group,
      isMounted:
        activeGroupIds.has(group.groupId) || mountedGroupIds.has(group.groupId),
    }))
  }, [activeGroupIds, mountedGroupIds, rootGroups])
  const domPresentMountedGroups = React.useMemo(
    () => renderedRootGroups?.filter((group) => group.isMounted) ?? null,
    [renderedRootGroups]
  )
  const domPresentMountedTopLevelRuntimeIds = React.useMemo(
    () =>
      domPresentMountedGroups
        ? new Set(
            domPresentMountedGroups.flatMap((group) => [...group.runtimeIds])
          )
        : null,
    [domPresentMountedGroups]
  )
  const domPresentMountedTopLevelRanges = React.useMemo(
    () =>
      domPresentMountedGroups?.map((group) => ({
        endIndex: group.endIndex,
        startIndex: group.startIndex,
      })) ?? null,
    [domPresentMountedGroups]
  )
  const renderedRootGroupItems = React.useMemo(
    () =>
      renderedRootGroups
        ? createRootGroupRenderItems(renderedRootGroups)
        : null,
    [renderedRootGroups]
  )
  const handlePromoteSegment = React.useCallback(
    (segmentIndex: number, options: { select?: boolean } = {}) => {
      setPromotedSegmentIndex(segmentIndex)

      if (!options.select || internalSegmentDOMStrategySize == null) {
        return
      }

      const startIndex = segmentIndex * internalSegmentDOMStrategySize

      try {
        const start = Editor.point(editor, [startIndex], { edge: 'start' })
        editor.update((tx) => {
          tx.selection.set({ anchor: start, focus: start })
        })
      } catch {
        // Leave selection unchanged for non-text-startable segments.
      }
    },
    [editor, internalSegmentDOMStrategySize]
  )
  const placeholderValue = usePlaceholderValue(placeholder)
  const placeholderRef = React.useCallback(
    (placeholderElement: HTMLElement | null) => {
      placeholderResizeObserverRef.current?.disconnect()
      placeholderResizeObserverRef.current = null

      if (!placeholderElement || !placeholderValue) {
        EDITOR_TO_PLACEHOLDER_ELEMENT.delete(editor)
        setPlaceholderHeight(null)
        return
      }

      EDITOR_TO_PLACEHOLDER_ELEMENT.set(editor, placeholderElement)

      const measure = () => {
        const nextHeight = placeholderElement.getBoundingClientRect().height
        setPlaceholderHeight(nextHeight > 0 ? nextHeight : null)
      }

      measure()

      if (typeof ResizeObserver !== 'undefined') {
        placeholderResizeObserverRef.current = new ResizeObserver(measure)
        placeholderResizeObserverRef.current.observe(placeholderElement)
      }
    },
    [editor, placeholderValue]
  )

  React.useEffect(
    () => () => {
      placeholderResizeObserverRef.current?.disconnect()
      placeholderResizeObserverRef.current = null
      EDITOR_TO_PLACEHOLDER_ELEMENT.delete(editor)
    },
    [editor]
  )
  React.useEffect(() => {
    if (!decorateSource) {
      return
    }

    return () => {
      decorateSource.destroy()
    }
  }, [decorateSource])
  React.useEffect(() => {
    decorateCell.current = decorate
    decorateSource?.refresh({
      forceInvalidate: true,
      reason: 'external',
      requiresDOMSelectionExport: ReactEditor.isFocused(
        editor as unknown as ReactRuntimeEditor
      ),
    })
  }, [decorate, decorateCell, decorateSource, editor])
  const rootStyle =
    placeholderHeight && !disableDefaultStyles
      ? { minHeight: placeholderHeight, ...style }
      : style
  const domStrategyMetrics = React.useMemo(() => {
    const documentSize = topLevelRuntimeIds.length
    const mountedTopLevelCount = virtualizedPlan
      ? virtualizedPlan.mountedTopLevelRuntimeIds.size
      : segmentPlan
        ? segmentPlan.segments.reduce(
            (total, segment) => total + segment.mountedRuntimeIds.length,
            0
          )
        : domPresentMountedTopLevelRuntimeIds
          ? domPresentMountedTopLevelRuntimeIds.size
          : documentSize
    const partialDOMCount =
      segmentPlan?.segments.filter((segment) => !segment.isActive).length ?? 0
    const virtualizedBoundaryCount = virtualizedPlan?.missingRanges.length ?? 0
    const rootGroupCount = rootGroups?.length ?? 0
    const mountedGroupCount = renderedRootGroups
      ? renderedRootGroups.filter((group) => group.isMounted).length
      : virtualizedPlan
        ? virtualizedPlan.mountedTopLevelRanges.length
        : segmentPlan
          ? segmentPlan.segments.filter((segment) => segment.isActive).length
          : rootGroupCount
    const pendingGroupCount = renderedRootGroups
      ? renderedRootGroups.length - mountedGroupCount
      : virtualizedPlan
        ? virtualizedBoundaryCount
        : partialDOMCount
    const effectiveStrategy = virtualizedPlan
      ? 'virtualized'
      : segmentPlan
        ? 'partial-dom'
        : rootGroups
          ? 'staged'
          : domStrategyType === 'full'
            ? 'full'
            : 'plain'
    const nativeSurfaceComplete =
      effectiveStrategy === 'staged'
        ? pendingGroupCount === 0
        : effectiveStrategy !== 'partial-dom' &&
          effectiveStrategy !== 'virtualized'
    const degradationMode =
      effectiveStrategy === 'partial-dom'
        ? 'partial-dom'
        : effectiveStrategy === 'virtualized'
          ? 'virtualized'
          : effectiveStrategy === 'staged' && !nativeSurfaceComplete
            ? 'staged-warmup'
            : 'none'
    const requestedStrategy =
      domStrategyType === 'partial-dom'
        ? 'internal-partial-dom'
        : domStrategyType

    return {
      activeSegmentIndex:
        segmentPlan?.activeSegmentIndex ??
        selectedVirtualizedTopLevelIndex ??
        null,
      overscan:
        internalSegmentDOMStrategyConfig?.overscan ??
        virtualizedDOMStrategyConfig?.overscan ??
        null,
      cohort: getDOMStrategyCohort(documentSize),
      degradationMode,
      documentSize,
      effectiveStrategy,
      estimatedBlockSize:
        virtualizedDOMStrategyConfig?.estimatedBlockSize ?? null,
      segmentSize: internalSegmentDOMStrategyConfig?.segmentSize ?? null,
      mountedGroupCount,
      mountedTopLevelCount,
      nativeSurfaceComplete,
      pendingGroupCount,
      pendingTopLevelCount: Math.max(0, documentSize - mountedTopLevelCount),
      requestedStrategy,
      threshold:
        internalSegmentDOMStrategyConfig?.threshold ??
        virtualizedDOMStrategyConfig?.threshold ??
        ROOT_GROUP_THRESHOLD,
      virtualizerMeasuredCount:
        virtualizedPlan?.virtualizerMeasuredCount ?? null,
    } satisfies EditableDOMStrategyMetricsBase
  }, [
    domPresentMountedTopLevelRuntimeIds,
    virtualizedPlan,
    segmentPlan,
    internalSegmentDOMStrategyConfig,
    virtualizedDOMStrategyConfig,
    domStrategyType,
    renderedRootGroups,
    rootGroups,
    selectedVirtualizedTopLevelIndex,
    topLevelRuntimeIds.length,
  ])

  return (
    <ProjectionContext.Provider value={projectionStore}>
      <SlateDOMTextSyncContext.Provider value={domTextSyncOptions}>
        <SlateEditableRootContext.Provider value={editableRoot}>
          <EditableDOMRoot
            autoFocus={autoFocus}
            {...attributes}
            className={className}
            deferNativeTextInputRepair={domStrategyType === 'staged'}
            disableDefaultStyles={disableDefaultStyles}
            domStrategyMetrics={domStrategyMetrics}
            domStrategyRuntime={
              virtualizedPlan
                ? {
                    mountedTopLevelRuntimeIds:
                      virtualizedPlan.mountedTopLevelRuntimeIds,
                    mountedTopLevelRanges:
                      virtualizedPlan.mountedTopLevelRanges ?? undefined,
                    type: 'virtualized',
                  }
                : segmentPlan
                  ? {
                      mountedTopLevelRuntimeIds,
                      mountedTopLevelRanges: mountedTopLevelRanges ?? undefined,
                      type: 'partial-dom',
                    }
                  : rootGroups
                    ? {
                        mountedTopLevelRuntimeIds:
                          domPresentMountedTopLevelRuntimeIds,
                        mountedTopLevelRanges:
                          domPresentMountedTopLevelRanges ?? undefined,
                        type: 'staged',
                      }
                    : null
            }
            id={id}
            ignoreBlankEditableRootClicks={layout != null}
            onBeforeInput={onBeforeInput}
            onDOMBeforeInput={onDOMBeforeInput}
            onDOMStrategyMetrics={onDOMStrategyMetrics}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            readOnly={effectiveReadOnly}
            ref={
              virtualizedDOMStrategyConfig
                ? setDOMStrategyRootElement
                : undefined
            }
            scrollSelectionIntoView={scrollSelectionIntoView}
            spellCheck={spellCheck}
            style={rootStyle}
          >
            {virtualizedPlan ? (
              <div
                data-slate-dom-strategy-virtualizer="true"
                style={{
                  height: virtualizedPlan.totalSize,
                  position: 'relative',
                  width: '100%',
                }}
              >
                {virtualizedPlan.missingRanges.map((range) => (
                  <DOMStrategyVirtualizedRangeBoundary
                    anchorRuntimeId={range.anchorRuntimeId}
                    boundaryId={range.boundaryId}
                    endIndex={range.endIndex}
                    focusRuntimeId={range.focusRuntimeId}
                    key={range.boundaryId}
                    startIndex={range.startIndex}
                  />
                ))}
                {virtualizedPlan.virtualItems.map((item) => (
                  <div
                    data-index={item.index}
                    data-slate-dom-strategy-virtual-row="true"
                    key={String(item.key)}
                    ref={virtualizedPlan.measureElement}
                    style={{
                      left: 0,
                      minHeight: item.size,
                      pointerEvents: 'none',
                      position: 'absolute',
                      top: 0,
                      transform: `translateY(${item.start}px)`,
                      width: '100%',
                    }}
                  >
                    <div style={{ pointerEvents: 'auto' }}>
                      <EditableDescendantNode
                        placeholder={placeholderValue}
                        placeholderRef={placeholderRef}
                        renderElement={renderElement}
                        renderLeaf={renderLeaf}
                        renderPlaceholder={renderPlaceholder}
                        renderSegment={renderSegment}
                        renderText={renderText}
                        renderVoid={renderVoid}
                        runtimeId={item.runtimeId}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : segmentPlan ? (
              segmentPlan.segments.map((segment) =>
                segment.isActive ? (
                  segment.mountedRuntimeIds.map((runtimeId) => (
                    <EditableDescendantNode
                      key={runtimeId}
                      placeholder={placeholderValue}
                      placeholderRef={placeholderRef}
                      renderElement={renderElement}
                      renderLeaf={renderLeaf}
                      renderPlaceholder={renderPlaceholder}
                      renderSegment={renderSegment}
                      renderText={renderText}
                      renderVoid={renderVoid}
                      runtimeId={runtimeId}
                    />
                  ))
                ) : (
                  <DOMStrategySegmentPlaceholder
                    coverageReason={
                      domStrategyType === 'virtualized'
                        ? 'viewport-virtualization'
                        : 'partial-dom-aggressive'
                    }
                    endIndex={segment.endIndex}
                    key={`partial-dom-${segment.segmentIndex}`}
                    onPromote={handlePromoteSegment}
                    previewChars={
                      internalSegmentDOMStrategyConfig!.previewChars
                    }
                    runtimeIds={segment.runtimeIds}
                    segmentIndex={segment.segmentIndex}
                    startIndex={segment.startIndex}
                  />
                )
              )
            ) : renderedRootGroupItems ? (
              renderedRootGroupItems.map((item) =>
                item.kind === 'mounted' ? (
                  <EditableRootGroup
                    endIndex={item.group.endIndex}
                    groupId={item.group.groupId}
                    key={item.group.groupId}
                    placeholder={placeholderValue}
                    placeholderRef={placeholderRef}
                    renderElement={renderElement}
                    renderLeaf={renderLeaf}
                    renderPlaceholder={renderPlaceholder}
                    renderSegment={renderSegment}
                    renderText={renderText}
                    renderVoid={renderVoid}
                    runtimeIds={item.group.runtimeIds}
                    startIndex={item.group.startIndex}
                  />
                ) : (
                  <EditableRootGroupPlaceholder
                    anchorRuntimeId={item.anchorRuntimeId}
                    endIndex={item.endIndex}
                    focusRuntimeId={item.focusRuntimeId}
                    groupId={item.groupId}
                    key={item.groupId}
                    startIndex={item.startIndex}
                  />
                )
              )
            ) : (
              topLevelRuntimeIds.map((runtimeId) => (
                <EditableDescendantNode
                  key={runtimeId}
                  placeholder={placeholderValue}
                  placeholderRef={placeholderRef}
                  renderElement={renderElement}
                  renderLeaf={renderLeaf}
                  renderPlaceholder={renderPlaceholder}
                  renderSegment={renderSegment}
                  renderText={renderText}
                  renderVoid={renderVoid}
                  runtimeId={runtimeId}
                />
              ))
            )}
          </EditableDOMRoot>
        </SlateEditableRootContext.Provider>
      </SlateDOMTextSyncContext.Provider>
    </ProjectionContext.Provider>
  )
}

const EditableTextBlocksVirtualized = <T, TElement extends SlateElementNode>(
  props: EditableTextBlocksProps<T, TElement>
) => <EditableTextBlocksInner {...props} enableVirtualizedRendering />

const EditableTextBlocksNonVirtualized = <T, TElement extends SlateElementNode>(
  props: EditableTextBlocksProps<T, TElement>
) => <EditableTextBlocksInner {...props} />

export const EditableTextBlocks = <T, TElement extends SlateElementNode>(
  props: EditableTextBlocksProps<T, TElement>
) => {
  const { root, ...editableProps } = props
  const inheritedReadOnly = useEditorReadOnly()
  const rootReadOnly = props.readOnly || inheritedReadOnly
  const editable =
    getDOMStrategyType(props.domStrategy) === 'virtualized' ? (
      <EditableTextBlocksVirtualized {...editableProps} />
    ) : (
      <EditableTextBlocksNonVirtualized {...editableProps} />
    )

  return root === undefined ? (
    editable
  ) : (
    <Slate readOnly={rootReadOnly} root={root}>
      {editable}
    </Slate>
  )
}
