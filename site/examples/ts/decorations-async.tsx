import { css } from '@emotion/css'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type Ancestor,
  type Descendant,
  NodeApi,
  type Path,
  type Range,
} from 'slate'
import {
  Editable,
  type EditableDecorate,
  Slate,
  type SlateDecoration,
  useSlateDecorationSource,
  useSlateEditor,
} from 'slate-react'

type AsyncHighlightData = {
  asyncHighlight: true
}

const INITIAL_TEXT = 'This is some text here about. there'
const ASYNC_DECORATION_DELAY_MS = 500
const searchParams =
  typeof document === 'undefined'
    ? null
    : new URLSearchParams(document.location.search)
const decorationMode = searchParams?.get('source') === 'hook' ? 'hook' : 'prop'

const containerCss = css`
  max-width: 760px;
  margin: 40px auto;
  padding: 0 24px 48px;
`

const titleCss = css`
  margin: 0 0 16px;
  font-size: 22px;
  font-weight: 700;
`

const statusCss = css`
  margin: 0 0 16px;
  color: #4b5563;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
`

const highlightCss = css`
  background: #fde68a;
  border-radius: 3px;
  box-decoration-break: clone;
`

const editorCss = css`
  min-height: 120px;
  padding: 16px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  line-height: 1.55;
`

const getDocumentText = (value: readonly Descendant[]) =>
  NodeApi.string({ children: value } as never)

const createRange = (path: Path, start: number, end: number): Range => ({
  anchor: { path, offset: start },
  focus: { path, offset: end },
})

const collectAsyncHighlightDecorations = (
  node: Descendant,
  path: Path,
  decoratedLength: number
) => {
  if (!NodeApi.isText(node)) {
    return []
  }

  const decorations: SlateDecoration<AsyncHighlightData>[] = []
  const pattern = /\b(?:here|there)\b/g
  let match: RegExpExecArray | null

  while ((match = pattern.exec(node.text))) {
    const start = match.index
    const end = start + match[0].length

    if (end > decoratedLength) {
      continue
    }

    decorations.push({
      data: { asyncHighlight: true },
      key: `async-highlight:${path.join('.')}:${start}:${end}`,
      range: createRange(path, start, end),
    })
  }

  return decorations
}

const AsyncDecorationsExample = () => {
  const editor = useSlateEditor({
    initialValue: [
      {
        type: 'paragraph',
        children: [{ text: INITIAL_TEXT }],
      },
    ],
  })
  const [decoratedLength, setDecoratedLength] = useState(INITIAL_TEXT.length)
  const timeoutRef = useRef<number | null>(null)

  const decorate = useCallback<EditableDecorate<AsyncHighlightData>>(
    ([node, path]) =>
      collectAsyncHighlightDecorations(node, path, decoratedLength),
    [decoratedLength]
  )
  const hookDecorationSource = useSlateDecorationSource<AsyncHighlightData>(
    editor,
    {
      deps: [decoratedLength],
      id: 'async-decoration-hook',
      read: ({ snapshot }) => {
        const root = { children: snapshot.children } as Ancestor
        const decorations: SlateDecoration<AsyncHighlightData>[] = []

        for (const [node, path] of NodeApi.nodes(root)) {
          if (path.length === 0) {
            continue
          }

          decorations.push(
            ...collectAsyncHighlightDecorations(
              node as Descendant,
              path,
              decoratedLength
            )
          )
        }

        return decorations
      },
    }
  )

  const scheduleAsyncDecorations = useCallback(
    (value: readonly Descendant[]) => {
      const nextLength = getDocumentText(value).length

      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current)
      }

      timeoutRef.current = window.setTimeout(() => {
        setDecoratedLength(nextLength)
        timeoutRef.current = null
      }, ASYNC_DECORATION_DELAY_MS)
    },
    []
  )

  useEffect(
    () => () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current)
      }
    },
    []
  )

  return (
    <div className={containerCss}>
      <h1 className={`example-page-title ${titleCss}`}>Async Decorations</h1>
      <div className={statusCss} data-testid="async-decoration-status">
        decorated-length:{decoratedLength}
      </div>
      <Slate
        decorationSources={
          decorationMode === 'hook' ? [hookDecorationSource] : undefined
        }
        editor={editor}
        onValueChange={scheduleAsyncDecorations}
      >
        <Editable
          className={editorCss}
          decorate={decorationMode === 'prop' ? decorate : undefined}
          id="decorations-async"
          renderSegment={(segment, children) =>
            segment.slices.some(
              (slice) =>
                (slice.data as AsyncHighlightData | undefined)?.asyncHighlight
            ) ? (
              <span
                className={highlightCss}
                data-cy="async-decoration-highlight"
              >
                {children}
              </span>
            ) : (
              children
            )
          }
        />
      </Slate>
    </div>
  )
}

export default AsyncDecorationsExample
