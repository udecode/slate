import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Editor, getEditorRuntime } from 'slate/internal'
import { createEditor, type Descendant } from '../src'

describe('slate normalization contract', () => {
  it('repairs an empty block with an empty text child', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [{ type: 'block', children: [] } as Descendant],
      selection: null,
      marks: null,
    })

    assert.deepEqual(Editor.getSnapshot(editor).children, [
      { type: 'block', children: [{ text: '' }] },
    ])
  })

  it('removes stray top-level text during replace-time block-only cleanup', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [
        { text: 'one' } as Descendant,
        { type: 'block', children: [{ text: 'two' }] } as Descendant,
        { text: 'three' } as Descendant,
        { type: 'block', children: [{ text: 'four' }] } as Descendant,
      ],
      selection: null,
      marks: null,
    })

    assert.deepEqual(Editor.getSnapshot(editor).children, [
      { type: 'block', children: [{ text: 'two' }] },
      { type: 'block', children: [{ text: 'four' }] },
    ])
  })

  it('removes stray top-level text during node-op block-only cleanup', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [
        {
          type: 'block',
          children: [{ text: 'alpha' }],
        },
        {
          type: 'block',
          children: [{ text: 'beta' }],
        },
      ] as Descendant[],
      selection: null,
      marks: null,
    })

    editor.update((tx) => {
      tx.nodes.insert({ text: 'stray' }, { at: [0] })
    })

    assert.deepEqual(Editor.getSnapshot(editor).children, [
      {
        type: 'block',
        children: [{ text: 'alpha' }],
      },
      {
        type: 'block',
        children: [{ text: 'beta' }],
      },
    ])
  })

  it('explicitly merges adjacent compatible text children in inline-style containers', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [
        {
          type: 'paragraph',
          children: [
            { text: 'al', bold: true },
            { text: 'pha', bold: true },
          ],
        },
      ] as Descendant[],
      selection: null,
      marks: null,
    })

    Editor.normalize(editor)

    assert.deepEqual(Editor.getSnapshot(editor).children, [
      {
        type: 'paragraph',
        children: [{ text: 'alpha', bold: true }],
      },
    ])
  })

  it('explicitly removes empty adjacent text in inline-style containers', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [
        {
          type: 'paragraph',
          children: [
            { text: 'alpha', bold: true },
            { text: '', bold: true },
            { text: 'beta', bold: true },
          ],
        },
      ] as Descendant[],
      selection: null,
      marks: null,
    })

    Editor.normalize(editor)

    assert.deepEqual(Editor.getSnapshot(editor).children, [
      {
        type: 'paragraph',
        children: [{ text: 'alphabeta', bold: true }],
      },
    ])
  })

  it('flattens a direct block child inserted into an inline-style container without merging unrelated text runs', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [
        {
          type: 'paragraph',
          children: [{ text: 'alpha' }, { text: 'gamma' }],
        },
      ] as Descendant[],
      selection: null,
      marks: null,
    })

    editor.update((tx) => {
      tx.nodes.insert(
        {
          type: 'paragraph',
          children: [{ text: 'beta' }],
        } as Descendant,
        { at: [0, 1] }
      )
    })

    assert.deepEqual(Editor.getSnapshot(editor).children, [
      {
        type: 'paragraph',
        children: [{ text: 'alpha' }, { text: 'beta' }, { text: 'gamma' }],
      },
    ])
  })

  it('fails deterministically when custom normalization revisits an earlier draft state', () => {
    const editor = createEditor()

    getEditorRuntime(editor).normalizeNode = (entry) => {
      const [node] = entry

      if (!Editor.isEditor(node)) {
        return
      }

      if (Editor.getChildren(editor).length === 1) {
        Editor.insertNodes(
          editor,
          {
            type: 'paragraph',
            children: [{ text: '' }],
          },
          { at: [1] }
        )
        return
      }

      Editor.removeNodes(editor, { at: [1] })
    }

    assert.throws(() => {
      editor.update((tx) => {
        tx.value.replace({
          children: [
            {
              type: 'paragraph',
              children: [{ text: 'alpha' }],
            },
          ],
          marks: null,
          selection: null,
        })
      })
    }, /revisited an earlier draft state/)
  })

  it('rechecks a node transformed during custom normalization until it reaches fixpoint', () => {
    const editor = createEditor()
    const originalNormalizeNode = getEditorRuntime(editor).normalizeNode

    getEditorRuntime(editor).normalizeNode = (entry, options) => {
      const [node, path] = entry

      if (
        path.length === 1 &&
        !Editor.isEditor(node) &&
        'children' in node &&
        node.type === 'heading'
      ) {
        Editor.setNodes(editor, { type: 'paragraph' }, { at: path })
        return
      }

      if (
        path.length === 1 &&
        !Editor.isEditor(node) &&
        'children' in node &&
        node.type === 'paragraph' &&
        (node as Descendant & { normalized?: boolean }).normalized !== true
      ) {
        Editor.setNodes(editor, { normalized: true }, { at: path })
        return
      }

      originalNormalizeNode(entry, options)
    }

    editor.update((tx) => {
      tx.value.replace({
        children: [
          {
            type: 'heading',
            children: [{ text: 'alpha' }],
          },
        ],
        marks: null,
        selection: null,
      })
    })

    assert.deepEqual(Editor.getSnapshot(editor).children, [
      {
        type: 'paragraph',
        normalized: true,
        children: [{ text: 'alpha' }],
      },
    ])
  })
})
