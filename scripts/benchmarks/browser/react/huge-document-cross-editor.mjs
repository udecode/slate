import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { chromium } from '@playwright/test'

import {
  round,
  summarize,
  writeBenchmarkArtifact,
} from '../../shared/stats.mjs'

const currentRepo = process.cwd()
const defaultProseMirrorRepo = resolve(currentRepo, '../../../prosemirror')
const defaultLexicalRepo = resolve(currentRepo, '../../../lexical')

const prosemirrorRepo = resolve(
  currentRepo,
  process.env.CROSS_EDITOR_HUGE_PROSEMIRROR_REPO || defaultProseMirrorRepo
)
const lexicalRepo = resolve(
  currentRepo,
  process.env.CROSS_EDITOR_HUGE_LEXICAL_REPO || defaultLexicalRepo
)

const blocks = Number(process.env.CROSS_EDITOR_HUGE_BLOCKS || 5000)
const iterations = Number(process.env.CROSS_EDITOR_HUGE_ITERATIONS || 5)
const typeOps = Number(process.env.CROSS_EDITOR_HUGE_TYPE_OPS || 10)
const headless = process.env.CROSS_EDITOR_HUGE_HEADLESS !== '0'
const selectedSurfaces = new Set(
  (
    process.env.CROSS_EDITOR_HUGE_SURFACES ||
    'slateAuto,slateVirtualized,prosemirror,lexical'
  )
    .split(',')
    .map((surface) => surface.trim())
    .filter(Boolean)
)

const latestArtifactPath =
  'tmp/slate-react-huge-document-cross-editor-benchmark.json'

const sanitizeArtifactSegment = (value) =>
  String(value)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180) || 'default'

const runArtifactPath = `${[
  'tmp/slate-react-huge-document-cross-editor-benchmark',
  `surfaces-${sanitizeArtifactSegment(Array.from(selectedSurfaces).join('-'))}`,
  `blocks-${blocks}`,
  `iters-${iterations}`,
  `ops-${typeOps}`,
].join('-')}.json`

const modulePaths = {
  lexical: resolve(lexicalRepo, 'packages/lexical/dist/Lexical.mjs'),
  prosemirrorModel: resolve(prosemirrorRepo, 'model/dist/index.js'),
  prosemirrorState: resolve(prosemirrorRepo, 'state/dist/index.js'),
  prosemirrorTransform: resolve(prosemirrorRepo, 'transform/dist/index.js'),
  prosemirrorView: resolve(prosemirrorRepo, 'view/dist/index.js'),
}

const missingModulePaths = Object.entries(modulePaths)
  .filter(([, path]) => !existsSync(path))
  .map(([key, path]) => `${key}: ${path}`)

if (missingModulePaths.length > 0) {
  throw new Error(
    [
      'Missing external editor build outputs:',
      ...missingModulePaths.map((path) => `- ${path}`),
      '',
      'Build ProseMirror core packages and Lexical before running this lane.',
    ].join('\n')
  )
}

