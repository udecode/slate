import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import {
  type ConsoleMessage,
  expect,
  type Frame,
  type Locator,
  type Page,
  type TestInfo,
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
  commitSyntheticCompositionText,
  composeText,
  composeTextDirect,
  enableCompositionKeyEvents,
  startSyntheticComposition,
  updateSyntheticComposition,
} from './ime'

const baseUrl = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3101'
const READY_TIMEOUT_MS = 20_000
const EXAMPLE_FONT_ROUTES = new WeakSet<Page>()
const DEFAULT_RUNTIME_ERROR_PATTERNS = [
  'Unable to find the path for Slate node',
  'Cannot resolve a Slate node',
  'Cannot resolve a DOM point',
  'Cannot resolve a DOM range',
]
const JPEG_SCREENSHOT_EXTENSION_RE = /\.(?:jpe?g)$/i
const NATIVE_EVENT_TRACE_KEY = '__SLATE_BROWSER_NATIVE_EVENT_TRACE__'

/** Screenshot attachment options for Slate browser proof artifacts. */
/** Screenshot options accepted by Slate browser screenshot helpers. */
export type SlateBrowserPageScreenshotOptions = Omit<
  NonNullable<Parameters<Page['screenshot']>[0]>,
  'path'
>

const getScreenshotContentType = (
  name: string,
  options: SlateBrowserPageScreenshotOptions
) => {
  const type =
    options.type ?? (JPEG_SCREENSHOT_EXTENSION_RE.test(name) ? 'jpeg' : 'png')

  return type === 'jpeg' ? 'image/jpeg' : 'image/png'
}

/**
 * Capture a Playwright page screenshot into the current test output directory
 * and attach it to the test report.
 */
export const attachPageScreenshot = async (
  page: Page,
  testInfo: TestInfo,
  name: string,
  options: SlateBrowserPageScreenshotOptions = {}
) => {
  const path = testInfo.outputPath(name)
  const contentType = getScreenshotContentType(name, options)

  await page.screenshot({ ...options, path })
  await testInfo.attach(name, { contentType, path })

  return path
}

/**
 * Write a JSON proof artifact into the current test output directory and attach
 * that file to the test report.
 */
export const attachSlateBrowserJsonArtifact = async (
  testInfo: TestInfo,
  name: string,
  value: unknown
) => {
  const fileName = name.endsWith('.json') ? name : `${name}.json`
  const path = testInfo.outputPath(fileName)

  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
  await testInfo.attach(name, { contentType: 'application/json', path })

  return path
}

/**
 * Attach a focused editor selection screenshot to the current test report.
 */
export const attachSlateBrowserSelectionScreenshot = async (
  editor: SlateBrowserEditorHarness,
  testInfo: TestInfo,
  name: string,
  options: SlateBrowserPageScreenshotOptions = {}
) =>
  attachPageScreenshot(editor.page, testInfo, name, {
    fullPage: false,
    ...options,
  })

/** Runtime error recorder returned by `recordSlateBrowserRuntimeErrors`. */
/** Recorder returned by runtime-error capture helpers. */
export type SlateBrowserRuntimeErrorRecorder = {
  assertNone: () => void
  errors: string[]
  stop: () => void
}

/** Slate model selection snapshot captured from an editor surface. */
/** Model selection snapshot captured from the editor runtime. */
export type SelectionSnapshot = {
  anchor: { path: number[]; offset: number }
  focus: { path: number[]; offset: number }
}

/** Owner metadata for a raw view-selection snapshot. */
export type SlateBrowserRawViewSelectionOwner = {
  childRoot: string
  ownerPath: number[]
  ownerRoot: string
}

/** Point in a raw view-selection snapshot. */
export type SlateBrowserRawViewSelectionPoint = {
  owner?: SlateBrowserRawViewSelectionOwner
  point: { path: number[]; offset: number; root?: string }
}

/** Raw view-selection snapshot captured from Slate view state. */
export type SlateBrowserRawViewSelectionSnapshot = {
  anchor: SlateBrowserRawViewSelectionPoint
  focus: SlateBrowserRawViewSelectionPoint
  segments: { backward: boolean; [key: string]: unknown }
}

/** Browser DOM selection snapshot captured from the page. */
/** Browser-native DOM selection snapshot. */
export type DOMSelectionSnapshot = {
  anchorNodeText: string | null
  anchorOffset: number
  focusNodeText: string | null
  focusOffset: number
}

/** DOM selection endpoints with resolved node-location metadata. */
export type DOMSelectionLocationSnapshot = {
  anchorOffset: number | null
  anchorPath: number[] | null
  anchorText: string | null
  isCollapsed: boolean | null
}

/** Combined model and native-selection summary for one root. */
/** Combined model and native selection summary for proof assertions. */
export type SlateBrowserNativeSelectionSummary = {
  collapsed: boolean | null
  rangeCount: number
  selection: SelectionSnapshot | null
  textLength: number
}

/** Slate view-selection snapshot used by browser proof helpers. */
export type SlateBrowserViewSelectionSnapshot = {
  active: boolean
  anchor: SelectionPoint | null
  focus: SelectionPoint | null
  markerCount: number
  markerPaths: Array<string | null>
  markerRects: SelectionRectSnapshot[]
  selection: SelectionSnapshot | null
  textLength: number
}

/** Visible selection overlay snapshot for one root. */
/** Displayed selection snapshot for one root in the rendered document. */
export type SlateBrowserDisplayedSelectionSnapshot = {
  displayed: SelectionSnapshot | null
  doubleHighlighted: boolean
  hasVisibleEditorSelection: boolean
  hasVisibleSelection: boolean
  model: SelectionSnapshot | null
  native: SlateBrowserNativeSelectionSummary
  source: 'native' | 'none' | 'view'
  view: SlateBrowserViewSelectionSnapshot
}

/** Clipboard payload captured during a browser proof step. */
/** Clipboard payload snapshot captured during paste/copy proof. */
export type ClipboardPayloadSnapshot = {
  html: string | null
  slateFragment?: string | null
  text: string
  types: string[]
}

/** Geometry snapshot for a rendered selection or caret rect. */
/** Client-rect bounds for a visible selection segment. */
export type SelectionRectSnapshot = {
  x: number
  y: number
  width: number
  height: number
}

/** Native event categories recorded by the browser trace helper. */
export type SlateBrowserNativeEventTraceType =
  | 'beforeinput'
  | 'compositionend'
  | 'compositionstart'
  | 'compositionupdate'
  | 'input'
  | 'selectionchange'

/** DOM node summary captured in a native event trace. */
export type SlateBrowserNativeEventTraceNodeSnapshot = {
  nodeName: string | null
  parentNodeName: string | null
  parentPath: string | null
  parentSignature: string | null
  path: string | null
  text: string | null
}

/** Selection summary captured during a native event trace. */
export type SlateBrowserNativeEventTraceSelectionSnapshot = {
  anchor: SlateBrowserNativeEventTraceNodeSnapshot | null
  anchorOffset: number | null
  collapsed: boolean | null
  focus: SlateBrowserNativeEventTraceNodeSnapshot | null
  focusOffset: number | null
  rangeCount: number
  selectedText: string
}

/** Rectangle captured from native event target ranges. */
export type SlateBrowserNativeEventTraceRect = {
  height: number
  width: number
  x: number
  y: number
}

/** Target-range snapshot captured from a native input event. */
export type SlateBrowserNativeEventTraceTargetRangeSnapshot = {
  collapsed: boolean
  end: SlateBrowserNativeEventTraceNodeSnapshot
  endOffset: number
  rects: SlateBrowserNativeEventTraceRect[]
  start: SlateBrowserNativeEventTraceNodeSnapshot
  startOffset: number
}

/** Text-node snapshot captured before or after a native event. */
export type SlateBrowserNativeEventTraceTextNodeSnapshot = {
  id: string
  parentPath: string | null
  parentSignature: string
  text: string
}

/** Text-node before/after delta captured by native event tracing. */
export type SlateBrowserNativeEventTraceTextNodeDelta = {
  after: SlateBrowserNativeEventTraceTextNodeSnapshot | null
  before: SlateBrowserNativeEventTraceTextNodeSnapshot | null
  type: 'added' | 'deleted' | 'modified' | 'moved'
}

/** DOM delta captured around one native event. */
export type SlateBrowserNativeEventTraceDOMDelta = {
  textNodes: SlateBrowserNativeEventTraceTextNodeDelta[]
}

/** Suspicious native-event trace finding. */
export type SlateBrowserNativeEventTraceAnomaly = {
  detail: string
  type:
    | 'composition-mismatch'
    | 'data-content-mismatch'
    | 'inputtype-mismatch'
    | 'missing-beforeinput'
    | 'node-type-change'
    | 'parent-mismatch'
    | 'selection-jump'
    | 'sibling-created'
}

/** One recorded native browser event with selection and DOM evidence. */
export type SlateBrowserNativeEventTraceEntry = {
  data: string | null
  domDelta: SlateBrowserNativeEventTraceDOMDelta | null
  inputType: string | null
  isComposing: boolean | null
  selection: SlateBrowserNativeEventTraceSelectionSnapshot
  targetRanges: SlateBrowserNativeEventTraceTargetRangeSnapshot[]
  timestamp: number
  type: SlateBrowserNativeEventTraceType
}

/** Complete native event trace collected from a Slate browser root. */
/** Complete native event trace snapshot. */
export type SlateBrowserNativeEventTraceSnapshot = {
  anomalies: SlateBrowserNativeEventTraceAnomaly[]
  entries: SlateBrowserNativeEventTraceEntry[]
}

/** Options controlling which native events are traced. */
/** Options for installing a native event trace recorder in the page. */
export type SlateBrowserNativeEventTraceOptions = {
  events?: readonly SlateBrowserNativeEventTraceType[]
  maxEntries?: number
}

/** Snapshot of the element that owns browser focus. */
/** Focus ownership snapshot for editor and native controls. */
export type FocusOwnerSnapshot = {
  isContentEditable: boolean
  kind: 'contenteditable' | 'editor' | 'internal-control' | 'none' | 'outside'
  role: string | null
  tagName: string | null
  testId: string | null
}

/** Rendered zero-width node shape captured from the DOM. */
export type SlateBrowserZeroWidthNodeShape = {
  hasBr: boolean
  hasFEFF: boolean
  html: string
  index: number
  kind: string | null
  length: string | null
  textContent: string
}

/** Rendered block DOM shape used by structure assertions. */
export type RenderedBlockDOMShapeSnapshot = {
  index: number
  innerText: string
  lineBoxCount: number
  textContent: string
  unexpectedZeroWidthBreaks: SlateBrowserZeroWidthNodeShape[]
  zeroWidthNodes: SlateBrowserZeroWidthNodeShape[]
}

/** Expected rendered DOM shape for browser proof assertions. */
/** Expected rendered DOM shape for proof assertions. */
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

/** Render-profiler event categories emitted by Slate React. */
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

/** One Slate React render-profiler event. */
export type SlateReactRenderProfilerEvent = {
  kind: SlateReactRenderKind
  id?: string | null
  runtimeId?: string | null
}

/** Collected Slate React render profiler events and counters. */
/** Snapshot returned by the Slate React render profiler. */
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

/** Install the Slate React render profiler bridge in a Playwright page. */
export const installSlateReactRenderProfiler = async (page: Page) => {
  await page.addInitScript(installSlateReactRenderProfilerScript)
  await page.evaluate(installSlateReactRenderProfilerScript).catch(() => {})
}

/** Reset collected Slate React render profiler events in the page. */
export const resetSlateReactRenderProfiler = async (page: Page) => {
  await page.evaluate(() => {
    const target = window as Window & {
      __SLATE_REACT_RENDER_PROFILER_RESET__?: () => void
    }

    target.__SLATE_REACT_RENDER_PROFILER_RESET__?.()
  })
}

/** Read the current Slate React render profiler snapshot from the page. */
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

/** High-level kernel trace event family. */
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

/** Kernel state label captured in trace entries. */
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

/** Owner classification for the current browser editing target. */
export type SlateBrowserKernelTargetOwner =
  | 'app-owned'
  | 'editor'
  | 'internal-control'
  | 'outside-editor'
  | 'shell'
  | 'unknown'

/** Model/native ownership classification for a kernel event. */
export type SlateBrowserKernelOwnership =
  | 'app-owned'
  | 'deferred'
  | 'model-owned'
  | 'native-allowed'
  | 'native-denied'
  | 'no-op'

/** Source that produced the selection observed by the kernel trace. */
export type SlateBrowserKernelSelectionSource =
  | 'app-owned'
  | 'composition-owned'
  | 'dom-current'
  | 'internal-control'
  | 'model-owned'
  | 'shell-backed'
  | 'unknown'

/** Origin of a selection change captured by the kernel trace. */
export type SlateBrowserKernelSelectionChangeOrigin =
  | 'browser-handle'
  | 'native-user'
  | 'programmatic-export'
  | 'repair-induced'
  | 'unknown'

/** Editing command observed by the browser kernel trace. */
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

/** Ownership trace for keyboard or pointer movement through the editor. */
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

/** Selection policy attached to a kernel transition. */
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

/** Repair policy attached to a kernel transition. */
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

/** State transition recorded by the browser kernel trace. */
export type SlateBrowserKernelTransition = {
  allowed: boolean
  reason: string | null
}

/** Slate operation summary attached to a kernel trace frame. */
export type SlateBrowserKernelOperation = {
  type: string
  [key: string]: unknown
}

/** Repair request emitted while handling a kernel event frame. */
export type SlateBrowserKernelRepairRequest = {
  kind: string
  [key: string]: unknown
}

/** Native event frame and derived editor evidence. */
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

/** Kernel trace entry used by browser behavior assertions. */
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

/** Expected kernel trace properties for one assertion. */
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

/** Point shape reused from a model selection snapshot. */
export type SelectionPoint = SelectionSnapshot['anchor']
/** Affinity used when capturing or restoring selection bookmarks. */
export type RangeRefAffinity =
  | 'forward'
  | 'backward'
  | 'outward'
  | 'inward'
  | null

/** Serializable selection bookmark used by replay helpers. */
export type SelectionBookmark = {
  id: string
}

/** Options for capturing Slate and DOM selection snapshots. */
/** Options for capturing model and DOM selection snapshots. */
export type SelectionCaptureOptions = {
  affinity?: RangeRefAffinity
}

/** Options for resolving DOM paths in browser helpers. */
/** Options for resolving a DOM node from a Slate path. */
export type SlateBrowserDOMPathOptions = {
  align?: 'center' | 'end' | 'nearest' | 'start'
  timeoutMs?: number
}

