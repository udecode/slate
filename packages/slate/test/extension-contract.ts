import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  createEditor,
  type Descendant,
  Editor,
  Element,
  Node,
  type NodeEntry,
  type Editor as SlateEditor,
  type Element as SlateElement,
  Transforms,
} from '../src'

const createParagraphChildren = (text = 'alpha'): Descendant[] => [
  {
    type: 'paragraph',
    children: [{ text }],
  },
]

const getBlockTexts = (children: readonly Descendant[]) =>
  children.map((child) =>
    'text' in child
      ? child.text
      : child.children
          .map((descendant) => ('text' in descendant ? descendant.text : ''))
          .join('')
  )

const withTrackedInsertBreak = <T extends SlateEditor>(editor: T) => {
  const e = editor as T & {
    getInsertBreakCalls: () => number
  }
  const originalInsertBreak = e.insertBreak
  let calls = 0

  e.insertBreak = () => {
    calls += 1
    originalInsertBreak()
  }

  e.getInsertBreakCalls = () => calls

  return e
}

const createLinkNode = (url: string, text: string): Descendant => ({
  type: 'link',
  url,
  children: [{ text }],
})

const withLinks = <T extends SlateEditor>(editor: T) => {
  const e = editor as T & {
    wrapLinkSelection: (url: string) => boolean
  }
  const { isInline } = editor

  editor.isInline = (element) =>
    element.type === 'link' ? true : isInline(element)

  e.wrapLinkSelection = (url: string) => {
    const { selection } = Editor.getSnapshot(editor)

    if (!selection || selection.anchor.offset === selection.focus.offset) {
      return false
    }

    Transforms.wrapNodes(editor, createLinkNode(url, '') as SlateElement, {
      split: true,
    })

    const currentSelection = Editor.getSnapshot(editor).selection

    if (currentSelection) {
      const linkEntry = Editor.above(editor, {
        at: currentSelection,
        match: (node) => Element.isElement(node) && node.type === 'link',
      })

      if (linkEntry) {
        const [, linkPath] = linkEntry
        const after = Editor.after(editor, linkPath)

        if (after) {
          Transforms.select(editor, after)
        }
      }
    }

    return true
  }

  return e
}

const createMentionNode = (character: string): Descendant => ({
  type: 'mention',
  character,
  children: [{ text: '' }],
})

