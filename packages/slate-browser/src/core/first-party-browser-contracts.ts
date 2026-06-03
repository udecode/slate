import {
  createSlateBrowserPluginContractRegistry,
  defineSlateBrowserPluginContract,
  type SlateBrowserPluginContractRow,
} from './plugin-contracts'

export type SlateBrowserOperationFamilyContract = Omit<
  SlateBrowserPluginContractRow,
  'plugin'
>

export type SlateBrowserFirstLegacyParityFamily = {
  assertions: readonly string[]
  family: string
  routes: readonly string[]
}

export type SlateBrowserFirstPartyParityContractResult = {
  operationFamilyCount: number
  parityFamilies: string[]
  registryRowCount: number
}

export const SLATE_BROWSER_FIRST_PARTY_OPERATION_FAMILY_CONTRACTS = [
  {
    assertions: [
      'model selection lands on the next inline void from both sides',
      'DOM selection stays collapsed at the void boundary',
      'focus remains editor-owned',
      'selection movement stays inside the render budget',
    ],
    family: 'inline-void-boundary-navigation',
    routes: ['mentions'],
  },
  {
    assertions: [
      'markable inline void visible content keeps mark styling',
      'hidden anchor is owned by the runtime shell',
      'model and DOM selections land on the inline void',
      'selection movement stays inside the render budget',
    ],
    family: 'markable-inline-void-formatting',
    routes: ['mentions'],
  },
  {
    assertions: [
      'model and DOM selections enter and leave block voids',
      'visible void content has no hidden-anchor layout gap',
      'focus remains editor-owned',
      'selection movement stays inside the render budget',
    ],
    family: 'block-void-navigation',
    routes: ['images', 'embeds'],
  },
  {
    assertions: [
      'each pasted HTML image becomes a runtime-owned block void',
      'visible image content is contentEditable=false',
      'hidden spacer is owned by the runtime shell',
      'focus remains editor-owned after paste',
    ],
    family: 'paste-html-image-void',
    routes: ['paste-html'],
  },
  {
    assertions: [
      'editable island visible content stays inside a runtime-owned block void',
      'internal input focus remains native-owned',
      'outer editor selection is preserved while the native control edits',
      'follow-up editor typing records a legal insert-text transition',
    ],
    family: 'editable-island-native-focus',
    routes: ['editable-voids'],
  },
  {
    assertions: [
      'remote remove nulls local runtime targets',
      'remote move rebases local runtime targets',
      'remote import commit metadata is tagged',
      'follow-up editor typing works after stale target rebase',
    ],
    family: 'stale-target-remote-rebase',
    routes: ['images'],
  },
  {
    assertions: [
      'table cell boundary arrows land at offset 0',
      'model and DOM selection agree',
      'focus remains editor-owned',
      'selection movement does not rerender the editable root',
    ],
    family: 'table-cell-boundary-navigation',
    routes: ['tables'],
  },
  {
    assertions: [
      'external decoration refresh updates rendered highlights',
      'search input keeps focus ownership',
      'editor root and text nodes stay bounded while element nodes stay out of the render budget',
    ],
    family: 'external-decoration-refresh',
    routes: ['search-highlighting'],
  },
  {
    assertions: [
      'app-owned lint diagnostics update external decoration ranges',
      'lint result refresh reports visible projected slices',
      'editor focus and render ownership remain stable',
    ],
    family: 'overlay-many-decoration-sources',
    routes: ['linting'],
  },
  {
    assertions: [
      'annotation metadata updates without replacing the bookmark',
      'inline annotation payload changes render',
      'annotation sidebar remains attached to the same id',
    ],
    family: 'overlay-annotation-metadata-only',
    routes: ['comment-mode'],
  },
  {
    assertions: [
      'annotation bookmark rebase keeps inline projection attached',
      'annotation sidebar range follows inserted content',
      'annotation widget remains visible after rebase',
    ],
    family: 'overlay-annotation-bookmark-rebase',
    routes: ['comment-mode', 'persistent-annotation-anchors'],
  },
  {
    assertions: [
      'annotation-backed widgets wake by widget id',
      'selection and metadata changes keep widget visibility coherent',
      'clearing annotations clears dependent widgets',
    ],
    family: 'overlay-widget-dirty-id',
    routes: ['comment-mode'],
  },
  {
    assertions: [
      'mixed annotation and widget overlays stay in sync',
      'text edits before an annotation rebase inline projection',
      'clear removes inline and widget overlays',
    ],
    family: 'overlay-mixed-update',
    routes: ['comment-mode'],
  },
  {
    assertions: [
      'real mouse drag creates native and model selections',
      'hovering toolbar becomes visible',
      'focus remains editor-owned',
      'selection movement does not rerender Slate nodes',
    ],
    family: 'mouse-selection-toolbar',
    routes: ['hovering-toolbar'],
  },
  {
    assertions: [
      'paste normalizes multiline content',
      'follow-up typing commits',
      'undo replays the last edit',
      'artifact can replay the generated steps',
    ],
    family: 'paste-normalize-undo',
    routes: ['richtext', 'plaintext', 'forced-layout'],
  },
  {
    assertions: [
      'composition commits through the browser scenario runner',
      'model text includes the composed text',
      'focus remains editor-owned',
      'artifact can replay the generated steps',
    ],
    family: 'selection-repair-ime',
    routes: ['richtext'],
  },
  {
    assertions: [
      'composition next to an inline void inserts into the adjacent text node',
      'inline void structure remains intact',
      'DOM selection remains collapsed after composition',
      'artifact can replay the generated steps',
    ],
    family: 'ime-composition-inline-void-boundary',
    routes: ['mentions'],
  },
  {
    assertions: [
      'composition commits text through the browser scenario runner',
      'undo removes the committed composition text as one history unit',
      'model text returns to the pre-composition value',
      'artifact can replay the generated steps',
    ],
    family: 'ime-composition-undo',
    routes: ['richtext'],
  },
] satisfies readonly SlateBrowserOperationFamilyContract[]

