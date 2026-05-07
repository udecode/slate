import { css } from '@emotion/css'
import { useMemo, useState } from 'react'
import type { Bookmark, createEditor, Path, Point, Range, Value } from 'slate'
import {
  Slate,
  useEditorSelector,
  useSlateAnnotationStore,
  useSlateAnnotations,
  useSlateEditor,
  useSlateWidgetStore,
  useSlateWidgets,
} from 'slate-react'

import { Instruction } from './components'

const createChildren = (left = 'alpha', right = 'beta'): Value => [
  {
    type: 'paragraph',
    children: [{ text: left }],
  },
  {
    type: 'paragraph',
    children: [{ text: right }],
  },
]

type BlockRowDescriptor = {
  childTexts: string[]
  path: Path
  text: string
}

const getBlockRows = (value: Value): BlockRowDescriptor[] =>
  value.flatMap((node, index) => {
    if (!('children' in node)) {
      return []
    }

    const childTexts = node.children.flatMap((child) =>
      'text' in child ? [String(child.text)] : []
    )

    if (childTexts.length === 0) {
      return []
    }

    return [
      {
        childTexts,
        path: [index],
        text: childTexts.join(''),
      },
    ]
  })

const getLeafPathByText = (
  editor: ReturnType<typeof createEditor>,
  match: (text: string) => boolean
) => {
  const value = editor.read((state) => state.value.get())

  for (const [blockIndex, node] of value.entries()) {
    if (!('children' in node)) {
      continue
    }

    for (const [childIndex, child] of node.children.entries()) {
      if ('text' in child && match(String(child.text))) {
        return [blockIndex, childIndex] as Path
      }
    }
  }

  throw new Error('Missing matching text leaf')
}

const getPointBeforeText = (
  editor: ReturnType<typeof createEditor>,
  textToFind: string
): Point => {
  const value = editor.read((state) => state.value.get())

  for (const [blockIndex, node] of value.entries()) {
    if (!('children' in node)) {
      continue
    }

    for (const [childIndex, child] of node.children.entries()) {
      if (!('text' in child)) {
        continue
      }

      const offset = String(child.text).indexOf(textToFind)

      if (offset !== -1) {
        return { path: [blockIndex, childIndex], offset }
      }
    }
  }

  throw new Error(`Missing text: ${textToFind}`)
}

const getBlockRowByText = (value: Value, match: (text: string) => boolean) =>
  getBlockRows(value).find((row) => match(row.text)) ?? null

const getOutline = (value: Value) =>
  getBlockRows(value)
    .map((row) => row.text)
    .join('|')

const rowCss = css`
  display: grid;
  grid-template-columns: minmax(180px, 220px) minmax(220px, 1fr);
  gap: 12px;
  align-items: center;
  margin-top: 12px;
`

const codeCss = css`
  padding: 3px 8px;
  border-radius: 999px;
  background: #111827;
  color: white;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
`

const panelCss = css`
  max-width: 760px;
  margin: 40px auto;
  padding: 0 24px 48px;
`

