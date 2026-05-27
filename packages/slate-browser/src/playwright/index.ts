import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import {
  type ConsoleMessage,
  expect,
  type Frame,
  type Locator,
  type Page,
} from '@playwright/test'

import type { PlaceholderShape } from '../browser/zero-width'

export {
  createSlateBrowserPluginContractRegistry,
  defineSlateBrowserPluginContract,
  type SlateBrowserPluginContractDefinition,
  type SlateBrowserPluginContractRegistry,
  type SlateBrowserPluginContractRow,
} from '../core/plugin-contracts'

import {
  composeText,
  composeTextDirect,
  enableCompositionKeyEvents,
} from './ime'

const baseUrl = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3101'
const READY_TIMEOUT_MS = 20_000
const DEFAULT_RUNTIME_ERROR_PATTERNS = [
  'Unable to find the path for Slate node',
  'Cannot resolve a Slate node',
  'Cannot resolve a DOM point',
  'Cannot resolve a DOM range',
]

export type SlateBrowserRuntimeErrorRecorder = {
  assertNone: () => void
  errors: string[]
  stop: () => void
}

export type SelectionSnapshot = {
  anchor: { path: number[]; offset: number }
  focus: { path: number[]; offset: number }
}

export type DOMSelectionSnapshot = {
  anchorNodeText: string | null
  anchorOffset: number
  focusNodeText: string | null
  focusOffset: number
}

export type DOMSelectionLocationSnapshot = {
  anchorOffset: number | null
  anchorPath: number[] | null
  anchorText: string | null
  isCollapsed: boolean | null
}

export type ClipboardPayloadSnapshot = {
  html: string | null
  text: string
  types: string[]
}

export type SelectionRectSnapshot = {
  x: number
  y: number
  width: number
  height: number
}

export type FocusOwnerSnapshot = {
  isContentEditable: boolean
  kind: 'contenteditable' | 'editor' | 'internal-control' | 'none' | 'outside'
  role: string | null
  tagName: string | null
  testId: string | null
}

export type SlateBrowserZeroWidthNodeShape = {
  hasBr: boolean
  hasFEFF: boolean
  html: string
  index: number
  kind: string | null
  length: string | null
  textContent: string
}

export type RenderedBlockDOMShapeSnapshot = {
  index: number
  innerText: string
  lineBoxCount: number
  textContent: string
  unexpectedZeroWidthBreaks: SlateBrowserZeroWidthNodeShape[]
  zeroWidthNodes: SlateBrowserZeroWidthNodeShape[]
}

export type RenderedDOMShapeExpectation = {
  blockIndex?: number
  domSelectionTarget?: Partial<DOMSelectionLocationSnapshot>
  innerText?: string
  lineBoxCount?:
    | number
    | {
        max?: number
        min?: number
      }
  noUnexpectedZeroWidthBreaks?: boolean
  textContent?: string
  zeroWidthBreakCount?: number
  zeroWidthCount?: number
}

export type SlateReactRenderKind =
  | 'core-time'
  | 'dom-text-sync'
  | 'editable'
  | 'element'
  | 'leaf'
  | 'root-plan'
  | 'runtime-time'
  | 'selector'
  | 'spacer'
  | 'text'
  | 'void'

export type SlateReactRenderProfilerEvent = {
  kind: SlateReactRenderKind
  id?: string | null
  runtimeId?: string | null
}

export type SlateReactRenderProfilerSnapshot = {
  byKey: Record<string, number>
  byKind: Partial<Record<SlateReactRenderKind, number>>
  events: SlateReactRenderProfilerEvent[]
  total: number
}

const installSlateReactRenderProfilerScript = () => {
  const target = window as Window & {
    __SLATE_REACT_RENDER_PROFILER__?: {
      record: (event: SlateReactRenderProfilerEvent) => void
    }
    __SLATE_REACT_RENDER_PROFILER_RESET__?: () => void
    __SLATE_REACT_RENDER_PROFILER_SNAPSHOT__?: () => SlateReactRenderProfilerSnapshot
  }
  const events: SlateReactRenderProfilerEvent[] = []
  const snapshot = (): SlateReactRenderProfilerSnapshot => {
    const byKey: Record<string, number> = {}
    const byKind: Partial<Record<SlateReactRenderKind, number>> = {}
    const isRenderEvent = (event: SlateReactRenderProfilerEvent) =>
      event.kind !== 'core-time' &&
      event.kind !== 'dom-text-sync' &&
      event.kind !== 'runtime-time' &&
      event.kind !== 'selector'

    for (const event of events) {
      byKind[event.kind] = (byKind[event.kind] ?? 0) + 1
      const id = event.id ?? event.runtimeId
      const key = id ? `${event.kind}:${id}` : event.kind
      byKey[key] = (byKey[key] ?? 0) + 1
    }

    return {
      byKey,
      byKind,
      events: events.map((event) => ({ ...event })),
      total: events.filter(isRenderEvent).length,
    }
  }

  target.__SLATE_REACT_RENDER_PROFILER__ = {
    record(event) {
      events.push({ ...event })
    },
  }
  target.__SLATE_REACT_RENDER_PROFILER_RESET__ = () => {
    events.length = 0
  }
  target.__SLATE_REACT_RENDER_PROFILER_SNAPSHOT__ = snapshot
}

export const installSlateReactRenderProfiler = async (page: Page) => {
  await page.addInitScript(installSlateReactRenderProfilerScript)
  await page.evaluate(installSlateReactRenderProfilerScript).catch(() => {})
}

export const resetSlateReactRenderProfiler = async (page: Page) => {
  await page.evaluate(() => {
    const target = window as Window & {
      __SLATE_REACT_RENDER_PROFILER_RESET__?: () => void
    }

    target.__SLATE_REACT_RENDER_PROFILER_RESET__?.()
  })
}

export const getSlateReactRenderProfilerSnapshot = async (
  page: Page
): Promise<SlateReactRenderProfilerSnapshot> =>
  page.evaluate(() => {
    const target = window as Window & {
      __SLATE_REACT_RENDER_PROFILER_SNAPSHOT__?: () => SlateReactRenderProfilerSnapshot
    }

    return (
      target.__SLATE_REACT_RENDER_PROFILER_SNAPSHOT__?.() ?? {
        byKey: {},
        byKind: {},
        events: [],
        total: 0,
      }
    )
  })

export type SlateBrowserKernelEventFamily =
  | 'beforeinput'
  | 'blur'
  | 'click'
  | 'compositionend'
  | 'compositionstart'
  | 'compositionupdate'
  | 'copy'
  | 'cut'
  | 'dragend'
  | 'dragover'
  | 'dragstart'
  | 'drop'
  | 'focus'
  | 'input'
  | 'keydown'
  | 'mousedown'
  | 'paste'
  | 'repair'
  | 'selectionchange'

export type SlateBrowserKernelState =
  | 'app-owned'
  | 'clipboard'
  | 'composition'
  | 'dom-selection'
  | 'dragging'
  | 'idle'
  | 'internal-control'
  | 'model-owned'
  | 'repairing'
  | 'shell-backed'

export type SlateBrowserKernelTargetOwner =
  | 'app-owned'
  | 'editor'
  | 'internal-control'
  | 'outside-editor'
  | 'shell'
  | 'unknown'

export type SlateBrowserKernelOwnership =
  | 'app-owned'
  | 'deferred'
  | 'model-owned'
  | 'native-allowed'
  | 'native-denied'
  | 'no-op'

export type SlateBrowserKernelSelectionSource =
  | 'app-owned'
  | 'composition-owned'
  | 'dom-current'
  | 'internal-control'
  | 'model-owned'
  | 'shell-backed'
  | 'unknown'

export type SlateBrowserKernelSelectionChangeOrigin =
  | 'browser-handle'
  | 'native-user'
  | 'programmatic-export'
  | 'repair-induced'
  | 'unknown'

export type SlateBrowserKernelCommand =
  | {
      direction: 'backward' | 'forward'
      kind: 'delete'
      unit?: 'block' | 'line' | 'word'
    }
  | { kind: 'delete-both'; unit: 'line' }
  | { direction?: 'backward' | 'forward'; kind: 'delete-fragment' }
  | { direction: 'redo' | 'undo'; kind: 'history' }
  | { kind: 'insert-break'; variant: 'paragraph' | 'soft' }
  | { data?: unknown; kind: 'insert-data' }
  | { inputType?: string; kind: 'insert-text'; text: string }
  | {
      axis: 'horizontal' | 'line' | 'word'
      extend?: boolean
      kind: 'move-selection'
      reverse?: boolean
    }
  | { kind: 'select'; selection: SelectionSnapshot }
  | { kind: 'select-all' }
  | { blockType: string; kind: 'set-block'; wrap?: string }
  | { kind: 'toggle-mark'; mark: string }

export type SlateBrowserKernelMovementOwnershipTrace = {
  axis: 'horizontal' | 'line' | 'unknown' | 'vertical' | 'word'
  extend: boolean
  key: string
  ownership: Extract<
    SlateBrowserKernelOwnership,
    'model-owned' | 'native-allowed'
  >
  reason:
    | 'model-horizontal-inline-void'
    | 'model-line-browser'
    | 'model-word-boundary'
    | 'native-selection-key'
    | 'native-vertical-layout'
  reverse: boolean | null
}

export type SlateBrowserKernelSelectionPolicy = {
  kind:
    | 'clear'
    | 'export-model'
    | 'import-dom'
    | 'none'
    | 'preserve-model'
    | 'shell'
  reason:
    | 'internal-control'
    | 'model-owned'
    | 'native-selection'
    | 'not-requested'
    | 'selection-clear'
    | 'shell-backed'
    | 'unknown-selection'
}

export type SlateBrowserKernelRepairPolicy = {
  kind:
    | 'force-render'
    | 'none'
    | 'repair-caret'
    | 'repair-text'
    | 'sync-selection'
  reason:
    | 'force-render'
    | 'not-requested'
    | 'repair-caret'
    | 'repair-caret-after-text-insert'
    | 'repair-text'
    | 'sync-selection'
}

export type SlateBrowserKernelTransition = {
  allowed: boolean
  reason: string | null
}

export type SlateBrowserKernelOperation = {
  type: string
  [key: string]: unknown
}

export type SlateBrowserKernelRepairRequest = {
  kind: string
  [key: string]: unknown
}

export type SlateBrowserKernelEventFrame = {
  active: boolean
  eventFamily: SlateBrowserKernelEventFamily
  focusOwner: SlateBrowserKernelTargetOwner
  id: number
  inputIntent: string | null
  modelSelectionBefore: SelectionSnapshot | null
  selectionSource: SlateBrowserKernelSelectionSource
  startedAt: number
  targetOwner: SlateBrowserKernelTargetOwner
}

export type SlateBrowserKernelTraceEntry = {
  command: SlateBrowserKernelCommand | null
  epochId: number | null
  eventFamily: SlateBrowserKernelEventFamily
  frame: SlateBrowserKernelEventFrame | null
  frameId: number | null
  intent: string | null
  movement: SlateBrowserKernelMovementOwnershipTrace | null
  nativeAllowed: boolean
  operations: readonly SlateBrowserKernelOperation[]
  ownership: SlateBrowserKernelOwnership
  repair: SlateBrowserKernelRepairRequest | null
  repairPolicy: SlateBrowserKernelRepairPolicy
  selectionChangeOrigin: SlateBrowserKernelSelectionChangeOrigin
  selectionAfter: SelectionSnapshot | null
  selectionBefore: SelectionSnapshot | null
  selectionPolicy: SlateBrowserKernelSelectionPolicy
  selectionSource: SlateBrowserKernelSelectionSource
  stateAfter: SlateBrowserKernelState
  stateBefore: SlateBrowserKernelState
  targetOwner: SlateBrowserKernelTargetOwner
  transition: SlateBrowserKernelTransition
}

export type SlateBrowserKernelTraceExpectation = {
  commandKind?: SlateBrowserKernelCommand['kind'] | null
  eventFamily?: SlateBrowserKernelEventFamily
  movement?: Partial<SlateBrowserKernelMovementOwnershipTrace> | null
  ownership?: SlateBrowserKernelOwnership
  repairPolicy?: Partial<SlateBrowserKernelRepairPolicy>
  selectionChangeOrigin?: SlateBrowserKernelSelectionChangeOrigin
  selectionPolicy?: Partial<SlateBrowserKernelSelectionPolicy>
  selectionSource?: SlateBrowserKernelSelectionSource
  stateAfter?: SlateBrowserKernelState
  stateBefore?: SlateBrowserKernelState
  targetOwner?: SlateBrowserKernelTargetOwner
  transition?: Partial<SlateBrowserKernelTransition>
}

export type SelectionPoint = SelectionSnapshot['anchor']
export type RangeRefAffinity =
  | 'forward'
  | 'backward'
  | 'outward'
  | 'inward'
  | null

export type SelectionBookmark = {
  id: string
}

export type SelectionCaptureOptions = {
  affinity?: RangeRefAffinity
}

export type OffsetExpectation = number | readonly [number, number]

export type SelectionSnapshotExpectation = {
  anchor: { path: number[]; offset: OffsetExpectation }
  focus: { path: number[]; offset: OffsetExpectation }
}

export type DOMSelectionSnapshotExpectation = {
  anchorNodeText: string | null
  anchorOffset: OffsetExpectation
  focusNodeText: string | null
  focusOffset: OffsetExpectation
}

export type HtmlNormalizationOptions = {
  ignoreClasses?: boolean
  ignoreInlineStyles?: boolean
  ignoreDir?: boolean
}

export type ReadyOptions = {
  editor?: 'visible'
  placeholder?: 'visible' | 'hidden'
  selector?: string
  text?: RegExp | string
  selection?: 'settled' | SelectionSnapshot
}

export type EditorSurfaceOptions = {
  frame?: string
  scope?: string
}

export type OpenExampleOptions = {
  query?:
    | Record<string, boolean | null | number | string | undefined>
    | URLSearchParams
    | string
  ready?: ReadyOptions
  surface?: EditorSurfaceOptions
}

export type EditorSnapshot = {
  text: string
  blockTexts: string[]
  renderedBlocks: RenderedBlockDOMShapeSnapshot[]
  selectedText: string
  selection: SelectionSnapshot | null
  domSelection: DOMSelectionSnapshot | null
  focusOwner: FocusOwnerSnapshot
  kernelTrace: SlateBrowserKernelTraceEntry[]
  lastCommit: unknown | null
  placeholderShape: PlaceholderShape | null
}

export type SlateBrowserShellSummary = {
  isInline: boolean
  isVoid: boolean
  kind: string | null
  path: string | null
  runtimeId: string | null
  tagName: string | null
}

export type SlateBrowserSelectedShellSnapshot = {
  element: SlateBrowserShellSummary | null
  node: SlateBrowserShellSummary | null
  offset: number
  path: number[]
  point: 'anchor' | 'focus'
}

export type SlateBrowserSelectionShellsSnapshot = {
  anchor: SlateBrowserSelectedShellSnapshot
  focus: SlateBrowserSelectedShellSnapshot
  runtimeIds: string[]
}

export type SlateBrowserRenderStateSnapshot = EditorSnapshot & {
  renderCounts: SlateReactRenderProfilerSnapshot
  selectionShells: SlateBrowserSelectionShellsSnapshot | null
}

export type SlateBrowserTraceEntry = {
  label: string
  snapshot: EditorSnapshot
  stepIndex: number | null
}

export type SlateBrowserScenarioMetadata = {
  capabilities?: readonly string[]
  platform?: string
  transport?: string
}

export type SlateBrowserTransportClaim =
  | 'desktop-native-clipboard'
  | 'desktop-native-ime-composition'
  | 'desktop-native-keyboard'
  | 'desktop-semantic-handle'
  | 'mixed-native-and-semantic'
  | 'mobile-semantic-handle'
  | 'mobile-synthetic-composition'
  | 'playwright-mobile-keyboard'
  | 'playwright-mobile-viewport'
  | 'synthetic-composition'
  | 'synthetic-datatransfer'
  | 'unspecified'

export type SlateBrowserNormalizedScenarioMetadata = {
  capabilities: string[]
  claim: SlateBrowserTransportClaim
  platform: string | null
  transport: string | null
}

export type SlateBrowserScenarioStepMetadata = {
  iteration?: number
  warmLoop?: string
}

export type SlateBrowserScenarioStep = (
  | {
      kind: 'applyOperations'
      label?: string
      operations: readonly Record<string, unknown>[]
      tag?: string | string[]
    }
  | {
      count?: number
      kind: 'assertLocatorCount'
      label?: string
      max?: number
      min?: number
      selector: string
    }
  | {
      index?: number
      kind: 'assertLocatorCss'
      label?: string
      notValue?: string
      property: string
      selector: string
      value?: string
    }
  | {
      afterSelector: string
      beforeSelector: string
      kind: 'assertLocatorVerticalGap'
      label?: string
      max?: number
      min?: number
    }
  | {
      innerSelector: string
      kind: 'assertLocatorVerticalOffset'
      label?: string
      max?: number
      min?: number
      selector: string
    }
  | {
      kind: 'assertModelSelectionExpanded'
      label?: string
    }
  | {
      kind: 'assertCapturedRuntimeIdPath'
      label?: string
      name: string
      path: number[] | null
    }
  | {
      budget: {
        byKind?: Partial<
          Record<
            SlateReactRenderKind,
            { exact?: number; max?: number; min?: number } | number
          >
        >
        total?: { exact?: number; max?: number; min?: number } | number
      }
      kind: 'assertRenderBudget'
      label?: string
    }
  | {
      contains?: string
      kind: 'assertWindowSelectionText'
      label?: string
      notEmpty?: boolean
      text?: string
    }
  | {
      kind: 'assertDOMSelection'
      label?: string
      selection: DOMSelectionSnapshotExpectation
    }
  | {
      focusOwner: FocusOwnerSnapshot['kind']
      kind: 'assertFocusOwner'
      label?: string
    }
  | {
      kind: 'assertKernelTrace'
      label?: string
      trace: SlateBrowserKernelTraceExpectation
    }
  | {
      kind: 'assertSelection'
      label?: string
      selection: SelectionSnapshotExpectation
    }
  | {
      kind: 'assertSelectionLocation'
      label?: string
      location: Partial<DOMSelectionLocationSnapshot>
    }
  | { kind: 'assertModelText'; label?: string; text: string }
  | {
      contains?: string
      kind: 'assertLocatorText'
      label?: string
      selector: string
      text?: string
    }
  | { kind: 'assertSelectedText'; label?: string; text: string }
  | { kind: 'assertText'; label?: string; text: string }
  | {
      buttonName: RegExp | string
      expectedSelection: SelectionSnapshotExpectation
      kind: 'activateShell'
      label?: string
    }
  | { kind: 'assertLastCommit'; label?: string }
  | { kind: 'assertLastCommitTags'; label?: string; tags: readonly string[] }
  | {
      command: { origin: string; type: string }
      kind: 'assertLastCommitCommand'
      label?: string
    }
  | { kind: 'clickTestId'; label?: string; testId: string }
  | { kind: 'clickSelector'; label?: string; selector: string }
  | { kind: 'captureRuntimeId'; label?: string; name: string; path: number[] }
  | {
      committedText?: string
      kind: 'composeText'
      label?: string
      steps?: readonly string[]
      text: string
      transport?: 'native' | 'synthetic'
    }
  | {
      kind: 'custom'
      label: string
      run: (editor: SlateBrowserEditorHarness) => Promise<void> | void
    }
  | {
      kind: 'assertDOMCaret'
      label?: string
      offset: number
      text: string
    }
  | {
      kind: 'assertBlockTexts'
      label?: string
      startIndex?: number
      texts: readonly string[]
    }
  | {
      kind: 'assertRenderedDOMShape'
      label?: string
      shape: RenderedDOMShapeExpectation
    }
  | {
      kind: 'clickTextOffset'
      label?: string
      offset: number
      path: number[]
    }
  | {
      kind: 'doubleClickTextOffset'
      label?: string
      offset: number
      path: number[]
    }
  | { kind: 'deleteBackward'; label?: string }
  | { kind: 'deleteForward'; label?: string }
  | {
      endXOffset?: number
      index?: number
      kind: 'dragTextSelection'
      label?: string
      selector: string
      startXOffset?: number
      steps?: number
      yOffset?: number
    }
  | { html: string; kind: 'dropHtml'; label?: string; text?: string }
  | { kind: 'fillControl'; label?: string; selector: string; value: string }
  | { kind: 'focus'; label?: string }
  | { kind: 'insertText'; label?: string; text: string }
  | { html: string; kind: 'pasteHtml'; label?: string; text?: string }
  | { kind: 'pasteText'; label?: string; text: string }
  | { key: string; kind: 'press'; label?: string }
  | { kind: 'rootClick'; label?: string }
  | { kind: 'rootMouseDown'; label?: string }
  | { kind: 'resetRenderProfiler'; label?: string }
  | { kind: 'select'; label?: string; selection: SelectionSnapshot }
  | { kind: 'selectDOM'; label?: string; selection: SelectionSnapshot }
  | { kind: 'selectAll'; label?: string }
  | { kind: 'settle'; label?: string; timeoutMs?: number }
  | { kind: 'snapshot'; label: string }
  | {
      caretAfterType: { offset: number; text: string }
      caretAfterUndo: { offset: number; text: string }
      expectedModelTextAfterType: string
      expectedModelTextAfterUndo: string
      kind: 'typeThenUndo'
      label?: string
      text: string
    }
  | { kind: 'type'; label?: string; text: string }
  | { expectedModelTextBefore?: string; kind: 'undo'; label?: string }
) &
  SlateBrowserScenarioStepMetadata

