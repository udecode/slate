import React, {
  type CSSProperties,
  type ReactNode,
  type Ref,
  useCallback,
} from 'react'
import type { Path, RuntimeId, Text as SlateTextNode } from 'slate'
import {
  type DOMTextSyncOptOutReason,
  getDOMTextSyncCapability,
} from '../dom-text-sync'
import { Editor } from '../editable/runtime-editor-api'
import { useEditor } from '../hooks/use-editor'
import {
  type EditorTextSelectorContext,
  useMountedTextRenderSelector,
} from '../hooks/use-node-selector'
import { useSlateNodeRef } from '../hooks/use-slate-node-ref'
import { useSlateProjections } from '../hooks/use-slate-projections'
import type { SlateProjectionSlice } from '../projection-store'
import { SlateLeaf } from './slate-leaf'
import { getSlatePlaceholderStyle, SlatePlaceholder } from './slate-placeholder'
import { SlateText } from './slate-text'
import { TextString } from './text-string'
import { ZeroWidthString } from './zero-width-string'

const EMPTY_MARKS: Omit<SlateTextNode, 'text'> = {}
const EMPTY_BOUND_TEXT = Object.freeze({
  marks: EMPTY_MARKS,
  path: null,
  runtimeId: null,
  slateNode: null,
  text: '',
}) as {
  marks: Omit<SlateTextNode, 'text'>
  path: Path | null
  runtimeId: RuntimeId | null
  slateNode: SlateTextNode | null
  text: string
}

type IntrinsicTag = keyof HTMLElementTagNameMap

const sameMarks = (
  left: Omit<SlateTextNode, 'text'>,
  right: Omit<SlateTextNode, 'text'>
) => {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)

  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) =>
      Object.is(
        (left as Record<string, unknown>)[key],
        (right as Record<string, unknown>)[key]
      )
    )
  )
}

const samePath = (left: Path | null, right: Path | null) =>
  left === right ||
  (left != null &&
    right != null &&
    left.length === right.length &&
    left.every((part, index) => part === right[index]))

const sameBoundText = (
  left: {
    marks: Omit<SlateTextNode, 'text'>
    path: Path | null
    runtimeId: RuntimeId | null
    slateNode: SlateTextNode | null
    text: string
  } | null,
  right: {
    marks: Omit<SlateTextNode, 'text'>
    path: Path | null
    runtimeId: RuntimeId | null
    slateNode: SlateTextNode | null
    text: string
  }
) =>
  left != null &&
  left.slateNode === right.slateNode &&
  left.runtimeId === right.runtimeId &&
  left.text === right.text &&
  samePath(left.path, right.path) &&
  sameMarks(left.marks, right.marks)

export type EditableTextSegment<T = unknown> = {
  end: number
  marks: Omit<SlateTextNode, 'text'>
  slices: readonly SlateProjectionSlice<T>[]
  start: number
  text: string
}

export type EditableTextLeafProps<T = unknown> = {
  attributes: {
    'data-slate-leaf': true
  }
  children: ReactNode
  leaf: SlateTextNode
  leafPosition?: {
    end: number
    isFirst?: true
    isLast?: true
    start: number
  }
  segment: EditableTextSegment<T>
  text: SlateTextNode
}

export type EditableTextRenderTextProps = {
  attributes: {
    'data-slate-node': 'text'
    'data-slate-dom-sync-reason'?: DOMTextSyncOptOutReason
    'data-slate-path'?: string
    'data-slate-runtime-id'?: RuntimeId
    ref?: Ref<HTMLSpanElement>
  }
  children: ReactNode
  text: SlateTextNode
}

export type EditableTextRenderPlaceholderProps = {
  attributes: {
    'aria-hidden': true
    'data-slate-placeholder': true
    contentEditable: false
    dir?: 'rtl'
    ref: React.RefCallback<HTMLElement>
    style: CSSProperties
  }
  children: ReactNode
}

const splitTextByProjections = <T,>(
  text: string,
  slices: readonly SlateProjectionSlice<T>[],
  marks: Omit<SlateTextNode, 'text'>
): EditableTextSegment<T>[] => {
  const zeroLengthSlices = slices.filter((slice) => slice.start === slice.end)
  const rangedSlices = slices.filter((slice) => slice.start !== slice.end)

  if (text.length === 0 && zeroLengthSlices.length === 0) {
    return []
  }

  if (rangedSlices.length === 0 && zeroLengthSlices.length === 0) {
    return [
      {
        end: text.length,
        marks,
        slices: [],
        start: 0,
        text,
      },
    ]
  }

  const boundaries = new Set<number>([0, text.length])

  rangedSlices.forEach((slice) => {
    boundaries.add(Math.max(0, Math.min(text.length, slice.start)))
    boundaries.add(Math.max(0, Math.min(text.length, slice.end)))
  })

  const sorted = Array.from(boundaries).sort((left, right) => left - right)
  const segments: EditableTextSegment<T>[] = []

  const pushZeroLengthSegmentsAt = (offset: number) => {
    zeroLengthSlices
      .filter((slice) => slice.start === offset)
      .forEach((slice) => {
        segments.push({
          end: offset,
          marks,
          slices: [slice],
          start: offset,
          text: '',
        })
      })
  }

  pushZeroLengthSegmentsAt(0)

  for (let index = 0; index < sorted.length - 1; index += 1) {
    const start = sorted[index]!
    const end = sorted[index + 1]!

    if (start === end) {
      continue
    }

    segments.push({
      end,
      marks,
      slices: rangedSlices.filter(
        (slice) => slice.start < end && slice.end > start
      ),
      start,
      text: text.slice(start, end),
    })

    pushZeroLengthSegmentsAt(end)
  }

  return segments
}

