import { css } from '@emotion/css'
import { NodeApi, PointApi, RangeApi } from 'slate'
import { withHistory } from 'slate-history'
import {
  Editable,
  type EditableCommandHandler,
  type RenderElementProps,
  type RenderLeafProps,
  Slate,
  useSlateEditor,
} from 'slate-react'
import type { CustomEditor, CustomValue } from './custom-types.d'

const TablesExample = () => {
  const editor = useSlateEditor<CustomValue, CustomEditor>({
    withEditor: (editor) => withHistory(editor),
    initialValue: [
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
    ],
  })
  const handleCommand: EditableCommandHandler = (command) =>
    applyTableBoundaryCommand(editor, command)

  return (
    <Slate editor={editor}>
      <Editable
        onCommand={handleCommand}
        renderElement={Element}
        renderLeaf={Leaf}
      />
    </Slate>
  )
}

const applyTableBoundaryCommand = (
  editor: CustomEditor,
  command: Parameters<EditableCommandHandler>[0]
) => {
  const selection = editor.read((state) => state.selection.get())

  if (!selection || !RangeApi.isCollapsed(selection)) {
    return false
  }

  const cell = editor.read((state) =>
    state.nodes.find({
      match: (n) => NodeApi.isElement(n) && n.type === 'table-cell',
    })
  )

  if (!cell) {
    return false
  }

  const [, cellPath] = cell

  if (command.kind === 'delete' && command.direction === 'backward') {
    const start = editor.read((state) => state.points.start(cellPath))
    return PointApi.equals(selection.anchor, start)
  }

  if (command.kind === 'delete' && command.direction === 'forward') {
    const end = editor.read((state) => state.points.end(cellPath))
    return PointApi.equals(selection.anchor, end)
  }

  if (command.kind === 'insert-break') {
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

export default TablesExample
