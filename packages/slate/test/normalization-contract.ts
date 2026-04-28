import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  createEditor,
  type Descendant,
  Editor,
  Node,
  type NodeEntry,
  type Element as SlateElement,
} from '../src'

const bodyParagraph = (text = ''): Descendant => ({
  type: 'paragraph',
  children: [{ text }],
})

const createForcedLayoutTitle = (): Descendant => ({
  type: 'title',
  children: [{ text: 'Untitled' }],
})

const createForcedLayoutParagraph = (): Descendant => ({
  type: 'paragraph',
  children: [{ text: '' }],
})

const withForcedLayout = (editor: ReturnType<typeof createEditor>) => {
  const { normalizeNode } = editor

  editor.normalizeNode = (entry: NodeEntry, options) => {
    const [_node, path] = entry

    if (path.length === 0) {
      if (
        Editor.getChildren(editor).length <= 1 &&
        Editor.string(editor, [0, 0]) === ''
      ) {
        editor.insertNodes(createForcedLayoutTitle(), {
          at: [...path, 0],
          select: true,
        })
      }

      if (Editor.getChildren(editor).length < 2) {
        editor.insertNodes(createForcedLayoutParagraph(), {
          at: [...path, 1],
        })
      }

      for (const [child, childPath] of Node.children(editor, path)) {
        const slateIndex = childPath[0]
        const enforceType = (type: 'title' | 'paragraph') => {
          if (Node.isElement(child) && child.type !== type) {
            editor.setNodes<SlateElement>(
              { type },
              {
                at: childPath,
              }
            )
          }
        }

        switch (slateIndex) {
          case 0:
            enforceType('title')
            break
          case 1:
            enforceType('paragraph')
            break
          default:
            break
        }
      }
    }

    return normalizeNode(entry, options)
  }

  return editor
}

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

  it('supports app-owned block normalization that inserts custom blocks and normalizes them', () => {
    const editor = createEditor()
    const originalNormalizeNode = editor.normalizeNode

    editor.normalizeNode = (entry, options) => {
      const [node, path] = entry

      if (
        !Editor.isEditor(node) &&
        'children' in node &&
        node.type === 'body' &&
        node.children.length === 0
      ) {
        editor.insertNodes(bodyParagraph(), { at: [...path, 0] })
        return
      }

      originalNormalizeNode(entry, options)
    }

    Editor.replace(editor, {
      children: [{ type: 'body', children: [] } as Descendant],
      selection: null,
      marks: null,
    })

    assert.deepEqual(Editor.getSnapshot(editor).children, [
      {
        type: 'body',
        children: [bodyParagraph()],
      },
    ])
  })

  it('supports app-owned forced layout through a real wrapper', () => {
    const editor = withForcedLayout(createEditor())

    Editor.replace(editor, {
      children: [
        {
          type: 'paragraph',
          children: [{ text: '' }],
        },
      ] as Descendant[],
      selection: null,
      marks: null,
    })

    assert.deepEqual(Editor.getSnapshot(editor).children, [
      createForcedLayoutTitle(),
      {
        type: 'paragraph',
        children: [{ text: '' }],
      },
    ])
  })

  it('supports app-owned descendant-level normalization with supported transforms', () => {
    const editor = createEditor()
    const originalNormalizeNode = editor.normalizeNode

    editor.normalizeNode = (entry, options) => {
      const [node, path] = entry

      if (path.length > 0 && 'children' in node && node.type === 'heading') {
        editor.setNodes<SlateElement>(
          {
            type: 'paragraph',
          },
          { at: path }
        )
        return
      }

      originalNormalizeNode(entry, options)
    }

    Editor.replace(editor, {
      children: [
        {
          type: 'heading',
          children: [{ text: 'nested' }],
        },
      ] as Descendant[],
      selection: null,
      marks: null,
    })

    assert.deepEqual(Editor.getSnapshot(editor).children, [
      {
        type: 'paragraph',
        children: [{ text: 'nested' }],
      },
    ])
  })

  it('supports app-owned delegation into core fallbackElement wrapping', () => {
    const editor = createEditor()
    const originalNormalizeNode = editor.normalizeNode

    editor.isInline = (element) => element.type === 'chip'
    editor.normalizeNode = (entry, options) => {
      originalNormalizeNode(entry, {
        ...options,
        fallbackElement: () => ({
          type: 'paragraph',
          children: [{ text: '' }],
        }),
      })
    }

    Editor.replace(editor, {
      children: [
        { text: 'alpha' } as Descendant,
        {
          type: 'chip',
          children: [{ text: 'beta' }],
        },
      ],
      selection: null,
      marks: null,
    })

    assert.deepEqual(Editor.getSnapshot(editor).children, [
      {
        type: 'paragraph',
        children: [{ text: 'alpha' }],
      },
      {
        type: 'paragraph',
        children: [
          { text: '' },
          {
            type: 'chip',
            children: [{ text: 'beta' }],
          },
          { text: '' },
        ],
      },
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

    editor.insertNodes({ text: 'stray' }, { at: [0] })

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

    editor.insertNodes(
      {
        type: 'paragraph',
        children: [{ text: 'beta' }],
      } as Descendant,
      { at: [0, 1] }
    )

    assert.deepEqual(Editor.getSnapshot(editor).children, [
      {
        type: 'paragraph',
        children: [{ text: 'alpha' }, { text: 'beta' }, { text: 'gamma' }],
      },
    ])
  })
})
