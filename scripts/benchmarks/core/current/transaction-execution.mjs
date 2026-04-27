import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'

import { createEditor, Editor } from '../../../../packages/slate/src/index.ts'

const iterations = Number.parseInt(
  process.env.SLATE_6038_ITERATIONS ?? '200',
  10
)
const blocks = Number.parseInt(process.env.SLATE_6038_BLOCKS ?? '8', 10)

const createParagraph = (index) => ({
  type: 'paragraph',
  children: [{ text: `node-${String(index).padStart(2, '0')}` }],
})

const createChildren = (count) =>
  Array.from({ length: count }, (_, index) => createParagraph(index))

const createBatchOps = (count) => [
  {
    type: 'insert_text',
    path: [0, 0],
    offset: 0,
    text: 'x',
  },
  {
    type: 'set_node',
    path: [1],
    properties: {},
    newProperties: { id: 'changed' },
  },
  {
    type: 'insert_node',
    path: [count],
    node: createParagraph(count),
  },
  {
    type: 'split_node',
    path: [2, 0],
    position: 4,
    properties: {},
  },
  {
    type: 'move_node',
    path: [count],
    newPath: [1],
  },
  {
    type: 'remove_text',
    path: [3, 0],
    offset: 1,
    text: 'ode-03',
  },
]

const resetEditor = (editor, children) => {
  Editor.replace(editor, {
    children,
    selection: null,
    marks: null,
  })
}

const snapshotJson = (editor) =>
  JSON.stringify(Editor.getSnapshot(editor).children)

const runWithTransaction = (children, ops) => {
  const editor = createEditor()
  resetEditor(editor, children)

  const start = performance.now()
  Editor.withTransaction(editor, () => {
    for (const operation of ops) {
      editor.apply(structuredClone(operation))
    }
  })
  const end = performance.now()

  return {
    elapsedMs: end - start,
    snapshot: snapshotJson(editor),
  }
}

const runApplyBatch = (children, ops) => {
  const editor = createEditor()
  resetEditor(editor, children)

  const start = performance.now()
  editor.applyOperations(structuredClone(ops))
  const end = performance.now()

  return {
    elapsedMs: end - start,
    snapshot: snapshotJson(editor),
  }
}

const children = createChildren(blocks)
const ops = createBatchOps(blocks)

const withTransactionSamples = []
const applyBatchSamples = []

for (let index = 0; index < iterations; index += 1) {
  const manualTransaction = runWithTransaction(children, ops)
  const applyBatch = runApplyBatch(children, ops)

  if (manualTransaction.snapshot !== applyBatch.snapshot) {
    throw new Error('6038 benchmark lane produced divergent final snapshots')
  }

  withTransactionSamples.push(manualTransaction.elapsedMs)
  applyBatchSamples.push(applyBatch.elapsedMs)
}

const mean = (values) =>
  values.reduce((sum, value) => sum + value, 0) / values.length

const result = {
  benchmark: 'slate-6038-transaction-execution',
  iterations,
  blocks,
  withTransactionMeanMs: mean(withTransactionSamples),
  applyBatchMeanMs: mean(applyBatchSamples),
  deltaMs: mean(withTransactionSamples) - mean(applyBatchSamples),
}

const outputPath = resolve('tmp/bench-slate-6038.json')
mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`)

console.log(JSON.stringify(result, null, 2))
