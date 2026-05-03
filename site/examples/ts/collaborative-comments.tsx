import { css } from '@emotion/css'
import { useMemo, useRef, useState } from 'react'
import { type Bookmark, createEditor, type Range, type Value } from 'slate'
import {
  Editable,
  type ReactEditor,
  Slate,
  type SlateAnnotationStore,
  useEditorSelection,
  useSlateAnnotationStore,
  useSlateAnnotations,
  withReact,
} from 'slate-react'

import { Instruction } from './components'

type CommentStatus = 'open' | 'resolved'
type CommentTone = 'question' | 'review'

type CommentThread = {
  anchor: Bookmark
  body: string
  id: string
  label: string
  status: CommentStatus
  tone: CommentTone
}

type CommentData = {
  body: string
  label: string
  status: CommentStatus
  tone: CommentTone
}

type CommentProjection = {
  status: CommentStatus
  tone: CommentTone
}

const initialChildren: Value = [
  {
    type: 'paragraph',
    children: [
      {
        text: 'The writer owns this document channel. A reviewer can select the mirrored text on the right and create comments without document write permission.',
      },
    ],
  },
  {
    type: 'paragraph',
    children: [
      {
        text: 'Create a comment from the reviewer pane, then edit from the writer pane. The annotation channel keeps the highlight and sidebar attached to the moved text.',
      },
    ],
  },
]

const panelCss = css`
  max-width: 1180px;
  margin: 40px auto;
  padding: 0 24px 48px;
`

const laneGridCss = css`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 18px;

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
  }
`

const laneCss = css`
  border: 1px solid #d8dee4;
  border-radius: 8px;
  background: white;
  padding: 16px;
`

const laneHeaderCss = css`
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

const buttonRowCss = css`
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

const commentBackground = (
  tone: CommentTone,
  status: CommentStatus,
  overlapCount: number
) => ({
  backgroundColor:
    status === 'resolved'
      ? '#e2e8f0'
      : tone === 'question'
        ? '#dbeafe'
        : '#fef3c7',
  borderRadius: 4,
  boxShadow:
    overlapCount > 1
      ? 'inset 0 -2px 0 rgba(37, 99, 235, 0.8)'
      : 'inset 0 -2px 0 rgba(15, 23, 42, 0.18)',
})

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

const createCommentAnnotations = (comments: readonly CommentThread[]) =>
  comments.map((comment) => ({
    anchor: comment.anchor,
    data: {
      body: comment.body,
      label: comment.label,
      status: comment.status,
      tone: comment.tone,
    },
    id: comment.id,
    projection: {
      status: comment.status,
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
              status?: CommentStatus
              tone?: CommentTone
            }
          | undefined) ?? null

      return (
        <span
          data-comment-count={String(segment.slices.length)}
          data-comment-status={firstSlice?.status ?? 'open'}
          data-comment-tone={firstSlice?.tone ?? 'review'}
          style={commentBackground(
            firstSlice?.tone ?? 'review',
            firstSlice?.status ?? 'open',
            segment.slices.length
          )}
        >
          {children}
        </span>
      )
    }}
  />
)