const entrySource = `
import {
  Schema,
} from ${JSON.stringify(modulePaths.prosemirrorModel)}
import {
  EditorState,
  TextSelection,
} from ${JSON.stringify(modulePaths.prosemirrorState)}
import {
  EditorView,
} from ${JSON.stringify(modulePaths.prosemirrorView)}
import React from 'react'
import { createRoot } from 'react-dom/client'
import {
  createReactEditor,
  Editable,
  Slate,
} from 'slate-react'
import {
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  createEditor,
} from ${JSON.stringify(modulePaths.lexical)}

const typeOps = ${JSON.stringify(typeOps)}
const typeText = 'X'.repeat(typeOps)
const app = document.getElementById('app')

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      content: 'text*',
      group: 'block',
      parseDOM: [{ tag: 'p' }],
      toDOM() {
        return ['p', 0]
      },
    },
    text: { group: 'inline' },
  },
})

const state = {
  lexical: null,
  lexicalTextKeys: [],
  prosemirror: null,
  reactRoot: null,
  slateEditor: null,
}

const clearApp = () => {
  if (state.reactRoot) {
    state.reactRoot.unmount()
    state.reactRoot = null
  }

  app.textContent = ''
}

const createShell = (surface) => {
  clearApp()
  const shell = document.createElement('div')
  shell.id = surface + '-editor'
  shell.dataset.surface = surface
  shell.style.cssText = [
    'height:600px',
    'overflow:auto',
    'border:0',
    'outline:0',
    'font:16px/1.35 system-ui, sans-serif',
  ].join(';')
  app.appendChild(shell)
  return shell
}

const installProseMirror = (blockCount) => {
  const shell = createShell('prosemirror')
  const children = Array.from({ length: blockCount }, (_, index) =>
    schema.nodes.paragraph.create(null, schema.text('block-' + index))
  )
  const doc = schema.nodes.doc.create(null, children)
  const editorState = EditorState.create({ doc })
  const view = new EditorView(shell, {
    state: editorState,
  })

  state.prosemirror = view
}

const waitLexicalUpdate = (editor, update) =>
  new Promise((resolvePromise) => {
    editor.update(update, {
      discrete: true,
      onUpdate: resolvePromise,
    })
  })

const createSlateValue = (blockCount) =>
  Array.from({ length: blockCount }, (_, index) => ({
    type: 'paragraph',
    children: [{ text: 'block-' + index }],
  }))

const renderSlateElement = ({ attributes, children }) =>
  React.createElement('p', attributes, children)

const installSlate = async (surface, blockCount) => {
  const shell = createShell(surface)
  const editor = createReactEditor({
    initialValue: createSlateValue(blockCount),
  })
  const domStrategy =
    surface === 'slateVirtualized'
      ? {
          estimatedBlockSize: 24,
          overscan: 2,
          threshold: 1,
          type: 'virtualized',
        }
      : 'auto'
  const editableStyle =
    surface === 'slateVirtualized'
      ? {
          height: 600,
          overflowY: 'auto',
        }
      : undefined
  const root = createRoot(shell)

  state.reactRoot = root
  state.slateEditor = editor
  root.render(
    React.createElement(
      Slate,
      { editor },
      React.createElement(Editable, {
        domStrategy,
        renderElement: renderSlateElement,
        spellCheck: false,
        style: editableStyle,
      })
    )
  )
  await globalThis.__CROSS_EDITOR_HUGE__.nextPaint()
}

const installLexical = async (blockCount) => {
  const shell = createShell('lexical')
  const rootElement = document.createElement('div')
  rootElement.contentEditable = 'true'
  rootElement.spellcheck = false
  rootElement.style.cssText = 'outline:0;min-height:600px'
  shell.appendChild(rootElement)

  const editor = createEditor({
    namespace: 'cross-editor-huge-document',
    onError(error) {
      throw error
    },
  })
  const textKeys = []

  editor.setRootElement(rootElement)
  await waitLexicalUpdate(editor, () => {
    const root = $getRoot()
    root.clear()

    for (let index = 0; index < blockCount; index += 1) {
      const paragraph = $createParagraphNode()
      const text = $createTextNode('block-' + index)
      textKeys.push(text.getKey())
      paragraph.append(text)
      root.append(paragraph)
    }
  })

  state.lexical = editor
  state.lexicalTextKeys = textKeys
}

const prosemirrorTextPosition = (view, blockIndex, offset) => {
  let position = 1

  for (let index = 0; index < blockIndex; index += 1) {
    position += view.state.doc.child(index).nodeSize
  }

  return position + 1 + offset
}

const selectProseMirrorBlock = (blockIndex, offset = 0) => {
  const view = state.prosemirror
  const position = prosemirrorTextPosition(view, blockIndex, offset)
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, position))
  )
  view.focus()
}

const selectLexicalBlock = async (blockIndex, offset = 0) => {
  const editor = state.lexical
  const key = state.lexicalTextKeys[blockIndex]

  await waitLexicalUpdate(editor, () => {
    const text = $getNodeByKey(key)
    text.select(offset, offset)
  })

  editor.focus()
}

const selectSlateBlock = (blockIndex, offset = 0) => {
  const editor = state.slateEditor

  editor.update((tx) => {
    tx.selection.set({ path: [blockIndex, 0], offset })
  })

  document.querySelector('[data-slate-editor="true"]')?.focus()
}

const blockText = (surface, blockIndex) => {
  if (surface.startsWith('slate')) {
    return state.slateEditor.read(
      (readState) =>
        readState.runtime.snapshot().children[blockIndex]?.children[0]?.text ??
        ''
    )
  }

  if (surface === 'prosemirror') {
    return state.prosemirror.state.doc.child(blockIndex).textContent
  }

  let textContent = ''
  state.lexical.getEditorState().read(() => {
    textContent = $getNodeByKey(state.lexicalTextKeys[blockIndex]).getTextContent()
  })
  return textContent
}

const visibleEditor = () => app.firstElementChild

globalThis.__CROSS_EDITOR_HUGE__ = {
  async assertTyped(surface, blockIndex) {
    const text = blockText(surface, blockIndex)
    const typedCount = this.typedCount(surface, blockIndex)

    if (typedCount !== typeOps) {
      throw new Error(
        surface +
          ' typed count mismatch at block ' +
          blockIndex +
          ': expected ' +
          typeOps +
          ', got ' +
          typedCount +
          ' in ' +
          JSON.stringify(text)
      )
    }
  },
  async install(surface, blockCount) {
    if (surface === 'slateAuto' || surface === 'slateVirtualized') {
      await installSlate(surface, blockCount)
      return
    }

    if (surface === 'prosemirror') {
      installProseMirror(blockCount)
      return
    }

    if (surface === 'lexical') {
      await installLexical(blockCount)
      return
    }

    throw new Error('Unknown surface: ' + surface)
  },
  nextPaint() {
    return new Promise((resolvePromise) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolvePromise(performance.now())
        })
      })
    })
  },
  resetTrace() {
    globalThis.__CROSS_EDITOR_TRACE__.longTasks.length = 0
  },
  async select(surface, blockIndex, offset = 0) {
    if (surface === 'slateAuto' || surface === 'slateVirtualized') {
      selectSlateBlock(blockIndex, offset)
    } else if (surface === 'prosemirror') {
      selectProseMirrorBlock(blockIndex, offset)
    } else if (surface === 'lexical') {
      await selectLexicalBlock(blockIndex, offset)
    } else {
      throw new Error('Unknown surface: ' + surface)
    }

    await this.nextPaint()
  },
  snapshot(surface) {
    const editor = visibleEditor()
    return {
      domNodes: editor ? editor.querySelectorAll('*').length : 0,
      heapMB:
        performance.memory && performance.memory.usedJSHeapSize
          ? performance.memory.usedJSHeapSize / 1024 / 1024
          : 0,
      longTaskMaxMs: Math.max(
        0,
        ...globalThis.__CROSS_EDITOR_TRACE__.longTasks.map((entry) => entry.duration)
      ),
      observedBlocks:
        surface.startsWith('slate')
          ? state.slateEditor.read(
              (readState) => readState.runtime.snapshot().children.length
            )
          : surface === 'prosemirror'
          ? state.prosemirror.state.doc.childCount
          : state.lexicalTextKeys.length,
    }
  },
  typedCount(surface, blockIndex) {
    const text = blockText(surface, blockIndex)
    return (text.match(/X/g) || []).length
  },
  typeText,
}

globalThis.__CROSS_EDITOR_TRACE__ = {
  longTasks: [],
}

if ('PerformanceObserver' in globalThis) {
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        globalThis.__CROSS_EDITOR_TRACE__.longTasks.push({
          duration: entry.duration,
          name: entry.name,
          startTime: entry.startTime,
        })
      }
    })
    observer.observe({ type: 'longtask', buffered: false })
  } catch {}
}

globalThis.__CROSS_EDITOR_HUGE_READY__ = true
`

