import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

describe('package scripts', () => {
  test('does not rerun selection browser tests from the aggregate test script', () => {
    const packageJsonPath = fileURLToPath(
      new URL('../../package.json', import.meta.url)
    )
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      scripts: Record<string, string>
    }
    const scripts = packageJson.scripts

    expect(scripts.test).toContain('test:core')
    expect(scripts.test).toContain('test:dom')
    expect(scripts.test).not.toContain('test:selection')
    expect(scripts['test:dom']).toBe(
      'vitest run --config ./vitest.config.ts --project browser'
    )
  })

  test('keeps core proof helper exports free of proof-suffixed aliases', () => {
    const coreIndexPath = fileURLToPath(
      new URL('../../src/core/index.ts', import.meta.url)
    )
    const coreIndex = readFileSync(coreIndexPath, 'utf8')

    expect(coreIndex).not.toMatch(/\bas\s+\w+Proof\b/)
    expect(coreIndex).not.toContain('evaluateImeInputProof')
    expect(coreIndex).not.toContain('evaluatePlaceholderInputProof')
    expect(coreIndex).not.toContain('extractAgentBrowserDebugSnapshotProof')
    expect(coreIndex).not.toContain('extractAppiumDebugSnapshotProof')
    expect(coreIndex).not.toContain('parseAgentBrowserBatchProof')
    expect(coreIndex).not.toContain('parseDebugSnapshotProof')
  })
})
