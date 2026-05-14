import { css } from '@emotion/css'
import { useEffect, useRef } from 'react'
import {
  type Descendant,
  type EditorSnapshot,
  NodeApi,
  type RuntimeId,
} from 'slate'
import { withHistory } from 'slate-history'
import {
  Editable,
  type EditableProps,
  Slate,
  type SlateProjection,
  useSlateDecorationSource,
  useSlateEditor,
} from 'slate-react'

import { Icon, Toolbar } from './components'
import type { CustomText } from './custom-types.d'

const SearchHighlightingExample = () => {
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const searchRef = useRef('')
  const editor = useSlateEditor({
    withEditor: withHistory,
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
  const searchSource = useSlateDecorationSource<{ highlight: true }>(editor, {
    id: 'search-highlighting',
    dirtiness: ['text', 'external'],
    read: ({ snapshot }) =>
      collectSearchProjections(snapshot.children, searchRef.current),
    runtimeScope: ({ snapshot }) => collectTextRuntimeScope(snapshot),
  })

  useEffect(() => {
    const input = searchInputRef.current

    if (!input) {
      return
    }

    const handleSearchInput = () => {
      searchRef.current = input.value
      searchSource.refresh({
        forceInvalidate: true,
        reason: 'external',
        sourceId: 'search-highlighting',
      })
    }

    input.addEventListener('input', handleSearchInput)

    return () => {
      input.removeEventListener('input', handleSearchInput)
    }
  }, [searchSource])

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
            placeholder="Search the text..."
            ref={searchInputRef}
            type="search"
          />
        </div>
      </Toolbar>
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
    </>
  )
}

const collectSearchProjections = (
  nodes: readonly Descendant[],
  search: string,
  path: number[] = []
): SlateProjection<{ highlight: true }>[] => {
  const projections: SlateProjection<{ highlight: true }>[] = []

  nodes.forEach((node, nodeIndex) => {
    const nodePath = [...path, nodeIndex]

    if (
      search &&
      NodeApi.isElement(node) &&
      node.children.every(NodeApi.isText)
    ) {
      const texts = node.children.map((it) => it.text)
      const str = texts.join('')
      const length = search.length
      let start = str.indexOf(search)
      let index = 0
      let iterated = 0

      while (start !== -1) {
        while (
          index < texts.length &&
          start >= iterated + texts[index].length
        ) {
          iterated += texts[index].length
          index++
        }

        let offset = start - iterated
        let remaining = length

        while (index < texts.length && remaining > 0) {
          const currentText = texts[index]
          const currentPath = [...nodePath, index]
          const taken = Math.min(remaining, currentText.length - offset)

          projections.push({
            data: { highlight: true },
            key: `search:${currentPath.join('.')}:${offset}:${taken}`,
            range: {
              anchor: { path: currentPath, offset },
              focus: { path: currentPath, offset: offset + taken },
            },
          })

          remaining -= taken

          if (remaining > 0) {
            iterated += currentText.length
            offset = 0
            index++
          }
        }

        start = str.indexOf(search, start + search.length)
      }
    }

    if (NodeApi.isElement(node)) {
      projections.push(
        ...collectSearchProjections(node.children, search, nodePath)
      )
    }
  })

  return projections
}

const collectTextRuntimeScope = (
  snapshot: EditorSnapshot,
  nodes: readonly Descendant[] = snapshot.children,
  path: number[] = []
): RuntimeId[] => {
  const runtimeIds: RuntimeId[] = []

  nodes.forEach((node, nodeIndex) => {
    const nodePath = [...path, nodeIndex]

    if (NodeApi.isText(node)) {
      const runtimeId = snapshot.index.pathToId[nodePath.join('.')]

      if (runtimeId) {
        runtimeIds.push(runtimeId)
      }
      return
    }

    if (NodeApi.isElement(node)) {
      runtimeIds.push(
        ...collectTextRuntimeScope(snapshot, node.children, nodePath)
      )
    }
  })

  return runtimeIds
}

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
