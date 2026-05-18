import { css } from '@emotion/css'
import { memo, useState } from 'react'
import { NodeApi } from 'slate'
import {
  Editable,
  type EditableProps,
  type ReactEditor,
  Slate,
  type SlateDecorationSource,
  useSlateEditor,
  useSlateRangeDecorationSource,
} from 'slate-react'

import { Icon, Toolbar } from './components'
import type { CustomText } from './custom-types.d'

const searchHighlightingDirtiness = ['text', 'external'] as const

const SearchHighlightingExample = () => {
  const [search, setSearch] = useState('')
  const editor = useSlateEditor({
    initialValue: [
      {
        type: 'paragraph',
        children: [
          {
            text: 'This is editable text that you can search. As you search, it looks for matching strings of text, and adds ',
          },
          { text: 'decorations', bold: true },
          { text: ' to them in realtime.' },
        ],
      },
      {
        type: 'paragraph',
        children: [
          {
            text: 'Try it out for yourself by typing in the search box above!',
          },
        ],
      },
    ],
  })
  const searchSource = useSlateRangeDecorationSource<{ highlight: true }>(
    editor,
    {
      data: { highlight: true },
      deps: [search],
      id: 'search-highlighting',
      dirtiness: searchHighlightingDirtiness,
      read: ({ snapshot }) =>
        search
          ? NodeApi.findTextRanges({ children: snapshot.children }, search, {
              caseSensitive: false,
            })
          : [],
    }
  )

  return (
    <>
      <Toolbar>
        <div
          className={css`
            position: relative;
          `}
        >
          <Icon
            className={css`
              position: absolute;
              top: 0.3em;
              left: 0.4em;
              color: #ccc;
            `}
          >
            search
          </Icon>
          <input
            className={css`
              padding-left: 2.5em !important;
              width: 100%;
            `}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search the text..."
            type="search"
            value={search}
          />
        </div>
      </Toolbar>
      <SearchHighlightingEditor editor={editor} searchSource={searchSource} />
    </>
  )
}

const SearchHighlightingEditor = memo(
  ({
    editor,
    searchSource,
  }: {
    editor: ReactEditor<any>
    searchSource: SlateDecorationSource<{ highlight: true }>
  }) => (
    <Slate decorationSources={[searchSource]} editor={editor}>
      <Editable
        id="search-highlighting"
        renderLeaf={Leaf}
        renderSegment={(segment, children) =>
          segment.slices.some(
            (slice) =>
              (slice.data as { highlight?: true } | undefined)?.highlight
          ) ? (
            <span
              className={css`
                background-color: #ffeeba;
              `}
              data-cy="search-highlighted"
            >
              {children}
            </span>
          ) : (
            children
          )
        }
      />
    </Slate>
  )
)

interface HighlightLeaf extends CustomText {
  highlight?: boolean
}

type SearchLeafProps = Parameters<NonNullable<EditableProps['renderLeaf']>>[0]

const Leaf = ({ attributes, children, leaf }: SearchLeafProps) => {
  const highlightLeaf = leaf as HighlightLeaf
  return (
    <span
      {...attributes}
      className={css`
        font-weight: ${highlightLeaf.bold && 'bold'};
      `}
    >
      {children}
    </span>
  )
}

export default SearchHighlightingExample