/** Options for clicking a text range by Slate path. */
/** Options for clicking a text range resolved by Slate path. */
export type SlateBrowserTextPathRangeClickOptions =
  SlateBrowserDOMPathOptions & {
    endOffset: number
    xAffinity?: 'center' | 'end' | 'start'
    path: number[]
    startOffset: number
  }

/** Options for clicking text by visible offset. */
/** Options for clicking a text node at a character offset. */
export type SlateBrowserTextOffsetClickOptions = {
  clickCount?: number
  offset: number
  path: number[]
  waitForSelectionSync?: boolean
}

/** Options for dragging across a resolved text range. */
export type SlateBrowserDragTextRangeOptions = {
  direction?: 'backward' | 'forward'
  endAffinity?: 'after' | 'inside'
  endOffset: number
  endText?: string
  endTextNodeIndex?: number
  settleMs?: number
  startOffset: number
  steps?: number
  text: string
  textNodeIndex?: number
}

/** Options for double-click drag selection across text. */
export type SlateBrowserDoubleClickDragTextRangeOptions = {
  doubleClickOffset: number
  endOffset: number
  gestureDelayMs?: number
  steps?: number
  text: string
  textNodeIndex?: number
}

/** Exact or inclusive offset expectation for selection assertions. */
export type OffsetExpectation = number | readonly [number, number]

/** Expected Slate model selection shape. */
/** Expected model selection snapshot shape. */
export type SelectionSnapshotExpectation = {
  anchor: { path: number[]; offset: OffsetExpectation }
  focus: { path: number[]; offset: OffsetExpectation }
}

/** Expected browser DOM selection shape. */
/** Expected browser-native DOM selection snapshot shape. */
export type DOMSelectionSnapshotExpectation = {
  anchorNodeText: string | null
  anchorOffset: OffsetExpectation
  focusNodeText: string | null
  focusOffset: OffsetExpectation
}

/** Combined expectation for a collapsed model and DOM selection. */
/** Expected collapsed model and DOM selection agreement. */
export type CollapsedModelDOMSelectionExpectation = {
  offset: OffsetExpectation
  path: number[]
  text: string
}

/** Options for normalizing HTML before paste or clipboard assertions. */
export type HtmlNormalizationOptions = {
  ignoreClasses?: boolean
  ignoreInlineStyles?: boolean
  ignoreDir?: boolean
}

/** Options for waiting until an example route is ready. */
/** Options for waiting until a Slate example route is ready. */
export type ReadyOptions = {
  editor?: 'visible'
  placeholder?: 'visible' | 'hidden'
  selector?: string
  text?: RegExp | string
  selection?: 'settled' | SelectionSnapshot
}

/** Options for selecting an editor surface on a page. */
/** Options for locating an editor surface on an example route. */
export type EditorSurfaceOptions = {
  frame?: string
  scope?: string
}

/** Options for opening an example route in the browser harness. */
/** Options for opening and preparing a Slate example route. */
export type OpenExampleOptions = {
  query?:
    | Record<string, boolean | null | number | string | undefined>
    | URLSearchParams
    | string
  ready?: ReadyOptions
  surface?: EditorSurfaceOptions
}

/** Document, selection, and shell state captured from an editor. */
/** Serialized editor state captured from an example route. */
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

/** Summary of a rendered Slate shell node. */
export type SlateBrowserShellSummary = {
  isInline: boolean
  isVoid: boolean
  kind: string | null
  path: string | null
  runtimeId: string | null
  tagName: string | null
}

/** Snapshot of selected rendered shell nodes. */
export type SlateBrowserSelectedShellSnapshot = {
  element: SlateBrowserShellSummary | null
  node: SlateBrowserShellSummary | null
  offset: number
  path: number[]
  point: 'anchor' | 'focus'
}

/** Snapshot of rendered shell nodes related to selection. */
export type SlateBrowserSelectionShellsSnapshot = {
  anchor: SlateBrowserSelectedShellSnapshot
  focus: SlateBrowserSelectedShellSnapshot
  runtimeIds: string[]
}

/** Full render state snapshot including selected and selection shells. */
/** Editor snapshot with rendered shell and DOM shape evidence. */
export type SlateBrowserRenderStateSnapshot = EditorSnapshot & {
  renderCounts: SlateReactRenderProfilerSnapshot
  selectionShells: SlateBrowserSelectionShellsSnapshot | null
}

/** Browser-side trace entry emitted by scenario runners. */
export type SlateBrowserTraceEntry = {
  label: string
  snapshot: EditorSnapshot
  stepIndex: number | null
}

/** Caller-provided metadata for browser scenario execution. */
/** Scenario metadata supplied by a browser scenario step. */
export type SlateBrowserScenarioMetadata = {
  capabilities?: readonly string[]
  platform?: string
  transport?: string
}

/** Transport capability claim attached to a scenario step. */
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

/** Normalized scenario metadata after transport classification. */
export type SlateBrowserNormalizedScenarioMetadata = {
  capabilities: string[]
  claim: SlateBrowserTransportClaim
  platform: string | null
  transport: string | null
}

/** Metadata attached to one executable scenario step. */
export type SlateBrowserScenarioStepMetadata = {
  iteration?: number
  warmLoop?: string
}

/** Executable step in a browser scenario. */
/** Executable browser scenario step. */
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
      expectation: SlateBrowserSelectionContractExpectation
      kind: 'assertSelectionContract'
      label?: string
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
      selectedText?: string
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
  | {
      data?: string
      inputType?: string
      kind: 'mutateTextDOM'
      label?: string
      path: number[]
      selectionOffset?: number
      text: string
    }
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

/** Result returned after running a browser scenario. */
/** Result returned by a browser scenario run. */
export type SlateBrowserScenarioResult = {
  metadata: SlateBrowserNormalizedScenarioMetadata
  name: string
  replay: SlateBrowserScenarioReplay
  reductionCandidates: SlateBrowserScenarioReductionCandidateSummary[]
  trace: SlateBrowserTraceEntry[]
}

/** Options for running a browser scenario. */
/** Options for running a browser scenario step list. */
export type SlateBrowserScenarioRunOptions = {
  metadata?: SlateBrowserScenarioMetadata
  runtimeErrors?:
    | false
    | {
        patterns?: readonly string[]
      }
  tracePath?: string
}

/** Candidate reduced scenario produced from a failing run. */
/** Candidate produced while reducing a failing scenario. */
export type SlateBrowserScenarioReductionCandidate = {
  kind: 'iteration' | 'prefix' | 'single-step' | 'suffix'
  label: string
  removedRange: { end: number; start: number }
  removedSteps: readonly SlateBrowserScenarioStep[]
  steps: readonly SlateBrowserScenarioStep[]
}

/** Serializable summary of a scenario reduction candidate. */
/** Human-readable summary of a scenario reduction candidate. */
export type SlateBrowserScenarioReductionCandidateSummary = Omit<
  SlateBrowserScenarioReductionCandidate,
  'removedSteps' | 'steps'
> & {
  removedStepLabels: string[]
  removedStepSummaries: string[]
  replay: SlateBrowserScenarioReplay
  stepLabels: string[]
  stepSummaries: string[]
}

/** Serialized scenario step used for replay artifacts. */
export type SlateBrowserScenarioReplayStep = {
  iteration?: number
  kind: string
  label: string
  replayable: boolean
  summary: string
  value: Record<string, unknown>
  warmLoop?: string
}

/** Replay artifact for a browser scenario. */
/** Replay artifact for reproducing a browser scenario. */
export type SlateBrowserScenarioReplay = {
  replayable: boolean
  steps: SlateBrowserScenarioReplayStep[]
}

/** Options for the navigation-plus-typing gauntlet. */
/** Options for navigation-plus-typing gauntlet generation. */
export type SlateBrowserNavigationTypingGauntletOptions = {
  insertedText: string
  movedSelection: SelectionSnapshot
  startSelection: SelectionSnapshot
  textAfterInsert: string
}

/** Options for the clipboard paste gauntlet. */
/** Options for clipboard paste gauntlet generation. */
export type SlateBrowserClipboardPasteGauntletOptions = {
  html: string
  plainText?: string
  textAfterPaste: string
}

/** Options for drag/drop data gauntlet generation. */
export type SlateBrowserDropDataGauntletOptions = {
  html: string
  plainText?: string
  textAfterDrop: string
}

/** Options for inline cut-and-type gauntlet generation. */
export type SlateBrowserInlineCutTypingGauntletOptions = {
  domShape?: {
    afterCut?: RenderedDOMShapeExpectation
    afterTyping?: RenderedDOMShapeExpectation
  }
  replacementText: string
  selection: SelectionSnapshot
  textAfterTyping: string
}

/** Options for internal native-control gauntlet generation. */
export type SlateBrowserInternalControlGauntletOptions = {
  controlSelector: string
  controlValue: string
  followUpText: string
  outerSelection: SelectionSnapshot
  textAfterFollowUp: string
}

/** Options for composition/IME gauntlet generation. */
export type SlateBrowserCompositionGauntletOptions = {
  committedText?: string
  selection?: SelectionSnapshot
  steps?: readonly string[]
  text: string
  textAfterComposition: string
  transport?: 'native' | 'synthetic'
}

/** Options for text insertion gauntlet generation. */
export type SlateBrowserTextInsertionGauntletOptions = {
  insertedText: string
  textAfterInsert: string
}

/** Options for shell activation gauntlet generation. */
export type SlateBrowserShellActivationGauntletOptions = {
  buttonName: RegExp | string
  expectedSelection: SelectionSnapshotExpectation
}

/** Options for mark typing gauntlet generation. */
export type SlateBrowserMarkTypingGauntletOptions = {
  hotkey: string
  insertedText: string
  selection: SelectionSnapshot
  textAfterInsert: string
}

/** Options for mark-click typing gauntlet generation. */
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

/** Options for toolbar mark-click typing gauntlet generation. */
export type SlateBrowserToolbarMarkClickTypingGauntletOptions = Omit<
  SlateBrowserMarkClickTypingGauntletOptions,
  'hotkey'
> & {
  markButtonTestId: string
  selectionTransport?: 'dom' | 'model'
}

/** Options for repeating warm-up scenario steps. */
/** Options for warm-loop browser behavior packets. */
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

/** Options for warm toolbar-arrow gauntlet generation. */
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

/** Options for mixed editing conformance gauntlet generation. */
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

/** Options for destructive editing gauntlet generation. */
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

/** Options for semantic editing conformance gauntlet generation. */
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

/** Illegal kernel transition reported by kernel trace validation. */
export type SlateBrowserIllegalKernelTransition = {
  label: string
  reason: string | null
  stepIndex: number | null
}

/** Create a scenario that mixes navigation and typing through editor content. */
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

/** Create a scenario that validates clipboard paste behavior. */
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

/** Create a scenario that validates drag/drop data insertion behavior. */
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

/** Create a scenario that validates inline cut followed by typing. */
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

/** Create a scenario for editor behavior around internal native controls. */
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

/** Create a scenario that validates composition/IME input behavior. */
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

/** Create a scenario for plain text insertion behavior. */
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

/** Create a scenario for shell activation and editor focus ownership. */
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

/** Create a scenario that validates mark toggling followed by typing. */
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

/** Create a scenario that validates mark toolbar clicks followed by typing. */
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

/** Create a scenario that validates toolbar mark clicks and editor typing. */
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

/** Create repeated warm-up steps for a scenario packet. */
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

/** Create a warm toolbar and arrow-navigation scenario. */
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

/** Create a mixed editing conformance scenario across text and structure. */
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

/** Create a destructive editing conformance scenario. */
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

/** Create a semantic editing conformance scenario. */
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

/** Return kernel trace transitions that violate the expected policy. */
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

/** Assert that a kernel trace contains no illegal transitions. */
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

/** Return true when a kernel trace entry satisfies an expectation. */
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

/** Find the first kernel trace entry matching an expectation. */
export const findSlateBrowserKernelTraceEntry = (
  trace: readonly SlateBrowserKernelTraceEntry[],
  expected: SlateBrowserKernelTraceExpectation
) => trace.find((entry) => matchesSlateBrowserKernelTrace(entry, expected))

/** Assert that a kernel trace contains an expected entry. */
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

/** Create candidate reduced scenarios from a failing scenario result. */
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
      removedSteps: steps.slice(warmRange.start, warmRange.end),
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
      removedSteps: steps.slice(length),
      steps: steps.slice(0, length),
    })
  }

  for (let start = 1; start < steps.length; start += 1) {
    candidates.push({
      kind: 'suffix',
      label: `suffix:${start}`,
      removedRange: { end: start, start: 0 },
      removedSteps: steps.slice(0, start),
      steps: steps.slice(start),
    })
  }

  for (let index = 0; index < steps.length; index += 1) {
    candidates.push({
      kind: 'single-step',
      label: `without:${index}`,
      removedRange: { end: index + 1, start: index },
      removedSteps: steps.slice(index, index + 1),
      steps: [...steps.slice(0, index), ...steps.slice(index + 1)],
    })
  }

  return candidates.filter((candidate) => candidate.steps.length > 0)
}

const getScenarioStepLabel = (step: SlateBrowserScenarioStep, index: number) =>
  step.label ?? `${index}:${step.kind}`

const summarizeTextPayload = (text: string) => {
  const preview = text.length > 24 ? `${text.slice(0, 24)}...` : text

  return `"${preview}" len=${text.length}`
}

const summarizeSelectionOffset = (offset: OffsetExpectation) =>
  Array.isArray(offset) ? `${offset[0]}..${offset[1]}` : `${offset}`

const summarizeSelectionPoint = (point: {
  offset: OffsetExpectation
  path: readonly number[]
}) => `${point.path.join('.')}:${summarizeSelectionOffset(point.offset)}`

const summarizeSelectionPayload = (selection: SelectionSnapshotExpectation) =>
  `${summarizeSelectionPoint(selection.anchor)} -> ${summarizeSelectionPoint(
    selection.focus
  )}`