export type SlateBrowserScenarioResult = {
  metadata: SlateBrowserNormalizedScenarioMetadata
  name: string
  replay: SlateBrowserScenarioReplay
  reductionCandidates: SlateBrowserScenarioReductionCandidateSummary[]
  trace: SlateBrowserTraceEntry[]
}

export type SlateBrowserScenarioRunOptions = {
  metadata?: SlateBrowserScenarioMetadata
  runtimeErrors?:
    | false
    | {
        patterns?: readonly string[]
      }
  tracePath?: string
}

export type SlateBrowserScenarioReductionCandidate = {
  kind: 'iteration' | 'prefix' | 'single-step' | 'suffix'
  label: string
  removedRange: { end: number; start: number }
  steps: readonly SlateBrowserScenarioStep[]
}

export type SlateBrowserScenarioReductionCandidateSummary = Omit<
  SlateBrowserScenarioReductionCandidate,
  'steps'
> & {
  replay: SlateBrowserScenarioReplay
  stepLabels: string[]
}

export type SlateBrowserScenarioReplayStep = {
  iteration?: number
  kind: string
  label: string
  replayable: boolean
  value: Record<string, unknown>
  warmLoop?: string
}

export type SlateBrowserScenarioReplay = {
  replayable: boolean
  steps: SlateBrowserScenarioReplayStep[]
}

export type SlateBrowserNavigationTypingGauntletOptions = {
  insertedText: string
  movedSelection: SelectionSnapshot
  startSelection: SelectionSnapshot
  textAfterInsert: string
}

export type SlateBrowserClipboardPasteGauntletOptions = {
  html: string
  plainText?: string
  textAfterPaste: string
}

export type SlateBrowserDropDataGauntletOptions = {
  html: string
  plainText?: string
  textAfterDrop: string
}

export type SlateBrowserInlineCutTypingGauntletOptions = {
  domShape?: {
    afterCut?: RenderedDOMShapeExpectation
    afterTyping?: RenderedDOMShapeExpectation
  }
  replacementText: string
  selection: SelectionSnapshot
  textAfterTyping: string
}

export type SlateBrowserInternalControlGauntletOptions = {
  controlSelector: string
  controlValue: string
  followUpText: string
  outerSelection: SelectionSnapshot
  textAfterFollowUp: string
}

export type SlateBrowserCompositionGauntletOptions = {
  committedText?: string
  selection?: SelectionSnapshot
  steps?: readonly string[]
  text: string
  textAfterComposition: string
  transport?: 'native' | 'synthetic'
}

export type SlateBrowserTextInsertionGauntletOptions = {
  insertedText: string
  textAfterInsert: string
}

export type SlateBrowserShellActivationGauntletOptions = {
  buttonName: RegExp | string
  expectedSelection: SelectionSnapshotExpectation
}

export type SlateBrowserMarkTypingGauntletOptions = {
  hotkey: string
  insertedText: string
  selection: SelectionSnapshot
  textAfterInsert: string
}

export type SlateBrowserMarkClickTypingGauntletOptions = {
  clickPoint: SelectionPoint
  domCaretAfterInsert?: {
    offset: number
    text: string
  }
  hotkey: string
  insertedText: string
  markSelection: SelectionSnapshot
  selectionAfterInsert?: SelectionSnapshotExpectation
  selectionTransport?: 'dom' | 'model'
  textAfterInsert: string
}

export type SlateBrowserToolbarMarkClickTypingGauntletOptions = Omit<
  SlateBrowserMarkClickTypingGauntletOptions,
  'hotkey'
> & {
  markButtonTestId: string
  selectionTransport?: 'dom' | 'model'
}

export type SlateBrowserWarmLoopOptions = {
  createIteration: (iteration: number) => SlateBrowserScenarioStep[]
  iterations?: number
  label?: string
}

type SlateBrowserWarmToolbarArrowIterationOverride = Partial<
  Pick<
    SlateBrowserWarmToolbarArrowGauntletOptions,
    | 'markDOMSelection'
    | 'markSelection'
    | 'selectionAfterArrowLeft'
    | 'selectionAfterCollapse'
  >
>

export type SlateBrowserWarmToolbarArrowGauntletOptions = {
  domCaretAfterInsert?: {
    offset: number
    text: string
  }
  insertedText: string
  markDOMSelection: DOMSelectionSnapshotExpectation
  markButtonTestId: string
  markSelection: SelectionSnapshot
  selectedText: string
  selectionAfterArrowLeft: SelectionSnapshotExpectation
  selectionAfterCollapse: SelectionSnapshotExpectation
  selectionAfterInsert: SelectionSnapshotExpectation
  textAfterInsert: string
  warmIterationOverrides?: readonly SlateBrowserWarmToolbarArrowIterationOverride[]
  warmIterations?: number
}

export type SlateBrowserMixedEditingConformanceGauntletOptions = {
  deleteKey: 'Backspace' | 'Delete'
  domCaretAfterDelete?: {
    offset: number
    text: string
  }
  domCaretAfterFollowUp?: {
    offset: number
    text: string
  }
  domShape?: {
    afterDelete?: RenderedDOMShapeExpectation
    afterFollowUp?: RenderedDOMShapeExpectation
    afterInsert?: RenderedDOMShapeExpectation
  }
  insertedText: string
  navigationKeys: readonly string[]
  selectionAfterDelete: SelectionSnapshotExpectation
  selectionAfterFollowUp: SelectionSnapshotExpectation
  selectionAfterInsert: SelectionSnapshotExpectation
  selectionAfterNavigation: SelectionSnapshotExpectation
  startSelection: SelectionSnapshot
  textAfterDelete: string
  textAfterFollowUp: string
  textAfterInsert: string
  toolbarButtonTestId: string
  toolbarSelection: SelectionSnapshot
  toolbarSelectionAfterCommand: SelectionSnapshotExpectation
}

export type SlateBrowserDestructiveEditingGauntletOptions = {
  deleteAfterPasteKey?: 'Backspace' | 'Delete'
  domShape?: {
    afterDeleteAfterPaste?: RenderedDOMShapeExpectation
    afterFollowUp?: RenderedDOMShapeExpectation
    afterPaste?: RenderedDOMShapeExpectation
    afterWordDeleteFollowUp?: RenderedDOMShapeExpectation
    afterWordDeleteIterations?: readonly RenderedDOMShapeExpectation[]
  }
  followUpText: string
  pasteSelection: SelectionSnapshot
  pastedText: string
  selectionAfterDeleteAfterPaste?: SelectionSnapshotExpectation
  selectionAfterFollowUp?: SelectionSnapshotExpectation
  selectionAfterPaste?: SelectionSnapshotExpectation
  tailBlockTextsAfterWordDelete: readonly string[]
  textAfterDeleteAfterPaste: string
  textAfterFollowUp: string
  textAfterPaste: string
  wordDeleteIterations?: number
  wordDeleteKey?: string
  wordDeleteSelection: SelectionSnapshot
}

export type SlateBrowserSemanticEditingConformanceGauntletOptions = {
  insertedText: string
  selectionAfterDelete: SelectionSnapshotExpectation
  selectionAfterFollowUp: SelectionSnapshotExpectation
  selectionAfterInsert: SelectionSnapshotExpectation
  startSelection: SelectionSnapshot
  textAfterDelete: string
  textAfterFollowUp: string
  textAfterInsert: string
  toolbarButtonTestId: string
  toolbarSelection: SelectionSnapshot
  toolbarSelectionAfterCommand: SelectionSnapshotExpectation
}

export type SlateBrowserIllegalKernelTransition = {
  label: string
  reason: string | null
  stepIndex: number | null
}

export const createSlateBrowserNavigationTypingGauntlet = ({
  insertedText,
  movedSelection,
  startSelection,
  textAfterInsert,
}: SlateBrowserNavigationTypingGauntletOptions): SlateBrowserScenarioStep[] => [
  {
    kind: 'select',
    label: 'select-start',
    selection: startSelection,
  },
  {
    key: 'ArrowRight',
    kind: 'press',
    label: 'move-right',
  },
  {
    kind: 'assertSelection',
    label: 'assert-moved-selection',
    selection: movedSelection,
  },
  {
    kind: 'insertText',
    label: 'insert-after-navigation',
    text: insertedText,
  },
  {
    kind: 'assertText',
    label: 'assert-inserted-text',
    text: textAfterInsert,
  },
]

export const createSlateBrowserClipboardPasteGauntlet = ({
  html,
  plainText,
  textAfterPaste,
}: SlateBrowserClipboardPasteGauntletOptions): SlateBrowserScenarioStep[] => [
  {
    kind: 'selectAll',
    label: 'select-all',
  },
  {
    html,
    kind: 'pasteHtml',
    label: 'paste-html',
    text: plainText,
  },
  {
    kind: 'assertKernelTrace',
    label: 'assert-paste-command-trace',
    trace: {
      commandKind: 'insert-data',
      transition: { allowed: true },
    },
  },
  {
    kind: 'assertKernelTrace',
    label: 'assert-paste-repair-trace',
    trace: {
      eventFamily: 'repair',
      repairPolicy: { kind: 'repair-caret' },
      transition: { allowed: true },
    },
  },
  {
    kind: 'assertText',
    label: 'assert-pasted-text',
    text: textAfterPaste,
  },
]

export const createSlateBrowserDropDataGauntlet = ({
  html,
  plainText,
  textAfterDrop,
}: SlateBrowserDropDataGauntletOptions): SlateBrowserScenarioStep[] => [
  {
    kind: 'dropHtml',
    label: 'drop-html',
    html,
    text: plainText,
  },
  {
    kind: 'assertKernelTrace',
    label: 'assert-drop-command-trace',
    trace: {
      commandKind: 'insert-data',
      eventFamily: 'drop',
      transition: { allowed: true },
    },
  },
  {
    kind: 'assertText',
    label: 'assert-dropped-text',
    text: textAfterDrop,
  },
]

export const createSlateBrowserInlineCutTypingGauntlet = ({
  domShape,
  replacementText,
  selection,
  textAfterTyping,
}: SlateBrowserInlineCutTypingGauntletOptions): SlateBrowserScenarioStep[] => [
  {
    kind: 'select',
    label: 'select-inline-text',
    selection,
  },
  {
    key: 'ControlOrMeta+X',
    kind: 'press',
    label: 'cut-inline-text',
  },
  {
    kind: 'assertKernelTrace',
    label: 'assert-inline-cut-command-trace',
    trace: {
      commandKind: 'delete-fragment',
      transition: { allowed: true },
    },
  },
  ...(domShape?.afterCut
    ? [
        {
          kind: 'assertRenderedDOMShape' as const,
          label: 'assert-dom-shape-after-inline-cut',
          shape: domShape.afterCut,
        },
      ]
    : []),
  {
    kind: 'type',
    label: 'type-replacement',
    text: replacementText,
  },
  {
    kind: 'assertKernelTrace',
    label: 'assert-inline-repair-trace-after-type',
    trace: {
      eventFamily: 'repair',
      repairPolicy: { kind: 'repair-caret' },
      transition: { allowed: true },
    },
  },
  {
    kind: 'assertText',
    label: 'assert-replacement-text',
    text: textAfterTyping,
  },
  ...(domShape?.afterTyping
    ? [
        {
          kind: 'assertRenderedDOMShape' as const,
          label: 'assert-dom-shape-after-inline-cut-typing',
          shape: domShape.afterTyping,
        },
      ]
    : []),
]

export const createSlateBrowserInternalControlGauntlet = ({
  controlSelector,
  controlValue,
  followUpText,
  outerSelection,
  textAfterFollowUp,
}: SlateBrowserInternalControlGauntletOptions): SlateBrowserScenarioStep[] => [
  {
    kind: 'select',
    label: 'select-outer-editor',
    selection: outerSelection,
  },
  {
    kind: 'fillControl',
    label: 'edit-internal-control',
    selector: controlSelector,
    value: controlValue,
  },
  {
    focusOwner: 'internal-control',
    kind: 'assertFocusOwner',
    label: 'assert-internal-control-focus',
  },
  {
    kind: 'assertSelection',
    label: 'assert-outer-selection-preserved',
    selection: outerSelection,
  },
  {
    kind: 'focus',
    label: 'focus-outer-editor',
  },
  {
    kind: 'insertText',
    label: 'insert-after-internal-control',
    text: followUpText,
  },
  {
    kind: 'assertKernelTrace',
    label: 'assert-internal-control-follow-up-insert-trace',
    trace: {
      commandKind: 'insert-text',
      eventFamily: 'repair',
      selectionChangeOrigin: 'browser-handle',
      transition: { allowed: true },
    },
  },
  {
    kind: 'assertText',
    label: 'assert-follow-up-text',
    text: textAfterFollowUp,
  },
]

export const createSlateBrowserCompositionGauntlet = ({
  committedText,
  selection,
  steps,
  text,
  textAfterComposition,
  transport,
}: SlateBrowserCompositionGauntletOptions): SlateBrowserScenarioStep[] => [
  ...(selection
    ? [
        {
          kind: 'select' as const,
          label: 'select-composition-start',
          selection,
        },
      ]
    : []),
  {
    committedText,
    kind: 'composeText',
    label: 'compose-text',
    steps,
    text,
    transport,
  },
  {
    kind: 'assertKernelTrace',
    label: 'assert-composition-start-trace',
    trace: {
      eventFamily: 'compositionstart',
      transition: { allowed: true },
    },
  },
  {
    kind: 'assertKernelTrace',
    label: 'assert-composition-update-trace',
    trace: {
      eventFamily: 'compositionupdate',
      transition: { allowed: true },
    },
  },
  {
    kind: 'assertKernelTrace',
    label: 'assert-composition-end-trace',
    trace: {
      eventFamily: 'compositionend',
      transition: { allowed: true },
    },
  },
  {
    kind: 'assertText',
    label: 'assert-composed-text',
    text: textAfterComposition,
  },
]

export const createSlateBrowserTextInsertionGauntlet = ({
  insertedText,
  textAfterInsert,
}: SlateBrowserTextInsertionGauntletOptions): SlateBrowserScenarioStep[] => [
  {
    kind: 'insertText',
    label: 'insert-text',
    text: insertedText,
  },
  {
    kind: 'assertKernelTrace',
    label: 'assert-text-insert-command-trace',
    trace: {
      commandKind: 'insert-text',
      eventFamily: 'repair',
      transition: { allowed: true },
    },
  },
  {
    kind: 'assertText',
    label: 'assert-inserted-text',
    text: textAfterInsert,
  },
]

export const createSlateBrowserShellActivationGauntlet = ({
  buttonName,
  expectedSelection,
}: SlateBrowserShellActivationGauntletOptions): SlateBrowserScenarioStep[] => [
  {
    buttonName,
    expectedSelection,
    kind: 'activateShell',
    label: 'activate-shell',
  },
]

export const createSlateBrowserMarkTypingGauntlet = ({
  hotkey,
  insertedText,
  selection,
  textAfterInsert,
}: SlateBrowserMarkTypingGauntletOptions): SlateBrowserScenarioStep[] => [
  {
    kind: 'select',
    label: 'select-mark-start',
    selection,
  },
  {
    key: hotkey,
    kind: 'press',
    label: 'toggle-mark',
  },
  { kind: 'type', label: 'type-marked-text', text: insertedText },
  {
    kind: 'assertText',
    label: 'assert-marked-text',
    text: textAfterInsert,
  },
]

export const createSlateBrowserMarkClickTypingGauntlet = ({
  clickPoint,
  domCaretAfterInsert,
  hotkey,
  insertedText,
  markSelection,
  selectionAfterInsert,
  selectionTransport = 'model',
  textAfterInsert,
}: SlateBrowserMarkClickTypingGauntletOptions): SlateBrowserScenarioStep[] => [
  {
    kind: selectionTransport === 'dom' ? 'selectDOM' : 'select',
    label: 'select-mark-range',
    selection: markSelection,
  },
  {
    key: hotkey,
    kind: 'press',
    label: 'toggle-mark',
  },
  {
    kind: 'clickTextOffset',
    label: 'click-after-mark-split',
    offset: clickPoint.offset,
    path: clickPoint.path,
  },
  {
    kind: 'type',
    label: 'type-after-mark-click',
    text: insertedText,
  },
  {
    kind: 'assertText',
    label: 'assert-text-after-mark-click',
    text: textAfterInsert,
  },
  ...(selectionAfterInsert
    ? [
        {
          kind: 'assertSelection' as const,
          label: 'assert-selection-after-mark-click',
          selection: selectionAfterInsert,
        },
      ]
    : []),
  ...(domCaretAfterInsert
    ? [
        {
          kind: 'assertDOMCaret' as const,
          label: 'assert-dom-caret-after-mark-click',
          offset: domCaretAfterInsert.offset,
          text: domCaretAfterInsert.text,
        },
      ]
    : []),
]

export const createSlateBrowserToolbarMarkClickTypingGauntlet = ({
  clickPoint,
  domCaretAfterInsert,
  insertedText,
  markButtonTestId,
  markSelection,
  selectionTransport = 'model',
  selectionAfterInsert,
  textAfterInsert,
}: SlateBrowserToolbarMarkClickTypingGauntletOptions): SlateBrowserScenarioStep[] => [
  {
    kind: selectionTransport === 'dom' ? 'selectDOM' : 'select',
    label: 'select-mark-range',
    selection: markSelection,
  },
  {
    kind: 'clickTestId',
    label: 'toggle-mark-from-toolbar',
    testId: markButtonTestId,
  },
  {
    kind: 'clickTextOffset',
    label: 'click-after-toolbar-mark-split',
    offset: clickPoint.offset,
    path: clickPoint.path,
  },
  {
    kind: 'type',
    label: 'type-after-toolbar-mark-click',
    text: insertedText,
  },
  {
    kind: 'assertKernelTrace',
    label: 'assert-repair-trace-after-toolbar-mark-click',
    trace: {
      eventFamily: 'repair',
      repairPolicy: { kind: 'repair-caret' },
      transition: { allowed: true },
    },
  },
  {
    kind: 'assertText',
    label: 'assert-text-after-toolbar-mark-click',
    text: textAfterInsert,
  },
  ...(selectionAfterInsert
    ? [
        {
          kind: 'assertSelection' as const,
          label: 'assert-selection-after-toolbar-mark-click',
          selection: selectionAfterInsert,
        },
      ]
    : []),
  ...(domCaretAfterInsert
    ? [
        {
          kind: 'assertDOMCaret' as const,
          label: 'assert-dom-caret-after-toolbar-mark-click',
          offset: domCaretAfterInsert.offset,
          text: domCaretAfterInsert.text,
        },
      ]
    : []),
]

const createWarmTimingWaitStep = (label: string): SlateBrowserScenarioStep => ({
  kind: 'settle',
  label,
  timeoutMs: 25,
})

const createToolbarMarkClickStep = (
  label: string,
  markButtonTestId: string
): SlateBrowserScenarioStep => ({
  kind: 'clickTestId',
  label,
  testId: markButtonTestId,
})

export const createSlateBrowserWarmLoopSteps = ({
  createIteration,
  iterations = 1,
  label = 'warm-loop',
}: SlateBrowserWarmLoopOptions): SlateBrowserScenarioStep[] => {
  const count = Math.max(1, iterations)

  return Array.from({ length: count }, (_, index) =>
    createIteration(index + 1).map((step) => ({
      ...step,
      iteration: index + 1,
      warmLoop: label,
    }))
  ).flat()
}

