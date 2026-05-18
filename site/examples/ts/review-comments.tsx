import { css } from '@emotion/css'
import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from 'react'
import type { Bookmark, Editor, Range, Value } from 'slate'
import {
  Editable,
  type react,
  Slate,
  type SlateAnnotationStore,
  useEditorSelection,
  useSlateAnnotationStore,
  useSlateAnnotations,
  useSlateEditor,
  useSlateWidgetStore,
  useSlateWidgets,
} from 'slate-react'

import { Instruction } from './components'

type CommentTone = 'question' | 'review'

type CommentThread = {
  anchor: Bookmark
  body: string
  id: string
  label: string
  tone: CommentTone
}

type CommentData = {
  body: string
  label: string
  tone: CommentTone
}

type CommentProjection = {
  tone: CommentTone
}

type CommentEditor = Editor<Value, readonly [ReturnType<typeof react>]>

const initialValue: Value = [
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
        text: 'Select text in comment mode, add a comment, then edit the document to watch the anchor, inline highlight, sidebar, and widget stay in sync.',
      },
    ],
  },
]

const panelCss = css`
  max-width: 1180px;
  margin: 40px auto;
  padding: 0 24px 48px;
`

const proofGridCss = css`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin: 18px 0;

  @media (max-width: 760px) {
    grid-template-columns: 1fr;
  }
`

const proofCellCss = css`
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 10px;
  background: #f8fafc;
`

const layoutCss = css`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 18px;

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
  }
`

const paneCss = css`
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 16px;
  background: white;
`

const writerPaneCss = css`
  order: 1;
`

const commentPaneCss = css`
  order: 2;
`

const paneHeaderCss = css`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
`

const titleCss = css`
  font-size: 15px;
  font-weight: 700;
`

const mutedCss = css`
  color: #64748b;
  font-size: 13px;
`

const editorCss = css`
  min-height: 138px;
  padding: 12px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
`

const controlsCss = css`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 12px 0 0;
`

const buttonCss = css`
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #ffffff;
  color: #111827;
  cursor: pointer;
  font-weight: 600;
  padding: 8px 10px;

  &:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }
`

const codeCss = css`
  display: inline-flex;
  width: fit-content;
  padding: 3px 7px;
  border-radius: 6px;
  background: #111827;
  color: white;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
`

const sidebarCss = css`
  margin-top: 14px;
  display: grid;
  gap: 8px;
`

const commentCardCss = css`
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 10px;
  display: grid;
  gap: 8px;
`

