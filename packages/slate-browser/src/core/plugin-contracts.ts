export type SlateBrowserPluginContractRow = {
  assertions: readonly string[]
  family: string
  plugin: string
  routes: readonly string[]
}

export type SlateBrowserPluginContractDefinition = {
  plugin: string
  rows: readonly Omit<SlateBrowserPluginContractRow, 'plugin'>[]
}

export type SlateBrowserPluginContractRegistry = {
  rowByFamily: ReadonlyMap<string, SlateBrowserPluginContractRow>
  rows: readonly SlateBrowserPluginContractRow[]
}

export const defineSlateBrowserPluginContract = <
  T extends SlateBrowserPluginContractDefinition,
>(
  contract: T
): T => contract

export const createSlateBrowserPluginContractRegistry = (
  definitions: readonly SlateBrowserPluginContractDefinition[]
): SlateBrowserPluginContractRegistry => {
  const rows: SlateBrowserPluginContractRow[] = []
  const rowByFamily = new Map<string, SlateBrowserPluginContractRow>()

  for (const definition of definitions) {
    if (!definition.plugin) {
      throw new Error('Plugin browser contract is missing a plugin name.')
    }
    if (definition.rows.length === 0) {
      throw new Error(
        `Plugin browser contract "${definition.plugin}" has no rows.`
      )
    }

    for (const row of definition.rows) {
      if (!row.family) {
        throw new Error(
          `Plugin browser contract "${definition.plugin}" has a row without a family.`
        )
      }
      if (row.routes.length === 0) {
        throw new Error(
          `Plugin browser contract "${definition.plugin}" row "${row.family}" has no routes.`
        )
      }
      if (row.assertions.length === 0) {
        throw new Error(
          `Plugin browser contract "${definition.plugin}" row "${row.family}" has no assertions.`
        )
      }
      if (rowByFamily.has(row.family)) {
        throw new Error(
          `Plugin browser contract family "${row.family}" is registered more than once.`
        )
      }

      const registeredRow = Object.freeze({
        ...row,
        assertions: Object.freeze([...row.assertions]),
        plugin: definition.plugin,
        routes: Object.freeze([...row.routes]),
      })

      rows.push(registeredRow)
      rowByFamily.set(registeredRow.family, registeredRow)
    }
  }

  return Object.freeze({
    rowByFamily,
    rows: Object.freeze(rows),
  })
}
