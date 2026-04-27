import { act, type RenderResult, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import {
  createEditor as createSlateEditor,
  type DecoratedRange,
  type Descendant,
  Editor,
  Node,
  type NodeEntry,
  Path,
  Text,
} from 'slate'
import {
  createSlateProjectionStore,
  Editable,
  ReactEditor,
  type SlateProjection,
  type SlateProjectionSource,
  type SlateProjectionStore,
  SlateReactCompat,
  withReact,
} from '../src'

type SegmentLike = {
  slices: readonly { data?: Record<string, unknown> }[]
}

type RenderedProjectionEditor = RenderResult & {
  store: SlateProjectionStore<Record<string, unknown>>
}

const createEditor = () => withReact(createSlateEditor())

const renderSegment = (segment: SegmentLike, children: ReactNode) => {
  const decorations = segment.slices
    .flatMap((slice) => Object.keys(slice.data ?? {}))
    .sort()

  return <span data-decorations={JSON.stringify(decorations)}>{children}</span>
}

const getProjectedSegments = (
  container: HTMLElement
): { text: string; decorations: string[] }[] =>
  Array.from(container.querySelectorAll('[data-decorations]')).map(
    (segment) => ({
      decorations: JSON.parse(
        (segment as HTMLElement).dataset.decorations ?? '[]'
      ),
      text: segment.textContent ?? '',
    })
  )

const renderProjectedEditor = (
  editor: ReactEditor,
  children: Descendant[],
  source: SlateProjectionSource<Record<string, unknown>>
): RenderedProjectionEditor => {
  Editor.replace(editor, {
    children,
    selection: null,
  })

  const store = createSlateProjectionStore(editor, source)
  const rendered = render(
    <Editable
      editor={editor}
      projectionStore={store}
      renderSegment={renderSegment}
    />
  )

  return { ...rendered, store }
}

interface DecorateConfig {
  path: Path
  decorations: (node: Node) => (DecoratedRange & Record<string, unknown>)[]
}

const decoratePaths =
  (editor: ReactEditor, configs: DecorateConfig[]) =>
  ([node, path]: NodeEntry): DecoratedRange[] => {
    if (Node.get(editor, path) !== node) {
      throw new Error('decorate was called with an incorrect node entry')
    }

    const matchingConfig = configs.find(({ path: p }) => Path.equals(path, p))
    if (!matchingConfig) return []

    return matchingConfig.decorations(node)
  }

const findTextRangesByText = (
  nodes: readonly Descendant[],
  text: string,
  parentPath: Path = []
): SlateProjection<Record<string, unknown>>[] =>
  nodes.flatMap((node, index) => {
    const path = [...parentPath, index] as Path

    if (Text.isText(node)) {
      return node.text === text
        ? [
            {
              data: { bold: true },
              key: `text:${path.join('.')}`,
              range: {
                anchor: { path, offset: 0 },
                focus: { path, offset: node.text.length },
              },
            },
          ]
        : []
    }

    return findTextRangesByText(node.children, text, path)
  })

describe('slate-react projections and selection contract', () => {
  test('keeps overlapping inline payloads multiplicity-safe in one text node', () => {
    const editor = createEditor()
    const rendered = renderProjectedEditor(
      editor,
      [{ children: [{ text: 'Hello world!' }] }],
      () => [
        {
          data: { bold: true },
          key: 'bold',
          range: {
            anchor: { path: [0, 0], offset: 0 },
            focus: { path: [0, 0], offset: 11 },
          },
        },
        {
          data: { italic: true },
          key: 'italic',
          range: {
            anchor: { path: [0, 0], offset: 6 },
            focus: { path: [0, 0], offset: 12 },
          },
        },
      ]
    )

    expect(getProjectedSegments(rendered.container)).toEqual([
      { text: 'Hello ', decorations: ['bold'] },
      { text: 'world', decorations: ['bold', 'italic'] },
      { text: '!', decorations: ['italic'] },
    ])

    rendered.store.destroy()
  })

  test('adapts legacy decorate callbacks into typed projection sources', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [
        {
          children: [{ text: 'Hello world!' }],
        },
      ],
      selection: null,
    })

    const source = SlateReactCompat.createSlateDecorateCompatSource(
      ([node, path]) =>
        Text.isText(node) && Path.equals(path, [0, 0])
          ? [
              {
                anchor: { path, offset: 0 },
                focus: { path, offset: 5 },
                tone: 'bold',
              },
            ]
          : []
    )
    const store = createSlateProjectionStore(editor, source)
    const runtimeId = Editor.getRuntimeId(editor, [0, 0])

    expect(runtimeId).toBeTruthy()
    expect(store.getSnapshot()[runtimeId!]).toEqual([
      {
        data: { tone: 'bold' },
        end: 5,
        key: 'decorate:0.0:0',
        start: 0,
      },
    ])

    store.destroy()
  })

  test('adapts editor-owned legacy decorate callbacks with live node entries', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [
        {
          children: [{ text: 'Hello world!' }],
        },
      ],
      selection: null,
    })

    const source = SlateReactCompat.createSlateDecorateCompatSource(
      decoratePaths(editor, [
        {
          path: [],
          decorations: () => [
            {
              anchor: { path: [0, 0], offset: 0 },
              focus: { path: [0, 0], offset: 5 },
              tone: 'root',
            },
          ],
        },
      ]),
      { editor }
    )
    const store = createSlateProjectionStore(editor, source)
    const runtimeId = Editor.getRuntimeId(editor, [0, 0])

    expect(store.getSnapshot()[runtimeId!]).toEqual([
      {
        data: { tone: 'root' },
        end: 5,
        key: 'decorate::0',
        start: 0,
      },
    ])

    store.destroy()
  })

  test('projects editor-owned ranges across adjacent text nodes', () => {
    const editor = createEditor()
    const rendered = renderProjectedEditor(
      editor,
      [
        {
          children: [{ text: '0.0' }, { text: '0.1' }, { text: '0.2' }],
        },
        {
          children: [{ text: '1.0' }],
        },
        {
          children: [{ text: '2.0' }],
        },
      ],
      () => [
        {
          data: { bold: true },
          key: 'bold',
          range: {
            anchor: { path: [0, 1], offset: 0 },
            focus: { path: [1, 0], offset: 3 },
          },
        },
        {
          data: { italic: true },
          key: 'italic',
          range: {
            anchor: { path: [0, 2], offset: 0 },
            focus: { path: [0, 2], offset: 3 },
          },
        },
        {
          data: { underline: true },
          key: 'underline',
          range: {
            anchor: { path: [1, 0], offset: 0 },
            focus: { path: [1, 0], offset: 3 },
          },
        },
      ]
    )

    expect(getProjectedSegments(rendered.container)).toEqual([
      { text: '0.0', decorations: [] },
      { text: '0.1', decorations: ['bold'] },
      { text: '0.2', decorations: ['bold', 'italic'] },
      { text: '1.0', decorations: ['bold', 'underline'] },
      { text: '2.0', decorations: [] },
    ])

    rendered.store.destroy()
  })

  test('reprojects changed text and changed ancestors without legacy decorate', async () => {
    const editor = createEditor()
    const rendered = renderProjectedEditor(
      editor,
      [
        {
          children: [
            {
              children: [{ text: 'Hello world!' }],
            },
          ],
        },
      ],
      (snapshot) => {
        const root = snapshot.children[0] as
          | (Descendant & { bold?: true })
          | undefined
        const text = Node.get(
          { children: snapshot.children } as never,
          [0, 0, 0]
        ) as { text: string }
        const projections: SlateProjection<Record<string, unknown>>[] = []

        if (root && 'bold' in root) {
          projections.push({
            data: { bold: true },
            key: 'bold',
            range: {
              anchor: { path: [0, 0, 0], offset: 0 },
              focus: { path: [0, 0, 0], offset: text.text.length },
            },
          })
        }

        if (text.text.includes('box')) {
          projections.push({
            data: { italic: true },
            key: 'italic',
            range: {
              anchor: { path: [0, 0, 0], offset: 0 },
              focus: { path: [0, 0, 0], offset: text.text.length },
            },
          })
        }

        return projections
      }
    )

    expect(getProjectedSegments(rendered.container)).toEqual([
      { text: 'Hello world!', decorations: [] },
    ])

    await act(async () => {
      editor.update(() => {
        editor.setNodes({ bold: true } as never, { at: [0] })
      })
    })

    expect(getProjectedSegments(rendered.container)).toEqual([
      { text: 'Hello world!', decorations: ['bold'] },
    ])

    await act(async () => {
      editor.update(() => {
        editor.insertText('b', {
          at: {
            anchor: { path: [0, 0, 0], offset: 8 },
            focus: { path: [0, 0, 0], offset: 9 },
          },
        })
      })
    })

    expect(getProjectedSegments(rendered.container)).toEqual([
      { text: 'Hello wobld!', decorations: ['bold'] },
    ])

    rendered.store.destroy()
  })

  test('keeps projection identity stable when paths shift after structural edits', async () => {
    const editor = createEditor()
    const rendered = renderProjectedEditor(
      editor,
      [{ children: [{ text: 'A' }] }, { children: [{ text: 'B' }] }],
      (snapshot) => findTextRangesByText(snapshot.children, 'B')
    )

    expect(getProjectedSegments(rendered.container)).toEqual([
      { text: 'A', decorations: [] },
      { text: 'B', decorations: ['bold'] },
    ])

    await act(async () => {
      editor.update(() => {
        editor.insertNodes({ children: [{ text: '0' }] } as never, {
          at: [0],
        })
      })
    })

    expect(getProjectedSegments(rendered.container)).toEqual([
      { text: '0', decorations: [] },
      { text: 'A', decorations: [] },
      { text: 'B', decorations: ['bold'] },
    ])

    rendered.store.destroy()
  })
})