const getTextMarks = (
  node: SlateTextNode | null
): Omit<SlateTextNode, 'text'> => {
  if (!node) {
    return EMPTY_MARKS
  }

  const { text: _text, ...nextMarks } = node
  return nextMarks
}

type EditableTextProps<T = unknown> = {
  marks?: Omit<SlateTextNode, 'text'>
  path?: Path
  placeholder?: ReactNode
  placeholderAs?: IntrinsicTag
  placeholderDir?: 'rtl'
  placeholderRef?: React.RefCallback<HTMLElement>
  placeholderStyle?: CSSProperties
  ref?: Ref<HTMLSpanElement>
  renderLeaf?: (props: EditableTextLeafProps<T>) => ReactNode
  renderPlaceholder?: (props: EditableTextRenderPlaceholderProps) => ReactNode
  renderSegment?: (
    segment: EditableTextSegment<T>,
    children: ReactNode
  ) => ReactNode
  renderText?: (props: EditableTextRenderTextProps) => ReactNode
  runtimeId?: RuntimeId | null
  slateNode?: SlateTextNode | null
  text?: string
  zeroWidth?: {
    includeSentinel?: boolean
    isLineBreak?: boolean
    isMarkPlaceholder?: boolean
    length?: number
  }
}

const assignRef = (
  ref: Ref<HTMLSpanElement> | undefined,
  node: HTMLSpanElement | null
) => {
  if (typeof ref === 'function') {
    ref(node)
    return
  }

  if (ref) {
    ref.current = node
  }
}

const RenderEditableText = <T,>({
  placeholder,
  placeholderAs,
  placeholderDir,
  placeholderRef,
  placeholderStyle,
  path,
  projections,
  ref: textRef,
  renderLeaf,
  renderPlaceholder,
  renderSegment,
  renderText,
  resolvedMarks,
  resolvedText,
  runtimeId,
  zeroWidth,
}: EditableTextProps<T> & {
  projections: readonly SlateProjectionSlice<T>[]
  resolvedMarks: Omit<SlateTextNode, 'text'>
  resolvedText: string
}) => {
  const hasText = resolvedText.length > 0
  const domTextSync = getDOMTextSyncCapability({
    hasText,
    projections,
    renderLeaf,
    renderSegment,
    renderText,
  })
  const segments =
    hasText || projections.some((slice) => slice.start === slice.end)
      ? splitTextByProjections(resolvedText, projections, resolvedMarks)
      : []

  const leafAttributes = {
    'data-slate-leaf': true as const,
  }
  const textNode = {
    text: resolvedText,
    ...resolvedMarks,
  }
  const textAttributes = {
    'data-slate-dom-sync-reason': domTextSync.reason ?? undefined,
    'data-slate-node': 'text' as const,
    'data-slate-path': path ? path.join(',') : undefined,
    'data-slate-runtime-id': runtimeId ?? undefined,
    ref: textRef,
  }
  const placeholderAttributes = {
    'aria-hidden': true as const,
    'data-slate-placeholder': true as const,
    contentEditable: false as const,
    dir: placeholderDir,
    ref: placeholderRef ?? (() => {}),
    style: getSlatePlaceholderStyle(placeholderStyle),
  }

  const content =
    hasText || segments.some((segment) => segment.text.length === 0)
      ? segments.map((segment, index) => {
          const baseContent =
            segment.text.length === 0 ? (
              <ZeroWidthString isMarkPlaceholder />
            ) : (
              <TextString text={segment.text} />
            )
          const segmentContent = renderSegment
            ? renderSegment(segment, baseContent)
            : baseContent
          const leafNode = {
            text: segment.text,
            ...segment.marks,
          }
          const leafPosition =
            segments.length > 1
              ? {
                  end: segment.end,
                  isFirst: index === 0 ? (true as const) : undefined,
                  isLast:
                    index === segments.length - 1 ? (true as const) : undefined,
                  start: segment.start,
                }
              : undefined

          return (
            <React.Fragment key={`${segment.start}:${segment.end}:${index}`}>
              {renderLeaf ? (
                renderLeaf({
                  attributes: leafAttributes,
                  children: segmentContent,
                  leaf: leafNode,
                  leafPosition,
                  segment,
                  text: textNode,
                })
              ) : (
                <SlateLeaf>{segmentContent}</SlateLeaf>
              )}
            </React.Fragment>
          )
        })
      : (() => {
          const segment: EditableTextSegment<T> = {
            end: 0,
            marks: resolvedMarks,
            slices: [],
            start: 0,
            text: '',
          }
          const placeholderNode = placeholder ? (
            renderPlaceholder ? (
              renderPlaceholder({
                attributes: placeholderAttributes,
                children: placeholder,
              })
            ) : (
              <SlatePlaceholder
                as={placeholderAs}
                dir={placeholderDir}
                ref={placeholderRef}
                style={placeholderStyle}
              >
                {placeholder}
              </SlatePlaceholder>
            )
          ) : null
          const content = (
            <>
              <ZeroWidthString
                includeSentinel={zeroWidth?.includeSentinel}
                isLineBreak={zeroWidth?.isLineBreak}
                isMarkPlaceholder={zeroWidth?.isMarkPlaceholder}
                length={zeroWidth?.length}
              />
              {placeholderNode}
            </>
          )
          const leafNode = {
            text: '',
            ...resolvedMarks,
          }

          return renderLeaf ? (
            renderLeaf({
              attributes: leafAttributes,
              children: content,
              leaf: leafNode,
              segment,
              text: textNode,
            })
          ) : (
            <SlateLeaf>{content}</SlateLeaf>
          )
        })()

  if (renderText) {
    return renderText({
      attributes: textAttributes,
      children: content,
      text: textNode,
    })
  }

  return (
    <SlateText
      domSync={domTextSync.enabled}
      domSyncReason={domTextSync.reason}
      path={path}
      ref={textRef}
      runtimeId={runtimeId}
    >
      {content}
    </SlateText>
  )
}

