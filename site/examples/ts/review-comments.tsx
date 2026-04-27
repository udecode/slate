import { css } from '@emotion/css'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  type Bookmark,
  createEditor,
  Editor,
  type Range,
  type Value,
} from 'slate'
import {
  Editable,
  type ReactEditor,
  Slate,
  useSlateAnnotationStore,
  useSlateAnnotations,
  useSlateSelection,
  useSlateWidgetStore,
  useSlateWidgets,
  withReact,
} from 'slate-react'

import { Instruction } from './components'

type CommentTone = 'question' | 'review'

type CommentThread = {
  body: string
  bookmark: Bookmark
  id: string
  label: string
  tone: CommentTone
}

const initialChildren: Value = [
  {
    type: 'paragraph',
    children: [
      {
        text: 'Review comments in Slate v2 ride bookmark-backed annotations instead of trying to smuggle durable state through decorate.',
      },
    ],
  },
  {
    type: 'paragraph',
    children: [
      {
        text: 'Select text, add a comment, then insert content before it to watch the anchor, inline highlight, sidebar state, and widget lane stay in sync.',
      },
    ],
  },
]

const panelCss = css`
  max-width: 1040px;
  margin: 40px auto;
  padding: 0 24px 48px;
`

const controlsCss = css`
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin: 0 0 16px;
`

const buttonCss = css`
  border: 1px solid #d1d5db;
  background: white;
  padding: 10px 14px;
  border-radius: 10px;
  cursor: pointer;
  font-weight: 600;

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
`

const layoutCss = css`
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 20px;

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
  }
`

const editorPanelCss = css`
  border: 1px solid #e5e7eb;
  border-radius: 16px;
  padding: 18px;
  background: white;
`

const sidebarCss = css`
  display: grid;
  gap: 12px;
  align-content: start;
`

const sidebarPanelCss = css`
  border: 1px solid #e5e7eb;
  border-radius: 16px;
  padding: 16px;
  background: white;
`

const codeCss = css`
  padding: 3px 8px;
  border-radius: 999px;
  background: #111827;
  color: white;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
`

const widgetRowCss = css`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
`

const commentCardCss = css`
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 12px;
  display: grid;
  gap: 8px;
`

const toneBadgeCss = (tone: CommentTone) => css`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: fit-content;
  padding: 3px 8px;
  border-radius: 999px;
  background: ${tone === 'question' ? '#dbeafe' : '#fef3c7'};
  color: ${tone === 'question' ? '#1d4ed8' : '#92400e'};
  font-size: 13px;
  font-weight: 700;
`

const selectionOutlineCss = css`
  margin-top: 14px;
`

const isCollapsed = (range: Range | null) =>
  !range ||
  (range.anchor.path.join('.') === range.focus.path.join('.') &&
    range.anchor.offset === range.focus.offset)

const formatRange = (range: Range | null) =>
  range
    ? `${range.anchor.path.join('.')}:${range.anchor.offset}|${range.focus.path.join('.')}:${range.focus.offset}`
    : 'none'

const commentBackground = (tone: CommentTone, overlapCount: number) => ({
  backgroundColor: tone === 'question' ? '#dbeafe' : '#fef3c7',
  borderRadius: 4,
  boxShadow:
    overlapCount > 1
      ? 'inset 0 -2px 0 rgba(234, 88, 12, 0.85)'
      : 'inset 0 -2px 0 rgba(0, 0, 0, 0.08)',
})

