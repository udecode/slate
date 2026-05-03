import type { CSSProperties } from 'react'
import React, { useCallback } from 'react'
import type { Descendant, RuntimeId } from 'slate'
import { IS_COMPOSING } from 'slate-dom'
import { Editor } from '../editable/runtime-editor-api'

import { readRuntimeNode } from '../editable/runtime-live-state'
import { useEditor } from '../hooks/use-editor'
import {
  classifyIslandKind,
  type LargeDocumentIslandKind,
} from './classify-island-kind'

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

const shellStyle: CSSProperties = {
  borderLeft: '2px solid rgba(148, 163, 184, 0.35)',
  contain: 'layout style paint',
  contentVisibility: 'auto',
  paddingLeft: 12,
}

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

export const LargeDocumentIslandShell = React.memo(
  ({
    islandIndex,
    onPromote,
    previewChars,
    runtimeIds,
  }: {
    endIndex: number
    islandIndex: number
    onPromote?: (islandIndex: number, options?: { select?: boolean }) => void
    previewChars: number
    runtimeIds: readonly RuntimeId[]
    startIndex: number
  }) => {
    const editor = useEditor()
    const previewRuntimeIds = runtimeIds.slice(0, MAX_PREVIEW_LINES)
    const lines: string[] = []
    const nodes: Descendant[] = []

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
      kind: LargeDocumentIslandKind
      lines: readonly string[]
    } = {
      kind: classifyIslandKind(nodes),
      lines,
    }

    const handleMouseDown = useCallback(
      (event: React.MouseEvent<HTMLDivElement>) => {
        event.preventDefault()

        if (IS_COMPOSING.get(editor)) {
          return
        }

        onPromote?.(islandIndex, { select: true })
        const editorElement = event.currentTarget.closest(
          '[data-slate-editor="true"]'
        ) as HTMLElement | null
        requestAnimationFrame(() => {
          editorElement?.focus()
        })
      },
      [editor, islandIndex, onPromote]
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

        onPromote?.(islandIndex, { select: true })
        const editorElement = event.currentTarget.closest(
          '[data-slate-editor="true"]'
        ) as HTMLElement | null
        requestAnimationFrame(() => {
          editorElement?.focus()
        })
      },
      [editor, islandIndex, onPromote]
    )

    const firstLine = preview.lines[0]
    const label = firstLine
      ? `Open document section ${islandIndex + 1}: ${firstLine}`
      : `Open document section ${islandIndex + 1}`

    return (
      <div
        aria-expanded={false}
        aria-label={label}
        contentEditable={false}
        data-slate-large-document-island={String(islandIndex)}
        data-slate-large-document-kind={preview.kind}
        data-slate-large-document-shell="true"
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
            data-slate-large-document-line="true"
            key={`${previewRuntimeIds[index] ?? islandIndex}-${index}`}
          >
            {line || '\u00A0'}
          </div>
        ))}
      </div>
    )
  },
  (prev, next) =>
    prev.islandIndex === next.islandIndex &&
    prev.onPromote === next.onPromote &&
    prev.previewChars === next.previewChars &&
    samePreviewRuntimeIds(prev.runtimeIds, next.runtimeIds)
)
