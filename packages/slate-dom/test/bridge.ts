import { JSDOM } from 'jsdom'
import {
  createEditor,
  type Descendant,
  Editor,
  type Node,
  type Point,
  Element as SlateElement,
} from 'slate'

import {
  DOMEditor,
  EDITOR_TO_ELEMENT,
  EDITOR_TO_KEY_TO_ELEMENT,
  EDITOR_TO_WINDOW,
  ELEMENT_TO_NODE,
  NODE_TO_ELEMENT,
  NODE_TO_INDEX,
  NODE_TO_PARENT,
  withDOM,
} from '../src/index'

const createParagraphEditor = (text = 'alpha beta') => {
  const editor = withDOM(createEditor())

  Editor.replace(editor, {
    children: [
      {
        type: 'paragraph',
        children: [{ text }],
      },
    ] satisfies Descendant[],
  })

  seedNodeMaps(editor, editor.getChildren())

  return editor
}

const seedNodeMaps = (editor: Editor, children: Descendant[]) => {
  const visit = (parent: Editor | SlateElement, child: Node, index: number) => {
    NODE_TO_PARENT.set(child, parent)
    NODE_TO_INDEX.set(child, index)

    if (SlateElement.isElement(child)) {
      child.children.forEach((nested, nestedIndex) => {
        visit(child, nested, nestedIndex)
      })
    }
  }

  children.forEach((child, index) => {
    visit(editor, child, index)
  })
}

const createDom = () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>')
  return {
    dom,
    document: dom.window.document,
    window: dom.window,
  }
}

const withDom = (run: (env: ReturnType<typeof createDom>) => void) => {
  const env = createDom()

  try {
    run(env)
  } finally {
    env.dom.window.close()
  }
}

const mountEditorRoot = (
  editor: Editor,
  document: Document,
  root = document.createElement('div')
) => {
  root.setAttribute('data-slate-editor', 'true')
  root.setAttribute('contenteditable', 'true')
  document.body.appendChild(root)

  EDITOR_TO_ELEMENT.set(editor, root)
  EDITOR_TO_WINDOW.set(editor, document.defaultView!)
  ELEMENT_TO_NODE.set(root, editor)
  NODE_TO_ELEMENT.set(editor, root)
  EDITOR_TO_KEY_TO_ELEMENT.set(
    editor,
    EDITOR_TO_KEY_TO_ELEMENT.get(editor) ?? new WeakMap()
  )

  return root
}

const bindTextOwner = (editor: Editor, path: number[], owner: HTMLElement) => {
  owner.setAttribute('data-slate-node', 'text')

  const [node] = Editor.node(editor, path)
  const key = DOMEditor.findKey(editor, node)

  EDITOR_TO_KEY_TO_ELEMENT.get(editor)!.set(key, owner)
  ELEMENT_TO_NODE.set(owner, node)
  NODE_TO_ELEMENT.set(node, owner)
}