/** Summarize a scenario step for logs and reduction output. */
export const summarizeScenarioStep = (
  step: SlateBrowserScenarioStep,
  index: number
) => {
  const label = getScenarioStepLabel(step, index)

  switch (step.kind) {
    case 'assertSelection':
    case 'select':
    case 'selectDOM':
      return `${label}: ${step.kind} ${summarizeSelectionPayload(
        step.selection
      )}`
    case 'assertSelectionContract':
      return `${label}: assertSelectionContract`
    case 'assertSelectedText':
    case 'assertText':
    case 'insertText':
    case 'pasteText':
    case 'type':
      return `${label}: ${step.kind} ${summarizeTextPayload(step.text)}`
    case 'mutateTextDOM':
      return `${label}: mutateTextDOM ${step.path.join(
        '.'
      )} ${summarizeTextPayload(step.text)}`
    case 'composeText':
      return `${label}: composeText ${summarizeTextPayload(step.text)} via ${
        step.transport ?? 'default'
      }`
    case 'press':
      return `${label}: press ${step.key}`
    case 'clickSelector':
      return `${label}: clickSelector ${step.selector}`
    case 'clickTestId':
      return `${label}: clickTestId ${step.testId}`
    case 'clickTextOffset':
    case 'doubleClickTextOffset':
      return `${label}: ${step.kind} ${step.path.join('.')}:${step.offset}${
        step.kind === 'doubleClickTextOffset' && step.selectedText !== undefined
          ? ` selects ${summarizeTextPayload(step.selectedText)}`
          : ''
      }`
    case 'dragTextSelection':
      return `${label}: dragTextSelection ${step.selector}`
    case 'assertWindowSelectionText': {
      if (step.text !== undefined) {
        return `${label}: assertWindowSelectionText ${summarizeTextPayload(
          step.text
        )}`
      }
      if (step.contains !== undefined) {
        return `${label}: assertWindowSelectionText contains ${summarizeTextPayload(
          step.contains
        )}`
      }

      return `${label}: assertWindowSelectionText ${
        step.notEmpty ? 'not empty' : 'current'
      }`
    }
    case 'custom':
      return `${label}: custom non-replayable`
    default:
      return `${label}: ${step.kind}`
  }
}

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

/** Serialize a scenario step into a replayable description. */
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
    summary: summarizeScenarioStep(step, index),
    value: replayValue,
    warmLoop: step.warmLoop,
  }
}

/** Create a replay artifact from scenario metadata and steps. */
export const createScenarioReplay = (
  steps: readonly SlateBrowserScenarioStep[]
): SlateBrowserScenarioReplay => {
  const replaySteps = steps.map(serializeScenarioStepForReplay)

  return {
    replayable: replaySteps.every((step) => step.replayable),
    steps: replaySteps,
  }
}

/** Summarize a scenario reduction candidate for handoff output. */
export const summarizeScenarioReductionCandidate = ({
  kind,
  label,
  removedSteps,
  removedRange,
  steps,
}: SlateBrowserScenarioReductionCandidate): SlateBrowserScenarioReductionCandidateSummary => ({
  kind,
  label,
  removedStepLabels: removedSteps.map(getScenarioStepLabel),
  removedStepSummaries: removedSteps.map(summarizeScenarioStep),
  removedRange,
  replay: createScenarioReplay(steps),
  stepLabels: steps.map(getScenarioStepLabel),
  stepSummaries: steps.map(summarizeScenarioStep),
})

/** Normalize scenario metadata with defaults for transport and labels. */
export const normalizeScenarioMetadata = (
  metadata: SlateBrowserScenarioMetadata = {}
): SlateBrowserNormalizedScenarioMetadata => ({
  capabilities: Array.from(new Set(metadata.capabilities ?? [])).sort(),
  claim: classifyScenarioTransportClaim(metadata),
  platform: metadata.platform ?? null,
  transport: metadata.transport ?? null,
})

/** Classify the proof strength of a scenario transport claim. */
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

const NEXT_DATA_ACCESS_CONTROL_ERROR =
  /Fetch API cannot load http:\/\/(?:localhost|127\.0\.0\.1):\d+\/_next\/data\//

const isIgnoredRuntimeError = (text: string) =>
  (NEXT_DATA_ACCESS_CONTROL_ERROR.test(text) &&
    text.includes('due to access control checks.')) ||
  (text.includes("Permission policy 'Fullscreen' check failed") &&
    text.includes('https://player.vimeo.com')) ||
  (text.includes('error loading dynamically imported module') &&
    text.includes('https://player.vimeo.com'))

/** Start recording browser runtime errors for a Playwright page. */
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

type SyntheticKeyInit = {
  altKey: boolean
  ctrlKey: boolean
  key: string
  metaKey: boolean
  shiftKey: boolean
  which?: number
}

const parseSyntheticShortcut = (shortcut: string): SyntheticKeyInit | null => {
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

const parsePlainSyntheticKey = (shortcut: string): SyntheticKeyInit | null => {
  if (shortcut.includes('+')) {
    return null
  }

  return {
    altKey: false,
    ctrlKey: false,
    key: shortcut,
    metaKey: false,
    shiftKey: false,
    which:
      shortcut.length === 1 ? shortcut.toUpperCase().charCodeAt(0) : undefined,
  }
}

const dispatchSyntheticKey = async (
  root: Locator,
  eventInit: SyntheticKeyInit
) => {
  await root.evaluate((element: HTMLElement, eventInit: SyntheticKeyInit) => {
    const createKeyEvent = (type: 'keydown' | 'keyup') =>
      new KeyboardEvent(type, {
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

    element.dispatchEvent(defineKeyCode(createKeyEvent('keydown')))
    element.dispatchEvent(defineKeyCode(createKeyEvent('keyup')))
  }, eventInit)
  await root.page().waitForTimeout(0)
}

/** Run a callback while holding the shared clipboard access lock. */
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

const shouldUseSyntheticHtmlPaste = async (surface: SurfaceTarget) =>
  surface.evaluate(() => {
    const userAgent = navigator.userAgent

    return (
      userAgent.includes('AppleWebKit') &&
      !['Chrome', 'Chromium', 'Edg/'].some((token) => userAgent.includes(token))
    )
  })

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

/** Capture displayed selection overlays for one editor root. */
export const takeDisplayedSelectionSnapshotForRoot = async (
  root: Locator
): Promise<SlateBrowserDisplayedSelectionSnapshot> =>
  root.evaluate(
    (element: HTMLElement, { key }: { key: string }) => {
      const handle = (element as Record<string, any>)[key]
      const rootNode = element.getRootNode() as Document | ShadowRoot
      const selection =
        'getSelection' in rootNode
          ? rootNode.getSelection()
          : element.ownerDocument.getSelection()
      const nativeText = (selection?.toString() ?? '').replace(/\uFEFF/g, '')
      const viewSelection = handle?.getViewSelection?.() ?? null
      const markers = Array.from(
        element.querySelectorAll('[data-slate-view-selection="true"]')
      )
      const pointsEqual = (
        left: SelectionPoint | null | undefined,
        right: SelectionPoint | null | undefined
      ) =>
        !!left &&
        !!right &&
        left.offset === right.offset &&
        left.path.length === right.path.length &&
        left.path.every((part, index) => part === right.path[index])
      const isExpanded = (range: SelectionSnapshot | null) =>
        !!range && !pointsEqual(range.anchor, range.focus)
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

        if (!owner || !element.contains(owner)) {
          return null
        }

        const path = owner
          .getAttribute('data-slate-path')
          ?.split(',')
          .map((part) => Number.parseInt(part, 10))

        return path?.every(Number.isInteger) ? path : null
      }
      const takeNativeSelection = (): SelectionSnapshot | null => {
        if (
          !selection?.rangeCount ||
          !selection.anchorNode ||
          !selection.focusNode ||
          !element.contains(selection.anchorNode) ||
          !element.contains(selection.focusNode)
        ) {
          return null
        }

        const anchorPath = getPath(selection.anchorNode)
        const focusPath = getPath(selection.focusNode)

        if (!anchorPath || !focusPath) {
          return null
        }

        return {
          anchor: {
            offset: toEditorOffset(
              selection.anchorNode,
              selection.anchorOffset
            ),
            path: anchorPath,
          },
          focus: {
            offset: toEditorOffset(selection.focusNode, selection.focusOffset),
            path: focusPath,
          },
        }
      }
      const toViewPoint = (pointLike: any): SelectionPoint | null => {
        const point = pointLike?.point ?? pointLike

        return Array.isArray(point?.path) && Number.isInteger(point?.offset)
          ? { offset: point.offset, path: [...point.path] }
          : null
      }
      const nativeSelection = takeNativeSelection()
      const viewAnchor = toViewPoint(viewSelection?.anchor)
      const viewFocus = toViewPoint(viewSelection?.focus)
      const hasNativeEditorSelection =
        !!nativeSelection && nativeText.length > 0
      const normalizedViewSelection =
        viewAnchor && viewFocus
          ? {
              anchor: viewAnchor,
              focus: viewFocus,
            }
          : null
      const source =
        isExpanded(nativeSelection) ||
        (nativeSelection && !normalizedViewSelection)
          ? 'native'
          : normalizedViewSelection
            ? 'view'
            : nativeSelection
              ? 'native'
              : 'none'

      return {
        displayed:
          source === 'native'
            ? nativeSelection
            : source === 'view'
              ? normalizedViewSelection
              : null,
        doubleHighlighted: hasNativeEditorSelection && markers.length > 0,
        hasVisibleEditorSelection:
          hasNativeEditorSelection || markers.length > 0,
        hasVisibleSelection: nativeText.length > 0 || markers.length > 0,
        model: handle?.getSelection?.() ?? null,
        native: {
          collapsed: selection?.isCollapsed ?? null,
          rangeCount: selection?.rangeCount ?? 0,
          selection: nativeSelection,
          textLength: nativeText.length,
        },
        source,
        view: {
          active: !!normalizedViewSelection,
          anchor: viewAnchor,
          focus: viewFocus,
          markerCount: markers.length,
          markerPaths: markers.map(
            (marker) =>
              marker
                .closest('[data-slate-node="text"]')
                ?.getAttribute('data-slate-path') ?? null
          ),
          markerRects: markers.map((marker) => {
            const rect = marker.getBoundingClientRect()

            return {
              height: rect.height,
              width: rect.width,
              x: rect.x,
              y: rect.y,
            }
          }),
          selection: normalizedViewSelection,
          textLength: markers.reduce(
            (length, marker) =>
              length + (marker.textContent ?? '').replace(/\uFEFF/g, '').length,
            0
          ),
        },
      } satisfies SlateBrowserDisplayedSelectionSnapshot
    },
    { key: SLATE_BROWSER_HANDLE_KEY }
  )

/** Start native event tracing for a Slate browser root. */
export const startSlateBrowserNativeEventTrace = async (
  root: Locator,
  options: SlateBrowserNativeEventTraceOptions = {}
) => {
  await root.evaluate(
    (
      element: HTMLElement,
      {
        key,
        options,
      }: { key: string; options: SlateBrowserNativeEventTraceOptions }
    ) => {
      const previous = (element as Record<string, any>)[key] as
        | { stop?: () => void }
        | undefined

      previous?.stop?.()

      const maxEntries = Math.max(1, options.maxEntries ?? 100)
      const enabledEvents = new Set<SlateBrowserNativeEventTraceType>(
        options.events ?? [
          'selectionchange',
          'beforeinput',
          'input',
          'compositionstart',
          'compositionupdate',
          'compositionend',
        ]
      )
      const entries: SlateBrowserNativeEventTraceEntry[] = []
      const anomalies: SlateBrowserNativeEventTraceAnomaly[] = []
      const nodeIds = new WeakMap<Text, string>()
      let nodeId = 0
      let beforeInputTextNodes:
        | SlateBrowserNativeEventTraceTextNodeSnapshot[]
        | null = null
      let lastBeforeInput: SlateBrowserNativeEventTraceEntry | null = null
      let lastComposition: SlateBrowserNativeEventTraceEntry | null = null

      const rootNode = element.getRootNode() as Document | ShadowRoot
      const ownerDocument = element.ownerDocument

      const getRootSelection = () =>
        'getSelection' in rootNode
          ? rootNode.getSelection()
          : ownerDocument.getSelection()

      const getParentSignature = (parent: Element | null) => {
        if (!parent) {
          return null
        }

        const path = parent
          .closest('[data-slate-node="text"]')
          ?.getAttribute('data-slate-path')
        const ownPath = parent.getAttribute('data-slate-path')
        const directParent = parent.parentElement
        const sameTagIndex = directParent
          ? Array.from(directParent.children)
              .filter((sibling) => sibling.tagName === parent.tagName)
              .indexOf(parent)
          : 0

        return `${parent.tagName.toLowerCase()}[${sameTagIndex}]${
          ownPath ? `[path=${ownPath}]` : ''
        }${path ? `[text=${path}]` : ''}`
      }

      const getNodeSnapshot = (
        node: Node | null
      ): SlateBrowserNativeEventTraceNodeSnapshot => {
        if (!node) {
          return {
            nodeName: null,
            parentNodeName: null,
            parentPath: null,
            parentSignature: null,
            path: null,
            text: null,
          }
        }

        const elementNode =
          node.nodeType === Node.ELEMENT_NODE ? (node as Element) : null
        const parent =
          node.nodeType === Node.TEXT_NODE
            ? node.parentElement
            : (elementNode?.parentElement ?? null)
        const textNodeOwner = (elementNode ?? parent)?.closest(
          '[data-slate-node="text"]'
        )

        return {
          nodeName: node.nodeName,
          parentNodeName: parent?.nodeName ?? null,
          parentPath: parent?.getAttribute('data-slate-path') ?? null,
          parentSignature: getParentSignature(parent),
          path: textNodeOwner?.getAttribute('data-slate-path') ?? null,
          text: node.textContent ?? null,
        }
      }

      const takeSelection =
        (): SlateBrowserNativeEventTraceSelectionSnapshot => {
          const selection = getRootSelection()

          if (!selection || selection.rangeCount === 0) {
            return {
              anchor: null,
              anchorOffset: null,
              collapsed: null,
              focus: null,
              focusOffset: null,
              rangeCount: selection?.rangeCount ?? 0,
              selectedText: '',
            }
          }

          return {
            anchor: getNodeSnapshot(selection.anchorNode),
            anchorOffset: selection.anchorOffset,
            collapsed: selection.isCollapsed,
            focus: getNodeSnapshot(selection.focusNode),
            focusOffset: selection.focusOffset,
            rangeCount: selection.rangeCount,
            selectedText: (selection.toString() ?? '').replace(/\uFEFF/g, ''),
          }
        }

      const toRectSnapshots = (
        rects: DOMRectList | readonly DOMRect[]
      ): SlateBrowserNativeEventTraceRect[] =>
        Array.from(rects).map((rect) => ({
          height: rect.height,
          width: rect.width,
          x: rect.x,
          y: rect.y,
        }))

      const takeTargetRanges = (
        event: InputEvent
      ): SlateBrowserNativeEventTraceTargetRangeSnapshot[] => {
        const ranges = event.getTargetRanges?.() ?? []

        return Array.from(ranges).map((range) => {
          let rects: SlateBrowserNativeEventTraceRect[] = []

          try {
            const liveRange = ownerDocument.createRange()

            liveRange.setStart(range.startContainer, range.startOffset)
            liveRange.setEnd(range.endContainer, range.endOffset)
            rects = toRectSnapshots(liveRange.getClientRects())
          } catch {
            rects = []
          }

          return {
            collapsed: range.collapsed,
            end: getNodeSnapshot(range.endContainer),
            endOffset: range.endOffset,
            rects,
            start: getNodeSnapshot(range.startContainer),
            startOffset: range.startOffset,
          }
        })
      }

      const getTextNodeId = (textNode: Text) => {
        let id = nodeIds.get(textNode)

        if (!id) {
          id = `text-${++nodeId}`
          nodeIds.set(textNode, id)
        }

        return id
      }

      const snapshotTextNodes =
        (): SlateBrowserNativeEventTraceTextNodeSnapshot[] => {
          const snapshot: SlateBrowserNativeEventTraceTextNodeSnapshot[] = []
          const walker = ownerDocument.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT
          )
          let node = walker.nextNode()

          while (node) {
            const textNode = node as Text
            const parent = textNode.parentElement

            if (parent) {
              snapshot.push({
                id: getTextNodeId(textNode),
                parentPath: parent.getAttribute('data-slate-path'),
                parentSignature: getParentSignature(parent) ?? parent.nodeName,
                text: textNode.data,
              })
            }

            node = walker.nextNode()
          }

          return snapshot
        }

      const diffTextNodes = (
        before: SlateBrowserNativeEventTraceTextNodeSnapshot[] | null,
        after: SlateBrowserNativeEventTraceTextNodeSnapshot[]
      ): SlateBrowserNativeEventTraceDOMDelta | null => {
        if (!before) {
          return null
        }

        const deltas: SlateBrowserNativeEventTraceTextNodeDelta[] = []
        const afterById = new Map(after.map((node) => [node.id, node]))
        const beforeById = new Map(before.map((node) => [node.id, node]))

        for (const beforeNode of before) {
          const afterNode = afterById.get(beforeNode.id)

          if (!afterNode) {
            deltas.push({ after: null, before: beforeNode, type: 'deleted' })
          } else if (beforeNode.text !== afterNode.text) {
            deltas.push({
              after: afterNode,
              before: beforeNode,
              type: 'modified',
            })
          } else if (beforeNode.parentSignature !== afterNode.parentSignature) {
            deltas.push({ after: afterNode, before: beforeNode, type: 'moved' })
          }
        }

        for (const afterNode of after) {
          if (!beforeById.has(afterNode.id)) {
            deltas.push({ after: afterNode, before: null, type: 'added' })
          }
        }

        return { textNodes: deltas }
      }

      const addAnomaly = (
        type: SlateBrowserNativeEventTraceAnomaly['type'],
        detail: string
      ) => {
        anomalies.push({ detail, type })
      }

      const detectInputAnomalies = (
        entry: SlateBrowserNativeEventTraceEntry
      ) => {
        if (
          !lastBeforeInput ||
          entry.timestamp - lastBeforeInput.timestamp > 100
        ) {
          addAnomaly(
            'missing-beforeinput',
            `inputType=${entry.inputType ?? 'unknown'}`
          )
          return
        }

        if (
          lastBeforeInput.inputType &&
          entry.inputType &&
          lastBeforeInput.inputType !== entry.inputType
        ) {
          addAnomaly(
            'inputtype-mismatch',
            `${lastBeforeInput.inputType} -> ${entry.inputType}`
          )
        }

        if (
          lastBeforeInput.data &&
          entry.data &&
          !lastBeforeInput.data.includes(entry.data) &&
          !entry.data.includes(lastBeforeInput.data)
        ) {
          addAnomaly(
            'data-content-mismatch',
            `beforeinput="${lastBeforeInput.data}" input="${entry.data}"`
          )
        }

        const beforeAnchor = lastBeforeInput.selection.anchor
        const inputAnchor = entry.selection.anchor

        if (beforeAnchor?.path && inputAnchor?.path) {
          if (beforeAnchor.path !== inputAnchor.path) {
            addAnomaly(
              'parent-mismatch',
              `${beforeAnchor.path} -> ${inputAnchor.path}`
            )
          } else if (
            lastBeforeInput.inputType?.startsWith('insert') &&
            lastBeforeInput.data &&
            lastBeforeInput.selection.anchorOffset != null &&
            entry.selection.anchorOffset != null
          ) {
            const expected =
              lastBeforeInput.selection.anchorOffset +
              lastBeforeInput.data.length
            const delta = Math.abs(entry.selection.anchorOffset - expected)

            if (delta > 4) {
              addAnomaly(
                'selection-jump',
                `expected offset ${expected}, got ${entry.selection.anchorOffset}`
              )
            }
          }
        }

        if (
          beforeAnchor?.nodeName &&
          inputAnchor?.nodeName &&
          beforeAnchor.nodeName !== inputAnchor.nodeName
        ) {
          addAnomaly(
            'node-type-change',
            `${beforeAnchor.nodeName} -> ${inputAnchor.nodeName}`
          )
        }

        if (entry.domDelta?.textNodes.some((node) => node.type === 'added')) {
          addAnomaly('sibling-created', 'input created a new text node')
        }
      }

      const detectCompositionAnomalies = (
        entry: SlateBrowserNativeEventTraceEntry
      ) => {
        if (
          lastComposition?.data &&
          entry.data &&
          !lastComposition.data.includes(entry.data) &&
          !entry.data.includes(lastComposition.data)
        ) {
          addAnomaly(
            'composition-mismatch',
            `composition="${lastComposition.data}" event="${entry.data}"`
          )
        }
      }

      const pushEntry = (entry: SlateBrowserNativeEventTraceEntry) => {
        entries.push(entry)

        if (entries.length > maxEntries) {
          entries.splice(0, entries.length - maxEntries)
        }
      }

      const record = (event: Event) => {
        const type = event.type as SlateBrowserNativeEventTraceType

        if (!enabledEvents.has(type)) {
          return
        }

        const inputEvent =
          event instanceof InputEvent ? event : (null as InputEvent | null)
        const compositionEvent =
          event instanceof CompositionEvent
            ? event
            : (null as CompositionEvent | null)

        if (type === 'beforeinput') {
          beforeInputTextNodes = snapshotTextNodes()
        }

        const entry: SlateBrowserNativeEventTraceEntry = {
          data: inputEvent?.data ?? compositionEvent?.data ?? null,
          domDelta:
            type === 'input'
              ? diffTextNodes(beforeInputTextNodes, snapshotTextNodes())
              : null,
          inputType: inputEvent?.inputType ?? null,
          isComposing: inputEvent?.isComposing ?? null,
          selection: takeSelection(),
          targetRanges: inputEvent ? takeTargetRanges(inputEvent) : [],
          timestamp: Date.now(),
          type,
        }

        if (type === 'input') {
          detectInputAnomalies(entry)
        } else if (type === 'beforeinput') {
          lastBeforeInput = entry
        } else if (type.startsWith('composition')) {
          detectCompositionAnomalies(entry)
          lastComposition = entry
        }

        pushEntry(entry)
      }

      const eventTypes: SlateBrowserNativeEventTraceType[] = [
        'beforeinput',
        'input',
        'compositionstart',
        'compositionupdate',
        'compositionend',
      ]

      eventTypes.forEach((type) => {
        element.addEventListener(type, record, { capture: true })
      })
      ownerDocument.addEventListener('selectionchange', record)

      ;(element as Record<string, any>)[key] = {
        anomalies,
        entries,
        reset() {
          entries.length = 0
          anomalies.length = 0
          beforeInputTextNodes = null
          lastBeforeInput = null
          lastComposition = null
        },
        stop() {
          eventTypes.forEach((type) => {
            element.removeEventListener(type, record, { capture: true })
          })
          ownerDocument.removeEventListener('selectionchange', record)
        },
      }
    },
    { key: NATIVE_EVENT_TRACE_KEY, options }
  )
}

/** Clear the current native event trace for a Slate browser root. */
export const resetSlateBrowserNativeEventTrace = async (root: Locator) => {
  await root.evaluate(
    (element: HTMLElement, { key }: { key: string }) => {
      ;(element as Record<string, any>)[key]?.reset?.()
    },
    { key: NATIVE_EVENT_TRACE_KEY }
  )
}

/** Stop native event tracing for a Slate browser root. */
export const stopSlateBrowserNativeEventTrace = async (root: Locator) => {
  await root.evaluate(
    (element: HTMLElement, { key }: { key: string }) => {
      ;(element as Record<string, any>)[key]?.stop?.()
      delete (element as Record<string, any>)[key]
    },
    { key: NATIVE_EVENT_TRACE_KEY }
  )
}

/** Read the native event trace captured for a Slate browser root. */
export const takeSlateBrowserNativeEventTrace = async (
  root: Locator
): Promise<SlateBrowserNativeEventTraceSnapshot> =>
  root.evaluate(
    (element: HTMLElement, { key }: { key: string }) => {
      const trace = (element as Record<string, any>)[key]

      return {
        anomalies:
          trace?.anomalies?.map(
            (anomaly: SlateBrowserNativeEventTraceAnomaly) => ({ ...anomaly })
          ) ?? [],
        entries:
          trace?.entries?.map((entry: SlateBrowserNativeEventTraceEntry) => ({
            ...entry,
            domDelta: entry.domDelta
              ? {
                  textNodes: entry.domDelta.textNodes.map((node) => ({
                    after: node.after ? { ...node.after } : null,
                    before: node.before ? { ...node.before } : null,
                    type: node.type,
                  })),
                }
              : null,
            selection: {
              ...entry.selection,
              anchor: entry.selection.anchor
                ? { ...entry.selection.anchor }
                : null,
              focus: entry.selection.focus
                ? { ...entry.selection.focus }
                : null,
            },
            targetRanges: entry.targetRanges.map((range) => ({
              ...range,
              end: { ...range.end },
              rects: range.rects.map((rect) => ({ ...rect })),
              start: { ...range.start },
            })),
          })) ?? [],
      } satisfies SlateBrowserNativeEventTraceSnapshot
    },
    { key: NATIVE_EVENT_TRACE_KEY }
  )

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
    })

    Object.defineProperty(event, 'clipboardData', {
      value: data,
    })

    element.dispatchEvent(event)

    return {
      html: data.getData('text/html') || null,
      slateFragment: data.getData('application/x-slate-fragment') || null,
      text: data.getData('text/plain'),
      types: Array.from(data.types),
    }
  })

