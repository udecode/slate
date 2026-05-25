const fs = require('node:fs')
const path = require('node:path')
const { PHASE_DEVELOPMENT_SERVER } = require('next/constants')

const SITE_ROOT = __dirname
const REPO_ROOT = path.resolve(SITE_ROOT, '..')
const PACKAGES_ROOT = path.join(REPO_ROOT, 'packages')

const toSiteImportPath = (targetPath) => {
  const relativePath = path
    .relative(SITE_ROOT, targetPath)
    .replaceAll('\\', '/')

  return relativePath.startsWith('.') ? relativePath : `./${relativePath}`
}

const getIndexEntry = (dir) => {
  const tsEntry = path.join(dir, 'index.ts')
  const tsxEntry = path.join(dir, 'index.tsx')

  if (fs.existsSync(tsEntry)) return tsEntry
  if (fs.existsSync(tsxEntry)) return tsxEntry

  return null
}

const getPackageName = (dir) => {
  const packageJsonPath = path.join(dir, 'package.json')

  if (!fs.existsSync(packageJsonPath)) return null

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))

  return typeof packageJson.name === 'string' ? packageJson.name : null
}

const getSourceEntryAliases = (packageName, srcDir, mapper) => {
  const aliases = {}

  if (!fs.existsSync(srcDir)) return aliases

  const rootEntry = getIndexEntry(srcDir)

  if (rootEntry) {
    aliases[packageName] = mapper(rootEntry)
  }

  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.name === 'index.ts' || entry.name === 'index.tsx') continue

    if (entry.isDirectory()) {
      const childEntry = getIndexEntry(path.join(srcDir, entry.name))

      if (childEntry) {
        aliases[`${packageName}/${entry.name}`] = mapper(childEntry)
      }

      continue
    }

    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      aliases[`${packageName}/${path.parse(entry.name).name}`] = mapper(
        path.join(srcDir, entry.name)
      )
    }
  }

  return aliases
}

const buildWorkspaceSourceAliases = (mapper) => {
  const aliases = {}

  for (const entry of fs.readdirSync(PACKAGES_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue

    const packageDir = path.join(PACKAGES_ROOT, entry.name)
    const packageName = getPackageName(packageDir)

    if (!packageName) continue

    Object.assign(
      aliases,
      getSourceEntryAliases(packageName, path.join(packageDir, 'src'), mapper)
    )
  }

  return aliases
}

/**
 * @type {import('next').NextConfig}
 */
const turbopackSourceAliases = buildWorkspaceSourceAliases(toSiteImportPath)
module.exports = async (phase) => {
  const isDev = phase === PHASE_DEVELOPMENT_SERVER

  return {
    output: 'export',
    turbopack: isDev
      ? {
          root: path.join(__dirname, '..'),
          resolveAlias: turbopackSourceAliases,
        }
      : undefined,
    // https://answers.netlify.com/t/basic-nextjs-website-failing-to-build-with-exit-code-129/120273/2
    experimental: {
      externalDir: isDev,
    },
  }
}