const controlsCss = css`
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 16px;
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

const toBlockOffset = (row: BlockRowDescriptor, point: Point) => {
  const childIndex = point.path[1] ?? 0
  const leadingLength = row.childTexts
    .slice(0, childIndex)
    .reduce((sum, text) => sum + text.length, 0)

  return leadingLength + point.offset
}

const ProjectionRow = ({
  row,
  slot,
}: {
  row: BlockRowDescriptor
  slot: 'left' | 'right'
}) => {
  const snapshot = useSlateAnnotations<{
    kind: string
    label: string
    tone?: string
  }>()
  const projectionText =
    snapshot.allIds.length === 0
      ? 'none'
      : snapshot.allIds
          .flatMap((id) => {
            const annotation = snapshot.byId.get(id)

            if (
              !annotation?.range ||
              annotation.range.anchor.path[0] !== row.path[0] ||
              annotation.range.focus.path[0] !== row.path[0]
            ) {
              return []
            }

            return [
              `${id}:${toBlockOffset(row, annotation.range.anchor)}-${toBlockOffset(row, annotation.range.focus)}:${annotation.data?.kind ?? 'unknown'}:${annotation.data?.tone ?? 'none'}`,
            ]
          })
          .join('|') || 'none'

  return (
    <div className={rowCss}>
      <span className={codeCss} id={`${slot}-text`}>
        {row.text}
      </span>
      <span className={codeCss} id={`${slot}-projection`}>
        {projectionText}
      </span>
    </div>
  )
}

const Outline = () => {
  const outline = useEditorSelector((editor) =>
    getOutline(editor.read((state) => state.value.get()))
  )

  return (
    <div className={rowCss}>
      <strong>Document outline</strong>
      <span className={codeCss} id="document-outline">
        {outline}
      </span>
    </div>
  )
}

const formatPointInRows = (rows: BlockRowDescriptor[], point: Point) => {
  const row = rows.find((row) => row.path[0] === point.path[0])

  if (!row) {
    return `${point.path.join('.')}:${point.offset}`
  }

  return `${row.path.join('.')}:${toBlockOffset(row, point)}`
}

const formatAnnotationRange = (
  range: Range | null,
  rows: BlockRowDescriptor[]
) =>
  range
    ? `${formatPointInRows(rows, range.anchor)}|${formatPointInRows(rows, range.focus)}`
    : 'none'

const AnnotationSidebar = () => {
  const snapshot = useSlateAnnotations<{
    kind: string
    label: string
    tone?: string
  }>()
  const rows = useEditorSelector((editor) =>
    getBlockRows(editor.read((state) => state.value.get()))
  )

  return (
    <div className={rowCss}>
      <strong>Annotation sidebar</strong>
      <span className={codeCss} id="annotation-sidebar">
        {snapshot.allIds.length === 0
          ? 'none'
          : snapshot.allIds
              .map((id) => {
                const annotation = snapshot.byId.get(id)!

                return `${annotation.id}:${annotation.data?.label ?? 'none'}:${formatAnnotationRange(annotation.range, rows)}`
              })
              .join('|')}
      </span>
    </div>
  )
}

const WidgetPanel = ({
  store,
}: {
  store: ReturnType<
    typeof useSlateWidgetStore<
      {
        label: string
      },
      {
        kind: string
        label: string
        tone?: string
      }
    >
  >
}) => {
  const snapshot = useSlateWidgets(store)

  return (
    <div className={rowCss}>
      <strong>Widget panel</strong>
      <span className={codeCss} id="widget-panel">
        {snapshot.allIds.length === 0
          ? 'none'
          : snapshot.allIds
              .map((id) => {
                const widget = snapshot.byId.get(id)!

                return `${widget.id}:${widget.anchor.type}:${widget.visible ? 'visible' : 'hidden'}:${widget.data?.label ?? 'none'}`
              })
              .join('|')}
      </span>
    </div>
  )
}

const AnchoredProjectionContent = ({
  annotation,
  editor,
  setAnnotation,
  widgetStore,
}: {
  annotation: Bookmark | null
  editor: ReturnType<typeof createEditor>
  setAnnotation: React.Dispatch<React.SetStateAction<Bookmark | null>>
  widgetStore: ReturnType<
    typeof useSlateWidgetStore<
      {
        label: string
      },
      {
        kind: string
        label: string
        tone?: string
      }
    >
  >
}) => {
  const alphaRow = useEditorSelector(
    (editor) =>
      getBlockRowByText(
        editor.read((state) => state.value.get()),
        (text) => text.includes('alpha')
      ) ?? null,
    (left, right) =>
      left != null &&
      right != null &&
      left.text === right.text &&
      left.path.join('.') === right.path.join('.')
  )
  const betaRow = useEditorSelector(
    (editor) =>
      getBlockRowByText(
        editor.read((state) => state.value.get()),
        (text) => text === 'beta'
      ) ?? null,
    (left, right) =>
      left != null &&
      right != null &&
      left.text === right.text &&
      left.path.join('.') === right.path.join('.')
  )

  return (
    <div className={panelCss} id="editor-root">
      <Instruction>
        Persistent bookmarks keep the annotation slice attached to the same
        logical text even when the document shape changes.
      </Instruction>

      <div className={controlsCss}>
        <button
          className={buttonCss}
          disabled={!!annotation}
          id="add-anchor"
          onClick={() => {
            const path = getLeafPathByText(editor, (text) =>
              text.includes('alpha')
            )

            setAnnotation(
              (current) =>
                current ??
                editor.read((state) =>
                  state.ranges.bookmark({
                    anchor: { path, offset: 1 },
                    focus: { path, offset: 4 },
                  })
                )
            )
          }}
          type="button"
        >
          Add anchor
        </button>
        <button
          className={buttonCss}
          id="insert-fragment"
          onClick={() => {
            const path = getLeafPathByText(editor, (text) =>
              text.includes('alpha')
            )
            const at = { path, offset: 0 }

            editor.update((tx) => {
              tx.selection.set({
                anchor: at,
                focus: at,
              })
              tx.fragment.insert([
                {
                  type: 'paragraph',
                  children: [{ text: 'intro-a' }],
                },
                {
                  type: 'paragraph',
                  children: [{ text: 'intro-b' }],
                },
              ])
            })
          }}
          type="button"
        >
          Insert fragment before anchor
        </button>
        <button
          className={buttonCss}
          id="insert-prefix"
          onClick={() => {
            const at = getPointBeforeText(editor, 'alpha')

            editor.update((tx) => {
              tx.text.insert('>', {
                at,
              })
            })
          }}
          type="button"
        >
          Insert prefix
        </button>
        <button
          className={buttonCss}
          disabled={!annotation}
          id="clear-anchor"
          onClick={() => {
            setAnnotation((current) => {
              current?.unref()
              return null
            })
          }}
          type="button"
        >
          Clear anchor
        </button>
      </div>

      <Outline />
      {alphaRow ? <ProjectionRow row={alphaRow} slot="left" /> : null}
      {betaRow ? <ProjectionRow row={betaRow} slot="right" /> : null}
      <AnnotationSidebar />
      <WidgetPanel store={widgetStore} />
    </div>
  )
}

const PersistentAnnotationAnchorsExample = () => {
  const editor = useSlateEditor({ initialValue: createChildren() })
  const [annotation, setAnnotation] = useState<Bookmark | null>(null)
  const annotations = useMemo(
    () =>
      annotation
        ? [
            {
              anchor: annotation,
              data: {
                kind: 'annotation',
                label: 'Comment anchor',
                tone: 'persistent',
              },
              id: 'comment-anchor',
              projection: {
                kind: 'annotation',
                tone: 'persistent',
              },
            },
          ]
        : [],
    [annotation]
  )
  const annotationStore = useSlateAnnotationStore(editor, annotations)
  const widgets = useMemo(
    () =>
      annotation
        ? [
            {
              anchor: {
                annotationId: 'comment-anchor',
                type: 'annotation' as const,
              },
              data: {
                label: 'Comment widget',
              },
              id: 'comment-widget',
            },
          ]
        : [],
    [annotation]
  )
  const widgetStore = useSlateWidgetStore(editor, widgets, annotationStore)

  return (
    <Slate annotationStore={annotationStore} editor={editor}>
      <AnchoredProjectionContent
        annotation={annotation}
        editor={editor}
        setAnnotation={setAnnotation}
        widgetStore={widgetStore}
      />
    </Slate>
  )
}

export default PersistentAnnotationAnchorsExample
