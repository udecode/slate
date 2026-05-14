import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { act, render } from '@testing-library/react'
import { type ComponentProps, useEffect } from 'react'
import { createEditor, type Value } from 'slate'
import * as SlateReact from '../src'
import {
  Editable,
  type EditableCommandContext,
  editableRenderers,
  type ReactEditor,
  type RenderElementProps,
  type RenderVoidProps,
  Slate,
  useElementSelected,
  withReact,
} from '../src'

const cwd = process.cwd()
const packageRoot = cwd.endsWith(`${sep}packages${sep}slate-react`)
  ? cwd
  : resolve(cwd, 'packages/slate-react')
const repoRoot = resolve(packageRoot, '../..')
const sourceFilePattern = /\.(md|ts|tsx)$/

const createReactEditor = <V extends Value>(initialValue: V) =>
  withReact(createEditor({ initialValue }))

type ExpectFalse<T extends false> = T
type RenderElementHasPath = 'path' extends keyof RenderElementProps
  ? true
  : false
type RenderElementHasIndex = 'index' extends keyof RenderElementProps
  ? true
  : false
type RenderVoidHasPath = 'path' extends keyof RenderVoidProps ? true : false

type RenderElementDoesNotExposePath = ExpectFalse<RenderElementHasPath>
type RenderElementDoesNotExposeIndex = ExpectFalse<RenderElementHasIndex>
type RenderVoidDoesNotExposePath = ExpectFalse<RenderVoidHasPath>
type EditableDOMBeforeInputProps = ComponentProps<
  typeof Editable
>['onDOMBeforeInput']
type EditableCommandProps = ComponentProps<typeof Editable>['onCommand']

void (null as unknown as RenderElementDoesNotExposePath)
void (null as unknown as RenderElementDoesNotExposeIndex)
void (null as unknown as RenderVoidDoesNotExposePath)
void (null as unknown as EditableDOMBeforeInputProps)
void (null as unknown as EditableCommandProps)

const listSourceFiles = (roots: readonly string[]) => {
  const files: string[] = []

  const visit = (absolutePath: string) => {
    const stats = statSync(absolutePath)

    if (stats.isDirectory()) {
      for (const child of readdirSync(absolutePath)) {
        visit(join(absolutePath, child))
      }
      return
    }

    if (sourceFilePattern.test(absolutePath)) {
      files.push(absolutePath)
    }
  }

  for (const root of roots) {
    const absoluteRoot = resolve(repoRoot, root)

    if (existsSync(absoluteRoot)) {
      visit(absoluteRoot)
    }
  }

  return files
}

const allowedSlateInternalImportFiles = new Set([
  'packages/slate-react/src/editable/runtime-editor-api.ts',
  'packages/slate-react/src/editable/runtime-live-state.ts',
  'packages/slate-react/src/editable/runtime-mutation-state.ts',
  'packages/slate-react/src/editable/runtime-selection-state.ts',
])

type SurfaceInventory = Record<
  string,
  {
    count: number
    next: 'burn-down' | 'public-hook' | 'root-source' | 'runtime-wrapper'
    owner: string
    rationale: string
  }
>

const expectSurfaceInventory = (
  pattern: RegExp,
  roots: readonly string[],
  inventory: SurfaceInventory
) => {
  const actual = Object.fromEntries(
    listSourceFiles(roots)
      .map((absolutePath) => {
        const contents = readFileSync(absolutePath, 'utf8')
        const matches = contents.match(pattern)

        return [
          relative(repoRoot, absolutePath),
          matches ? matches.length : 0,
        ] as const
      })
      .filter(([, count]) => count > 0)
      .sort(([a], [b]) => a.localeCompare(b))
  )

  expect(actual).toEqual(
    Object.fromEntries(
      Object.entries(inventory).map(([file, entry]) => [file, entry.count])
    )
  )
  expect(
    Object.values(inventory).every(
      (entry) =>
        entry.owner.length > 0 &&
        entry.rationale.length > 0 &&
        entry.next.length > 0
    )
  ).toBe(true)
}