const createHtml = (bundleSource) => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html,
      body {
        margin: 0;
        padding: 0;
      }
      p {
        margin: 0 0 4px;
      }
      .ProseMirror {
        outline: 0;
      }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <script type="module">${bundleSource.replaceAll(
      '</script',
      '<\\/script'
    )}</script>
  </body>
</html>`

const run = async (command, args, cwd) => {
  const process = Bun.spawn([command, ...args], {
    cwd,
    stderr: 'pipe',
    stdout: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ])

  if (exitCode !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed in ${cwd}\n${stdout}\n${stderr}`
    )
  }

  return { stderr, stdout }
}

const buildBrowserBundle = async () => {
  const outDir = resolve(currentRepo, 'tmp/cross-editor-huge-document')
  const entryPath = resolve(outDir, 'entry.mjs')
  const bundlePath = resolve(outDir, 'bundle.js')

  await rm(outDir, { force: true, recursive: true })
  await mkdir(outDir, { recursive: true })
  await writeFile(entryPath, entrySource)

  await run(
    'bun',
    [
      'build',
      entryPath,
      '--target=browser',
      '--format=esm',
      '--outfile',
      bundlePath,
    ],
    currentRepo
  )

  const bundleSource = await readFile(bundlePath, 'utf8')
  const htmlSource = createHtml(bundleSource)

  return {
    htmlSource,
    outDir,
  }
}

