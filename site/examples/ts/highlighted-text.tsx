import type { Descendant, EditorSnapshot } from 'slate'
import {
  Editable,
  Slate,
  type SlateProjection,
  useSlateDecorationSource,
  useSlateEditor,
} from 'slate-react'

type HighlightProjectionData = {
  hashtag?: true
  tone?: string
}

const isTextNode = (
  node: Descendant
): node is Extract<Descendant, { text: string }> =>
  'text' in node && typeof node.text === 'string'

const collectHashtagProjections = (
  nodes: readonly Descendant[],
  path: number[] = []
): SlateProjection<HighlightProjectionData>[] =>
  nodes.flatMap((node, index) => {
    const currentPath = [...path, index]

    if (isTextNode(node)) {
      return [...node.text.matchAll(/#[^\s#]+/g)].map((match) => {
        const offset = match.index ?? 0
        const text = match[0]

        return {
          data: { hashtag: true },
          key: `hashtag-${currentPath.join('-')}-${offset}`,
          range: {
            anchor: { path: currentPath, offset },
            focus: { path: currentPath, offset: offset + text.length },
          },
        }
      })
    }

    return collectHashtagProjections(node.children, currentPath)
  })

const collectHighlightProjections = (
  snapshot: EditorSnapshot
): SlateProjection<HighlightProjectionData>[] => {
  const firstBlock = snapshot.children[0]

  if (
    !firstBlock ||
    !('children' in firstBlock) ||
    !firstBlock.children[0] ||
    !isTextNode(firstBlock.children[0])
  ) {
    return []
  }

  const firstText = firstBlock.children[0].text
  const projections = collectHashtagProjections(snapshot.children)

  if (!firstText.startsWith('#') && firstText.length > 1) {
    projections.unshift({
      data: { tone: 'warm' },
      key: 'highlight',
      range: {
        anchor: { path: [0, 0], offset: 1 },
        focus: { path: [0, 0], offset: Math.min(4, firstText.length) },
      },
    })
  }

  return projections
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

  const highlightSource = useSlateDecorationSource(editor, {
    dirtiness: ['text', 'node'],
    id: 'highlighted-text',
    read: ({ snapshot }) => collectHighlightProjections(snapshot),
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
