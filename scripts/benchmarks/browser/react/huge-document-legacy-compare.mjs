import { resolve } from 'node:path'

import {
  benchmarkRepo,
  buildRepo,
  parsePackageManager,
} from '../../shared/repo-compare.mjs'
import { round, writeBenchmarkArtifact } from '../../shared/stats.mjs'

const currentRepo = process.cwd()
const legacyRepo = resolve(
  currentRepo,
  process.env.REACT_HUGE_COMPARE_LEGACY_REPO || '../slate'
)

const iterations = Number(process.env.REACT_HUGE_COMPARE_ITERATIONS || 3)
const blocks = Number(process.env.REACT_HUGE_COMPARE_BLOCKS || 5000)
const chunkSize = Number(process.env.REACT_HUGE_COMPARE_CHUNK_SIZE || 1000)
const islandSize = Number(process.env.REACT_HUGE_COMPARE_ISLAND_SIZE || 100)
const activeRadius = Number(process.env.REACT_HUGE_COMPARE_ACTIVE_RADIUS || 0)
const rootGroupSize = 50
const typeOps = Number(process.env.REACT_HUGE_COMPARE_TYPE_OPS || 20)
const profile = process.env.REACT_HUGE_COMPARE_PROFILE === '1'
const compareMode = process.env.REACT_HUGE_COMPARE_MODE || 'compare'
const readyOnly = process.env.REACT_HUGE_COMPARE_READY_ONLY === '1'
const skipBuild = process.env.REACT_HUGE_COMPARE_SKIP_BUILD === '1'
const splitSelectionLanes =
  process.env.REACT_HUGE_COMPARE_SPLIT_SELECTION === '1'
const disposeDelayMs = Number(
  process.env.REACT_HUGE_COMPARE_DISPOSE_DELAY_MS || 500
)
const pasteText = 'replacement marker'
const createPasteFragment = () => [
  {
    type: 'paragraph',
    children: [{ text: pasteText }],
  },
]
const currentJsdomRequireFrom = resolve(
  currentRepo,
  'packages/slate-react/package.json'
)

