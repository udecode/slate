import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const readJson = (path: string) =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as Record<
    string,
    any
  >

describe('@slate/yjs package config contract', () => {
  it('pins Yjs to the audited UndoManager stack contract version', () => {
    const rootPackage = readJson('../../../package.json')
    const yjsPackage = readJson('../package.json')

    assert.equal(rootPackage.devDependencies?.yjs, '13.6.30')
    assert.equal(yjsPackage.dependencies?.yjs, '13.6.30')
    assert.equal(yjsPackage.peerDependencies?.yjs, '13.6.30')
  })

  it('does not resolve site Yjs imports through package-local node_modules', () => {
    const tsconfig = readJson('../../../site/tsconfig.json')
    const yjsAlias = tsconfig.compilerOptions?.paths?.yjs

    assert.equal(yjsAlias, undefined)
  })
})
