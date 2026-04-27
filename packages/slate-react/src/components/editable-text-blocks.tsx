import type { TextareaHTMLAttributes } from 'react'
import React, { type CSSProperties, type ReactNode } from 'react'
import type {
  Ancestor,
  Descendant,
  Operation,
  Path,
  RuntimeId,
  Element as SlateElementNode,
  Text as SlateTextNode,
} from 'slate'
import { Editor, Node } from 'slate'
import {
  EDITOR_TO_PLACEHOLDER_ELEMENT,
  IS_NODE_MAP_DIRTY,
  NODE_TO_INDEX,
  NODE_TO_PARENT,
} from 'slate-dom'

import {
  ElementContext,
  ElementPathContext,
  NodeRuntimeIdContext,
} from '../context'
import {
  didSyncTextPathToDOM,
  useSlateNodeRef,
} from '../hooks/use-slate-node-ref'
import { useSlateSelector } from '../hooks/use-slate-selector'
import { useSlateStatic } from '../hooks/use-slate-static'
import {
  createIslandPlan,
  type LargeDocumentOptions,
} from '../large-document/create-island-plan'
import { LargeDocumentIslandShell } from '../large-document/island-shell'
import type { ReactEditor } from '../plugin/react-editor'
import type { SlateProjectionStore } from '../projection-store'
import {
  EditableDOMRoot,
  type EditableInputRule,
  type EditableKeyCommandHandler,
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

const isText = (value: Descendant): value is SlateTextNode =>
  typeof (value as SlateTextNode).text === 'string'

const isElement = (
  value: Descendant
): value is Exclude<Descendant, SlateTextNode> => !isText(value)

const EMPTY_RUNTIME_IDS = Object.freeze([]) as readonly RuntimeId[]

const isTextOperation = (operation: Operation | undefined) =>
  operation?.type === 'insert_text' || operation?.type === 'remove_text'

const isSelectionOperation = (operation: Operation | undefined) =>
  operation?.type === 'set_selection'

const hasNoOperations = (operations: readonly Operation[] | undefined) =>
  !operations || operations.length === 0

const shouldUpdateTopLevelRuntimeIds = (operations?: readonly Operation[]) =>
  hasNoOperations(operations) ||
  (operations ?? []).some(
    (operation) =>
      !isTextOperation(operation) && !isSelectionOperation(operation)
  )

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
        : (Editor.getLiveNode(editor, ancestorPath) as Ancestor | undefined)

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
  zeroWidth,
}: {
  editor: Editor
  node: SlateTextNode
  path: Path | null
  zeroWidth?: {
    includeSentinel?: boolean
    isLineBreak?: boolean
    isMarkPlaceholder?: boolean
    length?: number
  }
}) => {
  if (!path || node.text !== '') {
    return zeroWidth ?? { isLineBreak: true }
  }

  if (getNearestEditableBlockText(editor, path) !== '') {
    return {
      ...zeroWidth,
      isLineBreak: false,
    }
  }

  return zeroWidth ?? { isLineBreak: true }
}

const EditableRenderedElement = <
  TElement extends SlateElementNode = SlateElementNode,
>({
  props,
  renderElement,
}: {
  props: EditableRenderElementProps<TElement>
  renderElement: RenderElementRenderer<TElement>
}) => <>{renderElement(props)}</>

const shouldUpdateDescendantBinding =
  (editor: Editor, currentPathRef: React.MutableRefObject<Path | null>) =>
  (operations?: readonly Operation[]) => {
    if (hasNoOperations(operations)) return true

    return (operations ?? []).some((operation) => {
      if (isSelectionOperation(operation)) return false
      if (!isTextOperation(operation)) return true

      const currentPath = currentPathRef.current

      return Boolean(
        currentPath &&
          'path' in operation &&
          Array.isArray(operation.path) &&
          samePath(operation.path, currentPath) &&
          !didSyncTextPathToDOM(editor, currentPath)
      )
    })
  }

