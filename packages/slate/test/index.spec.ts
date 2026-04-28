import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { cloneDeep } from 'lodash'
import { createEditor, Editor } from 'slate'
import {
  IMPLICIT_CANONICALIZATION_CUT_REASON,
  isExplicitCutFixture,
} from './fixture-claim-overrides.js'
import { withTest } from './support/with-test.js'

const testsDir = dirname(fileURLToPath(import.meta.url))
const fixtureFilter = process.env.SLATE_FIXTURE_FILTER?.trim() || null

const isFixtureFile = (file: string) =>
  (file.endsWith('.js') || file.endsWith('.ts') || file.endsWith('.tsx')) &&
  !file.endsWith('custom-types.ts') &&
  !file.endsWith('type-guards.ts') &&
  !file.startsWith('.') &&
  file !== 'index.js' &&
  file !== 'index.spec.ts'

const getFixtureName = (file: string) => file.replace(/\.(tsx|ts|js)$/u, '')

const runFixtureTree = (
  path: string,
  runFixture: (module: Record<string, any>, fixturePath: string) => void
) => {
  describe(basename(path), () => {
    for (const file of readdirSync(path).sort()) {
      const fixturePath = resolve(path, file)
      const stat = statSync(fixturePath)

      if (stat.isDirectory()) {
        runFixtureTree(fixturePath, runFixture)
        continue
      }

      if (!stat.isFile() || !isFixtureFile(file)) continue
      if (fixtureFilter && !fixturePath.includes(fixtureFilter)) continue

      const name = getFixtureName(file)
      const source = readFileSync(fixturePath, 'utf8')
      const fixturePathFromTestRoot = relative(
        testsDir,
        fixturePath
      ).replaceAll('\\', '/')
      const isExplicitCut = isExplicitCutFixture(fixturePathFromTestRoot)
      const testFn = /\bexport const skip\s*=\s*true\b/.test(source)
        ? it.skip
        : isExplicitCut
          ? it.skip
          : it

      testFn(name, async () => {
        const module = (await import(
          pathToFileURL(fixturePath).href
        )) as Record<string, any>

        if (process.env.SLATE_FIXTURE_DEBUG === '1') {
          console.log('[fixture]', fixturePath)
          if (isExplicitCut) {
            console.log('[cut]', IMPLICIT_CANONICALIZATION_CUT_REASON)
          }
        }

        runFixture(module, fixturePath)
      })
    }
  })
}

const withBatchTest = (editor: Editor, dirties: string[]) => {
  const { normalizeNode } = editor

  editor.normalizeNode = ([node, path]) => {
    dirties.push(JSON.stringify(path))
    normalizeNode([node, path])
  }

  return editor
}

const getExpectedSnapshot = (output: any) =>
  Editor.isEditor(output) ? Editor.getSnapshot(output) : output

describe('slate', () => {
  runFixtureTree(resolve(testsDir, 'interfaces'), (module, fixturePath) => {
    let { input, test, output } = module

    if (Editor.isEditor(input)) {
      input = withTest(input)
    }

    const actual = test(input)

    if (process.env.SLATE_FIXTURE_DEBUG === '1') {
      console.log('[actual]', JSON.stringify(actual))
      console.log('[expected]', JSON.stringify(output))
      if (Editor.isEditor(input)) {
        const snapshot = Editor.getSnapshot(input)
        console.log('[selection]', JSON.stringify(snapshot.selection))
        console.log('[children]', JSON.stringify(snapshot.children))
      }
    }

    assert.deepEqual(actual, output, fixturePath)
  })

  runFixtureTree(resolve(testsDir, 'operations'), (module, fixturePath) => {
    const { input, operations, output } = module
    const editor = withTest(input)

    Editor.withTransaction(editor, (transaction) => {
      Editor.withoutNormalizing(editor, () => {
        for (const op of operations) {
          transaction.apply(op)
        }
      })
    })

    const snapshot = Editor.getSnapshot(editor)
    const expected = getExpectedSnapshot(output)

    assert.deepEqual(snapshot.children, expected.children, fixturePath)
    assert.deepEqual(snapshot.selection, expected.selection, fixturePath)
  })

  runFixtureTree(resolve(testsDir, 'normalization'), (module, fixturePath) => {
    const { input, output, withFallbackElement } = module
    const editor = withTest(input)

    if (withFallbackElement) {
      const { normalizeNode } = editor

      editor.normalizeNode = (entry, options) => {
        normalizeNode(entry, { ...options, fallbackElement: () => ({}) })
      }
    }

    editor.update(() => {
      Editor.normalize(editor, { force: true })
    })

    const snapshot = Editor.getSnapshot(editor)
    const expected = getExpectedSnapshot(output)

    assert.deepEqual(snapshot.children, expected.children, fixturePath)
    assert.deepEqual(snapshot.selection, expected.selection, fixturePath)
  })

  runFixtureTree(resolve(testsDir, 'transforms'), (module, fixturePath) => {
    const { input, output, run } = module
    const editor = withTest(input)

    editor.update(() => {
      run(editor)
    })

    const snapshot = Editor.getSnapshot(editor)
    const expected = getExpectedSnapshot(output)

    assert.deepEqual(snapshot.children, expected.children, fixturePath)
    assert.deepEqual(snapshot.selection, expected.selection, fixturePath)
  })

  runFixtureTree(
    resolve(testsDir, 'utils/deep-equal'),
    (module, fixturePath) => {
      let { input, test, output } = module

      if (Editor.isEditor(input)) {
        input = withTest(input)
      }

      assert.deepEqual(test(input), output, fixturePath)
    }
  )

  describe('batchDirty', () => {
    const runBatchDirtyTree = (path: string) => {
      runFixtureTree(path, (module) => {
        const { input, run } = module
        const input2 = createEditor()
        const snapshot = Editor.getSnapshot(input)

        Editor.replace(input2, {
          children: cloneDeep(snapshot.children),
          selection: cloneDeep(snapshot.selection),
          marks: cloneDeep(snapshot.marks),
        })

        const dirties1: string[] = []
        const dirties2: string[] = []

        const editor1 = withBatchTest(withTest(input), dirties1)
        const editor2 = withBatchTest(withTest(input2), dirties2)

        editor1.update(() => {
          run(editor1, { batchDirty: true })
        })
        editor2.update(() => {
          run(editor2, { batchDirty: false })
        })

        assert.equal(dirties1.join(' '), dirties2.join(' '))
      })
    }

    runBatchDirtyTree(resolve(testsDir, 'transforms/insertNodes'))
    runBatchDirtyTree(resolve(testsDir, 'transforms/insertFragment'))
  })
})
