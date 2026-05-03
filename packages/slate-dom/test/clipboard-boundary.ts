import { JSDOM } from 'jsdom'
import {
  createEditor,
  type Descendant,
  type Node,
  type Range,
  Element as SlateElement,
} from 'slate'
import { Editor } from 'slate/internal'

import {
  EDITOR_TO_ELEMENT,
  EDITOR_TO_KEY_TO_ELEMENT,
  EDITOR_TO_WINDOW,
  ELEMENT_TO_NODE,
  NODE_TO_ELEMENT,
  NODE_TO_INDEX,
  NODE_TO_PARENT,
  withDOM,
} from '../src/index'

class FakeDataTransfer {
  private readonly store = new Map<string, string>()

  get types() {
    return Array.from(this.store.keys())
  }

  getData(type: string) {
    return this.store.get(type) ?? ''
  }

  setData(type: string, value: string) {
    this.store.set(type, value)
  }
}

const createChildren = (): Descendant[] => [
  {
    type: 'paragraph',
    children: [{ text: 'alpha' }],
  },
  {
    type: 'paragraph',
    children: [{ text: 'beta' }],
  },
]

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

const createClipboardEditor = (
  children: Descendant[],
  selection: Range | null,
  clipboardFormatKey?: string
) => {
  const editor = withDOM(createEditor(), clipboardFormatKey)

  Editor.replace(editor, {
    children,
    selection,
  })

  seedNodeMaps(
    editor,
    editor.read((state) => state.value.get())
  )

  return editor
}

const withDom = (run: (document: Document) => void) => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>')

  try {
    run(dom.window.document)
  } finally {
    dom.window.close()
  }
}