const summarizeMetric = (samples, key) =>
  summarize(samples.map((sample) => sample[key]))

const measureSurface = async ({ page, surface }) => {
  const lanes = [
    { blockIndex: 0, key: 'startBlock' },
    { blockIndex: Math.floor(blocks / 2), key: 'middleBlock' },
  ]
  const laneSummaries = {}
  let latestSnapshot = null

  for (const lane of lanes) {
    const samples = []

    for (let iteration = 0; iteration < iterations + 1; iteration += 1) {
      await page.evaluate(
        async ({ blockCount, selectedSurface }) => {
          await globalThis.__CROSS_EDITOR_HUGE__.install(
            selectedSurface,
            blockCount
          )
          await globalThis.__CROSS_EDITOR_HUGE__.nextPaint()
        },
        { blockCount: blocks, selectedSurface: surface }
      )
      await page.evaluate(() => globalThis.__CROSS_EDITOR_HUGE__.resetTrace())

      const selectStart = await page.evaluate(() => performance.now())
      await page.evaluate(
        async ({ blockIndex, selectedSurface }) => {
          await globalThis.__CROSS_EDITOR_HUGE__.select(
            selectedSurface,
            blockIndex
          )
        },
        { blockIndex: lane.blockIndex, selectedSurface: surface }
      )
      const selectPaint = await page.evaluate(() =>
        globalThis.__CROSS_EDITOR_HUGE__.nextPaint()
      )
      const materializedSelectStart = await page.evaluate(() =>
        performance.now()
      )
      await page.evaluate(
        async ({ blockIndex, selectedSurface }) => {
          await globalThis.__CROSS_EDITOR_HUGE__.select(
            selectedSurface,
            blockIndex,
            1
          )
        },
        { blockIndex: lane.blockIndex, selectedSurface: surface }
      )
      const materializedSelectPaint = await page.evaluate(() =>
        globalThis.__CROSS_EDITOR_HUGE__.nextPaint()
      )
      const typeStart = await page.evaluate(() => performance.now())
      await page.keyboard.type('X'.repeat(typeOps))
      await page.waitForFunction(
        ({ blockIndex, expected, selectedSurface }) =>
          globalThis.__CROSS_EDITOR_HUGE__.typedCount(
            selectedSurface,
            blockIndex
          ) === expected,
        {
          blockIndex: lane.blockIndex,
          expected: typeOps,
          selectedSurface: surface,
        },
        { timeout: 5000 }
      )
      const typePaint = await page.evaluate(() =>
        globalThis.__CROSS_EDITOR_HUGE__.nextPaint()
      )
      await page.evaluate(
        async ({ blockIndex, selectedSurface }) => {
          await globalThis.__CROSS_EDITOR_HUGE__.assertTyped(
            selectedSurface,
            blockIndex
          )
        },
        { blockIndex: lane.blockIndex, selectedSurface: surface }
      )
      const snapshot = await page.evaluate((selectedSurface) => {
        return globalThis.__CROSS_EDITOR_HUGE__.snapshot(selectedSurface)
      }, surface)

      if (iteration > 0) {
        samples.push({
          burstToPaintMs: typePaint - typeStart,
          burstToPaintPerOpMs: (typePaint - typeStart) / typeOps,
          domNodes: snapshot.domNodes,
          heapMB: snapshot.heapMB,
          longTaskMaxMs: snapshot.longTaskMaxMs,
          materializedSelectToPaintMs:
            materializedSelectPaint - materializedSelectStart,
          observedBlocks: snapshot.observedBlocks,
          selectToPaintMs: selectPaint - selectStart,
          typeToPaintMs: typePaint - typeStart,
        })
      }

      latestSnapshot = snapshot
    }

    laneSummaries[lane.key] = {
      blockIndex: lane.blockIndex,
      burstToPaintMs: summarizeMetric(samples, 'burstToPaintMs'),
      burstToPaintPerOpMs: summarizeMetric(samples, 'burstToPaintPerOpMs'),
      domNodes: summarizeMetric(samples, 'domNodes'),
      heapMB: summarizeMetric(samples, 'heapMB'),
      longTaskMaxMs: summarizeMetric(samples, 'longTaskMaxMs'),
      materializedSelectToPaintMs: summarizeMetric(
        samples,
        'materializedSelectToPaintMs'
      ),
      observedBlocks: summarizeMetric(samples, 'observedBlocks'),
      selectToPaintMs: summarizeMetric(samples, 'selectToPaintMs'),
      typeToPaintMs: summarizeMetric(samples, 'typeToPaintMs'),
    }
  }

  return {
    latestSnapshot,
    lanes: laneSummaries,
  }
}