const createWarmToolbarArrowIteration = ({
  iteration,
  markDOMSelection,
  markButtonTestId,
  markSelection,
  selectedText,
  selectionAfterArrowLeft,
  selectionAfterCollapse,
}: Omit<
  SlateBrowserWarmToolbarArrowGauntletOptions,
  | 'domCaretAfterInsert'
  | 'insertedText'
  | 'selectionAfterInsert'
  | 'textAfterInsert'
> & {
  iteration: number
}): SlateBrowserScenarioStep[] => [
  {
    kind: 'selectDOM',
    label: `warm-select-word-${iteration}`,
    selection: markSelection,
  },
  {
    kind: 'assertDOMSelection',
    label: `assert-warm-dom-word-selected-${iteration}`,
    selection: markDOMSelection,
  },
  createToolbarMarkClickStep(`warm-bold-on-${iteration}`, markButtonTestId),
  createWarmTimingWaitStep(`warm-wait-after-bold-on-${iteration}`),
  {
    kind: 'assertSelectedText',
    label: `assert-selection-expanded-after-bold-on-${iteration}`,
    text: selectedText,
  },
  createToolbarMarkClickStep(`warm-bold-off-${iteration}`, markButtonTestId),
  createWarmTimingWaitStep(`warm-wait-after-bold-off-${iteration}`),
  {
    kind: 'assertSelectedText',
    label: `assert-selection-expanded-after-bold-off-${iteration}`,
    text: selectedText,
  },
  {
    key: 'ArrowRight',
    kind: 'press',
    label: `warm-arrow-right-after-bold-off-${iteration}`,
  },
  createWarmTimingWaitStep(`warm-wait-after-arrow-right-${iteration}-1`),
  {
    kind: 'assertSelection',
    label: `assert-selection-collapsed-after-arrow-right-${iteration}-1`,
    selection: selectionAfterCollapse,
  },
  {
    key: 'ArrowLeft',
    kind: 'press',
    label: `warm-arrow-left-after-collapse-${iteration}`,
  },
  createWarmTimingWaitStep(`warm-wait-after-arrow-left-${iteration}`),
  {
    kind: 'assertSelection',
    label: `assert-selection-after-arrow-left-${iteration}`,
    selection: selectionAfterArrowLeft,
  },
  {
    kind: 'assertKernelTrace',
    label: `assert-movement-trace-after-warm-arrows-${iteration}`,
    trace: {
      commandKind: 'move-selection',
      movement: {
        axis: 'horizontal',
        ownership: 'model-owned',
        reason: 'model-horizontal-inline-void',
      },
      transition: { allowed: true },
    },
  },
  {
    key: 'ArrowRight',
    kind: 'press',
    label: `warm-arrow-right-after-arrow-left-${iteration}`,
  },
  createWarmTimingWaitStep(`warm-wait-after-arrow-right-${iteration}-2`),
  {
    kind: 'assertSelection',
    label: `assert-selection-collapsed-after-arrow-right-${iteration}-2`,
    selection: selectionAfterCollapse,
  },
]

export const createSlateBrowserWarmToolbarArrowGauntlet = ({
  domCaretAfterInsert,
  insertedText,
  markDOMSelection,
  markButtonTestId,
  markSelection,
  selectedText,
  selectionAfterArrowLeft,
  selectionAfterCollapse,
  selectionAfterInsert,
  textAfterInsert,
  warmIterationOverrides,
  warmIterations = 1,
}: SlateBrowserWarmToolbarArrowGauntletOptions): SlateBrowserScenarioStep[] => [
  {
    kind: 'rootMouseDown',
    label: 'activate-editor-before-warm-selection',
  },
  ...createSlateBrowserWarmLoopSteps({
    createIteration: (iteration) =>
      createWarmToolbarArrowIteration({
        iteration,
        markDOMSelection:
          warmIterationOverrides?.[iteration - 1]?.markDOMSelection ??
          markDOMSelection,
        markButtonTestId,
        markSelection:
          warmIterationOverrides?.[iteration - 1]?.markSelection ??
          markSelection,
        selectedText,
        selectionAfterArrowLeft:
          warmIterationOverrides?.[iteration - 1]?.selectionAfterArrowLeft ??
          selectionAfterArrowLeft,
        selectionAfterCollapse:
          warmIterationOverrides?.[iteration - 1]?.selectionAfterCollapse ??
          selectionAfterCollapse,
      }),
    iterations: warmIterations,
    label: 'warm-toolbar-arrow',
  }),
  {
    kind: 'type',
    label: 'warm-type-after-toolbar-arrow',
    text: insertedText,
  },
  {
    kind: 'assertKernelTrace',
    label: 'assert-repair-trace-after-warm-type',
    trace: {
      eventFamily: 'repair',
      repairPolicy: { kind: 'repair-caret' },
      transition: { allowed: true },
    },
  },
  {
    focusOwner: 'editor',
    kind: 'assertFocusOwner',
    label: 'assert-focus-after-warm-type',
  },
  {
    kind: 'assertText',
    label: 'assert-text-after-warm-type',
    text: textAfterInsert,
  },
  {
    kind: 'assertSelection',
    label: 'assert-selection-after-warm-type',
    selection: selectionAfterInsert,
  },
  ...(domCaretAfterInsert
    ? [
        {
          kind: 'assertDOMCaret' as const,
          label: 'assert-dom-caret-after-warm-type',
          offset: domCaretAfterInsert.offset,
          text: domCaretAfterInsert.text,
        },
      ]
    : []),
]

export const createSlateBrowserMixedEditingConformanceGauntlet = ({
  deleteKey,
  domCaretAfterDelete,
  domCaretAfterFollowUp,
  domShape,
  insertedText,
  navigationKeys,
  selectionAfterDelete,
  selectionAfterFollowUp,
  selectionAfterInsert,
  selectionAfterNavigation,
  startSelection,
  textAfterDelete,
  textAfterFollowUp,
  textAfterInsert,
  toolbarButtonTestId,
  toolbarSelection,
  toolbarSelectionAfterCommand,
}: SlateBrowserMixedEditingConformanceGauntletOptions): SlateBrowserScenarioStep[] => [
  {
    kind: 'select',
    label: 'select-navigation-start',
    selection: startSelection,
  },
  ...navigationKeys.map(
    (key, index): SlateBrowserScenarioStep => ({
      key,
      kind: 'press',
      label: `navigate-${index + 1}-${key}`,
    })
  ),
  {
    kind: 'assertSelection',
    label: 'assert-selection-after-navigation',
    selection: selectionAfterNavigation,
  },
  {
    kind: 'assertKernelTrace',
    label: 'assert-navigation-command-trace',
    trace: {
      commandKind: 'move-selection',
      transition: { allowed: true },
    },
  },
  {
    kind: 'type',
    label: 'type-after-navigation',
    text: insertedText,
  },
  {
    kind: 'assertKernelTrace',
    label: 'assert-repair-trace-after-type',
    trace: {
      eventFamily: 'repair',
      repairPolicy: { kind: 'repair-caret' },
      transition: { allowed: true },
    },
  },
  {
    kind: 'assertText',
    label: 'assert-text-after-type',
    text: textAfterInsert,
  },
  ...(domShape?.afterInsert
    ? [
        {
          kind: 'assertRenderedDOMShape' as const,
          label: 'assert-dom-shape-after-type',
          shape: domShape.afterInsert,
        },
      ]
    : []),
  {
    kind: 'assertSelection',
    label: 'assert-selection-after-type',
    selection: selectionAfterInsert,
  },
  {
    key: deleteKey,
    kind: 'press',
    label: `delete-after-type-${deleteKey}`,
  },
  {
    kind: 'assertKernelTrace',
    label: 'assert-delete-command-trace',
    trace: {
      commandKind: 'delete',
      transition: { allowed: true },
    },
  },
  {
    kind: 'assertText',
    label: 'assert-text-after-delete',
    text: textAfterDelete,
  },
  ...(domShape?.afterDelete
    ? [
        {
          kind: 'assertRenderedDOMShape' as const,
          label: 'assert-dom-shape-after-delete',
          shape: domShape.afterDelete,
        },
      ]
    : []),
  {
    kind: 'assertSelection',
    label: 'assert-selection-after-delete',
    selection: selectionAfterDelete,
  },
  ...(domCaretAfterDelete
    ? [
        {
          kind: 'assertDOMCaret' as const,
          label: 'assert-dom-caret-after-delete',
          offset: domCaretAfterDelete.offset,
          text: domCaretAfterDelete.text,
        },
      ]
    : []),
  {
    kind: 'rootMouseDown',
    label: 'activate-editor-dom-selection',
  },
  {
    kind: 'selectDOM',
    label: 'select-toolbar-target-through-dom',
    selection: toolbarSelection,
  },
  {
    kind: 'clickTestId',
    label: 'run-toolbar-command',
    testId: toolbarButtonTestId,
  },
  {
    kind: 'assertSelection',
    label: 'assert-toolbar-selection-after-command',
    selection: toolbarSelectionAfterCommand,
  },
  {
    kind: 'type',
    label: 'type-after-toolbar-command',
    text: insertedText,
  },
  {
    kind: 'assertKernelTrace',
    label: 'assert-repair-trace-after-toolbar-follow-up',
    trace: {
      eventFamily: 'repair',
      repairPolicy: { kind: 'repair-caret' },
      transition: { allowed: true },
    },
  },
  {
    focusOwner: 'editor',
    kind: 'assertFocusOwner',
    label: 'assert-editor-focus-after-toolbar-follow-up',
  },
  {
    kind: 'assertText',
    label: 'assert-text-after-toolbar-follow-up',
    text: textAfterFollowUp,
  },
  ...(domShape?.afterFollowUp
    ? [
        {
          kind: 'assertRenderedDOMShape' as const,
          label: 'assert-dom-shape-after-toolbar-follow-up',
          shape: domShape.afterFollowUp,
        },
      ]
    : []),
  {
    kind: 'assertSelection',
    label: 'assert-selection-after-toolbar-follow-up',
    selection: selectionAfterFollowUp,
  },
  ...(domCaretAfterFollowUp
    ? [
        {
          kind: 'assertDOMCaret' as const,
          label: 'assert-dom-caret-after-toolbar-follow-up',
          offset: domCaretAfterFollowUp.offset,
          text: domCaretAfterFollowUp.text,
        },
      ]
    : []),
]

export const createSlateBrowserDestructiveEditingGauntlet = ({
  deleteAfterPasteKey = 'Backspace',
  domShape,
  followUpText,
  pasteSelection,
  pastedText,
  selectionAfterDeleteAfterPaste,
  selectionAfterFollowUp,
  selectionAfterPaste,
  tailBlockTextsAfterWordDelete,
  textAfterDeleteAfterPaste,
  textAfterFollowUp,
  textAfterPaste,
  wordDeleteIterations = 4,
  wordDeleteKey = 'Alt+Backspace',
  wordDeleteSelection,
}: SlateBrowserDestructiveEditingGauntletOptions): SlateBrowserScenarioStep[] => [
  {
    kind: 'select',
    label: 'select-paste-range',
    selection: pasteSelection,
  },
  {
    kind: 'pasteText',
    label: 'paste-over-selected-range',
    text: pastedText,
  },
  {
    kind: 'assertText',
    label: 'assert-text-after-paste',
    text: textAfterPaste,
  },
  ...(domShape?.afterPaste
    ? [
        {
          kind: 'assertRenderedDOMShape' as const,
          label: 'assert-dom-shape-after-paste',
          shape: domShape.afterPaste,
        },
      ]
    : []),
  ...(selectionAfterPaste
    ? [
        {
          kind: 'assertSelection' as const,
          label: 'assert-selection-after-paste',
          selection: selectionAfterPaste,
        },
      ]
    : []),
  {
    key: deleteAfterPasteKey,
    kind: 'press',
    label: `delete-after-paste-${deleteAfterPasteKey}`,
  },
  {
    kind: 'assertKernelTrace',
    label: 'assert-delete-trace-after-paste',
    trace: {
      commandKind: 'delete',
      transition: { allowed: true },
    },
  },
  {
    kind: 'assertText',
    label: 'assert-text-after-delete-after-paste',
    text: textAfterDeleteAfterPaste,
  },
  ...(domShape?.afterDeleteAfterPaste
    ? [
        {
          kind: 'assertRenderedDOMShape' as const,
          label: 'assert-dom-shape-after-delete-after-paste',
          shape: domShape.afterDeleteAfterPaste,
        },
      ]
    : []),
  ...(selectionAfterDeleteAfterPaste
    ? [
        {
          kind: 'assertSelection' as const,
          label: 'assert-selection-after-delete-after-paste',
          selection: selectionAfterDeleteAfterPaste,
        },
      ]
    : []),
  {
    kind: 'type',
    label: 'type-after-delete-after-paste',
    text: followUpText,
  },
  {
    kind: 'assertKernelTrace',
    label: 'assert-repair-trace-after-delete-follow-up',
    trace: {
      eventFamily: 'repair',
      repairPolicy: { kind: 'repair-caret' },
      transition: { allowed: true },
    },
  },
  {
    focusOwner: 'editor',
    kind: 'assertFocusOwner',
    label: 'assert-focus-after-delete-follow-up',
  },
  {
    kind: 'assertText',
    label: 'assert-text-after-delete-follow-up',
    text: textAfterFollowUp,
  },
  ...(domShape?.afterFollowUp
    ? [
        {
          kind: 'assertRenderedDOMShape' as const,
          label: 'assert-dom-shape-after-delete-follow-up',
          shape: domShape.afterFollowUp,
        },
      ]
    : []),
  ...(selectionAfterFollowUp
    ? [
        {
          kind: 'assertSelection' as const,
          label: 'assert-selection-after-delete-follow-up',
          selection: selectionAfterFollowUp,
        },
      ]
    : []),
  {
    kind: 'select',
    label: 'select-word-delete-start',
    selection: wordDeleteSelection,
  },
  ...Array.from(
    { length: Math.max(1, wordDeleteIterations) },
    (_, index): SlateBrowserScenarioStep[] => [
      {
        key: wordDeleteKey,
        kind: 'press',
        label: `word-delete-backward-${index + 1}`,
      },
      {
        kind: 'assertKernelTrace',
        label: `assert-word-delete-trace-${index + 1}`,
        trace: {
          commandKind: 'delete',
          transition: { allowed: true },
        },
      },
      {
        kind: 'assertBlockTexts',
        label: `assert-tail-blocks-after-word-delete-${index + 1}`,
        startIndex: 1,
        texts: tailBlockTextsAfterWordDelete,
      },
      ...(domShape?.afterWordDeleteIterations?.[index]
        ? [
            {
              kind: 'assertRenderedDOMShape' as const,
              label: `assert-dom-shape-after-word-delete-${index + 1}`,
              shape: domShape.afterWordDeleteIterations[index]!,
            },
          ]
        : []),
    ]
  ).flat(),
  {
    kind: 'type',
    label: 'type-after-word-delete',
    text: followUpText,
  },
  {
    kind: 'assertBlockTexts',
    label: 'assert-tail-blocks-after-word-delete-follow-up',
    startIndex: 1,
    texts: tailBlockTextsAfterWordDelete,
  },
  ...(domShape?.afterWordDeleteFollowUp
    ? [
        {
          kind: 'assertRenderedDOMShape' as const,
          label: 'assert-dom-shape-after-word-delete-follow-up',
          shape: domShape.afterWordDeleteFollowUp,
        },
      ]
    : []),
]

export const createSlateBrowserSemanticEditingConformanceGauntlet = ({
  insertedText,
  selectionAfterDelete,
  selectionAfterFollowUp,
  selectionAfterInsert,
  startSelection,
  textAfterDelete,
  textAfterFollowUp,
  textAfterInsert,
  toolbarButtonTestId,
  toolbarSelection,
  toolbarSelectionAfterCommand,
}: SlateBrowserSemanticEditingConformanceGauntletOptions): SlateBrowserScenarioStep[] => [
  {
    kind: 'select',
    label: 'select-semantic-start',
    selection: startSelection,
  },
  {
    kind: 'insertText',
    label: 'semantic-insert-text',
    text: insertedText,
  },
  {
    kind: 'assertKernelTrace',
    label: 'assert-semantic-insert-command-trace',
    trace: {
      commandKind: 'insert-text',
      eventFamily: 'repair',
      transition: { allowed: true },
    },
  },
  {
    kind: 'assertText',
    label: 'assert-text-after-semantic-insert',
    text: textAfterInsert,
  },
  {
    kind: 'assertSelection',
    label: 'assert-selection-after-semantic-insert',
    selection: selectionAfterInsert,
  },
  {
    kind: 'deleteBackward',
    label: 'semantic-delete-backward',
  },
  {
    kind: 'assertKernelTrace',
    label: 'assert-semantic-delete-command-trace',
    trace: {
      commandKind: 'delete',
      eventFamily: 'repair',
      selectionChangeOrigin: 'browser-handle',
      transition: { allowed: true },
    },
  },
  {
    kind: 'assertText',
    label: 'assert-text-after-semantic-delete',
    text: textAfterDelete,
  },
  {
    kind: 'assertSelection',
    label: 'assert-selection-after-semantic-delete',
    selection: selectionAfterDelete,
  },
  {
    kind: 'rootMouseDown',
    label: 'activate-editor-dom-selection',
  },
  {
    kind: 'selectDOM',
    label: 'select-toolbar-target-through-dom',
    selection: toolbarSelection,
  },
  {
    kind: 'clickTestId',
    label: 'run-toolbar-command',
    testId: toolbarButtonTestId,
  },
  {
    kind: 'assertSelection',
    label: 'assert-toolbar-selection-after-command',
    selection: toolbarSelectionAfterCommand,
  },
  {
    kind: 'insertText',
    label: 'semantic-insert-after-toolbar-command',
    text: insertedText,
  },
  {
    kind: 'assertKernelTrace',
    label: 'assert-semantic-toolbar-follow-up-trace',
    trace: {
      commandKind: 'insert-text',
      eventFamily: 'repair',
      selectionChangeOrigin: 'browser-handle',
      transition: { allowed: true },
    },
  },
  {
    kind: 'assertText',
    label: 'assert-text-after-toolbar-follow-up',
    text: textAfterFollowUp,
  },
  {
    kind: 'assertSelection',
    label: 'assert-selection-after-toolbar-follow-up',
    selection: selectionAfterFollowUp,
  },
]

export const getIllegalKernelTransitions = (
  result: SlateBrowserScenarioResult
): SlateBrowserIllegalKernelTransition[] =>
  result.trace.flatMap((entry) =>
    entry.snapshot.kernelTrace.flatMap((kernelEntry) => {
      const { transition } = kernelEntry

      return transition?.allowed === false
        ? [
            {
              label: entry.label,
              reason: transition.reason ?? null,
              stepIndex: entry.stepIndex,
            },
          ]
        : []
    })
  )

export const assertNoIllegalKernelTransitions = (
  result: SlateBrowserScenarioResult
) => {
  expect(getIllegalKernelTransitions(result)).toEqual([])
}

const matchesPartialObject = <T extends object>(
  actual: T,
  expected: Partial<T> | undefined
) =>
  !expected ||
  Object.entries(expected).every(
    ([key, value]) => actual[key as keyof T] === value
  )

export const matchesSlateBrowserKernelTrace = (
  entry: SlateBrowserKernelTraceEntry,
  expected: SlateBrowserKernelTraceExpectation
) => {
  if (
    expected.eventFamily !== undefined &&
    entry.eventFamily !== expected.eventFamily
  ) {
    return false
  }
  if (
    expected.commandKind !== undefined &&
    entry.command?.kind !== expected.commandKind
  ) {
    return false
  }
  if (
    expected.ownership !== undefined &&
    entry.ownership !== expected.ownership
  ) {
    return false
  }
  if (
    expected.selectionSource !== undefined &&
    entry.selectionSource !== expected.selectionSource
  ) {
    return false
  }
  if (
    expected.selectionChangeOrigin !== undefined &&
    entry.selectionChangeOrigin !== expected.selectionChangeOrigin
  ) {
    return false
  }
  if (expected.movement !== undefined) {
    if (expected.movement === null) {
      if (entry.movement !== null) {
        return false
      }
    } else if (
      entry.movement === null ||
      !matchesPartialObject(entry.movement, expected.movement)
    ) {
      return false
    }
  }
  if (
    expected.stateBefore !== undefined &&
    entry.stateBefore !== expected.stateBefore
  ) {
    return false
  }
  if (
    expected.stateAfter !== undefined &&
    entry.stateAfter !== expected.stateAfter
  ) {
    return false
  }
  if (
    expected.targetOwner !== undefined &&
    entry.targetOwner !== expected.targetOwner
  ) {
    return false
  }

  return (
    matchesPartialObject(entry.selectionPolicy, expected.selectionPolicy) &&
    matchesPartialObject(entry.repairPolicy, expected.repairPolicy) &&
    matchesPartialObject(entry.transition, expected.transition)
  )
}