const sharedSource = `
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import React from 'react'
import { createRoot } from 'react-dom/client'
import TestUtils from 'react-dom/test-utils'
import * as SlateCore from 'slate'
import { withReact } from 'slate-react'

const { createEditor, Editor } = SlateCore
const legacyTransforms = SlateCore.Transforms

const { JSDOM } = createRequire(${JSON.stringify(
  currentJsdomRequireFrom
)})('jsdom')

const iterations = Number(process.env.REACT_HUGE_COMPARE_ITERATIONS || 3)
const blocks = Number(process.env.REACT_HUGE_COMPARE_BLOCKS || 5000)
const typeOps = Number(process.env.REACT_HUGE_COMPARE_TYPE_OPS || 20)
const readyOnly = process.env.REACT_HUGE_COMPARE_READY_ONLY === '1'
const splitSelectionLanes =
  process.env.REACT_HUGE_COMPARE_SPLIT_SELECTION === '1'
const disposeDelayMs = Number(process.env.REACT_HUGE_COMPARE_DISPOSE_DELAY_MS || 500)
const pasteText = ${JSON.stringify(pasteText)}
const modelOwnedBeforeInputText = '@'
const createPasteFragment = ${createPasteFragment.toString()}

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const originalConsoleError = console.error.bind(console)

console.error = (...args) => {
  const message = String(args[0] ?? '')

  if (
    message.includes('not wrapped in act') ||
    message.includes('not configured to support act')
  ) {
    return
  }

  originalConsoleError(...args)
}

const act = React.act ?? TestUtils.act

const now = () => performance.now()
const round = (value) => Number(value.toFixed(2))
const settleBenchmark = () => new Promise((resolve) => setTimeout(resolve, 0))

const recordBenchmarkProfileDuration = (id, duration) => {
  globalThis.__SLATE_REACT_RENDER_PROFILER__?.record?.({
    duration,
    id,
    kind: 'benchmark-time',
  })
}

const profileBenchmarkDuration = (id, callback) => {
  if (!globalThis.__SLATE_REACT_RENDER_PROFILER__) {
    return callback()
  }

  const start = now()

  try {
    return callback()
  } finally {
    recordBenchmarkProfileDuration(id, now() - start)
  }
}

const profileBenchmarkDurationAsync = async (id, callback) => {
  if (!globalThis.__SLATE_REACT_RENDER_PROFILER__) {
    return callback()
  }

  const start = now()

  try {
    return await callback()
  } finally {
    recordBenchmarkProfileDuration(id, now() - start)
  }
}

const getSelection = (editor) =>
  typeof editor.read === 'function'
    ? editor.read((state) => state.selection.get())
    : typeof editor.getSelection === 'function'
      ? editor.getSelection()
      : editor.selection

const select = (editor, target) => {
  if (typeof editor.update === 'function') {
    profileBenchmarkDuration('editor-update-selection-set', () => {
      editor.update((tx) => {
        tx.selection.set(target)
      })
    })
    return
  }

  legacyTransforms.select(editor, target)
}

const insertText = (editor, text, options) => {
  if (typeof editor.update === 'function') {
    profileBenchmarkDuration('editor-update-text-insert', () => {
      editor.update((tx) => {
        tx.text.insert(text, options)
      })
    })
    return
  }

  legacyTransforms.insertText(editor, text, options)
}

const insertFragment = (editor, fragment) => {
  if (typeof editor.update === 'function') {
    profileBenchmarkDuration('editor-update-fragment-insert', () => {
      editor.update((tx) => {
        tx.fragment.insert(fragment)
      })
    })
    return
  }

  legacyTransforms.insertFragment(editor, fragment)
}

const getEditableRoot = (container) => {
  const root = container.querySelector('[data-slate-editor="true"]')

  if (!root) {
    throw new Error('Missing editable root')
  }

  return root
}

const createTextInputEvent = (dom, type, text) => {
  const EventConstructor =
    typeof dom.window.InputEvent === 'function'
      ? dom.window.InputEvent
      : dom.window.Event
  let event

  try {
    event = new EventConstructor(type, {
      bubbles: true,
      cancelable: true,
      data: text,
      inputType: 'insertText',
    })
  } catch {
    event = new dom.window.Event(type, {
      bubbles: true,
      cancelable: true,
    })
  }

  Object.defineProperty(event, 'data', {
    configurable: true,
    value: text,
  })
  Object.defineProperty(event, 'dataTransfer', {
    configurable: true,
    value: null,
  })
  Object.defineProperty(event, 'inputType', {
    configurable: true,
    value: 'insertText',
  })
  Object.defineProperty(event, 'getTargetRanges', {
    configurable: true,
    value: () => [],
  })

  return event
}

// Use a character outside the currently native-eligible input set so this lane
// measures Slate's model-owned beforeinput path instead of pretending jsdom can
// perform a real browser-native DOM insertion.
const dispatchModelOwnedBeforeInputText = ({ dom, target, text }) => {
  const beforeInput = createTextInputEvent(dom, 'beforeinput', text)
  target.dispatchEvent(beforeInput)
}

const getCurrentSelectionTextEventTarget = ({ blockIndex, dom, root }) => {
  const handle = root.__slateBrowserHandle
  const selection = handle?.getSelection?.()

  if (
    !handle ||
    !selection ||
    selection.anchor.path.length !== selection.focus.path.length ||
    selection.anchor.path.some((part, index) => part !== selection.focus.path[index])
  ) {
    return null
  }

  const runtimeId = handle.getRuntimeId(selection.anchor.path)
  const escapedRuntimeId =
    runtimeId && dom.window.CSS?.escape
      ? dom.window.CSS.escape(runtimeId)
      : runtimeId?.replace(/"/g, '\\"')
  let textHost = handle.getElementByPath?.(selection.anchor.path) ?? null

  textHost ??= escapedRuntimeId
    ? root.querySelector(
        '[data-slate-runtime-id="' + escapedRuntimeId + '"]'
      )
    : null

  textHost ??= Array.from(root.querySelectorAll('[data-slate-node="text"]')).find(
    (element) => element.textContent?.includes('block-' + blockIndex + ' ')
  )

  if (!textHost) {
    return null
  }

  const walker = dom.window.document.createTreeWalker(
    textHost,
    dom.window.NodeFilter.SHOW_TEXT
  )

  return walker.nextNode() ?? textHost
}

const summarize = (samples) => {
  const sorted = [...samples].sort((left, right) => left - right)
  const mean = samples.reduce((total, sample) => total + sample, 0) / samples.length
  const middle = Math.floor(sorted.length / 2)
  const median =
    sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle]

  return {
    samples: samples.map(round),
    mean: round(mean),
    median: round(median),
    min: round(sorted[0] ?? 0),
    max: round(sorted.at(-1) ?? 0),
  }
}

const createChildren = () =>
  Array.from({ length: blocks }, (_, index) => ({
    type: index % 100 === 0 ? 'heading-one' : 'paragraph',
    children: [{ text: 'block-' + index + ' alpha beta gamma delta' }],
  }))

const installDomGlobals = (dom) => {
  const previous = {
    Document: globalThis.Document,
    Element: globalThis.Element,
    HTMLElement: globalThis.HTMLElement,
    HTMLDivElement: globalThis.HTMLDivElement,
    Node: globalThis.Node,
    Range: globalThis.Range,
    Selection: globalThis.Selection,
    ShadowRoot: globalThis.ShadowRoot,
    Text: globalThis.Text,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
    document: globalThis.document,
    navigator: globalThis.navigator,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    window: globalThis.window,
  }

  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.Document = dom.window.Document
  globalThis.Element = dom.window.Element
  globalThis.HTMLElement = dom.window.HTMLElement
  globalThis.HTMLDivElement = dom.window.HTMLDivElement
  globalThis.Node = dom.window.Node
  globalThis.Range = dom.window.Range
  globalThis.Selection = dom.window.Selection
  globalThis.ShadowRoot = dom.window.ShadowRoot
  globalThis.Text = dom.window.Text

  if (!dom.window.requestAnimationFrame) {
    dom.window.requestAnimationFrame = (callback) =>
      dom.window.setTimeout(() => callback(dom.window.performance.now()), 0)
  }

  if (!dom.window.cancelAnimationFrame) {
    dom.window.cancelAnimationFrame = (handle) => {
      dom.window.clearTimeout(handle)
    }
  }

  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
  globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)

  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: dom.window.navigator,
  })

  return () => {
    globalThis.window = previous.window
    globalThis.document = previous.document
    globalThis.Document = previous.Document
    globalThis.Element = previous.Element
    globalThis.HTMLElement = previous.HTMLElement
    globalThis.HTMLDivElement = previous.HTMLDivElement
    globalThis.Node = previous.Node
    globalThis.Range = previous.Range
    globalThis.Selection = previous.Selection
    globalThis.ShadowRoot = previous.ShadowRoot
    globalThis.Text = previous.Text
    globalThis.requestAnimationFrame = previous.requestAnimationFrame
    globalThis.cancelAnimationFrame = previous.cancelAnimationFrame

    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: previous.navigator,
    })
  }
}

const getEventListenerCaptureKey = (options) => {
  if (typeof options === 'boolean') {
    return options ? 'capture' : 'bubble'
  }

  return options?.capture ? 'capture' : 'bubble'
}

const installEventListenerCounter = (dom) => {
  const targetListeners = new WeakMap()
  const activeByType = new Map()
  const originalAddEventListener =
    dom.window.EventTarget.prototype.addEventListener
  const originalRemoveEventListener =
    dom.window.EventTarget.prototype.removeEventListener
  let activeCount = 0
  let totalAdded = 0

  const getBucket = (target, type, options) => {
    let targetMap = targetListeners.get(target)

    if (!targetMap) {
      targetMap = new Map()
      targetListeners.set(target, targetMap)
    }

    const key = String(type) + ':' + getEventListenerCaptureKey(options)
    let bucket = targetMap.get(key)

    if (!bucket) {
      bucket = new Set()
      targetMap.set(key, bucket)
    }

    return bucket
  }

  const incrementType = (type) => {
    activeByType.set(type, (activeByType.get(type) ?? 0) + 1)
  }

  const decrementType = (type) => {
    const nextCount = (activeByType.get(type) ?? 0) - 1

    if (nextCount > 0) {
      activeByType.set(type, nextCount)
    } else {
      activeByType.delete(type)
    }
  }

  dom.window.EventTarget.prototype.addEventListener = function (
    type,
    listener,
    options
  ) {
    if (listener) {
      const eventType = String(type)
      const bucket = getBucket(this, eventType, options)

      if (!bucket.has(listener)) {
        bucket.add(listener)
        activeCount += 1
        totalAdded += 1
        incrementType(eventType)
      }
    }

    return originalAddEventListener.call(this, type, listener, options)
  }

  dom.window.EventTarget.prototype.removeEventListener = function (
    type,
    listener,
    options
  ) {
    if (listener) {
      const eventType = String(type)
      const bucket = getBucket(this, eventType, options)

      if (bucket.delete(listener)) {
        activeCount -= 1
        decrementType(eventType)
      }
    }

    return originalRemoveEventListener.call(this, type, listener, options)
  }

  return {
    restore() {
      dom.window.EventTarget.prototype.addEventListener = originalAddEventListener
      dom.window.EventTarget.prototype.removeEventListener =
        originalRemoveEventListener
    },
    snapshot() {
      return {
        activeCount,
        byType: Object.fromEntries([...activeByType.entries()].sort()),
        totalAdded,
      }
    },
  }
}

const createDom = () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const container = dom.window.document.getElementById('root')

  if (!container) {
    throw new Error('Missing benchmark root')
  }

  if (
    !Object.getOwnPropertyDescriptor(
      dom.window.HTMLElement.prototype,
      'isContentEditable'
    )
  ) {
    Object.defineProperty(dom.window.HTMLElement.prototype, 'isContentEditable', {
      configurable: true,
      get() {
        return Boolean(this.closest('[contenteditable="true"]'))
      },
    })
  }

  const eventListenerCounter = installEventListenerCounter(dom)
  const restoreGlobals = installDomGlobals(dom)
  container.__slateBenchmarkEventListenerStats = eventListenerCounter.snapshot

  return {
    container,
    dom,
    restoreGlobals() {
      eventListenerCounter.restore()
      restoreGlobals()
    },
  }
}

const renderElement = ({ attributes, children, element }) =>
  React.createElement(
    element.type === 'heading-one' ? 'h1' : 'p',
    attributes,
    children
  )

const renderChunk = ({ attributes, children }) =>
  React.createElement('div', attributes, children)
`

