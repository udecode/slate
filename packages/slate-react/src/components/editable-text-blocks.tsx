import type { TextareaHTMLAttributes } from 'react'
import React, { type CSSProperties, type ReactNode } from 'react'
import type {
  Ancestor,
  Descendant,
  Path,
  RuntimeId,
  Element as SlateElementNode,
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
} from '../context'
import {
  composeProjectionSources,
  createDecorationSource,
  type SlateDecoration,
  type SlateOverlayProjectionStore,
} from '../decoration-source'
import {
  type EditableLeafRendererProps,
  type EditableRenderers,
  getEditableRenderers,
} from '../editable/editable-renderers'
import {
  type RenderingStrategyRootConfig,
  usePlaceholderValue,
  useRenderingStrategyRootSources,
  useRootDocumentEpoch,
  useTopLevelSelectionIndex,
} from '../editable/root-selector-sources'
import { Editor } from '../editable/runtime-editor-api'
import { readRuntimeNode } from '../editable/runtime-live-state'
import { useEditor } from '../hooks/use-editor'
import { useIsomorphicLayoutEffect } from '../hooks/use-isomorphic-layout-effect'
import { useMountedNodeRenderSelector } from '../hooks/use-node-selector'
import { useSlateNodeRef } from '../hooks/use-slate-node-ref'
import type { ReactRuntimeEditor } from '../plugin/react-editor'
import { ProjectionContext } from '../projection-context'
import { recordSlateReactRender } from '../render-profiler'
import type { RenderingStrategyOptions } from '../rendering-strategy/create-segment-plan'
import { RenderingStrategySegmentShell } from '../rendering-strategy/segment-shell'
import {
  canUseElementAsVirtualizerScrollRoot,
  type RenderingStrategyVirtualizedConfig,
  useVirtualizedRootPlan,
} from '../rendering-strategy/use-virtualized-root-plan'
import { RenderingStrategyVirtualizedRangeBoundary } from '../rendering-strategy/virtualized-range-boundary'
import {
  DOMCoverageBoundaryRange,
  DOMCoverageSelfBoundary,
} from './dom-coverage-boundary'
import {
  type EditableCommandHandler,
  type EditableDOMBeforeInputHandler,
  EditableDOMRoot,
  type EditableKeyDownHandler,
  type EditableRenderingStrategyCohort,
  type EditableRenderingStrategyMetrics,
  type EditableRenderingStrategyMetricsBase,
} from './editable'
import { EditableElement } from './editable-element'
import {
  EditableText,
  type EditableTextLeafProps,
  type EditableTextRenderPlaceholderProps,
  type EditableTextRenderTextProps,
  type EditableTextSegment,
} from './editable-text'
import { SlateLeaf } from './slate-leaf'
import { SlateInlineVoidShell, SlateVoidShell } from './slate-void-shell'

const isText = (value: Descendant): value is SlateTextNode =>
  typeof (value as SlateTextNode).text === 'string'