const BoundEditableText = <T,>({
  marks,
  path,
  ref,
  runtimeId = null,
  text,
  ...props
}: EditableTextProps<T>) => {
  const editor = useEditor()
  const selectorRuntimeId = path ? Editor.getRuntimeId(editor, path) : runtimeId
  const selectBoundText = useCallback(
    ({
      path: selectorPath,
      runtimeId: resolvedRuntimeId,
      text: node,
    }: EditorTextSelectorContext) => {
      if (!path && !runtimeId) {
        return EMPTY_BOUND_TEXT
      }

      const resolvedPath = path ?? selectorPath

      return {
        marks: marks ?? getTextMarks(node),
        path: resolvedPath,
        runtimeId: resolvedRuntimeId,
        slateNode: node,
        text: text ?? node?.text ?? '',
      }
    },
    [marks, path, runtimeId, text]
  )
  const boundText = useMountedTextRenderSelector(
    selectBoundText,
    sameBoundText,
    {
      runtimeId: selectorRuntimeId,
    }
  )
  const resolvedRuntimeId = boundText.runtimeId
  const boundRef = useSlateNodeRef(resolvedRuntimeId, {
    path: boundText.path,
    slateNode: boundText.slateNode,
  })
  const projections = useSlateProjections(
    resolvedRuntimeId ?? ''
  ) as readonly SlateProjectionSlice<T>[]

  const combinedRef = useCallback(
    (node: HTMLSpanElement | null) => {
      boundRef(node)
      assignRef(ref, node)
    },
    [boundRef, ref]
  )

  return (
    <RenderEditableText
      {...props}
      path={boundText.path ?? undefined}
      projections={projections}
      ref={combinedRef}
      resolvedMarks={boundText.marks}
      resolvedText={boundText.text}
      runtimeId={resolvedRuntimeId}
    />
  )
}

const ProjectedEditableText = <T,>({
  marks = EMPTY_MARKS,
  path,
  ref,
  runtimeId = null,
  slateNode = null,
  text = '',
  ...props
}: EditableTextProps<T>) => {
  const boundRef = useSlateNodeRef(runtimeId, { path, slateNode })
  const projections = useSlateProjections(
    runtimeId ?? ''
  ) as readonly SlateProjectionSlice<T>[]

  const combinedRef = useCallback(
    (node: HTMLSpanElement | null) => {
      boundRef(node)
      assignRef(ref, node)
    },
    [boundRef, ref]
  )

  return (
    <RenderEditableText
      {...props}
      path={path}
      projections={projections}
      ref={combinedRef}
      resolvedMarks={marks}
      resolvedText={text}
      runtimeId={runtimeId}
    />
  )
}

export const EditableText = <T,>({
  path,
  ref,
  runtimeId,
  ...props
}: EditableTextProps<T>) => {
  if (runtimeId && props.text !== undefined && props.marks !== undefined) {
    return (
      <ProjectedEditableText
        {...props}
        path={path}
        ref={ref}
        runtimeId={runtimeId}
      />
    )
  }

  if (
    path ||
    (runtimeId && (props.text === undefined || props.marks === undefined))
  ) {
    return (
      <BoundEditableText
        {...props}
        path={path}
        ref={ref}
        runtimeId={runtimeId}
      />
    )
  }

  if (runtimeId) {
    return <ProjectedEditableText {...props} ref={ref} runtimeId={runtimeId} />
  }

  return (
    <RenderEditableText
      {...props}
      projections={[]}
      ref={ref}
      resolvedMarks={props.marks ?? {}}
      resolvedText={props.text ?? ''}
    />
  )
}
