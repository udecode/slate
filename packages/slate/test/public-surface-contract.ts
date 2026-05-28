import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
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
const publicDocumentationFiles = [
  ...collectMarkdownFiles(resolve(repoRoot, 'docs/api')),
  ...collectMarkdownFiles(resolve(repoRoot, 'docs/concepts')),
  ...collectMarkdownFiles(resolve(repoRoot, 'docs/libraries')),
  ...collectMarkdownFiles(resolve(repoRoot, 'docs/walkthroughs')),
]
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

const bannedPublicDocumentationSurface = [
  {
    pattern: /\bon(ValueChange|SelectionChange|SnapshotChange|KeyCommand)\b/,
    reason: 'normal React docs must teach onChange/onCommit only',
  },
  {
    pattern: /\buseSlateStatic\b/,
    reason: 'normal React docs must teach useEditor and selector hooks',
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
]

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
  for (const relativePath of primaryExampleFiles) {
    it(`${relativePath} does not teach stale editor APIs`, () => {
      const source = readFileSync(resolve(repoRoot, relativePath), 'utf8')
      const failures = bannedPublicSurface
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

describe('primary slate package surface', () => {
  const publicEditorMethods = [
    'extend',
    'getApi',
    'read',
    'subscribe',
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
