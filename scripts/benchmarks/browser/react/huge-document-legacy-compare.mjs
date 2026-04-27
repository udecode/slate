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
const typeOps = Number(process.env.REACT_HUGE_COMPARE_TYPE_OPS || 20)
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
const pasteText = ${JSON.stringify(pasteText)}
const createPasteFragment = ${createPasteFragment.toString()}

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const act = React.act ?? TestUtils.act

const now = () => performance.now()
const round = (value) => Number(value.toFixed(2))
const settleBenchmark = () => new Promise((resolve) => setTimeout(resolve, 0))

const getSelection = (editor) =>
  typeof editor.getSelection === 'function' ? editor.getSelection() : editor.selection

const select = (editor, target) => {
  if (typeof editor.update === 'function') {
    editor.update(() => {
      editor.select(target)
    })
    return
  }

  legacyTransforms.select(editor, target)
}

const insertText = (editor, text, options) => {
  if (typeof editor.update === 'function') {
    editor.update(() => {
      editor.insertText(text, options)
    })
    return
  }

  legacyTransforms.insertText(editor, text, options)
}

const insertFragment = (editor, fragment) => {
  if (typeof editor.update === 'function') {
    editor.update(() => {
      editor.insertFragment(fragment)
    })
    return
  }

  legacyTransforms.insertFragment(editor, fragment)
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

const createDom = () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const container = dom.window.document.getElementById('root')

  if (!container) {
    throw new Error('Missing benchmark root')
  }

  return {
    container,
    dom,
    restoreGlobals: installDomGlobals(dom),
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
    "import * as SlateCore from '../../packages/slate/src/index.ts'"
  )
  .replace(
    "import { withReact } from 'slate-react'",
    "import { withReact } from '../../packages/slate-react/src/index.ts'"
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
  await act(async () => {
    root.unmount()
  })
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

const runSurface = async ({ chunking }) => ({
  readyMs: await measureReady({ chunking }),
  selectAllMs: await measureSelectAll({ chunking }),
  startBlockTypeMs: await measureType({ blockIndex: 0, chunking }),
  startBlockSelectThenTypeMs: await measureType({
    blockIndex: 0,
    chunking,
    selectBefore: true,
  }),
  middleBlockTypeMs: await measureType({
    blockIndex: Math.floor(blocks / 2),
    chunking,
  }),
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
})

console.log(JSON.stringify({
  config: { blocks, chunkSize, iterations, typeOps },
  surfaces: {
    legacyChunkOn: await runSurface({ chunking: true }),
    legacyChunkOff: await runSurface({ chunking: false }),
  },
}))
`

const currentBenchmarkSource = `
${currentSharedSource}
import { Editable } from '../../packages/slate-react/src/index.ts'

const islandSize = Number(process.env.REACT_HUGE_COMPARE_ISLAND_SIZE || 100)
const activeRadius = Number(process.env.REACT_HUGE_COMPARE_ACTIVE_RADIUS || 0)

const mount = async () => {
  const editor = withReact(createEditor())
  Editor.replace(editor, {
    children: createChildren(),
    selection: null,
  })
  const { container, dom, restoreGlobals } = createDom()
  const root = createRoot(container)

  await act(async () => {
    root.render(
      React.createElement(Editable, {
        editor,
        id: 'v2-huge-compare',
        largeDocument: {
          activeRadius,
          enabled: true,
          islandSize,
          threshold: 1,
        },
        renderElement,
      })
    )
  })

  return { container, dom, editor, restoreGlobals, root }
}

const dispose = async ({ dom, restoreGlobals, root }) => {
  await act(async () => {
    root.unmount()
  })
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

const measureReady = async () =>
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
    async ({ editor, root }) => {
      await act(async () => {
        root.render(
          React.createElement(Editable, {
            editor,
            id: 'v2-huge-compare',
            largeDocument: {
              activeRadius,
              enabled: true,
              islandSize,
              threshold: 1,
            },
            renderElement,
          })
        )
      })
    }
  )

const measureType = async ({ blockIndex, selectBefore = false }) =>
  measureLane(
    mount,
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

const measurePromoteThenType = async ({ blockIndex }) =>
  measureLane(
    mount,
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

const measureSelectAll = async () =>
  measureLane(
    mount,
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

const measureReplaceFullDocumentWithText = async () =>
  measureLane(
    mount,
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

const measureInsertFragmentFullDocument = async () =>
  measureLane(
    mount,
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

console.log(JSON.stringify({
  config: { activeRadius, blocks, islandSize, iterations, typeOps },
  surfaces: {
    v2LargeDocument: {
      readyMs: await measureReady(),
      selectAllMs: await measureSelectAll(),
      startBlockTypeMs: await measureType({ blockIndex: 0 }),
      startBlockSelectThenTypeMs: await measureType({
        blockIndex: 0,
        selectBefore: true,
      }),
      middleBlockTypeMs: await measureType({ blockIndex: Math.floor(blocks / 2) }),
      middleBlockSelectThenTypeMs: await measureType({
        blockIndex: Math.floor(blocks / 2),
        selectBefore: true,
      }),
      middleBlockPromoteThenTypeMs: await measurePromoteThenType({
        blockIndex: Math.floor(blocks / 2),
      }),
      replaceFullDocumentWithTextMs: await measureReplaceFullDocumentWithText(),
      insertFragmentFullDocumentMs: await measureInsertFragmentFullDocument(),
    },
  },
}))
`

const currentPackageManager = await parsePackageManager(currentRepo)
const legacyPackageManager = await parsePackageManager(legacyRepo)

await buildRepo(currentRepo, currentPackageManager, './packages/slate-react')
await buildRepo(legacyRepo, legacyPackageManager, './packages/slate-react')

const env = {
  REACT_HUGE_COMPARE_ACTIVE_RADIUS: String(activeRadius),
  REACT_HUGE_COMPARE_BLOCKS: String(blocks),
  REACT_HUGE_COMPARE_CHUNK_SIZE: String(chunkSize),
  REACT_HUGE_COMPARE_ISLAND_SIZE: String(islandSize),
  REACT_HUGE_COMPARE_ITERATIONS: String(iterations),
  REACT_HUGE_COMPARE_TYPE_OPS: String(typeOps),
}

const legacy = await benchmarkRepo({
  benchmarkSource: legacyBenchmarkSource,
  env,
  packageManager: legacyPackageManager,
  repo: legacyRepo,
})
const current = await benchmarkRepo({
  benchmarkSource: currentBenchmarkSource,
  env,
  packageManager: currentPackageManager,
  repo: currentRepo,
})

const v2 = current.surfaces.v2LargeDocument
const legacyChunkOn = legacy.surfaces.legacyChunkOn
const legacyChunkOff = legacy.surfaces.legacyChunkOff

const deltaMeanMs = Object.fromEntries(
  Object.keys(v2).map((lane) => [
    lane,
    {
      v2MinusLegacyChunkOff: round(v2[lane].mean - legacyChunkOff[lane].mean),
      v2MinusLegacyChunkOn: round(v2[lane].mean - legacyChunkOn[lane].mean),
    },
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
    islandSize,
    iterations,
    typeOps,
  },
  surfaces: {
    legacyChunkOff,
    legacyChunkOn,
    v2LargeDocument: v2,
  },
  deltaMeanMs,
}

await writeBenchmarkArtifact(
  'tmp/slate-react-huge-document-legacy-compare-benchmark.json',
  summary
)

console.log(JSON.stringify(summary, null, 2))