export const findSlateBrowserKernelTraceEntry = (
  trace: readonly SlateBrowserKernelTraceEntry[],
  expected: SlateBrowserKernelTraceExpectation
) => trace.find((entry) => matchesSlateBrowserKernelTrace(entry, expected))

export const assertSlateBrowserKernelTraceEntry = (
  trace: readonly SlateBrowserKernelTraceEntry[],
  expected: SlateBrowserKernelTraceExpectation
) => {
  const entry = findSlateBrowserKernelTraceEntry(trace, expected)

  if (!entry) {
    throw new Error(
      `Missing kernel trace entry ${JSON.stringify(
        expected
      )} in ${JSON.stringify(trace)}`
    )
  }

  return entry
}

export const createScenarioReductionCandidates = (
  steps: readonly SlateBrowserScenarioStep[]
): SlateBrowserScenarioReductionCandidate[] => {
  const candidates: SlateBrowserScenarioReductionCandidate[] = []
  let warmRange: {
    end: number
    iteration: number
    start: number
    warmLoop: string
  } | null = null

  const addWarmRangeCandidate = () => {
    if (!warmRange) return
    if (warmRange.start === 0 && warmRange.end === steps.length) return

    candidates.push({
      kind: 'iteration',
      label: `${warmRange.warmLoop}:iteration:${warmRange.iteration}`,
      removedRange: { end: warmRange.end, start: warmRange.start },
      steps: [
        ...steps.slice(0, warmRange.start),
        ...steps.slice(warmRange.end),
      ],
    })
  }

  for (const [index, step] of steps.entries()) {
    if (!step.warmLoop || step.iteration === undefined) {
      addWarmRangeCandidate()
      warmRange = null
      continue
    }

    if (
      warmRange &&
      warmRange.warmLoop === step.warmLoop &&
      warmRange.iteration === step.iteration
    ) {
      warmRange.end = index + 1
      continue
    }

    addWarmRangeCandidate()
    warmRange = {
      end: index + 1,
      iteration: step.iteration,
      start: index,
      warmLoop: step.warmLoop,
    }
  }

  addWarmRangeCandidate()

  for (let length = steps.length - 1; length > 0; length -= 1) {
    candidates.push({
      kind: 'prefix',
      label: `prefix:${length}`,
      removedRange: { end: steps.length, start: length },
      steps: steps.slice(0, length),
    })
  }

  for (let start = 1; start < steps.length; start += 1) {
    candidates.push({
      kind: 'suffix',
      label: `suffix:${start}`,
      removedRange: { end: start, start: 0 },
      steps: steps.slice(start),
    })
  }

  for (let index = 0; index < steps.length; index += 1) {
    candidates.push({
      kind: 'single-step',
      label: `without:${index}`,
      removedRange: { end: index + 1, start: index },
      steps: [...steps.slice(0, index), ...steps.slice(index + 1)],
    })
  }

  return candidates.filter((candidate) => candidate.steps.length > 0)
}

const getScenarioStepLabel = (step: SlateBrowserScenarioStep, index: number) =>
  step.label ?? `${index}:${step.kind}`

const toReplayValue = (
  value: unknown
): { replayable: boolean; value: unknown } => {
  if (typeof value === 'function') {
    return { replayable: false, value: undefined }
  }

  if (value instanceof RegExp) {
    return {
      replayable: true,
      value: {
        flags: value.flags,
        source: value.source,
        type: 'RegExp',
      },
    }
  }

  if (Array.isArray(value)) {
    let replayable = true
    const arrayValue = value
      .map((entry) => {
        const result = toReplayValue(entry)
        replayable &&= result.replayable
        return result.value
      })
      .filter((entry) => entry !== undefined)

    return { replayable, value: arrayValue }
  }

  if (value && typeof value === 'object') {
    let replayable = true
    const objectValue = Object.fromEntries(
      Object.entries(value)
        .map(([key, entry]) => {
          const result = toReplayValue(entry)
          replayable &&= result.replayable
          return [key, result.value] as const
        })
        .filter(([, entry]) => entry !== undefined)
    )

    return { replayable, value: objectValue }
  }

  return { replayable: true, value }
}

export const serializeScenarioStepForReplay = (
  step: SlateBrowserScenarioStep,
  index: number
): SlateBrowserScenarioReplayStep => {
  const { value, replayable } = toReplayValue(step)
  const replayValue =
    value && typeof value === 'object' ? (value as Record<string, unknown>) : {}

  return {
    iteration: step.iteration,
    kind: step.kind,
    label: getScenarioStepLabel(step, index),
    replayable,
    value: replayValue,
    warmLoop: step.warmLoop,
  }
}

export const createScenarioReplay = (
  steps: readonly SlateBrowserScenarioStep[]
): SlateBrowserScenarioReplay => {
  const replaySteps = steps.map(serializeScenarioStepForReplay)

  return {
    replayable: replaySteps.every((step) => step.replayable),
    steps: replaySteps,
  }
}

export const summarizeScenarioReductionCandidate = ({
  kind,
  label,
  removedRange,
  steps,
}: SlateBrowserScenarioReductionCandidate): SlateBrowserScenarioReductionCandidateSummary => ({
  kind,
  label,
  removedRange,
  replay: createScenarioReplay(steps),
  stepLabels: steps.map(getScenarioStepLabel),
})

export const normalizeScenarioMetadata = (
  metadata: SlateBrowserScenarioMetadata = {}
): SlateBrowserNormalizedScenarioMetadata => ({
  capabilities: Array.from(new Set(metadata.capabilities ?? [])).sort(),
  claim: classifyScenarioTransportClaim(metadata),
  platform: metadata.platform ?? null,
  transport: metadata.transport ?? null,
})

export const classifyScenarioTransportClaim = ({
  platform,
  transport,
}: SlateBrowserScenarioMetadata): SlateBrowserTransportClaim => {
  if (!transport) {
    return platform === 'mobile' ? 'playwright-mobile-viewport' : 'unspecified'
  }

  const normalized = transport.toLowerCase()

  if (normalized.includes('synthetic-datatransfer')) {
    return 'synthetic-datatransfer'
  }

  if (platform === 'mobile') {
    if (normalized.includes('composition')) {
      return 'mobile-synthetic-composition'
    }

    if (normalized.includes('semantic') || normalized.includes('handle')) {
      return 'mobile-semantic-handle'
    }

    if (normalized.includes('keyboard')) {
      return 'playwright-mobile-keyboard'
    }

    return 'playwright-mobile-viewport'
  }

  if (normalized.includes('native-composition')) {
    return 'desktop-native-ime-composition'
  }

  if (normalized.includes('synthetic-composition')) {
    return 'synthetic-composition'
  }

  if (normalized.includes('clipboard')) {
    return 'desktop-native-clipboard'
  }

  if (normalized.includes('semantic') || normalized.includes('handle')) {
    return normalized.includes('keyboard') || normalized.includes('click')
      ? 'mixed-native-and-semantic'
      : 'desktop-semantic-handle'
  }

  if (normalized.includes('native') || normalized.includes('keyboard')) {
    return 'desktop-native-keyboard'
  }

  return 'unspecified'
}

const CLIPBOARD_LOCK_PATH = `${process.cwd()}/.slate-browser-clipboard.lock`
const SLATE_BROWSER_HANDLE_KEY = '__slateBrowserHandle'

type SurfaceTarget = Page | Frame

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })

const isIgnoredRuntimeError = (text: string) =>
  (text.includes('Fetch API cannot load http://localhost:3101/_next/data/') &&
    text.includes('due to access control checks.')) ||
  (text.includes("Permission policy 'Fullscreen' check failed") &&
    text.includes('https://player.vimeo.com'))

export const recordSlateBrowserRuntimeErrors = (
  page: Page,
  options: {
    patterns?: readonly string[]
  } = {}
): SlateBrowserRuntimeErrorRecorder => {
  const patterns = options.patterns ?? DEFAULT_RUNTIME_ERROR_PATTERNS
  const errors: string[] = []
  const onPageError = (error: Error) => {
    const text = error.stack ?? error.message

    if (!isIgnoredRuntimeError(text)) {
      errors.push(text)
    }
  }
  const onConsole = (message: ConsoleMessage) => {
    const text = message.text()

    if (isIgnoredRuntimeError(text)) {
      return
    }

    if (
      message.type() === 'error' &&
      patterns.some((pattern) => text.includes(pattern))
    ) {
      errors.push(text)
    }
  }

  page.on('pageerror', onPageError)
  page.on('console', onConsole)

  return {
    assertNone: () => expect(errors).toEqual([]),
    errors,
    stop: () => {
      page.off('pageerror', onPageError)
      page.off('console', onConsole)
    },
  }
}

const parseSyntheticShortcut = (shortcut: string) => {
  const parts = shortcut.split('+')
  const key = parts.at(-1)

  if (!key) {
    return null
  }

  const isMac = process.platform === 'darwin'
  const modifiers = new Set(parts.slice(0, -1))

  if (
    !modifiers.has('ControlOrMeta') &&
    !modifiers.has('Control') &&
    !modifiers.has('Meta') &&
    !modifiers.has('Alt') &&
    !modifiers.has('Shift')
  ) {
    return null
  }

  if (
    shortcut === 'ControlOrMeta+C' ||
    shortcut === 'ControlOrMeta+X' ||
    shortcut === 'ControlOrMeta+V' ||
    shortcut === 'ControlOrMeta+A'
  ) {
    return null
  }

  return {
    altKey: modifiers.has('Alt'),
    ctrlKey:
      modifiers.has('Control') || (!isMac && modifiers.has('ControlOrMeta')),
    key: key.length === 1 && !modifiers.has('Shift') ? key.toLowerCase() : key,
    metaKey: modifiers.has('Meta') || (isMac && modifiers.has('ControlOrMeta')),
    shiftKey: modifiers.has('Shift'),
    which: key.length === 1 ? key.toUpperCase().charCodeAt(0) : undefined,
  }
}

export const withExclusiveClipboardAccess = async <T>(
  work: () => Promise<T> | T
) => {
  let acquired = false

  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      writeFileSync(CLIPBOARD_LOCK_PATH, String(process.pid), {
        flag: 'wx',
      })
      acquired = true
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error
      }

      await sleep(50)
    }
  }

  if (!acquired) {
    throw new Error('Timed out waiting for exclusive clipboard access')
  }

  try {
    return await work()
  } finally {
    try {
      unlinkSync(CLIPBOARD_LOCK_PATH)
    } catch {
      // Ignore lock cleanup races on process shutdown.
    }
  }
}

const writeClipboardText = async (surface: SurfaceTarget, text: string) => {
  await surface.evaluate(async (value) => {
    await navigator.clipboard.writeText(value)
  }, text)
}

const writeClipboardHtml = async (
  surface: SurfaceTarget,
  html: string,
  text: string
) => {
  await surface.evaluate(
    async ({ html: nextHtml, text: nextText }) => {
      const item = new ClipboardItem({
        'text/html': new Blob([nextHtml], { type: 'text/html' }),
        'text/plain': new Blob([nextText], { type: 'text/plain' }),
      })

      await navigator.clipboard.write([item])
    },
    { html, text }
  )
}

const toPlainText = async (surface: SurfaceTarget, html: string) =>
  surface.evaluate((markup) => {
    const container = document.createElement('div')
    container.innerHTML = markup
    return container.textContent ?? ''
  }, html)

const getBlockTexts = async (root: Locator): Promise<string[]> =>
  root.evaluate((element: HTMLElement) =>
    Array.from(
      element.querySelectorAll(':scope > [data-slate-node="element"]')
    ).map((block) => (block.textContent ?? '').replace(/\uFEFF/g, ''))
  )

const includesPasteText = (candidate: string, text: string) => {
  const normalizeSpaced = (value: string) =>
    value
      .replace(/\uFEFF/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  const normalizeCompact = (value: string) =>
    value.replace(/\uFEFF/g, '').replace(/\s+/g, '')

  return (
    normalizeSpaced(candidate).includes(normalizeSpaced(text)) ||
    normalizeCompact(candidate).includes(normalizeCompact(text))
  )
}

const selectionsEqual = (
  left: SelectionSnapshot | null,
  right: SelectionSnapshot | null
) =>
  left === right ||
  (!!left &&
    !!right &&
    left.anchor.offset === right.anchor.offset &&
    left.focus.offset === right.focus.offset &&
    left.anchor.path.join(',') === right.anchor.path.join(',') &&
    left.focus.path.join(',') === right.focus.path.join(','))

const didPasteApplyText = async ({
  afterText,
  afterSelection,
  afterTrace,
  beforeSelectedText,
  beforeSelection,
  beforeTraceLength,
  beforeText,
  root,
  text,
}: {
  afterText: string
  afterSelection: SelectionSnapshot | null
  afterTrace: readonly SlateBrowserKernelTraceEntry[]
  beforeSelectedText: string
  beforeSelection: SelectionSnapshot | null
  beforeTraceLength: number
  beforeText: string
  root: Locator
  text: string
}) => {
  if (
    afterTrace
      .slice(beforeTraceLength)
      .some(
        (entry) =>
          entry.eventFamily === 'paste' && entry.command?.kind === 'insert-data'
      )
  ) {
    return true
  }

  if (afterText !== beforeText) {
    if (includesPasteText(afterText, text)) {
      return true
    }

    return includesPasteText((await getBlockTexts(root)).join('\n'), text)
  }

  return (
    hasExpandedSelection(beforeSelection) &&
    !selectionsEqual(beforeSelection, afterSelection) &&
    beforeSelectedText !== '' &&
    includesPasteText(beforeSelectedText, text)
  )
}

const getRenderedBlockDOMShapes = async (
  root: Locator
): Promise<RenderedBlockDOMShapeSnapshot[]> =>
  root.evaluate((element: HTMLElement) => {
    const normalizeText = (text: string) => text.replace(/\uFEFF/g, '')
    const countLineBoxes = (block: Element) => {
      const ownerDocument = block.ownerDocument
      const range = ownerDocument.createRange()

      range.selectNodeContents(block)

      const tops = new Set<number>()

      for (const rect of Array.from(range.getClientRects())) {
        if (rect.width === 0 && rect.height === 0) {
          continue
        }

        tops.add(Math.round(rect.top))
      }

      range.detach()

      return tops.size
    }

    return Array.from(
      element.querySelectorAll(':scope > [data-slate-node="element"]')
    ).map((block, index) => {
      const textContent = normalizeText(block.textContent ?? '')
      const innerText = normalizeText(
        block instanceof HTMLElement
          ? (block.innerText ?? block.textContent ?? '')
          : (block.textContent ?? '')
      )
      const zeroWidthNodes = Array.from(
        block.querySelectorAll('[data-slate-zero-width]')
      ).map((zeroWidth, zeroWidthIndex) => ({
        hasBr: !!zeroWidth.querySelector('br'),
        hasFEFF: zeroWidth.textContent?.includes('\uFEFF') ?? false,
        html: zeroWidth.innerHTML,
        index: zeroWidthIndex,
        kind: zeroWidth.getAttribute('data-slate-zero-width'),
        length: zeroWidth.getAttribute('data-slate-length'),
        textContent: zeroWidth.textContent ?? '',
      }))

      return {
        index,
        innerText,
        lineBoxCount: countLineBoxes(block),
        textContent,
        unexpectedZeroWidthBreaks: zeroWidthNodes.filter(
          (zeroWidth) => textContent !== '' && zeroWidth.hasBr
        ),
        zeroWidthNodes,
      }
    })
  })

const getRenderedBlockDOMShape = async (
  root: Locator,
  blockIndex: number
): Promise<RenderedBlockDOMShapeSnapshot> => {
  const shape = (await getRenderedBlockDOMShapes(root))[blockIndex]

  if (!shape) {
    throw new Error(`Missing rendered block DOM shape for index ${blockIndex}`)
  }

  return shape
}

const assertRenderedBlockText = async (
  root: Locator,
  blockIndex: number,
  text: string
) => {
  await expect
    .poll(
      async () => (await getRenderedBlockDOMShape(root, blockIndex)).textContent
    )
    .toBe(text)
}

const assertNoUnexpectedZeroWidthBreaks = async (
  root: Locator,
  blockIndex: number
) => {
  await expect
    .poll(
      async () =>
        (await getRenderedBlockDOMShape(root, blockIndex))
          .unexpectedZeroWidthBreaks
    )
    .toEqual([])
}

const assertRenderedDOMShape = async (
  root: Locator,
  expected: RenderedDOMShapeExpectation
) => {
  const blockIndex = expected.blockIndex ?? 0

  await expect
    .poll(() => getRenderedBlockDOMShape(root, blockIndex))
    .toEqual(
      expect.objectContaining({
        ...(expected.innerText == null
          ? {}
          : { innerText: expected.innerText }),
        ...(expected.textContent == null
          ? {}
          : { textContent: expected.textContent }),
      })
    )

  const shape = await getRenderedBlockDOMShape(root, blockIndex)

  if (expected.zeroWidthCount != null) {
    expect(shape.zeroWidthNodes).toHaveLength(expected.zeroWidthCount)
  }

  if (expected.zeroWidthBreakCount != null) {
    expect(shape.zeroWidthNodes.filter((node) => node.hasBr)).toHaveLength(
      expected.zeroWidthBreakCount
    )
  }

  if (expected.noUnexpectedZeroWidthBreaks) {
    await assertNoUnexpectedZeroWidthBreaks(root, blockIndex)
  }

  if (typeof expected.lineBoxCount === 'number') {
    expect(shape.lineBoxCount).toBe(expected.lineBoxCount)
  } else if (expected.lineBoxCount) {
    if (expected.lineBoxCount.min != null) {
      expect(shape.lineBoxCount).toBeGreaterThanOrEqual(
        expected.lineBoxCount.min
      )
    }

    if (expected.lineBoxCount.max != null) {
      expect(shape.lineBoxCount).toBeLessThanOrEqual(expected.lineBoxCount.max)
    }
  }

  if (expected.domSelectionTarget) {
    await expect
      .poll(() => takeDOMSelectionLocationSnapshotForRoot(root))
      .toMatchObject(expected.domSelectionTarget)
  }
}

const getSelectedText = async (root: Locator): Promise<string> =>
  root.evaluate((element: HTMLElement) => {
    const rootNode = element.getRootNode() as Document | ShadowRoot
    const selection =
      'getSelection' in rootNode
        ? rootNode.getSelection()
        : element.ownerDocument.getSelection()

    return (selection?.toString() ?? '').replace(/\uFEFF/g, '')
  })

const readClipboardText = async (surface: SurfaceTarget) =>
  surface.evaluate(async () => navigator.clipboard.readText())

const readClipboardHtml = async (surface: SurfaceTarget) =>
  surface.evaluate(async () => {
    const contents = await navigator.clipboard.read()

    for (const item of contents) {
      if (item.types.includes('text/html')) {
        const blob = await item.getType('text/html')
        return blob.text()
      }
    }

    return null
  })

const readClipboardTypes = async (surface: SurfaceTarget) =>
  surface.evaluate(async () => {
    const contents = await navigator.clipboard.read()
    const types = new Set<string>()

    for (const item of contents) {
      item.types.forEach((type) => {
        types.add(type)
      })
    }

    return Array.from(types)
  })

const copyPayloadThroughEvent = async (
  root: Locator
): Promise<ClipboardPayloadSnapshot> =>
  root.evaluate((element: HTMLElement) => {
    const data = new DataTransfer()
    const event = new ClipboardEvent('copy', {
      bubbles: true,
      cancelable: true,
      clipboardData: data,
    })

    element.dispatchEvent(event)

    return {
      html: data.getData('text/html') || null,
      text: data.getData('text/plain'),
      types: Array.from(data.types),
    }
  })

const pastePayloadThroughEvent = async (
  root: Locator,
  payload: { html?: string | null; text: string }
) =>
  root.evaluate(
    (
      element: HTMLElement,
      nextPayload: { html?: string | null; key: string; text: string }
    ) => {
      const beforeText = element.textContent
      const data = new DataTransfer()

      if (nextPayload.html) {
        data.setData('text/html', nextPayload.html)
      }
      data.setData('text/plain', nextPayload.text)

      const event = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
      })

      Object.defineProperty(event, 'clipboardData', {
        value: data,
      })

      element.dispatchEvent(event)

      if (element.textContent === beforeText) {
        const handle = (element as Record<string, any>)[nextPayload.key]

        if (!handle?.insertData) {
          throw new Error('This editor surface does not expose insertData')
        }

        handle.insertData({
          html: nextPayload.html ?? undefined,
          text: nextPayload.text,
        })
      }
    },
    { ...payload, key: SLATE_BROWSER_HANDLE_KEY }
  )

