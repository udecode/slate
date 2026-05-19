import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const packageJsonPath = fileURLToPath(
  new URL('../../../package.json', import.meta.url)
)

describe('release scripts contract', () => {
  it('keeps the generic release entrypoint behind prerelease validation', () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      scripts: Record<string, string>
    }

    assert.equal(
      packageJson.scripts.release,
      'bun prerelease && changeset publish'
    )
  })

  it('keeps direct tsc typecheck scripts read-only', () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      scripts: Record<string, string>
    }

    const emittingTypecheckScripts = Object.entries(packageJson.scripts)
      .filter(
        ([name, script]) =>
          name.startsWith('typecheck') && /\btsc\b/.test(script)
      )
      .filter(([, script]) => !/(?:^|\s)--noEmit(?:\s|$)/.test(script))

    assert.deepEqual(emittingTypecheckScripts, [])
  })
})
