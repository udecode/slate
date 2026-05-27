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

import { cn } from '@/utils/cn'

import { Icon, Toolbar } from './components'
import type { CustomText } from './custom-types.d'

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
      dirtiness: 'text',
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
        <div className="slate-search-highlighting-box">
          <Icon className="slate-search-highlighting-icon">search</Icon>
          <input
            className="slate-search-highlighting-input"
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
              className="slate-search-highlighting-highlight"
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
      className={cn(highlightLeaf.bold && 'slate-search-highlighting-bold')}
    >
      {children}
    </span>
  )
}

export default SearchHighlightingExample