describe('slate-dom bridge', () => {
  it('maps a zero-width DOM point back to the Slate start offset', () => {
    withDom(({ document }) => {
      const editor = createParagraphEditor()
      const root = mountEditorRoot(editor, document)

      const owner = document.createElement('span')
      const leaf = document.createElement('span')
      const zeroWidth = document.createElement('span')
      const textNode = document.createTextNode('\uFEFF')

      zeroWidth.setAttribute('data-slate-zero-width', 'z')
      leaf.setAttribute('data-slate-leaf', 'true')
      zeroWidth.appendChild(textNode)
      leaf.appendChild(zeroWidth)
      owner.appendChild(leaf)
      root.appendChild(owner)
      bindTextOwner(editor, [0, 0], owner)

      expect(
        DOMEditor.toSlatePoint(editor, [textNode, 1], {
          exactMatch: false,
          suppressThrow: false,
        })
      ).toEqual<Point>({
        path: [0, 0],
        offset: 0,
      })
    })
  })

  it('maps a collapsed Slate point at the end of text onto the mark placeholder', () => {
    withDom(({ document }) => {
      const editor = createParagraphEditor()
      const root = mountEditorRoot(editor, document)

      const owner = document.createElement('span')
      const textLeaf = document.createElement('span')
      const textSegment = document.createElement('span')
      const textNode = document.createTextNode('alpha beta')
      const placeholderLeaf = document.createElement('span')
      const placeholderSegment = document.createElement('span')
      const placeholderText = document.createTextNode('\uFEFF')

      textSegment.setAttribute('data-slate-string', 'true')
      textSegment.appendChild(textNode)
      textLeaf.appendChild(textSegment)

      placeholderSegment.setAttribute('data-slate-zero-width', 'z')
      placeholderSegment.setAttribute('data-slate-length', '0')
      placeholderSegment.setAttribute('data-slate-mark-placeholder', 'true')
      placeholderSegment.appendChild(placeholderText)
      placeholderLeaf.appendChild(placeholderSegment)

      owner.append(textLeaf, placeholderLeaf)
      root.appendChild(owner)
      bindTextOwner(editor, [0, 0], owner)

      expect(
        DOMEditor.toDOMPoint(editor, { path: [0, 0], offset: 10 })
      ).toEqual([placeholderText, 1])
    })
  })

  it('converts a DOM range across decorated slices back into one Slate text range', () => {
    withDom(({ document }) => {
      const editor = createParagraphEditor()
      const root = mountEditorRoot(editor, document)

      const owner = document.createElement('span')
      const firstLeaf = document.createElement('span')
      const middleLeaf = document.createElement('span')
      const lastLeaf = document.createElement('span')
      const first = document.createElement('span')
      const middle = document.createElement('span')
      const last = document.createElement('span')
      const firstText = document.createTextNode('a')
      const middleText = document.createTextNode('lph')
      const lastText = document.createTextNode('a beta')

      firstLeaf.setAttribute('data-slate-leaf', 'true')
      middleLeaf.setAttribute('data-slate-leaf', 'true')
      lastLeaf.setAttribute('data-slate-leaf', 'true')
      first.setAttribute('data-slate-string', 'true')
      middle.setAttribute('data-slate-string', 'true')
      last.setAttribute('data-slate-string', 'true')

      first.appendChild(firstText)
      middle.appendChild(middleText)
      last.appendChild(lastText)
      firstLeaf.appendChild(first)
      middleLeaf.appendChild(middle)
      lastLeaf.appendChild(last)
      owner.append(firstLeaf, middleLeaf, lastLeaf)
      root.appendChild(owner)
      bindTextOwner(editor, [0, 0], owner)

      const range = document.createRange()
      range.setStart(middleText, 1)
      range.setEnd(lastText, 2)

      expect(
        DOMEditor.toSlateRange(editor, range, {
          exactMatch: false,
          suppressThrow: false,
        })
      ).toEqual({
        anchor: { path: [0, 0], offset: 2 },
        focus: { path: [0, 0], offset: 6 },
      })
    })
  })

  it('adjusts zero-width DOM range offsets when converting a collapsed Slate range', () => {
    withDom(({ document }) => {
      const editor = createParagraphEditor()
      const root = mountEditorRoot(editor, document)

      const owner = document.createElement('span')
      const leaf = document.createElement('span')
      const zeroWidth = document.createElement('span')
      const textNode = document.createTextNode('\uFEFF')

      zeroWidth.setAttribute('data-slate-zero-width', 'z')
      leaf.setAttribute('data-slate-leaf', 'true')
      zeroWidth.appendChild(textNode)
      leaf.appendChild(zeroWidth)
      owner.appendChild(leaf)
      root.appendChild(owner)
      bindTextOwner(editor, [0, 0], owner)

      const domRange = DOMEditor.toDOMRange(editor, {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 0 },
      })

      expect(domRange.startContainer).toBe(textNode)
      expect(domRange.startOffset).toBe(1)
      expect(domRange.endContainer).toBe(textNode)
      expect(domRange.endOffset).toBe(1)
    })
  })
})
