import type { CSSProperties } from 'react'
import React, { useCallback } from 'react'
import type { Descendant, Path, RuntimeId } from 'slate'
import { IS_COMPOSING } from 'slate-dom'
import type {
  DOMCoverageReason,
  DOMCoverageSelectionPolicy,
} from 'slate-dom/internal'
import { DOMCoverage } from 'slate-dom/internal'
import { Editor } from '../editable/runtime-editor-api'

import { readRuntimeNode } from '../editable/runtime-live-state'
import { useEditor } from '../hooks/use-editor'
import { useIsomorphicLayoutEffect } from '../hooks/use-isomorphic-layout-effect'
import {
  classifySegmentKind,
  type RenderingStrategySegmentKind,
} from './classify-segment-kind'

const isText = (
  value: Descendant
): value is Extract<Descendant, { text: string }> =>
  typeof (value as { text?: unknown }).text === 'string'

const getDescendantText = (node: Descendant): string => {
  if (isText(node)) {
    return node.text
  }

  return node.children.map(getDescendantText).join('')
}

const truncate = (value: string, limit: number) =>
  value.length <= limit ? value : `${value.slice(0, limit - 1)}…`

const MAX_PREVIEW_LINES = 3

const shellStyle = {
  borderLeft: '2px solid rgba(148, 163, 184, 0.35)',
  contain: 'layout style paint',
  contentVisibility: 'auto',
  paddingLeft: 12,
} satisfies CSSProperties

const samePreviewRuntimeIds = (
  left: readonly RuntimeId[],
  right: readonly RuntimeId[]
) => {
  if (left.length !== right.length) return false

  for (let index = 0; index < MAX_PREVIEW_LINES; index += 1) {
    if (left[index] !== right[index]) return false
  }

  return true
}

export const RenderingStrategySegmentShell = React.memo(
  ({
    coverageReason = 'shell-aggressive',
    endIndex,
    segmentIndex,
    onPromote,
    previewChars,
    runtimeIds,
    startIndex,
  }: {
    coverageReason?: Extract<
      DOMCoverageReason,
      'shell-aggressive' | 'viewport-virtualization'
    >
    endIndex: number
    segmentIndex: number
    onPromote?: (segmentIndex: number, options?: { select?: boolean }) => void
    previewChars: number
    runtimeIds: readonly RuntimeId[]
    startIndex: number
  }) => {
    const editor = useEditor()
    const previewRuntimeIds = runtimeIds.slice(0, MAX_PREVIEW_LINES)
    const lines: string[] = []
    const nodes: Descendant[] = []
    const boundaryId = `${coverageReason}:${segmentIndex}`
    const anchorRuntimeId = runtimeIds[0] ?? null
    const focusRuntimeId = runtimeIds.at(-1) ?? null
    const selectionPolicy: DOMCoverageSelectionPolicy =
      coverageReason === 'viewport-virtualization'
        ? 'materialize'
        : 'model-backed'
    const boundary = React.useMemo(
      () => ({
        anchor: { type: 'placeholder' as const },
        boundaryId,
        copyPolicy: 'include-model' as const,
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
        reason: coverageReason,
        selectionPolicy,
        state: 'virtualized' as const,
        version: 1,
      }),
      [
        anchorRuntimeId,
        boundaryId,
        coverageReason,
        endIndex,
        focusRuntimeId,
        selectionPolicy,
        startIndex,
      ]
    )

    useIsomorphicLayoutEffect(
      () => DOMCoverage.registerBoundary(editor, boundary),
      [boundary, editor]
    )

    previewRuntimeIds.forEach((runtimeId) => {
      const snapshot = Editor.getSnapshot(editor)
      const path =
        Editor.getPathByRuntimeId(editor, runtimeId) ??
        snapshot.index.idToPath[runtimeId]

      if (!path || !Editor.hasPath(editor, path)) {
        return
      }

      const node =
        (readRuntimeNode(editor, path) as Descendant | undefined) ??
        (editor.read((state) => state.nodes.get(path))[0] as Descendant)

      if (!node) {
        return
      }

      nodes.push(node)
      lines.push(
        truncate(getDescendantText(node).replace(/\uFEFF/g, ''), previewChars)
      )
    })

    const preview: {
      kind: RenderingStrategySegmentKind
      lines: readonly string[]
    } = {
      kind: classifySegmentKind(nodes),
      lines,
    }

    const handleMouseDown = useCallback(
      (event: React.MouseEvent<HTMLDivElement>) => {
        event.preventDefault()

        if (IS_COMPOSING.get(editor)) {
          return
        }

        onPromote?.(segmentIndex, { select: true })
        const editorElement = event.currentTarget.closest(
          '[data-slate-editor="true"]'
        ) as HTMLElement | null
        requestAnimationFrame(() => {
          editorElement?.focus()
        })
      },
      [editor, segmentIndex, onPromote]
    )

    const handleKeyDown = useCallback(
      (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
          return
        }

        event.preventDefault()

        if (IS_COMPOSING.get(editor)) {
          return
        }

        onPromote?.(segmentIndex, { select: true })
        const editorElement = event.currentTarget.closest(
          '[data-slate-editor="true"]'
        ) as HTMLElement | null
        requestAnimationFrame(() => {
          editorElement?.focus()
        })
      },
      [editor, segmentIndex, onPromote]
    )

    const firstLine = preview.lines[0]
    const label = firstLine
      ? `Open document section ${segmentIndex + 1}: ${firstLine}`
      : `Open document section ${segmentIndex + 1}`

    return (
      <div
        aria-expanded={false}
        aria-label={label}
        contentEditable={false}
        data-slate-dom-coverage-boundary={boundaryId}
        data-slate-dom-coverage-edge="owner"
        data-slate-rendering-strategy-kind={preview.kind}
        data-slate-rendering-strategy-segment={String(segmentIndex)}
        data-slate-rendering-strategy-shell="true"
        onKeyDown={handleKeyDown}
        onMouseDown={handleMouseDown}
        role="button"
        style={{
          ...shellStyle,
          containIntrinsicSize: `${Math.max(runtimeIds.length, 1) * 28}px`,
        }}
        tabIndex={0}
      >
        {preview.lines.map((line, index) => (
          <div
            data-slate-rendering-strategy-line="true"
            key={`${previewRuntimeIds[index] ?? segmentIndex}-${index}`}
          >
            {line || '\u00A0'}
          </div>
        ))}
      </div>
    )
  },
  (prev, next) =>
    prev.segmentIndex === next.segmentIndex &&
    prev.onPromote === next.onPromote &&
    prev.previewChars === next.previewChars &&
    samePreviewRuntimeIds(prev.runtimeIds, next.runtimeIds)
)
