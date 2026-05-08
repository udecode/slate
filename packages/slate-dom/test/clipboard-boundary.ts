import { JSDOM } from 'jsdom'
import {
  createEditor,
  type Descendant,
  type Node,
  type Range,
  Element as SlateElement,
} from 'slate'
import { Editor } from 'slate/internal'
import { withHistory } from 'slate-history'

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
  clipboardFormatKey?: string,
  configureEditor?: (editor: Editor) => void
) => {
  const editor = withDOM(
    createEditor(),
    clipboardFormatKey ? { clipboardFormatKey } : undefined
  )

  configureEditor?.(editor)

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

const bindDOMNode = (editor: Editor, node: Node, element: HTMLElement) => {
  const key = editor.dom.findKey(node)

  EDITOR_TO_KEY_TO_ELEMENT.get(editor)!.set(key, element)
  ELEMENT_TO_NODE.set(element, node)
  NODE_TO_ELEMENT.set(node, element)
}

const createTextDOM = (document: Document, text: string) => {
  const owner = document.createElement('span')
  const leaf = document.createElement('span')
  const string = document.createElement('span')

  owner.setAttribute('data-slate-node', 'text')
  leaf.setAttribute('data-slate-leaf', 'true')
  string.setAttribute('data-slate-string', 'true')

  string.appendChild(document.createTextNode(text))
  leaf.appendChild(string)
  owner.appendChild(leaf)

  return owner
}

const createZeroWidthTextDOM = (document: Document) => {
  const owner = document.createElement('span')
  const leaf = document.createElement('span')
  const zeroWidth = document.createElement('span')

  owner.setAttribute('data-slate-node', 'text')
  leaf.setAttribute('data-slate-leaf', 'true')
  zeroWidth.setAttribute('data-slate-zero-width', 'z')

  zeroWidth.appendChild(document.createTextNode('\uFEFF'))
  leaf.appendChild(zeroWidth)
  owner.appendChild(leaf)

  return owner
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
    bindDOMNode(editor, node, owner)
  }
}

