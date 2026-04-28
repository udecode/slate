import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import * as Slate from '../src'

const legacySlateTestRoot = '/Users/zbeyens/git/slate/packages/slate/test'
const legacySlateTestIndex = `${legacySlateTestRoot}/index.js`
const legacyHistoryTestRoot =
  '/Users/zbeyens/git/slate/packages/slate-history/test'
const legacyHistoryTestIndex = `${legacyHistoryTestRoot}/index.js`
const currentSlateTestJsxPath =
  '/Users/zbeyens/git/slate-v2/config/slate-test-jsx.js'
const requireFromCurrentRepo = createRequire(
  '/Users/zbeyens/git/slate-v2/package.json'
)
const currentRuntimeSpecifierTargets = {
  lodash: requireFromCurrentRepo.resolve('lodash'),
  slate: '/Users/zbeyens/git/slate-v2/packages/slate/src/index.ts',
  'slate-hyperscript':
    '/Users/zbeyens/git/slate-v2/packages/slate-hyperscript/src/index.ts',
} as const
const legacyFixtureTranspilers = {
  js: new Bun.Transpiler({ loader: 'js' }),
  jsx: new Bun.Transpiler({
    loader: 'jsx',
    tsconfig: {
      compilerOptions: {
        jsxFactory: 'jsx',
        jsx: 'react',
      },
    },
  }),
  ts: new Bun.Transpiler({ loader: 'ts' }),
  tsx: new Bun.Transpiler({
    loader: 'tsx',
    tsconfig: {
      compilerOptions: {
        jsxFactory: 'jsx',
        jsx: 'react',
      },
    },
  }),
} as const

type LegacyFixtureModule = {
  input?: unknown
  output?: unknown
  skip?: boolean
  test?: (input: unknown) => unknown
  run?: (editor: Slate.Editor) => void
}

const getCurrentSlateTestJsxSpecifier = (filename: string) => {
  const relativePath = path
    .relative(path.dirname(filename), currentSlateTestJsxPath)
    .replaceAll('\\', '/')

  return relativePath.startsWith('.') ? relativePath : `./${relativePath}`
}

const getRelativeSpecifier = (fromFilename: string, targetPath: string) => {
  const relativePath = path
    .relative(path.dirname(fromFilename), targetPath)
    .replaceAll('\\', '/')

  return relativePath.startsWith('.') ? relativePath : `./${relativePath}`
}

const rewriteLegacyTestIndexImports = (source: string, filename: string) => {
  const requireFromFixture = createRequire(pathToFileURL(filename).href)
  const rewriteSpecifier = (specifier: string) => {
    if (specifier in currentRuntimeSpecifierTargets) {
      return getRelativeSpecifier(
        filename,
        currentRuntimeSpecifierTargets[
          specifier as keyof typeof currentRuntimeSpecifierTargets
        ]
      )
    }

    if (!specifier.startsWith('.')) {
      return specifier
    }

    const resolved = requireFromFixture.resolve(specifier)

    if (!isLegacyTestIndexPath(resolved)) {
      return specifier
    }

    return getCurrentSlateTestJsxSpecifier(filename)
  }

  const rewriteMatch = (
    _match: string,
    prefix: string,
    quote: string,
    specifier: string
  ) => `${prefix}${quote}${rewriteSpecifier(specifier)}${quote}`

  return source
    .replace(
      /(\b(?:import|export)\s+[^'"]*?\sfrom\s)(['"])([^'"]+)\2/gm,
      rewriteMatch
    )
    .replace(/(\bimport\s)(['"])([^'"]+)\2/gm, rewriteMatch)
}

const transformLegacyFixture = (filename: string) => {
  const source = fs.readFileSync(filename, 'utf8')
  const rewrittenSource = rewriteLegacyTestIndexImports(source, filename)
  const extension = path
    .extname(filename)
    .slice(1) as keyof typeof legacyFixtureTranspilers
  const transpiler = legacyFixtureTranspilers[extension]

  if (!transpiler) {
    throw new Error(`Unsupported legacy fixture extension for ${filename}`)
  }

  const code = transpiler.transformSync(rewrittenSource)

  if (!code) {
    throw new Error(`Failed to transform legacy fixture ${filename}`)
  }

  return code
}

const normalizeLegacyValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(normalizeLegacyValue)
  }

  if (!value || typeof value !== 'object') {
    return value
  }

  const normalized = Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, normalizeLegacyValue(entry)])
  )

  return normalized
}

