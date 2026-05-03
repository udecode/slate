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
})

describe('primary slate package surface', () => {
  const publicEditorMethods = ['extend', 'read', 'subscribe', 'update'].sort()
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
