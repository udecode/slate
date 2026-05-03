import { act, type RenderResult, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import {
  createEditor as createSlateEditor,
  type Descendant,
  Node,
  Path,
  Text,
} from 'slate'
import { Editor } from 'slate/internal'
import {
  createDecorationSource,
  createSlateProjectionStore,
  Editable,
  type ReactEditor,
  Slate,
  type SlateDecorationSource,
  type SlateProjection,
  type SlateProjectionSource,
  useDecorationSelector,
  useSlateProjections,
  withReact,
} from '../src'
import { ProjectionContext } from '../src/projection-context'

type SegmentLike = {
  slices: readonly { data?: Record<string, unknown> }[]
}

type RenderedProjectionEditor = RenderResult & {
  store: SlateDecorationSource<Record<string, unknown>>
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

  const store = createDecorationSource(editor, {
    id: 'test-source',
    read: ({ snapshot }) => source(snapshot),
  })
  const rendered = render(
    <Slate decorationSources={[store]} editor={editor}>
      <Editable renderSegment={renderSegment} />
    </Slate>
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
  test('registers product-noun decoration sources without a projectionStore prop', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [
        {
          children: [{ text: 'Hello' }, { text: 'world' }],
        },
      ],
      selection: null,
    })

    const search = createDecorationSource(editor, {
      id: 'search',
      read: ({ snapshot }) =>
        findTextRangesByText(snapshot.children, 'Hello').map((projection) => ({
          ...projection,
          data: { search: true },
          key: `search:${projection.key}`,
        })),
    })
    const spelling = createDecorationSource(editor, {
      id: 'spelling',
      read: ({ snapshot }) =>
        findTextRangesByText(snapshot.children, 'world').map((projection) => ({
          ...projection,
          data: { spelling: true },
          key: `spelling:${projection.key}`,
        })),
    })

    const rendered = render(
      <Slate decorationSources={[search, spelling]} editor={editor}>
        <Editable renderSegment={renderSegment} />
      </Slate>
    )

    expect(getProjectedSegments(rendered.container)).toEqual([
      { text: 'Hello', decorations: ['search'] },
      { text: 'world', decorations: ['spelling'] },
    ])

    search.destroy()
    spelling.destroy()
  })

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
      editor.update((tx) => {
        tx.nodes.set({ bold: true } as never, { at: [0] })
      })
    })

    expect(getProjectedSegments(rendered.container)).toEqual([
      { text: 'Hello world!', decorations: ['bold'] },
    ])

    await act(async () => {
      editor.update((tx) => {
        tx.text.insert('b', {
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
      editor.update((tx) => {
        tx.nodes.insert({ children: [{ text: '0' }] } as never, {
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

  test('mapped projection runtime buckets follow structural path changes through the source bus', async () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [{ children: [{ text: 'A' }] }, { children: [{ text: 'B' }] }],
      selection: null,
    })

    const snapshot = Editor.getSnapshot(editor)
    const firstRuntimeId = snapshot.index.pathToId['0.0']
    const secondRuntimeId = snapshot.index.pathToId['1.0']

    if (!firstRuntimeId || !secondRuntimeId) {
      throw new Error('Expected runtime ids for mapped projection proof')
    }

    let sourceCalls = 0
    let firstRuntimeNotifications = 0
    let secondRuntimeNotifications = 0
    const store = createSlateProjectionStore(
      editor,
      (nextSnapshot) => {
        sourceCalls += 1

        return nextSnapshot.children.flatMap((node, blockIndex) =>
          Text.isText(node)
            ? []
            : node.children.flatMap((child, textIndex) => {
                if (!Text.isText(child) || child.text !== 'B') {
                  return []
                }

                const path = [blockIndex, textIndex] as Path

                return [
                  {
                    data: { blockIndex },
                    key: `mapped:${child.text}`,
                    range: {
                      anchor: { path, offset: 0 },
                      focus: { path, offset: child.text.length },
                    },
                  },
                ]
              })
        )
      },
      {
        dirtiness: 'node',
        sourceId: 'mapped-node-source',
      }
    )

    store.subscribeRuntimeId(firstRuntimeId, () => {
      firstRuntimeNotifications += 1
    })
    store.subscribeRuntimeId(secondRuntimeId, () => {
      secondRuntimeNotifications += 1
    })

    expect(store.getRuntimeSnapshot(secondRuntimeId)).toEqual([
      {
        data: { blockIndex: 1 },
        end: 1,
        key: 'mapped:B',
        start: 0,
      },
    ])

    await act(async () => {
      editor.update((tx) => {
        tx.nodes.move({ at: [1], to: [0] })
      })
    })

    expect(Editor.getPathByRuntimeId(editor, secondRuntimeId)).toEqual([0, 0])
    expect(store.getRuntimeSnapshot(secondRuntimeId)).toEqual([
      {
        data: { blockIndex: 0 },
        end: 1,
        key: 'mapped:B',
        start: 0,
      },
    ])
    expect(sourceCalls).toBe(2)
    expect(firstRuntimeNotifications).toBe(0)
    expect(secondRuntimeNotifications).toBe(1)
    expect(store.getMetrics()).toMatchObject({
      changedRuntimeBucketCount: 1,
      recomputeCount: 1,
      runtimeSubscriberWakeCount: 1,
      sourceReadCount: 2,
    })

    store.destroy()
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
      editor.update((tx) => {
        tx.text.insert('!', {
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
      editor.update((tx) => {
        tx.text.insert('!', {
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
      editor.update((tx) => {
        tx.text.insert('!', {
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
      editor.update((tx) => {
        tx.text.insert('!', {
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
      editor.update((tx) => {
        tx.text.insert('!', {
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

  test('projection stores receive editor changes through the source bus', async () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [{ children: [{ text: 'A' }] }],
      selection: null,
    })

    const originalSubscribe = editor.subscribe
    editor.subscribe = (() => {
      throw new Error('Unexpected broad editor.subscribe fan-in')
    }) as typeof editor.subscribe

    let sourceCalls = 0
    const store = createSlateProjectionStore(
      editor,
      (nextSnapshot) => {
        sourceCalls += 1
        const text = Node.get(
          { children: nextSnapshot.children } as never,
          [0, 0]
        ) as { text: string }

        return [
          {
            data: { text: true },
            key: 'text-source',
            range: {
              anchor: { path: [0, 0], offset: 0 },
              focus: {
                path: [0, 0],
                offset: text.text.length,
              },
            },
          },
        ]
      },
      {
        dirtiness: 'text',
        sourceId: 'text-source',
      }
    )

    try {
      await act(async () => {
        editor.update((tx) => {
          tx.text.insert('!', {
            at: {
              anchor: { path: [0, 0], offset: 1 },
              focus: { path: [0, 0], offset: 1 },
            },
          })
        })
      })

      expect(sourceCalls).toBe(2)
      expect(store.getMetrics().recomputeCount).toBe(1)
    } finally {
      store.destroy()
      editor.subscribe = originalSubscribe
    }
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
    expect(store.getMetrics()).toMatchObject({
      changedRuntimeBucketCount: 1,
      globalSubscriberWakeCount: 1,
      projectedRangeCount: 1,
      recomputeCount: 1,
      runtimeSubscriberWakeCount: 1,
      sourceReadCount: 2,
      sourceSubscriberWakeCount: 1,
    })
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