const insertDataThroughHandle = async (
  root: Locator,
  payload: { html?: string | null; text: string }
) =>
  root.evaluate(
    (
      element: HTMLElement,
      nextPayload: { html?: string | null; key: string; text: string }
    ) => {
      const handle = (element as Record<string, any>)[nextPayload.key]

      if (!handle?.insertData) {
        throw new Error('This editor surface does not expose insertData')
      }

      handle.insertData({
        html: nextPayload.html ?? undefined,
        text: nextPayload.text,
      })
    },
    { ...payload, key: SLATE_BROWSER_HANDLE_KEY }
  )

const insertTextThroughHandle = async (root: Locator, text: string) =>
  root.evaluate(
    (
      element: HTMLElement,
      { key, nextText }: { key: string; nextText: string }
    ) => {
      const handle = (element as Record<string, any>)[key]

      if (!handle?.insertText) {
        throw new Error('This editor surface does not expose insertText')
      }

      handle.insertText(nextText)
    },
    { key: SLATE_BROWSER_HANDLE_KEY, nextText: text }
  )

const dropHtml = async (
  surface: SurfaceTarget,
  root: Locator,
  html: string,
  plainText?: string
) => {
  const text = plainText ?? (await toPlainText(surface, html))

  await root.evaluate(
    (element: HTMLElement, payload: { html: string; text: string }) => {
      const rect = element.getBoundingClientRect()
      const data = new DataTransfer()

      data.setData('text/html', payload.html)
      data.setData('text/plain', payload.text)

      const event = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + Math.max(1, Math.min(8, rect.width / 2)),
        clientY: rect.top + Math.max(1, Math.min(8, rect.height / 2)),
        dataTransfer: data,
      })

      element.dispatchEvent(event)
    },
    { html, text }
  )
}

const normalizeHtml = async (
  root: Locator,
  markup: string,
  {
    ignoreClasses = false,
    ignoreInlineStyles = false,
    ignoreDir = false,
  }: HtmlNormalizationOptions = {}
): Promise<string> =>
  root.evaluate(
    (element: HTMLElement, { nextMarkup, options }) => {
      const container = element.ownerDocument.createElement('div')
      container.innerHTML = nextMarkup

      for (const element of Array.from(container.querySelectorAll('*'))) {
        if (options.ignoreClasses) {
          element.removeAttribute('class')
        }
        if (options.ignoreInlineStyles) {
          element.removeAttribute('style')
        }
        if (options.ignoreDir) {
          element.removeAttribute('dir')
        }
      }

      return container.innerHTML
    },
    {
      nextMarkup: markup,
      options: {
        ignoreClasses,
        ignoreInlineStyles,
        ignoreDir,
      },
    }
  )

const getEditable = (
  surface: SurfaceTarget,
  options: EditorSurfaceOptions = {}
) => {
  const scopeSelector = options.scope ?? (options.frame ? 'body' : undefined)
  const scope = scopeSelector ? surface.locator(scopeSelector) : surface

  return scope.getByRole('textbox').first()
}

const locateBlock = (root: Locator, path: number[]) => {
  if (path.length === 0) {
    throw new Error('Block path cannot be empty')
  }

  let locator = root
    .locator(':scope > [data-slate-node="element"]')
    .nth(path[0]!)

  for (const segment of path.slice(1)) {
    locator = locator
      .locator(':scope > [data-slate-node="element"]')
      .nth(segment)
  }

  return locator
}

const locateText = (root: Locator, path: number[]) => {
  if (path.length === 0) {
    throw new Error('Text path cannot be empty')
  }

  const textIndex = path.at(-1)!
  const parentPath = path.slice(0, -1)
  const parent = parentPath.length > 0 ? locateBlock(root, parentPath) : root

  return parent.locator('[data-slate-node="text"]').nth(textIndex)
}

const clickTextOffset = async (
  root: Locator,
  path: number[],
  offset: number,
  options: { clickCount?: number } = {}
) => {
  const point = await root.evaluate(
    (
      element: HTMLElement,
      target: {
        offset: number
        path: number[]
      }
    ) => {
      const textElements = Array.from(
        element.querySelectorAll('[data-slate-node="text"]')
      )
      const textElement =
        element.querySelector(
          `[data-slate-node="text"][data-slate-path="${target.path.join(',')}"]`
        ) ?? textElements[target.path.at(-1) ?? 0]
      const stringElement = textElement?.querySelector(
        '[data-slate-string], [data-slate-zero-width]'
      )
      const strings = Array.from(
        textElement?.querySelectorAll(
          '[data-slate-string], [data-slate-zero-width]'
        ) ?? []
      )
      ;(stringElement ?? textElement)?.scrollIntoView({
        block: 'center',
        inline: 'nearest',
      })

      let currentOffset = 0
      let targetNode: Node | null = null
      let targetOffset = 0

      for (const string of strings) {
        const textNode = Array.from(string.childNodes).find(
          (node) => node.nodeType === Node.TEXT_NODE
        )
        const lengthAttribute = string.getAttribute('data-slate-length')
        const length =
          lengthAttribute == null
            ? (textNode?.textContent?.length ?? string.textContent?.length ?? 0)
            : Number.parseInt(lengthAttribute, 10)
        const safeLength = Number.isFinite(length) ? length : 0
        const nextOffset = currentOffset + safeLength

        if (target.offset <= nextOffset) {
          targetNode = textNode ?? string
          targetOffset = string.hasAttribute('data-slate-zero-width')
            ? 1
            : Math.max(0, Math.min(target.offset - currentOffset, safeLength))
          break
        }

        currentOffset = nextOffset
      }

      if (!targetNode) {
        const lastString = strings.at(-1)
        const lastTextNode = Array.from(lastString?.childNodes ?? []).find(
          (node) => node.nodeType === Node.TEXT_NODE
        )

        targetNode = lastTextNode ?? lastString ?? null
        targetOffset = targetNode?.textContent?.length ?? 0
      }

      if (!targetNode) {
        throw new Error(`Missing DOM target for ${target.path.join('.')}`)
      }

      const range = element.ownerDocument.createRange()
      range.setStart(targetNode, targetOffset)
      range.collapse(true)

      const caretRect = range.getBoundingClientRect()
      const caretClientRect = Array.from(range.getClientRects())[0]
      let probeRect: DOMRect | null = null

      if (targetNode.nodeType === Node.TEXT_NODE) {
        const textLength = targetNode.textContent?.length ?? 0
        const probeRange = element.ownerDocument.createRange()
        const probeStart =
          targetOffset >= textLength
            ? Math.max(0, textLength - 1)
            : Math.max(0, targetOffset)
        const probeEnd = Math.min(textLength, probeStart + 1)

        if (probeEnd > probeStart) {
          probeRange.setStart(targetNode, probeStart)
          probeRange.setEnd(targetNode, probeEnd)
          probeRect = probeRange.getBoundingClientRect()
        }
      }

      const fallbackRect = (
        stringElement ?? textElement
      )?.getBoundingClientRect()
      const rect =
        caretClientRect ??
        (caretRect.height > 0 || caretRect.width > 0 ? caretRect : null) ??
        probeRect ??
        fallbackRect

      if (!rect) {
        throw new Error(
          `Cannot resolve click rect for ${target.path.join('.')}`
        )
      }

      const x =
        probeRect && targetNode.nodeType === Node.TEXT_NODE
          ? targetOffset >= (targetNode.textContent?.length ?? 0)
            ? probeRect.right -
              Math.min(Math.max(probeRect.width * 0.25, 1), probeRect.width / 2)
            : probeRect.left
          : rect.left + Math.min(Math.max(rect.width / 2, 1), 4)

      return {
        x,
        y: rect.top + rect.height / 2,
      }
    },
    { offset, path }
  )

  await root.page().mouse.click(point.x, point.y, {
    clickCount: options.clickCount,
  })
  await waitForSelectionSync(root)
}

const hasDOMSelectionInRoot = async (root: Locator) =>
  root.evaluate((element: HTMLElement) => {
    const rootNode = element.getRootNode() as Document | ShadowRoot
    const selection =
      'getSelection' in rootNode
        ? rootNode.getSelection()
        : element.ownerDocument.getSelection()

    if (!selection?.anchorNode || !selection.focusNode) {
      return false
    }

    return (
      element.contains(selection.anchorNode) &&
      element.contains(selection.focusNode)
    )
  })

const hasUsableKeyboardFocus = async (root: Locator) =>
  root.evaluate((element: HTMLElement) => {
    const rootNode = element.getRootNode() as Document | ShadowRoot
    const activeElement =
      'activeElement' in rootNode
        ? rootNode.activeElement
        : element.ownerDocument.activeElement

    if (activeElement === element) {
      return true
    }

    if (!activeElement || !element.contains(activeElement)) {
      return false
    }

    return (
      activeElement instanceof HTMLElement && activeElement.isContentEditable
    )
  })

const captureSelectionBookmark = async (
  root: Locator,
  options: SelectionCaptureOptions = {}
): Promise<SelectionBookmark> =>
  root.evaluate(
    (
      element: HTMLElement,
      { key, affinity }: { key: string; affinity: RangeRefAffinity | undefined }
    ) => {
      const handle = (element as Record<string, any>)[key]

      if (!handle) {
        throw new Error(
          'This editor surface does not expose a Slate browser handle'
        )
      }

      const selection = handle.getSelection()

      if (!selection) {
        throw new Error('Cannot capture a bookmark without an editor selection')
      }

      return {
        id: handle.createRangeRef(selection, affinity ?? 'inward'),
      }
    },
    {
      key: SLATE_BROWSER_HANDLE_KEY,
      affinity: options.affinity,
    }
  )

const resolveSelectionBookmark = async (
  root: Locator,
  bookmark: SelectionBookmark
): Promise<SelectionSnapshot | null> =>
  root.evaluate(
    (element: HTMLElement, { key, id }: { key: string; id: string }) => {
      const handle = (element as Record<string, any>)[key]

      if (!handle) {
        throw new Error(
          'This editor surface does not expose a Slate browser handle'
        )
      }

      return handle.resolveRangeRef(id)
    },
    {
      key: SLATE_BROWSER_HANDLE_KEY,
      id: bookmark.id,
    }
  )

const restoreSelectionBookmark = async (
  root: Locator,
  bookmark: SelectionBookmark
) => {
  await root.evaluate(
    (element: HTMLElement, { key, id }: { key: string; id: string }) => {
      const handle = (element as Record<string, any>)[key]

      if (!handle) {
        throw new Error(
          'This editor surface does not expose a Slate browser handle'
        )
      }

      const range = handle.resolveRangeRef(id)

      if (!range) {
        throw new Error('Cannot restore a cleared bookmark')
      }

      handle.selectRange(range)
    },
    {
      key: SLATE_BROWSER_HANDLE_KEY,
      id: bookmark.id,
    }
  )
}

const unrefSelectionBookmark = async (
  root: Locator,
  bookmark: SelectionBookmark
): Promise<SelectionSnapshot | null> =>
  root.evaluate(
    (element: HTMLElement, { key, id }: { key: string; id: string }) => {
      const handle = (element as Record<string, any>)[key]

      if (!handle) {
        throw new Error(
          'This editor surface does not expose a Slate browser handle'
        )
      }

      return handle.unrefRangeRef(id)
    },
    {
      key: SLATE_BROWSER_HANDLE_KEY,
      id: bookmark.id,
    }
  )

const waitForHandleSelection = async (
  root: Locator,
  expected: SelectionSnapshot
) => {
  await expect
    .poll(async () =>
      root.evaluate(
        (
          element: HTMLElement,
          { key, selection }: { key: string; selection: SelectionSnapshot }
        ) => {
          const handle = (element as Record<string, any>)[key]

          if (!handle) {
            return false
          }

          const current = handle.getSelection()

          if (!current) {
            return false
          }

          const samePath = (left: number[], right: number[]) =>
            left.length === right.length &&
            left.every((segment, index) => segment === right[index])

          return (
            samePath(current.anchor.path, selection.anchor.path) &&
            samePath(current.focus.path, selection.focus.path) &&
            current.anchor.offset === selection.anchor.offset &&
            current.focus.offset === selection.focus.offset
          )
        },
        {
          key: SLATE_BROWSER_HANDLE_KEY,
          selection: expected,
        }
      )
    )
    .toBe(true)
}

const matchesOffsetExpectation = (
  expected: OffsetExpectation,
  actual: number
): boolean => {
  if (Array.isArray(expected)) {
    return actual >= expected[0] && actual <= expected[1]
  }

  return actual === expected
}

const matchesSelectionExpectation = (
  actual: SelectionSnapshot | null,
  expected: SelectionSnapshotExpectation
): boolean => {
  if (!actual) {
    return false
  }

  const pathsEqual =
    actual.anchor.path.length === expected.anchor.path.length &&
    actual.focus.path.length === expected.focus.path.length &&
    actual.anchor.path.every(
      (segment, index) => segment === expected.anchor.path[index]
    ) &&
    actual.focus.path.every(
      (segment, index) => segment === expected.focus.path[index]
    )

  return (
    pathsEqual &&
    matchesOffsetExpectation(expected.anchor.offset, actual.anchor.offset) &&
    matchesOffsetExpectation(expected.focus.offset, actual.focus.offset)
  )
}

const matchesDOMSelectionExpectation = (
  actual: DOMSelectionSnapshot | null,
  expected: DOMSelectionSnapshotExpectation
): boolean => {
  if (!actual) {
    return false
  }

  return (
    actual.anchorNodeText === expected.anchorNodeText &&
    actual.focusNodeText === expected.focusNodeText &&
    matchesOffsetExpectation(expected.anchorOffset, actual.anchorOffset) &&
    matchesOffsetExpectation(expected.focusOffset, actual.focusOffset)
  )
}

const assertSelectionExpectation = async (
  root: Locator,
  expected: SelectionSnapshotExpectation
) => {
  let actual: SelectionSnapshot | null = null

  try {
    await expect
      .poll(async () => {
        actual = await takeSelectionSnapshotForRoot(root)
        return matchesSelectionExpectation(actual, expected)
      })
      .toBe(true)
  } catch {
    throw new Error(
      `Expected Slate selection ${JSON.stringify(
        expected
      )} but received ${JSON.stringify(actual)}`
    )
  }
}

const assertDOMSelectionExpectation = async (
  root: Locator,
  expected: DOMSelectionSnapshotExpectation
) => {
  let actual: DOMSelectionSnapshot | null = null

  try {
    await expect
      .poll(async () => {
        actual = await takeDOMSelectionSnapshotForRoot(root)
        return matchesDOMSelectionExpectation(actual, expected)
      })
      .toBe(true)
  } catch {
    throw new Error(
      `Expected DOM selection ${JSON.stringify(
        expected
      )} but received ${JSON.stringify(actual)}`
    )
  }
}

const assertDOMCaretExpectation = async (
  root: Locator,
  expected: { offset: number; text: string }
) => {
  await expect
    .poll(() =>
      root.evaluate((element: HTMLElement) => {
        const rootNode = element.getRootNode() as Document | ShadowRoot
        const selection =
          'getSelection' in rootNode
            ? rootNode.getSelection()
            : element.ownerDocument.getSelection()

        return {
          anchorOffset: selection?.anchorOffset ?? null,
          anchorText: selection?.anchorNode?.textContent ?? null,
          isCollapsed: selection?.isCollapsed ?? null,
          isTextNode: selection?.anchorNode?.nodeType === Node.TEXT_NODE,
        }
      })
    )
    .toEqual({
      anchorOffset: expected.offset,
      anchorText: expected.text,
      isCollapsed: true,
      isTextNode: true,
    })
}

export type SlateBrowserEditorHarness = {
  name: string
  page: Page
  root: Locator
  rootAt: (selector: string) => SlateBrowserEditorHarness
  get: {
    modelText: () => Promise<string>
    text: () => Promise<string>
    blockTexts: () => Promise<string[]>
    renderedDOMShape: () => Promise<RenderedBlockDOMShapeSnapshot[]>
    selectedText: () => Promise<string>
    html: () => Promise<string>
    selection: () => Promise<SelectionSnapshot | null>
    domSelection: () => Promise<DOMSelectionSnapshot | null>
    focusOwner: () => Promise<FocusOwnerSnapshot>
    kernelTrace: () => Promise<SlateBrowserKernelTraceEntry[]>
    lastCommit: () => Promise<unknown | null>
    placeholderShape: (selector?: string) => Promise<PlaceholderShape | null>
  }
  selection: {
    select: (selection: SelectionSnapshot) => Promise<void>
    selectDOM: (selection: SelectionSnapshot) => Promise<void>
    collapse: (point: SelectionPoint) => Promise<void>
    capture: (options?: SelectionCaptureOptions) => Promise<SelectionBookmark>
    bookmark: (options?: SelectionCaptureOptions) => Promise<SelectionBookmark>
    resolve: (bookmark: SelectionBookmark) => Promise<SelectionSnapshot | null>
    restore: (bookmark: SelectionBookmark) => Promise<void>
    unref: (bookmark: SelectionBookmark) => Promise<SelectionSnapshot | null>
    selectAll: () => Promise<void>
    get: () => Promise<SelectionSnapshot | null>
    dom: () => Promise<DOMSelectionSnapshot | null>
    location: () => Promise<DOMSelectionLocationSnapshot | null>
    importDOM: () => Promise<SelectionSnapshot | null>
    rect: () => Promise<SelectionRectSnapshot | null>
  }
  locator: {
    block: (path: number[]) => Locator
    text: (path: number[]) => Locator
  }
  ready: (options: ReadyOptions) => Promise<void>
  snapshot: () => Promise<EditorSnapshot>
  focus: () => Promise<void>
  click: () => Promise<void>
  type: (text: string) => Promise<void>
  press: (key: string) => Promise<void>
  insertText: (text: string) => Promise<void>
  insertBreak: () => Promise<void>
  deleteFragment: () => Promise<void>
  deleteBackward: () => Promise<void>
  deleteForward: () => Promise<void>
  undo: () => Promise<void>
  redo: () => Promise<void>
  selectAll: () => Promise<void>
  assert: {
    text: (text: RegExp | string) => Promise<void>
    blockTexts: (texts: string[]) => Promise<void>
    html: (expectedFragment: string) => Promise<void>
    htmlContains: (expectedFragment: string) => Promise<void>
    htmlEquals: (
      expectedHtml: string,
      options?: HtmlNormalizationOptions
    ) => Promise<void>
    focusOwner: (expected: FocusOwnerSnapshot['kind']) => Promise<void>
    kernelTrace: (expected: SlateBrowserKernelTraceExpectation) => Promise<void>
    selection: (expected: SelectionSnapshotExpectation) => Promise<void>
    domSelection: (expected: DOMSelectionSnapshotExpectation) => Promise<void>
    domCaret: (expected: { offset: number; text: string }) => Promise<void>
    domSelectionTarget: (
      expected: Partial<DOMSelectionLocationSnapshot>
    ) => Promise<void>
    noUnexpectedZeroWidthBreaks: (blockIndex?: number) => Promise<void>
    placeholderShape: (
      expected: PlaceholderShape,
      selector?: string
    ) => Promise<void>
    placeholderVisible: (visible?: boolean) => Promise<void>
    renderedBlockText: (blockIndex: number, text: string) => Promise<void>
    renderedDOMShape: (expected: RenderedDOMShapeExpectation) => Promise<void>
  }
  clipboard: {
    copy: () => Promise<void>
    copyEventPayload: () => Promise<ClipboardPayloadSnapshot>
    copyPayload: () => Promise<ClipboardPayloadSnapshot>
    readText: () => Promise<string>
    readHtml: () => Promise<string | null>
    pasteText: (text: string) => Promise<void>
    pasteHtml: (html: string, plainText?: string) => Promise<void>
    assert: {
      textContains: (expected: string) => Promise<void>
      htmlContains: (expected: string) => Promise<void>
      htmlEquals: (expected: string) => Promise<void>
      types: (expected: string[]) => Promise<void>
    }
  }
  ime: {
    enableKeyEvents: () => Promise<void>
    compose: (options: {
      text: string
      steps?: readonly string[]
      committedText?: string
      transport?: 'native' | 'synthetic'
    }) => Promise<void>
    composeDirect: (options: { text: string }) => Promise<void>
  }
  scenario: {
    run: (
      name: string,
      steps: readonly SlateBrowserScenarioStep[],
      options?: SlateBrowserScenarioRunOptions
    ) => Promise<SlateBrowserScenarioResult>
  }
  trace: {
    snapshot: (
      label: string,
      stepIndex?: number | null
    ) => Promise<SlateBrowserTraceEntry>
  }
  withExtension: <T>(extend: (editor: SlateBrowserEditorHarness) => T) => T
}