const printSurface = (surface, summary) => {
  console.log(`\n${surface}`)

  for (const [laneName, lane] of Object.entries(summary.lanes)) {
    console.log(
      `${laneName}: typeToPaintMs p95=${round(
        lane.typeToPaintMs.p95
      )}, burstToPaintPerOpMs p95=${round(
        lane.burstToPaintPerOpMs.p95
      )}, materializedSelectToPaintMs p95=${round(
        lane.materializedSelectToPaintMs.p95
      )}, selectToPaintMs p95=${round(
        lane.selectToPaintMs.p95
      )}, longTaskMaxMs p95=${round(
        lane.longTaskMaxMs.p95
      )}, domNodes p95=${round(lane.domNodes.p95)}, heapMB p95=${round(
        lane.heapMB.p95
      )}`
    )
  }
}

const { htmlSource } = await buildBrowserBundle()
const browser = await chromium.launch({ headless })

try {
  const page = await browser.newPage()
  await page.setContent(htmlSource, { waitUntil: 'load' })
  await page.waitForFunction(() => globalThis.__CROSS_EDITOR_HUGE_READY__)

  const surfaces = {}

  for (const surface of selectedSurfaces) {
    surfaces[surface] = await measureSurface({ page, surface })
    printSurface(surface, surfaces[surface])
  }

  const summary = {
    artifactPaths: {
      latest: latestArtifactPath,
      run: runArtifactPath,
    },
    config: {
      blocks,
      iterations,
      lexicalRepo,
      prosemirrorRepo,
      surfaces: Array.from(selectedSurfaces),
      typeOps,
    },
    lane: 'slate-react-huge-document-cross-editor',
    surfaces,
  }

  await writeBenchmarkArtifact(latestArtifactPath, summary)
  await writeBenchmarkArtifact(runArtifactPath, summary)

  const surfaceP95 = (surfaceSummary, metric) =>
    Math.max(
      ...Object.values(surfaceSummary.lanes).map((lane) => lane[metric].p95)
    )

  for (const [surface, surfaceSummary] of Object.entries(surfaces)) {
    const burstToPaintPerOpP95 = surfaceP95(
      surfaceSummary,
      'burstToPaintPerOpMs'
    )
    const domNodesP95 = surfaceP95(surfaceSummary, 'domNodes')
    const longTaskMaxP95 = surfaceP95(surfaceSummary, 'longTaskMaxMs')
    const materializedSelectToPaintP95 = surfaceP95(
      surfaceSummary,
      'materializedSelectToPaintMs'
    )
    const selectToPaintP95 = surfaceP95(surfaceSummary, 'selectToPaintMs')
    const typeToPaintP95 = surfaceP95(surfaceSummary, 'typeToPaintMs')

    console.log(
      `METRIC react_huge_doc_cross_editor_${surface}_burst_to_paint_per_op_p95_ms=${round(
        burstToPaintPerOpP95
      )}`
    )
    console.log(
      `METRIC react_huge_doc_cross_editor_${surface}_type_to_paint_p95_ms=${round(
        typeToPaintP95
      )}`
    )
    console.log(
      `METRIC react_huge_doc_cross_editor_${surface}_select_to_paint_p95_ms=${round(
        selectToPaintP95
      )}`
    )
    console.log(
      `METRIC react_huge_doc_cross_editor_${surface}_materialized_select_to_paint_p95_ms=${round(
        materializedSelectToPaintP95
      )}`
    )
    console.log(
      `METRIC react_huge_doc_cross_editor_${surface}_dom_nodes_p95=${round(
        domNodesP95
      )}`
    )
    console.log(
      `METRIC react_huge_doc_cross_editor_${surface}_long_task_max_p95_ms=${round(
        longTaskMaxP95
      )}`
    )
  }

  console.log(`\nWrote ${runArtifactPath}`)
} finally {
  await browser.close()
}
