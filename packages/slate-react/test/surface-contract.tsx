import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { act, render } from '@testing-library/react'
import { useEffect } from 'react'
import { createEditor } from 'slate'
import {
  Editable,
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

  test('Editable defaults translate="no" and allows override', () => {
    const editor = withReact(createEditor())
    const initialValue = [{ type: 'block', children: [{ text: 'test' }] }]

    const defaultRender = render(
      <Slate editor={editor} initialValue={initialValue}>
        <Editable />
      </Slate>
    )

    expect(
      defaultRender.container
        .querySelector('[data-slate-editor]')
        ?.getAttribute('translate')
    ).toBe('no')

    defaultRender.rerender(
      <Slate editor={editor} initialValue={initialValue}>
        <Editable translate="yes" />
      </Slate>
    )

    expect(
      defaultRender.container
        .querySelector('[data-slate-editor]')
        ?.getAttribute('translate')
    ).toBe('yes')
  })

  test('structured render surface keeps mount identity stable across split and merge', async () => {
    const editor = withReact(createEditor())
    const mounts = jest.fn()

    const renderElement = ({ children }: RenderElementProps) => {
      useEffect(() => mounts(), [])
      return <div>{children}</div>
    }

    const rendered = render(
      <Slate
        editor={editor}
        initialValue={[{ type: 'block', children: [{ text: 'test' }] }]}
      >
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

    const mergeEditor = withReact(createEditor())
    const mergeMounts = jest.fn()

    const mergeRenderElement = ({ children }: RenderElementProps) => {
      useEffect(() => mergeMounts(), [])
      return <div>{children}</div>
    }

    render(
      <Slate
        editor={mergeEditor}
        initialValue={[
          { type: 'block', children: [{ text: 'te' }] },
          { type: 'block', children: [{ text: 'st' }] },
        ]}
      >
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
    const editor = withReact(createEditor()) as ReactEditor
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
      <Slate
        editor={editor}
        initialValue={[
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
        ]}
      >
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

  test('renderVoid receives content-only props and runtime owns block void spacer', () => {
    const editor = withReact(createEditor()) as ReactEditor
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
      <Slate
        editor={editor}
        initialValue={[
          { type: 'image', url: 'about:blank', children: [{ text: '' }] },
        ]}
      >
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
    expect(renderVoidProps?.target).toEqual([0])
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
    const editor = withReact(createEditor()) as ReactEditor
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
      <Slate
        editor={editor}
        initialValue={[
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
        ]}
      >
        <Editable renderElement={renderElement} renderVoid={renderVoid} />
      </Slate>
    )

    const mention = rendered.container.querySelector(
      '[data-slate-inline="true"][data-slate-void="true"]'
    )

    expect(renderElement).toHaveBeenCalledTimes(1)
    expect(renderVoidProps).toBeTruthy()
    expect(renderVoidProps?.element.type).toBe('mention')
    expect(renderVoidProps?.target).toEqual([0, 1])
    expect('actions' in (renderVoidProps as object)).toBe(false)
    expect('selected' in (renderVoidProps as object)).toBe(false)
    expect('focused' in (renderVoidProps as object)).toBe(false)
    expect('children' in (renderVoidProps as object)).toBe(false)
    expect('attributes' in (renderVoidProps as object)).toBe(false)
    expect(mention?.querySelector('[data-cy="visible-mention"]')).toBeTruthy()
    expect(mention?.querySelector('[data-slate-zero-width]')).toBeTruthy()
  })
})