const getSelectionRect = async (
  root: Locator
): Promise<SelectionRectSnapshot | null> =>
  root.evaluate((element: HTMLElement) => {
    const rootNode = element.getRootNode() as Document | ShadowRoot
    const selection =
      'getSelection' in rootNode
        ? rootNode.getSelection()
        : element.ownerDocument.getSelection()

    if (!selection || selection.rangeCount === 0) {
      return null
    }

    if (
      !element.contains(selection.anchorNode) ||
      !element.contains(selection.focusNode)
    ) {
      return null
    }

    const rect = selection.getRangeAt(0).getBoundingClientRect()

    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    }
  })

const getFocusOwnerSnapshot = async (
  root: Locator
): Promise<FocusOwnerSnapshot> =>
  root.evaluate((element: HTMLElement) => {
    const rootNode = element.getRootNode() as Document | ShadowRoot
    const activeElement =
      'activeElement' in rootNode
        ? rootNode.activeElement
        : element.ownerDocument.activeElement

    if (!activeElement) {
      return {
        isContentEditable: false,
        kind: 'none',
        role: null,
        tagName: null,
        testId: null,
      }
    }

    const htmlActive =
      activeElement instanceof HTMLElement ? activeElement : null
    const isContentEditable = htmlActive?.isContentEditable ?? false
    const base = {
      isContentEditable,
      role: htmlActive?.getAttribute('role') ?? null,
      tagName: activeElement.tagName?.toLowerCase() ?? null,
      testId: htmlActive?.getAttribute('data-testid') ?? null,
    }

    if (activeElement === element) {
      return {
        ...base,
        kind: 'editor' as const,
      }
    }

    if (!element.contains(activeElement)) {
      return {
        ...base,
        kind: 'outside' as const,
      }
    }

    return {
      ...base,
      kind: isContentEditable
        ? ('contenteditable' as const)
        : ('internal-control' as const),
    }
  })

export const takeDOMSelectionSnapshot = async (
  page: Page
): Promise<DOMSelectionSnapshot | null> =>
  page.evaluate(() => {
    const selection = window.getSelection()

    if (!selection || selection.rangeCount === 0) {
      return null
    }

    return {
      anchorNodeText: selection.anchorNode?.textContent ?? null,
      anchorOffset: selection.anchorOffset,
      focusNodeText: selection.focusNode?.textContent ?? null,
      focusOffset: selection.focusOffset,
    }
  })

const takeDOMSelectionSnapshotForRoot = async (
  root: Locator
): Promise<DOMSelectionSnapshot | null> =>
  root.evaluate((element: HTMLElement) => {
    const rootNode = element.getRootNode() as Document | ShadowRoot
    const selection =
      'getSelection' in rootNode
        ? rootNode.getSelection()
        : element.ownerDocument.getSelection()

    if (!selection || selection.rangeCount === 0) {
      return null
    }

    if (
      !element.contains(selection.anchorNode) ||
      !element.contains(selection.focusNode)
    ) {
      return null
    }

    return {
      anchorNodeText: selection.anchorNode?.textContent ?? null,
      anchorOffset: selection.anchorOffset,
      focusNodeText: selection.focusNode?.textContent ?? null,
      focusOffset: selection.focusOffset,
    }
  })

const takeDOMSelectionLocationSnapshotForRoot = async (
  root: Locator
): Promise<DOMSelectionLocationSnapshot | null> =>
  root.evaluate((element: HTMLElement) => {
    const rootNode = element.getRootNode() as Document | ShadowRoot
    const selection =
      'getSelection' in rootNode
        ? rootNode.getSelection()
        : element.ownerDocument.getSelection()

    if (!selection?.anchorNode) {
      return null
    }

    const anchorNode = selection.anchorNode
    const anchorElement =
      anchorNode.nodeType === Node.TEXT_NODE
        ? anchorNode.parentElement
        : anchorNode instanceof HTMLElement
          ? anchorNode
          : null
    const textElement = anchorElement?.closest('[data-slate-node="text"]')
    const anchorPath = textElement
      ?.getAttribute('data-slate-path')
      ?.split(',')
      .filter(Boolean)
      .map(Number)

    return {
      anchorOffset: selection.anchorOffset ?? null,
      anchorPath: anchorPath ?? null,
      anchorText: anchorNode.textContent ?? null,
      isCollapsed: selection.isCollapsed ?? null,
    }
  })

export const takeSelectionSnapshot = async (
  page: Page
): Promise<SelectionSnapshot | null> =>
  page.evaluate(
    ({ key }) => {
      const root = document.querySelector('[data-slate-editor="true"]')
      const selection = window.getSelection()

      if (!root || !selection || selection.rangeCount === 0) {
        return null
      }

      const handle = (root as Record<string, any>)[key]

      if (handle?.getSelection) {
        return handle.getSelection()
      }

      const getTextSegments = (owner: Element) =>
        Array.from(
          owner.querySelectorAll('[data-slate-string], [data-slate-zero-width]')
        ).map((segment) => {
          const leafNode = segment.firstChild
          const domLength = leafNode?.textContent?.length ?? 0
          const attr = segment.getAttribute('data-slate-length')
          const trueLength =
            attr == null ? domLength : Number.parseInt(attr, 10)

          return {
            domLength,
            segment,
            trueLength,
          }
        })
      const findZeroWidthMarker = (node: Node | null) => {
        const element =
          node?.nodeType === 1 ? (node as Element) : node?.parentElement

        return element?.closest('[data-slate-zero-width]') ?? null
      }
      const toEditorOffset = (node: Node | null, offset: number) => {
        const owner =
          node?.nodeType === 1
            ? (node as Element).closest('[data-slate-node="text"]')
            : node?.parentElement?.closest('[data-slate-node="text"]')
        const segment =
          node?.nodeType === 1
            ? (node as Element).closest(
                '[data-slate-string], [data-slate-zero-width]'
              )
            : node?.parentElement?.closest(
                '[data-slate-string], [data-slate-zero-width]'
              )

        const localOffset = findZeroWidthMarker(node) ? 0 : offset

        if (!owner || !segment) {
          return localOffset
        }

        const segments = getTextSegments(owner)
        const segmentIndex = segments.findIndex(
          (entry) => entry.segment === segment
        )

        if (segmentIndex <= 0) {
          return localOffset
        }

        return (
          segments
            .slice(0, segmentIndex)
            .reduce((total, entry) => total + entry.trueLength, 0) + localOffset
        )
      }
      const getPath = (node: Node | null) => {
        const owner =
          node?.nodeType === 1
            ? (node as Element).closest('[data-slate-node="text"]')
            : node?.parentElement?.closest('[data-slate-node="text"]')

        if (!owner) {
          throw new Error('Cannot resolve selection to a Slate text node')
        }

        if (!root.contains(owner)) {
          throw new Error('Selection text node is outside the editor root')
        }

        const pathAttribute = owner.getAttribute('data-slate-path')

        if (!pathAttribute) {
          throw new Error('Cannot resolve selection to a Slate DOM path')
        }

        const path = pathAttribute
          .split(',')
          .map((part) => Number.parseInt(part, 10))

        if (path.some((part) => !Number.isInteger(part))) {
          throw new Error('Invalid Slate DOM path')
        }

        return path
      }

      return {
        anchor: {
          path: getPath(selection.anchorNode),
          offset: toEditorOffset(selection.anchorNode, selection.anchorOffset),
        },
        focus: {
          path: getPath(selection.focusNode),
          offset: toEditorOffset(selection.focusNode, selection.focusOffset),
        },
      }
    },
    { key: SLATE_BROWSER_HANDLE_KEY }
  )

const takeSelectionSnapshotForRoot = async (
  root: Locator
): Promise<SelectionSnapshot | null> =>
  root.evaluate(
    (element: HTMLElement, { key }: { key: string }) => {
      const handle = (element as Record<string, any>)[key]

      if (handle?.getSelection) {
        return handle.getSelection()
      }

      const rootNode = element.getRootNode() as Document | ShadowRoot
      const selection =
        'getSelection' in rootNode
          ? rootNode.getSelection()
          : element.ownerDocument.getSelection()

      if (!selection || selection.rangeCount === 0) {
        return null
      }

      if (
        !element.contains(selection.anchorNode) ||
        !element.contains(selection.focusNode)
      ) {
        return null
      }

      const getTextSegments = (owner: Element) =>
        Array.from(
          owner.querySelectorAll('[data-slate-string], [data-slate-zero-width]')
        ).map((segment) => {
          const leafNode = segment.firstChild
          const domLength = leafNode?.textContent?.length ?? 0
          const attr = segment.getAttribute('data-slate-length')
          const trueLength =
            attr == null ? domLength : Number.parseInt(attr, 10)

          return {
            domLength,
            segment,
            trueLength,
          }
        })

      const findZeroWidthMarker = (node: Node | null) => {
        const markerElement =
          node?.nodeType === 1 ? (node as Element) : node?.parentElement

        return markerElement?.closest('[data-slate-zero-width]') ?? null
      }

      const toEditorOffset = (node: Node | null, offset: number) => {
        const owner =
          node?.nodeType === 1
            ? (node as Element).closest('[data-slate-node="text"]')
            : node?.parentElement?.closest('[data-slate-node="text"]')
        const segment =
          node?.nodeType === 1
            ? (node as Element).closest(
                '[data-slate-string], [data-slate-zero-width]'
              )
            : node?.parentElement?.closest(
                '[data-slate-string], [data-slate-zero-width]'
              )

        const localOffset = findZeroWidthMarker(node) ? 0 : offset

        if (!owner || !segment) {
          return localOffset
        }

        const segments = getTextSegments(owner)
        const segmentIndex = segments.findIndex(
          (entry) => entry.segment === segment
        )

        if (segmentIndex <= 0) {
          return localOffset
        }

        return (
          segments
            .slice(0, segmentIndex)
            .reduce((total, entry) => total + entry.trueLength, 0) + localOffset
        )
      }

      const getPath = (node: Node | null) => {
        const owner =
          node?.nodeType === 1
            ? (node as Element).closest('[data-slate-node="text"]')
            : node?.parentElement?.closest('[data-slate-node="text"]')

        if (!owner) {
          throw new Error('Cannot resolve selection to a Slate text node')
        }

        if (!element.contains(owner)) {
          throw new Error('Selection text node is outside the editor root')
        }

        const pathAttribute = owner.getAttribute('data-slate-path')

        if (!pathAttribute) {
          throw new Error('Cannot resolve selection to a Slate DOM path')
        }

        const path = pathAttribute
          .split(',')
          .map((part) => Number.parseInt(part, 10))

        if (path.some((part) => !Number.isInteger(part))) {
          throw new Error('Invalid Slate DOM path')
        }

        return path
      }

      return {
        anchor: {
          path: getPath(selection.anchorNode),
          offset: toEditorOffset(selection.anchorNode, selection.anchorOffset),
        },
        focus: {
          path: getPath(selection.focusNode),
          offset: toEditorOffset(selection.focusNode, selection.focusOffset),
        },
      }
    },
    { key: SLATE_BROWSER_HANDLE_KEY }
  )

const waitForSelectionSync = async (root: Locator) => {
  await expect
    .poll(() =>
      root.evaluate((element: HTMLElement) => {
        const rootNode = element.getRootNode() as Document | ShadowRoot
        const selection =
          'getSelection' in rootNode
            ? rootNode.getSelection()
            : element.ownerDocument.getSelection()

        if (
          !selection ||
          selection.rangeCount === 0 ||
          !selection.anchorNode ||
          !selection.focusNode
        ) {
          return false
        }

        return (
          element.contains(selection.anchorNode) &&
          element.contains(selection.focusNode)
        )
      })
    )
    .toBe(true)
  await root.page().waitForTimeout(100)
}

const hasSelectionHandle = async (root: Locator) =>
  root
    .evaluate(
      (element: HTMLElement, { key }: { key: string }) =>
        !!(element as Record<string, any>)[key]?.selectRange,
      { key: SLATE_BROWSER_HANDLE_KEY }
    )
    .catch(() => false)

const waitForSelectionHandle = async (root: Locator, timeout = 2000) => {
  try {
    await root.waitFor()
    await expect.poll(() => hasSelectionHandle(root), { timeout }).toBe(true)
    return true
  } catch {
    return false
  }
}

const waitForSelectionRange = async (root: Locator) => {
  await expect
    .poll(() =>
      root.evaluate((element: HTMLElement) => {
        const rootNode = element.getRootNode() as Document | ShadowRoot
        const selection =
          'getSelection' in rootNode
            ? rootNode.getSelection()
            : element.ownerDocument.getSelection()

        return (selection?.rangeCount ?? 0) > 0
      })
    )
    .toBe(true)
  await root.page().waitForTimeout(100)
}

const waitForSelectionIfPresent = async (root: Locator) => {
  const hasSelection = await root.evaluate((element: HTMLElement) => {
    const rootNode = element.getRootNode() as Document | ShadowRoot
    const selection =
      'getSelection' in rootNode
        ? rootNode.getSelection()
        : element.ownerDocument.getSelection()

    if (
      !selection ||
      selection.rangeCount === 0 ||
      !selection.anchorNode ||
      !selection.focusNode
    ) {
      return false
    }

    return (
      element.contains(selection.anchorNode) &&
      element.contains(selection.focusNode)
    )
  })

  if (!hasSelection) {
    return
  }

  await waitForSelectionSync(root)
}

const setSelectionWithHandle = async (
  root: Locator,
  selection: SelectionSnapshot
) =>
  root.evaluate(
    (
      element: HTMLElement,
      { key, nextSelection }: { key: string; nextSelection: SelectionSnapshot }
    ) => {
      const handle = (element as Record<string, any>)[key]

      if (!handle?.selectRange) {
        return false
      }

      handle.selectRange(nextSelection)
      return true
    },
    {
      key: SLATE_BROWSER_HANDLE_KEY,
      nextSelection: selection,
    }
  )

const selectAllWithHandle = async (root: Locator) =>
  root.evaluate(
    (element: HTMLElement, { key }: { key: string }) => {
      const handle = (element as Record<string, any>)[key]

      if (!handle?.selectAll) {
        return false
      }

      handle.selectAll()
      return true
    },
    { key: SLATE_BROWSER_HANDLE_KEY }
  )

const setSelection = async (root: Locator, selection: SelectionSnapshot) => {
  await root.evaluate((element: HTMLElement, expected) => {
    const textNodes = Array.from(
      element.querySelectorAll('[data-slate-node="text"]')
    )

    const comparePoint = (
      left: SelectionPoint,
      right: SelectionPoint
    ): number => {
      const count = Math.max(left.path.length, right.path.length)

      for (let index = 0; index < count; index += 1) {
        const leftSegment = left.path[index] ?? -1
        const rightSegment = right.path[index] ?? -1

        if (leftSegment !== rightSegment) {
          return leftSegment - rightSegment
        }
      }

      return left.offset - right.offset
    }

    const getTextLeaf = (owner: Element) => {
      const walker = document.createTreeWalker(owner, NodeFilter.SHOW_TEXT)
      return walker.nextNode()
    }

    const resolvePoint = (point: SelectionPoint) => {
      if (point.path.length === 0) {
        throw new Error('Cannot resolve an empty Slate path')
      }

      const owner = textNodes[point.path[0]]

      if (!owner) {
        throw new Error(`Cannot resolve Slate path ${point.path.join('.')}`)
      }

      const zeroWidthOwner = owner.querySelector('[data-slate-zero-width]')

      if (zeroWidthOwner && point.offset === 0) {
        const textLeaf = getTextLeaf(owner)

        if (textLeaf && (textLeaf.textContent?.length ?? 0) <= 1) {
          return { node: textLeaf, offset: 1 }
        }
      }

      let remaining = point.offset
      const walker = document.createTreeWalker(owner, NodeFilter.SHOW_TEXT)
      let current = walker.nextNode()
      let lastTextNode: Node | null = null

      while (current) {
        lastTextNode = current
        const length = current.textContent?.length ?? 0

        if (remaining <= length) {
          return { node: current, offset: remaining }
        }

        remaining -= length
        current = walker.nextNode()
      }

      if (lastTextNode) {
        return {
          node: lastTextNode,
          offset: lastTextNode.textContent?.length ?? 0,
        }
      }

      return { node: owner, offset: owner.childNodes.length }
    }

    const anchor = resolvePoint(expected.anchor)
    const focus = resolvePoint(expected.focus)
    const rootNode = element.getRootNode() as Document | ShadowRoot
    const selection =
      'getSelection' in rootNode
        ? rootNode.getSelection()
        : element.ownerDocument.getSelection()

    if (!selection) {
      throw new Error('Cannot access window selection')
    }

    const isBackward = comparePoint(expected.anchor, expected.focus) > 0
    const isCollapsed = comparePoint(expected.anchor, expected.focus) === 0

    selection.removeAllRanges()

    if (isCollapsed) {
      selection.collapse(anchor.node, anchor.offset)
      return
    }

    if (isBackward && typeof selection.extend === 'function') {
      const range = element.ownerDocument.createRange()
      range.setStart(focus.node, focus.offset)
      range.setEnd(focus.node, focus.offset)
      selection.addRange(range)
      selection.extend(anchor.node, anchor.offset)
      return
    }

    const range = element.ownerDocument.createRange()
    range.setStart(anchor.node, anchor.offset)
    range.setEnd(focus.node, focus.offset)
    selection.addRange(range)
  }, selection)
}

const setDOMSelection = async (root: Locator, selection: SelectionSnapshot) => {
  await root.evaluate((element: HTMLElement, nextSelection) => {
    const selectionPointToDOMPoint = (point: SelectionPoint) => {
      const textElements = Array.from(
        element.querySelectorAll('[data-slate-node="text"]')
      )
      const textElement =
        element.querySelector(
          `[data-slate-node="text"][data-slate-path="${point.path.join(',')}"]`
        ) ?? textElements[point.path.at(-1) ?? 0]
      const stringElements = Array.from(
        textElement?.querySelectorAll(
          '[data-slate-string], [data-slate-zero-width]'
        ) ?? []
      )
      let start = 0
      let lastTextNode: Node | null = null
      let lastTextLength = 0

      for (const stringElement of stringElements) {
        const textNode =
          Array.from(stringElement.childNodes).find(
            (node) => node.nodeType === Node.TEXT_NODE
          ) ?? null

        if (!textNode) {
          continue
        }

        const length = textNode.textContent?.length ?? 0
        const attr = stringElement.getAttribute('data-slate-length')
        const trueLength = attr == null ? length : Number.parseInt(attr, 10)
        const end = start + trueLength

        lastTextNode = textNode
        lastTextLength = length

        if (point.offset <= end) {
          return {
            node: textNode,
            offset: Math.min(length, Math.max(0, point.offset - start)),
          }
        }

        start = end
      }

      if (lastTextNode) {
        return {
          node: lastTextNode,
          offset: lastTextLength,
        }
      }

      if (!textElement) {
        throw new Error(`Missing DOM text node for ${point.path.join('.')}`)
      }

      return {
        node: textElement,
        offset: textElement.childNodes.length,
      }
    }

    const anchor = selectionPointToDOMPoint(nextSelection.anchor)
    const focus = selectionPointToDOMPoint(nextSelection.focus)
    const range = element.ownerDocument.createRange()

    range.setStart(anchor.node, anchor.offset)
    range.setEnd(focus.node, focus.offset)

    const rootNode = element.getRootNode() as Document | ShadowRoot
    const domSelection =
      'getSelection' in rootNode
        ? rootNode.getSelection()
        : element.ownerDocument.getSelection()

    domSelection?.removeAllRanges()
    domSelection?.addRange(range)
    element.focus()
    element.ownerDocument.dispatchEvent(
      new Event('selectionchange', { bubbles: true })
    )

    if (rootNode instanceof ShadowRoot) {
      rootNode.dispatchEvent(new Event('selectionchange', { bubbles: true }))
    }
  }, selection)
}