const withMentions = <T extends SlateEditor>(editor: T) => {
  const e = editor as T & {
    insertMention: (character: string) => boolean
  }
  const { isInline, isVoid, markableVoid } = editor

  editor.isInline = (element) =>
    element.type === 'mention' ? true : isInline(element)
  editor.isVoid = (element) =>
    element.type === 'mention' ? true : isVoid(element)
  editor.markableVoid = (element) =>
    element.type === 'mention' || markableVoid(element)

  e.insertMention = (character: string) => {
    Transforms.insertNodes(editor, createMentionNode(character))
    Transforms.move(editor)

    return true
  }

  return e
}

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
      if (editor.children.length <= 1 && Editor.string(editor, [0, 0]) === '') {
        Transforms.insertNodes(editor, createForcedLayoutTitle(), {
          at: [...path, 0],
          select: true,
        })
      }

      if (editor.children.length < 2) {
        Transforms.insertNodes(editor, createForcedLayoutParagraph(), {
          at: [...path, 1],
        })
      }

      for (const [child, childPath] of Node.children(editor, path)) {
        const slateIndex = childPath[0]
        const enforceType = (type: 'title' | 'paragraph') => {
          if (Node.isElement(child) && child.type !== type) {
            Transforms.setNodes<SlateElement>(
              editor,
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

describe('slate extension contract', () => {
  it('supports primitive behavior interception through overrideable instance methods', () => {
    const editor = withTrackedInsertBreak(createEditor())

    Editor.replace(editor, {
      children: createParagraphChildren(),
      selection: {
        anchor: { path: [0, 0], offset: 5 },
        focus: { path: [0, 0], offset: 5 },
      },
      marks: null,
    })

    Editor.insertBreak(editor)

    assert.equal(editor.getInsertBreakCalls(), 1)
    assert.deepEqual(getBlockTexts(Editor.getSnapshot(editor).children), [
      'alpha',
      '',
    ])
    assert.deepEqual(Editor.getSnapshot(editor).selection, {
      anchor: { path: [1, 0], offset: 0 },
      focus: { path: [1, 0], offset: 0 },
    })
  })

  it('keeps editor.apply as the low-level seam under intercepted editors', () => {
    const editor = withTrackedInsertBreak(createEditor())

    Editor.replace(editor, {
      children: createParagraphChildren(),
      selection: {
        anchor: { path: [0, 0], offset: 5 },
        focus: { path: [0, 0], offset: 5 },
      },
      marks: null,
    })

    editor.apply({
      type: 'insert_text',
      path: [0, 0],
      offset: 5,
      text: '!',
    })

    assert.equal(
      Editor.getSnapshot(editor).children[0].children[0].text,
      'alpha!'
    )
  })

  it('supports inline behavior interception through a link wrapper', () => {
    const editor = withLinks(createEditor())

    Editor.replace(editor, {
      children: createParagraphChildren('link me'),
      selection: {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 4 },
      },
      marks: null,
    })

    assert.equal(editor.wrapLinkSelection('https://example.com'), true)

    const linkNode = Editor.getSnapshot(editor).children[0].children.find(
      Element.isElement
    )

    assert.ok(linkNode)
    assert.equal(editor.isInline(linkNode), true)
    assert.equal(linkNode.type, 'link')
    assert.deepEqual(Editor.getSnapshot(editor).selection, {
      anchor: { path: [0, 2], offset: 0 },
      focus: { path: [0, 2], offset: 0 },
    })
  })

  it('supports domain command extension through a mentions wrapper', () => {
    const editor = withMentions(createEditor())

    Editor.replace(editor, {
      children: createParagraphChildren('hi'),
      selection: {
        anchor: { path: [0, 0], offset: 2 },
        focus: { path: [0, 0], offset: 2 },
      },
      marks: null,
    })

    assert.equal(editor.insertMention('Jabba'), true)

    const mentionNode = Editor.getSnapshot(editor).children[0].children.find(
      Element.isElement
    )

    assert.ok(Element.isElement(mentionNode))
    assert.equal(editor.isInline(mentionNode), true)
    assert.equal(editor.isVoid(mentionNode), true)
    assert.equal(mentionNode.type, 'mention')
  })

  it('supports schema extension through withForcedLayout in headless usage', () => {
    const editor = withForcedLayout(createEditor())

    Editor.replace(editor, {
      children: [
        {
          type: 'paragraph',
          children: [{ text: 'alpha' }],
        },
      ],
      selection: null,
      marks: null,
    })

    const snapshot = Editor.getSnapshot(editor)

    assert.equal(snapshot.children.length, 2)
    assert.equal((snapshot.children[0] as { type: string }).type, 'title')
    assert.equal((snapshot.children[1] as { type: string }).type, 'paragraph')
  })

  it('composes multiple wrappers on one editor instance', () => {
    const editor = withLinks(withTrackedInsertBreak(createEditor()))

    Editor.replace(editor, {
      children: createParagraphChildren('beta'),
      selection: {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 4 },
      },
      marks: null,
    })

    assert.equal(editor.wrapLinkSelection('https://example.com'), true)
    Transforms.select(editor, {
      anchor: { path: [0, 2], offset: 0 },
      focus: { path: [0, 2], offset: 0 },
    })
    Editor.insertBreak(editor)

    assert.equal(editor.getInsertBreakCalls(), 1)
    const linkNode = Editor.getSnapshot(editor).children[0].children.find(
      Element.isElement
    )

    assert.ok(linkNode)
    assert.equal(editor.isInline(linkNode), true)
  })
})
