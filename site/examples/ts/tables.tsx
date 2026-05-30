import { defineEditorExtension, NodeApi, PointApi, RangeApi } from 'slate'
import {
  Editable,
  type RenderElementProps,
  type RenderLeafProps,
  Slate,
  useSlateEditor,
} from 'slate-react'
import type { CustomEditor, CustomValue } from './custom-types.d'

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
        text: 'This table is a basic rendering example with conservative cell-boundary editing. Backspace, Delete, Enter, and arrow movement stay inside valid table or text positions; richer table features such as headers, row and column controls, formulas, and multi-cell selection belong in table extensions.',
      },
    ],
  },
]

const TablesExample = () => {
  const editor = useSlateEditor({
    extensions: [table()],
    initialValue,
  })
  return (
    <Slate editor={editor}>
      <Editable renderElement={Element} renderLeaf={Leaf} />
    </Slate>
  )
}

const table = () =>
  defineEditorExtension<CustomEditor>()({
    name: 'table',
    transforms: {
      deleteBackward({ next, tx, unit }) {
        const selection = tx.selection.get()

        if (selection && RangeApi.isCollapsed(selection)) {
          const cell = tx.nodes.find({
            match: (n) => NodeApi.isElement(n) && n.type === 'table-cell',
          })

          if (cell) {
            const [, cellPath] = cell
            const start = tx.points.start(cellPath)

            if (PointApi.equals(selection.anchor, start)) {
              return true
            }
          }
        }

        return next({ unit })
      },
      deleteForward({ next, tx, unit }) {
        const selection = tx.selection.get()

        if (selection && RangeApi.isCollapsed(selection)) {
          const cell = tx.nodes.find({
            match: (n) => NodeApi.isElement(n) && n.type === 'table-cell',
          })

          if (cell) {
            const [, cellPath] = cell
            const end = tx.points.end(cellPath)

            if (PointApi.equals(selection.anchor, end)) {
              return true
            }
          }
        }

        return next({ unit })
      },
      insertBreak({ next, tx }) {
        const selection = tx.selection.get()

        if (selection && RangeApi.isCollapsed(selection)) {
          const cell = tx.nodes.find({
            match: (n) => NodeApi.isElement(n) && n.type === 'table-cell',
          })

          if (cell) {
            return true
          }
        }

        return next()
      },
    },
  })

const Element = ({ attributes, children, element }: RenderElementProps) => {
  switch (element.type) {
    case 'table':
      return (
        <table className="slate-tables-table">
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

export default TablesExample