const hasExpandedSelection = (selection: SelectionSnapshot | null) =>
  !!selection &&
  (selection.anchor.offset !== selection.focus.offset ||
    selection.anchor.path.join(',') !== selection.focus.path.join(','))

const assertNumberBudget = (
  actual: number,
  expected: { exact?: number; max?: number; min?: number } | number,
  label: string
) => {
  if (typeof expected === 'number') {
    expect(actual, label).toBe(expected)
    return
  }

  if (expected.exact !== undefined) {
    expect(actual, label).toBe(expected.exact)
  }
  if (expected.min !== undefined) {
    expect(actual, label).toBeGreaterThanOrEqual(expected.min)
  }
  if (expected.max !== undefined) {
    expect(actual, label).toBeLessThanOrEqual(expected.max)
  }
}

const dragTextSelection = async (
  page: Page,
  step: Extract<SlateBrowserScenarioStep, { kind: 'dragTextSelection' }>
) => {
  const locator = page.locator(step.selector).nth(step.index ?? 0)

  await locator.scrollIntoViewIfNeeded()

  const box = await locator.boundingBox()

  if (!box) {
    throw new Error(
      `Expected selectable text to have a bounding box: ${step.selector}`
    )
  }

  const startXOffset = step.startXOffset ?? 5
  const endXOffset = step.endXOffset ?? Math.min(box.width - 5, 260)
  const yOffset = step.yOffset ?? box.height / 2
  const y = box.y + yOffset

  await page.mouse.move(box.x + startXOffset, y)
  await page.mouse.down()
  await page.mouse.move(box.x + Math.min(box.width - 5, endXOffset), y, {
    steps: step.steps ?? 12,
  })
  await page.mouse.up()
}

const waitForReady = async (
  editor: SlateBrowserEditorHarness,
  surface: SurfaceTarget,
  { editor: editorState, placeholder, selector, text, selection }: ReadyOptions
) => {
  if (editorState === 'visible') {
    await expect(editor.root).toBeVisible({ timeout: READY_TIMEOUT_MS })
    await expect
      .poll(() => hasSelectionHandle(editor.root), {
        timeout: READY_TIMEOUT_MS,
      })
      .toBe(true)
  }

  if (placeholder) {
    await editor.assert.placeholderVisible(placeholder === 'visible')
  }

  if (selector) {
    await surface.locator(selector).first().waitFor({
      state: 'visible',
      timeout: READY_TIMEOUT_MS,
    })
  }

  if (text) {
    if (text instanceof RegExp) {
      await expect(editor.root).toContainText(text, {
        timeout: READY_TIMEOUT_MS,
      })
    } else {
      await editor.assert.text(text)
    }
  }

  if (selection === 'settled') {
    await waitForSelectionIfPresent(editor.root)
  } else if (selection) {
    await editor.assert.selection(selection)
  }
}

const resolveSurface = async (
  page: Page,
  options: EditorSurfaceOptions = {}
): Promise<SurfaceTarget> => {
  if (!options.frame) {
    return page
  }

  const iframe = page.locator(options.frame).first()
  await iframe.waitFor()
  const handle = await iframe.elementHandle()

  if (!handle) {
    throw new Error(
      `Cannot resolve iframe handle for selector ${options.frame}`
    )
  }

  const frame = await handle.contentFrame()

  if (!frame) {
    throw new Error(
      `Cannot resolve content frame for selector ${options.frame}`
    )
  }

  return frame
}

const createEditorHarness = (
  page: Page,
  name: string,
  surface: SurfaceTarget,
  surfaceOptions: EditorSurfaceOptions = {},
  explicitRoot?: Locator
): SlateBrowserEditorHarness => {
  const root = explicitRoot ?? getEditable(surface, surfaceOptions)

  const harness: SlateBrowserEditorHarness = {
    name,
    page,
    root,
    rootAt: (selector: string) =>
      createEditorHarness(
        page,
        name,
        surface,
        surfaceOptions,
        surface.locator(selector).first()
      ),
    get: {
      modelText: async () =>
        root.evaluate(
          (element: HTMLElement, { key }: { key: string }) => {
            const handle = (element as Record<string, any>)[key]

            if (!handle?.getText) {
              throw new Error('This editor surface does not expose getText')
            }

            return handle.getText()
          },
          { key: SLATE_BROWSER_HANDLE_KEY }
        ),
      text: async () => (await root.textContent()) ?? '',
      blockTexts: async () => getBlockTexts(root),
      renderedDOMShape: async () => getRenderedBlockDOMShapes(root),
      selectedText: async () => getSelectedText(root),
      html: async () => root.evaluate((el: HTMLElement) => el.innerHTML),
      selection: async () => takeSelectionSnapshotForRoot(root),
      domSelection: async () => takeDOMSelectionSnapshotForRoot(root),
      focusOwner: async () => getFocusOwnerSnapshot(root),
      kernelTrace: async () =>
        root.evaluate(
          (element: HTMLElement, { key }: { key: string }) => {
            const handle = (element as Record<string, any>)[key]

            return handle?.getKernelTrace ? handle.getKernelTrace() : []
          },
          { key: SLATE_BROWSER_HANDLE_KEY }
        ) as Promise<SlateBrowserKernelTraceEntry[]>,
      lastCommit: async () =>
        root.evaluate(
          (element: HTMLElement, { key }: { key: string }) => {
            const handle = (element as Record<string, any>)[key]

            return handle?.getLastCommit ? handle.getLastCommit() : null
          },
          { key: SLATE_BROWSER_HANDLE_KEY }
        ),
      placeholderShape: async (selector = '[data-slate-zero-width]') => {
        const count = await root.locator(selector).count()

        if (count === 0) {
          return null
        }

        return root
          .locator(selector)
          .first()
          .evaluate((element: Element) => ({
            hasBr: !!element.querySelector('br'),
            hasFEFF: element.textContent?.includes('\uFEFF') ?? false,
            kind: element.getAttribute('data-slate-zero-width'),
          }))
      },
    },
    selection: {
      select: async (selection: SelectionSnapshot) => {
        const selectedWithHandle =
          (await waitForSelectionHandle(root)) &&
          (await setSelectionWithHandle(root, selection))

        if (!selectedWithHandle) {
          await setSelection(root, selection)
          await root.evaluate((element: HTMLElement) => {
            const rootNode = element.getRootNode() as Document | ShadowRoot

            element.ownerDocument.dispatchEvent(
              new Event('selectionchange', { bubbles: true })
            )

            if (rootNode instanceof ShadowRoot) {
              rootNode.dispatchEvent(
                new Event('selectionchange', { bubbles: true })
              )
            }
          })
        }

        if (selectedWithHandle) {
          await waitForHandleSelection(root, selection)

          try {
            await setDOMSelection(root, selection)
            await root.evaluate((element: HTMLElement) => {
              const rootNode = element.getRootNode() as Document | ShadowRoot

              element.ownerDocument.dispatchEvent(
                new Event('selectionchange', { bubbles: true })
              )

              if (rootNode instanceof ShadowRoot) {
                rootNode.dispatchEvent(
                  new Event('selectionchange', { bubbles: true })
                )
              }
            })
          } catch {
            // Some semantic selections intentionally do not resolve to a DOM
            // range, for example shell-backed rendering-strategy rows.
          }

          await waitForSelectionIfPresent(root)
        } else {
          await waitForSelectionRange(root)
        }
        await harness.assert.selection(selection)
      },
      selectDOM: async (selection: SelectionSnapshot) => {
        await setDOMSelection(root, selection)
        await root.evaluate((element: HTMLElement) => {
          const rootNode = element.getRootNode() as Document | ShadowRoot

          element.ownerDocument.dispatchEvent(
            new Event('selectionchange', { bubbles: true })
          )

          if (rootNode instanceof ShadowRoot) {
            rootNode.dispatchEvent(
              new Event('selectionchange', { bubbles: true })
            )
          }
        })
        await waitForSelectionRange(root)
        if (await waitForSelectionHandle(root)) {
          await setSelectionWithHandle(root, selection)
          await waitForHandleSelection(root, selection)
        }
      },
      collapse: async (point: SelectionPoint) => {
        await harness.selection.select({
          anchor: point,
          focus: point,
        })
      },
      capture: async (options?: SelectionCaptureOptions) =>
        captureSelectionBookmark(root, options),
      bookmark: async (options?: SelectionCaptureOptions) =>
        captureSelectionBookmark(root, options),
      resolve: async (bookmark: SelectionBookmark) =>
        resolveSelectionBookmark(root, bookmark),
      restore: async (bookmark: SelectionBookmark) => {
        await restoreSelectionBookmark(root, bookmark)
        await waitForSelectionIfPresent(root)
      },
      unref: async (bookmark: SelectionBookmark) =>
        unrefSelectionBookmark(root, bookmark),
      selectAll: async () => {
        const selectedWithHandle =
          (await waitForSelectionHandle(root)) &&
          (await selectAllWithHandle(root))

        if (!selectedWithHandle) {
          await harness.focus()
          await page.keyboard.press('ControlOrMeta+A')
        }

        await waitForSelectionSync(root)
      },
      get: async () => takeSelectionSnapshotForRoot(root),
      dom: async () => takeDOMSelectionSnapshotForRoot(root),
      location: async () => takeDOMSelectionLocationSnapshotForRoot(root),
      importDOM: async () =>
        root.evaluate(
          (element: HTMLElement, { key }: { key: string }) => {
            const handle = (element as Record<string, any>)[key]

            if (!handle?.importDOMSelection) {
              throw new Error(
                'This editor surface does not expose importDOMSelection'
              )
            }

            return handle.importDOMSelection()
          },
          { key: SLATE_BROWSER_HANDLE_KEY }
        ),
      rect: async () => getSelectionRect(root),
    },
    locator: {
      block: (path: number[]) => locateBlock(root, path),
      text: (path: number[]) => locateText(root, path),
    },
    ready: async (options: ReadyOptions) => {
      await waitForReady(harness, surface, options)
    },
    snapshot: async () => ({
      text: await harness.get.text(),
      blockTexts: await harness.get.blockTexts(),
      renderedBlocks: await harness.get.renderedDOMShape(),
      selectedText: await harness.get.selectedText(),
      selection: await harness.get.selection(),
      domSelection: await harness.get.domSelection(),
      focusOwner: await harness.get.focusOwner(),
      kernelTrace: await harness.get.kernelTrace(),
      lastCommit: await harness.get.lastCommit(),
      placeholderShape: await harness.get.placeholderShape(),
    }),
    focus: async () => {
      const readHandleSelection = () =>
        root.evaluate(
          (element: HTMLElement, { key }: { key: string }) => {
            const handle = (element as Record<string, any>)[key]
            return handle?.getSelection ? handle.getSelection() : null
          },
          { key: SLATE_BROWSER_HANDLE_KEY }
        )

      const selectionBeforeFocus = await readHandleSelection()

      await root.evaluate((element: HTMLElement) => {
        element.focus()
      })
      await root.page().waitForTimeout(50)
      const selection = (await readHandleSelection()) ?? selectionBeforeFocus

      if (selection) {
        await harness.selection.select(selection)
        return
      }

      await waitForSelectionRange(root)
    },
    click: async () => {
      await root.click()
    },
    type: async (text: string) => {
      if (
        !(await hasDOMSelectionInRoot(root)) ||
        !(await hasUsableKeyboardFocus(root))
      ) {
        await harness.focus()
      }
      await page.keyboard.type(text)
    },
    press: async (key: string) => {
      if (
        !(await hasDOMSelectionInRoot(root)) ||
        !(await hasUsableKeyboardFocus(root))
      ) {
        await harness.focus()
      }

      const syntheticShortcut = parseSyntheticShortcut(key)

      if (syntheticShortcut) {
        await root.evaluate(
          (
            element: HTMLElement,
            eventInit: KeyboardEventInit & { which?: number }
          ) => {
            const createEvent = () =>
              new KeyboardEvent('keydown', {
                altKey: eventInit.altKey,
                bubbles: true,
                cancelable: true,
                ctrlKey: eventInit.ctrlKey,
                key: eventInit.key,
                metaKey: eventInit.metaKey,
                shiftKey: eventInit.shiftKey,
              })
            const defineKeyCode = (event: KeyboardEvent) => {
              if (eventInit.which == null) {
                return event
              }

              Object.defineProperty(event, 'keyCode', {
                value: eventInit.which,
              })
              Object.defineProperty(event, 'which', {
                value: eventInit.which,
              })

              return event
            }
            const keyDown = defineKeyCode(createEvent())
            const keyUp = defineKeyCode(
              new KeyboardEvent('keyup', {
                altKey: eventInit.altKey,
                bubbles: true,
                cancelable: true,
                ctrlKey: eventInit.ctrlKey,
                key: eventInit.key,
                metaKey: eventInit.metaKey,
                shiftKey: eventInit.shiftKey,
              })
            )
            element.dispatchEvent(keyDown)
            element.dispatchEvent(keyUp)
          },
          syntheticShortcut
        )
        await page.waitForTimeout(0)
        return
      }

      await page.keyboard.press(key)
    },
    insertText: async (text: string) => {
      await root.evaluate(
        (
          element: HTMLElement,
          { key, nextText }: { key: string; nextText: string }
        ) => {
          const handle = (element as Record<string, any>)[key]

          if (!handle?.insertText) {
            throw new Error('This editor surface does not expose insertText')
          }

          handle.insertText(nextText)
        },
        { key: SLATE_BROWSER_HANDLE_KEY, nextText: text }
      )
    },
    insertBreak: async () => {
      await root.evaluate(
        (element: HTMLElement, { key }: { key: string }) => {
          const handle = (element as Record<string, any>)[key]

          if (!handle?.insertBreak) {
            throw new Error('This editor surface does not expose insertBreak')
          }

          handle.insertBreak()
        },
        { key: SLATE_BROWSER_HANDLE_KEY }
      )
    },
    deleteFragment: async () => {
      await root.evaluate(
        (element: HTMLElement, { key }: { key: string }) => {
          const handle = (element as Record<string, any>)[key]

          if (!handle?.deleteFragment) {
            throw new Error(
              'This editor surface does not expose deleteFragment'
            )
          }

          handle.deleteFragment()
        },
        { key: SLATE_BROWSER_HANDLE_KEY }
      )
    },
    deleteBackward: async () => {
      await root.evaluate(
        (element: HTMLElement, { key }: { key: string }) => {
          const handle = (element as Record<string, any>)[key]

          if (!handle?.deleteBackward) {
            throw new Error(
              'This editor surface does not expose deleteBackward'
            )
          }

          handle.deleteBackward()
        },
        { key: SLATE_BROWSER_HANDLE_KEY }
      )
    },
    deleteForward: async () => {
      await root.evaluate(
        (element: HTMLElement, { key }: { key: string }) => {
          const handle = (element as Record<string, any>)[key]

          if (!handle?.deleteForward) {
            throw new Error('This editor surface does not expose deleteForward')
          }

          handle.deleteForward()
        },
        { key: SLATE_BROWSER_HANDLE_KEY }
      )
    },
    undo: async () => {
      await root.evaluate(
        (element: HTMLElement, { key }: { key: string }) => {
          const handle = (element as Record<string, any>)[key]

          if (!handle?.undo) {
            throw new Error('This editor surface does not expose undo')
          }

          handle.undo()
        },
        { key: SLATE_BROWSER_HANDLE_KEY }
      )
    },
    redo: async () => {
      await root.evaluate(
        (element: HTMLElement, { key }: { key: string }) => {
          const handle = (element as Record<string, any>)[key]

          if (!handle?.redo) {
            throw new Error('This editor surface does not expose redo')
          }

          handle.redo()
        },
        { key: SLATE_BROWSER_HANDLE_KEY }
      )
    },
    selectAll: async () => {
      await harness.selection.selectAll()
    },
    assert: {
      text: async (text: RegExp | string) => {
        await expect(root).toContainText(text)
      },
      blockTexts: async (texts: string[]) => {
        await expect.poll(() => getBlockTexts(root)).toEqual(texts)
      },
      html: async (expectedFragment: string) => {
        await harness.assert.htmlContains(expectedFragment)
      },
      htmlContains: async (expectedFragment: string) => {
        await expect
          .poll(() => root.evaluate((el: HTMLElement) => el.innerHTML))
          .toContain(expectedFragment)
      },
      htmlEquals: async (
        expectedHtml: string,
        options: HtmlNormalizationOptions = {}
      ) => {
        await expect
          .poll(async () => {
            const actual = await root.evaluate(
              (el: HTMLElement) => el.innerHTML
            )

            return {
              actual: await normalizeHtml(root, actual, options),
              expected: await normalizeHtml(root, expectedHtml, options),
            }
          })
          .toEqual({
            actual: await normalizeHtml(root, expectedHtml, options),
            expected: await normalizeHtml(root, expectedHtml, options),
          })
      },
      focusOwner: async (expected: FocusOwnerSnapshot['kind']) => {
        await expect
          .poll(async () => (await getFocusOwnerSnapshot(root)).kind)
          .toBe(expected)
      },
      kernelTrace: async (expected: SlateBrowserKernelTraceExpectation) => {
        await expect
          .poll(async () =>
            Boolean(
              findSlateBrowserKernelTraceEntry(
                await harness.get.kernelTrace(),
                expected
              )
            )
          )
          .toBe(true)
      },
      selection: async (expected: SelectionSnapshotExpectation) => {
        await assertSelectionExpectation(root, expected)
      },
      domSelection: async (expected: DOMSelectionSnapshotExpectation) => {
        await assertDOMSelectionExpectation(root, expected)
      },
      domCaret: async (expected: { offset: number; text: string }) => {
        await assertDOMCaretExpectation(root, expected)
      },
      domSelectionTarget: async (
        expected: Partial<DOMSelectionLocationSnapshot>
      ) => {
        await expect
          .poll(() => takeDOMSelectionLocationSnapshotForRoot(root))
          .toMatchObject(expected)
      },
      noUnexpectedZeroWidthBreaks: async (blockIndex = 0) => {
        await assertNoUnexpectedZeroWidthBreaks(root, blockIndex)
      },
      placeholderShape: async (
        expected: PlaceholderShape,
        selector = '[data-slate-zero-width]'
      ) => {
        await expect
          .poll(() =>
            root
              .locator(selector)
              .first()
              .evaluate((element: Element) => ({
                hasBr: !!element.querySelector('br'),
                hasFEFF: element.textContent?.includes('\uFEFF') ?? false,
                kind: element.getAttribute('data-slate-zero-width'),
              }))
          )
          .toEqual(expected)
      },
      placeholderVisible: async (visible = true) => {
        const placeholder = root.locator('[data-slate-placeholder="true"]')

        if (visible) {
          await expect(placeholder).toBeVisible()
          return
        }

        await expect(placeholder).toHaveCount(0)
      },
      renderedBlockText: async (blockIndex: number, text: string) => {
        await assertRenderedBlockText(root, blockIndex, text)
      },
      renderedDOMShape: async (expected: RenderedDOMShapeExpectation) => {
        await assertRenderedDOMShape(root, expected)
      },
    },
    clipboard: {
      copy: async () => {
        await withExclusiveClipboardAccess(async () => {
          await harness.selection.selectAll()
          await root.press('ControlOrMeta+C')
        })
      },
      readText: async () =>
        withExclusiveClipboardAccess(async () => readClipboardText(surface)),
      readHtml: async () =>
        withExclusiveClipboardAccess(async () => readClipboardHtml(surface)),
      copyEventPayload: async () => copyPayloadThroughEvent(root),
      copyPayload: async () =>
        withExclusiveClipboardAccess(async () => {
          await root.press('ControlOrMeta+C')

          let html: string | null = null
          let text = ''
          let types: string[] = []

          for (let attempt = 0; attempt < 5; attempt++) {
            const payload = await Promise.all([
              readClipboardHtml(surface),
              readClipboardText(surface),
              readClipboardTypes(surface),
            ])
            html = payload[0]
            text = payload[1]
            types = payload[2]

            if (html || text || types.length > 0) {
              break
            }

            await new Promise((resolve) => setTimeout(resolve, 20))
          }

          if (!html && !text && types.length === 0) {
            throw new Error('Clipboard stayed empty after copy shortcut')
          }

          return {
            html,
            text,
            types,
          }
        }),
      pasteText: async (text: string) => {
        await withExclusiveClipboardAccess(async () => {
          const beforeSelectedText = await harness.get.selectedText()
          const beforeSelection = await harness.selection.get()
          const beforeText = await harness.get.modelText()
          const beforeTraceLength = (await harness.get.kernelTrace()).length

          try {
            await writeClipboardText(surface, text)
          } catch {
            await harness.focus()
            await insertDataThroughHandle(root, { text })
            return
          }

          await harness.focus()
          await root.press('ControlOrMeta+V')
          await page.waitForTimeout(50)

          const afterSelection = await harness.selection.get()
          const afterText = await harness.get.modelText()
          const afterTrace = await harness.get.kernelTrace()

          if (
            !(await didPasteApplyText({
              afterSelection,
              afterText,
              afterTrace,
              beforeSelectedText,
              beforeSelection,
              beforeTraceLength,
              beforeText,
              root,
              text,
            }))
          ) {
            await insertTextThroughHandle(root, text)
          }
        })
      },
      pasteHtml: async (html: string, plainText?: string) => {
        await withExclusiveClipboardAccess(async () => {
          const beforeSelectedText = await harness.get.selectedText()
          const beforeSelection = await harness.selection.get()
          const beforeText = await harness.get.modelText()
          const beforeTraceLength = (await harness.get.kernelTrace()).length
          const text = plainText ?? (await toPlainText(surface, html))

          try {
            await writeClipboardHtml(surface, html, text)
          } catch {
            await harness.focus()
            await insertDataThroughHandle(root, { html, text })
            return
          }

          await harness.focus()
          await root.press('ControlOrMeta+V')
          await page.waitForTimeout(50)

          const afterSelection = await harness.selection.get()
          const afterText = await harness.get.modelText()
          const afterTrace = await harness.get.kernelTrace()

          if (
            !(await didPasteApplyText({
              afterSelection,
              afterText,
              afterTrace,
              beforeSelectedText,
              beforeSelection,
              beforeTraceLength,
              beforeText,
              root,
              text,
            }))
          ) {
            await pastePayloadThroughEvent(root, { html, text })
          }
        })
      },
      assert: {
        textContains: async (expected: string) => {
          const payload = await harness.clipboard.copyPayload()
          expect(payload.text).toContain(expected)
        },
        htmlContains: async (expected: string) => {
          const payload = await harness.clipboard.copyPayload()
          expect(payload.html).toContain(expected)
        },
        htmlEquals: async (expected: string) => {
          const payload = await harness.clipboard.copyPayload()
          expect(payload.html).toBe(expected)
        },
        types: async (expected: string[]) => {
          const payload = await harness.clipboard.copyPayload()
          expect(payload.types).toEqual(expect.arrayContaining(expected))
        },
      },
    },
    ime: {
      enableKeyEvents: async () => {
        await enableCompositionKeyEvents(surface)
      },
      compose: async ({
        text,
        steps = [text],
        committedText = text,
        transport,
      }) => {
        await enableCompositionKeyEvents(surface)
        await composeText(page, surface, steps, committedText, { transport })
      },
      composeDirect: async ({ text }) => {
        await composeTextDirect(page, text)
      },
    },
    trace: {
      snapshot: async (label, stepIndex = null) => ({
        label,
        snapshot: await harness.snapshot(),
        stepIndex,
      }),
    },
    scenario: {
      run: async (scenarioName, steps, options = {}) => {
        const trace: SlateBrowserTraceEntry[] = []
        const capturedRuntimeIds = new Map<string, string>()
        const runtimeErrors =
          options.runtimeErrors === false
            ? null
            : recordSlateBrowserRuntimeErrors(page, options.runtimeErrors)

        try {
          for (const [stepIndex, step] of steps.entries()) {
            switch (step.kind) {
              case 'applyOperations':
                await root.evaluate(
                  (
                    element: HTMLElement,
                    {
                      key,
                      operations,
                      tag,
                    }: {
                      key: string
                      operations: readonly Record<string, unknown>[]
                      tag?: string | string[]
                    }
                  ) => {
                    const handle = (element as Record<string, any>)[key]

                    if (!handle?.applyOperations) {
                      throw new Error(
                        'This editor surface does not expose applyOperations'
                      )
                    }

                    handle.applyOperations(operations, { tag })
                  },
                  {
                    key: SLATE_BROWSER_HANDLE_KEY,
                    operations: step.operations,
                    tag: step.tag,
                  }
                )
                break
              case 'activateShell': {
                const shell = page.getByRole('button', {
                  name: step.buttonName,
                })

                await shell.focus()
                await expect(shell).toBeFocused()
                await shell.press('Enter')
                await expect(shell).toHaveCount(0)
                await expect
                  .poll(() =>
                    root.evaluate(
                      (element: HTMLElement, { key }: { key: string }) => {
                        const handle = (element as Record<string, any>)[key]

                        return handle?.getSelection
                          ? handle.getSelection()
                          : null
                      },
                      { key: SLATE_BROWSER_HANDLE_KEY }
                    )
                  )
                  .toEqual(step.expectedSelection)
                break
              }
              case 'assertLocatorCount': {
                const locator = page.locator(step.selector)

                if (step.count !== undefined) {
                  await expect(locator).toHaveCount(step.count)
                  break
                }

                await expect
                  .poll(async () => {
                    const count = await locator.count()

                    if (step.min !== undefined && count < step.min) {
                      return false
                    }
                    if (step.max !== undefined && count > step.max) {
                      return false
                    }

                    return true
                  })
                  .toBe(true)
                break
              }
              case 'assertLocatorCss': {
                const locator = page.locator(step.selector).nth(step.index ?? 0)

                if (step.value !== undefined) {
                  await expect(locator).toHaveCSS(step.property, step.value)
                }
                if (step.notValue !== undefined) {
                  await expect(locator).not.toHaveCSS(
                    step.property,
                    step.notValue
                  )
                }
                break
              }
              case 'assertLocatorVerticalGap': {
                const gap = await page
                  .locator(step.beforeSelector)
                  .first()
                  .evaluate(
                    (
                      before: Element,
                      {
                        afterSelector,
                      }: {
                        afterSelector: string
                      }
                    ) => {
                      const after = before.ownerDocument
                        .querySelector(afterSelector)
                        ?.getBoundingClientRect()

                      if (!after) {
                        throw new Error(
                          `Missing after element: ${afterSelector}`
                        )
                      }

                      return after.top - before.getBoundingClientRect().bottom
                    },
                    { afterSelector: step.afterSelector }
                  )

                assertNumberBudget(
                  gap,
                  { max: step.max, min: step.min },
                  'locator vertical gap'
                )
                break
              }
              case 'assertLocatorVerticalOffset': {
                const offset = await page
                  .locator(step.selector)
                  .first()
                  .evaluate(
                    (
                      element: Element,
                      {
                        innerSelector,
                      }: {
                        innerSelector: string
                      }
                    ) => {
                      const inner = element
                        .querySelector(innerSelector)
                        ?.getBoundingClientRect()

                      if (!inner) {
                        throw new Error(
                          `Missing inner element: ${innerSelector}`
                        )
                      }

                      return inner.top - element.getBoundingClientRect().top
                    },
                    { innerSelector: step.innerSelector }
                  )

                assertNumberBudget(
                  offset,
                  { max: step.max, min: step.min },
                  'locator vertical offset'
                )
                break
              }
              case 'assertModelSelectionExpanded':
                await expect
                  .poll(async () =>
                    hasExpandedSelection(await harness.selection.get())
                  )
                  .toBe(true)
                break
              case 'assertCapturedRuntimeIdPath': {
                const runtimeId = capturedRuntimeIds.get(step.name)

                if (!runtimeId) {
                  throw new Error(`No captured runtime id named "${step.name}"`)
                }

                await expect
                  .poll(() =>
                    root.evaluate(
                      (
                        element: HTMLElement,
                        { key, runtimeId }: { key: string; runtimeId: string }
                      ) => {
                        const handle = (element as Record<string, any>)[key]

                        if (!handle?.getPathByRuntimeId) {
                          throw new Error(
                            'This editor surface does not expose getPathByRuntimeId'
                          )
                        }

                        return handle.getPathByRuntimeId(runtimeId)
                      },
                      { key: SLATE_BROWSER_HANDLE_KEY, runtimeId }
                    )
                  )
                  .toEqual(step.path)
                break
              }
              case 'assertRenderBudget': {
                const snapshot = await getSlateReactRenderProfilerSnapshot(page)

                if (step.budget.total !== undefined) {
                  assertNumberBudget(
                    snapshot.total,
                    step.budget.total,
                    'render total'
                  )
                }

                for (const [kind, expected] of Object.entries(
                  step.budget.byKind ?? {}
                ) as [
                  SlateReactRenderKind,
                  { exact?: number; max?: number; min?: number } | number,
                ][]) {
                  assertNumberBudget(
                    snapshot.byKind[kind] ?? 0,
                    expected,
                    `render kind ${kind}`
                  )
                }
                break
              }
              case 'assertWindowSelectionText': {
                const text = await page.evaluate(
                  () => window.getSelection()?.toString() ?? ''
                )

                if (step.notEmpty) {
                  expect(text).not.toBe('')
                }
                if (step.text !== undefined) {
                  expect(text).toBe(step.text)
                }
                if (step.contains !== undefined) {
                  expect(text).toContain(step.contains)
                }
                break
              }
              case 'assertDOMCaret':
                await assertDOMCaretExpectation(root, step)
                break
              case 'assertBlockTexts':
                expect(
                  (await harness.get.blockTexts()).slice(step.startIndex ?? 0)
                ).toEqual(step.texts)
                break
              case 'assertRenderedDOMShape':
                await harness.assert.renderedDOMShape(step.shape)
                break
              case 'assertDOMSelection':
                await harness.assert.domSelection(step.selection)
                break
              case 'assertFocusOwner':
                await harness.assert.focusOwner(step.focusOwner)
                break
              case 'assertKernelTrace':
                await harness.assert.kernelTrace(step.trace)
                break
              case 'assertLastCommit':
                expect(await harness.get.lastCommit()).toBeTruthy()
                break
              case 'assertLastCommitTags': {
                const lastCommit = (await harness.get.lastCommit()) as {
                  tags?: readonly string[]
                } | null

                expect(lastCommit?.tags).toEqual(step.tags)
                break
              }
              case 'assertLastCommitCommand': {
                const lastCommit = (await harness.get.lastCommit()) as {
                  command?: { origin?: string; type?: string } | null
                } | null

                expect(lastCommit?.command).toEqual(step.command)
                break
              }
              case 'assertModelText':
                expect(await harness.get.modelText()).toContain(step.text)
                break
              case 'assertLocatorText': {
                const locator = page.locator(step.selector).first()

                if (step.text !== undefined) {
                  await expect(locator).toHaveText(step.text)
                }
                if (step.contains !== undefined) {
                  await expect(locator).toContainText(step.contains)
                }
                break
              }
              case 'assertSelection':
                await harness.assert.selection(step.selection)
                break
              case 'assertSelectionLocation':
                await expect
                  .poll(() => harness.selection.location())
                  .toMatchObject(step.location)
                break
              case 'assertSelectedText':
                expect(await harness.get.selectedText()).toBe(step.text)
                break
              case 'assertText':
                await harness.assert.text(step.text)
                break
              case 'clickTestId':
                await page.getByTestId(step.testId).click()
                break
              case 'clickSelector':
                await page.locator(step.selector).first().click()
                break
              case 'captureRuntimeId': {
                const runtimeId = await root.evaluate(
                  (
                    element: HTMLElement,
                    { key, path }: { key: string; path: number[] }
                  ) => {
                    const handle = (element as Record<string, any>)[key]

                    if (!handle?.getRuntimeId) {
                      throw new Error(
                        'This editor surface does not expose getRuntimeId'
                      )
                    }

                    return handle.getRuntimeId(path)
                  },
                  { key: SLATE_BROWSER_HANDLE_KEY, path: step.path }
                )

                if (!runtimeId) {
                  throw new Error(
                    `Could not capture runtime id for ${step.path.join('.')}`
                  )
                }

                capturedRuntimeIds.set(step.name, runtimeId)
                break
              }
              case 'composeText':
                await harness.ime.compose({
                  committedText: step.committedText,
                  steps: step.steps,
                  text: step.text,
                  transport: step.transport,
                })
                break
              case 'custom':
                await step.run(harness)
                break
              case 'deleteBackward':
                await harness.deleteBackward()
                break
              case 'deleteForward':
                await harness.deleteForward()
                break
              case 'dragTextSelection':
                await dragTextSelection(page, step)
                break
              case 'clickTextOffset':
                await clickTextOffset(root, step.path, step.offset)
                break
              case 'doubleClickTextOffset':
                await clickTextOffset(root, step.path, step.offset, {
                  clickCount: 2,
                })
                break
              case 'dropHtml':
                await dropHtml(surface, root, step.html, step.text)
                break
              case 'fillControl': {
                const control = page.locator(step.selector).first()

                await control.fill(step.value)
                await expect(control).toHaveValue(step.value)
                break
              }
              case 'focus':
                await harness.focus()
                break
              case 'insertText':
                await harness.insertText(step.text)
                break
              case 'pasteHtml':
                await harness.clipboard.pasteHtml(step.html, step.text)
                break
              case 'pasteText':
                await harness.clipboard.pasteText(step.text)
                break
              case 'press':
                await harness.press(step.key)
                break
              case 'rootClick':
                await harness.click()
                break
              case 'rootMouseDown':
                await root.dispatchEvent('mousedown')
                break
              case 'resetRenderProfiler':
                await resetSlateReactRenderProfiler(page)
                break
              case 'select':
                await harness.selection.select(step.selection)
                break
              case 'selectDOM':
                await harness.selection.selectDOM(step.selection)
                break
              case 'selectAll':
                await harness.selection.selectAll()
                break
              case 'settle':
                await page.waitForTimeout(0)
                await page.evaluate(
                  () =>
                    new Promise<void>((resolve) => {
                      requestAnimationFrame(() => resolve())
                    })
                )
                await page.waitForTimeout(step.timeoutMs ?? 25)
                break
              case 'snapshot':
                break
              case 'typeThenUndo': {
                await harness.type(step.text)
                await assertDOMCaretExpectation(root, step.caretAfterType)
                expect(await harness.get.modelText()).toContain(
                  step.expectedModelTextAfterType
                )

                const hotkey = await page.evaluate(() =>
                  navigator.userAgent.includes('Mac OS X')
                    ? 'Meta+Z'
                    : 'Control+Z'
                )

                await harness.press(hotkey)
                await assertDOMCaretExpectation(root, step.caretAfterUndo)
                expect(await harness.get.modelText()).toContain(
                  step.expectedModelTextAfterUndo
                )
                break
              }
              case 'type':
                await harness.type(step.text)
                break
              case 'undo': {
                if (step.expectedModelTextBefore) {
                  expect(await harness.get.modelText()).toContain(
                    step.expectedModelTextBefore
                  )
                }

                const hotkey = await page.evaluate(() =>
                  navigator.userAgent.includes('Mac OS X')
                    ? 'Meta+Z'
                    : 'Control+Z'
                )

                await harness.press(hotkey)
                break
              }
            }

            runtimeErrors?.assertNone()
            trace.push(
              await harness.trace.snapshot(step.label ?? step.kind, stepIndex)
            )
          }

          const result = {
            metadata: normalizeScenarioMetadata(options.metadata),
            name: scenarioName,
            replay: createScenarioReplay(steps),
            reductionCandidates: createScenarioReductionCandidates(steps).map(
              summarizeScenarioReductionCandidate
            ),
            trace,
          }

          if (options.tracePath) {
            mkdirSync(dirname(options.tracePath), { recursive: true })
            writeFileSync(options.tracePath, JSON.stringify(result, null, 2))
          }

          return result
        } finally {
          runtimeErrors?.stop()
        }
      },
    },
    withExtension: <T>(extend: (editor: SlateBrowserEditorHarness) => T) =>
      extend(harness),
  }

  return harness
}

