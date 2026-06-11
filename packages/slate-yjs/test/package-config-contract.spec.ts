import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { isRecord } from '../src/core/record'
import { SUPPORTED_YJS_UNDO_MANAGER_VERSION } from '../src/core/undo-manager-adapter'

type JsonRecord = Readonly<Record<string, unknown>>

type DependencyMap = Readonly<Record<string, string>>

type PackageExport = {
  readonly default?: string
  readonly import?: string
  readonly types?: string
}

type PackageExports = Readonly<Record<string, PackageExport>>

type PackageJson = {
  readonly dependencies?: DependencyMap
  readonly devDependencies?: DependencyMap
  readonly exports?: PackageExports
  readonly optionalDependencies?: DependencyMap
  readonly peerDependencies?: DependencyMap
}

type TsConfigJson = {
  readonly compilerOptions?: {
    readonly paths?: JsonRecord
  }
}

const readJsonRecord = (path: string): JsonRecord => {
  const value = JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))

  if (!isRecord(value)) {
    throw new Error(`${path} must contain a JSON object.`)
  }

  return value
}

const readOptionalRecord = (
  record: JsonRecord,
  key: string
): JsonRecord | undefined => {
  const value = record[key]

  if (value === undefined) {
    return undefined
  }

  if (!isRecord(value)) {
    throw new Error(`${key} must be a JSON object.`)
  }

  return value
}

const readOptionalString = (
  record: JsonRecord,
  key: string
): string | undefined => {
  const value = record[key]

  if (value === undefined || typeof value === 'string') {
    return value
  }

  throw new Error(`${key} must be a string.`)
}

const readDependencyMap = (
  record: JsonRecord,
  key: string
): DependencyMap | undefined => {
  const dependencies = readOptionalRecord(record, key)

  if (dependencies === undefined) {
    return undefined
  }

  const map: Record<string, string> = {}

  for (const [name, version] of Object.entries(dependencies)) {
    if (typeof version !== 'string') {
      throw new Error(`${key}.${name} must be a string.`)
    }

    map[name] = version
  }

  return map
}

const readPackageExports = (record: JsonRecord): PackageExports | undefined => {
  const rawExports = readOptionalRecord(record, 'exports')

  if (rawExports === undefined) {
    return undefined
  }

  const exports: Record<string, PackageExport> = {}

  for (const [key, value] of Object.entries(rawExports)) {
    if (!isRecord(value)) {
      throw new Error(`exports.${key} must be a JSON object.`)
    }

    exports[key] = {
      default: readOptionalString(value, 'default'),
      import: readOptionalString(value, 'import'),
      types: readOptionalString(value, 'types'),
    }
  }

  return exports
}

const readPackageJson = (path: string): PackageJson => {
  const record = readJsonRecord(path)

  return {
    dependencies: readDependencyMap(record, 'dependencies'),
    devDependencies: readDependencyMap(record, 'devDependencies'),
    exports: readPackageExports(record),
    optionalDependencies: readDependencyMap(record, 'optionalDependencies'),
    peerDependencies: readDependencyMap(record, 'peerDependencies'),
  }
}

const readTsConfigJson = (path: string): TsConfigJson => {
  const record = readJsonRecord(path)
  const compilerOptions = readOptionalRecord(record, 'compilerOptions')
  const paths =
    compilerOptions === undefined
      ? undefined
      : readOptionalRecord(compilerOptions, 'paths')

  return {
    compilerOptions: compilerOptions === undefined ? undefined : { paths },
  }
}

describe('@slate/yjs package config contract', () => {
  it('pins Yjs to the audited UndoManager stack contract version', () => {
    const rootPackage = readPackageJson('../../../package.json')
    const yjsPackage = readPackageJson('../package.json')

    assert.equal(
      rootPackage.devDependencies?.yjs,
      SUPPORTED_YJS_UNDO_MANAGER_VERSION
    )
    assert.equal(
      yjsPackage.dependencies?.yjs,
      SUPPORTED_YJS_UNDO_MANAGER_VERSION
    )
    assert.equal(
      yjsPackage.peerDependencies?.yjs,
      SUPPORTED_YJS_UNDO_MANAGER_VERSION
    )
  })

  it('does not resolve site Yjs imports through package-local node_modules', () => {
    const tsconfig = readTsConfigJson('../../../site/tsconfig.json')
    const yjsAlias = tsconfig.compilerOptions?.paths?.yjs

    assert.equal(yjsAlias, undefined)
  })

  it('keeps provider integrations supplied by applications', () => {
    const yjsPackage = readPackageJson('../package.json')
    const sections = [
      yjsPackage.dependencies,
      yjsPackage.devDependencies,
      yjsPackage.peerDependencies,
      yjsPackage.optionalDependencies,
    ]

    for (const dependencies of sections) {
      assert.equal(dependencies?.['@hocuspocus/provider'], undefined)
      assert.equal(dependencies?.['y-websocket'], undefined)
    }
  })

  it('keeps package exports aligned with built entrypoints', () => {
    const yjsPackage = readPackageJson('../package.json')

    assert.deepEqual(Object.keys(yjsPackage.exports ?? {}).sort(), [
      '.',
      './core',
      './internal',
      './react',
    ])
    assert.deepEqual(yjsPackage.exports?.['.'], {
      default: './dist/index.js',
      import: './dist/index.js',
      types: './dist/index.d.ts',
    })
    assert.deepEqual(yjsPackage.exports?.['./core'], {
      default: './dist/core/index.js',
      import: './dist/core/index.js',
      types: './dist/core/index.d.ts',
    })
    assert.deepEqual(yjsPackage.exports?.['./internal'], {
      default: './dist/internal/index.js',
      import: './dist/internal/index.js',
      types: './dist/internal/index.d.ts',
    })
    assert.deepEqual(yjsPackage.exports?.['./react'], {
      default: './dist/react/index.js',
      import: './dist/react/index.js',
      types: './dist/react/index.d.ts',
    })
  })
})