const mountEditorRoot = (editor: Editor, document: Document) => {
  const root = document.createElement('div')
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

const mountSimpleEditorDOM = (editor: Editor, document: Document) => {
  const root = mountEditorRoot(editor, document)

  for (const [blockIndex, block] of editor
    .read((state) => state.value.get())
    .entries()) {
    const blockEl = document.createElement('div')
    blockEl.style.display = 'block'

    const owner = document.createElement('span')
    const leaf = document.createElement('span')
    const string = document.createElement('span')
    const textNode = document.createTextNode(
      (block as SlateElement).children[0].text as string
    )

    owner.setAttribute('data-slate-node', 'text')
    leaf.setAttribute('data-slate-leaf', 'true')
    string.setAttribute('data-slate-string', 'true')

    string.appendChild(textNode)
    leaf.appendChild(string)
    owner.appendChild(leaf)
    blockEl.appendChild(owner)
    root.appendChild(blockEl)

    const [node] = editor.read((state) => state.nodes.get([blockIndex, 0]))
    const key = editor.dom.findKey(node)
    EDITOR_TO_KEY_TO_ELEMENT.get(editor)!.set(key, owner)
    ELEMENT_TO_NODE.set(owner, node)
    NODE_TO_ELEMENT.set(node, owner)
  }
}

const mountDecoratedEditorDOM = (editor: Editor, document: Document) => {
  const root = mountEditorRoot(editor, document)

  const blockEl = document.createElement('div')
  blockEl.style.display = 'block'

  const owner = document.createElement('span')
  const plainLeaf = document.createElement('span')
  const highlightedLeaf = document.createElement('span')
  const plainString = document.createElement('span')
  const highlightedWrapper = document.createElement('span')
  const highlightedString = document.createElement('span')

  owner.setAttribute('data-slate-node', 'text')
  plainLeaf.setAttribute('data-slate-leaf', 'true')
  highlightedLeaf.setAttribute('data-slate-leaf', 'true')
  plainString.setAttribute('data-slate-string', 'true')
  highlightedWrapper.setAttribute('data-tone', 'warm')
  highlightedString.setAttribute('data-slate-string', 'true')

  plainString.appendChild(document.createTextNode('a'))
  highlightedString.appendChild(document.createTextNode('lph'))
  highlightedWrapper.appendChild(highlightedString)
  plainLeaf.appendChild(plainString)
  highlightedLeaf.appendChild(highlightedWrapper)
  owner.appendChild(plainLeaf)
  owner.appendChild(highlightedLeaf)
  blockEl.appendChild(owner)
  root.appendChild(blockEl)

  const [node] = editor.read((state) => state.nodes.get([0, 0]))
  const key = editor.dom.findKey(node)
  EDITOR_TO_KEY_TO_ELEMENT.get(editor)!.set(key, owner)
  ELEMENT_TO_NODE.set(owner, node)
  NODE_TO_ELEMENT.set(node, owner)
}

describe('slate-dom clipboard boundary', () => {
  it('installs DOM host capabilities on the editor instance', () => {
    const editor = withDOM(createEditor())
    const headlessEditor = createEditor()

    expect('dom' in headlessEditor).toBe(false)
    expect(typeof editor.dom.clipboard.insertData).toBe('function')
    expect(typeof editor.dom.clipboard.writeSelection).toBe('function')
    expect('clipboard' in editor).toBe(false)
  })

  it('round-trips a selected fragment through clipboard payloads and replaces the target selection', () => {
    withDom((document) => {
      const copySelection: Range = {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 5 },
      }
      const replaceSelection: Range = {
        anchor: { path: [1, 0], offset: 0 },
        focus: { path: [1, 0], offset: 4 },
      }

      const source = createClipboardEditor(createChildren(), copySelection)
      const target = createClipboardEditor(createChildren(), replaceSelection)
      const clipboard = new FakeDataTransfer()

      mountSimpleEditorDOM(source, document)
      mountEditorRoot(target, document)

      source.dom.clipboard.writeSelection(clipboard as unknown as DataTransfer)

      expect(clipboard.getData('application/x-slate-fragment')).not.toBe('')
      expect(clipboard.getData('text/html')).toContain('data-slate-fragment=')
      expect(clipboard.getData('text/plain')).toBe('alpha')

      target.update(() => {
        target.dom.clipboard.insertData(clipboard as unknown as DataTransfer)
      })

      expect(Editor.getSnapshot(target).children).toEqual([
        {
          type: 'paragraph',
          children: [{ text: 'alpha' }],
        },
        {
          type: 'paragraph',
          children: [{ text: 'alpha' }],
        },
      ])
      expect(Editor.getSnapshot(target).selection).toEqual({
        anchor: { path: [1, 0], offset: 5 },
        focus: { path: [1, 0], offset: 5 },
      })
    })
  })

  it('supports a custom fragment MIME key', () => {
    withDom((document) => {
      const selection: Range = {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 5 },
      }
      const replaceSelection: Range = {
        anchor: { path: [1, 0], offset: 0 },
        focus: { path: [1, 0], offset: 4 },
      }

      const source = createClipboardEditor(
        createChildren(),
        selection,
        'x-proof-fragment'
      )
      const target = createClipboardEditor(
        createChildren(),
        replaceSelection,
        'x-proof-fragment'
      )
      const clipboard = new FakeDataTransfer()

      mountSimpleEditorDOM(source, document)
      mountEditorRoot(target, document)

      source.dom.clipboard.writeSelection(clipboard as unknown as DataTransfer)

      expect(clipboard.getData('application/x-slate-fragment')).toBe('')
      expect(clipboard.getData('application/x-proof-fragment')).not.toBe('')

      target.update(() => {
        target.dom.clipboard.insertData(clipboard as unknown as DataTransfer)
      })

      expect(
        (Editor.getSnapshot(target).children[1] as SlateElement).children[0]
      ).toEqual({ text: 'alpha' })
    })
  })

  it('falls back to the HTML embedded fragment when the custom MIME payload is absent', () => {
    withDom((document) => {
      const selection: Range = {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 5 },
      }
      const replaceSelection: Range = {
        anchor: { path: [1, 0], offset: 0 },
        focus: { path: [1, 0], offset: 4 },
      }

      const source = createClipboardEditor(createChildren(), selection)
      const target = createClipboardEditor(createChildren(), replaceSelection)
      const encodedClipboard = new FakeDataTransfer()
      const clipboard = new FakeDataTransfer()

      mountSimpleEditorDOM(source, document)
      mountEditorRoot(target, document)

      source.dom.clipboard.writeSelection(
        encodedClipboard as unknown as DataTransfer
      )
      clipboard.setData('text/html', encodedClipboard.getData('text/html'))

      target.update(() => {
        target.dom.clipboard.insertData(clipboard as unknown as DataTransfer)
      })

      expect(
        (Editor.getSnapshot(target).children[1] as SlateElement).children[0]
      ).toEqual({ text: 'alpha' })
    })
  })

  it('falls back to plain text when no fragment payload exists', () => {
    const editor = createClipboardEditor(
      createChildren(),
      {
        anchor: { path: [1, 0], offset: 0 },
        focus: { path: [1, 0], offset: 4 },
      },
      undefined
    )
    const clipboard = new FakeDataTransfer()

    clipboard.setData('text/plain', 'hello')

    editor.update(() => {
      editor.dom.clipboard.insertData(clipboard as unknown as DataTransfer)
    })

    expect(
      (Editor.getSnapshot(editor).children[1] as SlateElement).children[0]
    ).toEqual({ text: 'hello' })
  })

  it('exports decorated multi-leaf text without leaking render-only wrappers', () => {
    withDom((document) => {
      const selection: Range = {
        anchor: { path: [0, 0], offset: 1 },
        focus: { path: [0, 0], offset: 4 },
      }

      const source = createClipboardEditor(
        [
          {
            type: 'paragraph',
            children: [{ text: 'alph beta' }],
          },
        ],
        selection
      )
      const clipboard = new FakeDataTransfer()

      mountDecoratedEditorDOM(source, document)

      source.dom.clipboard.writeSelection(clipboard as unknown as DataTransfer)

      expect(clipboard.getData('application/x-slate-fragment')).not.toBe('')
      expect(clipboard.getData('text/plain')).toBe('lph')
      expect(clipboard.getData('text/html')).toContain('data-slate-fragment=')
      expect(clipboard.getData('text/html')).not.toContain('data-tone=')
    })
  })

  it('preserves the target block type for multiline plain-text fallback', () => {
    const editor = createClipboardEditor(
      [
        {
          type: 'heading',
          children: [{ text: 'hello' }],
        },
      ],
      {
        anchor: { path: [0, 0], offset: 2 },
        focus: { path: [0, 0], offset: 2 },
      },
      undefined
    )
    const clipboard = new FakeDataTransfer()

    clipboard.setData('text/plain', 'A\nB')

    editor.update(() => {
      editor.dom.clipboard.insertData(clipboard as unknown as DataTransfer)
    })

    expect(Editor.getSnapshot(editor).children).toEqual([
      {
        type: 'heading',
        children: [{ text: 'heA' }],
      },
      {
        type: 'heading',
        children: [{ text: 'Bllo' }],
      },
    ])
  })

  it('replaces an expanded selection with every line from multiline plain-text fallback', () => {
    const editor = createClipboardEditor(
      [
        {
          type: 'paragraph',
          children: [{ text: 'replace me' }],
        },
      ],
      {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 'replace me'.length },
      },
      undefined
    )
    const clipboard = new FakeDataTransfer()

    clipboard.setData('text/plain', 'paste one\npaste two')

    editor.update(() => {
      editor.dom.clipboard.insertData(clipboard as unknown as DataTransfer)
    })

    expect(Editor.getSnapshot(editor).children).toEqual([
      {
        type: 'paragraph',
        children: [{ text: 'paste one' }],
      },
      {
        type: 'paragraph',
        children: [{ text: 'paste two' }],
      },
    ])
  })
})
