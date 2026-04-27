import { act, render } from '@testing-library/react'
import { createEditor, Editor } from 'slate'
import {
  createSlateAnnotationStore,
  Slate,
  type SlateAnnotation,
  useSlateAnnotationStore,
  useSlateAnnotations,
  useSlateProjections,
  useSlateStatic,
} from '../src'

const formatProjection = (
  projections: readonly {
    key: string
    start: number
    end: number
    data?: { annotationId?: string; kind?: string; tone?: string }
  }[]
) =>
  projections.length === 0
    ? 'none'
    : projections
        .map(
          (projection) =>
            `${projection.key}:${projection.start}-${projection.end}:${
              projection.data?.kind ?? 'unknown'
            }:${projection.data?.tone ?? 'none'}:${
              projection.data?.annotationId ?? 'none'
            }`
        )
        .join('|')

const formatRange = (
  range: {
    anchor: { path: number[]; offset: number }
    focus: { path: number[]; offset: number }
  } | null
) =>
  range
    ? `${range.anchor.path.join('.')}:${range.anchor.offset}|${range.focus.path.join(
        '.'
      )}:${range.focus.offset}`
    : 'none'

const createChildren = () => [
  {
    type: 'paragraph',
    children: [{ text: 'alpha' }],
  },
  {
    type: 'paragraph',
    children: [{ text: 'beta' }],
  },
]

const AnnotationOverlaySlices = ({
  annotationStore,
}: {
  annotationStore: ReturnType<
    typeof useSlateAnnotationStore<{
      kind: string
      label: string
      tone?: string
    }>
  >
}) => {
  const editor = useSlateStatic()
  const leftId = Editor.getSnapshot(editor).index.pathToId['0.0'] ?? ''
  const annotationSnapshot = useSlateAnnotations(annotationStore)
  const projections = useSlateProjections<{
    annotationId: string
    kind: string
    tone?: string
  }>(leftId)

  return (
    <>
      <span id="inline-projection">{formatProjection(projections)}</span>
      <span id="annotation-sidebar">
        {annotationSnapshot.allIds.length === 0
          ? 'none'
          : annotationSnapshot.allIds
              .map((id) => {
                const annotation = annotationSnapshot.byId.get(id)!

                return `${annotation.id}:${annotation.data?.label ?? 'none'}:${formatRange(annotation.range)}`
              })
              .join('|')}
      </span>
    </>
  )
}

const AnnotationHarness = ({
  annotations,
  editor,
}: {
  annotations: readonly SlateAnnotation<{
    kind: string
    label: string
    tone?: string
  }>[]
  editor: ReturnType<typeof createEditor>
}) => {
  const annotationStore = useSlateAnnotationStore(editor, annotations)

  return (
    <Slate
      editor={editor}
      initialValue={Editor.getSnapshot(editor).children}
      projectionStore={annotationStore.projectionStore}
    >
      <AnnotationOverlaySlices annotationStore={annotationStore} />
    </Slate>
  )
}

describe('slate-react annotation store contract', () => {
  test('one annotation entity drives inline projection and sidebar state from one store', async () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: createChildren(),
      selection: null,
    })

    const bookmark = Editor.bookmark(editor, {
      anchor: { path: [0, 0], offset: 1 },
      focus: { path: [0, 0], offset: 4 },
    })
    const annotations = [
      {
        bookmark,
        data: {
          kind: 'annotation',
          label: 'Comment 1',
          tone: 'persistent',
        },
        id: 'comment-1',
      },
    ] as const

    const mounted = render(
      <AnnotationHarness annotations={annotations} editor={editor} />
    )

    expect(
      mounted.container.querySelector('#inline-projection')?.textContent
    ).toBe('comment-1:1-4:annotation:persistent:comment-1')
    expect(
      mounted.container.querySelector('#annotation-sidebar')?.textContent
    ).toBe('comment-1:Comment 1:0.0:1|0.0:4')

    await act(async () => {
      editor.update(() => {
        editor.insertText('>', {
          at: { path: [0, 0], offset: 0 },
        })
      })
    })

    expect(
      mounted.container.querySelector('#inline-projection')?.textContent
    ).toBe('comment-1:2-5:annotation:persistent:comment-1')
    expect(
      mounted.container.querySelector('#annotation-sidebar')?.textContent
    ).toBe('comment-1:Comment 1:0.0:2|0.0:5')
  })

  test('annotation stores ignore selection-only changes and update when bookmark ranges rebase', async () => {
    const editor = createEditor()
    let notifications = 0

    Editor.replace(editor, {
      children: createChildren(),
      selection: null,
    })

    const bookmark = Editor.bookmark(editor, {
      anchor: { path: [0, 0], offset: 1 },
      focus: { path: [0, 0], offset: 4 },
    })
    const store = createSlateAnnotationStore(editor, () => [
      {
        bookmark,
        data: {
          kind: 'annotation',
          label: 'Comment 1',
        },
        id: 'comment-1',
      },
    ])
    const unsubscribe = store.subscribe(() => {
      notifications += 1
    })

    await act(async () => {
      editor.update(() => {
        editor.select({
          anchor: { path: [1, 0], offset: 1 },
          focus: { path: [1, 0], offset: 1 },
        })
      })
    })

    expect(notifications).toBe(0)
    expect(
      formatRange(store.getSnapshot().byId.get('comment-1')?.range ?? null)
    ).toBe('0.0:1|0.0:4')

    await act(async () => {
      editor.update(() => {
        editor.insertText('>', {
          at: { path: [0, 0], offset: 0 },
        })
      })
    })

    expect(notifications).toBe(1)
    expect(
      formatRange(store.getSnapshot().byId.get('comment-1')?.range ?? null)
    ).toBe('0.0:2|0.0:5')

    unsubscribe()
    store.destroy()
  })

  test('annotation projection store reprojects touched interior runtime ids even when the resolved range is unchanged', async () => {
    const editor = createEditor()
    const data = {
      kind: 'annotation',
      label: 'Comment 1',
    }

    Editor.replace(editor, {
      children: [
        {
          type: 'paragraph',
          children: [
            { text: 'aa' },
            { text: 'bb', bold: true },
            { text: 'cc' },
          ],
        },
      ],
      selection: null,
    })

    const snapshot = Editor.getSnapshot(editor)
    const middleId = snapshot.index.pathToId['0.1']
    const bookmark = Editor.bookmark(editor, {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 2], offset: 2 },
    })
    const store = createSlateAnnotationStore(editor, () => [
      {
        bookmark,
        data,
        id: 'comment-1',
      },
    ])

    expect(middleId).toBeTruthy()
    expect(store.projectionStore.getSnapshot()[middleId!]).toEqual([
      {
        key: 'comment-1',
        start: 0,
        end: 2,
        data: {
          annotationId: 'comment-1',
          ...data,
        },
      },
    ])

    await act(async () => {
      editor.update(() => {
        editor.insertText('xx', {
          at: { path: [0, 1], offset: 1 },
        })
      })
    })

    expect(
      formatRange(store.getSnapshot().byId.get('comment-1')?.range ?? null)
    ).toBe('0.0:0|0.2:2')
    expect(store.projectionStore.getSnapshot()[middleId!]).toEqual([
      {
        key: 'comment-1',
        start: 0,
        end: 4,
        data: {
          annotationId: 'comment-1',
          ...data,
        },
      },
    ])

    store.destroy()
    bookmark.unref()
  })
})