export const SLATE_BROWSER_FIRST_LEGACY_PARITY_FAMILIES = [
  {
    assertions: [
      'model selection lands on the next inline void from both sides',
      'DOM selection stays collapsed at the void boundary',
    ],
    family: 'inline-void-boundary-navigation',
    routes: ['mentions'],
  },
  {
    assertions: [
      'model and DOM selections enter and leave block voids',
      'visible void content has no hidden-anchor layout gap',
    ],
    family: 'block-void-navigation',
    routes: ['images', 'embeds'],
  },
  {
    assertions: [
      'external decoration refresh updates rendered highlights',
      'search input keeps focus ownership',
    ],
    family: 'external-decoration-refresh',
    routes: ['search-highlighting'],
  },
  {
    assertions: [
      'real mouse drag creates native and model selections',
      'hovering toolbar becomes visible',
    ],
    family: 'mouse-selection-toolbar',
    routes: ['hovering-toolbar'],
  },
  {
    assertions: [
      'table cell boundary arrows land at offset 0',
      'model and DOM selection agree',
    ],
    family: 'table-cell-boundary-navigation',
    routes: ['tables'],
  },
] satisfies readonly SlateBrowserFirstLegacyParityFamily[]

const rowsByFamily = (families: readonly string[]) =>
  SLATE_BROWSER_FIRST_PARTY_OPERATION_FAMILY_CONTRACTS.filter((contract) =>
    families.includes(contract.family)
  )

export const SLATE_BROWSER_FIRST_PARTY_PLUGIN_CONTRACT_REGISTRY =
  createSlateBrowserPluginContractRegistry([
    defineSlateBrowserPluginContract({
      plugin: 'mentions',
      rows: rowsByFamily([
        'inline-void-boundary-navigation',
        'markable-inline-void-formatting',
      ]),
    }),
    defineSlateBrowserPluginContract({
      plugin: 'media',
      rows: rowsByFamily([
        'block-void-navigation',
        'paste-html-image-void',
        'stale-target-remote-rebase',
      ]),
    }),
    defineSlateBrowserPluginContract({
      plugin: 'editable-island',
      rows: rowsByFamily(['editable-island-native-focus']),
    }),
    defineSlateBrowserPluginContract({
      plugin: 'table',
      rows: rowsByFamily(['table-cell-boundary-navigation']),
    }),
    defineSlateBrowserPluginContract({
      plugin: 'external-decorations',
      rows: rowsByFamily([
        'external-decoration-refresh',
        'overlay-many-decoration-sources',
      ]),
    }),
    defineSlateBrowserPluginContract({
      plugin: 'annotations',
      rows: rowsByFamily([
        'overlay-annotation-metadata-only',
        'overlay-annotation-bookmark-rebase',
        'overlay-widget-dirty-id',
        'overlay-mixed-update',
      ]),
    }),
    defineSlateBrowserPluginContract({
      plugin: 'selection-ui',
      rows: rowsByFamily(['mouse-selection-toolbar']),
    }),
    defineSlateBrowserPluginContract({
      plugin: 'core-editing',
      rows: rowsByFamily([
        'paste-normalize-undo',
        'selection-repair-ime',
        'ime-composition-undo',
      ]),
    }),
    defineSlateBrowserPluginContract({
      plugin: 'inline-void-ime',
      rows: rowsByFamily(['ime-composition-inline-void-boundary']),
    }),
  ])

export const assertSlateBrowserFirstPartyParityContracts =
  (): SlateBrowserFirstPartyParityContractResult => {
    const registry = SLATE_BROWSER_FIRST_PARTY_PLUGIN_CONTRACT_REGISTRY

    if (
      registry.rows.length !==
      SLATE_BROWSER_FIRST_PARTY_OPERATION_FAMILY_CONTRACTS.length
    ) {
      throw new Error(
        'Plugin browser contract registry is missing stress rows.'
      )
    }

    for (const contract of SLATE_BROWSER_FIRST_PARTY_OPERATION_FAMILY_CONTRACTS) {
      const row = registry.rowByFamily.get(contract.family)

      if (!row) {
        throw new Error(
          `Plugin browser contract registry is missing "${contract.family}".`
        )
      }
      if (row.routes.join('\0') !== contract.routes.join('\0')) {
        throw new Error(
          `Plugin browser contract "${contract.family}" has stale routes.`
        )
      }
    }

    for (const parityFamily of SLATE_BROWSER_FIRST_LEGACY_PARITY_FAMILIES) {
      const row = registry.rowByFamily.get(parityFamily.family)

      if (!row) {
        throw new Error(
          `First legacy parity family "${parityFamily.family}" is not registered.`
        )
      }

      for (const route of parityFamily.routes) {
        if (!row.routes.includes(route)) {
          throw new Error(
            `First legacy parity family "${parityFamily.family}" is missing route "${route}".`
          )
        }
      }

      for (const assertion of parityFamily.assertions) {
        if (!row.assertions.includes(assertion)) {
          throw new Error(
            `First legacy parity family "${parityFamily.family}" is missing assertion "${assertion}".`
          )
        }
      }
    }

    return {
      operationFamilyCount:
        SLATE_BROWSER_FIRST_PARTY_OPERATION_FAMILY_CONTRACTS.length,
      parityFamilies: SLATE_BROWSER_FIRST_LEGACY_PARITY_FAMILIES.map(
        (family) => family.family
      ),
      registryRowCount: registry.rows.length,
    }
  }