const isDevelopment =
  (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process?.env
    ?.NODE_ENV !== 'production'

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

const getRenderingStrategyType = (
  renderingStrategy: RenderingStrategyOptions | null | undefined
) =>
  typeof renderingStrategy === 'string'
    ? renderingStrategy
    : (renderingStrategy?.type ?? 'auto')

const getRenderingStrategyShellOptions = (
  renderingStrategy: RenderingStrategyOptions | null | undefined
) =>
  typeof renderingStrategy === 'object' && renderingStrategy != null
    ? renderingStrategy.type === 'shell'
      ? renderingStrategy
      : null
    : null

const getRenderingStrategyVirtualizedOptions = (
  renderingStrategy: RenderingStrategyOptions | null | undefined
) =>
  typeof renderingStrategy === 'object' && renderingStrategy != null
    ? renderingStrategy.type === 'virtualized'
      ? renderingStrategy
      : null
    : null

const isRenderingStrategySegmentMode = (
  type: ReturnType<typeof getRenderingStrategyType>
) => type === 'shell'

const getRenderingStrategyCohort = (
  documentSize: number
): EditableRenderingStrategyCohort => {
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

const getTypedElementRenderer = <TElement extends SlateElementNode>(
  renderers: EditableRenderers<unknown, TElement>['elements'] | undefined,
  element: TElement
): RenderElementRenderer<TElement> | undefined => {
  const type = (element as { type?: unknown }).type

  return typeof type === 'string'
    ? (
        renderers as
          | Record<string, RenderElementRenderer<TElement> | undefined>
          | undefined
      )?.[type]
    : undefined
}

const getTypedVoidRenderer = <TElement extends SlateElementNode>(
  renderers: EditableRenderers<unknown, TElement>['voids'] | undefined,
  element: TElement
): RenderVoidRenderer<TElement> | undefined => {
  const type = (element as { type?: unknown }).type

  return typeof type === 'string'
    ? (
        renderers as
          | Record<string, RenderVoidRenderer<TElement> | undefined>
          | undefined
      )?.[type]
    : undefined
}

const createRegisteredRenderLeaf = <T,>(
  leafRenderers: EditableRenderers<T>['leaves'] | undefined
): ((props: EditableTextLeafProps<T>) => ReactNode) | undefined => {
  const entries = Object.entries(leafRenderers ?? {})

  if (!entries.length) {
    return undefined
  }

  return (props) => {
    let children = props.children
    const leafRecord = props.leaf as Record<string, unknown>

    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [key, Renderer] = entries[index]!

      if (!leafRecord[key]) {
        continue
      }

      children = Renderer({
        children,
        leaf: props.leaf,
        leafPosition: props.leafPosition,
        segment: props.segment,
        text: props.text,
      } satisfies EditableLeafRendererProps<T>)
    }

    return <SlateLeaf>{children}</SlateLeaf>
  }
}

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

export type EditableDOMCoverageBoundaryProps = {
  boundaryId: string
  children?: ReactNode
  copyPolicy?: DOMCoverageCopyPolicy
  findPolicy?: DOMCoverageFindPolicy
  mounted?: boolean
  reason?: DOMCoverageReason
  renderPlaceholder?: (
    context: EditableDOMCoverageBoundaryPlaceholderContext
  ) => ReactNode
  scope: EditableDOMCoverageBoundaryScope
  selectionPolicy?: DOMCoverageSelectionPolicy
}

export type EditableElementSlots = {
  /**
   * Unstable adapter for model-present content whose editable DOM is not
   * currently mounted. This is experimental until the public boundary API is
   * finalized.
   */
  unstableBoundary: (props: EditableDOMCoverageBoundaryProps) => ReactNode
}

const createEditableElementSlots = (
  editor: ReturnType<typeof useEditor>,
  props: { children: ReactNode }
): EditableElementSlots => ({
  unstableBoundary: ({
    boundaryId,
    children,
    copyPolicy,
    findPolicy,
    mounted = true,
    reason,
    renderPlaceholder,
    scope,
    selectionPolicy,
  }) => {
    const materialize = () => {
      DOMCoverage.materializeBoundary(editor, boundaryId, 'programmatic')
    }
    const placeholder = renderPlaceholder
      ? renderPlaceholder({ materialize })
      : children
    const hidden = !mounted

    if (scope.type === 'self') {
      return (
        <DOMCoverageSelfBoundary
          boundaryId={boundaryId}
          content={props.children}
          copyPolicy={copyPolicy}
          findPolicy={findPolicy}
          hidden={hidden}
          reason={reason}
          selectionPolicy={selectionPolicy}
        >
          {placeholder}
        </DOMCoverageSelfBoundary>
      )
    }

    const childNodes = React.Children.toArray(props.children)
    const to = scope.to ?? scope.from

    return (
      <DOMCoverageBoundaryRange
        boundaryId={boundaryId}
        content={childNodes.slice(scope.from, to + 1)}
        copyPolicy={copyPolicy}
        findPolicy={findPolicy}
        from={scope.from}
        hidden={hidden}
        reason={reason}
        selectionPolicy={selectionPolicy}
        to={to}
      >
        {placeholder}
      </DOMCoverageBoundaryRange>
    )
  },
})

const EditableRenderedVoid = <
  TElement extends SlateElementNode = SlateElementNode,
>({
  children,
  element,
  isInline,
  renderVoid,
  voidRenderers,
}: {
  children: ReactNode
  element: TElement
  isInline: boolean
  renderVoid?: RenderVoidRenderer<TElement>
  voidRenderers?: EditableRenderers<unknown, TElement>['voids']
}) => {
  const content =
    (renderVoid ?? getTypedVoidRenderer(voidRenderers, element))?.({
      element,
    }) ?? null

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

export type EditableTextBlocksProps<
  T = unknown,
  TElement extends SlateElementNode = any,
> = {
  autoFocus?: boolean
  className?: string
  decorate?: EditableDecorate<T>
  disableDefaultStyles?: boolean
  id?: string
  /**
   * Rendering strategy for large documents. `virtualized` is experimental and
   * must use the object form: `{ type: 'virtualized', ... }`.
   */
  renderingStrategy?: RenderingStrategyOptions | null
  onBeforeInput?: React.FormEventHandler<HTMLDivElement>
  onDOMBeforeInput?: EditableDOMBeforeInputHandler
  onCommand?: EditableCommandHandler
  onKeyDown?: EditableKeyDownHandler
  onRenderingStrategyMetrics?: (
    metrics: EditableRenderingStrategyMetrics
  ) => void
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
  elementRenderers,
  placeholder,
  placeholderRef,
  renderElement,
  renderLeaf,
  renderPlaceholder,
  renderSegment,
  renderText,
  renderVoid,
  runtimeId,
  voidRenderers,
}: {
  elementRenderers?: EditableRenderers<unknown, TElement>['elements']
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
  voidRenderers?: EditableRenderers<unknown, TElement>['voids']
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
    { runtimeId }
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
  const children = childRuntimeIds.map((childRuntimeId) => (
    <EditableDescendantNode
      elementRenderers={elementRenderers}
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
      voidRenderers={voidRenderers}
    />
  ))
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
        elementRenderers={elementRenderers}
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
        voidRenderers={voidRenderers}
      />
    )
  })

  if (voidNode) {
    if (!path) {
      return null
    }

    return (
      <NodeRuntimeIdContext.Provider key={runtimeId} value={runtimeId}>
        <ElementPathContext.Provider value={path}>
          <ElementContext.Provider value={node}>
            <EditableRenderedVoid
              element={node as TElement}
              isInline={inline}
              renderVoid={renderVoid}
              voidRenderers={voidRenderers}
            >
              {children}
            </EditableRenderedVoid>
          </ElementContext.Provider>
        </ElementPathContext.Provider>
      </NodeRuntimeIdContext.Provider>
    )
  }

  const nodeRenderElement =
    renderElement ?? getTypedElementRenderer(elementRenderers, node as TElement)

  if (nodeRenderElement) {
    if (!path) {
      return null
    }

    const renderElementPropsBase = {
      attributes,
      children,
      element: node as TElement,
      isInline: inline,
    }
    const renderElementProps = {
      ...renderElementPropsBase,
      slots: createEditableElementSlots(editor, renderElementPropsBase),
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
  elementRenderers,
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
  voidRenderers,
}: {
  endIndex: number
  elementRenderers?: EditableRenderers<unknown, TElement>['elements']
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
  voidRenderers?: EditableRenderers<unknown, TElement>['voids']
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
          elementRenderers={elementRenderers}
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
          voidRenderers={voidRenderers}
        />
      ))}
    </div>
  )
}

