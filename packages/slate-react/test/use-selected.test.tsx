import { act, render } from '@testing-library/react'
import { createEditor } from 'slate'
import {
  Editable,
  ReactEditor,
  RenderElementProps,
  Slate,
  useSelected,
  withReact,
} from '../src'

let editor: ReactEditor
let latestSelectedById: Record<string, boolean | undefined>

const initialValue = () => [
  {
    id: '0',
    children: [
      { id: '0.0', children: [{ text: '' }] },
      { id: '0.1', children: [{ text: '' }] },
      { id: '0.2', children: [{ text: '' }] },
    ],
  },
  { id: '1', children: [{ text: '' }] },
  { id: '2', children: [{ text: '' }] },
]

describe('useSelected', () => {
  const withEditor = () => {
    beforeEach(() => {
      editor = withReact(createEditor())

      latestSelectedById = {}

      const renderElement = ({
        element,
        attributes,
        children,
      }: RenderElementProps) => {
        // eslint-disable-next-line react-hooks/rules-of-hooks
        const selected = useSelected()
        const { id } = element as any

        latestSelectedById[id] = selected

        return <div {...attributes}>{children}</div>
      }

      render(
        <Slate editor={editor} initialValue={initialValue()}>
          <Editable renderElement={renderElement} />
        </Slate>
      )
    })

    it('returns false initially', () => {
      expect(latestSelectedById).toEqual({
        '0': false,
        '0.0': false,
        '0.1': false,
        '0.2': false,
        '1': false,
        '2': false,
      })
    })

    it('re-renders elements when it becomes true or false', async () => {
      await act(async () => {
        editor.update(() => {
          editor.select([0, 0])
        })
      })

      expect(latestSelectedById['0']).toBe(true)
      expect(latestSelectedById['0.0']).toBe(true)
      expect(latestSelectedById['1']).toBe(false)
      expect(latestSelectedById['2']).toBe(false)

      await act(async () => {
        editor.update(() => {
          editor.select([2])
        })
      })

      expect(latestSelectedById['0']).toBe(false)
      expect(latestSelectedById['0.0']).toBe(false)
      expect(latestSelectedById['1']).toBe(false)
      expect(latestSelectedById['2']).toBe(true)
    })

    it('returns true for elements in the middle of the selection', async () => {
      await act(async () => {
        editor.update(() => {
          editor.select({
            anchor: { path: [2, 0], offset: 0 },
            focus: { path: [0, 1, 0], offset: 0 },
          })
        })
      })

      expect(latestSelectedById['0']).toBe(true)
      expect(latestSelectedById['0.1']).toBe(true)
      expect(latestSelectedById['0.2']).toBe(true)
      expect(latestSelectedById['1']).toBe(true)
      expect(latestSelectedById['2']).toBe(true)
    })

    it('remains true when the path changes', async () => {
      await act(async () => {
        editor.update(() => {
          editor.select({ path: [2, 0], offset: 0 })
        })
      })

      expect(latestSelectedById['2']).toBe(true)

      await act(async () => {
        editor.update(() => {
          editor.insertNodes({ id: 'new', children: [{ text: '' }] } as any, {
            at: [2],
          })
        })
      })

      expect(latestSelectedById.new).toBe(false)
      expect(latestSelectedById['2']).toBe(true)
    })
  }

  describe('standard render tree', () => {
    withEditor()
  })
})