const cutPayloadThroughEvent = async (
  root: Locator
): Promise<ClipboardPayloadSnapshot> =>
  root.evaluate((element: HTMLElement) => {
    const data = new DataTransfer()
    const event = new ClipboardEvent('cut', {
      bubbles: true,
      cancelable: true,
    })

    Object.defineProperty(event, 'clipboardData', {
      value: data,
    })

    element.dispatchEvent(event)

    return {
      html: data.getData('text/html') || null,
      slateFragment: data.getData('application/x-slate-fragment') || null,
      text: data.getData('text/plain'),
      types: Array.from(data.types),
    }
  })

const pastePayloadThroughEvent = async (
  root: Locator,
  payload: { html?: string | null; slateFragment?: string | null; text: string }
) =>
  root.evaluate(
    async (
      element: HTMLElement,
      nextPayload: {
        html?: string | null
        key: string
        slateFragment?: string | null
        text: string
      }
    ) => {
      const beforeText = element.textContent
      const handle = (element as Record<string, any>)[nextPayload.key]
      const beforeModelText =
        typeof handle?.getText === 'function' ? handle.getText() : null
      const data = new DataTransfer()

      if (nextPayload.html) {
        data.setData('text/html', nextPayload.html)
      }
      if (nextPayload.slateFragment) {
        data.setData('application/x-slate-fragment', nextPayload.slateFragment)
      }
      data.setData('text/plain', nextPayload.text)

      const event = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
      })

      Object.defineProperty(event, 'clipboardData', {
        value: data,
      })

      const wasNotCanceled = element.dispatchEvent(event)
      await new Promise((resolve) => setTimeout(resolve, 0))

      if (
        wasNotCanceled &&
        !event.defaultPrevented &&
        element.textContent === beforeText &&
        (beforeModelText == null ||
          typeof handle?.getText !== 'function' ||
          handle.getText() === beforeModelText)
      ) {
        if (!handle?.insertData) {
          throw new Error('This editor surface does not expose insertData')
        }

        handle.insertData({
          html: nextPayload.html ?? undefined,
          slateFragment: nextPayload.slateFragment ?? undefined,
          text: nextPayload.text,
        })
      }
    },
    { ...payload, key: SLATE_BROWSER_HANDLE_KEY }
  )