const EditableRootGroup = React.memo(
  EditableRootGroupInner,
  (previous, next) =>
    previous.endIndex === next.endIndex &&
    previous.elementRenderers === next.elementRenderers &&
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
    previous.voidRenderers === next.voidRenderers &&
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
      findPolicy: 'not-native-until-mounted' as const,
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
  disableDefaultStyles = false,
  enableVirtualizedRendering = false,
  id,
  renderingStrategy,
  onBeforeInput,
  onDOMBeforeInput,
  onCommand,
  onKeyDown,
  onRenderingStrategyMetrics,
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
  const editor = useEditor()
  const extensionRenderers = React.useMemo(
    () => getEditableRenderers<T, TElement>(editor),
    [editor]
  )
  const registeredRenderLeaf = React.useMemo(
    () => createRegisteredRenderLeaf<T>(extensionRenderers.leaves),
    [extensionRenderers.leaves]
  )
  const effectiveRenderLeaf = renderLeaf ?? registeredRenderLeaf
  const effectiveRenderSegment = renderSegment ?? extensionRenderers.segment
  const effectiveRenderText = renderText ?? extensionRenderers.text
  const elementRenderers = renderElement
    ? undefined
    : extensionRenderers.elements
  const voidRenderers = renderVoid ? undefined : extensionRenderers.voids
  const upstreamProjectionStore = React.useContext(ProjectionContext)
  const [decorateCell] = React.useState(() => ({ current: decorate }))
  decorateCell.current = decorate
  const hasDecorate = Boolean(decorate)
  const decorateSource = React.useMemo(() => {
    if (!hasDecorate) {
      return null
    }

    return createDecorationSource<T>(editor, {
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
    })
  }, [decorateCell, editor, hasDecorate])
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
  const [renderingStrategyRootElement, setRenderingStrategyRootElement] =
    React.useState<HTMLDivElement | null>(null)
  const [
    promotedVirtualizedTopLevelIndex,
    setPromotedVirtualizedTopLevelIndex,
  ] = React.useState<number | null>(null)
  const placeholderResizeObserverRef = React.useRef<ResizeObserver | null>(null)
  const renderingStrategyType = getRenderingStrategyType(renderingStrategy)
  const renderingStrategyShellOptions =
    getRenderingStrategyShellOptions(renderingStrategy)
  const renderingStrategyVirtualizedOptions =
    getRenderingStrategyVirtualizedOptions(renderingStrategy)
  const renderingStrategyShellOverscan =
    renderingStrategyShellOptions?.overscan ?? 0
  const renderingStrategyShellSegmentSize =
    renderingStrategyShellOptions?.segmentSize ?? 100
  const renderingStrategyShellPreviewChars =
    renderingStrategyShellOptions?.previewChars ?? 96
  const renderingStrategyShellThreshold =
    renderingStrategyShellOptions?.threshold ?? 2000
  const renderingStrategyVirtualizedEstimatedBlockSize =
    renderingStrategyVirtualizedOptions?.estimatedBlockSize ?? 32
  const renderingStrategyVirtualizedOverscan =
    renderingStrategyVirtualizedOptions?.overscan ?? 2
  const renderingStrategyVirtualizedThreshold =
    renderingStrategyVirtualizedOptions?.threshold ?? 25_000
  const renderingStrategyConfig = React.useMemo(
    () =>
      isRenderingStrategySegmentMode(renderingStrategyType)
        ? ({
            overscan: Math.max(0, renderingStrategyShellOverscan),
            segmentSize: Math.max(1, renderingStrategyShellSegmentSize),
            previewChars: Math.max(16, renderingStrategyShellPreviewChars),
            threshold: Math.max(1, renderingStrategyShellThreshold),
          } satisfies RenderingStrategyRootConfig)
        : null,
    [
      renderingStrategyType,
      renderingStrategyShellOverscan,
      renderingStrategyShellPreviewChars,
      renderingStrategyShellSegmentSize,
      renderingStrategyShellThreshold,
    ]
  )
  const renderingStrategyVirtualizedConfig = React.useMemo(
    () =>
      renderingStrategyType === 'virtualized'
        ? ({
            estimatedBlockSize: Math.max(
              1,
              renderingStrategyVirtualizedEstimatedBlockSize
            ),
            overscan: Math.max(0, renderingStrategyVirtualizedOverscan),
            threshold: Math.max(1, renderingStrategyVirtualizedThreshold),
          } satisfies RenderingStrategyVirtualizedConfig)
        : null,
    [
      renderingStrategyType,
      renderingStrategyVirtualizedEstimatedBlockSize,
      renderingStrategyVirtualizedOverscan,
      renderingStrategyVirtualizedThreshold,
    ]
  )
  const {
    segmentPlan,
    mountedTopLevelRanges,
    mountedTopLevelRuntimeIds,
    topLevelRuntimeIds,
  } = useRenderingStrategyRootSources({
    renderingStrategyConfig,
    promotedSegmentIndex,
  })
  const selectedVirtualizedTopLevelIndex = useTopLevelSelectionIndex(
    renderingStrategyVirtualizedConfig != null
  )
  const virtualizedScrollRootReady =
    renderingStrategyVirtualizedConfig != null &&
    canUseElementAsVirtualizerScrollRoot(renderingStrategyRootElement)
  const virtualizedPlan = useVirtualizedRootPlan({
    config: enableVirtualizedRendering
      ? renderingStrategyVirtualizedConfig
      : null,
    enabled: enableVirtualizedRendering && virtualizedScrollRootReady,
    promotedTopLevelIndex: promotedVirtualizedTopLevelIndex,
    rootElement: renderingStrategyRootElement,
    selectedTopLevelIndex: selectedVirtualizedTopLevelIndex,
    topLevelRuntimeIds,
  })
  const renderingStrategySegmentSize =
    renderingStrategyConfig?.segmentSize ?? null
  const rootDocumentEpoch = useRootDocumentEpoch()
  const shouldUseStagedFallback =
    renderingStrategyType === 'virtualized' && virtualizedPlan == null
  const rootGroups = React.useMemo(() => {
    if (
      (renderingStrategyType !== 'auto' &&
        renderingStrategyType !== 'staged' &&
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
  }, [renderingStrategyType, shouldUseStagedFallback, topLevelRuntimeIds])
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

    DOMCoverage.setMaterializeHandler(editor, (boundary, _reason, options) =>
      materializeRootGroupBoundary(boundary, options.range)
    )

    return () => {
      DOMCoverage.clearMaterializeHandler(editor)
    }
  }, [editor, materializeRootGroupBoundary, rootGroups])
  const materializeVirtualizedBoundary = React.useCallback(
    (boundary: DOMCoverageBoundary, targetRange?: SlateRange) => {
      const targetIndex =
        targetRange?.anchor.path[0] ?? boundary.coveredPathRanges[0]?.anchor[0]

      if (typeof targetIndex !== 'number') {
        return false
      }

      setPromotedVirtualizedTopLevelIndex(targetIndex)
      virtualizedPlan?.scrollToTopLevelIndex(targetIndex, 'center')

      return true
    },
    [virtualizedPlan]
  )

  useIsomorphicLayoutEffect(() => {
    if (!virtualizedPlan) {
      return
    }

    DOMCoverage.setMaterializeHandler(editor, (boundary, _reason, options) =>
      materializeVirtualizedBoundary(boundary, options.range)
    )

    return () => {
      DOMCoverage.clearMaterializeHandler(editor)
    }
  }, [editor, materializeVirtualizedBoundary, virtualizedPlan])
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

      if (!options.select || renderingStrategySegmentSize == null) {
        return
      }

      const startIndex = segmentIndex * renderingStrategySegmentSize

      try {
        const start = Editor.point(editor, [startIndex], { edge: 'start' })
        editor.update((tx) => {
          tx.selection.set({ anchor: start, focus: start })
        })
      } catch {
        // Leave selection unchanged for non-text-startable segments.
      }
    },
    [editor, renderingStrategySegmentSize]
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
    decorateSource?.refresh({ forceInvalidate: true, reason: 'external' })
  }, [decorate, decorateCell, decorateSource])
  const rootStyle =
    placeholderHeight && !disableDefaultStyles
      ? { minHeight: placeholderHeight, ...style }
      : style
  const fallbackDOMBeforeInput = React.useCallback(
    (event: InputEvent) => {
      onBeforeInput?.(event as unknown as React.FormEvent<HTMLDivElement>)
    },
    [onBeforeInput]
  )
  const domBeforeInputHandler =
    onDOMBeforeInput ?? (onBeforeInput ? fallbackDOMBeforeInput : undefined)
  const renderingStrategyMetrics = React.useMemo(() => {
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
    const shellCount =
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
        : shellCount
    const effectiveStrategy = virtualizedPlan
      ? 'virtualized'
      : segmentPlan
        ? 'shell'
        : rootGroups
          ? 'staged'
          : renderingStrategyType === 'full'
            ? 'full'
            : 'plain'
    const nativeSurfaceComplete =
      effectiveStrategy === 'staged'
        ? pendingGroupCount === 0
        : effectiveStrategy !== 'shell' && effectiveStrategy !== 'virtualized'
    const degradationMode =
      effectiveStrategy === 'shell'
        ? 'shell'
        : effectiveStrategy === 'virtualized'
          ? 'virtualized'
          : effectiveStrategy === 'staged' && !nativeSurfaceComplete
            ? 'staged-warmup'
            : 'none'

    return {
      activeSegmentIndex:
        segmentPlan?.activeSegmentIndex ??
        selectedVirtualizedTopLevelIndex ??
        null,
      overscan:
        renderingStrategyConfig?.overscan ??
        renderingStrategyVirtualizedConfig?.overscan ??
        null,
      cohort: getRenderingStrategyCohort(documentSize),
      degradationMode,
      documentSize,
      effectiveStrategy,
      estimatedBlockSize:
        renderingStrategyVirtualizedConfig?.estimatedBlockSize ?? null,
      segmentSize: renderingStrategyConfig?.segmentSize ?? null,
      mountedGroupCount,
      mountedTopLevelCount,
      nativeSurfaceComplete,
      pendingGroupCount,
      pendingTopLevelCount: Math.max(0, documentSize - mountedTopLevelCount),
      requestedStrategy: renderingStrategyType,
      shellCount,
      threshold:
        renderingStrategyConfig?.threshold ??
        renderingStrategyVirtualizedConfig?.threshold ??
        ROOT_GROUP_THRESHOLD,
      virtualizerMeasuredCount:
        virtualizedPlan?.virtualizerMeasuredCount ?? null,
    } satisfies EditableRenderingStrategyMetricsBase
  }, [
    domPresentMountedTopLevelRuntimeIds,
    virtualizedPlan,
    segmentPlan,
    renderingStrategyConfig,
    renderingStrategyVirtualizedConfig,
    renderingStrategyType,
    renderedRootGroups,
    rootGroups,
    selectedVirtualizedTopLevelIndex,
    topLevelRuntimeIds.length,
  ])

  return (
    <ProjectionContext.Provider value={projectionStore}>
      <EditableDOMRoot
        autoFocus={autoFocus}
        {...attributes}
        className={className}
        disableDefaultStyles={disableDefaultStyles}
        id={id}
        onCommand={onCommand}
        onDOMBeforeInput={domBeforeInputHandler}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onRenderingStrategyMetrics={onRenderingStrategyMetrics}
        readOnly={readOnly}
        ref={
          renderingStrategyVirtualizedConfig
            ? setRenderingStrategyRootElement
            : undefined
        }
        renderingStrategy={
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
                  type: 'shell',
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
        renderingStrategyMetrics={renderingStrategyMetrics}
        scrollSelectionIntoView={scrollSelectionIntoView}
        spellCheck={spellCheck}
        style={rootStyle}
      >
        {virtualizedPlan ? (
          <div
            data-slate-rendering-strategy-virtualizer="true"
            style={{
              height: virtualizedPlan.totalSize,
              position: 'relative',
              width: '100%',
            }}
          >
            {virtualizedPlan.missingRanges.map((range) => (
              <RenderingStrategyVirtualizedRangeBoundary
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
                data-slate-rendering-strategy-virtual-row="true"
                key={String(item.key)}
                ref={virtualizedPlan.measureElement}
                style={{
                  left: 0,
                  minHeight: item.size,
                  position: 'absolute',
                  top: 0,
                  transform: `translateY(${item.start}px)`,
                  width: '100%',
                }}
              >
                <EditableDescendantNode
                  elementRenderers={elementRenderers}
                  placeholder={placeholderValue}
                  placeholderRef={placeholderRef}
                  renderElement={renderElement}
                  renderLeaf={effectiveRenderLeaf}
                  renderPlaceholder={renderPlaceholder}
                  renderSegment={effectiveRenderSegment}
                  renderText={effectiveRenderText}
                  renderVoid={renderVoid}
                  runtimeId={item.runtimeId}
                  voidRenderers={voidRenderers}
                />
              </div>
            ))}
          </div>
        ) : segmentPlan ? (
          segmentPlan.segments.map((segment) =>
            segment.isActive ? (
              segment.mountedRuntimeIds.map((runtimeId) => (
                <EditableDescendantNode
                  elementRenderers={elementRenderers}
                  key={runtimeId}
                  placeholder={placeholderValue}
                  placeholderRef={placeholderRef}
                  renderElement={renderElement}
                  renderLeaf={effectiveRenderLeaf}
                  renderPlaceholder={renderPlaceholder}
                  renderSegment={effectiveRenderSegment}
                  renderText={effectiveRenderText}
                  renderVoid={renderVoid}
                  runtimeId={runtimeId}
                  voidRenderers={voidRenderers}
                />
              ))
            ) : (
              <RenderingStrategySegmentShell
                coverageReason={
                  renderingStrategyType === 'virtualized'
                    ? 'viewport-virtualization'
                    : 'shell-aggressive'
                }
                endIndex={segment.endIndex}
                key={`shell-${segment.segmentIndex}`}
                onPromote={handlePromoteSegment}
                previewChars={renderingStrategyConfig!.previewChars}
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
                elementRenderers={elementRenderers}
                endIndex={item.group.endIndex}
                groupId={item.group.groupId}
                key={item.group.groupId}
                placeholder={placeholderValue}
                placeholderRef={placeholderRef}
                renderElement={renderElement}
                renderLeaf={effectiveRenderLeaf}
                renderPlaceholder={renderPlaceholder}
                renderSegment={effectiveRenderSegment}
                renderText={effectiveRenderText}
                renderVoid={renderVoid}
                runtimeIds={item.group.runtimeIds}
                startIndex={item.group.startIndex}
                voidRenderers={voidRenderers}
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
              elementRenderers={elementRenderers}
              key={runtimeId}
              placeholder={placeholderValue}
              placeholderRef={placeholderRef}
              renderElement={renderElement}
              renderLeaf={effectiveRenderLeaf}
              renderPlaceholder={renderPlaceholder}
              renderSegment={effectiveRenderSegment}
              renderText={effectiveRenderText}
              renderVoid={renderVoid}
              runtimeId={runtimeId}
              voidRenderers={voidRenderers}
            />
          ))
        )}
      </EditableDOMRoot>
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
) =>
  getRenderingStrategyType(props.renderingStrategy) === 'virtualized' ? (
    <EditableTextBlocksVirtualized {...props} />
  ) : (
    <EditableTextBlocksNonVirtualized {...props} />
  )
