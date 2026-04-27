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
  process.env.CORE_HUGE_BENCH_LEGACY_REPO || '../slate'
)

const iterations = Number(process.env.CORE_HUGE_BENCH_ITERATIONS || 3)
const blocks = Number(process.env.CORE_HUGE_BENCH_BLOCKS || 1000)
const typeOps = Number(process.env.CORE_HUGE_BENCH_TYPE_OPS || 20)
const replacementText = 'replacement marker'

const benchmarkSource = `
import assert from 'node:assert/strict';
import * as Slate from 'slate';

const { createEditor, Editor } = Slate;
const legacyTransforms = Slate.Transforms;

const iterations = Number(process.env.CORE_HUGE_BENCH_ITERATIONS || 3);
const blocks = Number(process.env.CORE_HUGE_BENCH_BLOCKS || 1000);
const typeOps = Number(process.env.CORE_HUGE_BENCH_TYPE_OPS || 20);
const replacementText = ${JSON.stringify(replacementText)};

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

const createFragment = () => [
  {
    type: 'paragraph',
    children: [{ text: replacementText }],
  },
];

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

const getSelection = (editor) =>
  typeof editor.getSelection === 'function' ? editor.getSelection() : editor.selection;

const select = (editor, target) => {
  if (typeof editor.update === 'function') {
    editor.update(() => {
      editor.select(target);
    });
    return;
  }

  legacyTransforms.select(editor, target);
};

const insertText = (editor, text, options) => {
  if (typeof editor.update === 'function') {
    editor.update(() => {
      editor.insertText(text, options);
    });
    return;
  }

  legacyTransforms.insertText(editor, text, options);
};

const insertFragment = (editor, fragment) => {
  if (typeof editor.update === 'function') {
    editor.update(() => {
      editor.insertFragment(fragment);
    });
    return;
  }

  legacyTransforms.insertFragment(editor, fragment);
};

const measureLane = (setup, run) => {
  const samples = [];

  for (let iteration = 0; iteration < iterations + 1; iteration += 1) {
    const editor = setup();
    const start = now();
    run(editor);
    const duration = now() - start;

    if (iteration > 0) {
      samples.push(duration);
    }
  }

  return summarize(samples);
};

const typeAtBlock = (blockIndex) =>
  measureLane(
    () => {
      const editor = createEditor();
      replaceEditor(editor, {
        children: createChildren(blocks),
        selection: null,
      });
      return editor;
    },
    (editor) => {
      for (let index = 0; index < typeOps; index += 1) {
        insertText(editor, 'X', {
          at: { path: [blockIndex, 0], offset: index },
        });
      }

      const typedText = getChildren(editor)[blockIndex]?.children[0]?.text ?? '';
      assert.equal((typedText.match(/X/g) ?? []).length, typeOps);
    }
  );

const replaceFullDocumentWithText = () =>
  measureLane(
    () => {
      const editor = createEditor();
      replaceEditor(editor, {
        children: createChildren(blocks),
        selection: null,
      });
      return editor;
    },
    (editor) => {
      const children = getChildren(editor);
      select(editor, {
        anchor: { path: [0, 0], offset: 0 },
        focus: {
          path: [blocks - 1, 0],
          offset: children[blocks - 1]?.children[0]?.text.length ?? 0,
        },
      });
      insertText(editor, replacementText);

      assert.equal(
        getChildren(editor).map((node) => node.children[0]?.text).join(''),
        replacementText
      );
    }
  );

const insertFragmentFullDocument = () =>
  measureLane(
    () => {
      const editor = createEditor();
      replaceEditor(editor, {
        children: createChildren(blocks),
        selection: null,
      });
      return editor;
    },
    (editor) => {
      const children = getChildren(editor);
      select(editor, {
        anchor: { path: [0, 0], offset: 0 },
        focus: {
          path: [blocks - 1, 0],
          offset: children[blocks - 1]?.children[0]?.text.length ?? 0,
        },
      });
      insertFragment(editor, createFragment());

      assert.equal(
        getChildren(editor).map((node) => node.children[0]?.text).join(''),
        replacementText
      );
    }
  );

const selectAll = () =>
  measureLane(
    () => {
      const editor = createEditor();
      replaceEditor(editor, {
        children: createChildren(blocks),
        selection: null,
      });
      return editor;
    },
    (editor) => {
      const children = getChildren(editor);
      select(editor, {
        anchor: { path: [0, 0], offset: 0 },
        focus: {
          path: [blocks - 1, 0],
          offset: children[blocks - 1]?.children[0]?.text.length ?? 0,
        },
      });

      assert.deepEqual(getSelection(editor)?.anchor, { path: [0, 0], offset: 0 });
    }
  );

const startBlockTypeMs = typeAtBlock(0);
const middleBlockTypeMs = typeAtBlock(Math.floor(blocks / 2));
const replaceFullDocumentWithTextMs = replaceFullDocumentWithText();
const insertFragmentFullDocumentMs = insertFragmentFullDocument();
const selectAllMs = selectAll();

console.log(JSON.stringify({
  iterations,
  config: {
    blocks,
    typeOps,
  },
  lanes: {
    startBlockTypeMs,
    middleBlockTypeMs,
    replaceFullDocumentWithTextMs,
    insertFragmentFullDocumentMs,
    selectAllMs,
  },
}));
`

const currentPackageManager = await parsePackageManager(currentRepo)
const legacyPackageManager = await parsePackageManager(legacyRepo)

await buildRepo(currentRepo, currentPackageManager, './packages/slate')
await buildRepo(legacyRepo, legacyPackageManager, './packages/slate')

const env = {
  CORE_HUGE_BENCH_ITERATIONS: String(iterations),
  CORE_HUGE_BENCH_BLOCKS: String(blocks),
  CORE_HUGE_BENCH_TYPE_OPS: String(typeOps),
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
  lane: 'core-huge-document-compare-local',
  currentRepo,
  legacyRepo,
  iterations,
  config: {
    blocks,
    typeOps,
  },
  current: current.lanes,
  legacy: legacy.lanes,
  deltaMeanMs: {
    startBlockTypeMs: round(
      current.lanes.startBlockTypeMs.mean - legacy.lanes.startBlockTypeMs.mean
    ),
    middleBlockTypeMs: round(
      current.lanes.middleBlockTypeMs.mean - legacy.lanes.middleBlockTypeMs.mean
    ),
    replaceFullDocumentWithTextMs: round(
      current.lanes.replaceFullDocumentWithTextMs.mean -
        legacy.lanes.replaceFullDocumentWithTextMs.mean
    ),
    insertFragmentFullDocumentMs: round(
      current.lanes.insertFragmentFullDocumentMs.mean -
        legacy.lanes.insertFragmentFullDocumentMs.mean
    ),
    selectAllMs: round(
      current.lanes.selectAllMs.mean - legacy.lanes.selectAllMs.mean
    ),
  },
}

await writeBenchmarkArtifact(
  'tmp/slate-core-huge-document-benchmark.json',
  summary
)

console.log(JSON.stringify(summary, null, 2))
