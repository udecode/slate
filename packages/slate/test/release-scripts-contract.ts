import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const packageJsonPath = fileURLToPath(
  new URL('../../../package.json', import.meta.url)
)
const packagesPath = fileURLToPath(
  new URL('../../../packages', import.meta.url)
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

  it('keeps consumer-facing package dependency ranges publishable', () => {
    const violations: string[] = []
    const consumerDependencyFields = [
      'dependencies',
      'peerDependencies',
      'optionalDependencies',
    ] as const

    for (const packageName of readdirSync(packagesPath)) {
      const packageJsonPath = join(packagesPath, packageName, 'package.json')

      if (!existsSync(packageJsonPath)) continue

      const packageJson = JSON.parse(
        readFileSync(packageJsonPath, 'utf8')
      ) as Partial<
        Record<
          (typeof consumerDependencyFields)[number],
          Record<string, string>
        >
      > & {
        private?: boolean
      }

      if (packageJson.private) continue

      for (const field of consumerDependencyFields) {
        for (const [dependencyName, range] of Object.entries(
          packageJson[field] ?? {}
        )) {
          if (range.startsWith('workspace:')) {
            violations.push(`${packageName}.${field}.${dependencyName}`)
          }
        }
      }
    }

    assert.deepEqual(violations, [])
  })
})
