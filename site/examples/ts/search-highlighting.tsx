import { css } from '@emotion/css'
import { useEffect, useMemo, useRef } from 'react'
import {
  createEditor,
  type Descendant,
  type EditorSnapshot,
  Node,
  type RuntimeId,
} from 'slate'
import { withHistory } from 'slate-history'
import {
  createSlateProjectionStore,
  Editable,
  type EditableProps,
  type SlateProjection,
  withReact,
} from 'slate-react'

import { Icon, Toolbar } from './components'
import type { CustomEditor, CustomText, CustomValue } from './custom-types.d'

const SearchHighlightingExample = () => {
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const searchRef = useRef('')
  const editor = useMemo(() => {
    const nextEditor = withHistory(
      withReact(createEditor<CustomValue>())
    ) as CustomEditor

    nextEditor.replace({
      children: initialValue,
      selection: null,
    })

    return nextEditor
  }, [])
  const projectionStore = useMemo(
    () =>
      createSlateProjectionStore(
        editor,
        (snapshot) =>
          collectSearchProjections(snapshot.children, searchRef.current),
        {
          dirtiness: ['text', 'external'],
          runtimeScope: ({ snapshot }) => collectTextRuntimeScope(snapshot),
          sourceId: 'search-highlighting',
        }
      ),
    [editor]
  )

  useEffect(() => () => projectionStore.destroy(), [projectionStore])
  useEffect(() => {
    const input = searchInputRef.current

    if (!input) {
      return
    }

    const handleSearchInput = () => {
      searchRef.current = input.value
      projectionStore.refresh({
        forceInvalidate: true,
        reason: 'external',
        sourceId: 'search-highlighting',
      })
    }

    input.addEventListener('input', handleSearchInput)

    return () => {
      input.removeEventListener('input', handleSearchInput)
    }
  }, [projectionStore])

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
      <Editable
        editor={editor}
        id="search-highlighting"
        projectionStore={projectionStore}
        renderLeaf={(props: SearchLeafProps) => <Leaf {...props} />}
        renderSegment={(segment, children) =>
          segment.slices.some((slice) => slice.data?.highlight) ? (
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

    if (search && Node.isElement(node) && node.children.every(Node.isText)) {
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

    if (Node.isElement(node)) {
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

    if (Node.isText(node)) {
      const runtimeId = snapshot.index.pathToId[nodePath.join('.')]

      if (runtimeId) {
        runtimeIds.push(runtimeId)
      }
      return
    }

    if (Node.isElement(node)) {
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

const initialValue: Descendant[] = [
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
      { text: 'Try it out for yourself by typing in the search box above!' },
    ],
  },
]

export default SearchHighlightingExample