const isLegacyTestIndexPath = (resolvedPath: string) =>
  resolvedPath === legacySlateTestRoot ||
  resolvedPath === legacySlateTestIndex ||
  resolvedPath === legacyHistoryTestRoot ||
  resolvedPath === legacyHistoryTestIndex

export const withLegacyTestBehaviors = <T extends Slate.Editor>(
  editor: T
): T => {
  const { isBlock, isInline, isVoid, isElementReadOnly, isSelectable } = editor

  editor.isBlock = (element) =>
    element.inline === true
      ? false
      : element.type == null
        ? true
        : isBlock(element)

  editor.isInline = (element) =>
    element.inline === true ? true : isInline(element)
  editor.isVoid = (element) => (element.void === true ? true : isVoid(element))
  editor.isElementReadOnly = (element) =>
    element.readOnly === true ? true : isElementReadOnly(element)
  editor.isSelectable = (element) =>
    element.nonSelectable === true ? false : isSelectable(element)

  return editor
}

export const loadLegacyFixture = async (
  filename: string
): Promise<LegacyFixtureModule> => {
  const code = transformLegacyFixture(filename)
  const tempFilename = `${filename}.slate-v2-legacy-fixture.mjs`

  fs.writeFileSync(tempFilename, code, 'utf8')

  try {
    const module = (await import(
      `${pathToFileURL(tempFilename).href}?t=${Date.now()}`
    )) as LegacyFixtureModule

    return module
  } finally {
    fs.unlinkSync(tempFilename)
  }
}

const walkFixtures = (root: string): string[] =>
  fs
    .readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const next = path.join(root, entry.name)

      if (entry.isDirectory()) {
        return walkFixtures(next)
      }

      return /\.[jt]sx?$/.test(entry.name) ? [next] : []
    })
    .sort()

export const listLegacyFixtures = (root: string) => walkFixtures(root)

export const assertLegacyInterfaceFixture = async (filename: string) => {
  const fixture = await loadLegacyFixture(filename)

  if (fixture.skip) {
    return
  }

  if (!fixture.test) {
    throw new Error(`Legacy interface fixture ${filename} does not export test`)
  }

  const input = Slate.Editor.isEditor(fixture.input)
    ? withLegacyTestBehaviors(fixture.input)
    : fixture.input

  assert.deepStrictEqual(
    normalizeLegacyValue(fixture.test(input)),
    normalizeLegacyValue(fixture.output)
  )
}

export const runLegacyTransformFixture = async (filename: string) => {
  const fixture = await loadLegacyFixture(filename)

  if (fixture.skip) {
    return
  }

  if (!fixture.run || !fixture.input || !Slate.Editor.isEditor(fixture.input)) {
    throw new Error(
      `Legacy transform fixture ${filename} does not export a valid editor input/run pair`
    )
  }

  const editor = withLegacyTestBehaviors(fixture.input)
  const initialSnapshot = Slate.Editor.getSnapshot(editor)

  Slate.Editor.replace(editor, {
    children: initialSnapshot.children,
    selection: initialSnapshot.selection,
    marks: initialSnapshot.marks,
  })
  fixture.run(editor)

  const snapshot = Slate.Editor.getSnapshot(editor)

  return {
    actualChildren: normalizeLegacyValue(snapshot.children),
    actualSelection: normalizeLegacyValue(snapshot.selection),
    expectedChildren: normalizeLegacyValue(
      Slate.Editor.isEditor(fixture.output)
        ? fixture.output.children
        : undefined
    ),
    expectedSelection: normalizeLegacyValue(
      Slate.Editor.isEditor(fixture.output)
        ? fixture.output.selection
        : undefined
    ),
  }
}

export const assertLegacyTransformFixture = async (filename: string) => {
  const result = await runLegacyTransformFixture(filename)

  if (!result) {
    return
  }

  assert.deepStrictEqual(result.actualChildren, result.expectedChildren)
  assert.deepStrictEqual(result.actualSelection, result.expectedSelection)
}
