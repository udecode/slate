import { useMemo, useState } from 'react'
import { createEditor, Editor, type Value } from 'slate'
import {
  createSlateProjectionStore,
  Editable,
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
  snapshot: ReturnType<typeof Editor.getSnapshot>
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

    Editor.replace(nextEditor, {
      children: initialChildren,
      selection: null,
    })

    return nextEditor
  })

  const projectionStore = useMemo(
    () => createSlateProjectionStore(editor, collectHighlightProjections),
    [editor]
  )

  return (
    <Editable
      editor={editor}
      id="highlighted-text"
      projectionStore={projectionStore}
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
  )
}

export default HighlightedTextExample