const CommentList = ({
  annotationStore,
  onResolve,
  onUpdateBody,
}: {
  annotationStore: SlateAnnotationStore<CommentData, CommentProjection>
  onResolve?: (id: string) => void
  onUpdateBody?: (id: string) => void
}) => {
  const snapshot = useSlateAnnotations(annotationStore)

  return (
    <div className={sidebarCss}>
      {snapshot.allIds.length === 0 ? (
        <span className={codeCss}>comments:none</span>
      ) : (
        snapshot.allIds.map((id) => {
          const annotation = snapshot.byId.get(id)!

          return (
            <div className={commentCardCss} key={annotation.id}>
              <strong>
                {annotation.data?.label} - {annotation.data?.status}
              </strong>
              <span>{annotation.data?.body}</span>
              <span className={codeCss}>
                range:{formatRange(annotation.range)}
              </span>
              <div className={buttonRowCss}>
                {onUpdateBody ? (
                  <button
                    className={buttonCss}
                    onClick={() => onUpdateBody(annotation.id)}
                    type="button"
                  >
                    Update body
                  </button>
                ) : null}
                {onResolve ? (
                  <button
                    className={buttonCss}
                    onClick={() => onResolve(annotation.id)}
                    type="button"
                  >
                    Toggle resolved
                  </button>
                ) : null}
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}

const WriterPane = ({
  annotationStore,
  editor,
}: {
  annotationStore: SlateAnnotationStore<CommentData, CommentProjection>
  editor: ReactEditor
}) => {
  const snapshot = useSlateAnnotations(annotationStore)
  const firstAnnotation =
    snapshot.allIds[0] == null
      ? null
      : (snapshot.byId.get(snapshot.allIds[0]) ?? null)

  const insertPrefix = () => {
    const path = firstAnnotation?.range?.anchor.path ?? [0, 0]

    editor.update((tx) => {
      tx.text.insert('>', {
        at: {
          offset: 0,
          path,
        },
      })
    })
  }

  return (
    <div className={laneCss}>
      <div className={laneHeaderCss}>
        <span className={titleCss}>Writer</span>
        <span className={mutedCss}>document channel</span>
      </div>
      <CommentedEditable id="collab-comments-writer" />
      <div className={buttonRowCss}>
        <button className={buttonCss} onClick={insertPrefix} type="button">
          Insert prefix
        </button>
      </div>
      <CommentList annotationStore={annotationStore} />
    </div>
  )
}

const ReviewerPane = ({
  annotationStore,
  comments,
  onCommentWrite,
  setComments,
  writerEditor,
}: {
  annotationStore: SlateAnnotationStore<CommentData, CommentProjection>
  comments: readonly CommentThread[]
  onCommentWrite: () => void
  setComments: React.Dispatch<React.SetStateAction<CommentThread[]>>
  writerEditor: ReactEditor
}) => {
  const nextCommentId = useRef(1)
  const selection = useEditorSelection()

  const addComment = () => {
    if (!selection || isCollapsed(selection)) {
      return
    }

    const id = `comment-${nextCommentId.current}`
    const tone: CommentTone =
      nextCommentId.current % 2 === 0 ? 'question' : 'review'
    const anchor = writerEditor.read((state) =>
      state.ranges.bookmark(selection)
    )
    const snippet =
      writerEditor
        .read((state) => state.text.string(selection))
        .replace(/\s+/g, ' ')
        .trim() || 'selection'

    nextCommentId.current += 1
    onCommentWrite()
    setComments((current) => [
      ...current,
      {
        anchor,
        body: `Reviewer note on "${snippet.slice(0, 52)}"`,
        id,
        label: `Comment ${current.length + 1}`,
        status: 'open',
        tone,
      },
    ])
  }

  const updateBody = (id: string) => {
    onCommentWrite()
    setComments((current) =>
      current.map((comment) =>
        comment.id === id
          ? {
              ...comment,
              body: `${comment.body} Updated from the comment channel.`,
            }
          : comment
      )
    )
  }

  const toggleResolved = (id: string) => {
    onCommentWrite()
    setComments((current) =>
      current.map((comment) =>
        comment.id === id
          ? {
              ...comment,
              status: comment.status === 'open' ? 'resolved' : 'open',
            }
          : comment
      )
    )
  }

  return (
    <div className={laneCss}>
      <div className={laneHeaderCss}>
        <span className={titleCss}>Reviewer</span>
        <span className={mutedCss}>read-only document, writable comments</span>
      </div>
      <CommentedEditable id="collab-comments-reviewer" readOnly />
      <div className={buttonRowCss}>
        <button
          className={buttonCss}
          disabled={isCollapsed(selection)}
          onClick={addComment}
          type="button"
        >
          Add comment
        </button>
        <span className={codeCss}>selection:{formatRange(selection)}</span>
      </div>
      <CommentList
        annotationStore={annotationStore}
        onResolve={toggleResolved}
        onUpdateBody={updateBody}
      />
      <span className={mutedCss}>external comments:{comments.length}</span>
    </div>
  )
}

const CollaborativeCommentsExample = () => {
  const [writerEditor] = useState(() => {
    const nextEditor = withReact(createEditor())

    nextEditor.update((tx) => {
      tx.value.replace({
        children: cloneValue(initialChildren),
        selection: null,
      })
    })

    return nextEditor
  })
  const [reviewerEditor] = useState(() => {
    const nextEditor = withReact(createEditor())

    nextEditor.update((tx) => {
      tx.value.replace({
        children: cloneValue(initialChildren),
        selection: null,
      })
    })

    return nextEditor
  })
  const commentsRef = useRef<readonly CommentThread[]>([])
  const [comments, setComments] = useState<CommentThread[]>([])
  const [documentWrites, setDocumentWrites] = useState(0)
  const [commentWrites, setCommentWrites] = useState(0)

  commentsRef.current = comments

  const annotations = useMemo(
    () => createCommentAnnotations(comments),
    [comments]
  )
  const writerAnnotationStore = useSlateAnnotationStore<
    CommentData,
    CommentProjection
  >(writerEditor, annotations)
  const reviewerAnnotationStore = useSlateAnnotationStore<
    CommentData,
    CommentProjection
  >(reviewerEditor, annotations)

  const syncReviewerFromDocumentChannel = (value: Value) => {
    reviewerEditor.update((tx) => {
      tx.value.replace({
        children: cloneValue(value),
        selection: null,
      })
    })
  }

  const handleWriterValueChange = (value: Value) => {
    setDocumentWrites((count) => count + 1)
    syncReviewerFromDocumentChannel(value)
  }

  return (
    <div className={panelCss}>
      <Instruction>
        Writer edits flow through the document channel. Reviewer actions only
        change the external annotation channel, while both editors render the
        same resolved anchors.
      </Instruction>
      <div className={proofGridCss}>
        <div className={proofCellCss}>
          <strong>document writes</strong>
          <br />
          <span className={codeCss} id="collab-comments-document-writes">
            {documentWrites}
          </span>
        </div>
        <div className={proofCellCss}>
          <strong>comment writes</strong>
          <br />
          <span className={codeCss} id="collab-comments-comment-writes">
            {commentWrites}
          </span>
        </div>
        <div className={proofCellCss}>
          <strong>reviewer document writes</strong>
          <br />
          <span
            className={codeCss}
            id="collab-comments-reviewer-document-writes"
          >
            0
          </span>
        </div>
      </div>
      <div className={laneGridCss}>
        <Slate
          annotationStores={[writerAnnotationStore]}
          editor={writerEditor}
          onValueChange={handleWriterValueChange}
        >
          <WriterPane
            annotationStore={writerAnnotationStore}
            editor={writerEditor}
          />
        </Slate>
        <Slate
          annotationStores={[reviewerAnnotationStore]}
          editor={reviewerEditor}
        >
          <ReviewerPane
            annotationStore={reviewerAnnotationStore}
            comments={comments}
            onCommentWrite={() => setCommentWrites((count) => count + 1)}
            setComments={setComments}
            writerEditor={writerEditor}
          />
        </Slate>
      </div>
    </div>
  )
}

export default CollaborativeCommentsExample