const widgetRowCss = css`
  display: flex;
  flex-wrap: wrap;
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

const cloneValue = (value: Value): Value =>
  JSON.parse(JSON.stringify(value)) as Value

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

const createCommentAnnotations = (comments: readonly CommentThread[]) =>
  comments.map((comment) => ({
    anchor: comment.anchor,
    data: {
      body: comment.body,
      label: comment.label,
      tone: comment.tone,
    },
    id: comment.id,
    projection: {
      tone: comment.tone,
    },
  }))

const CommentedEditable = ({
  id,
  readOnly = false,
}: {
  id: string
  readOnly?: boolean
}) => (
  <Editable
    className={editorCss}
    id={id}
    readOnly={readOnly}
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
  />
)

const WriterPane = ({ editor }: { editor: CommentEditor }) => {
  const selection = useEditorSelection()
  const annotationSnapshot = useSlateAnnotations<
    CommentData,
    CommentProjection
  >()
  const firstAnnotation =
    annotationSnapshot.allIds[0] == null
      ? null
      : (annotationSnapshot.byId.get(annotationSnapshot.allIds[0]) ?? null)

  const insertPrefixBeforeFirstComment = () => {
    if (!firstAnnotation?.range) {
      return
    }

    const path = firstAnnotation.range.anchor.path

    editor.update((tx) => {
      tx.text.insert('>', {
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

    editor.update((tx) => {
      tx.selection.set({
        anchor: at,
        focus: at,
      })
      tx.nodes.insert(
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
    <div className={`${paneCss} ${writerPaneCss}`}>
      <div className={paneHeaderCss}>
        <span className={titleCss}>Edit mode</span>
        <span className={mutedCss}>document writes enabled</span>
      </div>
      <CommentedEditable id="review-comments-document" />
      <div className={controlsCss}>
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
        <span className={codeCss}>selection:{formatRange(selection)}</span>
      </div>
    </div>
  )
}

const CommentModePane = ({
  annotationStore,
  comments,
  editor,
  onCommentWrite,
  setComments,
  writerEditor,
}: {
  annotationStore: SlateAnnotationStore<CommentData, CommentProjection>
  comments: readonly CommentThread[]
  editor: CommentEditor
  onCommentWrite: () => void
  setComments: Dispatch<SetStateAction<CommentThread[]>>
  writerEditor: CommentEditor
}) => {
  const nextCommentId = useRef(1)
  const selection = useEditorSelection()
  const annotationSnapshot = useSlateAnnotations<
    CommentData,
    CommentProjection
  >()
  const widgetStore = useSlateWidgetStore(editor, {
    annotationStore,
    deps: [comments],
    project: () =>
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
  })
  const widgetSnapshot = useSlateWidgets(widgetStore)
  const commentsRef = useRef(comments)

  useEffect(() => {
    commentsRef.current = comments
  }, [comments])

  useEffect(() => {
    return () => {
      commentsRef.current.forEach((comment) => {
        comment.anchor.unref()
      })
    }
  }, [])

  const createComment = (range: Range) => {
    const id = `comment-${nextCommentId.current}`
    const tone: CommentTone =
      nextCommentId.current % 2 === 0 ? 'question' : 'review'
    const snippet =
      writerEditor
        .read((state) => state.text.string(range))
        .replace(/\s+/g, ' ')
        .trim() || 'selection'
    const anchor = writerEditor.read((state) => state.ranges.bookmark(range))

    nextCommentId.current += 1
    onCommentWrite()
    setComments((current) => [
      ...current,
      {
        anchor,
        body: `Discuss: ${snippet.slice(0, 56)}`,
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
    onCommentWrite()
    setComments((current) => {
      const target = current.find((comment) => comment.id === id)

      target?.anchor.unref()

      return current.filter((comment) => comment.id !== id)
    })
  }

  const clearComments = () => {
    onCommentWrite()
    setComments((current) => {
      current.forEach((comment) => {
        comment.anchor.unref()
      })

      return []
    })
  }

  const retoneFirstComment = () => {
    onCommentWrite()
    setComments((current) =>
      current.map((comment, index) =>
        index === 0
          ? {
              ...comment,
              tone: comment.tone === 'review' ? 'question' : 'review',
            }
          : comment
      )
    )
  }

  return (
    <div className={`${paneCss} ${commentPaneCss}`}>
      <div className={paneHeaderCss}>
        <span className={titleCss}>Comment mode</span>
        <span className={mutedCss}>read-only document, writable comments</span>
      </div>
      <CommentedEditable id="review-comments" readOnly />
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
          disabled={comments.length === 0}
          onClick={retoneFirstComment}
          type="button"
        >
          Retone first comment
        </button>
        <button
          className={buttonCss}
          disabled={comments.length === 0}
          onClick={clearComments}
          type="button"
        >
          Clear comments
        </button>
        <span className={codeCss} id="review-comments-selection">
          selection:{formatRange(selection)}
        </span>
      </div>
      <div className={sidebarCss}>
        {annotationSnapshot.allIds.length === 0 ? (
          <span className={codeCss} id="comments-empty">
            comments:none
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
                  className={toneBadgeCss(annotation.data?.tone ?? 'review')}
                >
                  {annotation.data?.label ?? annotation.id}
                </span>
                <strong>{annotation.data?.body}</strong>
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
        <div className={widgetRowCss}>
          {widgetSnapshot.allIds.length === 0 ? (
            <span className={codeCss} id="widgets-empty">
              widgets:none
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
  )
}

const ReviewCommentsExample = () => {
  const writerEditor = useSlateEditor<Value>({
    initialSelection: {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    },
    initialValue: cloneValue(initialValue),
  })
  const commentEditor = useSlateEditor<Value>({
    initialSelection: {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    },
    initialValue: cloneValue(initialValue),
  })
  const [comments, setComments] = useState<CommentThread[]>([])
  const [documentWrites, setDocumentWrites] = useState(0)
  const [commentWrites, setCommentWrites] = useState(0)
  const writerAnnotationStore = useSlateAnnotationStore<
    CommentData,
    CommentProjection
  >(writerEditor, {
    deps: [comments],
    project: () => createCommentAnnotations(comments),
  })
  const commentAnnotationStore = useSlateAnnotationStore<
    CommentData,
    CommentProjection
  >(commentEditor, {
    deps: [comments],
    project: () => createCommentAnnotations(comments),
  })

  const syncCommentModeFromDocument = (value: Value) => {
    commentEditor.update((tx) => {
      tx.value.replace({
        children: cloneValue(value),
        selection: null,
      })
    })
  }

  const handleWriterValueChange = (value: Value) => {
    setDocumentWrites((count) => count + 1)
    syncCommentModeFromDocument(value)
  }

  return (
    <div className={panelCss}>
      <Instruction>
        Edit mode owns document writes. Comment mode renders the same document
        read-only, creates bookmark-backed comments, and writes only to the
        external comment channel.
      </Instruction>
      <div className={proofGridCss}>
        <div className={proofCellCss}>
          <strong>document writes</strong>
          <br />
          <span className={codeCss} id="review-comments-document-writes">
            {documentWrites}
          </span>
        </div>
        <div className={proofCellCss}>
          <strong>comment writes</strong>
          <br />
          <span className={codeCss} id="review-comments-comment-writes">
            {commentWrites}
          </span>
        </div>
        <div className={proofCellCss}>
          <strong>comment-mode document writes</strong>
          <br />
          <span
            className={codeCss}
            id="review-comments-comment-mode-document-writes"
          >
            0
          </span>
        </div>
      </div>
      <div className={layoutCss}>
        <Slate annotationStore={commentAnnotationStore} editor={commentEditor}>
          <CommentModePane
            annotationStore={commentAnnotationStore}
            comments={comments}
            editor={commentEditor}
            onCommentWrite={() => setCommentWrites((count) => count + 1)}
            setComments={setComments}
            writerEditor={writerEditor}
          />
        </Slate>
        <Slate
          annotationStore={writerAnnotationStore}
          editor={writerEditor}
          onValueChange={handleWriterValueChange}
        >
          <WriterPane editor={writerEditor} />
        </Slate>
      </div>
    </div>
  )
}

export default ReviewCommentsExample
