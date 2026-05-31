import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { act, render } from '@testing-library/react'
import { type ComponentProps, useEffect } from 'react'
import * as SlateReact from '../src'
import {
  createReactEditor,
  Editable,
  type EditableProps,
  type RenderElementProps,
  type RenderVoidProps,
  Slate,
  useElementSelected,
} from '../src'
import type { ReactRuntimeEditor } from '../src/plugin/react-editor'

const cwd = process.cwd()
const packageRoot = cwd.endsWith(`${sep}packages${sep}slate-react`)
  ? cwd
  : resolve(cwd, 'packages/slate-react')
const repoRoot = resolve(packageRoot, '../..')
const sourceFilePattern = /\.(md|ts|tsx)$/

type ExpectFalse<T extends false> = T
type ExpectTrue<T extends true> = T
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
type EditableHasDOMStrategy = 'domStrategy' extends keyof EditableProps
  ? true
  : false
type EditableHasRenderingStrategy =
  'renderingStrategy' extends keyof EditableProps ? true : false
type EditableHasOnDOMStrategyMetrics =
  'onDOMStrategyMetrics' extends keyof EditableProps ? true : false
type EditableHasOnRenderingStrategyMetrics =
  'onRenderingStrategyMetrics' extends keyof EditableProps ? true : false
type EditableHasOnCommand = 'onCommand' extends keyof ComponentProps<
  typeof Editable
>
  ? true
  : false
type EditableExposesDOMStrategy = ExpectTrue<EditableHasDOMStrategy>
type EditableDoesNotExposeRenderingStrategy =
  ExpectFalse<EditableHasRenderingStrategy>
type EditableExposesOnDOMStrategyMetrics =
  ExpectTrue<EditableHasOnDOMStrategyMetrics>
type EditableDoesNotExposeOnRenderingStrategyMetrics =
  ExpectFalse<EditableHasOnRenderingStrategyMetrics>
type EditableDoesNotExposeOnCommand = ExpectFalse<EditableHasOnCommand>

void (null as unknown as RenderElementDoesNotExposePath)
void (null as unknown as RenderElementDoesNotExposeIndex)
void (null as unknown as RenderVoidDoesNotExposePath)
void (null as unknown as EditableDOMBeforeInputProps)
void (null as unknown as EditableExposesDOMStrategy)
void (null as unknown as EditableDoesNotExposeRenderingStrategy)
void (null as unknown as EditableExposesOnDOMStrategyMetrics)
void (null as unknown as EditableDoesNotExposeOnRenderingStrategyMetrics)
void (null as unknown as EditableDoesNotExposeOnCommand)

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

