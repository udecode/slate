import { css } from '@emotion/css'
import Prism from 'prismjs'
import 'prismjs/components/prism-markdown'
import { type ReactNode, useEffect, useMemo } from 'react'
import { type Descendant, Node } from 'slate'
import { withHistory } from 'slate-history'
import {
  createDecorationSource,
  Editable,
  Slate,
  type SlateProjection,
  useSlateEditor,
} from 'slate-react'
import type { CustomEditor, CustomValue } from './custom-types.d'

const MarkdownPreviewExample = () => {
  const editor = useSlateEditor<CustomValue, CustomEditor>({
    withEditor: (editor) => withHistory(editor) as CustomEditor,
    initialValue,
  })
  const markdownSource = useMemo(
    () =>
      createDecorationSource<Record<string, true>>(editor, {
        id: 'markdown-preview',
        dirtiness: 'text',
        read: ({ snapshot }) => collectMarkdownProjections(snapshot.children),
      }),
    [editor]
  )

  useEffect(() => () => markdownSource.destroy(), [markdownSource])

  return (
    <Slate decorationSources={[markdownSource]} editor={editor}>
      <Editable
        id="markdown-preview"
        placeholder="Write some markdown..."
        renderSegment={(segment, children) => (
          <MarkdownSegment
            data={Object.assign(
              {},
              ...segment.slices.map((slice) => slice.data ?? {})
            )}
          >
            {children}
          </MarkdownSegment>
        )}
      />
    </Slate>
  )
}

const getTokenLength = (token: string | Prism.Token): number => {
  if (typeof token === 'string') {
    return token.length
  }
  if (typeof token.content === 'string') {
    return token.content.length
  }
  return (token.content as Prism.Token[]).reduce(
    (length, child) => length + getTokenLength(child),
    0
  )
}

const collectMarkdownProjections = (
  nodes: readonly Descendant[],
  path: number[] = []
): SlateProjection<Record<string, true>>[] => {
  const projections: SlateProjection<Record<string, true>>[] = []

  nodes.forEach((node, nodeIndex) => {
    const nodePath = [...path, nodeIndex]

    if (Node.isText(node)) {
      const tokens = Prism.tokenize(node.text, Prism.languages.markdown)
      let start = 0

      for (const token of tokens) {
        const length = getTokenLength(token)
        const end = start + length

        if (typeof token !== 'string') {
          projections.push({
            data: { [token.type]: true },
            key: `markdown:${nodePath.join('.')}:${start}:${end}`,
            range: {
              anchor: { path: nodePath, offset: start },
              focus: { path: nodePath, offset: end },
            },
          })
        }

        start = end
      }
    }

    if (Node.isElement(node)) {
      projections.push(...collectMarkdownProjections(node.children, nodePath))
    }
  })

  return projections
}

const MarkdownSegment = ({
  children,
  data,
}: {
  children: ReactNode
  data: Record<string, unknown>
}) => {
  const has = (key: string) => Boolean(data[key])

  return (
    <span
      className={css`
        font-weight: ${has('bold') ? 'bold' : undefined};
        font-style: ${has('italic') ? 'italic' : undefined};
        text-decoration: ${has('underlined') ? 'underline' : undefined};
        ${
          has('title') &&
          css`
            display: inline-block;
            font-weight: bold;
            font-size: 20px;
            margin: 20px 0 10px 0;
          `
        }
        ${
          has('list') &&
          css`
            padding-left: 10px;
            font-size: 20px;
            line-height: 10px;
          `
        }
        ${
          has('hr') &&
          css`
            display: block;
            text-align: center;
            border-bottom: 2px solid #ddd;
          `
        }
        ${
          has('blockquote') &&
          css`
            display: inline-block;
            border-left: 2px solid #ddd;
            padding-left: 10px;
            color: #aaa;
            font-style: italic;
          `
        }
        ${
          has('code') &&
          css`
            font-family: monospace;
            background-color: #eee;
            padding: 3px;
          `
        }
      `}
    >
      {children}
    </span>
  )
}

const initialValue: CustomValue = [
  {
    type: 'paragraph',
    children: [
      {
        text: 'Slate is flexible enough to add **decorations** that can format text based on its content. For example, this editor has **Markdown** preview decorations on it, to make it _dead_ simple to make an editor with built-in Markdown previewing.',
      },
    ],
  },
  {
    type: 'paragraph',
    children: [{ text: '## Try it out!' }],
  },
  {
    type: 'paragraph',
    children: [{ text: 'Try it out for yourself!' }],
  },
]

export default MarkdownPreviewExample
