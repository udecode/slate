import { readdirSync, readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'

const repoRoot = resolve(import.meta.dir, '../../..')
const slateReactRoot = resolve(repoRoot, 'packages/slate-react/src')
const sourceFiles = [
  resolve(slateReactRoot, 'components/editable.tsx'),
  ...readdirSync(resolve(slateReactRoot, 'editable'))
    .filter((file) => file.endsWith('.ts') || file.endsWith('.tsx'))
    .map((file) => resolve(slateReactRoot, 'editable', file)),
]

const getMatchesByFile = (pattern: RegExp) =>
  Object.fromEntries(
    sourceFiles
      .map((file) => {
        const source = readFileSync(file, 'utf8')
        const matches = source.match(pattern)

        return [relative(repoRoot, file), matches ? matches.length : 0] as const
      })
      .filter(([, count]) => count > 0)
      .sort(([a], [b]) => a.localeCompare(b))
  )

type AuthorityInventory = Record<
  string,
  {
    count: number
    owner: string
    rationale: string
    next: 'burn-down' | 'central-owner' | 'explicit-bridge' | 'worker'
  }
>

const expectAuthorityInventory = (
  pattern: RegExp,
  inventory: AuthorityInventory
) => {
  expect(getMatchesByFile(pattern)).toEqual(
    Object.fromEntries(
      Object.entries(inventory).map(([file, entry]) => [file, entry.count])
    )
  )
  expect(
    Object.values(inventory).every(
      (entry) =>
        entry.owner.length > 0 &&
        entry.rationale.length > 0 &&
        entry.next.length > 0
    )
  ).toBe(true)
}

test('kernel frame and trace ownership remains centralized', () => {
  expectAuthorityInventory(/\bbeginEditableEventFrame\(/g, {
    'packages/slate-react/src/components/editable.tsx': {
      count: 4,
      next: 'central-owner',
      owner: 'Editable event owner',
      rationale:
        'Editable opens runtime event frames before strategy workers run.',
    },
    'packages/slate-react/src/editable/browser-handle.ts': {
      count: 1,
      next: 'explicit-bridge',
      owner: 'Browser proof handle',
      rationale:
        'The test-only browser handle imports explicit DOM selections through a named bridge.',
    },
  })

  expectAuthorityInventory(/\brecordEditableKernelTrace\(/g, {
    'packages/slate-react/src/components/editable.tsx': {
      count: 3,
      next: 'central-owner',
      owner: 'Editable event owner',
      rationale:
        'Editable records user-event command traces after workers run.',
    },
    'packages/slate-react/src/editable/browser-handle.ts': {
      count: 2,
      next: 'explicit-bridge',
      owner: 'Browser proof handle',
      rationale:
        'The handle emits explicit test/proof traces for semantic browser actions.',
    },
    'packages/slate-react/src/editable/dom-repair-queue.ts': {
      count: 1,
      next: 'central-owner',
      owner: 'DOM repair queue',
      rationale: 'The repair executor emits repair traces when it mutates DOM.',
    },
  })
})

test('selection bridge authority has an explicit remaining inventory', () => {
  expectAuthorityInventory(
    /\b(syncEditorSelectionFromDOM|syncEditableDOMSelectionToEditor)\(/g,
    {
      'packages/slate-react/src/components/editable.tsx': {
        count: 1,
        next: 'central-owner',
        owner: 'Editable event owner',
        rationale:
          'Editable owns the main DOM-selection export/import boundary.',
      },
      'packages/slate-react/src/editable/browser-handle.ts': {
        count: 2,
        next: 'explicit-bridge',
        owner: 'Browser proof handle',
        rationale:
          'The browser handle is the explicit semantic test bridge, not app runtime mutation.',
      },
      'packages/slate-react/src/editable/selection-reconciler.ts': {
        count: 1,
        next: 'central-owner',
        owner: 'Selection reconciler',
        rationale:
          'Selection reconciler is the central DOM-to-model selection bridge worker.',
      },
    }
  )

  expectAuthorityInventory(/\beditor\.(select|deselect|move|collapse)\(/g, {
    'packages/slate-react/src/editable/browser-handle.ts': {
      count: 1,
      next: 'explicit-bridge',
      owner: 'Browser proof handle',
      rationale:
        'Explicit browser proof may set model selection through the bridge.',
    },
    'packages/slate-react/src/editable/caret-engine.ts': {
      count: 12,
      next: 'central-owner',
      owner: 'Caret engine',
      rationale:
        'Caret movement is centralized here instead of scattered handlers.',
    },
    'packages/slate-react/src/editable/dom-repair-queue.ts': {
      count: 1,
      next: 'central-owner',
      owner: 'DOM repair queue',
      rationale: 'Repair execution may restore model-owned caret selection.',
    },
    'packages/slate-react/src/editable/mutation-controller.ts': {
      count: 1,
      next: 'central-owner',
      owner: 'Mutation controller',
      rationale:
        'Mutation controller is the intended central model mutation worker.',
    },
    'packages/slate-react/src/editable/selection-controller.ts': {
      count: 5,
      next: 'central-owner',
      owner: 'Selection controller',
      rationale:
        'Selection controller is the central model selection bridge worker.',
    },
    'packages/slate-react/src/editable/selection-reconciler.ts': {
      count: 8,
      next: 'central-owner',
      owner: 'Selection reconciler',
      rationale:
        'Selection reconciler applies audited DOM/model selection reconciliation.',
    },
  })
})

test('mutation and repair authority has an explicit remaining inventory', () => {
  expectAuthorityInventory(
    /\b(Editor\.(insertText|deleteBackward|deleteForward|deleteFragment|insertBreak|insertSoftBreak)|ReactEditor\.insertData|editor\.(delete|removeNodes))\(/g,
    {
      'packages/slate-react/src/editable/clipboard-input-strategy.ts': {
        count: 3,
        next: 'worker',
        owner: 'Clipboard worker',
        rationale:
          'Clipboard keeps structural cut/drop cleanup after event ownership, selection import, repair, and trace are owned by Editable.',
      },
      'packages/slate-react/src/editable/composition-state.ts': {
        count: 2,
        next: 'worker',
        owner: 'Composition state',
        rationale:
          'Composition owns active IME buffer mutations under composition mode.',
      },
      'packages/slate-react/src/editable/dom-repair-queue.ts': {
        count: 1,
        next: 'central-owner',
        owner: 'DOM repair queue',
        rationale:
          'DOM input repair may reconcile text through the repair executor.',
      },
      'packages/slate-react/src/editable/mutation-controller.ts': {
        count: 9,
        next: 'central-owner',
        owner: 'Mutation controller',
        rationale:
          'Mutation controller is the intended owner for model mutation execution.',
      },
    }
  )

  expectAuthorityInventory(
    /\b(requestRepair|applyEditableRepairRequest|repairDOMInput|domRepairQueue\.repair|repairCaretAfterModelOperation|repairCaretAfterModelTextInsert)\(/g,
    {
      'packages/slate-react/src/components/editable.tsx': {
        count: 3,
        next: 'central-owner',
        owner: 'Editable event owner',
        rationale: 'Editable applies repair decisions returned by strategies.',
      },
      'packages/slate-react/src/editable/dom-repair-queue.ts': {
        count: 4,
        next: 'central-owner',
        owner: 'DOM repair queue',
        rationale: 'Repair queue is the central DOM repair executor.',
      },
      'packages/slate-react/src/editable/input-router.ts': {
        count: 1,
        next: 'explicit-bridge',
        owner: 'Input router',
        rationale:
          'Router forwards DOM input events to the Editable-owned repair callback.',
      },
      'packages/slate-react/src/editable/mutation-controller.ts': {
        count: 2,
        next: 'central-owner',
        owner: 'Mutation controller',
        rationale:
          'Mutation controller may request model-owned repair after mutations.',
      },
    }
  )
})