const ReviewCommentsContent = ({
  comments,
  editor,
  setComments,
}: {
  comments: readonly CommentThread[]
  editor: ReactEditor
  setComments: React.Dispatch<React.SetStateAction<CommentThread[]>>
}) => {
  const nextCommentId = useRef(1)
  const selection = useSlateSelection()
  const annotations = useMemo(
    () =>
      comments.map((comment) => ({
        bookmark: comment.bookmark,
        data: comment,
        id: comment.id,
      })),
    [comments]
  )
  const annotationStore = useSlateAnnotationStore(editor, annotations)
  const annotationSnapshot = useSlateAnnotations(annotationStore)
  const widgets = useMemo(
    () =>
      comments.map((comment) => ({
        anchor: {
          annotationId: comment.id,
          type: 'annotation' as const,
        },
        data: {
          label: comment.label,
          tone: comment.tone,
        },
        id: `${comment.id}-widget`,
      })),
    [comments]
  )
  const widgetStore = useSlateWidgetStore(editor, widgets, annotationStore)
  const widgetSnapshot = useSlateWidgets(widgetStore)
  const commentsRef = useRef(comments)

  commentsRef.current = comments

  useEffect(() => {
    return () => {
      commentsRef.current.forEach((comment) => {
        comment.bookmark.unref()
      })
    }
  }, [])

  const firstAnnotation =
    annotationSnapshot.allIds[0] == null
      ? null
      : (annotationSnapshot.byId.get(annotationSnapshot.allIds[0]) ?? null)

  const createComment = (range: Range) => {
    const id = `comment-${nextCommentId.current}`
    const tone: CommentTone =
      nextCommentId.current % 2 === 0 ? 'question' : 'review'
    const snippet =
      Editor.string(editor, range).replace(/\s+/g, ' ').trim() || 'selection'
    const bookmark = Editor.bookmark(editor, range)

    nextCommentId.current += 1

    setComments((current) => [
      ...current,
      {
        body: `Discuss: ${snippet.slice(0, 56)}`,
        bookmark,
        id,
        label: `Comment ${current.length + 1}`,
        tone,
      },
    ])
  }

  const addComment = () => {
    if (!selection || isCollapsed(selection)) {
      return
    }

    createComment(selection)
  }

  const seedComment = () => {
    createComment({
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 24 },
    })
  }

  const removeComment = (id: string) => {
    setComments((current) => {
      const target = current.find((comment) => comment.id === id)

      target?.bookmark.unref()

      return current.filter((comment) => comment.id !== id)
    })
  }

  const clearComments = () => {
    setComments((current) => {
      current.forEach((comment) => {
        comment.bookmark.unref()
      })

      return []
    })
  }

  const insertPrefixBeforeFirstComment = () => {
    if (!firstAnnotation?.range) {
      return
    }

    const path = firstAnnotation.range.anchor.path

    editor.update(() => {
      editor.insertText('>', {
        at: {
          offset: 0,
          path,
        },
      })
    })
  }

  const insertParagraphBeforeFirstComment = () => {
    if (!firstAnnotation?.range) {
      return
    }

    const at = {
      offset: 0,
      path: firstAnnotation.range.anchor.path,
    }

    editor.update(() => {
      editor.select({
        anchor: at,
        focus: at,
      })
      editor.insertFragment(
        [
          {
            type: 'paragraph',
            children: [
              { text: 'Inserted review context before the first comment.' },
            ],
          },
        ],
        { at }
      )
    })
  }

  return (
    <>
      <Instruction>
        This is the feature-grade comments path: selection creates a
        <code> Bookmark</code>, the annotation store owns durable comment data,
        the projection store paints inline slices, and the widget lane exposes
        comment UI without shoving everything through one decorate callback.
      </Instruction>
      <div className={controlsCss}>
        <button
          className={buttonCss}
          disabled={isCollapsed(selection)}
          onClick={addComment}
          type="button"
        >
          Add comment on selection
        </button>
        <button className={buttonCss} onClick={seedComment} type="button">
          Seed example comment
        </button>
        <button
          className={buttonCss}
          disabled={!firstAnnotation?.range}
          onClick={insertPrefixBeforeFirstComment}
          type="button"
        >
          Insert prefix before first comment
        </button>
        <button
          className={buttonCss}
          disabled={!firstAnnotation?.range}
          onClick={insertParagraphBeforeFirstComment}
          type="button"
        >
          Insert paragraph before first comment
        </button>
        <button
          className={buttonCss}
          disabled={comments.length === 0}
          onClick={clearComments}
          type="button"
        >
          Clear comments
        </button>
      </div>
      <div className={layoutCss}>
        <div className={editorPanelCss}>
          <Editable
            editor={editor}
            id="review-comments"
            projectionStore={annotationStore.projectionStore as any}
            renderSegment={(segment, children) => {
              if (segment.slices.length === 0) {
                return children
              }

              const firstSlice =
                (segment.slices[0]?.data as
                  | {
                      tone?: CommentTone
                    }
                  | undefined) ?? null

              return (
                <span
                  data-comment-count={String(segment.slices.length)}
                  data-comment-tone={firstSlice?.tone ?? 'review'}
                  style={commentBackground(
                    firstSlice?.tone ?? 'review',
                    segment.slices.length
                  )}
                >
                  {children}
                </span>
              )
            }}
            style={{ minHeight: 120 }}
          />
          <div className={selectionOutlineCss}>
            <span className={codeCss} id="review-comments-selection">
              selection:{formatRange(selection)}
            </span>
          </div>
        </div>
        <div className={sidebarCss}>
          <div className={sidebarPanelCss}>
            <strong>Comments</strong>
            <div className={widgetRowCss}>
              {annotationSnapshot.allIds.length === 0 ? (
                <span className={codeCss} id="comments-empty">
                  none
                </span>
              ) : (
                annotationSnapshot.allIds.map((id) => {
                  const annotation = annotationSnapshot.byId.get(id)!

                  return (
                    <div
                      className={commentCardCss}
                      id={`comment-card-${annotation.id}`}
                      key={annotation.id}
                    >
                      <span
                        className={toneBadgeCss(
                          (annotation.data?.tone as CommentTone | undefined) ??
                            'review'
                        )}
                      >
                        {(annotation.data?.label as string | undefined) ??
                          annotation.id}
                      </span>
                      <strong>{annotation.data?.body as string}</strong>
                      <span className={codeCss}>
                        range:{formatRange(annotation.range)}
                      </span>
                      <button
                        className={buttonCss}
                        onClick={() => removeComment(annotation.id)}
                        type="button"
                      >
                        Remove comment
                      </button>
                    </div>
                  )
                })
              )}
            </div>
          </div>
          <div className={sidebarPanelCss}>
            <strong>Annotation-backed widgets</strong>
            <div className={widgetRowCss}>
              {widgetSnapshot.allIds.length === 0 ? (
                <span className={codeCss} id="widgets-empty">
                  none
                </span>
              ) : (
                widgetSnapshot.allIds.map((id) => {
                  const widget = widgetSnapshot.byId.get(id)!

                  return widget.visible ? (
                    <span className={codeCss} key={widget.id}>
                      {widget.id}:{widget.data?.label ?? 'none'}
                    </span>
                  ) : null
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

const ReviewCommentsExample = () => {
  const [editor] = useState(() => {
    const nextEditor = withReact(createEditor())

    Editor.replace(nextEditor, {
      children: initialChildren,
      selection: {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 0 },
      },
    })

    return nextEditor
  })
  const [comments, setComments] = useState<CommentThread[]>([])

  return (
    <Slate editor={editor}>
      <div className={panelCss}>
        <ReviewCommentsContent
          comments={comments}
          editor={editor}
          setComments={setComments}
        />
      </div>
    </Slate>
  )
}

export default ReviewCommentsExample
