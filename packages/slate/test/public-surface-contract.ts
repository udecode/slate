import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, it } from 'node:test'

import * as Slate from '../src'

const repoRoot = resolve(import.meta.dir, '../../..')

const collectExampleFiles = (directory: string): string[] =>
  readdirSync(directory)
    .flatMap((entry) => {
      const path = join(directory, entry)

      if (statSync(path).isDirectory()) {
        return collectExampleFiles(path)
      }

      return /\.(ts|tsx|js|jsx)$/.test(path)
        ? [relative(repoRoot, path).replaceAll('\\', '/')]
        : []
    })
    .sort()

const primaryExampleFiles = collectExampleFiles(
  resolve(repoRoot, 'site/examples')
)
const extensionExampleFiles = primaryExampleFiles

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
  it('does not export the legacy transform namespaces', () => {
    assert.equal('Transforms' in Slate, false)
    assert.equal('GeneralTransforms' in Slate, false)
    assert.equal('NodeTransforms' in Slate, false)
    assert.equal('SelectionTransforms' in Slate, false)
    assert.equal('TextTransforms' in Slate, false)
  })
})

describe('primary extension examples', () => {
  for (const relativePath of extensionExampleFiles) {
    it(`${relativePath} uses editor.extend instead of direct method replacement`, () => {
      const source = readFileSync(resolve(repoRoot, relativePath), 'utf8')

      assert.equal(
        /\beditor\.(isVoid|isInline|isElementReadOnly|isSelectable|markableVoid|insertData|insertText|deleteBackward|deleteForward|insertBreak|normalizeNode|getChunkSize)\s*=/.test(
          source
        ),
        false
      )
    })
  }
})
