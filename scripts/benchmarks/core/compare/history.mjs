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
  process.env.HISTORY_BENCH_LEGACY_REPO || '../slate'
)

const iterations = Number(process.env.HISTORY_BENCH_ITERATIONS || 3)
const blocks = Number(process.env.HISTORY_BENCH_BLOCKS || 5000)
const typeOps = Number(process.env.HISTORY_BENCH_TYPE_OPS || 20)
const fragmentBlocks = Number(process.env.HISTORY_BENCH_FRAGMENT_BLOCKS || 200)

const benchmarkSource = `
import assert from 'node:assert/strict';
import * as Slate from 'slate';
import { withHistory } from 'slate-history';

const { createEditor, Editor } = Slate;

const iterations = Number(process.env.HISTORY_BENCH_ITERATIONS || 3);
const blocks = Number(process.env.HISTORY_BENCH_BLOCKS || 5000);
const typeOps = Number(process.env.HISTORY_BENCH_TYPE_OPS || 20);
const fragmentBlocks = Number(process.env.HISTORY_BENCH_FRAGMENT_BLOCKS || 200);

const now = () => performance.now();
const round = (value) => Number(value.toFixed(2));

const summarize = (samples) => {
  const sorted = [...samples].sort((left, right) => left - right);
  const mean = samples.reduce((total, sample) => total + sample, 0) / samples.length;
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle];

  return {
    samples: samples.map(round),
    mean: round(mean),
    median: round(median),
    min: round(sorted[0] ?? 0),
    max: round(sorted.at(-1) ?? 0),
  };
};

const createChildren = (count) =>
  Array.from({ length: count }, (_, index) => ({
    type: 'paragraph',
    children: [{ text: \`block-\${index}\` }],
  }));

const createFragment = (count) =>
  Array.from({ length: count }, (_, index) => ({
    type: 'paragraph',
    children: [{ text: \`fragment-\${index}\` }],
  }));

const withHistoryEditor = () => withHistory(createEditor());

const replaceEditor = (editor, input) => {
  if (typeof Editor.replace === 'function') {
    Editor.replace(editor, input);
    return;
  }

  editor.children = input.children;
  editor.selection = input.selection ?? null;
  editor.marks = input.marks ?? null;
};

const getChildren = (editor) =>
  typeof editor.getChildren === 'function' ? editor.getChildren() : editor.children;

const write = (editor, fn) => {
  if (typeof editor.update === 'function') {
    editor.update(fn);
    return;
  }

  fn();
};

const typeEditor = () => {
  const editor = withHistoryEditor();

  replaceEditor(editor, {
    children: createChildren(blocks),
    selection: {
      anchor: { path: [0, 0], offset: 7 },
      focus: { path: [0, 0], offset: 7 },
    },
  });

  write(editor, () => {
    for (let index = 0; index < typeOps; index += 1) {
      editor.insertText('X');
    }
  });

  assert.equal(editor.history.undos.length > 0, true);

  return editor;
};

const fragmentEditor = () => {
  const editor = withHistoryEditor();

  replaceEditor(editor, {
    children: createChildren(blocks),
    selection: {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    },
  });

  write(editor, () => {
    editor.insertFragment(createFragment(fragmentBlocks));
  });

  assert.equal(editor.history.undos.length > 0, true);
  editor.__fragmentChildrenLength = getChildren(editor).length;

  return editor;
};

const measureLane = (setup, run, assertFn) => {
  const samples = [];

  for (let iteration = 0; iteration < iterations + 1; iteration += 1) {
    const editor = setup();
    const start = now();
    run(editor);
    const duration = now() - start;
    assertFn(editor);

    if (iteration > 0) {
      samples.push(duration);
    }
  }

  return summarize(samples);
};

const typingUndoMs = measureLane(
  typeEditor,
  (editor) => editor.undo(),
  (editor) => {
    assert.equal(editor.history.redos.length > 0, true);
    assert.equal(
      getChildren(editor)[0]?.children[0]?.text,
      'block-0'
    );
  }
);

const typingRedoMs = measureLane(
  () => {
    const editor = typeEditor();
    editor.undo();
    return editor;
  },
  (editor) => editor.redo(),
  (editor) => {
    assert.equal(editor.history.undos.length > 0, true);
    assert.equal(
      getChildren(editor)[0]?.children[0]?.text.startsWith('block-0'),
      true
    );
  }
);

const fragmentUndoMs = measureLane(
  fragmentEditor,
  (editor) => editor.undo(),
  (editor) => {
    assert.equal(editor.history.redos.length > 0, true);
    assert.equal(getChildren(editor).length, blocks);
  }
);

const fragmentRedoMs = measureLane(
  () => {
    const editor = fragmentEditor();
    editor.undo();
    return editor;
  },
  (editor) => editor.redo(),
  (editor) => {
    assert.equal(editor.history.undos.length > 0, true);
    assert.equal(
      getChildren(editor).length,
      editor.__fragmentChildrenLength
    );
  }
);

console.log(JSON.stringify({
  iterations,
  config: {
    blocks,
    typeOps,
    fragmentBlocks,
  },
  lanes: {
    typingUndoMs,
    typingRedoMs,
    fragmentUndoMs,
    fragmentRedoMs,
  },
}));
`

const currentPackageManager = await parsePackageManager(currentRepo)
const legacyPackageManager = await parsePackageManager(legacyRepo)

await buildRepo(currentRepo, currentPackageManager, './packages/slate-history')
await buildRepo(legacyRepo, legacyPackageManager, './packages/slate-history')

const env = {
  HISTORY_BENCH_ITERATIONS: String(iterations),
  HISTORY_BENCH_BLOCKS: String(blocks),
  HISTORY_BENCH_TYPE_OPS: String(typeOps),
  HISTORY_BENCH_FRAGMENT_BLOCKS: String(fragmentBlocks),
}

const current = await benchmarkRepo({
  benchmarkSource,
  env,
  packageManager: currentPackageManager,
  repo: currentRepo,
})
const legacy = await benchmarkRepo({
  benchmarkSource,
  env,
  packageManager: legacyPackageManager,
  repo: legacyRepo,
})

const summary = {
  lane: 'history-compare-local',
  currentRepo,
  legacyRepo,
  iterations,
  config: {
    blocks,
    typeOps,
    fragmentBlocks,
  },
  current: current.lanes,
  legacy: legacy.lanes,
  deltaMeanMs: {
    typingUndoMs: round(
      current.lanes.typingUndoMs.mean - legacy.lanes.typingUndoMs.mean
    ),
    typingRedoMs: round(
      current.lanes.typingRedoMs.mean - legacy.lanes.typingRedoMs.mean
    ),
    fragmentUndoMs: round(
      current.lanes.fragmentUndoMs.mean - legacy.lanes.fragmentUndoMs.mean
    ),
    fragmentRedoMs: round(
      current.lanes.fragmentRedoMs.mean - legacy.lanes.fragmentRedoMs.mean
    ),
  },
}

await writeBenchmarkArtifact(
  'tmp/slate-history-compare-benchmark.json',
  summary
)

console.log(JSON.stringify(summary, null, 2))
