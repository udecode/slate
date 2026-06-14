import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, it } from 'node:test'

import * as Slate from '../src'

const repoRoot = resolve(import.meta.dir, '../../..')

const collectFiles = (directory: string, pattern: RegExp): string[] =>
  readdirSync(directory)
    .flatMap((entry) => {
      const path = join(directory, entry)

      if (statSync(path).isDirectory()) {
        return collectFiles(path, pattern)
      }

      return pattern.test(path)
        ? [relative(repoRoot, path).replaceAll('\\', '/')]
        : []
    })
    .sort()

const collectExampleFiles = (directory: string): string[] =>
  collectFiles(directory, /\.(ts|tsx|js|jsx)$/)

const collectMarkdownFiles = (directory: string): string[] =>
  collectFiles(directory, /\.md$/)

const primaryExampleFiles = collectExampleFiles(
  resolve(repoRoot, 'site/examples')
)
const extensionExampleFiles = primaryExampleFiles
const primaryExampleRoutes = [
  ...readFileSync(
    resolve(repoRoot, 'site/constants/examples.ts'),
    'utf8'
  ).matchAll(/\['[^']+', '([^']+)'/g),
]
  .map((match) => match[1])
  .sort()
const browserExampleSpecRoutes = collectFiles(
  resolve(repoRoot, 'playwright/integration/examples'),
  /\.test\.ts$/
).map((relativePath) =>
  relativePath
    .replace(/^playwright\/integration\/examples\//, '')
    .replace(/\.test\.ts$/, '')
)
const exampleBrowserProofAliases = new Map([
  [
    'android-tests',
    [
      'query-controls',
      'hidden Android manual-test route is covered by URL-control load proof',
    ],
  ],
  [
    'custom-placeholder',
    [
      'placeholder',
      'custom-placeholder route has a shorter placeholder spec name',
    ],
  ],
] as const)
const publicDocumentationFiles = [
  ...collectMarkdownFiles(resolve(repoRoot, 'docs/api')),
  ...collectMarkdownFiles(resolve(repoRoot, 'docs/concepts')),
  ...collectMarkdownFiles(resolve(repoRoot, 'docs/libraries')),
  ...collectMarkdownFiles(resolve(repoRoot, 'docs/walkthroughs')),
]
const publicMarkdownFiles = [
  'Readme.md',
  ...publicDocumentationFiles,
  ...collectMarkdownFiles(resolve(repoRoot, 'docs/general')),
].sort()
const publicAuthoringFiles = [
  ...collectExampleFiles(resolve(repoRoot, 'site/examples')),
  ...collectExampleFiles(resolve(repoRoot, 'docs/api')),
  ...collectExampleFiles(resolve(repoRoot, 'docs/concepts')),
  ...collectExampleFiles(resolve(repoRoot, 'docs/walkthroughs')),
]

const primitiveWriteTeachingPattern =
  /\beditor\.(collapse|delete|deselect|insertFragment|insertNodes|insertText|mergeNodes|move|moveNodes|removeNodes|select|setNodes|splitNodes|unsetNodes|unwrapNodes|wrapNodes)\s*\(/g

const classifiedPrimitiveWriteFiles = new Map([
  [
    'docs/concepts/11-normalizing.md',
    'normalizer examples run inside normalization policy, not normal authoring command handlers',
  ],
  [
    'docs/walkthroughs/07-enabling-collaborative-editing.md',
    'collaboration setup uses normalizer bootstrap code, not normal authoring command handlers',
  ],
  [
    'site/examples/ts/forced-layout.tsx',
    'forced-layout is a normalizer example and uses primitive writes as advanced normalization policy',
  ],
])

const bannedPublicSurface = [
  {
    pattern: /\bTransforms\./,
    reason:
      'primary examples must use editor methods inside the update runtime',
  },
  {
    pattern: /\beditor\.(selection|children|marks|operations)\b/,
    reason:
      'primary examples must use live read methods, not stale mutable fields',
  },
  {
    pattern: /\beditor\.(apply|onChange)\s*=/,
    reason: 'primary examples must not teach method override extension points',
  },
  {
    pattern: /\b(operationMiddlewares|commitListeners)\b|\bregister\s*[:(]/,
    reason:
      'public authoring examples must teach operations.apply, onCommit, and setup',
  },
]

const bannedPublicExampleTypeSlop = [
  {
    pattern: /\bReactEditor<any>\b/,
    reason: 'public examples should carry the actual editor value type',
  },
  {
    pattern: /\bas never\b/,
    reason: 'public examples should not use impossible casts to appease types',
  },
  {
    pattern: /@ts-expect-error/,
    reason: 'public examples should model missing platform types explicitly',
  },
]

const bannedPublicDocumentationSurface = [
  {
    pattern: /A root-level `Editor` node/,
    reason:
      'node docs must teach roots/state persistence, not legacy editor-child storage',
  },
  {
    pattern: /The top-level node in a Slate document is the `Editor` itself/,
    reason:
      'node docs must separate the runtime editor from persisted document roots',
  },
  {
    pattern: /\beditor\.children\b/,
    reason:
      'public docs must read document content through roots and state.value.get()',
  },
  {
    pattern: /editor has other properties too/,
    reason: 'public docs must not teach placeholder legacy editor shapes',
  },
  {
    pattern: /We'll cover its functionality later/,
    reason:
      'public docs must be direct current-state reference, not old tutorial prose',
  },
  {
    pattern: /\bon(SnapshotChange|KeyCommand)\b/,
    reason:
      'normal React docs must teach current Slate callbacks, not removed callback names',
  },
  {
    pattern: /\buseSlateStatic\b/,
    reason: 'normal React docs must teach useEditor and selector hooks',
  },
  {
    pattern: /\buseComposing\b/,
    reason: 'normal React docs must teach useEditorComposing',
  },
  {
    pattern: /\buseReadOnly\b/,
    reason: 'normal React docs must teach useEditorReadOnly',
  },
  {
    pattern: /\buseSlateSelection\b/,
    reason: 'normal React docs must teach useEditorSelection',
  },
  {
    pattern: /\buseSlateSelector\b/,
    reason: 'normal React docs must teach useEditorSelector',
  },
  {
    pattern: /\buseElementIf\b/,
    reason: 'normal React docs must teach useElement or scoped hooks',
  },
  {
    pattern: /\buseSelected\b/,
    reason: 'normal React docs must teach target-scoped selection hooks',
  },
  {
    pattern: /\buseFocused\b/,
    reason: 'normal React docs must teach editor/node-scoped focus state',
  },
  {
    pattern: /contentEditable=\{false\}/,
    reason: 'normal void docs must not make app renderers own the void shell',
  },
  {
    pattern: /^const \[editor\] = useState\(/m,
    reason:
      'public React docs must not show top-level hook calls outside a component',
  },
]

const bannedPublicSnapshotAndRangeSurface = [
  {
    pattern: /\bstate\.value\.snapshot\s*\(/,
    reason:
      'full snapshots belong to state.runtime.snapshot, not normal value reads',
  },
  {
    pattern: /\bEditor\.(bookmark|getSnapshot|pathRef|pointRef|rangeRef)\b/,
    reason:
      'public docs/examples must use editor.read state groups instead of the internal Editor namespace',
  },
  {
    pattern: /resources used by the \w+RefApi|refs current value|unrefed/,
    reason: 'location ref docs must use current public wording',
  },
]

const bannedPublicInternalImportPattern =
  /from\s+['"](?:slate|slate-dom)\/internal['"]/g

const markdownLinkPattern = /\[[^\]]*]\(([^)\s#]*)(#[^)\s]+)?\)/g
const markdownHeadingPattern = /^(#{1,6})\s+(.+)$/gm

const slugifyMarkdownHeading = (text: string) =>
  text
    .trim()
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')

const collectMarkdownAnchors = (relativePath: string): Set<string> => {
  const source = readFileSync(resolve(repoRoot, relativePath), 'utf8')
  const anchors = new Set<string>()
  const counts = new Map<string, number>()

  for (const match of source.matchAll(markdownHeadingPattern)) {
    const base = slugifyMarkdownHeading(match[2] ?? '')
    const count = counts.get(base) ?? 0

    counts.set(base, count + 1)
    anchors.add(count === 0 ? base : `${base}-${count}`)
  }

  return anchors
}

const markdownAnchorsByFile = new Map(
  publicMarkdownFiles.map((relativePath) => [
    relativePath,
    collectMarkdownAnchors(relativePath),
  ])
)

const renamedDataHelperValues = [
  'Element',
  'Location',
  'Node',
  'Operation',
  'Path',
  'PathRef',
  'Point',
  'PointRef',
  'Range',
  'RangeRef',
  'Span',
  'Text',
]

const renamedDataHelperMemberPattern =
  /\b(Element|Location|Node|Operation|Path|PathRef|Point|PointRef|Range|RangeRef|Span|Text)\.(?!TEXT_NODE\b|ELEMENT_NODE\b)/g

const collectBareDataHelperValueImports = (source: string): string[] => {
  const failures: string[] = []
  const importPattern = /import\s*\{([^}]*)\}\s*from\s*['"]slate['"]/g

  for (const match of source.matchAll(importPattern)) {
    const specifiers = match[1] ?? ''

    for (const specifier of specifiers.split(',')) {
      const trimmed = specifier.trim()
      const imported = trimmed
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)[0]
        ?.trim()

      if (
        !trimmed.startsWith('type ') &&
        imported &&
        renamedDataHelperValues.includes(imported)
      ) {
        failures.push(imported)
      }
    }
  }

  return failures
}

describe('primary public surface examples', () => {
  it('keeps every example route covered by browser proof', () => {
    const specRoutes = new Set(browserExampleSpecRoutes)
    const failures = primaryExampleRoutes.flatMap((route) => {
      const alias = exampleBrowserProofAliases.get(route)?.[0]

      if (specRoutes.has(route) || (alias && specRoutes.has(alias))) {
        return []
      }

      return [route]
    })
    const staleAliases = [...exampleBrowserProofAliases].flatMap(
      ([route, [alias]]) =>
        primaryExampleRoutes.includes(route) && specRoutes.has(alias)
          ? []
          : [`${route} -> ${alias}`]
    )

    assert.deepEqual(failures, [])
    assert.deepEqual(staleAliases, [])
  })

  for (const relativePath of primaryExampleFiles) {
    it(`${relativePath} does not teach stale editor APIs`, () => {
      const source = readFileSync(resolve(repoRoot, relativePath), 'utf8')
      const failures = bannedPublicSurface
        .filter(({ pattern }) => pattern.test(source))
        .map(({ pattern, reason }) => `${pattern}: ${reason}`)

      assert.deepEqual(failures, [])
    })

    it(`${relativePath} does not teach avoidable type slop`, () => {
      const source = readFileSync(resolve(repoRoot, relativePath), 'utf8')
      const failures = bannedPublicExampleTypeSlop
        .filter(({ pattern }) => pattern.test(source))
        .map(({ pattern, reason }) => `${pattern}: ${reason}`)

      assert.deepEqual(failures, [])
    })
  }

  it('forced-layout teaches normalizer repair instead of post-commit repair', () => {
    const source = readFileSync(
      resolve(repoRoot, 'site/examples/ts/forced-layout.tsx'),
      'utf8'
    )

    assert.equal(
      /ENFORCING_LAYOUT|WeakSet<CustomEditor>|commitListeners|register\(\{ editor \}\)|editor\.update\(/.test(
        source
      ),
      false
    )
    assert.match(source, /normalizers:\s*\{\s*editor\(/)
  })
})

describe('public data helper namespace examples', () => {
  for (const relativePath of [
    ...publicAuthoringFiles,
    ...publicDocumentationFiles,
  ]) {
    it(`${relativePath} uses Api-suffixed data helper values`, () => {
      const source = readFileSync(resolve(repoRoot, relativePath), 'utf8')
      const helperMembers = [...source.matchAll(renamedDataHelperMemberPattern)]
        .map((match) => match[0])
        .sort()

      assert.deepEqual(collectBareDataHelperValueImports(source), [])
      assert.deepEqual(helperMembers, [])
    })
  }
})

describe('primary public internal import boundaries', () => {
  for (const relativePath of [
    ...publicAuthoringFiles,
    ...publicDocumentationFiles,
  ]) {
    it(`${relativePath} does not import internal package paths`, () => {
      const source = readFileSync(resolve(repoRoot, relativePath), 'utf8')
      const matches = [...source.matchAll(bannedPublicInternalImportPattern)]
        .map((match) => match[0])
        .sort()

      assert.deepEqual(matches, [])
    })
  }
})

describe('primary public markdown links', () => {
  for (const relativePath of publicMarkdownFiles) {
    it(`${relativePath} links to existing markdown files and anchors`, () => {
      const source = readFileSync(resolve(repoRoot, relativePath), 'utf8')
      const failures: string[] = []

      for (const match of source.matchAll(markdownLinkPattern)) {
        const rawTarget = match[1] ?? ''
        const rawHash = match[2] ?? ''

        if (/^[a-z]+:/.test(rawTarget) || rawTarget.startsWith('/')) {
          continue
        }

        const targetPath = rawTarget
          ? resolve(dirname(resolve(repoRoot, relativePath)), rawTarget)
          : resolve(repoRoot, relativePath)

        if (rawTarget && !statSync(targetPath, { throwIfNoEntry: false })) {
          failures.push(`missing file: ${rawTarget}`)
          continue
        }

        if (
          rawHash &&
          (rawTarget === '' ||
            targetPath.endsWith('.md') ||
            targetPath.endsWith('Readme.md'))
        ) {
          const targetRelativePath = relative(repoRoot, targetPath).replaceAll(
            '\\',
            '/'
          )
          const anchors = markdownAnchorsByFile.get(targetRelativePath)
          const anchor = decodeURIComponent(rawHash.slice(1))

          if (anchors && !anchors.has(anchor)) {
            failures.push(`missing anchor: ${rawTarget}${rawHash}`)
          }
        }
      }

      assert.deepEqual(failures, [])
    })
  }
})

describe('slate-react public docs', () => {
  it('documents Slate component props without treating initialValue as a prop', () => {
    const source = readFileSync(
      resolve(repoRoot, 'docs/libraries/slate-react/slate.md'),
      'utf8'
    )

    assert.equal(/### `initialValue`/.test(source), false)
    assert.match(source, /onSelectionChange\?:/)
    assert.match(source, /onValueChange\?:/)
    assert.match(source, /<Slate>` does\s+not take an `initialValue` prop/)
  })
})

describe('slate-hyperscript public docs', () => {
  it('documents fixture-only usage, built-in tags, and custom element shorthands', () => {
    const source = readFileSync(
      resolve(repoRoot, 'docs/libraries/slate-hyperscript.md'),
      'utf8'
    )

    assert.match(source, /Keep hyperscript in tests and fixtures/)
    assert.match(source, /<editor>/)
    assert.match(source, /<cursor \/>/)
    assert.match(source, /<anchor \/>/)
    assert.match(source, /<focus \/>/)
    assert.match(source, /createHyperscript/)
    assert.match(source, /elements:\s*\{[\s\S]*paragraph/)
  })
})

describe('primary slate package surface', () => {
  const publicEditorMethods = [
    'extend',
    'getApi',
    'read',
    'subscribe',
    'subscribeCommit',
    'update',
  ].sort()
  const requiredSlateRootExports = [
    'createEditor',
    'defineEditorExtension',
    'elementProperty',
    'isEditor',
    'ElementApi',
    'LocationApi',
    'NodeApi',
    'OperationApi',
    'PathApi',
    'PathRefApi',
    'PointApi',
    'PointRefApi',
    'RangeApi',
    'RangeRefApi',
    'SpanApi',
    'TextApi',
    'isObject',
  ]
  const bannedSlateRootDataHelperValues = [
    'Element',
    'Location',
    'Node',
    'Operation',
    'Path',
    'PathRef',
    'Point',
    'PointRef',
    'Range',
    'RangeRef',
    'Scrubber',
    'Span',
    'Text',
  ]
  const bannedSlateRootHelperExports = [
    'above',
    'addMark',
    'after',
    'apply',
    'before',
    'bookmark',
    'collapse',
    'defineCommand',
    'deleteBackward',
    'deleteForward',
    'deleteFragment',
    'deselect',
    'elementReadOnly',
    'executeCommand',
    'getDirtyPaths',
    'getEditorRuntime',
    'getExtensionRegistry',
    'getFragment',
    'getLastCommit',
    'getOperations',
    'getPathByRuntimeId',
    'getRuntimeId',
    'getSelection',
    'getSnapshot',
    'insertBreak',
    'insertFragment',
    'insertNode',
    'insertNodes',
    'insertSoftBreak',
    'insertText',
    'isNormalizing',
    'liftNodes',
    'mergeNodes',
    'move',
    'moveNodes',
    'normalizeNode',
    'pathRef',
    'pathRefs',
    'pointRef',
    'pointRefs',
    'rangeRef',
    'rangeRefs',
    'ScrubberApi',
    'registerCommand',
    'removeMark',
    'removeNodes',
    'replace',
    'select',
    'setNodes',
    'setNormalizing',
    'setSelection',
    'shouldMergeNodesRemovePrevNode',
    'shouldNormalize',
    'splitNodes',
    'unsetNodes',
    'unwrapNodes',
    'withoutNormalizing',
    'wrapNodes',
  ]
  const bannedEditorInstanceSurface = [
    'above',
    'after',
    'before',
    'edges',
    'elementReadOnly',
    'first',
    'fragment',
    'getChildren',
    'getDirtyPaths',
    'getFragment',
    'getLastCommit',
    'getOperationDirtiness',
    'getOperations',
    'getPathByRuntimeId',
    'getRuntimeId',
    'getSelection',
    'getSnapshot',
    'hasBlocks',
    'hasInlines',
    'hasPath',
    'hasTexts',
    'isBlock',
    'isEdge',
    'isEmpty',
    'isEnd',
    'isNormalizing',
    'isStart',
    'last',
    'leaf',
    'levels',
    'next',
    'normalizeNode',
    'parent',
    'path',
    'pathRef',
    'pathRefs',
    'point',
    'pointRef',
    'pointRefs',
    'positions',
    'previous',
    'projectRange',
    'range',
    'rangeRef',
    'rangeRefs',
    'schema',
    'shouldMergeNodesRemovePrevNode',
    'shouldNormalize',
    'string',
    'unhangRange',
    'void',
  ]

  it('keeps the intended small public root', () => {
    const missing = requiredSlateRootExports.filter((key) => !(key in Slate))

    assert.deepEqual(missing, [])
    assert.equal(typeof Slate.createEditor, 'function')
    assert.equal(typeof Slate.defineEditorExtension, 'function')
    assert.equal(typeof Slate.elementProperty.boolean, 'function')
    assert.equal(typeof Slate.isEditor, 'function')
  })

  it('does not export raw editor, core, or transform helper functions from the primary package', () => {
    const leaked = bannedSlateRootHelperExports.filter((key) => key in Slate)

    assert.deepEqual(leaked, [])
  })

  it('does not export bare data helper values from the primary package', () => {
    const leaked = bannedSlateRootDataHelperValues.filter((key) => key in Slate)

    assert.deepEqual(leaked, [])
  })

  it('does not wildcard-export the internal editor type table from the primary package', () => {
    const rootSource = readFileSync(
      resolve(repoRoot, 'packages/slate/src/index.ts'),
      'utf8'
    )

    assert.equal(rootSource.includes("export * from './interfaces'"), false)
    assert.equal(rootSource.includes('EditorStaticApi'), false)
    assert.equal(rootSource.includes('InternalEditorStaticApi'), false)
    assert.equal(rootSource.includes('EditorElementReadOnlyOptions'), false)
  })

  it('exports public update callback types from the primary package', () => {
    const rootSource = readFileSync(
      resolve(repoRoot, 'packages/slate/src/index.ts'),
      'utf8'
    )

    assert.match(rootSource, /\bEditorUpdateContext\b/)
    assert.match(rootSource, /\bEditorUpdateTransaction\b/)
  })

  it('does not export the editor-state static namespace as a value', () => {
    assert.equal('Editor' in Slate, false)
  })

  it('does not export the legacy transform namespaces', () => {
    assert.equal('Transforms' in Slate, false)
    assert.equal('GeneralTransforms' in Slate, false)
    assert.equal('NodeTransforms' in Slate, false)
    assert.equal('SelectionTransforms' in Slate, false)
    assert.equal('TextTransforms' in Slate, false)
  })

  it('does not export the internal transform registry', () => {
    assert.equal('getEditorTransformRegistry' in Slate, false)
    assert.equal('setEditorTransformRegistry' in Slate, false)
  })

  it('does not export internal command registry helpers', () => {
    assert.equal('defineCommand' in Slate, false)
    assert.equal('registerCommand' in Slate, false)
    assert.equal('executeCommand' in Slate, false)
  })

  it('keeps command middleware returns strict boolean', () => {
    const sourceFiles = ['packages/slate/src/core/command-registry.ts']
    const failures = sourceFiles.flatMap((relativePath) => {
      const source = readFileSync(resolve(repoRoot, relativePath), 'utf8')

      return [
        /\bEditorCommandResult\s*\|\s*void\b/,
        /\bvoid\s*\|\s*EditorCommandResult\b/,
      ]
        .filter((pattern) => pattern.test(source))
        .map((pattern) => `${relativePath}: ${pattern}`)
    })

    assert.deepEqual(failures, [])
  })

  it('keeps command middleware off the public static editor API type', () => {
    const editorSource = readFileSync(
      resolve(repoRoot, 'packages/slate/src/interfaces/editor.ts'),
      'utf8'
    )
    const staticApiStart = editorSource.indexOf(
      'export interface EditorStaticApi'
    )
    const staticApiEnd = editorSource.indexOf(
      '\nexport interface InternalEditorStaticApi',
      staticApiStart
    )
    const staticApiSource = editorSource.slice(staticApiStart, staticApiEnd)

    assert.equal(staticApiSource.includes('defineCommand'), false)
    assert.equal(staticApiSource.includes('registerCommand'), false)
  })

  it('does not expose document replacement helpers on editor instances', () => {
    const editor = Slate.createEditor()

    assert.equal('replace' in editor, false)
    assert.equal('reset' in editor, false)
    assert.equal((editor as Record<string, unknown>).replace, undefined)
    assert.equal((editor as Record<string, unknown>).reset, undefined)
  })

  it('keeps the public editor instance surface small', () => {
    const editor = Slate.createEditor()
    const publicMethods = Object.entries(editor)
      .filter(([, value]) => typeof value === 'function')
      .map(([key]) => key)
      .sort()

    assert.deepEqual(publicMethods, publicEditorMethods)
  })

  it('does not expose direct read/query/schema/ref aliases on editor instances', () => {
    const editor = Slate.createEditor()
    const leaked = bannedEditorInstanceSurface.filter((key) => key in editor)

    assert.deepEqual(leaked, [])
  })

  it('does not keep the public EditorInterface or static value in source', () => {
    const editorInterfaceSource = readFileSync(
      resolve(repoRoot, 'packages/slate/src/interfaces/editor.ts'),
      'utf8'
    )

    assert.equal(
      /\bexport\s+interface\s+EditorInterface\b/.test(editorInterfaceSource),
      false
    )
    assert.equal(
      /\bexport\s+const\s+Editor\b/.test(editorInterfaceSource),
      false
    )
  })

  it('does not type public BaseEditor through the internal static Editor table', () => {
    const editorInterfaceSource = readFileSync(
      resolve(repoRoot, 'packages/slate/src/interfaces/editor.ts'),
      'utf8'
    )
    const baseEditorSource = editorInterfaceSource.slice(
      editorInterfaceSource.indexOf('export interface BaseEditor'),
      editorInterfaceSource.indexOf('export interface EditorTransformApi')
    )

    assert.equal(/OmitFirstArg<typeof Editor\./.test(baseEditorSource), false)
  })

  it('keeps the private createEditor runtime split into typed owner groups', () => {
    const createEditorSource = readFileSync(
      resolve(repoRoot, 'packages/slate/src/create-editor.ts'),
      'utf8'
    )
    const editorRuntimeSource = readFileSync(
      resolve(repoRoot, 'packages/slate/src/core/editor-runtime.ts'),
      'utf8'
    )

    assert.equal(
      /\bconst\s+runtime\s*:\s*any\b/.test(createEditorSource),
      false
    )
    assert.equal(/Record<string,\s*any>/.test(editorRuntimeSource), false)
    assert.deepEqual(
      [
        'extensionRuntime',
        'queryRuntime',
        'refRuntime',
        'snapshotRuntime',
        'transactionRuntime',
        'transformRuntime',
      ].filter((name) => !createEditorSource.includes(`const ${name}`)),
      []
    )
  })
})

describe('primary public documentation surface', () => {
  for (const relativePath of publicDocumentationFiles) {
    it(`${relativePath} does not teach stale React or void APIs`, () => {
      const source = readFileSync(resolve(repoRoot, relativePath), 'utf8')
      const failures = bannedPublicDocumentationSurface
        .filter(({ pattern }) => pattern.test(source))
        .map(({ pattern, reason }) => `${pattern}: ${reason}`)

      assert.deepEqual(failures, [])
    })
  }
})

describe('primary public snapshot and range surface', () => {
  for (const relativePath of [
    ...publicDocumentationFiles,
    ...primaryExampleFiles,
  ]) {
    it(`${relativePath} keeps snapshots and durable ranges on the public state API`, () => {
      const source = readFileSync(resolve(repoRoot, relativePath), 'utf8')
      const failures = bannedPublicSnapshotAndRangeSurface
        .filter(({ pattern }) => pattern.test(source))
        .map(({ pattern, reason }) => `${pattern}: ${reason}`)

      assert.deepEqual(failures, [])
    })
  }
})

describe('primary extension examples', () => {
  for (const relativePath of extensionExampleFiles) {
    it(`${relativePath} does not teach flat extension methods`, () => {
      const source = readFileSync(resolve(repoRoot, relativePath), 'utf8')

      assert.equal(/\bmethods\s*[:(]/.test(source), false)
    })
  }
})

describe('primary public write surface', () => {
  for (const relativePath of publicAuthoringFiles) {
    it(`${relativePath} teaches tx writes instead of primitive editor writes`, () => {
      const source = readFileSync(resolve(repoRoot, relativePath), 'utf8')
      const matches = Array.from(
        source.matchAll(primitiveWriteTeachingPattern)
      ).map((match) => match[0])

      if (
        matches.length > 0 &&
        classifiedPrimitiveWriteFiles.has(relativePath)
      ) {
        assert.match(classifiedPrimitiveWriteFiles.get(relativePath)!, /\S/)
        return
      }

      assert.deepEqual(matches, [])
    })
  }
})
