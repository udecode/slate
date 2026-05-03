import { useMemo, useState } from 'react'
import { createEditor, type EditorSnapshot, type Value } from 'slate'
import {
  createDecorationSource,
  Editable,
  Slate,
  type SlateProjection,
  withReact,
} from 'slate-react'

const initialChildren: Value = [
  {
    type: 'paragraph',
    children: [{ text: 'alpha beta' }],
  },
]

const collectHighlightProjections = (
  snapshot: EditorSnapshot
): SlateProjection<{ tone: string }>[] => {
  const firstBlock = snapshot.children[0]

  if (
    !firstBlock ||
    !('children' in firstBlock) ||
    !firstBlock.children[0] ||
    !('text' in firstBlock.children[0])
  ) {
    return []
  }

  return [
    {
      data: { tone: 'warm' },
      key: 'highlight',
      range: {
        anchor: { path: [0, 0], offset: 1 },
        focus: { path: [0, 0], offset: 4 },
      },
    },
  ]
}

const HighlightedTextExample = () => {
  const [editor] = useState(() => {
    const nextEditor = withReact(createEditor())

    nextEditor.update((tx) => {
      tx.value.replace({
        children: initialChildren,
        selection: null,
      })
    })

    return nextEditor
  })

  const highlightSource = useMemo(
    () =>
      createDecorationSource(editor, {
        id: 'highlighted-text',
        read: ({ snapshot }) => collectHighlightProjections(snapshot),
      }),
    [editor]
  )

  return (
    <Slate decorationSources={[highlightSource]} editor={editor}>
      <Editable
        id="highlighted-text"
        renderSegment={(segment, children) =>
          segment.slices.length > 0 ? (
            <span
              data-tone={
                (
                  segment.slices[0]?.data as
                    | {
                        tone?: string
                      }
                    | undefined
                )?.tone ?? 'none'
              }
              style={{
                background: '#fde68a',
                borderRadius: 4,
              }}
            >
              {children}
            </span>
          ) : (
            children
          )
        }
        style={{ minHeight: 48 }}
      />
    </Slate>
  )
}

export default HighlightedTextExample