export const createSlateBrowserEditorHarness = (
  page: Page,
  name: string,
  root: Locator,
  surface: SurfaceTarget = page
): SlateBrowserEditorHarness =>
  createEditorHarness(page, name, surface, {}, root)

const takeSelectionShellsSnapshot = async (
  root: Locator,
  selection: SelectionSnapshot | null
): Promise<SlateBrowserSelectionShellsSnapshot | null> => {
  if (!selection) {
    return null
  }

  return root.evaluate((element, currentSelection) => {
    const summarize = (
      target: Element | null
    ): SlateBrowserShellSummary | null =>
      target
        ? {
            isInline: target.getAttribute('data-slate-inline') === 'true',
            isVoid: target.getAttribute('data-slate-void') === 'true',
            kind: target.getAttribute('data-slate-node'),
            path: target.getAttribute('data-slate-path'),
            runtimeId: target.getAttribute('data-slate-runtime-id'),
            tagName: target.tagName.toLowerCase(),
          }
        : null
    const findPathNode = (path: number[]) => {
      const key = path.join(',')

      return (
        Array.from(element.querySelectorAll('[data-slate-path]')).find(
          (node) => node.getAttribute('data-slate-path') === key
        ) ?? null
      )
    }
    const rootNode = element.getRootNode() as Document | ShadowRoot
    const domSelection =
      'getSelection' in rootNode
        ? rootNode.getSelection()
        : element.ownerDocument.getSelection()
    const toElement = (node: Node | null) =>
      node instanceof Element ? node : node?.parentElement
    const summarizePoint = (
      point: SelectionPoint,
      name: 'anchor' | 'focus',
      domNode: Node | null
    ): SlateBrowserSelectedShellSnapshot => {
      const domElement = toElement(domNode)
      const domPathNode =
        domElement?.closest('[data-slate-path]') ??
        (domElement?.querySelector('[data-slate-path]') as Element | null) ??
        null
      const node = findPathNode(point.path) ?? domPathNode
      const elementShell = node?.closest('[data-slate-node="element"]') ?? null

      return {
        element: summarize(elementShell),
        node: summarize(node),
        offset: point.offset,
        path: point.path,
        point: name,
      }
    }
    const anchor = summarizePoint(
      currentSelection.anchor,
      'anchor',
      domSelection?.anchorNode ?? null
    )
    const focus = summarizePoint(
      currentSelection.focus,
      'focus',
      domSelection?.focusNode ?? null
    )
    const runtimeIds = Array.from(
      new Set(
        [
          anchor.node?.runtimeId,
          anchor.element?.runtimeId,
          focus.node?.runtimeId,
          focus.element?.runtimeId,
        ].filter((runtimeId): runtimeId is string => Boolean(runtimeId))
      )
    )

    return {
      anchor,
      focus,
      runtimeIds,
    }
  }, selection)
}

export const takeSlateBrowserRenderStateSnapshot = async (
  editor: SlateBrowserEditorHarness
): Promise<SlateBrowserRenderStateSnapshot> => {
  const snapshot = await editor.snapshot()

  return {
    ...snapshot,
    renderCounts: await getSlateReactRenderProfilerSnapshot(editor.page),
    selectionShells: await takeSelectionShellsSnapshot(
      editor.root,
      snapshot.selection
    ),
  }
}

export const openExample = async (
  page: Page,
  name: string,
  options: OpenExampleOptions = {}
) => openExampleWithOptions(page, name, options)

export const openExampleWithOptions = async (
  page: Page,
  name: string,
  { query, ready, surface }: OpenExampleOptions
) => {
  await page.goto(`${baseUrl}/examples/${name}${formatExampleQuery(query)}`)
  const resolvedSurface = await resolveSurface(page, surface)
  const editor = createEditorHarness(page, name, resolvedSurface, surface)

  const normalizedReady: ReadyOptions = ready ?? {
    editor: 'visible',
  }

  if (normalizedReady) {
    await editor.ready(normalizedReady)
  }

  return editor
}

const formatExampleQuery = (query: OpenExampleOptions['query']) => {
  if (!query) {
    return ''
  }

  if (typeof query === 'string') {
    return query.startsWith('?') ? query : `?${query}`
  }

  const params =
    query instanceof URLSearchParams ? query : new URLSearchParams()

  if (!(query instanceof URLSearchParams)) {
    for (const [key, value] of Object.entries(query)) {
      if (value == null) {
        continue
      }

      params.set(key, String(value))
    }
  }

  const serialized = params.toString()

  return serialized ? `?${serialized}` : ''
}
