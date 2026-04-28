import { act, type RenderResult, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import {
  createEditor as createSlateEditor,
  type Descendant,
  Editor,
  Node,
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
  useDecorationSelector,
  useSlateProjections,
  withReact,
} from '../src'
import { ProjectionContext } from '../src/projection-context'

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

  test('reprojects changed text and changed ancestors from typed projection sources', async () => {
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

  test('notifies only subscribers for runtime ids whose projection slices changed', async () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [{ children: [{ text: 'A' }] }, { children: [{ text: 'B' }] }],
      selection: null,
    })

    const snapshot = Editor.getSnapshot(editor)
    const firstRuntimeId = snapshot.index.pathToId['0.0']
    const secondRuntimeId = snapshot.index.pathToId['1.0']

    if (!firstRuntimeId || !secondRuntimeId) {
      throw new Error('Expected runtime ids for projection subscription proof')
    }

    const store = createSlateProjectionStore(editor, (nextSnapshot) =>
      nextSnapshot.children.flatMap((node, blockIndex) =>
        Text.isText(node)
          ? []
          : node.children.flatMap((child, textIndex) => {
              if (!Text.isText(child) || !child.text.startsWith('B')) {
                return []
              }

              const path = [blockIndex, textIndex] as Path

              return [
                {
                  data: { highlight: true },
                  key: `starts-with-b:${path.join('.')}`,
                  range: {
                    anchor: { path, offset: 0 },
                    focus: { path, offset: child.text.length },
                  },
                },
              ]
            })
      )
    )

    const renders = {
      first: 0,
      second: 0,
    }

    const ProjectionProbe = ({
      label,
      runtimeId,
    }: {
      label: keyof typeof renders
      runtimeId: string
    }) => {
      const projections = useSlateProjections(runtimeId)

      renders[label] += 1

      return <span data-testid={label}>{projections.length}</span>
    }

    const rendered = render(
      <ProjectionContext.Provider value={store}>
        <ProjectionProbe label="first" runtimeId={firstRuntimeId} />
        <ProjectionProbe label="second" runtimeId={secondRuntimeId} />
      </ProjectionContext.Provider>
    )

    expect(rendered.getByTestId('first').textContent).toBe('0')
    expect(rendered.getByTestId('second').textContent).toBe('1')
    expect(renders).toEqual({ first: 1, second: 1 })

    await act(async () => {
      editor.update(() => {
        editor.insertText('!', {
          at: {
            anchor: { path: [1, 0], offset: 1 },
            focus: { path: [1, 0], offset: 1 },
          },
        })
      })
    })

    expect(rendered.getByTestId('first').textContent).toBe('0')
    expect(rendered.getByTestId('second').textContent).toBe('1')
    expect(renders).toEqual({ first: 1, second: 2 })

    store.destroy()
  })

  test('useDecorationSelector derives one runtime id without rerendering for sibling projections', async () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [{ children: [{ text: 'A' }] }, { children: [{ text: 'B' }] }],
      selection: null,
    })

    const snapshot = Editor.getSnapshot(editor)
    const firstRuntimeId = snapshot.index.pathToId['0.0']
    const secondRuntimeId = snapshot.index.pathToId['1.0']

    if (!firstRuntimeId || !secondRuntimeId) {
      throw new Error('Expected runtime ids for decoration selector proof')
    }

    const store = createSlateProjectionStore(editor, (nextSnapshot) =>
      nextSnapshot.children.flatMap((node, blockIndex) =>
        Text.isText(node)
          ? []
          : node.children.flatMap((child, textIndex) => {
              if (!Text.isText(child)) {
                return []
              }

              const path = [blockIndex, textIndex] as Path

              return [
                {
                  data: { label: child.text },
                  key: `label:${path.join('.')}`,
                  range: {
                    anchor: { path, offset: 0 },
                    focus: { path, offset: child.text.length },
                  },
                },
              ]
            })
      )
    )
    const renders = {
      first: 0,
    }
    const decorationSelector = vi.fn(({ projections }) =>
      projections.map((projection) => projection.data?.label).join(',')
    )

    const ProjectionProbe = () => {
      const label = useDecorationSelector(decorationSelector, undefined, {
        runtimeId: firstRuntimeId,
      })

      renders.first += 1

      return <span data-testid="first-decoration">{label}</span>
    }

    const rendered = render(
      <ProjectionContext.Provider value={store}>
        <ProjectionProbe />
      </ProjectionContext.Provider>
    )

    expect(rendered.getByTestId('first-decoration').textContent).toBe('A')
    expect(renders.first).toBe(1)
    expect(decorationSelector).toBeCalledTimes(2)

    await act(async () => {
      editor.update(() => {
        editor.insertText('!', {
          at: {
            anchor: { path: [1, 0], offset: 1 },
            focus: { path: [1, 0], offset: 1 },
          },
        })
      })
    })

    expect(rendered.getByTestId('first-decoration').textContent).toBe('A')
    expect(renders.first).toBe(1)
    expect(decorationSelector).toBeCalledTimes(2)

    await act(async () => {
      editor.update(() => {
        editor.insertText('!', {
          at: {
            anchor: { path: [0, 0], offset: 1 },
            focus: { path: [0, 0], offset: 1 },
          },
        })
      })
    })

    expect(rendered.getByTestId('first-decoration').textContent).toBe('A!')
    expect(renders.first).toBe(2)
    expect(decorationSelector).toBeCalledTimes(3)

    expect(store.getRuntimeSnapshot(secondRuntimeId)).toHaveLength(1)

    store.destroy()
  })

  test('skips source recompute when decoration impact misses the source runtime scope', async () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [{ children: [{ text: 'A' }] }, { children: [{ text: 'B' }] }],
      selection: null,
    })

    const snapshot = Editor.getSnapshot(editor)
    const firstRuntimeId = snapshot.index.pathToId['0.0']

    if (!firstRuntimeId) {
      throw new Error('Expected runtime id for source recompute proof')
    }

    let sourceCalls = 0
    const store = createSlateProjectionStore(
      editor,
      (nextSnapshot) => {
        sourceCalls += 1
        const firstText = Node.get(
          { children: nextSnapshot.children } as never,
          [0, 0]
        ) as { text: string }

        return [
          {
            data: { scoped: true },
            key: 'first-text',
            range: {
              anchor: { path: [0, 0], offset: 0 },
              focus: { path: [0, 0], offset: firstText.text.length },
            },
          },
        ]
      },
      {
        dirtiness: 'text',
        runtimeScope: () => [firstRuntimeId],
      }
    )

    expect(sourceCalls).toBe(1)
    expect(store.getMetrics().recomputeCount).toBe(0)

    await act(async () => {
      editor.update(() => {
        editor.insertText('!', {
          at: {
            anchor: { path: [1, 0], offset: 1 },
            focus: { path: [1, 0], offset: 1 },
          },
        })
      })
    })

    expect(sourceCalls).toBe(1)
    expect(store.getMetrics().recomputeCount).toBe(0)

    await act(async () => {
      editor.update(() => {
        editor.insertText('!', {
          at: {
            anchor: { path: [0, 0], offset: 1 },
            focus: { path: [0, 0], offset: 1 },
          },
        })
      })
    })

    expect(sourceCalls).toBe(2)
    expect(store.getMetrics().recomputeCount).toBe(1)

    store.destroy()
  })

  test('targeted source refresh only recomputes and notifies the matching source id', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [{ children: [{ text: 'A' }] }],
      selection: null,
    })

    const runtimeId = Editor.getRuntimeId(editor, [0, 0])

    if (!runtimeId) {
      throw new Error('Expected runtime id for source subscription proof')
    }

    let active = false
    let sourceCalls = 0
    let globalNotifications = 0
    let runtimeNotifications = 0
    let sourceNotifications = 0
    const store = createSlateProjectionStore(
      editor,
      () => {
        sourceCalls += 1

        return active
          ? [
              {
                data: { scoped: true },
                key: 'targeted-source',
                range: {
                  anchor: { path: [0, 0], offset: 0 },
                  focus: { path: [0, 0], offset: 1 },
                },
              },
            ]
          : []
      },
      {
        dirtiness: 'external',
        sourceId: 'targeted-source',
      }
    )

    store.subscribe(() => {
      globalNotifications += 1
    })
    store.subscribeRuntimeId(runtimeId, () => {
      runtimeNotifications += 1
    })
    store.subscribeSourceId('targeted-source', () => {
      sourceNotifications += 1
    })
    store.subscribeSourceId('other-source', () => {
      throw new Error('Unexpected source notification')
    })

    expect(sourceCalls).toBe(1)
    expect(store.getRuntimeSnapshot(runtimeId)).toEqual([])

    active = true
    store.refresh({ reason: 'external', sourceId: 'other-source' })

    expect(sourceCalls).toBe(1)
    expect(globalNotifications).toBe(0)
    expect(runtimeNotifications).toBe(0)
    expect(sourceNotifications).toBe(0)
    expect(store.getRuntimeSnapshot(runtimeId)).toEqual([])

    store.refresh({ reason: 'external', sourceId: 'targeted-source' })

    expect(sourceCalls).toBe(2)
    expect(globalNotifications).toBe(1)
    expect(runtimeNotifications).toBe(1)
    expect(sourceNotifications).toBe(1)
    expect(store.getRuntimeSnapshot(runtimeId)).toEqual([
      {
        data: { scoped: true },
        end: 1,
        key: 'targeted-source',
        start: 0,
      },
    ])

    store.destroy()
  })

  test('force refresh invalidates mounted runtime subscribers even when slices are unchanged', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [{ children: [{ text: 'A' }] }],
      selection: null,
    })

    const runtimeId = Editor.getRuntimeId(editor, [0, 0])

    if (!runtimeId) {
      throw new Error('Expected runtime id for forced projection refresh proof')
    }

    let notifications = 0
    const store = createSlateProjectionStore(editor, () => [], {
      dirtiness: 'external',
    })

    store.subscribeRuntimeId(runtimeId, () => {
      notifications += 1
    })

    store.refresh({ forceInvalidate: true, reason: 'external' })

    expect(notifications).toBe(1)
    expect(store.getRuntimeSnapshot(runtimeId)).toEqual([])

    store.destroy()
  })
})
