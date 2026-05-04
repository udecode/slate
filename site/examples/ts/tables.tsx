import { css } from '@emotion/css'
import { useCallback } from 'react'
import { Node, Point, Range } from 'slate'
import { withHistory } from 'slate-history'
import {
  Editable,
  type EditableKeyDownHandler,
  type RenderElementProps,
  type RenderLeafProps,
  Slate,
  useSlateEditor,
} from 'slate-react'
import type { CustomEditor, CustomValue } from './custom-types.d'

const TablesExample = () => {
  const renderElement = useCallback(
    (props: RenderElementProps) => <Element {...props} />,
    []
  )
  const renderLeaf = useCallback(
    (props: RenderLeafProps) => <Leaf {...props} />,
    []
  )
  const editor = useSlateEditor<CustomValue, CustomEditor>({
    withEditor: (editor) => withHistory(editor) as CustomEditor,
    initialValue,
  })
  const handleKeyDown = useCallback<EditableKeyDownHandler>(
    (event) => applyTableBoundaryCommand(editor, event.key),
    [editor]
  )

  return (
    <Slate editor={editor}>
      <Editable
        onKeyDown={handleKeyDown}
        renderElement={renderElement}
        renderLeaf={renderLeaf}
      />
    </Slate>
  )
}

const applyTableBoundaryCommand = (editor: CustomEditor, key: string) => {
  const selection = editor.read((state) => state.selection.get())

  if (!selection || !Range.isCollapsed(selection)) {
    return false
  }

  const [cell] = editor.read((state) =>
    Array.from(
      state.nodes.match({
        match: (n) => Node.isElement(n) && n.type === 'table-cell',
      })
    )
  )

  if (!cell) {
    return false
  }

  const [, cellPath] = cell

  if (key === 'Backspace') {
    const start = editor.read((state) => state.points.start(cellPath))
    return Point.equals(selection.anchor, start)
  }

  if (key === 'Delete') {
    const end = editor.read((state) => state.points.end(cellPath))
    return Point.equals(selection.anchor, end)
  }

  if (key === 'Enter') {
    return true
  }

  return false
}

const Element = ({ attributes, children, element }: RenderElementProps) => {
  switch (element.type) {
    case 'table':
      return (
        <table
          className={css`
            // avoid unexpected selection behavior on both sides of the table
            position: relative;
          `}
        >
          <tbody {...attributes}>{children}</tbody>
        </table>
      )
    case 'table-row':
      return <tr {...attributes}>{children}</tr>
    case 'table-cell':
      return <td {...attributes}>{children}</td>
    default:
      return <p {...attributes}>{children}</p>
  }
}

const Leaf = ({ attributes, children, leaf }: RenderLeafProps) => {
  if (leaf.bold) {
    children = <strong>{children}</strong>
  }

  return <span {...attributes}>{children}</span>
}

const initialValue: CustomValue = [
  {
    type: 'paragraph',
    children: [
      {
        text: 'Since the editor is based on a recursive tree model, similar to an HTML document, you can create complex nested structures, like tables:',
      },
    ],
  },
  {
    type: 'table',
    children: [
      {
        type: 'table-row',
        children: [
          {
            type: 'table-cell',
            children: [{ text: '' }],
          },
          {
            type: 'table-cell',
            children: [{ text: 'Human', bold: true }],
          },
          {
            type: 'table-cell',
            children: [{ text: 'Dog', bold: true }],
          },
          {
            type: 'table-cell',
            children: [{ text: 'Cat', bold: true }],
          },
        ],
      },
      {
        type: 'table-row',
        children: [
          {
            type: 'table-cell',
            children: [{ text: '# of Feet', bold: true }],
          },
          {
            type: 'table-cell',
            children: [{ text: '2' }],
          },
          {
            type: 'table-cell',
            children: [{ text: '4' }],
          },
          {
            type: 'table-cell',
            children: [{ text: '4' }],
          },
        ],
      },
      {
        type: 'table-row',
        children: [
          {
            type: 'table-cell',
            children: [{ text: '# of Lives', bold: true }],
          },
          {
            type: 'table-cell',
            children: [{ text: '1' }],
          },
          {
            type: 'table-cell',
            children: [{ text: '1' }],
          },
          {
            type: 'table-cell',
            children: [{ text: '9' }],
          },
        ],
      },
    ],
  },
  {
    type: 'paragraph',
    children: [
      {
        text: "This table is just a basic example of rendering a table, and it doesn't have fancy functionality. But you could augment it to add support for navigating with arrow keys, displaying table headers, adding column and rows, or even formulas if you wanted to get really crazy!",
      },
    ],
  },
]

export default TablesExample