const currentSharedSource = sharedSource
  .replace(
    "import * as SlateCore from 'slate'",
    "import * as SlateCore from 'slate'\nimport { Editor as InternalEditor } from 'slate/internal'"
  )
  .replace(
    'const { createEditor, Editor } = SlateCore',
    "const { createEditor } = SlateCore\nconst Editor = { ...InternalEditor, end: (editor, at) => InternalEditor.point(editor, at, { edge: 'end' }), start: (editor, at) => InternalEditor.point(editor, at, { edge: 'start' }), string: InternalEditor.string }"
  )
  .replace(
    "import { withReact } from 'slate-react'",
    "import { withReact } from '../../packages/slate-react/dist/index.js'"
  )

const legacyBenchmarkSource = `
${sharedSource}
import { Editable, Slate } from 'slate-react'

const chunkSize = Number(process.env.REACT_HUGE_COMPARE_CHUNK_SIZE || 1000)

const createBenchEditor = ({ chunking }) => {
  const editor = withReact(createEditor())
  editor.getChunkSize = (node) => (chunking && node === editor ? chunkSize : null)
  return editor
}

const mount = async ({ chunking }) => {
  const editor = createBenchEditor({ chunking })
  const initialValue = createChildren()
  const { container, dom, restoreGlobals } = createDom()
  const root = createRoot(container)

  await act(async () => {
    root.render(
      React.createElement(
        Slate,
        { editor, initialValue },
        React.createElement(Editable, { renderChunk, renderElement })
      )
    )
  })

  return { container, dom, editor, restoreGlobals, root }
}

const dispose = async ({ dom, restoreGlobals, root }) => {
  await settleBenchmark()
  await act(async () => {
    root.unmount()
  })
  await settleBenchmark()
  if (disposeDelayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, disposeDelayMs))
  }
  restoreGlobals()
  dom.window.close()
}

const measureLane = async (setup, run) => {
  const samples = []

  for (let iteration = 0; iteration < iterations + 1; iteration += 1) {
    const context = await setup()
    await settleBenchmark()
    const start = now()
    await run(context)
    const duration = now() - start
    await dispose(context)
    await settleBenchmark()

    if (iteration > 0) {
      samples.push(duration)
    }
  }

  return summarize(samples)
}

const measurePreparedLane = async (setup, prepare, run) => {
  const samples = []

  for (let iteration = 0; iteration < iterations + 1; iteration += 1) {
    const context = await setup()
    await prepare(context)
    await settleBenchmark()
    const start = now()
    await run(context)
    const duration = now() - start
    await dispose(context)
    await settleBenchmark()

    if (iteration > 0) {
      samples.push(duration)
    }
  }

  return summarize(samples)
}

const measureReady = async ({ chunking }) =>
  measureLane(
    async () => {
      const editor = createBenchEditor({ chunking })
      const initialValue = createChildren()
      const { container, dom, restoreGlobals } = createDom()
      const root = createRoot(container)

      return { container, dom, editor, initialValue, restoreGlobals, root }
    },
    async ({ editor, initialValue, root }) => {
      await act(async () => {
        root.render(
          React.createElement(
            Slate,
            { editor, initialValue },
            React.createElement(Editable, { renderChunk, renderElement })
          )
        )
      })
    }
  )

const measureType = async ({ blockIndex, chunking, selectBefore = false }) =>
  measureLane(
    () => mount({ chunking }),
    async ({ editor }) => {
      if (selectBefore) {
        await act(async () => {
          select(editor, {
            anchor: { path: [blockIndex, 0], offset: 0 },
            focus: { path: [blockIndex, 0], offset: 0 },
          })
        })
      }

      for (let index = 0; index < typeOps; index += 1) {
        await act(async () => {
          insertText(editor, 'X', {
            at: { path: [blockIndex, 0], offset: index },
          })
        })
      }
      const typedText = Editor.string(editor, [blockIndex])
      assert.equal((typedText.match(/X/g) ?? []).length, typeOps)
    }
  )

const selectBlock = async ({ blockIndex, editor }) => {
  await act(async () => {
    select(editor, {
      anchor: { path: [blockIndex, 0], offset: 0 },
      focus: { path: [blockIndex, 0], offset: 0 },
    })
  })
}

const measureSelectBlock = async ({ blockIndex, chunking }) =>
  measureLane(
    () => mount({ chunking }),
    async ({ editor }) => {
      await selectBlock({ blockIndex, editor })
      assert.deepEqual(getSelection(editor)?.anchor, {
        path: [blockIndex, 0],
        offset: 0,
      })
    }
  )

const measureTypeAfterSelect = async ({ blockIndex, chunking }) =>
  measurePreparedLane(
    () => mount({ chunking }),
    async ({ editor }) => {
      await selectBlock({ blockIndex, editor })
    },
    async ({ editor }) => {
      for (let index = 0; index < typeOps; index += 1) {
        await act(async () => {
          insertText(editor, 'X', {
            at: { path: [blockIndex, 0], offset: index },
          })
        })
      }
      const typedText = Editor.string(editor, [blockIndex])
      assert.equal((typedText.match(/X/g) ?? []).length, typeOps)
    }
  )

const measureSelectAll = async ({ chunking }) =>
  measureLane(
    () => mount({ chunking }),
    async ({ editor }) => {
      await act(async () => {
        select(editor, {
          anchor: Editor.start(editor, []),
          focus: Editor.end(editor, []),
        })
      })
      assert.deepEqual(getSelection(editor)?.anchor, Editor.start(editor, []))
    }
  )

const measureReplaceFullDocumentWithText = async ({ chunking }) =>
  measureLane(
    () => mount({ chunking }),
    async ({ editor }) => {
      await act(async () => {
        select(editor, {
          anchor: Editor.start(editor, []),
          focus: Editor.end(editor, []),
        })
        insertText(editor, pasteText)
      })
      assert.equal(Editor.string(editor, []), pasteText)
    }
  )

const measureInsertFragmentFullDocument = async ({ chunking }) =>
  measureLane(
    () => mount({ chunking }),
    async ({ editor }) => {
      await act(async () => {
        select(editor, {
          anchor: Editor.start(editor, []),
          focus: Editor.end(editor, []),
        })
        insertFragment(editor, createPasteFragment())
      })
      assert.equal(Editor.string(editor, []), pasteText)
    }
  )

const runSurface = async ({ chunking }) => {
  const readyMs = await measureReady({ chunking })

  if (readyOnly) {
    return { readyMs }
  }

  return {
    readyMs,
    selectAllMs: await measureSelectAll({ chunking }),
    startBlockTypeMs: await measureType({ blockIndex: 0, chunking }),
    ...(splitSelectionLanes
      ? {
          startBlockSelectMs: await measureSelectBlock({
            blockIndex: 0,
            chunking,
          }),
          startBlockTypeAfterSelectMs: await measureTypeAfterSelect({
            blockIndex: 0,
            chunking,
          }),
        }
      : {}),
    startBlockSelectThenTypeMs: await measureType({
      blockIndex: 0,
      chunking,
      selectBefore: true,
    }),
    middleBlockTypeMs: await measureType({
      blockIndex: Math.floor(blocks / 2),
      chunking,
    }),
    ...(splitSelectionLanes
      ? {
          middleBlockSelectMs: await measureSelectBlock({
            blockIndex: Math.floor(blocks / 2),
            chunking,
          }),
          middleBlockTypeAfterSelectMs: await measureTypeAfterSelect({
            blockIndex: Math.floor(blocks / 2),
            chunking,
          }),
        }
      : {}),
    middleBlockSelectThenTypeMs: await measureType({
      blockIndex: Math.floor(blocks / 2),
      chunking,
      selectBefore: true,
    }),
    middleBlockPromoteThenTypeMs: await measureType({
      blockIndex: Math.floor(blocks / 2),
      chunking,
      selectBefore: true,
    }),
    replaceFullDocumentWithTextMs: await measureReplaceFullDocumentWithText({
      chunking,
    }),
    insertFragmentFullDocumentMs: await measureInsertFragmentFullDocument({
      chunking,
    }),
  }
}

console.log(JSON.stringify({
  config: {
    blocks,
    chunkSize,
    disposeDelayMs,
    iterations,
    splitSelectionLanes,
    typeOps,
  },
  surfaces: {
    legacyChunkOn: await runSurface({ chunking: true }),
    legacyChunkOff: await runSurface({ chunking: false }),
  },
}))
`