describe('slate-react surface contract', () => {
  test('Editable exposes native beforeinput context and semantic command handlers', () => {
    const editor = createReactEditor([
      { type: 'paragraph', children: [{ text: 'test' }] },
    ])
    let commandContext: EditableCommandContext | null = null

    render(
      <Slate editor={editor}>
        <Editable
          onCommand={(command, context) => {
            commandContext = context

            if (command.kind === 'format') {
              return command.format === 'bold'
            }
          }}
          onDOMBeforeInput={(event, context) => {
            event.preventDefault()
            context.editor.update(() => {})
            return true
          }}
        />
      </Slate>
    )

    expect(commandContext).toBe(null)
  })

  test('synced text render policy stays out of the public selector surface', () => {
    const publicRoots = [
      'docs/api',
      'docs/concepts',
      'docs/libraries',
      'docs/walkthroughs',
      'packages/slate-react/src',
      'site/examples/ts',
    ]
    const stalePublicOptionViolations = listSourceFiles(publicRoots).flatMap(
      (absolutePath) => {
        const contents = readFileSync(absolutePath, 'utf8')

        return contents.includes('skipSyncedTextOperations')
          ? [relative(repoRoot, absolutePath)]
          : []
      }
    )
    const packageIndex = readFileSync(
      resolve(packageRoot, 'src/index.ts'),
      'utf8'
    )

    expect(stalePublicOptionViolations).toEqual([])
    expect(packageIndex).not.toMatch(/useMounted(?:Node|Text)RenderSelector/)
  })

  test('core live reads stay behind slate-react runtime facade modules', () => {
    const violations = listSourceFiles(['packages/slate-react/src']).flatMap(
      (absolutePath) => {
        const contents = readFileSync(absolutePath, 'utf8')
        const relativePath = relative(repoRoot, absolutePath)

        return contents.includes("from 'slate/internal'") &&
          !allowedSlateInternalImportFiles.has(relativePath)
          ? [relativePath]
          : []
      }
    )

    expect(violations).toEqual([])
  })

  test('generic selector substrate uses React external-store subscription primitive', () => {
    const contents = readFileSync(
      resolve(
        repoRoot,
        'packages/slate-react/src/hooks/use-generic-selector.tsx'
      ),
      'utf8'
    )

    expect(contents).toMatch(/\buseSyncExternalStore\b/)
    expect(contents).not.toMatch(/\buseReducer\b/)
  })

  test('generic slate selectors have an explicit ownership inventory', () => {
    expectSurfaceInventory(
      /\buseEditorSelector\(/g,
      ['packages/slate-react/src'],
      {
        'packages/slate-react/src/editable/root-selector-sources.ts': {
          count: 5,
          next: 'root-source',
          owner: 'Editable root selector sources',
          rationale:
            'Top-level runtime ids, root document epoch, selected top-level index, placeholder visibility, and the editable root commit wakeup are owned by named root source selectors.',
        },
        'packages/slate-react/src/hooks/use-node-selector.tsx': {
          count: 1,
          next: 'runtime-wrapper',
          owner: 'Runtime node selector wrapper',
          rationale:
            'Public node/text selectors intentionally delegate through one model-truth selector wrapper.',
        },
        'packages/slate-react/src/hooks/use-element-selected.ts': {
          count: 1,
          next: 'public-hook',
          owner: 'Public selected hook',
          rationale:
            'The hook exposes selection state to app code through the public selector contract.',
        },
        'packages/slate-react/src/hooks/use-element-path.ts': {
          count: 1,
          next: 'public-hook',
          owner: 'Public element path hook',
          rationale:
            'The hook exposes path state to app code without adding path back to render props.',
        },
        'packages/slate-react/src/hooks/use-editor-selection.tsx': {
          count: 1,
          next: 'public-hook',
          owner: 'Public selection hook',
          rationale:
            'The hook exposes editor selection through the public selector contract.',
        },
      }
    )
  })

  test('void authoring helpers stay out of the public surface and examples', () => {
    const packageIndex = readFileSync(
      resolve(packageRoot, 'src/index.ts'),
      'utf8'
    )
    const exampleViolations = listSourceFiles(['site/examples/ts']).flatMap(
      (absolutePath) => {
        const contents = readFileSync(absolutePath, 'utf8')

        return /\b(?:VoidElement|InlineVoidElement)\b/.test(contents)
          ? [relative(repoRoot, absolutePath)]
          : []
      }
    )

    expect(packageIndex).not.toMatch(/\bVoidElement\b/)
    expect(packageIndex).not.toMatch(/\bInlineVoidElement\b/)
    expect(packageIndex).not.toMatch(/\bSlateSpacer\b/)
    expect(exampleViolations).toEqual([])
  })

  test('public host authoring uses installed DOM capabilities', () => {
    const packageIndex = readFileSync(
      resolve(packageRoot, 'src/index.ts'),
      'utf8'
    )
    const publicHostStaticCalls = listSourceFiles([
      'docs/api',
      'docs/concepts',
      'docs/libraries',
      'docs/walkthroughs',
      'site/examples/ts',
    ]).flatMap((absolutePath) => {
      const contents = readFileSync(absolutePath, 'utf8')

      return /\b(?:ReactEditor|DOMEditor)\./.test(contents)
        ? [relative(repoRoot, absolutePath)]
        : []
    })

    expect(packageIndex).not.toMatch(/export\s*\{\s*ReactEditor\b/)
    expect(publicHostStaticCalls).toEqual([])
  })

  test('examples initialize editor values before the provider', () => {
    const exampleFiles = listSourceFiles(['site/examples/ts'])
    const providerInitialValueViolations = exampleFiles.flatMap(
      (absolutePath) => {
        const contents = readFileSync(absolutePath, 'utf8')

        return /\binitialValue=/.test(contents)
          ? [relative(repoRoot, absolutePath)]
          : []
      }
    )
    const valueReplaceInventory = Object.fromEntries(
      exampleFiles
        .map((absolutePath) => {
          const contents = readFileSync(absolutePath, 'utf8')
          const matches = contents.match(/\btx\.value\.replace\(/g)

          return [
            relative(repoRoot, absolutePath),
            matches ? matches.length : 0,
          ] as const
        })
        .filter(([, count]) => count > 0)
        .sort(([a], [b]) => a.localeCompare(b))
    )

    expect(providerInitialValueViolations).toEqual([])
    expect(valueReplaceInventory).toEqual({
      'site/examples/ts/collaborative-comments.tsx': 1,
      'site/examples/ts/rendering-strategy-runtime.tsx': 1,
    })
  })

  test('product comment examples use public annotation substrate', () => {
    const exampleFiles = [
      'site/examples/ts/review-comments.tsx',
      'site/examples/ts/collaborative-comments.tsx',
    ]

    for (const file of exampleFiles) {
      const contents = readFileSync(resolve(repoRoot, file), 'utf8')

      expect(contents).toMatch(/from 'slate'/)
      expect(contents).toMatch(/from 'slate-react'/)
      expect(contents).toMatch(/\bBookmark\b/)
      expect(contents).toMatch(/\buseSlateAnnotationStore\b/)
      expect(contents).toMatch(/\buseSlateAnnotations\b/)
      expect(contents).toMatch(/\bannotationStore=/)
      expect(contents).not.toMatch(
        /(?:createSlateProjectionStore|ProjectionContext|projection-store|useSlateProjections|from 'slate-react\/src)/
      )
    }
  })

  test('slate-react overlay docs expose simple and scalable public paths', () => {
    const docs = {
      annotations: readFileSync(
        resolve(repoRoot, 'docs/libraries/slate-react/annotations.md'),
        'utf8'
      ),
      editable: readFileSync(
        resolve(repoRoot, 'docs/libraries/slate-react/editable.md'),
        'utf8'
      ),
      hooks: readFileSync(
        resolve(repoRoot, 'docs/libraries/slate-react/hooks.md'),
        'utf8'
      ),
      slate: readFileSync(
        resolve(repoRoot, 'docs/libraries/slate-react/slate.md'),
        'utf8'
      ),
    }
    const joinedDocs = Object.values(docs).join('\n')

    expect(docs.editable).toMatch(/\bdecorate\?:/)
    expect(docs.editable).toMatch(/\bEditable\.decorate\b/)
    expect(docs.slate).toMatch(/\bdecorationSources\b/)
    expect(docs.slate).toMatch(/\buseSlateDecorationSource\b/)
    expect(docs.annotations).toMatch(/\buseSlateAnnotationStore\b/)
    expect(docs.annotations).toMatch(/\buseSlateAnnotations\b/)
    expect(docs.hooks).toMatch(/\buseSlateWidgetStore\b/)
    expect(docs.hooks).toMatch(/\buseSlateWidgets\b/)
    expect(joinedDocs).not.toMatch(
      /(?:createSlateProjectionStore|ProjectionContext|from 'slate-react\/src)/
    )
  })

  test('beginner rendering docs teach registered renderers instead of callback memoization', () => {
    const docs = [
      'docs/concepts/09-rendering.md',
      'docs/walkthroughs/03-defining-custom-elements.md',
      'docs/walkthroughs/04-applying-custom-formatting.md',
      'docs/walkthroughs/05-executing-commands.md',
      'docs/walkthroughs/09-performance.md',
    ]
      .map((file) => readFileSync(resolve(repoRoot, file), 'utf8'))
      .join('\n')

    expect(docs).toMatch(/\beditableRenderers\b/)
    expect(docs).not.toMatch(/\buseCallback\b/)
  })

  test('adapter static namespaces stay out of the public root at runtime', () => {
    expect('ReactEditor' in SlateReact).toBe(false)
    expect('DOMEditor' in SlateReact).toBe(false)
    expect(SlateReact.withReact).toBe(withReact)
  })

  test('virtualized rendering stays object-only and experimental', () => {
    const segmentPlanSource = readFileSync(
      resolve(packageRoot, 'src/rendering-strategy/create-segment-plan.ts'),
      'utf8'
    )
    const editableSource = readFileSync(
      resolve(packageRoot, 'src/components/editable-text-blocks.tsx'),
      'utf8'
    )

    const renderingStrategyType = segmentPlanSource.match(
      /export type RenderingStrategyType =([\s\S]*?)export type RenderingStrategyOptions =/
    )?.[1]

    expect(renderingStrategyType).not.toContain("'virtualized'")
    expect(segmentPlanSource).toContain("type: 'virtualized'")
    expect(segmentPlanSource).toContain('Intentionally object-only')
    expect(editableSource).toContain('`virtualized` is experimental')
  })

  test('Editable renderingStrategy option objects normalize through primitive fields', () => {
    const editableSource = readFileSync(
      resolve(packageRoot, 'src/components/editable-text-blocks.tsx'),
      'utf8'
    )

    expect(editableSource).toMatch(/\brenderingStrategyShellOverscan\b/)
    expect(editableSource).toMatch(/\brenderingStrategyVirtualizedOverscan\b/)
    expect(editableSource).not.toContain(
      '[renderingStrategyType, renderingStrategyShellOptions]'
    )
    expect(editableSource).not.toContain(
      '[renderingStrategyType, renderingStrategyVirtualizedOptions]'
    )
  })

  test('saving walkthrough uses lazy state for one-shot initial content', () => {
    const docs = readFileSync(
      resolve(repoRoot, 'docs/walkthroughs/06-saving-to-a-database.md'),
      'utf8'
    )

    expect(docs).toMatch(/\bconst \[initialValue\] = useState\(\(\) =>/)
    expect(docs).not.toMatch(/\buseMemo\b/)
  })

  test('hotkey examples use registered key commands instead of raw Editable keydown props', () => {
    for (const file of [
      'site/examples/ts/iframe.tsx',
      'site/examples/ts/images.tsx',
      'site/examples/ts/richtext.tsx',
    ]) {
      const source = readFileSync(resolve(repoRoot, file), 'utf8')

      expect(source).toMatch(/\beditableKeyCommands\b/)
      expect(source).not.toMatch(/\bonKeyDown=/)
    }
  })

  test('Editable defaults translate="no" and allows override', () => {
    const initialValue = [{ type: 'block', children: [{ text: 'test' }] }]
    const editor = createReactEditor(initialValue)

    const defaultRender = render(
      <Slate editor={editor}>
        <Editable />
      </Slate>
    )

    expect(
      defaultRender.container
        .querySelector('[data-slate-editor]')
        ?.getAttribute('translate')
    ).toBe('no')

    defaultRender.rerender(
      <Slate editor={editor}>
        <Editable translate="yes" />
      </Slate>
    )

    expect(
      defaultRender.container
        .querySelector('[data-slate-editor]')
        ?.getAttribute('translate')
    ).toBe('yes')
  })

  test('Editable consumes extension-registered element, leaf, text, segment, and void renderers', () => {
    const editor = createReactEditor([
      {
        type: 'code',
        children: [{ text: 'const answer = 42', bold: true }],
      },
      {
        type: 'image',
        url: 'about:blank',
        children: [{ text: '' }],
      },
    ]) as ReactEditor

    editor.extend({
      capabilities: editableRenderers({
        elements: {
          code: ({ attributes, children }) => (
            <pre {...attributes} data-renderer="code">
              <code>{children}</code>
            </pre>
          ),
        },
        leaves: {
          bold: ({ children }) => (
            <strong data-renderer="bold">{children}</strong>
          ),
        },
        segment: (segment, children) => (
          <mark data-renderer="segment" data-start={segment.start}>
            {children}
          </mark>
        ),
        text: ({ attributes, children }) => (
          <span {...attributes} data-renderer="text">
            {children}
          </span>
        ),
        voids: {
          image: ({ element }) => (
            <img
              alt=""
              data-renderer="image"
              height={1}
              src={(element as { url: string }).url}
              width={1}
            />
          ),
        },
      }),
      elements: [{ type: 'image', void: 'block' }],
      name: 'test-renderers',
    })

    const rendered = render(
      <Slate editor={editor}>
        <Editable />
      </Slate>
    )

    expect(
      rendered.container.querySelector('[data-renderer="code"]')
    ).toBeTruthy()
    expect(
      rendered.container.querySelector('[data-renderer="bold"]')
    ).toBeTruthy()
    expect(
      rendered.container.querySelector('[data-renderer="segment"]')
    ).toBeTruthy()
    expect(
      rendered.container.querySelector('[data-renderer="text"]')
    ).toBeTruthy()
    expect(
      rendered.container.querySelector('[data-renderer="image"]')
    ).toBeTruthy()
  })

  test('raw Editable render props override extension-registered renderers', () => {
    const editor = createReactEditor([
      { type: 'code', children: [{ text: 'const answer = 42' }] },
    ])

    editor.extend({
      capabilities: editableRenderers({
        elements: {
          code: ({ attributes, children }) => (
            <pre {...attributes} data-renderer="registered">
              {children}
            </pre>
          ),
        },
      }),
      name: 'test-registered-renderer-override',
    })

    const rendered = render(
      <Slate editor={editor}>
        <Editable
          renderElement={({ attributes, children }) => (
            <div {...attributes} data-renderer="raw">
              {children}
            </div>
          )}
        />
      </Slate>
    )

    expect(
      rendered.container.querySelector('[data-renderer="raw"]')
    ).toBeTruthy()
    expect(
      rendered.container.querySelector('[data-renderer="registered"]')
    ).toBeNull()
  })

  test('structured render surface keeps mount identity stable across split and merge', async () => {
    const editor = createReactEditor([
      { type: 'block', children: [{ text: 'test' }] },
    ])
    const mounts = jest.fn()

    const renderElement = ({ children }: RenderElementProps) => {
      useEffect(() => mounts(), [])
      return <div>{children}</div>
    }

    const rendered = render(
      <Slate editor={editor}>
        <Editable renderElement={renderElement} />
      </Slate>
    )

    await act(async () => {
      editor.update((tx) => {
        tx.nodes.split({ at: { path: [0, 0], offset: 2 } })
      })
    })

    expect(mounts).toHaveBeenCalledTimes(2)
    rendered.unmount()

    const mergeEditor = createReactEditor([
      { type: 'block', children: [{ text: 'te' }] },
      { type: 'block', children: [{ text: 'st' }] },
    ])
    const mergeMounts = jest.fn()

    const mergeRenderElement = ({ children }: RenderElementProps) => {
      useEffect(() => mergeMounts(), [])
      return <div>{children}</div>
    }

    render(
      <Slate editor={mergeEditor}>
        <Editable renderElement={mergeRenderElement} />
      </Slate>
    )

    await act(async () => {
      mergeEditor.update((tx) => {
        tx.nodes.merge({ at: { path: [0, 0], offset: 0 } })
      })
    })

    expect(mergeMounts).toHaveBeenCalledTimes(2)
  })

  test('useElementSelected remains stable when the selected element path shifts after structural edits', async () => {
    const editor = createReactEditor([
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
    ]) as ReactEditor
    const elementSelectedRenders: Record<string, boolean[] | undefined> = {}

    const renderElement = ({
      element,
      attributes,
      children,
    }: RenderElementProps) => {
      // eslint-disable-next-line react-hooks/rules-of-hooks
      const selected = useElementSelected()
      const { id } = element as { id: string }

      let selectedRenders = elementSelectedRenders[id]

      if (!selectedRenders) {
        selectedRenders = []
        elementSelectedRenders[id] = selectedRenders
      }

      selectedRenders.push(selected)

      return <div {...attributes}>{children}</div>
    }

    render(
      <Slate editor={editor}>
        <Editable renderElement={renderElement} />
      </Slate>
    )

    Object.values(elementSelectedRenders).forEach((selectedRenders) => {
      selectedRenders?.splice(0, selectedRenders.length)
    })

    await act(async () => {
      editor.update((tx) => {
        tx.selection.set({ path: [2, 0], offset: 0 })
      })
    })

    expect(elementSelectedRenders).toEqual({
      '0': [],
      '0.0': [],
      '0.1': [],
      '0.2': [],
      '1': [],
      '2': [true],
    })

    Object.values(elementSelectedRenders).forEach((selectedRenders) => {
      selectedRenders?.splice(0, selectedRenders.length)
    })

    await act(async () => {
      editor.update((tx) => {
        tx.nodes.insert({ id: 'new', children: [{ text: '' }] } as never, {
          at: [2],
        })
      })
    })

    expect(elementSelectedRenders).toEqual({
      '0': [],
      '0.0': [],
      '0.1': [],
      '0.2': [],
      '1': [],
      new: [false, false],
      '2': [true],
    })
  })

  test('custom element handlers resolve the current path after leading inserts without shifted rerender', async () => {
    const editor = createReactEditor([
      { id: 'first', children: [{ text: '' }] },
      { id: 'target', children: [{ text: '' }] },
    ]) as ReactEditor
    const renderCounts: Record<string, number | undefined> = {}
    let readTargetPath = (): number[] => {
      throw new Error('Target element did not render.')
    }

    const renderElement = ({
      attributes,
      children,
      element,
    }: RenderElementProps) => {
      const { id } = element as { id: string }
      renderCounts[id] = (renderCounts[id] ?? 0) + 1

      if (id === 'target') {
        readTargetPath = () => editor.dom.findPath(element)
      }

      return <div {...attributes}>{children}</div>
    }

    render(
      <Slate editor={editor}>
        <Editable renderElement={renderElement} />
      </Slate>
    )

    expect(readTargetPath()).toEqual([1])
    renderCounts.first = 0
    renderCounts.target = 0

    await act(async () => {
      editor.update((tx) => {
        tx.nodes.insert({ id: 'inserted', children: [{ text: '' }] } as never, {
          at: [0],
        })
      })
    })

    expect(renderCounts.target ?? 0).toBe(0)
    expect(readTargetPath()).toEqual([2])
  })

  test('renderVoid receives content-only props and runtime owns block void spacer', () => {
    const editor = createReactEditor([
      { type: 'image', url: 'about:blank', children: [{ text: '' }] },
    ]) as ReactEditor
    let renderVoidProps: RenderVoidProps | null = null
    const renderElement = jest.fn(({ children }: RenderElementProps) => {
      return <p>{children}</p>
    })

    editor.extend({
      elements: [{ type: 'image', void: 'block' }],
      name: 'test-block-void',
    })

    const renderVoid = (props: RenderVoidProps) => {
      renderVoidProps = props

      return <img alt="" height={1} src="about:blank" width={1} />
    }

    const rendered = render(
      <Slate editor={editor}>
        <Editable renderElement={renderElement} renderVoid={renderVoid} />
      </Slate>
    )

    const voidElement = rendered.container.querySelector(
      '[data-slate-node="element"][data-slate-void="true"]'
    )
    const spacer = rendered.container.querySelector('[data-slate-spacer]')
    const image = rendered.container.querySelector('img')

    expect(renderElement).not.toHaveBeenCalled()
    expect(renderVoidProps).toBeTruthy()
    expect(renderVoidProps?.element.type).toBe('image')
    expect('path' in (renderVoidProps as object)).toBe(false)
    expect('target' in (renderVoidProps as object)).toBe(false)
    expect('actions' in (renderVoidProps as object)).toBe(false)
    expect('selected' in (renderVoidProps as object)).toBe(false)
    expect('focused' in (renderVoidProps as object)).toBe(false)
    expect('children' in (renderVoidProps as object)).toBe(false)
    expect('attributes' in (renderVoidProps as object)).toBe(false)
    expect(voidElement).toBeTruthy()
    expect(image).toBeTruthy()
    expect(image?.parentElement?.getAttribute('contenteditable')).toBe('false')
    expect(spacer?.querySelector('[data-slate-zero-width]')).toBeTruthy()
  })

  test('renderVoid receives content-only props and runtime owns inline void anchor', () => {
    const editor = createReactEditor([
      {
        type: 'paragraph',
        children: [
          { text: 'Before ' },
          {
            type: 'mention',
            character: 'R2-D2',
            children: [{ text: '' }],
          },
          { text: ' after' },
        ],
      },
    ]) as ReactEditor
    let renderVoidProps: RenderVoidProps | null = null

    editor.extend({
      elements: [{ type: 'mention', void: 'inline' }],
      name: 'test-inline-void',
    })

    const renderElement = jest.fn(({ children }: RenderElementProps) => {
      return <p>{children}</p>
    })

    const renderVoid = (props: RenderVoidProps) => {
      renderVoidProps = props

      return <span data-cy="visible-mention">@R2-D2</span>
    }

    const rendered = render(
      <Slate editor={editor}>
        <Editable renderElement={renderElement} renderVoid={renderVoid} />
      </Slate>
    )

    const mention = rendered.container.querySelector(
      '[data-slate-inline="true"][data-slate-void="true"]'
    )

    expect(renderElement).toHaveBeenCalledTimes(1)
    expect(renderVoidProps).toBeTruthy()
    expect(renderVoidProps?.element.type).toBe('mention')
    expect('path' in (renderVoidProps as object)).toBe(false)
    expect('target' in (renderVoidProps as object)).toBe(false)
    expect('actions' in (renderVoidProps as object)).toBe(false)
    expect('selected' in (renderVoidProps as object)).toBe(false)
    expect('focused' in (renderVoidProps as object)).toBe(false)
    expect('children' in (renderVoidProps as object)).toBe(false)
    expect('attributes' in (renderVoidProps as object)).toBe(false)
    expect(mention?.querySelector('[data-cy="visible-mention"]')).toBeTruthy()
    expect(mention?.querySelector('[data-slate-zero-width]')).toBeTruthy()
  })
})
