import { type EditorSnapshot, NodeApi } from 'slate'
import {
  Editable,
  Slate,
  type SlateRangeDecoration,
  useSlateEditor,
  useSlateRangeDecorationSource,
} from 'slate-react'

type HighlightProjectionData = {
  hashtag?: true
  tone?: string
}

const collectHighlightRanges = (
  snapshot: EditorSnapshot
): SlateRangeDecoration<HighlightProjectionData>[] => {
  const firstBlock = snapshot.children[0]

  if (
    !firstBlock ||
    !NodeApi.isElement(firstBlock) ||
    !firstBlock.children[0] ||
    !NodeApi.isText(firstBlock.children[0])
  ) {
    return []
  }

  const firstText = firstBlock.children[0].text
  const ranges: SlateRangeDecoration<HighlightProjectionData>[] =
    NodeApi.findTextRanges({ children: snapshot.children }, /#[^\s#]+/g).map(
      (range) => ({
        data: { hashtag: true as const },
        range,
      })
    )

  if (!firstText.startsWith('#') && firstText.length > 1) {
    ranges.unshift({
      data: { tone: 'warm' },
      key: 'highlight',
      range: {
        anchor: { path: [0, 0], offset: 1 },
        focus: { path: [0, 0], offset: Math.min(4, firstText.length) },
      },
    })
  }

  return ranges
}

const HighlightedTextExample = () => {
  const editor = useSlateEditor({
    initialValue: [
      {
        type: 'paragraph',
        children: [{ text: 'alpha beta' }],
      },
    ],
  })

  const highlightSource = useSlateRangeDecorationSource(editor, {
    dirtiness: ['text', 'node'],
    id: 'highlighted-text',
    read: ({ snapshot }) => collectHighlightRanges(snapshot),
  })

  return (
    <Slate decorationSources={[highlightSource]} editor={editor}>
      <Editable
        id="highlighted-text"
        renderSegment={(segment, children) => {
          const data = Object.assign(
            {},
            ...segment.slices.map((slice) => slice.data)
          ) as HighlightProjectionData

          return segment.slices.length > 0 ? (
            <span
              data-hashtag={data.hashtag ? 'true' : undefined}
              data-tone={data.tone}
              style={{
                ...(data.tone
                  ? {
                      background: '#fde68a',
                      borderRadius: 4,
                    }
                  : {}),
                ...(data.hashtag
                  ? {
                      color: '#7c3aed',
                      fontWeight: 600,
                    }
                  : {}),
              }}
            >
              {children}
            </span>
          ) : (
            children
          )
        }}
        style={{ minHeight: 48 }}
      />
    </Slate>
  )
}

export default HighlightedTextExample
