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
import { Node } from 'slate'
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
  type LargeDocumentRootConfig,
  useLargeDocumentRootSources,
  usePlaceholderValue,
  useRootDocumentEpoch,
  useTopLevelSelectionIndex,
} from '../editable/root-selector-sources'
import { Editor } from '../editable/runtime-editor-api'
import { readRuntimeNode } from '../editable/runtime-live-state'
import { useEditor } from '../hooks/use-editor'
import { useIsomorphicLayoutEffect } from '../hooks/use-isomorphic-layout-effect'
import { useMountedNodeRenderSelector } from '../hooks/use-node-selector'
import { useSlateNodeRef } from '../hooks/use-slate-node-ref'
import type { LargeDocumentOptions } from '../large-document/create-island-plan'
import { LargeDocumentIslandShell } from '../large-document/island-shell'
import { ProjectionContext } from '../projection-context'
import { recordSlateReactRender } from '../render-profiler'
import {
  DOMCoverageBoundaryRange,
  DOMCoverageSelfBoundary,
} from './dom-coverage-boundary'
import {
  EditableDOMRoot,
  type EditableInputRule,
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
import { SlateInlineVoidShell, SlateVoidShell } from './slate-void-shell'

const isText = (value: Descendant): value is SlateTextNode =>
  typeof (value as SlateTextNode).text === 'string'

const isDevelopment =
  (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process?.env
    ?.NODE_ENV !== 'production'

const EMPTY_RUNTIME_IDS = Object.freeze([]) as readonly RuntimeId[]
const ROOT_GROUP_SIZE = 50
const ROOT_GROUP_THRESHOLD = 1000
const ROOT_GROUP_BACKGROUND_MOUNT_INITIAL_DELAY_MS = 250
const ROOT_GROUP_BACKGROUND_MOUNT_DELAY_MS = 16
const ROOT_GROUP_BACKGROUND_MOUNT_BATCH_SIZE = 8

const getSnapshotPathKey = (path: Path) => path.join('.')

const getLargeDocumentMode = (
  largeDocument: LargeDocumentOptions | null | undefined
) =>
  typeof largeDocument === 'string'
    ? largeDocument
    : (largeDocument?.mode ?? 'auto')

const getLargeDocumentShellOptions = (
  largeDocument: LargeDocumentOptions | null | undefined
) =>
  typeof largeDocument === 'object' && largeDocument != null
    ? largeDocument
    : null

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

const sameDescendantBinding = (
  left: {
    childRuntimeIds: readonly RuntimeId[]
    node: Descendant | null
    path: Path | null
  } | null,
  right: {
    childRuntimeIds: readonly RuntimeId[]
    node: Descendant | null
    path: Path | null
  }
) =>
  left != null &&
  samePath(left.path, right.path) &&
  sameDescendant(left.node, right.node) &&
  sameRuntimeIds(left.childRuntimeIds, right.childRuntimeIds)

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
      return Node.string(ancestor)
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
  props,
  renderElement,
}: {
  props: EditableRenderElementProps<TElement>
  renderElement: RenderElementRenderer<TElement>
}) => {
  const editor = useEditor()
  const rendered = renderElement(props)

  useIsomorphicLayoutEffect(() => {
    if (!isDevelopment || !('dom' in editor)) {
      return
    }

    let cancelled = false

    queueMicrotask(() => {
      if (cancelled) {
        return
      }

      assertRenderedElementChildrenHaveDOMOrCoverage(editor, props)
    })

    return () => {
      cancelled = true
    }
  }, [editor, props])

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
  editor: ReturnType<typeof useEditor>,
  { element, path }: EditableRenderElementProps<TElement>
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

    try {
      editor.dom.toDOMPoint(point)
    } catch {
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
  path,
  renderVoid,
}: {
  children: ReactNode
  element: TElement
  isInline: boolean
  path: Path
  renderVoid?: RenderVoidRenderer<TElement>
}) => {
  const target = React.useMemo(() => Object.freeze([...path]) as Path, [path])

  const content =
    renderVoid?.({
      element,
      target,
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
      index: number
      isInline: boolean
      path: Path
      slots: EditableElementSlots
    }
  : never

export type RenderElementRenderer<TElement extends SlateElementNode = any> = (
  props: EditableRenderElementProps<TElement>
) => ReactNode

export type EditableRenderVoidProps<TElement extends SlateElementNode = any> = {
  element: TElement
  target: Path
}

export type RenderVoidRenderer<TElement extends SlateElementNode = any> = (
  props: EditableRenderVoidProps<TElement>
) => ReactNode

export type EditableTextBlocksProps<
  T = unknown,
  TElement extends SlateElementNode = any,
> = {
  autoFocus?: boolean
  className?: string
  disableDefaultStyles?: boolean
  id?: string
  inputRules?: readonly EditableInputRule[]
  largeDocument?: LargeDocumentOptions | null
  onBeforeInput?: React.FormEventHandler<HTMLDivElement>
  onDOMBeforeInput?: (event: InputEvent) => void
  onKeyDown?: EditableKeyDownHandler
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
          node: null,
          path: null,
        }
      }

      const descendant = node as Descendant
      const snapshot = Editor.getSnapshot(editorValue)

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

    return (
      <NodeRuntimeIdContext.Provider key={runtimeId} value={runtimeId}>
        <ElementPathContext.Provider value={path}>
          <ElementContext.Provider value={node}>
            <EditableRenderedVoid
              element={node as TElement}
              isInline={inline}
              path={path}
              renderVoid={renderVoid}
            >
              {children}
            </EditableRenderedVoid>
          </ElementContext.Provider>
        </ElementPathContext.Provider>
      </NodeRuntimeIdContext.Provider>
    )
  }

  if (renderElement) {
    if (!path) {
      return null
    }

    const renderElementPropsBase = {
      attributes,
      children,
      element: node as TElement,
      index: path.at(-1) ?? 0,
      isInline: inline,
      path,
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
              props={renderElementProps}
              renderElement={renderElement}
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
  if (!groups || boundary.reason !== 'large-document-staged') {
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
  const boundaryId = `large-document-staged:${groupId}`
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
      reason: 'large-document-staged' as const,
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
  disableDefaultStyles = false,
  id,
  inputRules,
  largeDocument,
  onBeforeInput,
  onDOMBeforeInput,
  onKeyDown,
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
}: EditableTextBlocksProps<T, TElement>) => {
  const editor = useEditor()
  const [promotedIslandIndex, setPromotedIslandIndex] = React.useState<
    number | null
  >(null)
  const [placeholderHeight, setPlaceholderHeight] = React.useState<
    number | null
  >(null)
  const placeholderResizeObserverRef = React.useRef<ResizeObserver | null>(null)
  const largeDocumentMode = getLargeDocumentMode(largeDocument)
  const largeDocumentShellOptions = getLargeDocumentShellOptions(largeDocument)
  const largeDocumentConfig = React.useMemo<LargeDocumentRootConfig | null>(
    () =>
      largeDocumentMode === 'shell'
        ? {
            activeRadius: Math.max(
              0,
              largeDocumentShellOptions?.activeRadius ?? 0
            ),
            islandSize: Math.max(
              1,
              largeDocumentShellOptions?.islandSize ?? 100
            ),
            previewChars: Math.max(
              16,
              largeDocumentShellOptions?.previewChars ?? 96
            ),
            threshold: Math.max(
              1,
              largeDocumentShellOptions?.threshold ?? 2000
            ),
          }
        : null,
    [largeDocumentMode, largeDocumentShellOptions]
  )
  const {
    islandPlan,
    mountedTopLevelRanges,
    mountedTopLevelRuntimeIds,
    topLevelRuntimeIds,
  } = useLargeDocumentRootSources({
    largeDocumentConfig,
    promotedIslandIndex,
  })
  const largeDocumentIslandSize = largeDocumentConfig?.islandSize ?? null
  const rootDocumentEpoch = useRootDocumentEpoch()
  const rootGroups = React.useMemo(() => {
    if (
      (largeDocumentMode !== 'auto' && largeDocumentMode !== 'dom-present') ||
      topLevelRuntimeIds.length < ROOT_GROUP_THRESHOLD
    ) {
      return null
    }

    recordSlateReactRender({
      id: 'dom-present-root-groups',
      kind: 'root-plan',
    })

    return createRootGroups(topLevelRuntimeIds)
  }, [largeDocumentMode, topLevelRuntimeIds])
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
  const handlePromoteIsland = React.useCallback(
    (islandIndex: number, options: { select?: boolean } = {}) => {
      setPromotedIslandIndex(islandIndex)

      if (!options.select || largeDocumentIslandSize == null) {
        return
      }

      const startIndex = islandIndex * largeDocumentIslandSize

      try {
        const start = Editor.point(editor, [startIndex], { edge: 'start' })
        editor.update((tx) => {
          tx.selection.set({ anchor: start, focus: start })
        })
      } catch {
        // Leave selection unchanged for non-text-startable islands.
      }
    },
    [editor, largeDocumentIslandSize]
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
  const rootStyle =
    placeholderHeight && !disableDefaultStyles
      ? { minHeight: placeholderHeight, ...style }
      : style

  return (
    <EditableDOMRoot
      autoFocus={autoFocus}
      {...attributes}
      className={className}
      disableDefaultStyles={disableDefaultStyles}
      id={id}
      inputRules={inputRules}
      largeDocument={
        islandPlan
          ? {
              mode: 'shell',
              mountedTopLevelRuntimeIds,
              mountedTopLevelRanges: mountedTopLevelRanges ?? undefined,
            }
          : rootGroups
            ? {
                mode: 'dom-present',
                mountedTopLevelRuntimeIds: domPresentMountedTopLevelRuntimeIds,
                mountedTopLevelRanges:
                  domPresentMountedTopLevelRanges ?? undefined,
              }
            : null
      }
      onDOMBeforeInput={onDOMBeforeInput ?? (onBeforeInput as any)}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      readOnly={readOnly}
      scrollSelectionIntoView={scrollSelectionIntoView}
      spellCheck={spellCheck}
      style={rootStyle}
    >
      {islandPlan
        ? islandPlan.islands.map((island) =>
            island.isActive ? (
              island.mountedRuntimeIds.map((runtimeId) => (
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
              <LargeDocumentIslandShell
                endIndex={island.endIndex}
                islandIndex={island.islandIndex}
                key={`shell-${island.islandIndex}`}
                onPromote={handlePromoteIsland}
                previewChars={largeDocumentConfig!.previewChars}
                runtimeIds={island.runtimeIds}
                startIndex={island.startIndex}
              />
            )
          )
        : renderedRootGroupItems
          ? renderedRootGroupItems.map((item) =>
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
          : topLevelRuntimeIds.map((runtimeId) => (
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
            ))}
    </EditableDOMRoot>
  )
}

export const EditableTextBlocks = EditableTextBlocksInner