const insertDataThroughHandle = async (
  root: Locator,
  payload: { html?: string | null; slateFragment?: string | null; text: string }
) =>
  root.evaluate(
    (
      element: HTMLElement,
      nextPayload: {
        html?: string | null
        key: string
        slateFragment?: string | null
        text: string
      }
    ) => {
      const handle = (element as Record<string, any>)[nextPayload.key]

      if (!handle?.insertData) {
        throw new Error('This editor surface does not expose insertData')
      }

      handle.insertData({
        html: nextPayload.html ?? undefined,
        slateFragment: nextPayload.slateFragment ?? undefined,
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

const mutateTextDOM = async (
  root: Locator,
  step: Extract<SlateBrowserScenarioStep, { kind: 'mutateTextDOM' }>
) => {
  await root.evaluate(
    (
      element: HTMLElement,
      payload: {
        data: string | null
        inputType: string
        path: number[]
        selectionOffset: number
        text: string
      }
    ) => {
      const textElement = element.querySelector(
        `[data-slate-node="text"][data-slate-path="${payload.path.join(',')}"]`
      )
      const textHost =
        textElement?.querySelector(
          '[data-slate-string], [data-slate-zero-width]'
        ) ?? textElement

      if (!textHost) {
        throw new Error(`Missing DOM text host for ${payload.path.join('.')}`)
      }

      const walker = document.createTreeWalker(textHost, NodeFilter.SHOW_TEXT)
      const textNode = walker.nextNode()

      if (!(textNode instanceof Text)) {
        throw new Error(`Missing DOM text node for ${payload.path.join('.')}`)
      }

      if (payload.selectionOffset > payload.text.length) {
        throw new Error(
          `DOM text mutation selection offset ${payload.selectionOffset} exceeds text length ${payload.text.length}`
        )
      }

      textNode.nodeValue = payload.text
      element.focus({ preventScroll: true })

      const range = document.createRange()
      const selection = window.getSelection()

      range.setStart(textNode, payload.selectionOffset)
      range.collapse(true)
      selection?.removeAllRanges()
      selection?.addRange(range)

      let event: Event

      try {
        event = new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          data: payload.data,
          inputType: payload.inputType,
        })
      } catch {
        event = new Event('input', {
          bubbles: true,
          cancelable: true,
        })
        Object.defineProperties(event, {
          data: { value: payload.data },
          inputType: { value: payload.inputType },
        })
      }

      element.dispatchEvent(event)
    },
    {
      data: step.data ?? null,
      inputType: step.inputType ?? 'insertText',
      path: step.path,
      selectionOffset: step.selectionOffset ?? step.text.length,
      text: step.text,
    }
  )

  await waitForPendingNativeTextInputRepair(root)
}

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
  options: {
    clickCount?: number
    waitForSelectionSync?: boolean
  } = {}
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

  const clickCount = options.clickCount

  const readClickPointState = () =>
    root.evaluate(
      (
        element: HTMLElement,
        point: {
          x: number
          y: number
        }
      ) => {
        const describeElement = (node: Element | null) => {
          if (!node) {
            return null
          }

          return {
            ariaLabel: node.getAttribute('aria-label'),
            path: node.getAttribute('data-slate-path'),
            role: node.getAttribute('role'),
            slateNode: node.getAttribute('data-slate-node'),
            tagName: node.tagName,
            text: node.textContent?.slice(0, 80) ?? '',
          }
        }
        const resolveSlatePoint = (node: Node | null, offset: number) => {
          const owner =
            node?.nodeType === 1
              ? (node as Element).closest('[data-slate-node="text"]')
              : node?.parentElement?.closest('[data-slate-node="text"]')
          const path = owner
            ?.getAttribute('data-slate-path')
            ?.split(',')
            .map((part) => Number.parseInt(part, 10))

          return {
            offset,
            ownerText: owner?.textContent?.slice(0, 80) ?? null,
            path: path?.every(Number.isInteger) ? path : null,
          }
        }
        const documentWithCaret = element.ownerDocument as Document & {
          caretPositionFromPoint?: (
            x: number,
            y: number
          ) => { offset: number; offsetNode: Node } | null
          caretRangeFromPoint?: (x: number, y: number) => Range | null
        }
        const caretPosition = documentWithCaret.caretPositionFromPoint?.(
          point.x,
          point.y
        )
        const caretRange =
          caretPosition == null
            ? documentWithCaret.caretRangeFromPoint?.(point.x, point.y)
            : null
        const caretNode =
          caretPosition?.offsetNode ?? caretRange?.startContainer ?? null
        const caretOffset =
          caretPosition?.offset ?? caretRange?.startOffset ?? null
        const hit = element.ownerDocument.elementFromPoint(point.x, point.y)

        return {
          caret:
            caretNode && caretOffset != null
              ? resolveSlatePoint(caretNode, caretOffset)
              : null,
          hit: describeElement(hit),
          point,
        }
      },
      point
    )

  if (clickCount === 2) {
    await root.page().mouse.dblclick(point.x, point.y)
  } else {
    await root.page().mouse.click(point.x, point.y, {
      clickCount,
    })
  }
  if (options.waitForSelectionSync ?? true) {
    const isSingleClick = (clickCount ?? 1) === 1
    await waitForSelectionSync(
      root,
      isSingleClick
        ? {
            anchor: { offset, path },
            focus: { offset, path },
          }
        : undefined
    ).catch(async (error: unknown) => {
      const clickPointState = await readClickPointState().catch(
        (stateError: unknown) => ({
          error:
            stateError instanceof Error
              ? stateError.message
              : String(stateError),
        })
      )

      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\nClick point state:\n${JSON.stringify(clickPointState, null, 2)}`
      )
    })
  }
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

const supportsRootScopedSelection = async (root: Locator) =>
  root.evaluate((element: HTMLElement) => {
    const rootNode = element.getRootNode() as Document | ShadowRoot

    return (
      !(rootNode instanceof ShadowRoot) ||
      typeof (rootNode as { getSelection?: unknown }).getSelection ===
        'function'
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

const handleSelectionMatches = async (
  root: Locator,
  expected: SelectionSnapshot
): Promise<boolean> =>
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

const waitForHandleSelection = async (
  root: Locator,
  expected: SelectionSnapshot
) => {
  await expect
    .poll(async () => handleSelectionMatches(root, expected))
    .toBe(true)
}

const scrollTextPathIntoViewAndCheckMaterialized = async (
  root: Locator,
  path: number[],
  options: SlateBrowserDOMPathOptions = {}
) =>
  root.evaluate(
    (
      element: HTMLElement,
      {
        align,
        key,
        path,
      }: {
        align: SlateBrowserDOMPathOptions['align']
        key: string
        path: number[]
      }
    ) => {
      const handle = (element as Record<string, any>)[key]

      handle?.scrollPathIntoView?.(path, align ?? 'center')

      return !!element.querySelector(
        `[data-slate-node="text"][data-slate-path="${path.join(',')}"]`
      )
    },
    { align: options.align, key: SLATE_BROWSER_HANDLE_KEY, path }
  )

const waitForTextPathMaterialized = async (
  root: Locator,
  path: number[],
  options: SlateBrowserDOMPathOptions = {}
) => {
  await expect
    .poll(
      () => scrollTextPathIntoViewAndCheckMaterialized(root, path, options),
      {
        timeout: options.timeoutMs ?? READY_TIMEOUT_MS,
      }
    )
    .toBe(true)
}

const collapseDOMAtTextPath = async (
  root: Locator,
  point: SelectionPoint,
  options: SlateBrowserDOMPathOptions = {}
) => {
  const selection = { anchor: point, focus: point }

  if (
    !(await scrollTextPathIntoViewAndCheckMaterialized(
      root,
      point.path,
      options
    )) &&
    !(await setSelectionWithHandle(root, selection))
  ) {
    await setSelection(root, selection)
  }

  await waitForTextPathMaterialized(root, point.path, options)

  if (!(await setSelectionWithHandle(root, selection))) {
    await setSelection(root, selection)
  }

  await root.evaluate((element: HTMLElement) => {
    element.focus({ preventScroll: true })
  })

  if (!(await setDOMSelection(root, selection))) {
    throw new Error(`Missing DOM text node for ${point.path.join('.')}`)
  }

  await root.evaluate(
    (element: HTMLElement, { key }: { key: string }) => {
      const rootNode = element.getRootNode() as Document | ShadowRoot

      element.ownerDocument.dispatchEvent(
        new Event('selectionchange', { bubbles: true })
      )

      if (rootNode instanceof ShadowRoot) {
        rootNode.dispatchEvent(new Event('selectionchange', { bubbles: true }))
      }

      const handle = (element as Record<string, any>)[key]

      handle?.importDOMSelection?.()
    },
    { key: SLATE_BROWSER_HANDLE_KEY }
  )
  await waitForHandleSelection(root, selection)
  await waitForSelectionRange(root)
}

const clickTextPathRange = async (
  root: Locator,
  {
    align,
    endOffset,
    path,
    startOffset,
    timeoutMs,
    xAffinity = 'start',
  }: SlateBrowserTextPathRangeClickOptions
) => {
  if (startOffset >= endOffset) {
    throw new Error('clickTextPathRange expects startOffset < endOffset')
  }

  await waitForTextPathMaterialized(root, path, { align, timeoutMs })

  const point = await root.evaluate(
    (
      element: HTMLElement,
      {
        endOffset,
        path,
        startOffset,
        xAffinity,
      }: {
        endOffset: number
        path: number[]
        startOffset: number
        xAffinity: NonNullable<
          SlateBrowserTextPathRangeClickOptions['xAffinity']
        >
      }
    ) => {
      const textElement = Array.from(
        element.querySelectorAll('[data-slate-node="text"]')
      ).find(
        (node) =>
          node.closest('[data-slate-editor="true"]') === element &&
          node.getAttribute('data-slate-path') === path.join(',')
      )

      if (!textElement) {
        throw new Error(`Missing DOM text node for ${path.join('.')}`)
      }

      const resolveOffset = (offset: number) => {
        const stringElements = Array.from(
          textElement.querySelectorAll(
            '[data-slate-string], [data-slate-zero-width]'
          )
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

          if (
            stringElement.hasAttribute('data-slate-zero-width') &&
            offset === start &&
            length <= 1
          ) {
            return {
              node: textNode,
              offset: length,
            }
          }

          if (offset <= end) {
            return {
              node: textNode,
              offset: Math.min(length, Math.max(0, offset - start)),
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

        return {
          node: textElement,
          offset: textElement.childNodes.length,
        }
      }

      const range = element.ownerDocument.createRange()
      const start = resolveOffset(startOffset)
      const end = resolveOffset(endOffset)

      range.setStart(start.node, start.offset)
      range.setEnd(end.node, end.offset)

      const rect = range.getClientRects()[0] ?? range.getBoundingClientRect()

      if (!rect || rect.width <= 0 || rect.height <= 0) {
        throw new Error(
          `Text range has no selectable rect: ${path.join('.')} ${startOffset}-${endOffset}`
        )
      }

      return {
        x:
          xAffinity === 'center'
            ? rect.left + rect.width / 2
            : xAffinity === 'end'
              ? Math.max(rect.left + 1, rect.right - 1)
              : rect.left,
        y: rect.top + rect.height / 2,
      }
    },
    { endOffset, path, startOffset, xAffinity }
  )

  await root.page().mouse.click(point.x, point.y)
}

const waitForPendingNativeTextInputRepair = async (
  root: Locator,
  { timeoutMs = READY_TIMEOUT_MS }: { timeoutMs?: number } = {}
) => {
  let actual: {
    clearSettled: boolean | null
    domRaw: {
      anchorNodeText: string | null
      anchorOffset: number
      focusNodeText: string | null
      focusOffset: number
    } | null
    domResolved: SelectionSnapshot | null
    inputState: unknown
    kernelTrace: unknown[]
    repairTrace: unknown[]
    model: SelectionSnapshot | null
    pendingPath: string | null
  } | null = null

  try {
    await expect
      .poll(
        async () => {
          actual = await root.evaluate(
            (element: HTMLElement, { key }: { key: string }) => {
              const handle = (element as Record<string, any>)[key]
              const clearSettled =
                handle?.clearSettledPendingNativeTextInputRepair?.() ?? null
              const state = handle?.getInputState?.() as
                | { pendingNativeTextInputRepairPathKey?: string | null }
                | null
                | undefined
              const kernelTrace = handle?.getKernelTrace?.() ?? []
              const root = element.getRootNode() as Document | ShadowRoot
              const selection =
                'getSelection' in root ? root.getSelection() : null

              return {
                clearSettled,
                domRaw:
                  selection && selection.rangeCount > 0
                    ? {
                        anchorNodeText:
                          selection.anchorNode?.textContent?.replace(
                            /\uFEFF/g,
                            ''
                          ) ?? null,
                        anchorOffset: selection.anchorOffset,
                        focusNodeText:
                          selection.focusNode?.textContent?.replace(
                            /\uFEFF/g,
                            ''
                          ) ?? null,
                        focusOffset: selection.focusOffset,
                      }
                    : null,
                domResolved: handle?.getDOMSelection?.() ?? null,
                inputState: state ?? null,
                kernelTrace: kernelTrace.slice(-8),
                model: handle?.getSelection?.() ?? null,
                pendingPath: state?.pendingNativeTextInputRepairPathKey ?? null,
                repairTrace: kernelTrace
                  .filter(
                    (entry: { eventFamily?: unknown }) =>
                      entry?.eventFamily === 'repair'
                  )
                  .slice(-8),
              }
            },
            { key: SLATE_BROWSER_HANDLE_KEY }
          )

          return actual.pendingPath
        },
        { timeout: timeoutMs }
      )
      .toBe(null)
  } catch {
    throw new Error(
      `Expected pending native text input repair to settle but received ${JSON.stringify(
        actual
      )}`
    )
  }
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

const pathsEqual = (left: readonly number[], right: readonly number[]) =>
  left.length === right.length &&
  left.every((segment, index) => segment === right[index])

const normalizeDOMSelectionText = (value: string | null | undefined) =>
  value?.replace(/\uFEFF/g, '') ?? null

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

const assertCollapsedModelDOMSelectionExpectation = async (
  root: Locator,
  expected: CollapsedModelDOMSelectionExpectation
) => {
  let actual: {
    dom: DOMSelectionSnapshot | null
    domResolved: SelectionSnapshot | null
    inputState: unknown
    kernelTrace: unknown[]
    model: SelectionSnapshot | null
  } | null = null

  try {
    await expect
      .poll(async () => {
        const [model, dom, domResolved, inputState, kernelTrace] =
          await Promise.all([
            takeSelectionSnapshotForRoot(root),
            takeDOMSelectionSnapshotForRoot(root),
            takeResolvedDOMSelectionSnapshotForRoot(root),
            root.evaluate(
              (element: HTMLElement, { key }: { key: string }) => {
                const handle = (element as Record<string, any>)[key]

                return handle?.getInputState?.() ?? null
              },
              { key: SLATE_BROWSER_HANDLE_KEY }
            ),
            root.evaluate(
              (element: HTMLElement, { key }: { key: string }) => {
                const handle = (element as Record<string, any>)[key]

                return handle?.getKernelTrace?.()?.slice(-8) ?? []
              },
              { key: SLATE_BROWSER_HANDLE_KEY }
            ),
          ])

        actual = { dom, domResolved, inputState, kernelTrace, model }

        if (!model || !dom) {
          return false
        }

        const modelCollapsed =
          pathsEqual(model.anchor.path, model.focus.path) &&
          model.anchor.offset === model.focus.offset
        const domCollapsed = dom.anchorOffset === dom.focusOffset
        const modelAtPath =
          pathsEqual(model.anchor.path, expected.path) &&
          pathsEqual(model.focus.path, expected.path)
        const domText =
          normalizeDOMSelectionText(dom.anchorNodeText) === expected.text &&
          normalizeDOMSelectionText(dom.focusNodeText) === expected.text
        const rawSameOffset =
          model.anchor.offset === dom.anchorOffset &&
          model.focus.offset === dom.focusOffset
        const resolvedDOMCollapsed =
          !!domResolved &&
          pathsEqual(domResolved.anchor.path, domResolved.focus.path) &&
          domResolved.anchor.offset === domResolved.focus.offset
        const resolvedDOMAtPath =
          !!domResolved &&
          pathsEqual(domResolved.anchor.path, expected.path) &&
          pathsEqual(domResolved.focus.path, expected.path)
        const resolvedSameOffset =
          !!domResolved &&
          model.anchor.offset === domResolved.anchor.offset &&
          model.focus.offset === domResolved.focus.offset
        const sameOffset = domResolved
          ? resolvedDOMCollapsed && resolvedDOMAtPath && resolvedSameOffset
          : rawSameOffset

        return (
          modelCollapsed &&
          domCollapsed &&
          modelAtPath &&
          domText &&
          sameOffset &&
          matchesOffsetExpectation(expected.offset, model.anchor.offset)
        )
      })
      .toBe(true)
  } catch {
    throw new Error(
      `Expected collapsed Slate/DOM selection ${JSON.stringify(
        expected
      )} but received ${JSON.stringify(actual)}`
    )
  }
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

/** Playwright helper bundle for opening routes and inspecting editors. */
/** Browser editor harness returned by `createSlateBrowserEditorHarness`. */
export type SlateBrowserEditorHarness = {
  name: string
  page: Page
  root: Locator
  rootAt: (selector: string) => SlateBrowserEditorHarness
  get: {
    modelText: () => Promise<string>
    modelBlockText: (index: number) => Promise<string | null>
    modelBlockTexts: () => Promise<string[]>
    text: () => Promise<string>
    blockTexts: () => Promise<string[]>
    renderedDOMShape: () => Promise<RenderedBlockDOMShapeSnapshot[]>
    selectedText: () => Promise<string>
    displayedSelection: () => Promise<SlateBrowserDisplayedSelectionSnapshot>
    html: () => Promise<string>
    selection: () => Promise<SelectionSnapshot | null>
    domSelection: () => Promise<DOMSelectionSnapshot | null>
    focusOwner: () => Promise<FocusOwnerSnapshot>
    kernelTrace: () => Promise<SlateBrowserKernelTraceEntry[]>
    history: () => Promise<unknown>
    lastCommit: () => Promise<unknown | null>
    placeholderShape: (selector?: string) => Promise<PlaceholderShape | null>
  }
  selection: {
    select: (selection: SelectionSnapshot) => Promise<void>
    selectDOM: (selection: SelectionSnapshot) => Promise<void>
    dragTextRange: (options: SlateBrowserDragTextRangeOptions) => Promise<void>
    doubleClickDragTextRange: (
      options: SlateBrowserDoubleClickDragTextRangeOptions
    ) => Promise<void>
    collapse: (point: SelectionPoint) => Promise<void>
    capture: (options?: SelectionCaptureOptions) => Promise<SelectionBookmark>
    bookmark: (options?: SelectionCaptureOptions) => Promise<SelectionBookmark>
    resolve: (bookmark: SelectionBookmark) => Promise<SelectionSnapshot | null>
    restore: (bookmark: SelectionBookmark) => Promise<void>
    unref: (bookmark: SelectionBookmark) => Promise<SelectionSnapshot | null>
    selectAll: () => Promise<void>
    get: () => Promise<SelectionSnapshot | null>
    displayed: () => Promise<SlateBrowserDisplayedSelectionSnapshot>
    dom: () => Promise<DOMSelectionSnapshot | null>
    location: () => Promise<DOMSelectionLocationSnapshot | null>
    importDOM: () => Promise<SelectionSnapshot | null>
    rect: () => Promise<SelectionRectSnapshot | null>
  }
  dom: {
    clickTextOffset: (
      options: SlateBrowserTextOffsetClickOptions
    ) => Promise<void>
    clickTextRange: (
      options: SlateBrowserTextPathRangeClickOptions
    ) => Promise<void>
    collapseAtTextPath: (
      point: SelectionPoint,
      options?: SlateBrowserDOMPathOptions
    ) => Promise<void>
    waitForPendingNativeTextInputRepair: (options?: {
      timeoutMs?: number
    }) => Promise<void>
    waitForTextPath: (
      path: number[],
      options?: SlateBrowserDOMPathOptions
    ) => Promise<void>
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
    modelBlockText: (index: number, text: string | null) => Promise<void>
    modelBlockTexts: (texts: string[]) => Promise<void>
    blockTexts: (texts: string[]) => Promise<void>
    html: (
      expectedHtml: string,
      options?: HtmlNormalizationOptions
    ) => Promise<void>
    htmlContains: (expectedFragment: string) => Promise<void>
    htmlEquals: (
      expectedHtml: string,
      options?: HtmlNormalizationOptions
    ) => Promise<void>
    focusOwner: (expected: FocusOwnerSnapshot['kind']) => Promise<void>
    kernelTrace: (expected: SlateBrowserKernelTraceExpectation) => Promise<void>
    selection: (expected: SelectionSnapshotExpectation) => Promise<void>
    collapsedModelDOMSelection: (
      expected: CollapsedModelDOMSelectionExpectation
    ) => Promise<void>
    noDoubleSelectionHighlight: () => Promise<void>
    caretVisibleInScrollableParent: () => Promise<void>
    noVisibleCaretInRoot: () => Promise<void>
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
    cutEventPayload: () => Promise<ClipboardPayloadSnapshot>
    copyPayload: () => Promise<ClipboardPayloadSnapshot>
    readText: () => Promise<string>
    readHtml: () => Promise<string | null>
    pasteEventPayload: (payload: {
      html?: string | null
      slateFragment?: string | null
      text: string
    }) => Promise<void>
    pasteNativeText: (text: string) => Promise<void>
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
    startSynthetic: (options?: { text?: string }) => Promise<void>
    updateSynthetic: (options: { text: string }) => Promise<void>
    commitSynthetic: (options: { text: string }) => Promise<void>
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

/** Contract expectation for model, DOM, native, and visual selection proof. */
/** Expected selection state for `assertSlateBrowserSelectionContract`. */
export type SlateBrowserSelectionContractExpectation = {
  domSelection?: DOMSelectionSnapshotExpectation
  domSelectionTarget?: Partial<DOMSelectionLocationSnapshot>
  hasVisibleEditorSelection?: boolean
  hasVisibleSelection?: boolean
  noDoubleSelectionHighlight?: boolean
  selectedText?: string
  selection?: SelectionSnapshotExpectation
}

/** Snapshot used to prove caret visibility inside a scroll container. */
/** Caret visibility evidence captured inside a scrollable parent. */
export type CaretVisibilitySnapshot = {
  activeElementTestId: string | null
  activeElementTagName: string | null
  anchorInRoot: boolean
  anchorNodeText: string | null
  focusInRoot: boolean
  hasSelection: boolean
  parentRect: { bottom: number; top: number } | null
  rangeCount: number
  rootContainsActiveElement: boolean
  scrollParentTagName: string | null
  textHostText: string | null
  visible: boolean
  visibleRect: {
    bottom: number
    height: number
    top: number
    width: number
  } | null
}

/** Assert model, DOM, native, and visual selection expectations. */
export const assertSlateBrowserSelectionContract = async (
  harness: SlateBrowserEditorHarness,
  expected: SlateBrowserSelectionContractExpectation
) => {
  if (expected.selection) {
    await harness.assert.selection(expected.selection)
  }

  if (expected.selectedText !== undefined) {
    await expect
      .poll(() => harness.get.selectedText())
      .toBe(expected.selectedText)
  }

  if (expected.domSelection) {
    await harness.assert.domSelection(expected.domSelection)
  }

  if (expected.domSelectionTarget) {
    await harness.assert.domSelectionTarget(expected.domSelectionTarget)
  }

  if (expected.hasVisibleSelection !== undefined) {
    await expect
      .poll(
        async () => (await harness.selection.displayed()).hasVisibleSelection
      )
      .toBe(expected.hasVisibleSelection)
  }

  if (expected.hasVisibleEditorSelection !== undefined) {
    await expect
      .poll(
        async () =>
          (await harness.selection.displayed()).hasVisibleEditorSelection
      )
      .toBe(expected.hasVisibleEditorSelection)
  }

  if (expected.noDoubleSelectionHighlight) {
    await harness.assert.noDoubleSelectionHighlight()
  }
}

const takeCaretVisibilitySnapshot = async (
  root: Locator
): Promise<CaretVisibilitySnapshot> =>
  root.evaluate((element: HTMLElement) => {
    const selection = element.ownerDocument.getSelection()
    const activeElement = element.ownerDocument.activeElement
    const anchorInRoot =
      !!selection?.anchorNode && element.contains(selection.anchorNode)
    const focusInRoot =
      !!selection?.focusNode && element.contains(selection.focusNode)
    const base = {
      activeElementTestId:
        (activeElement as HTMLElement | null)?.dataset?.testId ?? null,
      activeElementTagName: activeElement?.tagName?.toLowerCase() ?? null,
      anchorInRoot,
      anchorNodeText: selection?.anchorNode?.textContent ?? null,
      focusInRoot,
      hasSelection: !!selection,
      parentRect: null,
      rangeCount: selection?.rangeCount ?? 0,
      rootContainsActiveElement:
        !!activeElement && element.contains(activeElement),
      scrollParentTagName: null,
      textHostText: null,
      visible: false,
      visibleRect: null,
    } satisfies CaretVisibilitySnapshot

    if (!selection || selection.rangeCount === 0) {
      return base
    }

    const scrollParent = [
      element,
      ...Array.from(
        (function* parents() {
          for (
            let parent = element.parentElement;
            parent;
            parent = parent.parentElement
          ) {
            if (parent.scrollHeight > parent.clientHeight) {
              yield parent
            }
          }
        })()
      ),
    ].find((parent) => parent.scrollHeight > parent.clientHeight)
    const scrollParentTagName = scrollParent?.tagName ?? null
    const anchorElement =
      selection.anchorNode instanceof Element
        ? selection.anchorNode
        : selection.anchorNode instanceof Text
          ? selection.anchorNode.parentElement
          : null
    const textHost = anchorElement?.closest('[data-slate-node="text"]')
    const range = selection.getRangeAt(0)
    const caretRect =
      Array.from(range.getClientRects())[0] ?? range.getBoundingClientRect()
    const visibleRect =
      caretRect.width === 0 && caretRect.height === 0
        ? textHost?.getBoundingClientRect()
        : caretRect

    if (!visibleRect || (visibleRect.width === 0 && visibleRect.height === 0)) {
      return {
        ...base,
        scrollParentTagName,
        textHostText: textHost?.textContent ?? null,
      }
    }

    const parentRect = scrollParent?.getBoundingClientRect() ?? {
      bottom: window.innerHeight,
      top: 0,
    }
    const visible =
      anchorInRoot &&
      focusInRoot &&
      !!activeElement &&
      element.contains(activeElement) &&
      visibleRect.top >= parentRect.top - 1 &&
      visibleRect.bottom <= parentRect.bottom + 1

    return {
      ...base,
      parentRect: {
        bottom: parentRect.bottom,
        top: parentRect.top,
      },
      scrollParentTagName,
      textHostText: textHost?.textContent ?? null,
      visible,
      visibleRect: {
        bottom: visibleRect.bottom,
        height: visibleRect.height,
        top: visibleRect.top,
        width: visibleRect.width,
      },
    }
  })

const assertCaretVisibleInScrollableParent = async (root: Locator) => {
  let lastSnapshot: CaretVisibilitySnapshot | null = null

  try {
    await expect
      .poll(async () => {
        lastSnapshot = await takeCaretVisibilitySnapshot(root)

        return lastSnapshot.visible
      })
      .toBe(true)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    throw new Error(
      `${message}\nLast caret visibility snapshot: ${JSON.stringify(
        lastSnapshot,
        null,
        2
      )}`
    )
  }
}

const assertNoVisibleCaretInRoot = async (root: Locator) => {
  let lastSnapshot: CaretVisibilitySnapshot | null = null

  try {
    await expect
      .poll(async () => {
        lastSnapshot = await takeCaretVisibilitySnapshot(root)

        return {
          rootContainsActiveElement: lastSnapshot.rootContainsActiveElement,
          visible: lastSnapshot.visible,
        }
      })
      .toEqual({
        rootContainsActiveElement: false,
        visible: false,
      })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    throw new Error(
      `${message}\nLast caret visibility snapshot: ${JSON.stringify(
        lastSnapshot,
        null,
        2
      )}`
    )
  }
}

/** Assert the caret is visible inside its scrollable ancestor. */
export const assertSlateBrowserCaretVisibleInScrollableParent = async (
  editor: SlateBrowserEditorHarness
) => {
  await assertCaretVisibleInScrollableParent(editor.root)
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

    const range = selection.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    const clientRect = Array.from(range.getClientRects()).find(
      (candidate) => candidate.width > 0 || candidate.height > 0
    )
    const usableRect =
      clientRect ??
      (rect.width > 0 || rect.height > 0 ? rect : null) ??
      (() => {
        if (!range.collapsed) {
          return null
        }

        const start =
          range.startContainer.nodeType === Node.ELEMENT_NODE
            ? (range.startContainer as Element)
            : range.startContainer.parentElement

        if (!start) {
          return null
        }

        const nearestSlateRectOwner = start.closest(
          [
            '[data-slate-string]',
            '[data-slate-zero-width]',
            '[data-slate-leaf]',
            '[data-slate-node="text"]',
            '[data-slate-node="element"]',
          ].join(',')
        )

        let current: Element | null = nearestSlateRectOwner

        while (current && element.contains(current)) {
          const fallbackRect = current.getBoundingClientRect()

          if (fallbackRect.width > 0 || fallbackRect.height > 0) {
            return fallbackRect
          }

          current = current.parentElement
        }

        return null
      })()

    if (!usableRect) {
      return null
    }

    return {
      x: usableRect.x,
      y: usableRect.y,
      width: usableRect.width,
      height: usableRect.height,
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

/** Capture the current DOM selection from a Playwright page. */
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

const takeResolvedDOMSelectionSnapshotForRoot = async (
  root: Locator
): Promise<SelectionSnapshot | null> =>
  root.evaluate(
    (element: HTMLElement, { key }: { key: string }) => {
      const handle = (element as Record<string, any>)[key]
      const selection = handle?.getDOMSelection?.()

      if (!selection) {
        return null
      }

      return {
        anchor: {
          offset: selection.anchor.offset,
          path: [...selection.anchor.path],
        },
        focus: {
          offset: selection.focus.offset,
          path: [...selection.focus.path],
        },
      }
    },
    { key: SLATE_BROWSER_HANDLE_KEY }
  )

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

/** Capture the current Slate model selection from a Playwright page. */
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

const waitForSelectionSync = async (
  root: Locator,
  expectedSelection?: SelectionSnapshot
) => {
  const readSyncState = () =>
    root.evaluate(
      (
        element: HTMLElement,
        {
          expectedSelection,
          key,
        }: { expectedSelection?: SelectionSnapshot; key: string }
      ) => {
        const pointsEqual = (
          left: SelectionPoint | null | undefined,
          right: SelectionPoint | null | undefined
        ) =>
          !!left &&
          !!right &&
          left.offset === right.offset &&
          left.path.length === right.path.length &&
          left.path.every((part, index) => part === right.path[index])
        const selectionsEqual = (
          left: SelectionSnapshot | null | undefined,
          right: SelectionSnapshot | null | undefined
        ) =>
          !!left &&
          !!right &&
          pointsEqual(left.anchor, right.anchor) &&
          pointsEqual(left.focus, right.focus)
        const rootNode = element.getRootNode() as Document | ShadowRoot
        const selection =
          'getSelection' in rootNode
            ? rootNode.getSelection()
            : element.ownerDocument.getSelection()
        const nativeSelectionInRoot = Boolean(
          selection?.rangeCount &&
            selection.anchorNode &&
            selection.focusNode &&
            element.contains(selection.anchorNode) &&
            element.contains(selection.focusNode)
        )
        const getNativeSelectionSnapshot = () => {
          if (
            !selection?.rangeCount ||
            !selection.anchorNode ||
            !selection.focusNode ||
            !element.contains(selection.anchorNode) ||
            !element.contains(selection.focusNode)
          ) {
            return null
          }

          const getTextSegments = (owner: Element) =>
            Array.from(
              owner.querySelectorAll(
                '[data-slate-string], [data-slate-zero-width]'
              )
            ).map((segment) => {
              const leafNode = segment.firstChild
              const domLength = leafNode?.textContent?.length ?? 0
              const attr = segment.getAttribute('data-slate-length')
              const trueLength =
                attr == null ? domLength : Number.parseInt(attr, 10)

              return {
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
                .reduce((total, entry) => total + entry.trueLength, 0) +
              localOffset
            )
          }

          const getPath = (node: Node | null) => {
            const owner =
              node?.nodeType === 1
                ? (node as Element).closest('[data-slate-node="text"]')
                : node?.parentElement?.closest('[data-slate-node="text"]')

            if (!owner || !element.contains(owner)) {
              return null
            }

            const path = owner
              .getAttribute('data-slate-path')
              ?.split(',')
              .map((part) => Number.parseInt(part, 10))

            return path?.every(Number.isInteger) ? path : null
          }

          const anchorPath = getPath(selection.anchorNode)
          const focusPath = getPath(selection.focusNode)

          if (!anchorPath || !focusPath) {
            return null
          }

          return {
            anchor: {
              offset: toEditorOffset(
                selection.anchorNode,
                selection.anchorOffset
              ),
              path: anchorPath,
            },
            focus: {
              offset: toEditorOffset(
                selection.focusNode,
                selection.focusOffset
              ),
              path: focusPath,
            },
          }
        }

        const handle = (element as Record<string, any>)[key]
        const handleSelection =
          typeof handle?.getSelection === 'function'
            ? handle.getSelection()
            : null

        const nativeSelection = getNativeSelectionSnapshot()
        const modelBackedSelection =
          element.getAttribute('data-slate-dom-strategy-selection') ===
            'partial-dom-backed' ||
          !!element.querySelector('[data-slate-view-selection="true"]')
        const synced = expectedSelection
          ? handle?.getSelection
            ? selectionsEqual(handleSelection, expectedSelection) &&
              (modelBackedSelection ||
                selectionsEqual(nativeSelection, expectedSelection))
            : selectionsEqual(nativeSelection, expectedSelection)
          : nativeSelectionInRoot || (modelBackedSelection && !!handleSelection)

        return {
          expectedSelection,
          handleSelection,
          modelBackedSelection,
          nativeSelection,
          nativeSelectionInRoot,
          synced,
        }
      },
      { expectedSelection, key: SLATE_BROWSER_HANDLE_KEY }
    )

  await expect
    .poll(() => readSyncState())
    .toMatchObject({ synced: true })
    .catch(async (error: unknown) => {
      const state = await readSyncState().catch((stateError: unknown) => ({
        error:
          stateError instanceof Error ? stateError.message : String(stateError),
      }))

      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\nSelection sync state:\n${JSON.stringify(state, null, 2)}`
      )
    })
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

const waitForHandleFocus = async (root: Locator) => {
  await expect
    .poll(() =>
      root.evaluate(
        (element: HTMLElement, { key }: { key: string }) => {
          const handle = (element as Record<string, any>)[key]
          const rootNode = element.getRootNode() as Document | ShadowRoot
          const activeElement =
            'activeElement' in rootNode
              ? rootNode.activeElement
              : element.ownerDocument.activeElement

          const hasFocus =
            activeElement === element ||
            (!!activeElement && element.contains(activeElement))

          return hasFocus && !!handle?.getSelection?.()
        },
        { key: SLATE_BROWSER_HANDLE_KEY }
      )
    )
    .toBe(true)
}

const waitForSelectionRange = async (root: Locator) => {
  await expect
    .poll(() =>
      root.evaluate((element: HTMLElement) => {
        const rootNode = element.getRootNode() as Document | ShadowRoot
        const rootSelection =
          'getSelection' in rootNode
            ? rootNode.getSelection()
            : element.ownerDocument.getSelection()
        const documentSelection = element.ownerDocument.getSelection()

        return (
          (rootSelection?.rangeCount ?? 0) > 0 ||
          (documentSelection?.rangeCount ?? 0) > 0
        )
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

const focusWithHandle = async (root: Locator) =>
  root.evaluate(
    (element: HTMLElement, { key }: { key: string }) => {
      const handle = (element as Record<string, any>)[key]

      if (!handle?.focus) {
        return false
      }

      handle.focus()
      return true
    },
    { key: SLATE_BROWSER_HANDLE_KEY }
  )

const setSelection = async (root: Locator, selection: SelectionSnapshot) => {
  await root.evaluate((element: HTMLElement, expected) => {
    const textNodes = Array.from(
      element.querySelectorAll('[data-slate-node="text"]')
    ).filter((node) => node.closest('[data-slate-editor="true"]') === element)

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
  return root.evaluate(
    (element: HTMLElement, payload) => {
      const { key, selection: nextSelection } = payload
      const handle = (element as Record<string, any>)[key]

      if (handle?.setNativeDOMSelection?.(nextSelection)) {
        return true
      }

      const selectionPointToDOMPoint = (point: SelectionPoint) => {
        const textElements = Array.from(
          element.querySelectorAll('[data-slate-node="text"]')
        ).filter(
          (node) => node.closest('[data-slate-editor="true"]') === element
        )
        const textElement = textElements.find(
          (node) =>
            node.getAttribute('data-slate-path') === point.path.join(',')
        )

        if (!textElement) {
          return null
        }

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

          if (
            stringElement.hasAttribute('data-slate-zero-width') &&
            point.offset === start &&
            length <= 1
          ) {
            return {
              node: textNode,
              offset: length,
            }
          }

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

        return {
          node: textElement,
          offset: textElement.childNodes.length,
        }
      }

      const anchor = selectionPointToDOMPoint(nextSelection.anchor)
      const focus = selectionPointToDOMPoint(nextSelection.focus)

      if (!anchor || !focus) {
        return false
      }

      const range = element.ownerDocument.createRange()

      range.setStart(anchor.node, anchor.offset)
      range.setEnd(focus.node, focus.offset)

      const rootNode = element.getRootNode() as Document | ShadowRoot
      const domSelection =
        'getSelection' in rootNode
          ? rootNode.getSelection()
          : element.ownerDocument.getSelection()

      if (!domSelection) {
        return false
      }

      element.focus()
      domSelection.removeAllRanges()
      domSelection.addRange(range)
      element.ownerDocument.dispatchEvent(
        new Event('selectionchange', { bubbles: true })
      )

      if (rootNode instanceof ShadowRoot) {
        rootNode.dispatchEvent(new Event('selectionchange', { bubbles: true }))
      }

      return domSelection.rangeCount > 0
    },
    { key: SLATE_BROWSER_HANDLE_KEY, selection }
  )
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

const dragTextRange = async (
  root: Locator,
  {
    direction = 'forward',
    endAffinity = 'inside',
    endOffset,
    endText,
    endTextNodeIndex,
    settleMs = 0,
    startOffset,
    steps = 16,
    text,
    textNodeIndex = 0,
  }: SlateBrowserDragTextRangeOptions
) => {
  const points = await root.evaluate(
    (
      element,
      {
        endAffinity,
        endOffset,
        endText,
        endTextNodeIndex,
        startOffset,
        text,
        textNodeIndex,
      }: Omit<SlateBrowserDragTextRangeOptions, 'settleMs' | 'steps'> & {
        endAffinity: NonNullable<
          SlateBrowserDragTextRangeOptions['endAffinity']
        >
        textNodeIndex: number
      }
    ) => {
      const ownerDocument = element.ownerDocument
      const walker = ownerDocument.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT
      )
      const matches: Node[] = []

      while (walker.nextNode()) {
        matches.push(walker.currentNode)
      }

      const findTextNode = (targetText: string, targetIndex: number) => {
        const targetMatches = matches.filter(
          (node) => node.textContent === targetText
        )
        const target = targetMatches[targetIndex]

        if (!target) {
          throw new Error(`Text node not found for drag range: ${targetText}`)
        }

        return target
      }
      const startNode = findTextNode(text, textNodeIndex)
      const resolvedEndText = endText ?? text
      const resolvedEndTextNodeIndex = endTextNodeIndex ?? textNodeIndex
      const endNode = findTextNode(resolvedEndText, resolvedEndTextNodeIndex)

      if (startNode === endNode && startOffset > endOffset) {
        throw new Error('dragTextRange expects startOffset <= endOffset')
      }
      const pointAt = (
        node: Node,
        offset: number,
        affinity: 'end' | 'start'
      ) => {
        const textLength = node.textContent?.length ?? 0

        if (textLength === 0) {
          throw new Error('Text range has no selectable rect')
        }

        const range = ownerDocument.createRange()
        const charIndex =
          affinity === 'end'
            ? Math.max(0, Math.min(offset - 1, textLength - 1))
            : Math.max(0, Math.min(offset, textLength - 1))

        range.setStart(node, charIndex)
        range.setEnd(node, Math.min(textLength, charIndex + 1))

        const rect = range.getClientRects()[0] ?? range.getBoundingClientRect()

        if (!rect || rect.width <= 0 || rect.height <= 0) {
          throw new Error('Text range has no selectable rect')
        }

        if (affinity === 'start') {
          return {
            x: rect.left + 1,
            y: rect.top + rect.height / 2,
          }
        }

        const shouldEndAfterText =
          endAffinity === 'after' && offset >= textLength

        return {
          x: shouldEndAfterText
            ? rect.right + 2
            : Math.max(rect.left + 1, rect.right - 1),
          y: rect.top + rect.height / 2,
        }
      }
      const start = pointAt(startNode, startOffset, 'start')
      const end = pointAt(endNode, endOffset, 'end')

      return {
        endX: end.x,
        endY: end.y,
        startX: start.x,
        startY: start.y,
      }
    },
    {
      endAffinity,
      endOffset,
      endText,
      endTextNodeIndex,
      startOffset,
      text,
      textNodeIndex,
    }
  )
  const page = root.page()

  const startPoint =
    direction === 'backward'
      ? { x: points.endX, y: points.endY }
      : { x: points.startX, y: points.startY }
  const endPoint =
    direction === 'backward'
      ? { x: points.startX, y: points.startY }
      : { x: points.endX, y: points.endY }

  await page.mouse.move(startPoint.x, startPoint.y)
  await page.mouse.down()
  await page.mouse.move(endPoint.x, endPoint.y, { steps })
  if (settleMs > 0) {
    await page.waitForTimeout(settleMs)
  }
  await page.mouse.up()
}

const doubleClickDragTextRange = async (
  root: Locator,
  {
    doubleClickOffset,
    endOffset,
    gestureDelayMs = 35,
    steps = 16,
    text,
    textNodeIndex = 0,
  }: SlateBrowserDoubleClickDragTextRangeOptions
) => {
  const points = await root.evaluate(
    (
      element,
      {
        doubleClickOffset,
        endOffset,
        text,
        textNodeIndex,
      }: Required<
        Pick<
          SlateBrowserDoubleClickDragTextRangeOptions,
          'doubleClickOffset' | 'endOffset' | 'text' | 'textNodeIndex'
        >
      >
    ) => {
      const ownerDocument = element.ownerDocument
      const walker = ownerDocument.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT
      )
      const matches: Node[] = []

      while (walker.nextNode()) {
        if (walker.currentNode.textContent === text) {
          matches.push(walker.currentNode)
        }
      }

      const textNode = matches[textNodeIndex]

      if (!textNode) {
        throw new Error(`Text node not found for double-click drag: ${text}`)
      }

      const textLength = textNode.textContent?.length ?? 0

      if (textLength === 0) {
        throw new Error('Cannot double-click drag an empty text node')
      }

      const clampOffset = (offset: number) =>
        Math.max(0, Math.min(offset, textLength))
      const pointAt = (
        offset: number,
        affinity: 'anchor' | 'end' | 'start'
      ) => {
        const safeOffset = clampOffset(offset)
        const probeStart =
          affinity === 'end'
            ? Math.max(0, Math.min(safeOffset - 1, textLength - 1))
            : Math.max(0, Math.min(safeOffset, textLength - 1))
        const probeEnd = Math.min(textLength, probeStart + 1)
        const range = ownerDocument.createRange()

        range.setStart(textNode, probeStart)
        range.setEnd(textNode, probeEnd)

        const rect = range.getClientRects()[0] ?? range.getBoundingClientRect()

        if (!rect || rect.width <= 0 || rect.height <= 0) {
          throw new Error(
            `Text offset has no selectable rect: ${text} @ ${offset}`
          )
        }

        const x =
          affinity === 'anchor'
            ? rect.left + rect.width / 2
            : affinity === 'end'
              ? Math.max(rect.left + 1, rect.right - 1)
              : rect.left + 1

        return {
          x,
          y: rect.top + rect.height / 2,
        }
      }
      const forward = endOffset >= doubleClickOffset

      textNode.parentElement?.scrollIntoView({
        block: 'center',
        inline: 'nearest',
      })

      return {
        end: pointAt(endOffset, forward ? 'end' : 'start'),
        start: pointAt(doubleClickOffset, 'anchor'),
      }
    },
    { doubleClickOffset, endOffset, text, textNodeIndex }
  )
  const page = root.page()

  await page.mouse.move(points.start.x, points.start.y)
  await page.mouse.down()
  await page.mouse.up()
  await page.waitForTimeout(gestureDelayMs)
  await page.mouse.down({ clickCount: 2 })
  await page.waitForTimeout(gestureDelayMs)
  await page.mouse.move(points.end.x, points.end.y, { steps })
  await page.mouse.up({ clickCount: 2 })
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
      modelBlockText: async (index) =>
        root.evaluate(
          (
            element: HTMLElement,
            { index, key }: { index: number; key: string }
          ) => {
            const handle = (element as Record<string, any>)[key]

            if (!handle?.getBlockText) {
              throw new Error(
                'This editor surface does not expose getBlockText'
              )
            }

            return handle.getBlockText(index)
          },
          { index, key: SLATE_BROWSER_HANDLE_KEY }
        ),
      modelBlockTexts: async () =>
        root.evaluate(
          (element: HTMLElement, { key }: { key: string }) => {
            const handle = (element as Record<string, any>)[key]

            if (!handle?.getBlockTexts) {
              throw new Error(
                'This editor surface does not expose getBlockTexts'
              )
            }

            return handle.getBlockTexts()
          },
          { key: SLATE_BROWSER_HANDLE_KEY }
        ),
      text: async () => (await root.textContent()) ?? '',
      blockTexts: async () => getBlockTexts(root),
      renderedDOMShape: async () => getRenderedBlockDOMShapes(root),
      selectedText: async () => getSelectedText(root),
      displayedSelection: async () =>
        takeDisplayedSelectionSnapshotForRoot(root),
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
      history: async () =>
        root.evaluate(
          (element: HTMLElement, { key }: { key: string }) => {
            const handle = (element as Record<string, any>)[key]

            return handle?.getHistory ? handle.getHistory() : null
          },
          { key: SLATE_BROWSER_HANDLE_KEY }
        ),
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

          if (await supportsRootScopedSelection(root)) {
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
          }
        } else {
          await waitForSelectionRange(root)
        }
        await harness.assert.selection(selection)
      },
      selectDOM: async (selection: SelectionSnapshot) => {
        await page.waitForTimeout(0)
        if (!(await setDOMSelection(root, selection))) {
          throw new Error(
            `Missing DOM text node for ${selection.anchor.path.join('.')} or ${selection.focus.path.join('.')}`
          )
        }
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
          await root.evaluate(
            (element: HTMLElement, { key }: { key: string }) => {
              const handle = (element as Record<string, any>)[key]

              if (!handle?.importDOMSelection) {
                return
              }

              handle.importDOMSelection()
            },
            { key: SLATE_BROWSER_HANDLE_KEY }
          )
          await page.waitForTimeout(0)
          await root.evaluate(
            (element: HTMLElement, { key }: { key: string }) => {
              const handle = (element as Record<string, any>)[key]

              if (!handle?.importDOMSelection) {
                return
              }

              handle.importDOMSelection()
            },
            { key: SLATE_BROWSER_HANDLE_KEY }
          )
          if (!(await handleSelectionMatches(root, selection))) {
            await setSelectionWithHandle(root, selection)
            await page.waitForTimeout(0)
            if (!(await setDOMSelection(root, selection))) {
              throw new Error(
                `Missing DOM text node for ${selection.anchor.path.join('.')} or ${selection.focus.path.join('.')}`
              )
            }
            await root.evaluate(
              (element: HTMLElement, { key }: { key: string }) => {
                const handle = (element as Record<string, any>)[key]

                if (!handle?.importDOMSelection) {
                  return
                }

                handle.importDOMSelection()
              },
              { key: SLATE_BROWSER_HANDLE_KEY }
            )
          }
          await waitForHandleSelection(root, selection)
        }
      },
      dragTextRange: async (options: SlateBrowserDragTextRangeOptions) => {
        await dragTextRange(root, options)
      },
      doubleClickDragTextRange: async (
        options: SlateBrowserDoubleClickDragTextRangeOptions
      ) => {
        await doubleClickDragTextRange(root, options)
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
        const expectedSelection = selectedWithHandle
          ? await takeSelectionSnapshotForRoot(root)
          : null

        if (!selectedWithHandle) {
          await harness.focus()
          await page.keyboard.press('ControlOrMeta+A')
        }

        await waitForSelectionSync(root, expectedSelection ?? undefined)
      },
      get: async () => takeSelectionSnapshotForRoot(root),
      displayed: async () => takeDisplayedSelectionSnapshotForRoot(root),
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
    dom: {
      clickTextOffset: async ({
        clickCount,
        offset,
        path,
        waitForSelectionSync,
      }) => {
        await clickTextOffset(root, path, offset, {
          clickCount,
          waitForSelectionSync,
        })
      },
      clickTextRange: async (options) => {
        await clickTextPathRange(root, options)
      },
      collapseAtTextPath: async (point, options) => {
        await collapseDOMAtTextPath(root, point, options)
      },
      waitForPendingNativeTextInputRepair: async (options) => {
        await waitForPendingNativeTextInputRepair(root, options)
      },
      waitForTextPath: async (path, options) => {
        await waitForTextPathMaterialized(root, path, options)
      },
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
      history: await harness.get.history(),
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

      const focusedWithHandle =
        (await waitForSelectionHandle(root)) && (await focusWithHandle(root))

      if (focusedWithHandle) {
        await waitForHandleFocus(root)

        if (await hasDOMSelectionInRoot(root)) {
          await waitForSelectionSync(root)
        }

        return
      }

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
      const shouldUseSemanticKeyTransport =
        !syntheticShortcut &&
        !(await hasDOMSelectionInRoot(root)) &&
        (await waitForSelectionHandle(root))
      const semanticKey = shouldUseSemanticKeyTransport
        ? parsePlainSyntheticKey(key)
        : null

      if (syntheticShortcut) {
        await dispatchSyntheticKey(root, syntheticShortcut)
        return
      }

      if (semanticKey) {
        await dispatchSyntheticKey(root, semanticKey)
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
      modelBlockText: async (index: number, text: string | null) => {
        await expect.poll(() => harness.get.modelBlockText(index)).toBe(text)
      },
      modelBlockTexts: async (texts: string[]) => {
        await expect.poll(() => harness.get.modelBlockTexts()).toEqual(texts)
      },
      blockTexts: async (texts: string[]) => {
        await expect.poll(() => getBlockTexts(root)).toEqual(texts)
      },
      html: async (
        expectedHtml: string,
        options: HtmlNormalizationOptions = {}
      ) => {
        await harness.assert.htmlEquals(expectedHtml, options)
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
      collapsedModelDOMSelection: async (
        expected: CollapsedModelDOMSelectionExpectation
      ) => {
        await assertCollapsedModelDOMSelectionExpectation(root, expected)
      },
      noDoubleSelectionHighlight: async () => {
        await expect
          .poll(async () => {
            const snapshot = await takeDisplayedSelectionSnapshotForRoot(root)

            return snapshot.doubleHighlighted
          })
          .toBe(false)
      },
      caretVisibleInScrollableParent: async () => {
        await assertCaretVisibleInScrollableParent(root)
      },
      noVisibleCaretInRoot: async () => {
        await assertNoVisibleCaretInRoot(root)
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
      cutEventPayload: async () => cutPayloadThroughEvent(root),
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
      pasteEventPayload: async (payload: {
        html?: string | null
        slateFragment?: string | null
        text: string
      }) => {
        await pastePayloadThroughEvent(root, payload)
      },
      pasteNativeText: async (text: string) => {
        await withExclusiveClipboardAccess(async () => {
          await writeClipboardText(surface, text)
          await root.press('ControlOrMeta+V')
          await page.waitForTimeout(50)
        })
      },
      pasteText: async (text: string) => {
        await withExclusiveClipboardAccess(async () => {
          const beforeSelectedText = await harness.get.selectedText()
          const beforeSelection = await harness.selection.get()
          const beforeText = await harness.get.modelText()
          const beforeTraceLength = (await harness.get.kernelTrace()).length

          await harness.focus()

          try {
            await writeClipboardText(surface, text)
          } catch {
            await insertDataThroughHandle(root, { text })
            return
          }

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

          await harness.focus()

          if (await shouldUseSyntheticHtmlPaste(surface)) {
            await pastePayloadThroughEvent(root, { html, text })
            return
          }

          try {
            await writeClipboardHtml(surface, html, text)
          } catch {
            await insertDataThroughHandle(root, { html, text })
            return
          }

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
      startSynthetic: async ({ text = '' } = {}) => {
        await enableCompositionKeyEvents(surface)
        await startSyntheticComposition(surface, text)
      },
      updateSynthetic: async ({ text }) => {
        await updateSyntheticComposition(surface, text)
      },
      commitSynthetic: async ({ text }) => {
        await commitSyntheticCompositionText(surface, text)
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
                const budgetLabel = (label: string) =>
                  `${label} ${JSON.stringify({
                    byKey: snapshot.byKey,
                    byKind: snapshot.byKind,
                    events: snapshot.events,
                  })}`

                if (step.budget.total !== undefined) {
                  assertNumberBudget(
                    snapshot.total,
                    step.budget.total,
                    budgetLabel('render total')
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
                    budgetLabel(`render kind ${kind}`)
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
                {
                  const actualBlockTexts = (
                    await harness.get.blockTexts()
                  ).slice(step.startIndex ?? 0)

                  expect(
                    actualBlockTexts,
                    JSON.stringify({
                      actualBlockTexts,
                      domSelection: await harness.get.domSelection(),
                      expectedBlockTexts: step.texts,
                      inputState: await root.evaluate(
                        (element: HTMLElement, { key }: { key: string }) => {
                          const handle = (element as Record<string, any>)[key]

                          return handle?.getInputState?.() ?? null
                        },
                        { key: SLATE_BROWSER_HANDLE_KEY }
                      ),
                      kernelTrace: await harness.get.kernelTrace(),
                      selection: await harness.selection.get(),
                    })
                  ).toEqual(step.texts)
                }
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
                await expect.poll(() => harness.get.lastCommit()).toBeTruthy()
                break
              case 'assertLastCommitTags': {
                await expect
                  .poll(async () => {
                    const lastCommit = (await harness.get.lastCommit()) as {
                      tags?: readonly string[]
                    } | null

                    return lastCommit?.tags
                  })
                  .toEqual(step.tags)
                break
              }
              case 'assertLastCommitCommand': {
                await expect
                  .poll(async () => {
                    const lastCommit = (await harness.get.lastCommit()) as {
                      command?: { origin?: string; type?: string } | null
                    } | null

                    return lastCommit?.command
                  })
                  .toEqual(step.command)
                break
              }
              case 'assertModelText':
                await expect
                  .poll(() => harness.get.modelText())
                  .toContain(step.text)
                break
              case 'assertLocatorText': {
                const locator = page.locator(step.selector).first()
                const getText = async () =>
                  ((await locator.textContent()) ?? '').replace(/\uFEFF/g, '')

                if (step.text !== undefined) {
                  await expect.poll(getText).toBe(step.text)
                }
                if (step.contains !== undefined) {
                  await expect.poll(getText).toContain(step.contains)
                }
                break
              }
              case 'assertSelection':
                await harness.assert.selection(step.selection)
                break
              case 'assertSelectionContract':
                await assertSlateBrowserSelectionContract(
                  harness,
                  step.expectation
                )
                break
              case 'assertSelectionLocation':
                await expect
                  .poll(() => harness.selection.location())
                  .toMatchObject(step.location)
                break
              case 'assertSelectedText':
                await expect
                  .poll(() => harness.get.selectedText())
                  .toBe(step.text)
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
                if (step.selectedText === undefined) {
                  await clickTextOffset(root, step.path, step.offset, {
                    clickCount: 2,
                  })
                } else {
                  const retryDelayMs = 650
                  let lastError: unknown = null

                  for (let attempt = 0; attempt < 3; attempt++) {
                    await clickTextOffset(root, step.path, step.offset, {
                      clickCount: 2,
                    })

                    try {
                      await expect
                        .poll(() => harness.get.selectedText(), {
                          timeout: 1500,
                        })
                        .toBe(step.selectedText)
                      lastError = null
                      break
                    } catch (error) {
                      lastError = error

                      // Firefox can fold rapid repeated double-click attempts
                      // into one multi-click gesture. Wait past that window
                      // before retrying the proof gesture.
                      if (attempt < 2) {
                        await root.page().waitForTimeout(retryDelayMs)
                      }
                    }
                  }

                  if (lastError) {
                    const displayedSelection =
                      await harness.selection.displayed()
                    const windowSelectionText = await page.evaluate(
                      () => window.getSelection()?.toString() ?? ''
                    )
                    const selectedText = await harness.get.selectedText()
                    const selection = await harness.selection.get()
                    const domSelection = await harness.get.domSelection()

                    throw new Error(
                      `Double-click text selection did not settle on ${JSON.stringify(
                        step.selectedText
                      )}.\nSelected text: ${JSON.stringify(
                        selectedText
                      )}\nWindow selection text: ${JSON.stringify(
                        windowSelectionText
                      )}\nSelection: ${JSON.stringify(
                        selection
                      )}\nDOM selection: ${JSON.stringify(
                        domSelection
                      )}\nDisplayed selection: ${JSON.stringify(
                        displayedSelection
                      )}\n${lastError instanceof Error ? lastError.message : String(lastError)}`
                    )
                  }
                }
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
              case 'mutateTextDOM':
                await mutateTextDOM(root, step)
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
                await expect
                  .poll(() => harness.get.modelText())
                  .toContain(step.expectedModelTextAfterType)

                const hotkey = await page.evaluate(() =>
                  navigator.userAgent.includes('Mac OS X')
                    ? 'Meta+Z'
                    : 'Control+Z'
                )

                await harness.press(hotkey)
                await assertDOMCaretExpectation(root, step.caretAfterUndo)
                await expect
                  .poll(() => harness.get.modelText())
                  .toContain(step.expectedModelTextAfterUndo)
                break
              }
              case 'type':
                await harness.type(step.text)
                break
              case 'undo': {
                if (step.expectedModelTextBefore) {
                  await expect
                    .poll(() => harness.get.modelText())
                    .toContain(step.expectedModelTextBefore)
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

/** Create a Playwright harness for opening examples and inspecting editors. */
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

/** Capture editor render state, selected shells, and selection shells. */
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

/** Open a Slate example route with default harness options. */
export const openExample = async (
  page: Page,
  name: string,
  options: OpenExampleOptions = {}
) => openExampleWithOptions(page, name, options)

/** Open a Slate example route with explicit harness options. */
export const openExampleWithOptions = async (
  page: Page,
  name: string,
  { query, ready, surface }: OpenExampleOptions
) => {
  if (!EXAMPLE_FONT_ROUTES.has(page)) {
    EXAMPLE_FONT_ROUTES.add(page)
    await Promise.all([
      page.route('https://fonts.googleapis.com/**', (route) =>
        route.fulfill({
          body: '',
          contentType: 'text/css',
          status: 200,
        })
      ),
      page.route('https://fonts.gstatic.com/**', (route) =>
        route.fulfill({
          body: '',
          contentType: 'font/woff2',
          status: 200,
        })
      ),
    ])
  }

  const examplePath = `/examples/${name}`
  const exampleUrl = `${baseUrl}${examplePath}${formatExampleQuery(query)}`
  const currentUrl = page.url()
  const currentPath =
    currentUrl && currentUrl !== 'about:blank'
      ? new URL(currentUrl).pathname
      : null

  if (query && currentPath === examplePath) {
    await page.goto('about:blank', { waitUntil: 'commit' })
  }

  await page.goto(exampleUrl, {
    waitUntil: 'commit',
  })
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