const currentBenchmarkSource = `
${currentSharedSource}
import { Editable, Slate } from '../../packages/slate-react/dist/index.js'

const islandSize = Number(process.env.REACT_HUGE_COMPARE_ISLAND_SIZE || 100)
const activeRadius = Number(process.env.REACT_HUGE_COMPARE_ACTIVE_RADIUS || 0)
const rootGroupSize = 50
const rootGroupThreshold = 1000
const profileEnabled = process.env.REACT_HUGE_COMPARE_PROFILE === '1'
const selectedSurfaceNames = new Set(
  (process.env.REACT_HUGE_COMPARE_SURFACES || '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
)

const createProfilerCounter = () => {
  const events = []

  const snapshot = () => {
    const byKey = {}
    const byKind = {}

    for (const event of events) {
      const kind = event.kind
      const id = event.id ?? event.runtimeId
      const key = id ? kind + ':' + id : kind

      byKind[kind] = (byKind[kind] ?? 0) + 1
      byKey[key] = (byKey[key] ?? 0) + 1
    }

    const durationByKey = {}
    const durationByKind = {}

    for (const event of events) {
      if (typeof event.duration !== 'number') {
        continue
      }

      const kind = event.kind
      const id = event.id ?? event.runtimeId
      const key = id ? kind + ':' + id : kind

      durationByKind[kind] = (durationByKind[kind] ?? 0) + event.duration
      durationByKey[key] = (durationByKey[key] ?? 0) + event.duration
    }

    return {
      byKey,
      byKind,
      durationByKey,
      durationByKind,
      total: events.length,
    }
  }

  return {
    profiler: {
      record(event) {
        events.push({ ...event })
      },
    },
    reset() {
      events.length = 0
    },
    snapshot,
  }
}

const summarizeProfiles = (profiles) => {
  const byKindKeys = new Set()
  const byKeyKeys = new Set()
  const durationByKindKeys = new Set()
  const durationByKeyKeys = new Set()

  for (const profile of profiles) {
    Object.keys(profile.byKind).forEach((key) => byKindKeys.add(key))
    Object.keys(profile.byKey)
      .filter(
        (key) =>
          key.startsWith('selector:') ||
          key.startsWith('dom-text-sync:') ||
          key.startsWith('root-plan:') ||
          key.startsWith('group:') ||
          key.startsWith('surface-weight:') ||
          key.startsWith('benchmark-time:') ||
          key.startsWith('core-time:') ||
          key.startsWith('runtime-time:')
      )
      .forEach((key) => byKeyKeys.add(key))
    Object.keys(profile.durationByKind ?? {}).forEach((key) =>
      durationByKindKeys.add(key)
    )
    Object.keys(profile.durationByKey ?? {})
      .filter(
        (key) =>
          key.startsWith('surface-weight:') ||
          key.startsWith('benchmark-time:') ||
          key.startsWith('core-time:') ||
          key.startsWith('runtime-time:')
      )
      .forEach((key) => durationByKeyKeys.add(key))
  }

  return {
    byKey: Object.fromEntries(
      [...byKeyKeys].sort().map((key) => [
        key,
        summarize(profiles.map((profile) => profile.byKey[key] ?? 0)),
      ])
    ),
    byKind: Object.fromEntries(
      [...byKindKeys].sort().map((key) => [
        key,
        summarize(profiles.map((profile) => profile.byKind[key] ?? 0)),
      ])
    ),
    durationByKey: Object.fromEntries(
      [...durationByKeyKeys].sort().map((key) => [
        key,
        summarize(profiles.map((profile) => profile.durationByKey?.[key] ?? 0)),
      ])
    ),
    durationByKind: Object.fromEntries(
      [...durationByKindKeys].sort().map((key) => [
        key,
        summarize(
          profiles.map((profile) => profile.durationByKind?.[key] ?? 0)
        ),
      ])
    ),
    total: summarize(profiles.map((profile) => profile.total)),
  }
}

const getRootGroupCount = () => Math.ceil(blocks / rootGroupSize)
const getShellIslandCount = () => Math.ceil(blocks / islandSize)

const getLargeDocumentOptions = ({ largeDocumentMode, shellRadius = null }) => {
  switch (largeDocumentMode) {
    case 'auto':
    case 'dom-present':
    case 'off':
      return largeDocumentMode
    case 'shell':
      return {
        activeRadius: shellRadius ?? activeRadius,
        mode: 'shell',
        islandSize,
        threshold: 1,
      }
    default:
      return undefined
  }
}

const createSurfaceTrace = ({ largeDocumentMode, shellRadius = null }) => {
  const shellEnabled = largeDocumentMode === 'shell'
  const domPresentGroupingEnabled =
    (largeDocumentMode === 'auto' || largeDocumentMode === 'dom-present') &&
    blocks >= rootGroupThreshold
  const groupingEnabled = shellEnabled || domPresentGroupingEnabled
  const shellMountedGroups = shellEnabled
    ? Math.min(getShellIslandCount(), (shellRadius ?? activeRadius) + 1)
    : null
  const mountedDomPresentGroups = domPresentGroupingEnabled
    ? Math.min(getRootGroupCount(), 1)
    : null
  const pendingDomPresentGroups = domPresentGroupingEnabled
    ? Math.max(0, getRootGroupCount() - mountedDomPresentGroups)
    : 0

  return {
    backgroundMountChunks: pendingDomPresentGroups,
    corridor: shellEnabled
      ? { activeRadius: shellRadius ?? activeRadius }
      : domPresentGroupingEnabled
        ? 'active-group-staged'
        : null,
    groupingEnabled,
    groupSize: shellEnabled
      ? islandSize
      : domPresentGroupingEnabled
        ? rootGroupSize
        : null,
    interactiveReadyAt: null,
    largeDocumentMode,
    maxBackgroundChunkMs: 0,
    mountedGroupCountAtReady: shellEnabled
      ? shellMountedGroups
      : domPresentGroupingEnabled
        ? mountedDomPresentGroups
        : null,
    nativeSurfaceCompleteAt: null,
    pendingGroupCountAtReady: pendingDomPresentGroups,
    shellEnabled,
    stagedMountingEnabled: domPresentGroupingEnabled,
    staleGroupCount: 0,
  }
}

const createSurfaceDefinition = ({
  largeDocumentMode,
  name,
  omitLargeDocument = false,
  renderElementEnabled = true,
  shellRadius,
}) => ({
  largeDocument: omitLargeDocument
    ? undefined
    : getLargeDocumentOptions({ largeDocumentMode, shellRadius }),
  name,
  renderElement: renderElementEnabled ? renderElement : undefined,
  trace: createSurfaceTrace({ largeDocumentMode, shellRadius }),
})

const resolveReadyTrace = ({ nativeSurfaceCompleteMs, readyMs, trace }) => ({
  ...trace,
  interactiveReadyAt: readyMs.mean,
  nativeSurfaceCompleteAt:
    trace.shellEnabled
      ? null
      : trace.stagedMountingEnabled
        ? nativeSurfaceCompleteMs?.mean ?? null
        : readyMs.mean,
})

const recordSurfaceWeight = (id, value) => {
  globalThis.__SLATE_REACT_RENDER_PROFILER__?.record?.({
    duration: value,
    id,
    kind: 'surface-weight',
  })
}

const countElements = (root, selector) => root.querySelectorAll(selector).length

const getProcessHeapUsedBytes = () =>
  typeof process === 'object' && typeof process.memoryUsage === 'function'
    ? process.memoryUsage().heapUsed
    : 0

const recordReadySurfaceWeight = (container) => {
  if (!globalThis.__SLATE_REACT_RENDER_PROFILER__) {
    return
  }

  const root = getEditableRoot(container)
  const listenerStats = container.__slateBenchmarkEventListenerStats?.() ?? {
    activeCount: 0,
    byType: {},
    totalAdded: 0,
  }
  const processHeapUsedBytes = getProcessHeapUsedBytes()
  const domNodeCount = root.querySelectorAll('*').length + 1
  const slateElementCount = countElements(root, '[data-slate-node="element"]')
  const slateTextCount = countElements(root, '[data-slate-node="text"]')
  const slateLeafCount = countElements(root, '[data-slate-leaf]')
  const rootGroupCount = countElements(root, '[data-slate-root-group="true"]')
  const explicitMountedRootGroupCount = countElements(
    root,
    '[data-slate-root-group-state="mounted"]'
  )
  const freshMountedRootGroupCount = countElements(
    root,
    '[data-slate-root-group-state="fresh-mounted"]'
  )
  const pendingRootGroupCount = countElements(
    root,
    '[data-slate-root-group-state="pending-mount"]'
  )
  const unstatedRootGroupCount = Math.max(
    0,
    rootGroupCount -
      explicitMountedRootGroupCount -
      freshMountedRootGroupCount -
      pendingRootGroupCount
  )
  const mountedRootGroupCount =
    explicitMountedRootGroupCount +
    freshMountedRootGroupCount +
    unstatedRootGroupCount
  const domCoverageBoundaryCount = countElements(
    root,
    '[data-slate-dom-coverage-boundary]'
  )
  const shellCount = countElements(
    root,
    '[data-slate-large-document-shell="true"]'
  )
  const mountedEditableDescendantCount = slateElementCount + slateTextCount

  recordSurfaceWeight('dom-node-count', domNodeCount)
  recordSurfaceWeight('dom-nodes-per-block', domNodeCount / blocks)
  recordSurfaceWeight('editable-descendant-count', mountedEditableDescendantCount)
  recordSurfaceWeight(
    'editable-descendants-per-block',
    mountedEditableDescendantCount / blocks
  )
  recordSurfaceWeight('root-group-count', rootGroupCount)
  recordSurfaceWeight(
    'root-group-explicit-mounted-count',
    explicitMountedRootGroupCount
  )
  recordSurfaceWeight('root-group-fresh-mounted-count', freshMountedRootGroupCount)
  recordSurfaceWeight('root-group-mounted-count', mountedRootGroupCount)
  recordSurfaceWeight('root-group-pending-count', pendingRootGroupCount)
  recordSurfaceWeight('root-group-unstated-count', unstatedRootGroupCount)
  recordSurfaceWeight('slate-element-count', slateElementCount)
  recordSurfaceWeight('slate-leaf-count', slateLeafCount)
  recordSurfaceWeight('slate-text-count', slateTextCount)
  recordSurfaceWeight('shell-count', shellCount)
  recordSurfaceWeight('dom-coverage-boundary-count', domCoverageBoundaryCount)
  recordSurfaceWeight(
    'event-listener-active-count',
    listenerStats.activeCount
  )
  recordSurfaceWeight(
    'event-listener-total-added-count',
    listenerStats.totalAdded
  )
  recordSurfaceWeight(
    'event-listener-active-beforeinput',
    listenerStats.byType.beforeinput ?? 0
  )
  recordSurfaceWeight(
    'event-listener-active-input',
    listenerStats.byType.input ?? 0
  )
  recordSurfaceWeight(
    'event-listener-active-selectionchange',
    listenerStats.byType.selectionchange ?? 0
  )
  recordSurfaceWeight(
    'event-listener-active-focusin',
    listenerStats.byType.focusin ?? 0
  )
  recordSurfaceWeight(
    'event-listener-active-focusout',
    listenerStats.byType.focusout ?? 0
  )
  recordSurfaceWeight(
    'event-listener-active-dragend',
    listenerStats.byType.dragend ?? 0
  )
  recordSurfaceWeight(
    'event-listener-active-drop',
    listenerStats.byType.drop ?? 0
  )
  recordSurfaceWeight('process-heap-used-bytes', processHeapUsedBytes)
  recordSurfaceWeight(
    'process-heap-used-mb',
    processHeapUsedBytes / 1024 / 1024
  )
}

const surfaceDefinitions = [
  createSurfaceDefinition({
    largeDocumentMode: 'off',
    name: 'v2Off',
  }),
  createSurfaceDefinition({
    largeDocumentMode: 'off',
    name: 'v2DefaultRenderOff',
    renderElementEnabled: false,
  }),
  createSurfaceDefinition({
    largeDocumentMode: 'auto',
    name: 'v2DefaultOmitted',
    omitLargeDocument: true,
  }),
  createSurfaceDefinition({
    largeDocumentMode: 'auto',
    name: 'v2DefaultRenderAuto',
    renderElementEnabled: false,
  }),
  createSurfaceDefinition({
    largeDocumentMode: 'auto',
    name: 'v2AutoExplicit',
  }),
  createSurfaceDefinition({
    largeDocumentMode: 'dom-present',
    name: 'v2DomPresent',
  }),
  createSurfaceDefinition({
    largeDocumentMode: 'shell',
    name: 'v2ShellExplicitRadius0',
    shellRadius: 0,
  }),
  createSurfaceDefinition({
    largeDocumentMode: 'shell',
    name: 'v2ShellExplicitRadius1',
    shellRadius: 1,
  }),
]

const selectedSurfaceDefinitions =
  selectedSurfaceNames.size > 0
    ? surfaceDefinitions.filter((surface) =>
        selectedSurfaceNames.has(surface.name)
      )
    : surfaceDefinitions

const createEditableProps = ({ largeDocument, renderElement }) => ({
  id: 'v2-huge-compare',
  largeDocument,
  renderElement,
})

const mount = async ({ largeDocument, renderElement }) => {
  const editor = withReact(createEditor())
  Editor.replace(editor, {
    children: createChildren(),
    selection: null,
  })
  const { container, dom, restoreGlobals } = createDom()
  const root = createRoot(container)

  await act(async () => {
    root.render(
      React.createElement(
        Slate,
        { editor },
        React.createElement(
          Editable,
          createEditableProps({ largeDocument, renderElement })
        )
      )
    )
  })

  return { container, dom, editor, restoreGlobals, root }
}

const createModelOnlyContext = () => {
  const editor = withReact(createEditor())
  Editor.replace(editor, {
    children: createChildren(),
    selection: null,
  })

  return { editor }
}

const dispose = async ({ dom, restoreGlobals, root }) => {
  await settleBenchmark()
  await act(async () => {
    root.unmount()
  })
  await settleBenchmark()
  await new Promise((resolve) => setTimeout(resolve, 500))
  restoreGlobals()
  dom.window.close()
}

const measureLane = async (setup, run) => {
  const samples = []
  const profiles = []

  for (let iteration = 0; iteration < iterations + 1; iteration += 1) {
    const counter = profileEnabled ? createProfilerCounter() : null
    const previousProfiler = globalThis.__SLATE_REACT_RENDER_PROFILER__

    if (counter) {
      globalThis.__SLATE_REACT_RENDER_PROFILER__ = counter.profiler
    }

    try {
      const context = await setup()
      await settleBenchmark()
      counter?.reset()
      const start = now()
      await run(context)
      const duration = now() - start
      const profile = counter?.snapshot()
      await dispose(context)
      await settleBenchmark()

      if (iteration > 0) {
        samples.push(duration)
        if (profile) {
          profiles.push(profile)
        }
      }
    } finally {
      globalThis.__SLATE_REACT_RENDER_PROFILER__ = previousProfiler
    }
  }

  const summary = summarize(samples)

  return profileEnabled
    ? {
        ...summary,
        profile: summarizeProfiles(profiles),
      }
    : summary
}

const measurePreparedLane = async (setup, prepare, run) => {
  const samples = []
  const profiles = []

  for (let iteration = 0; iteration < iterations + 1; iteration += 1) {
    const counter = profileEnabled ? createProfilerCounter() : null
    const previousProfiler = globalThis.__SLATE_REACT_RENDER_PROFILER__

    if (counter) {
      globalThis.__SLATE_REACT_RENDER_PROFILER__ = counter.profiler
    }

    try {
      const context = await setup()
      await prepare(context)
      await settleBenchmark()
      counter?.reset()
      const start = now()
      await run(context)
      const duration = now() - start
      const profile = counter?.snapshot()
      await dispose(context)
      await settleBenchmark()

      if (iteration > 0) {
        samples.push(duration)
        if (profile) {
          profiles.push(profile)
        }
      }
    } finally {
      globalThis.__SLATE_REACT_RENDER_PROFILER__ = previousProfiler
    }
  }

  const summary = summarize(samples)

  return profileEnabled
    ? {
        ...summary,
        profile: summarizeProfiles(profiles),
      }
    : summary
}

const measureModelOnlyLane = async (setup, run) => {
  const samples = []
  const profiles = []

  for (let iteration = 0; iteration < iterations + 1; iteration += 1) {
    const counter = profileEnabled ? createProfilerCounter() : null
    const previousProfiler = globalThis.__SLATE_REACT_RENDER_PROFILER__

    if (counter) {
      globalThis.__SLATE_REACT_RENDER_PROFILER__ = counter.profiler
    }

    try {
      const context = setup()
      counter?.reset()
      const start = now()
      await run(context)
      const duration = now() - start
      const profile = counter?.snapshot()

      if (iteration > 0) {
        samples.push(duration)
        if (profile) {
          profiles.push(profile)
        }
      }
    } finally {
      globalThis.__SLATE_REACT_RENDER_PROFILER__ = previousProfiler
    }
  }

  const summary = summarize(samples)

  return profileEnabled
    ? {
        ...summary,
        profile: summarizeProfiles(profiles),
      }
    : summary
}

const measureReady = async ({ largeDocument, renderElement }) =>
  measureLane(
    async () => {
      const editor = withReact(createEditor())
      Editor.replace(editor, {
        children: createChildren(),
        selection: null,
      })
      const { container, dom, restoreGlobals } = createDom()
      const root = createRoot(container)

      return { container, dom, editor, restoreGlobals, root }
    },
    async ({ container, editor, root }) => {
      await act(async () => {
        root.render(
          React.createElement(
            Slate,
            { editor },
            React.createElement(
              Editable,
              createEditableProps({ largeDocument, renderElement })
            )
          )
        )
      })
      recordReadySurfaceWeight(container)
    }
  )

const measureNativeSurfaceComplete = async ({ largeDocument, renderElement }) =>
  measureLane(
    async () => {
      const editor = withReact(createEditor())
      Editor.replace(editor, {
        children: createChildren(),
        selection: null,
      })
      const { container, dom, restoreGlobals } = createDom()
      const root = createRoot(container)

      return { container, dom, editor, restoreGlobals, root }
    },
    async ({ container, editor, root }) => {
      await act(async () => {
        root.render(
          React.createElement(
            Slate,
            { editor },
            React.createElement(
              Editable,
              createEditableProps({ largeDocument, renderElement })
            )
          )
        )
      })

      if (getPendingRootGroupCount(container) > 0) {
        await waitForNativeSurfaceComplete(container)
      }
    }
  )

const measureType = async ({
  blockIndex,
  largeDocument,
  renderElement,
  selectBefore = false,
}) =>
  measureLane(
    () => mount({ largeDocument, renderElement }),
    async ({ editor }) => {
      if (selectBefore) {
        await act(async () => {
          select(editor, {
            anchor: { path: [blockIndex, 0], offset: 0 },
            focus: { path: [blockIndex, 0], offset: 0 },
          })
        })
      }

      for (let index = 0; index < typeOps; index += 1) {
        await profileBenchmarkDurationAsync('direct-type-act', () =>
          act(async () => {
            insertText(editor, 'X', {
              at: { path: [blockIndex, 0], offset: index },
            })
          })
        )
      }
      const typedText = Editor.string(editor, [blockIndex])
      assert.equal((typedText.match(/X/g) ?? []).length, typeOps)
    }
  )

const selectBlock = async ({ blockIndex, editor }) => {
  await act(async () => {
    select(editor, {
      anchor: { path: [blockIndex, 0], offset: 0 },
      focus: { path: [blockIndex, 0], offset: 0 },
    })
  })
}

const measureSelectBlock = async ({ blockIndex, largeDocument, renderElement }) =>
  measureLane(
    () => mount({ largeDocument, renderElement }),
    async ({ editor }) => {
      await selectBlock({ blockIndex, editor })
      assert.deepEqual(getSelection(editor)?.anchor, {
        path: [blockIndex, 0],
        offset: 0,
      })
    }
  )

const measureTypeAfterSelect = async ({
  blockIndex,
  largeDocument,
  renderElement,
}) =>
  measurePreparedLane(
    () => mount({ largeDocument, renderElement }),
    async ({ editor }) => {
      await selectBlock({ blockIndex, editor })
    },
    async ({ editor }) => {
      for (let index = 0; index < typeOps; index += 1) {
        await profileBenchmarkDurationAsync('type-after-select-act', () =>
          act(async () => {
            insertText(editor, 'X', {
              at: { path: [blockIndex, 0], offset: index },
            })
          })
        )
      }
      const typedText = Editor.string(editor, [blockIndex])
      assert.equal((typedText.match(/X/g) ?? []).length, typeOps)
    }
  )

const measurePromoteThenType = async ({
  blockIndex,
  largeDocument,
  renderElement,
}) =>
  measureLane(
    () => mount({ largeDocument, renderElement }),
    async ({ container, dom, editor }) => {
      const islandIndex = Math.floor(blockIndex / islandSize)
      const shell = container.querySelector(
        \`[data-slate-large-document-shell="true"][data-slate-large-document-island="\${islandIndex}"]\`
      )

      if (shell) {
        await act(async () => {
          shell.dispatchEvent(
            new dom.window.MouseEvent('mousedown', {
              bubbles: true,
            })
          )
        })
      } else {
        await act(async () => {
          select(editor, {
            anchor: { path: [blockIndex, 0], offset: 0 },
            focus: { path: [blockIndex, 0], offset: 0 },
          })
        })
      }

      for (let index = 0; index < typeOps; index += 1) {
        await profileBenchmarkDurationAsync('promote-type-act', () =>
          act(async () => {
            insertText(editor, 'X', {
              at: { path: [blockIndex, 0], offset: index },
            })
          })
        )
      }
      const typedText = Editor.string(editor, [blockIndex])
      assert.equal((typedText.match(/X/g) ?? []).length, typeOps)
    }
  )

const promoteAndSelectBlock = async ({ blockIndex, container, dom, editor }) => {
  const islandIndex = Math.floor(blockIndex / islandSize)
  const shell = container.querySelector(
    \`[data-slate-large-document-shell="true"][data-slate-large-document-island="\${islandIndex}"]\`
  )

  if (shell) {
    await act(async () => {
      shell.dispatchEvent(
        new dom.window.MouseEvent('mousedown', {
          bubbles: true,
        })
      )
    })
    await settleBenchmark()
  }

  const selection = {
    anchor: { path: [blockIndex, 0], offset: 0 },
    focus: { path: [blockIndex, 0], offset: 0 },
  }
  const root = getEditableRoot(container)
  const handle = root.__slateBrowserHandle

  await act(async () => {
    root.focus()

    if (handle?.selectRange) {
      handle.selectRange(selection)
    } else {
      select(editor, selection)
    }
  })
  await settleBenchmark()

  return root
}

const createMissingBeforeInputTargetMessage = ({ blockIndex, root }) =>
  'Missing mounted text target for beforeinput: selection=' +
  JSON.stringify(root.__slateBrowserHandle?.getSelection?.()) +
  ', textHosts=' +
  root.querySelectorAll('[data-slate-node="text"]').length +
  ', blockIndex=' +
  blockIndex +
  ', mountedText=' +
  JSON.stringify((root.textContent ?? '').slice(0, 160))

const getPendingRootGroupCount = (container) =>
  container.querySelectorAll('[data-slate-root-group-state="pending-mount"]')
    .length

const waitForNativeSurfaceComplete = async (container) => {
  for (let attempt = 0; attempt < 2000; attempt += 1) {
    if (getPendingRootGroupCount(container) === 0) {
      return
    }

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1))
    })
  }

  throw new Error(
    'Timed out waiting for native surface completion: pendingGroups=' +
      getPendingRootGroupCount(container)
  )
}

const setupSelectedTextInputTarget = async ({
  blockIndex,
  largeDocument,
  renderElement,
}) => {
  const context = await mount({ largeDocument, renderElement })
  const editableRoot = await promoteAndSelectBlock({
    blockIndex,
    container: context.container,
    dom: context.dom,
    editor: context.editor,
  })
  const target = getCurrentSelectionTextEventTarget({
    blockIndex,
    dom: context.dom,
    root: editableRoot,
  })

  if (!target) {
    throw new Error(
      createMissingBeforeInputTargetMessage({ blockIndex, root: editableRoot })
    )
  }

  return { ...context, editableRoot, target }
}

const measureSelectThenModelBeforeInputType = async ({
  blockIndex,
  largeDocument,
  renderElement,
}) =>
  measureLane(
    () => mount({ largeDocument, renderElement }),
    async ({ container, dom, editor }) => {
      const root = await promoteAndSelectBlock({
        blockIndex,
        container,
        dom,
        editor,
      })
      let target = getCurrentSelectionTextEventTarget({
        blockIndex,
        dom,
        root,
      })

      for (let index = 0; index < typeOps; index += 1) {
        await profileBenchmarkDurationAsync(
          'select-then-model-beforeinput-act',
          () =>
            act(async () => {
              if (!target?.isConnected) {
                target = getCurrentSelectionTextEventTarget({
                  blockIndex,
                  dom,
                  root,
                })
              }

              if (!target) {
                throw new Error(
                  createMissingBeforeInputTargetMessage({ blockIndex, root })
                )
              }

              dispatchModelOwnedBeforeInputText({
                dom,
                target,
                text: modelOwnedBeforeInputText,
              })
            })
        )
      }
      const typedText = Editor.string(editor, [blockIndex])
      assert.equal(
        (typedText.match(new RegExp(modelOwnedBeforeInputText, 'g')) ?? [])
          .length,
        typeOps
      )
    }
  )

const measureModelBeforeInputType = async ({
  blockIndex,
  largeDocument,
  renderElement,
}) =>
  measureLane(
    () =>
      setupSelectedTextInputTarget({ blockIndex, largeDocument, renderElement }),
    async ({ dom, editableRoot, editor, target: initialTarget }) => {
      let target = initialTarget

      for (let index = 0; index < typeOps; index += 1) {
        await profileBenchmarkDurationAsync('model-beforeinput-act', () =>
          act(async () => {
            if (!target?.isConnected) {
              target = getCurrentSelectionTextEventTarget({
                blockIndex,
                dom,
                root: editableRoot,
              })
            }

            if (!target) {
              throw new Error(
                createMissingBeforeInputTargetMessage({
                  blockIndex,
                  root: editableRoot,
                })
              )
            }

            dispatchModelOwnedBeforeInputText({
              dom,
              target,
              text: modelOwnedBeforeInputText,
            })
          })
        )
      }

      const typedText = Editor.string(editor, [blockIndex])
      assert.equal(
        (typedText.match(new RegExp(modelOwnedBeforeInputText, 'g')) ?? [])
          .length,
        typeOps
      )
    }
  )

const measureSelectAll = async ({ largeDocument, renderElement }) =>
  measureLane(
    () => mount({ largeDocument, renderElement }),
    async ({ editor }) => {
      await act(async () => {
        select(editor, {
          anchor: Editor.start(editor, []),
          focus: Editor.end(editor, []),
        })
      })
      assert.deepEqual(getSelection(editor)?.anchor, Editor.start(editor, []))
    }
  )

const measureReplaceFullDocumentWithText = async ({
  largeDocument,
  renderElement,
}) =>
  measureLane(
    () => mount({ largeDocument, renderElement }),
    async ({ editor }) => {
      await act(async () => {
        select(editor, {
          anchor: Editor.start(editor, []),
          focus: Editor.end(editor, []),
        })
        insertText(editor, pasteText)
      })
      assert.equal(Editor.string(editor, []), pasteText)
    }
  )

const measureReplaceFullDocumentWithTextModelCommit = async () =>
  measureModelOnlyLane(
    createModelOnlyContext,
    async ({ editor }) => {
      select(editor, {
        anchor: Editor.start(editor, []),
        focus: Editor.end(editor, []),
      })
      insertText(editor, pasteText)
      assert.equal(Editor.string(editor, []), pasteText)
    }
  )

const measureInsertFragmentFullDocument = async ({
  largeDocument,
  renderElement,
}) =>
  measureLane(
    () => mount({ largeDocument, renderElement }),
    async ({ editor }) => {
      await act(async () => {
        select(editor, {
          anchor: Editor.start(editor, []),
          focus: Editor.end(editor, []),
        })
        insertFragment(editor, createPasteFragment())
      })
      assert.equal(Editor.string(editor, []), pasteText)
    }
  )

const measureInsertFragmentFullDocumentModelCommit = async () =>
  measureModelOnlyLane(
    createModelOnlyContext,
    async ({ editor }) => {
      select(editor, {
        anchor: Editor.start(editor, []),
        focus: Editor.end(editor, []),
      })
      insertFragment(editor, createPasteFragment())
      assert.equal(Editor.string(editor, []), pasteText)
    }
  )

const runSurface = async ({ largeDocument, renderElement, trace }) => {
  const readyMs = await measureReady({ largeDocument, renderElement })

  if (readyOnly) {
    return {
      trace: resolveReadyTrace({
        nativeSurfaceCompleteMs: null,
        readyMs,
        trace,
      }),
      readyMs,
    }
  }

  const nativeSurfaceCompleteMs = trace.stagedMountingEnabled
    ? await measureNativeSurfaceComplete({ largeDocument, renderElement })
    : null

  return {
    trace: resolveReadyTrace({ nativeSurfaceCompleteMs, readyMs, trace }),
    nativeSurfaceCompleteMs,
    readyMs,
    selectAllMs: await measureSelectAll({ largeDocument, renderElement }),
    startBlockTypeMs: await measureType({
      blockIndex: 0,
      largeDocument,
      renderElement,
    }),
    ...(splitSelectionLanes
      ? {
          startBlockSelectMs: await measureSelectBlock({
          blockIndex: 0,
          largeDocument,
          renderElement,
        }),
        startBlockTypeAfterSelectMs: await measureTypeAfterSelect({
          blockIndex: 0,
          largeDocument,
          renderElement,
        }),
        }
      : {}),
    startBlockSelectThenTypeMs: await measureType({
      blockIndex: 0,
      largeDocument,
      renderElement,
      selectBefore: true,
    }),
    middleBlockTypeMs: await measureType({
      blockIndex: Math.floor(blocks / 2),
      largeDocument,
      renderElement,
    }),
    ...(splitSelectionLanes
      ? {
          middleBlockSelectMs: await measureSelectBlock({
          blockIndex: Math.floor(blocks / 2),
          largeDocument,
          renderElement,
        }),
        middleBlockTypeAfterSelectMs: await measureTypeAfterSelect({
          blockIndex: Math.floor(blocks / 2),
          largeDocument,
          renderElement,
        }),
        }
      : {}),
    middleBlockSelectThenTypeMs: await measureType({
      blockIndex: Math.floor(blocks / 2),
      largeDocument,
      renderElement,
      selectBefore: true,
    }),
    middleBlockPromoteThenTypeMs: await measurePromoteThenType({
      blockIndex: Math.floor(blocks / 2),
      largeDocument,
      renderElement,
    }),
    startBlockModelBeforeInputTypeMs: await measureModelBeforeInputType({
      blockIndex: 0,
      largeDocument,
      renderElement,
    }),
    middleBlockModelBeforeInputTypeMs: await measureModelBeforeInputType({
      blockIndex: Math.floor(blocks / 2),
      largeDocument,
      renderElement,
    }),
    startBlockSelectThenModelBeforeInputTypeMs:
      await measureSelectThenModelBeforeInputType({
        blockIndex: 0,
        largeDocument,
        renderElement,
    }),
    middleBlockSelectThenModelBeforeInputTypeMs:
      await measureSelectThenModelBeforeInputType({
        blockIndex: Math.floor(blocks / 2),
        largeDocument,
        renderElement,
      }),
    replaceFullDocumentWithTextModelCommitMs:
      await measureReplaceFullDocumentWithTextModelCommit(),
    replaceFullDocumentWithTextMs: await measureReplaceFullDocumentWithText({
      largeDocument,
      renderElement,
    }),
    insertFragmentFullDocumentModelCommitMs:
      await measureInsertFragmentFullDocumentModelCommit(),
    insertFragmentFullDocumentMs: await measureInsertFragmentFullDocument({
      largeDocument,
      renderElement,
    }),
  }
}

const surfaces = {}

for (const surface of selectedSurfaceDefinitions) {
  surfaces[surface.name] = await runSurface(surface)
}

console.log(JSON.stringify({
  config: {
    activeRadius,
    blocks,
    disposeDelayMs,
    islandSize,
    iterations,
    profileEnabled,
    readyOnly,
    rootGroupSize,
    splitSelectionLanes,
    typeOps,
  },
  surfaces,
}))
`