const mountInlineVoidEditorDOM = (editor: Editor, document: Document) => {
  const root = mountEditorRoot(editor, document)
  const blockEl = document.createElement('p')
  const before = createTextDOM(document, 'alpha ')
  const mention = document.createElement('span')
  const mentionContent = document.createElement('span')
  const mentionHiddenText = createZeroWidthTextDOM(document)
  const after = createTextDOM(document, ' omega')

  blockEl.setAttribute('data-slate-node', 'element')
  mention.setAttribute('data-slate-node', 'element')
  mention.setAttribute('data-slate-inline', 'true')
  mention.setAttribute('data-slate-void', 'true')
  mention.setAttribute('contenteditable', 'false')
  mentionContent.setAttribute('contenteditable', 'false')
  mentionContent.textContent = '@R2-D2'

  mention.appendChild(mentionContent)
  mention.appendChild(mentionHiddenText)
  blockEl.appendChild(before)
  blockEl.appendChild(mention)
  blockEl.appendChild(after)
  root.appendChild(blockEl)

  const [blockNode] = editor.read((state) => state.nodes.get([0]))
  const [beforeNode] = editor.read((state) => state.nodes.get([0, 0]))
  const [mentionNode] = editor.read((state) => state.nodes.get([0, 1]))
  const [mentionTextNode] = editor.read((state) => state.nodes.get([0, 1, 0]))
  const [afterNode] = editor.read((state) => state.nodes.get([0, 2]))

  bindDOMNode(editor, blockNode, blockEl)
  bindDOMNode(editor, beforeNode, before)
  bindDOMNode(editor, mentionNode, mention)
  bindDOMNode(editor, mentionTextNode, mentionHiddenText)
  bindDOMNode(editor, afterNode, after)
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

const encodeFragmentPayload = (document: Document, payload: string) =>
  document.defaultView!.btoa(encodeURIComponent(payload))

const encodeRawFragmentPayload = (document: Document, payload: string) =>
  document.defaultView!.btoa(payload)

const decodeFragmentPayload = (document: Document, payload: string) =>
  JSON.parse(decodeURIComponent(document.defaultView!.atob(payload)))

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

  it('preserves the target block type when a rich fragment replaces selected target text', () => {
    withDom((document) => {
      const copySelection: Range = {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 5 },
      }
      const replaceSelection: Range = {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 4 },
      }

      const source = createClipboardEditor(createChildren(), copySelection)
      const target = createClipboardEditor(
        [
          {
            type: 'heading',
            children: [{ text: 'beta' }],
          },
        ],
        replaceSelection
      )
      const clipboard = new FakeDataTransfer()

      mountSimpleEditorDOM(source, document)
      mountEditorRoot(target, document)

      source.dom.clipboard.writeSelection(clipboard as unknown as DataTransfer)

      target.update(() => {
        target.dom.clipboard.insertData(clipboard as unknown as DataTransfer)
      })

      expect(Editor.getSnapshot(target).children).toEqual([
        {
          type: 'heading',
          children: [{ text: 'alpha' }],
        },
      ])
      expect(Editor.getSnapshot(target).selection).toEqual({
        anchor: { path: [0, 0], offset: 5 },
        focus: { path: [0, 0], offset: 5 },
      })
    })
  })

  it('preserves block separation when a rich multi-block fragment is pasted in the middle of a text block', () => {
    withDom((document) => {
      const copySelection: Range = {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [1, 0], offset: 'two'.length },
      }
      const targetSelection: Range = {
        anchor: { path: [0, 0], offset: 'before '.length },
        focus: { path: [0, 0], offset: 'before '.length },
      }

      const source = createClipboardEditor(
        [
          {
            type: 'paragraph',
            children: [{ text: 'one' }],
          },
          {
            type: 'paragraph',
            children: [{ text: 'two' }],
          },
        ],
        copySelection
      )
      const target = createClipboardEditor(
        [
          {
            type: 'paragraph',
            children: [{ text: 'before after' }],
          },
        ],
        targetSelection
      )
      const clipboard = new FakeDataTransfer()

      mountSimpleEditorDOM(source, document)
      mountEditorRoot(target, document)

      source.dom.clipboard.writeSelection(clipboard as unknown as DataTransfer)

      expect(clipboard.getData('application/x-slate-fragment')).not.toBe('')
      expect(clipboard.getData('text/html')).toContain('data-slate-fragment=')
      expect(clipboard.getData('text/plain').trimEnd()).toBe('one\ntwo')

      const operationsBefore = Editor.getOperations(target).length

      target.update(() => {
        target.dom.clipboard.insertData(clipboard as unknown as DataTransfer)
      })

      expect(Editor.getSnapshot(target).children).toEqual([
        {
          type: 'paragraph',
          children: [{ text: 'before one' }],
        },
        {
          type: 'paragraph',
          children: [{ text: 'twoafter' }],
        },
      ])
      expect(Editor.getSnapshot(target).selection).toEqual({
        anchor: { path: [1, 0], offset: 'two'.length },
        focus: { path: [1, 0], offset: 'two'.length },
      })
      expect(Editor.getOperations(target).length - operationsBefore).toBe(1)
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

  it('accepts custom-key embedded HTML fragments in matching custom-key editors', () => {
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
      const encodedClipboard = new FakeDataTransfer()
      const clipboard = new FakeDataTransfer()

      mountSimpleEditorDOM(source, document)
      mountEditorRoot(target, document)

      source.dom.clipboard.writeSelection(
        encodedClipboard as unknown as DataTransfer
      )
      clipboard.setData('text/html', encodedClipboard.getData('text/html'))
      clipboard.setData('text/plain', 'plain fallback')

      target.update(() => {
        target.dom.clipboard.insertData(clipboard as unknown as DataTransfer)
      })

      expect(
        (Editor.getSnapshot(target).children[1] as SlateElement).children[0]
      ).toEqual({ text: 'alpha' })
    })
  })

  it('rejects custom-key embedded HTML fragments in default-key editors', () => {
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
      const target = createClipboardEditor(createChildren(), replaceSelection)
      const encodedClipboard = new FakeDataTransfer()
      const clipboard = new FakeDataTransfer()

      mountSimpleEditorDOM(source, document)
      mountEditorRoot(target, document)

      source.dom.clipboard.writeSelection(
        encodedClipboard as unknown as DataTransfer
      )
      clipboard.setData('text/html', encodedClipboard.getData('text/html'))
      clipboard.setData('text/plain', 'plain fallback')

      target.update(() => {
        target.dom.clipboard.insertData(clipboard as unknown as DataTransfer)
      })

      expect(
        (Editor.getSnapshot(target).children[1] as SlateElement).children[0]
      ).toEqual({ text: 'plain fallback' })
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

  it('pastes multiline plain text as separate blocks at a collapsed text selection', () => {
    const editor = createClipboardEditor(
      [
        {
          type: 'heading',
          children: [{ text: 'Hello ' }],
        },
      ],
      {
        anchor: { path: [0, 0], offset: 'Hello '.length },
        focus: { path: [0, 0], offset: 'Hello '.length },
      }
    )
    const clipboard = new FakeDataTransfer()

    clipboard.setData('text/plain', 'world\nAnd text below')

    editor.update(() => {
      editor.dom.clipboard.insertData(clipboard as unknown as DataTransfer)
    })

    expect(Editor.getSnapshot(editor).children).toEqual([
      {
        type: 'heading',
        children: [{ text: 'Hello world' }],
      },
      {
        type: 'heading',
        children: [{ text: 'And text below' }],
      },
    ])
    expect(Editor.getSnapshot(editor).selection).toEqual({
      anchor: { path: [1, 0], offset: 'And text below'.length },
      focus: { path: [1, 0], offset: 'And text below'.length },
    })
  })

  it('falls back to plain text when the custom MIME fragment is malformed', () => {
    withDom((document) => {
      const editor = createClipboardEditor(createChildren(), {
        anchor: { path: [1, 0], offset: 0 },
        focus: { path: [1, 0], offset: 4 },
      })
      const clipboard = new FakeDataTransfer()

      mountEditorRoot(editor, document)
      clipboard.setData('application/x-slate-fragment', 'not-valid-base64')
      clipboard.setData('text/plain', 'fallback')

      expect(() => {
        editor.update(() => {
          editor.dom.clipboard.insertData(clipboard as unknown as DataTransfer)
        })
      }).not.toThrow()

      expect(
        (Editor.getSnapshot(editor).children[1] as SlateElement).children[0]
      ).toEqual({ text: 'fallback' })
    })
  })

  it('falls back to plain text when the embedded HTML fragment is only text', () => {
    withDom((document) => {
      const editor = createClipboardEditor(createChildren(), {
        anchor: { path: [1, 0], offset: 0 },
        focus: { path: [1, 0], offset: 4 },
      })
      const clipboard = new FakeDataTransfer()

      mountEditorRoot(editor, document)
      clipboard.setData(
        'text/html',
        '<p>literal data-slate-fragment="not-valid-base64"</p>'
      )
      clipboard.setData('text/plain', 'fallback')

      expect(() => {
        editor.update(() => {
          editor.dom.clipboard.insertData(clipboard as unknown as DataTransfer)
        })
      }).not.toThrow()

      expect(
        (Editor.getSnapshot(editor).children[1] as SlateElement).children[0]
      ).toEqual({ text: 'fallback' })
    })
  })

  it('rejects decoded fragment payloads that are not Slate fragment arrays', () => {
    withDom((document) => {
      const cases = [
        encodeRawFragmentPayload(document, '%E0%A4%A'),
        encodeFragmentPayload(document, 'not json'),
        encodeFragmentPayload(document, JSON.stringify({ text: 'oops' })),
      ]

      cases.forEach((payload, index) => {
        const editor = createClipboardEditor(createChildren(), {
          anchor: { path: [1, 0], offset: 0 },
          focus: { path: [1, 0], offset: 4 },
        })
        const clipboard = new FakeDataTransfer()

        mountEditorRoot(editor, document)
        clipboard.setData('application/x-slate-fragment', payload)
        clipboard.setData('text/plain', `fallback ${index}`)

        expect(() => {
          editor.update(() => {
            editor.dom.clipboard.insertData(
              clipboard as unknown as DataTransfer
            )
          })
        }).not.toThrow()

        expect(
          (Editor.getSnapshot(editor).children[1] as SlateElement).children[0]
        ).toEqual({ text: `fallback ${index}` })
      })
    })
  })

  it('ignores malformed fragment payloads when there is no fallback data', () => {
    withDom((document) => {
      const editor = createClipboardEditor(createChildren(), {
        anchor: { path: [1, 0], offset: 0 },
        focus: { path: [1, 0], offset: 4 },
      })
      const before = Editor.getSnapshot(editor)
      const clipboard = new FakeDataTransfer()

      mountEditorRoot(editor, document)
      clipboard.setData('application/x-slate-fragment', 'not-valid-base64')

      expect(() => {
        editor.update(() => {
          editor.dom.clipboard.insertData(clipboard as unknown as DataTransfer)
        })
      }).not.toThrow()

      expect(Editor.getSnapshot(editor)).toEqual(before)
    })
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

  it('exports a selected inline void as a Slate fragment without requiring block void spacer DOM', () => {
    withDom((document) => {
      const source = createClipboardEditor(
        [
          {
            type: 'paragraph',
            children: [
              { text: 'alpha ' },
              {
                type: 'mention',
                character: 'R2-D2',
                children: [{ text: '' }],
              },
              { text: ' omega' },
            ],
          },
        ],
        {
          anchor: { path: [0, 1, 0], offset: 0 },
          focus: { path: [0, 1, 0], offset: 0 },
        },
        undefined,
        (editor) => {
          editor.extend({
            elements: [{ type: 'mention', void: 'markable-inline' }],
            name: 'inline-void-copy',
          })
        }
      )
      const clipboard = new FakeDataTransfer()
      const target = createClipboardEditor(
        [
          {
            type: 'paragraph',
            children: [{ text: 'into target' }],
          },
        ],
        {
          anchor: { path: [0, 0], offset: 4 },
          focus: { path: [0, 0], offset: 4 },
        },
        undefined,
        (editor) => {
          editor.extend({
            elements: [{ type: 'mention', void: 'markable-inline' }],
            name: 'inline-void-paste',
          })
        }
      )

      mountInlineVoidEditorDOM(source, document)
      mountEditorRoot(target, document)

      expect(() => {
        source.dom.clipboard.writeSelection(
          clipboard as unknown as DataTransfer
        )
      }).not.toThrow()

      const encoded = clipboard.getData('application/x-slate-fragment')

      expect(encoded).not.toBe('')
      expect(decodeFragmentPayload(document, encoded)).toEqual([
        {
          type: 'paragraph',
          children: [
            {
              type: 'mention',
              character: 'R2-D2',
              children: [{ text: '' }],
            },
          ],
        },
      ])
      expect(clipboard.getData('text/html')).toContain('data-slate-fragment=')
      expect(clipboard.getData('text/plain')).not.toContain('\uFEFF')
      expect(clipboard.getData('text/plain')).not.toContain('alpha')
      expect(clipboard.getData('text/plain')).not.toContain('omega')

      const operationsBefore = Editor.getOperations(target).length

      target.update(() => {
        target.dom.clipboard.insertData(clipboard as unknown as DataTransfer)
      })

      expect(Editor.getSnapshot(target).children).toEqual([
        {
          type: 'paragraph',
          children: [
            { text: 'into' },
            {
              type: 'mention',
              character: 'R2-D2',
              children: [{ text: '' }],
            },
            { text: ' target' },
          ],
        },
      ])
      expect(Editor.getSnapshot(target).selection).toEqual({
        anchor: { path: [0, 1, 0], offset: 0 },
        focus: { path: [0, 1, 0], offset: 0 },
      })
      expect(Editor.getOperations(target).length - operationsBefore).toBe(1)

      source.update((tx) => {
        tx.text.delete()
      })

      expect(Editor.getSnapshot(source).children).toEqual([
        {
          type: 'paragraph',
          children: [{ text: 'alpha  omega' }],
        },
      ])
      expect(Editor.getSnapshot(source).selection).toEqual({
        anchor: { path: [0, 0], offset: 6 },
        focus: { path: [0, 0], offset: 6 },
      })
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

  it('uses one logical edit for multiline plain-text fallback inside a populated block', () => {
    const editor = createClipboardEditor(
      [
        {
          type: 'paragraph',
          children: [{ text: 'alpha' }],
        },
        {
          type: 'paragraph',
          children: [{ text: 'beta' }],
        },
        {
          type: 'paragraph',
          children: [{ text: 'omega' }],
        },
      ],
      {
        anchor: { path: [1, 0], offset: 2 },
        focus: { path: [1, 0], offset: 2 },
      },
      undefined
    )
    const clipboard = new FakeDataTransfer()
    const operationsBefore = Editor.getOperations(editor).length

    clipboard.setData('text/plain', 'one\ntwo\nthree')

    editor.update(() => {
      editor.dom.clipboard.insertData(clipboard as unknown as DataTransfer)
    })

    expect(Editor.getSnapshot(editor).children).toEqual([
      {
        type: 'paragraph',
        children: [{ text: 'alpha' }],
      },
      {
        type: 'paragraph',
        children: [{ text: 'beone' }],
      },
      {
        type: 'paragraph',
        children: [{ text: 'two' }],
      },
      {
        type: 'paragraph',
        children: [{ text: 'threeta' }],
      },
      {
        type: 'paragraph',
        children: [{ text: 'omega' }],
      },
    ])
    expect(Editor.getSnapshot(editor).selection).toEqual({
      anchor: { path: [3, 0], offset: 'three'.length },
      focus: { path: [3, 0], offset: 'three'.length },
    })
    expect(Editor.getOperations(editor).length - operationsBefore).toBe(1)
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

  it('uses one logical edit for multiline plain-text fallback into an empty block', () => {
    const editor = createClipboardEditor(
      [
        {
          type: 'paragraph',
          children: [{ text: '' }],
        },
      ],
      {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 0 },
      },
      undefined
    )
    const clipboard = new FakeDataTransfer()
    const operationsBefore = Editor.getOperations(editor).length

    clipboard.setData('text/plain', 'one\ntwo\nthree')

    editor.update(() => {
      editor.dom.clipboard.insertData(clipboard as unknown as DataTransfer)
    })

    expect(Editor.getSnapshot(editor).children).toEqual([
      {
        type: 'paragraph',
        children: [{ text: 'one' }],
      },
      {
        type: 'paragraph',
        children: [{ text: 'two' }],
      },
      {
        type: 'paragraph',
        children: [{ text: 'three' }],
      },
    ])
    expect(Editor.getSnapshot(editor).selection).toEqual({
      anchor: { path: [2, 0], offset: 'three'.length },
      focus: { path: [2, 0], offset: 'three'.length },
    })
    expect(
      Editor.getOperations(editor).length - operationsBefore
    ).toBeLessThanOrEqual(1)
  })

  it('records multiline plain-text fallback as one undoable history batch', () => {
    const editor = withDOM(withHistory(createEditor()))
    const clipboard = new FakeDataTransfer()

    Editor.replace(editor, {
      children: [
        {
          type: 'paragraph',
          children: [{ text: '' }],
        },
      ],
      marks: null,
      selection: {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 0 },
      },
    })

    clipboard.setData('text/plain', 'one\ntwo\nthree')

    editor.update(() => {
      editor.dom.clipboard.insertData(clipboard as unknown as DataTransfer)
    })

    expect(editor.history.undos).toHaveLength(1)
    expect(editor.history.undos[0]?.operations).toHaveLength(1)

    editor.undo()

    expect(Editor.getSnapshot(editor).children).toEqual([
      {
        type: 'paragraph',
        children: [{ text: '' }],
      },
    ])
    expect(Editor.getSnapshot(editor).selection).toEqual({
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    })
  })
})
