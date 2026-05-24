import {
  getEditorRuntime,
  setEditorRuntime,
} from '../../src/core/editor-runtime'

const initializedEditors = new WeakSet()

export const withTest = (editor) => {
  if (initializedEditors.has(editor)) {
    return editor
  }

  editor.extend({
    name: 'fixture-schema',
    elements: [
      {
        type: 'legacy-inline-flag',
        inline: true,
        match: (element) => element.inline === true,
      },
      {
        type: 'legacy-void-flag',
        void: 'block',
        match: (element) => element.void === true,
      },
      {
        type: 'legacy-read-only-flag',
        readOnly: true,
        match: (element) => element.readOnly === true,
      },
      {
        type: 'legacy-non-selectable-flag',
        selectable: false,
        match: (element) => element.nonSelectable === true,
      },
    ],
  })

  initializedEditors.add(editor)

  return editor
}

export const createFixtureTransactionApi = (editor, tx) => {
  const runtime = getEditorRuntime(editor)

  const api = {
    extend: (extension) => editor.extend(extension),
    fragment: tx.fragment,
    marks: tx.marks,
    nodes: tx.nodes,
    operations: tx.operations,
    points: tx.points,
    ranges: tx.ranges,
    runtime: tx.runtime,
    schema: tx.schema,
    selection: tx.selection,
    text: tx.text,
    value: tx.value,
    get children() {
      return tx.value.get().roots.main
    },
    normalize: tx.normalize,
    withoutNormalizing: tx.withoutNormalizing,
  }

  setEditorRuntime(api, runtime)

  return api
}