const readPackageJson = (packageName: string) =>
  JSON.parse(
    readFileSync(
      resolve(repoRoot, 'packages', packageName, 'package.json'),
      'utf8'
    )
  ) as {
    peerDependencies?: Record<string, string>
    version: string
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
  test('Editable exposes native beforeinput context without public command handlers', () => {
    const editor = createReactEditor({
      initialValue: [{ type: 'paragraph', children: [{ text: 'test' }] }],
    })
    let beforeInputContext:
      | Parameters<NonNullable<EditableDOMBeforeInputProps>>[1]
      | null = null

    render(
      <Slate editor={editor}>
        <Editable
          onDOMBeforeInput={(event, context) => {
            event.preventDefault()
            beforeInputContext = context
            context.editor.update(() => {})
            return true
          }}
        />
      </Slate>
    )

    expect(beforeInputContext).toBe(null)
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

  test('runtime package-private imports pin peer floors to sibling runtime packages', () => {
    const slateReactPackage = readPackageJson('slate-react')
    const runtimeSources = [
      'packages/slate-react/src/editable/runtime-editor-api.ts',
      'packages/slate-react/src/editable/runtime-repair-engine.ts',
      'packages/slate-react/src/hooks/use-slate-runtime.tsx',
    ]
      .map((file) => readFileSync(resolve(repoRoot, file), 'utf8'))
      .join('\n')

    expect(runtimeSources).toContain("from 'slate/internal'")
    expect(runtimeSources).toContain("from 'slate-dom'")
    expect(runtimeSources).toContain("from 'slate'")
    expect(slateReactPackage.peerDependencies?.slate).toBe('>=0.124.2')
    expect(slateReactPackage.peerDependencies?.['slate-dom']).toBe('>=0.124.2')
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
          count: 6,
          next: 'root-source',
          owner: 'Editable root selector sources',
          rationale:
            'Top-level runtime ids, root document epoch, selected top-level index, selection paths, placeholder visibility, and the editable root commit wakeup are owned by named root source selectors.',
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
        'packages/slate-react/src/dom-strategy/segment-placeholder.tsx': {
          count: 1,
          next: 'dom-strategy-preview',
          owner: 'DOM strategy partial-DOM placeholder',
          rationale:
            'Partial-DOM segment placeholders subscribe through the public selector contract so hidden preview text refreshes without remounting the whole placeholder.',
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
      'site/examples/ts/comment-mode.tsx': 1,
    })
  })

  test('product comment examples use public annotation substrate', () => {
    const exampleFiles = ['site/examples/ts/comment-mode.tsx']

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

  test('beginner rendering docs teach raw render props without callback memoization', () => {
    const docs = [
      'docs/concepts/09-rendering.md',
      'docs/walkthroughs/03-defining-custom-elements.md',
      'docs/walkthroughs/04-applying-custom-formatting.md',
      'docs/walkthroughs/05-executing-commands.md',
      'docs/walkthroughs/09-performance.md',
    ]
      .map((file) => readFileSync(resolve(repoRoot, file), 'utf8'))
      .join('\n')

    expect(docs).toMatch(/\brenderElement\b/)
    expect(docs).not.toMatch(/\buseCallback\b/)
    expect(docs).not.toMatch(/\beditableRenderers\b/)
  })

  test('adapter static namespaces stay out of the public root at runtime', () => {
    expect('ReactEditor' in SlateReact).toBe(false)
    expect('DOMEditor' in SlateReact).toBe(false)
    expect('withReact' in SlateReact).toBe(false)
    expect(typeof SlateReact.react).toBe('function')
    expect(typeof SlateReact.createReactEditor).toBe('function')
  })

  test('virtualized DOM strategy stays object-only and experimental', () => {
    const segmentPlanSource = readFileSync(
      resolve(packageRoot, 'src/dom-strategy/create-segment-plan.ts'),
      'utf8'
    )
    const editableSource = readFileSync(
      resolve(packageRoot, 'src/components/editable-text-blocks.tsx'),
      'utf8'
    )

    const domStrategyType = segmentPlanSource.match(
      /export type DOMStrategyType =([\s\S]*?)export type DOMStrategyOptions =/
    )?.[1]

    expect(domStrategyType).not.toContain("'virtualized'")
    expect(domStrategyType).not.toContain("'shell'")
    expect(segmentPlanSource).not.toContain("type: 'shell'")
    expect(segmentPlanSource).toContain("type: 'virtualized'")
    expect(segmentPlanSource).toContain('Intentionally object-only')
    expect(editableSource).toContain('`virtualized` is experimental')
  })

  test('Editable public DOM strategy naming does not expose DOM strategy props', () => {
    const editableSource = readFileSync(
      resolve(packageRoot, 'src/components/editable-text-blocks.tsx'),
      'utf8'
    )
    const editableRootSource = readFileSync(
      resolve(packageRoot, 'src/components/editable.tsx'),
      'utf8'
    )
    const packageIndex = readFileSync(
      resolve(packageRoot, 'src/index.ts'),
      'utf8'
    )
    const effectiveStrategyType = editableRootSource.match(
      /export type EditableDOMStrategyEffectiveType =([\s\S]*?)export type EditableDOMStrategyDegradationMode =/
    )?.[1]
    const degradationModeType = editableRootSource.match(
      /export type EditableDOMStrategyDegradationMode =([\s\S]*?)export type EditableDOMStrategyMetricsBase =/
    )?.[1]
    const metricsBase = editableRootSource.match(
      /export type EditableDOMStrategyMetricsBase = \{([\s\S]*?)\n\}/
    )?.[1]

    expect(editableSource).toContain('domStrategy?: DOMStrategyOptions | null')
    expect(editableSource).toContain('onDOMStrategyMetrics?:')
    expect(editableSource).not.toContain(
      'renderingStrategy?: RenderingStrategyOptions | null'
    )
    expect(editableSource).not.toContain('onRenderingStrategyMetrics?:')
    expect(effectiveStrategyType).not.toContain("'shell'")
    expect(degradationModeType).not.toContain("'shell'")
    expect(metricsBase).not.toContain('partialDOMCount')
    expect(editableRootSource).not.toContain('shellAggressiveBoundaryCount')
    expect(editableRootSource).toContain('aggressiveDomCoverageBoundaryCount')
    expect(packageIndex).toContain('EditableDOMStrategyMetrics')
    expect(packageIndex).not.toContain('EditableRenderingStrategy')
  })

  test('Editable DOM strategy option objects normalize through primitive fields', () => {
    const editableSource = readFileSync(
      resolve(packageRoot, 'src/components/editable-text-blocks.tsx'),
      'utf8'
    )

    expect(editableSource).toMatch(/\bdomStrategyVirtualizedOverscan\b/)
    expect(editableSource).not.toContain(
      '[domStrategyType, internalShellDOMStrategyOptions]'
    )
    expect(editableSource).not.toContain(
      '[domStrategyType, virtualizedDOMStrategyOptions]'
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

  test('hotkey examples use raw Editable keydown props instead of registered key commands', () => {
    for (const file of [
      'site/examples/ts/iframe.tsx',
      'site/examples/ts/images.tsx',
      'site/examples/ts/richtext.tsx',
    ]) {
      const source = readFileSync(resolve(repoRoot, file), 'utf8')

      expect(source).toMatch(/\bonKeyDown=/)
      expect(source).not.toMatch(/\beditableKeyCommands\b/)
    }
  })

  test('examples route transform-equivalent model behavior through extensions', () => {
    const tables = readFileSync(
      resolve(repoRoot, 'site/examples/ts/tables.tsx'),
      'utf8'
    )
    const markdown = readFileSync(
      resolve(repoRoot, 'site/examples/ts/markdown-shortcuts.tsx'),
      'utf8'
    )
    const richtext = readFileSync(
      resolve(repoRoot, 'site/examples/ts/richtext.tsx'),
      'utf8'
    )
    const editableDocs = readFileSync(
      resolve(repoRoot, 'docs/libraries/slate-react/editable.md'),
      'utf8'
    )

    expect(tables).toMatch(/\bdefineEditorExtension\b/)
    expect(tables).toMatch(/\bdeleteBackward\(\{ next, tx, unit \}\)/)
    expect(tables).toMatch(/\bdeleteForward\(\{ next, tx, unit \}\)/)
    expect(tables).toMatch(/\binsertBreak\(\{ next, tx \}\)/)
    expect(tables).not.toMatch(/event\.key === ['"]Backspace['"]/)
    expect(tables).not.toMatch(/event\.key === ['"]Delete['"]/)
    expect(tables).not.toMatch(/event\.key === ['"]Enter['"]/)

    expect(markdown).toMatch(/\bdeleteBackward\(\{ editor, next, tx, unit \}\)/)
    expect(markdown).toMatch(/\binsertBreak\(\{ next, tx \}\)/)
    expect(markdown).toMatch(/\binsertText\(\{ editor, next, text, tx \}\)/)
    expect(markdown).not.toMatch(/\bonKeyDown=/)

    expect(richtext).toMatch(/\binsertBreak\(\{ next, tx \}\)/)
    expect(richtext).toMatch(/\bonKeyDown=/)
    expect(richtext).not.toMatch(/event\.key === ['"]Enter['"]/)

    expect(editableDocs).toContain(
      'Use extension `transforms` for model behavior such as `deleteBackward`, `deleteForward`, and `insertBreak`.'
    )
  })

  test('examples infer editable behavior callback types inline', () => {
    const violations = listSourceFiles(['site/examples/ts']).flatMap(
      (absolutePath) => {
        const source = readFileSync(absolutePath, 'utf8')
        const relativePath = relative(repoRoot, absolutePath)
        const patterns = [
          /\bconst\s+\w+\s*:\s*Editable(?:CommandHandler|InputRule|KeyCommand)\b/,
          /\btype\s+Editable(?:CommandHandler|InputRule|KeyCommand)\b/,
          /\bParameters<EditableCommandHandler>\b/,
        ]

        return patterns.some((pattern) => pattern.test(source))
          ? [relativePath]
          : []
      }
    )

    expect(violations).toEqual([])
  })

  test('Editable defaults translate="no" and allows override', () => {
    const initialValue = [{ type: 'block', children: [{ text: 'test' }] }]
    const editor = createReactEditor({ initialValue })

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

  test('Editable consumes raw element, leaf, text, segment, and void render props', () => {
    const editor = createReactEditor({
      initialValue: [
        {
          type: 'code',
          children: [{ text: 'const answer = 42', bold: true }],
        },
        {
          type: 'image',
          url: 'about:blank',
          children: [{ text: '' }],
        },
      ],
    }) as ReactRuntimeEditor

    editor.extend({
      elements: [{ type: 'image', void: 'block' }],
      name: 'test-renderers',
    })

    const rendered = render(
      <Slate editor={editor}>
        <Editable
          renderElement={({ attributes, children }) => (
            <pre {...attributes} data-renderer="code">
              <code>{children}</code>
            </pre>
          )}
          renderLeaf={({ children }) => (
            <strong data-renderer="bold">{children}</strong>
          )}
          renderSegment={(segment, children) => (
            <mark data-renderer="segment" data-start={segment.start}>
              {children}
            </mark>
          )}
          renderText={({ attributes, children }) => (
            <span {...attributes} data-renderer="text">
              {children}
            </span>
          )}
          renderVoid={({ element }) => (
            <img
              alt=""
              data-renderer="image"
              height={1}
              src={(element as { url: string }).url}
              width={1}
            />
          )}
        />
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

  test('structured render surface keeps mount identity stable across split and merge', async () => {
    const editor = createReactEditor({
      initialValue: [{ type: 'block', children: [{ text: 'test' }] }],
    })
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

    const mergeEditor = createReactEditor({
      initialValue: [
        { type: 'block', children: [{ text: 'te' }] },
        { type: 'block', children: [{ text: 'st' }] },
      ],
    })
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
    const editor = createReactEditor({
      initialValue: [
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
      ],
    }) as ReactRuntimeEditor
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
    const editor = createReactEditor({
      initialValue: [
        { id: 'first', children: [{ text: '' }] },
        { id: 'target', children: [{ text: '' }] },
      ],
    }) as ReactRuntimeEditor
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
        readTargetPath = () => editor.api.dom.assertPath(element)
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
    const editor = createReactEditor({
      initialValue: [
        { type: 'image', url: 'about:blank', children: [{ text: '' }] },
      ],
    }) as ReactRuntimeEditor
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

  test('editable-island void content keeps classic void chrome while nested editors stay focusable', () => {
    const editor = createReactEditor({
      initialValue: [
        {
          type: 'editable-card',
          children: [{ text: '' }],
        },
      ],
    }) as ReactRuntimeEditor

    editor.extend({
      elements: [{ type: 'editable-card', void: 'editable-island' }],
      name: 'test-editable-island-void',
    })

    const rendered = render(
      <Slate editor={editor}>
        <Editable
          renderVoid={() => (
            <div data-renderer="editable-card">
              <div contentEditable={false}>Controls</div>
              <div contentEditable>Nested editor target</div>
            </div>
          )}
        />
      </Slate>
    )

    const card = rendered.container.querySelector(
      '[data-renderer="editable-card"]'
    )
    const spacer = rendered.container.querySelector('[data-slate-spacer]')

    expect(card?.parentElement?.getAttribute('contenteditable')).toBe('false')
    expect(card?.querySelector('[contenteditable="false"]')?.textContent).toBe(
      'Controls'
    )
    expect(card?.querySelector('[contenteditable="true"]')).toBeTruthy()
    expect(spacer?.querySelector('[data-slate-zero-width]')).toBeTruthy()
  })

  test('renderVoid receives content-only props and runtime owns inline void anchor', () => {
    const editor = createReactEditor({
      initialValue: [
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
      ],
    }) as ReactRuntimeEditor
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