export type EditableRenderElementProps<
  TElement extends SlateElementNode = any,
> = TElement extends SlateElementNode
  ? {
      attributes: {
        'data-slate-inline'?: true
        'data-slate-node': 'element'
        'data-slate-void'?: true
        ref: React.RefCallback<HTMLElement>
      }
      children: ReactNode
      element: TElement
      index: number
      isInline: boolean
      path: Path
    }
  : never

export type RenderElementRenderer<TElement extends SlateElementNode = any> = (
  props: EditableRenderElementProps<TElement>
) => ReactNode

export type EditableTextBlocksProps<
  T = unknown,
  TElement extends SlateElementNode = any,
> = {
  autoFocus?: boolean
  className?: string
  disableDefaultStyles?: boolean
  editor?: ReactEditor<any>
  id?: string
  inputRules?: readonly EditableInputRule[]
  isInline?: (element: TElement) => boolean
  largeDocument?: LargeDocumentOptions | null
  onBeforeInput?: React.FormEventHandler<HTMLDivElement>
  onDOMBeforeInput?: (event: InputEvent) => void
  onKeyCommand?: EditableKeyCommandHandler
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>
  onPaste?: React.ClipboardEventHandler<HTMLDivElement>
  placeholder?: ReactNode
  projectionStore?: SlateProjectionStore<T> | null
  readOnly?: boolean
  renderElement?: RenderElementRenderer<TElement>
  renderLeaf?: (props: EditableTextLeafProps<T>) => ReactNode
  renderPlaceholder?: (props: EditableTextRenderPlaceholderProps) => ReactNode
  renderSegment?: (
    segment: EditableTextSegment<T>,
    children: ReactNode
  ) => ReactNode
  renderText?: (props: EditableTextRenderTextProps) => ReactNode
  scrollSelectionIntoView?: (editor: Editor, domRange: globalThis.Range) => void
  spellCheck?: boolean
  style?: CSSProperties
  zeroWidth?: {
    includeSentinel?: boolean
    isLineBreak?: boolean
    isMarkPlaceholder?: boolean
    length?: number
  }
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

const getDescendantAtPath = (
  children: readonly Descendant[],
  path: Path
): Descendant | null => {
  let current: Descendant | undefined
  let cursor: readonly Descendant[] = children

  for (let index = 0; index < path.length; index += 1) {
    current = cursor[path[index]!]

    if (!current) {
      return null
    }

    if (index === path.length - 1) {
      return current
    }

    if (!isElement(current)) {
      return null
    }

    cursor = current.children
  }

  return null
}

const EditableDescendantNodeInner = <T, TElement extends SlateElementNode>({
  isInline,
  placeholder,
  placeholderRef,
  renderElement,
  renderLeaf,
  renderPlaceholder,
  renderSegment,
  renderText,
  runtimeId,
  zeroWidth,
}: {
  isInline?: (element: TElement) => boolean
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
  runtimeId: RuntimeId
  zeroWidth?: {
    includeSentinel?: boolean
    isLineBreak?: boolean
    isMarkPlaceholder?: boolean
    length?: number
  }
}) => {
  const editor = useSlateStatic()
  const currentPathRef = React.useRef<Path | null>(null)

  const binding = useSlateSelector(
    (editorValue, operations) => {
      const currentPath = currentPathRef.current

      if (
        currentPath &&
        operations?.some(
          (operation) =>
            isTextOperation(operation) &&
            'path' in operation &&
            Array.isArray(operation.path) &&
            samePath(operation.path, currentPath)
        )
      ) {
        return {
          childRuntimeIds: EMPTY_RUNTIME_IDS,
          node: getDescendantAtPath(
            Editor.getChildren(editorValue),
            currentPath
          ),
          path: currentPath,
        }
      }

      const path = Editor.getPathByRuntimeId(editorValue, runtimeId)

      if (!path) {
        return {
          childRuntimeIds: EMPTY_RUNTIME_IDS,
          node: null,
          path: null,
        }
      }

      const node = getDescendantAtPath(Editor.getChildren(editorValue), path)

      return {
        childRuntimeIds:
          node && !isText(node)
            ? (node.children
                .map(
                  (_, index) =>
                    Editor.getRuntimeId(editorValue, [
                      ...path,
                      index,
                    ] as Path) ?? ''
                )
                .filter(Boolean) as RuntimeId[])
            : EMPTY_RUNTIME_IDS,
        node,
        path,
      }
    },
    sameDescendantBinding,
    { shouldUpdate: shouldUpdateDescendantBinding(editor, currentPathRef) }
  )

  const { childRuntimeIds, node, path } = binding
  const bindNodeRef = useSlateNodeRef(runtimeId, { path, slateNode: node })
  currentPathRef.current = path

  if (!node) {
    return null
  }

  if (path) {
    const parentPath = path.slice(0, -1) as Path
    const parent =
      parentPath.length === 0
        ? editor
        : (Editor.getLiveNode(editor, parentPath) as Ancestor | undefined)

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
        zeroWidth={resolveTextZeroWidth({ editor, node, path, zeroWidth })}
      />
    )
  }

  const inline = isInline?.(node as TElement) ?? Editor.isInline(editor, node)
  const voidNode = Editor.isVoid(editor, node)
  const attributes = {
    'data-slate-inline': inline ? (true as const) : undefined,
    'data-slate-node': 'element' as const,
    'data-slate-void': voidNode ? (true as const) : undefined,
    ref: bindNodeRef as React.RefCallback<HTMLElement>,
  }
  const children = childRuntimeIds.map((childRuntimeId) => (
    <EditableDescendantNode
      isInline={isInline}
      key={childRuntimeId}
      placeholder={placeholder}
      placeholderRef={placeholderRef}
      renderElement={renderElement}
      renderLeaf={renderLeaf}
      renderPlaceholder={renderPlaceholder}
      renderSegment={renderSegment}
      renderText={renderText}
      runtimeId={childRuntimeId}
      zeroWidth={zeroWidth}
    />
  ))

  if (renderElement) {
    if (!path) {
      return null
    }

    const renderElementProps = {
      attributes,
      children,
      element: node as TElement,
      index: path.at(-1) ?? 0,
      isInline: inline,
      path,
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
            {children}
          </EditableElement>
        </ElementContext.Provider>
      </ElementPathContext.Provider>
    </NodeRuntimeIdContext.Provider>
  )
}

const EditableDescendantNode = React.memo(
  EditableDescendantNodeInner
) as typeof EditableDescendantNodeInner

const EditableTextBlocksInner = <T, TElement extends SlateElementNode>({
  autoFocus,
  className,
  disableDefaultStyles = false,
  id,
  inputRules,
  isInline,
  largeDocument,
  onBeforeInput,
  onDOMBeforeInput,
  onKeyCommand,
  onKeyDown,
  onPaste,
  readOnly = false,
  placeholder,
  renderElement,
  renderLeaf,
  renderPlaceholder,
  renderSegment,
  renderText,
  scrollSelectionIntoView,
  spellCheck,
  style,
  zeroWidth,
  ...attributes
}: EditableTextBlocksProps<T, TElement>) => {
  const editor = useSlateStatic()
  const [promotedIslandIndex, setPromotedIslandIndex] = React.useState<
    number | null
  >(null)
  const [placeholderHeight, setPlaceholderHeight] = React.useState<
    number | null
  >(null)
  const placeholderResizeObserverRef = React.useRef<ResizeObserver | null>(null)
  const topLevelRuntimeIds = useSlateSelector(
    (editorValue) => {
      return Editor.getChildren(editorValue)
        .map(
          (_node: unknown, index: number) =>
            Editor.getRuntimeId(editorValue, [index] as Path) ?? ''
        )
        .filter(Boolean) as RuntimeId[]
    },
    (left, right) => left != null && sameRuntimeIds(left as RuntimeId[], right),
    { shouldUpdate: shouldUpdateTopLevelRuntimeIds }
  )
  const largeDocumentConfig =
    largeDocument?.enabled === true
      ? {
          activeRadius: Math.max(0, largeDocument.activeRadius ?? 0),
          islandSize: Math.max(1, largeDocument.islandSize ?? 100),
          previewChars: Math.max(16, largeDocument.previewChars ?? 96),
          threshold: Math.max(1, largeDocument.threshold ?? 2000),
        }
      : null
  const largeDocumentIslandSize = largeDocumentConfig?.islandSize ?? null
  const islandPlan =
    largeDocumentConfig &&
    topLevelRuntimeIds.length >= largeDocumentConfig.threshold
      ? createIslandPlan({
          activeRadius: largeDocumentConfig.activeRadius,
          defaultActiveIslandIndex: 0,
          islandSize: largeDocumentConfig.islandSize,
          promotedIslandIndex,
          topLevelRuntimeIds,
        })
      : null
  const mountedTopLevelRuntimeIds = islandPlan
    ? new Set(
        islandPlan.islands.flatMap((island) =>
          island.isActive ? island.mountedRuntimeIds : []
        )
      )
    : null
  const mountedTopLevelRanges = islandPlan
    ? islandPlan.islands
        .filter((island) => island.isActive)
        .map((island) => ({
          endIndex: island.endIndex,
          startIndex: island.startIndex,
        }))
    : null
  const handlePromoteIsland = React.useCallback(
    (islandIndex: number, options: { select?: boolean } = {}) => {
      setPromotedIslandIndex(islandIndex)

      if (!options.select || largeDocumentIslandSize == null) {
        return
      }

      const startIndex = islandIndex * largeDocumentIslandSize

      try {
        const start = Editor.start(editor, [startIndex])
        editor.update(() => {
          editor.select({ anchor: start, focus: start })
        })
      } catch {
        // Leave selection unchanged for non-text-startable islands.
      }
    },
    [editor, largeDocumentIslandSize]
  )
  const placeholderValue = useSlateSelector((editorValue) =>
    placeholder &&
    Editor.getChildren(editorValue).length === 1 &&
    Array.from(Node.texts(editorValue)).length === 1 &&
    Node.string(editorValue) === ''
      ? placeholder
      : undefined
  )
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
              mountedTopLevelRuntimeIds,
              mountedTopLevelRanges: mountedTopLevelRanges ?? undefined,
            }
          : null
      }
      onDOMBeforeInput={onDOMBeforeInput ?? (onBeforeInput as any)}
      onKeyCommand={onKeyCommand}
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
                  isInline={isInline}
                  key={runtimeId}
                  placeholder={placeholderValue}
                  placeholderRef={placeholderRef}
                  renderElement={renderElement}
                  renderLeaf={renderLeaf}
                  renderPlaceholder={renderPlaceholder}
                  renderSegment={renderSegment}
                  renderText={renderText}
                  runtimeId={runtimeId}
                  zeroWidth={zeroWidth}
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
        : topLevelRuntimeIds.map((runtimeId) => (
            <EditableDescendantNode
              isInline={isInline}
              key={runtimeId}
              placeholder={placeholderValue}
              placeholderRef={placeholderRef}
              renderElement={renderElement}
              renderLeaf={renderLeaf}
              renderPlaceholder={renderPlaceholder}
              renderSegment={renderSegment}
              renderText={renderText}
              runtimeId={runtimeId}
              zeroWidth={zeroWidth}
            />
          ))}
    </EditableDOMRoot>
  )
}

export const EditableTextBlocks = <
  T,
  TElement extends SlateElementNode = SlateElementNode,
>({
  editor,
  projectionStore = null,
  ...props
}: EditableTextBlocksProps<T, TElement>) => {
  const content = <EditableTextBlocksInner {...props} />

  if (!editor) {
    return content
  }

  return (
    <Slate editor={editor} projectionStore={projectionStore}>
      {content}
    </Slate>
  )
}
