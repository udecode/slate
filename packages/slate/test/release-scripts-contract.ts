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
})