const currentPackageManager = await parsePackageManager(currentRepo)

if (!skipBuild) {
  await buildRepo(currentRepo, currentPackageManager, './packages/slate-react')
}

const env = {
  REACT_HUGE_COMPARE_ACTIVE_RADIUS: String(activeRadius),
  REACT_HUGE_COMPARE_BLOCKS: String(blocks),
  REACT_HUGE_COMPARE_CHUNK_SIZE: String(chunkSize),
  REACT_HUGE_COMPARE_ISLAND_SIZE: String(islandSize),
  REACT_HUGE_COMPARE_ITERATIONS: String(iterations),
  REACT_HUGE_COMPARE_PROFILE: profile ? '1' : '0',
  REACT_HUGE_COMPARE_READY_ONLY: readyOnly ? '1' : '0',
  REACT_HUGE_COMPARE_SURFACES: process.env.REACT_HUGE_COMPARE_SURFACES || '',
  REACT_HUGE_COMPARE_TYPE_OPS: String(typeOps),
}

const current = await benchmarkRepo({
  benchmarkSource: currentBenchmarkSource,
  env,
  packageManager: currentPackageManager,
  repo: currentRepo,
})

if (compareMode === 'current-only') {
  const summary = {
    lane: 'slate-react-huge-document-legacy-compare',
    mode: compareMode,
    currentRepo,
    config: {
      activeRadius,
      blocks,
      disposeDelayMs,
      islandSize,
      iterations,
      profile,
      readyOnly,
      rootGroupSize,
      splitSelectionLanes,
      typeOps,
    },
    surfaces: current.surfaces,
  }

  await writeBenchmarkArtifact(
    'tmp/slate-react-huge-document-legacy-compare-benchmark.json',
    summary
  )

  console.log(JSON.stringify(summary, null, 2))
  process.exit(0)
}

