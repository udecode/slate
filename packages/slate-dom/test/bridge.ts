import { JSDOM } from 'jsdom'
import {
  createEditor,
  type Descendant,
  type Node,
  type Point,
  ElementApi as SlateElement,
} from 'slate'
import { Editor } from 'slate/internal'

import {
  dom,
  EDITOR_TO_ELEMENT,
  EDITOR_TO_KEY_TO_ELEMENT,
  EDITOR_TO_WINDOW,
  ELEMENT_TO_NODE,
  IS_NODE_MAP_DIRTY,
  NODE_TO_ELEMENT,
  NODE_TO_INDEX,
  NODE_TO_PARENT,
  NODE_TO_RUNTIME_ID,
} from '../src/index'

const createParagraphEditor = (text = 'alpha beta') => {
  const editor = createEditor({ extensions: [dom()] })

  Editor.replace(editor, {
    children: [
      {
        type: 'paragraph',
        children: [{ text }],
      },
    ] satisfies Descendant[],
  })

  seedNodeMaps(
    editor,
    editor.read((state) =>
      state.value
        .get()
        .map((_, index) => state.nodes.get([index])[0] as Descendant)
    )
  )

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

const bindTextOwner = (editor: any, path: number[], owner: HTMLElement) => {
  owner.setAttribute('data-slate-node', 'text')

  const [node] = editor.read((state) => state.nodes.get(path))
  const key = editor.api.dom.findKey(node)

  EDITOR_TO_KEY_TO_ELEMENT.get(editor)!.set(key, owner)
  ELEMENT_TO_NODE.set(owner, node)
  NODE_TO_ELEMENT.set(node, owner)
}

describe('slate-dom bridge', () => {
  it('does not mark node maps dirty for selection-only operations', () => {
    const editor = createParagraphEditor()

    IS_NODE_MAP_DIRTY.set(editor, false)

    editor.update((tx) => {
      tx.selection.set({ path: [0, 0], offset: 5 })
    })

    expect(IS_NODE_MAP_DIRTY.get(editor)).toBe(false)

    editor.update((tx) => {
      tx.text.insert('!')
    })

    expect(IS_NODE_MAP_DIRTY.get(editor)).toBe(true)
  })

  it('resolves mounted Slate DOM nodes by path when weak maps are missing', () => {
    withDom(({ document }) => {
      const editor = createParagraphEditor()
      const root = mountEditorRoot(editor, document)
      const paragraph = document.createElement('p')
      const textOwner = document.createElement('span')
      const [paragraphNode] = editor.read((state) => state.nodes.get([0]))
      const [textNode] = editor.read((state) => state.nodes.get([0, 0]))

      paragraph.setAttribute('data-slate-node', 'element')
      paragraph.setAttribute('data-slate-path', '0')
      textOwner.setAttribute('data-slate-node', 'text')
      textOwner.setAttribute('data-slate-path', '0,0')
      paragraph.appendChild(textOwner)
      root.appendChild(paragraph)

      expect(editor.api.dom.assertSlateNode(paragraph)).toBe(paragraphNode)
      expect(editor.api.dom.assertSlateNode(textOwner)).toBe(textNode)
    })
  })

  it('resolves mounted DOM nodes from Slate nodes by runtime path when weak maps lag', () => {
    withDom(({ document }) => {
      const editor = createParagraphEditor()
      const root = mountEditorRoot(editor, document)
      const owner = document.createElement('span')
      const leaf = document.createElement('span')
      const string = document.createElement('span')
      const domText = document.createTextNode('alpha beta')
      const [textNode] = editor.read((state) => state.nodes.get([0, 0]))

      owner.setAttribute('data-slate-node', 'text')
      owner.setAttribute('data-slate-path', '0,0')
      owner.setAttribute(
        'data-slate-runtime-id',
        Editor.getRuntimeId(editor, [0, 0])!
      )
      leaf.setAttribute('data-slate-leaf', 'true')
      string.setAttribute('data-slate-string', 'true')

      string.appendChild(domText)
      leaf.appendChild(string)
      owner.appendChild(leaf)
      root.appendChild(owner)

      expect(editor.api.dom.assertDOMNode(textNode)).toBe(owner)
      expect(
        editor.api.dom.assertDOMPoint({ path: [0, 0], offset: 5 })
      ).toEqual([domText, 5])
    })
  })

  it('resolves Slate node paths when user code attaches custom metadata', () => {
    const editor = createParagraphEditor() as ReturnType<
      typeof createParagraphEditor
    > & {
      customMetadata?: unknown[]
    }
    const [textNode] = editor.read((state) => state.nodes.get([0, 0]))

    editor.customMetadata = [
      {
        type: 'custom_metadata',
        path: [0],
      },
    ]

    expect(editor.api.dom.assertPath(textNode)).toEqual([0, 0])
  })

  it('resolves Slate node paths by runtime id before stale weak-map indexes', () => {
    const editor = createEditor({ extensions: [dom()] })

    Editor.replace(editor, {
      children: [
        { type: 'paragraph', children: [{ text: 'first' }] },
        { type: 'paragraph', children: [{ text: 'target' }] },
      ] satisfies Descendant[],
    })

    seedNodeMaps(
      editor,
      editor.read((state) =>
        state.value
          .get()
          .map((_, index) => state.nodes.get([index])[0] as Descendant)
      )
    )

    const [targetNode] = editor.read((state) => state.nodes.get([1]))
    const runtimeId = Editor.getRuntimeId(editor, [1])

    expect(runtimeId).toBeTruthy()
    NODE_TO_RUNTIME_ID.set(targetNode, runtimeId!)

    editor.update((tx) => {
      tx.nodes.insert(
        { type: 'paragraph', children: [{ text: 'inserted' }] } as never,
        { at: [0] }
      )
    })

    expect(Editor.getPathByRuntimeId(editor, runtimeId!)).toEqual([2])
    expect(editor.api.dom.assertPath(targetNode)).toEqual([2])
  })

  it('resolves Slate points by mounted DOM path when node path maps lag', () => {
    withDom(({ document }) => {
      const editor = createParagraphEditor()
      const root = mountEditorRoot(editor, document)
      const owner = document.createElement('span')
      const leaf = document.createElement('span')
      const string = document.createElement('span')
      const domText = document.createTextNode('alpha beta')
      const [textNode] = editor.read((state) => state.nodes.get([0, 0]))

      owner.setAttribute('data-slate-node', 'text')
      owner.setAttribute('data-slate-path', '0,0')
      owner.setAttribute(
        'data-slate-runtime-id',
        Editor.getRuntimeId(editor, [0, 0])!
      )
      leaf.setAttribute('data-slate-leaf', 'true')
      string.setAttribute('data-slate-string', 'true')

      string.appendChild(domText)
      leaf.appendChild(string)
      owner.appendChild(leaf)
      root.appendChild(owner)
      NODE_TO_INDEX.delete(textNode)
      NODE_TO_PARENT.delete(textNode)

      expect(
        editor.api.dom.assertDOMPoint({ path: [0, 0], offset: 5 })
      ).toEqual([domText, 5])
    })
  })

  it('does not resolve path-tagged DOM nodes outside the editor', () => {
    withDom(({ document }) => {
      const editor = createParagraphEditor()
      mountEditorRoot(editor, document)

      const foreign = document.createElement('p')
      foreign.setAttribute('data-slate-node', 'element')
      foreign.setAttribute('data-slate-path', '0')

      expect(() => editor.api.dom.assertSlateNode(foreign)).toThrow(
        'Cannot resolve a Slate node from DOM node'
      )
    })
  })

  it('keeps empty DOM selection ranges strict unless runtime callers suppress throws', () => {
    withDom(({ document }) => {
      const editor = createParagraphEditor()
      mountEditorRoot(editor, document)
      const domSelection = document.getSelection()

      if (!domSelection) {
        throw new Error('Expected DOM selection')
      }

      domSelection.removeAllRanges()

      expect(() =>
        editor.api.dom.assertSlateRange(domSelection, {
          exactMatch: false,
        })
      ).toThrow('Cannot resolve a Slate range from DOM range')
      expect(
        editor.api.dom.resolveSlateRange(domSelection, {
          exactMatch: false,
        })
      ).toBeNull()
    })
  })

  it('resolves recoverable DOM bridge gaps to null while strict APIs still throw', () => {
    const editor = createParagraphEditor()
    const [textNode] = editor.read((state) => state.nodes.get([0, 0]))
    const range = {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    }

    expect(() => editor.api.dom.assertDOMNode(textNode)).toThrow(
      'Cannot resolve a DOM node from Slate node'
    )
    expect(editor.api.dom.resolveDOMNode(textNode)).toBeNull()
    expect(() => editor.api.dom.assertDOMRange(range)).toThrow()
    expect(editor.api.dom.resolveDOMRange(range)).toBeNull()
    expect(editor.api.dom.resolvePath({ text: 'detached' })).toBeNull()
  })

  it('keeps parent and nested editor DOM point ownership separate', () => {
    withDom(({ document }) => {
      const parent = createParagraphEditor('parent')
      const nested = createParagraphEditor('nested')
      const parentRoot = mountEditorRoot(parent, document)
      const nestedRoot = mountEditorRoot(nested, document)
      const nestedOwner = document.createElement('span')
      const nestedLeaf = document.createElement('span')
      const nestedString = document.createElement('span')
      const nestedText = document.createTextNode('nested')

      parentRoot.appendChild(nestedRoot)
      nestedLeaf.setAttribute('data-slate-leaf', 'true')
      nestedString.setAttribute('data-slate-string', 'true')
      nestedString.appendChild(nestedText)
      nestedLeaf.appendChild(nestedString)
      nestedOwner.appendChild(nestedLeaf)
      nestedRoot.appendChild(nestedOwner)
      bindTextOwner(nested, [0, 0], nestedOwner)

      expect(parent.api.dom.hasDOMNode(nestedText)).toBe(false)
      expect(nested.api.dom.hasDOMNode(nestedText)).toBe(true)
      expect(() => parent.api.dom.assertSlateNode(nestedOwner)).toThrow()
      expect(
        nested.api.dom.assertSlatePoint([nestedText, 3], {
          exactMatch: false,
        })
      ).toEqual<Point>({
        path: [0, 0],
        offset: 3,
      })
      expect(() =>
        parent.api.dom.assertSlatePoint([nestedText, 3], {
          exactMatch: false,
        })
      ).toThrow()
      expect(
        parent.api.dom.resolveSlatePoint([nestedText, 3], {
          exactMatch: false,
        })
      ).toBeNull()
    })
  })

  it('resolves event ranges from browser caret ranges when the event target is editor-owned but unmapped', () => {
    withDom(({ document }) => {
      const editor = createParagraphEditor()
      const root = mountEditorRoot(editor, document)
      const paragraph = document.createElement('p')
      const owner = document.createElement('span')
      const leaf = document.createElement('span')
      const string = document.createElement('span')
      const domText = document.createTextNode('alpha beta')

      paragraph.setAttribute('data-slate-node', 'element')
      owner.setAttribute('data-slate-node', 'text')
      owner.setAttribute('data-slate-path', '0,0')
      owner.setAttribute(
        'data-slate-runtime-id',
        Editor.getRuntimeId(editor, [0, 0])!
      )
      leaf.setAttribute('data-slate-leaf', 'true')
      string.setAttribute('data-slate-string', 'true')

      string.appendChild(domText)
      leaf.appendChild(string)
      owner.appendChild(leaf)
      paragraph.appendChild(owner)
      root.appendChild(paragraph)

      const caretRange = document.createRange()
      caretRange.setStart(domText, 5)
      caretRange.setEnd(domText, 5)
      ;(document as any).caretRangeFromPoint = () => caretRange

      expect(
        editor.api.dom.assertEventRange({
          clientX: 0,
          clientY: 0,
          target: paragraph,
        })
      ).toEqual({
        anchor: { path: [0, 0], offset: 5 },
        focus: { path: [0, 0], offset: 5 },
      })
    })
  })

  it('treats editor-owned unmapped DOM targets as non-void instead of throwing', () => {
    withDom(({ document }) => {
      const editor = createParagraphEditor()
      const root = mountEditorRoot(editor, document)
      const staleParagraph = document.createElement('p')

      staleParagraph.setAttribute('data-slate-node', 'element')
      root.appendChild(staleParagraph)

      expect(() =>
        editor.api.dom.isTargetInsideNonReadonlyVoid(staleParagraph)
      ).not.toThrow()
      expect(editor.api.dom.isTargetInsideNonReadonlyVoid(staleParagraph)).toBe(
        false
      )
    })
  })

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
        editor.api.dom.assertSlatePoint([textNode, 1], {
          exactMatch: false,
        })
      ).toEqual<Point>({
        path: [0, 0],
        offset: 0,
      })
    })
  })

  it('clamps non-exact DOM point offsets to the mounted Slate text bounds', () => {
    withDom(({ document }) => {
      const editor = createParagraphEditor('9')
      const root = mountEditorRoot(editor, document)

      const owner = document.createElement('span')
      const leaf = document.createElement('span')
      const string = document.createElement('span')
      const domText = document.createTextNode(
        '9This table is just a basic example of rendering a table'
      )

      leaf.setAttribute('data-slate-leaf', 'true')
      string.setAttribute('data-slate-string', 'true')
      string.appendChild(domText)
      leaf.appendChild(string)
      owner.appendChild(leaf)
      root.appendChild(owner)
      bindTextOwner(editor, [0, 0], owner)

      expect(
        editor.api.dom.assertSlatePoint(
          [domText, domText.textContent!.length],
          {
            exactMatch: false,
          }
        )
      ).toEqual<Point>({
        path: [0, 0],
        offset: 1,
      })
      expect(
        editor.api.dom.resolveSlatePoint(
          [domText, domText.textContent!.length],
          {
            exactMatch: true,
          }
        )
      ).toBeNull()
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
        editor.api.dom.assertDOMPoint({ path: [0, 0], offset: 10 })
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
        editor.api.dom.assertSlateRange(range, {
          exactMatch: false,
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

      const domRange = editor.api.dom.assertDOMRange({
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