const legacyPackageManager = await parsePackageManager(legacyRepo)

if (!skipBuild) {
  await buildRepo(legacyRepo, legacyPackageManager, './packages/slate-react')
}

const legacy = await benchmarkRepo({
  benchmarkSource: legacyBenchmarkSource,
  env,
  packageManager: legacyPackageManager,
  repo: legacyRepo,
})

const legacyChunkOn = legacy.surfaces.legacyChunkOn
const legacyChunkOff = legacy.surfaces.legacyChunkOff

const createDeltaMeanMs = (surface) =>
  Object.fromEntries(
    Object.keys(surface)
      .filter((lane) => legacyChunkOff[lane] && legacyChunkOn[lane])
      .map((lane) => [
        lane,
        {
          v2MinusLegacyChunkOff: round(
            surface[lane].mean - legacyChunkOff[lane].mean
          ),
          v2MinusLegacyChunkOn: round(
            surface[lane].mean - legacyChunkOn[lane].mean
          ),
        },
      ])
  )

const deltaMeanMsBySurface = Object.fromEntries(
  Object.entries(current.surfaces).map(([surfaceName, surface]) => [
    surfaceName,
    createDeltaMeanMs(surface),
  ])
)

const summary = {
  lane: 'slate-react-huge-document-legacy-compare',
  currentRepo,
  legacyRepo,
  config: {
    activeRadius,
    blocks,
    chunkSize,
    disposeDelayMs,
    islandSize,
    iterations,
    profile,
    readyOnly,
    rootGroupSize,
    splitSelectionLanes,
    typeOps,
  },
  surfaces: {
    legacyChunkOff,
    legacyChunkOn,
    ...current.surfaces,
  },
  deltaMeanMsBySurface,
}

await writeBenchmarkArtifact(
  'tmp/slate-react-huge-document-legacy-compare-benchmark.json',
  summary
)

console.log(JSON.stringify(summary, null, 2))
