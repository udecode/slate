import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createEditor,
  type Descendant,
  type Element,
  type Operation,
  type Range,
  type Value,
} from 'slate'
import * as Y from 'yjs'

import {
  createYjsController,
  createYjsExtension,
  readSlateValueFromYjs,
  type SlateYjsAwareness,
  type SlateYjsStateApi,
  type SlateYjsTxApi,
  slateRangeToYjsRelativeRange,
  writeSlateValueToYjs,
  yjsRelativeRangeToSlateRange,
} from '../src'

const paragraph = (
  children: Descendant[] | string,
  attributes: Record<string, unknown> = {}
): Element => ({
  type: 'paragraph',
  ...attributes,
  children: typeof children === 'string' ? [{ text: children }] : children,
})

const value = (editor: ReturnType<typeof createEditor>): Value =>
  editor.read(
    (state) => JSON.parse(JSON.stringify(state.value.get().roots.main)) as Value
  )

const valueText = (children: Value) =>
  children
    .map((node) => node.children.map((child) => child.text).join(''))
    .join('\n')

const selection = (editor: ReturnType<typeof createEditor>) =>
  editor.read((state) => state.selection.get())

const seedEditor = (
  children: Value = [paragraph('')],
  nextSelection = {
    anchor: { path: [0, 0], offset: 0 },
    focus: { path: [0, 0], offset: 0 },
  }
) => {
  const editor = createEditor()

  editor.update(
    (tx) => {
      tx.value.replace({
        children,
        marks: null,
        selection: nextSelection,
      })
    },
    { tag: 'seed' }
  )

  return editor
}

class TestAwareness implements SlateYjsAwareness {
  clientID: number
  private readonly listeners = new Set<() => void>()
  private readonly states = new Map<number, Record<string, unknown>>()

  constructor(clientID: number) {
    this.clientID = clientID
    this.states.set(clientID, {})
  }

  getStates() {
    return this.states
  }

  off(_event: 'change', listener: () => void) {
    this.listeners.delete(listener)
  }

  on(_event: 'change', listener: () => void) {
    this.listeners.add(listener)
  }

  setLocalStateField(field: string, fieldValue: unknown) {
    this.states.set(this.clientID, {
      ...(this.states.get(this.clientID) ?? {}),
      [field]: fieldValue,
    })
    this.emit()
  }

  setRemoteState(clientId: number, state: Record<string, unknown>) {
    this.states.set(clientId, state)
    this.emit()
  }

  private emit() {
    for (const listener of this.listeners) {
      listener()
    }
  }
}

const sharedRoot = () => new Y.Doc().getXmlElement('slate')

const connectEditors = (
  ...entries: Array<{
    editor: ReturnType<typeof createEditor>
    root: Y.XmlElement
  }>
) =>
  entries.map(({ editor, root }) => {
    const controller = createYjsController({ sharedRoot: root })

    editor.extend(controller.extension)
    controller.connect()

    return controller
  })

describe('slate-yjs core', () => {
  it('round-trips Slate values through the Yjs document model', () => {
    const root = sharedRoot()
    const input: Value = [
      paragraph([{ text: 'Hello', bold: true }, { text: ' world' }], {
        align: 'center',
      }),
      paragraph('Second block'),
    ]

    writeSlateValueToYjs(root, input)

    assert.deepEqual(readSlateValueFromYjs(root), input)
  })

  it('round-trips null text attributes through the Yjs document model', () => {
    const root = sharedRoot()
    const input: Value = [paragraph([{ foo: null, text: 'a' }])]

    writeSlateValueToYjs(root, input)

    assert.deepEqual(readSlateValueFromYjs(root), input)
  })

  it('maps Slate ranges through Yjs relative positions after remote text changes', () => {
    const root = sharedRoot()
    const input: Value = [paragraph('hello')]
    const range: Range = {
      anchor: { path: [0, 0], offset: 2 },
      focus: { path: [0, 0], offset: 2 },
    }

    writeSlateValueToYjs(root, input)
    const relativeRange = slateRangeToYjsRelativeRange(root, input, range)
    const text = root.toArray()[0] as Y.XmlElement
    const sharedText = text.toArray()[0] as Y.XmlText

    sharedText.insert(0, 'X')

    assert.deepEqual(
      yjsRelativeRangeToSlateRange(
        root,
        readSlateValueFromYjs(root)!,
        relativeRange
      ),
      {
        anchor: { path: [0, 0], offset: 3 },
        focus: { path: [0, 0], offset: 3 },
      }
    )
  })

  it('keeps collapsed Slate ranges collapsed when remote text inserts at the caret', () => {
    const root = sharedRoot()
    const input: Value = [paragraph('hello')]
    const range: Range = {
      anchor: { path: [0, 0], offset: 2 },
      focus: { path: [0, 0], offset: 2 },
    }

    writeSlateValueToYjs(root, input)
    const relativeRange = slateRangeToYjsRelativeRange(root, input, range)
    const text = root.toArray()[0] as Y.XmlElement
    const sharedText = text.toArray()[0] as Y.XmlText

    sharedText.insert(2, 'X')

    assert.deepEqual(
      yjsRelativeRangeToSlateRange(
        root,
        readSlateValueFromYjs(root)!,
        relativeRange
      ),
      {
        anchor: { path: [0, 0], offset: 3 },
        focus: { path: [0, 0], offset: 3 },
      }
    )
  })

  it('preserves collapsed Slate range side at text leaf boundaries', () => {
    const root = sharedRoot()
    const input: Value = [
      paragraph([{ bold: true, text: 'He' }, { text: 'llo' }]),
    ]
    const range: Range = {
      anchor: { path: [0, 1], offset: 0 },
      focus: { path: [0, 1], offset: 0 },
    }

    writeSlateValueToYjs(root, input)

    assert.deepEqual(
      yjsRelativeRangeToSlateRange(
        root,
        readSlateValueFromYjs(root)!,
        slateRangeToYjsRelativeRange(root, input, range)
      ),
      range
    )
  })

  it('preserves collapsed Slate range side after empty text leaves', () => {
    const root = sharedRoot()
    const input: Value = [
      paragraph([{ bold: true, text: '' }, { text: 'Hello' }]),
    ]
    const range: Range = {
      anchor: { path: [0, 1], offset: 0 },
      focus: { path: [0, 1], offset: 0 },
    }

    writeSlateValueToYjs(root, input)

    assert.deepEqual(
      yjsRelativeRangeToSlateRange(
        root,
        readSlateValueFromYjs(root)!,
        slateRangeToYjsRelativeRange(root, input, range)
      ),
      range
    )
  })

  it('preserves collapsed Slate range side inside empty middle leaves', () => {
    const root = sharedRoot()
    const input: Value = [
      paragraph([{ text: 'A' }, { bold: true, text: '' }, { text: 'B' }]),
    ]
    const range: Range = {
      anchor: { path: [0, 1], offset: 0 },
      focus: { path: [0, 1], offset: 0 },
    }

    writeSlateValueToYjs(root, input)

    assert.deepEqual(
      yjsRelativeRangeToSlateRange(
        root,
        readSlateValueFromYjs(root)!,
        slateRangeToYjsRelativeRange(root, input, range)
      ),
      range
    )
  })

  it('keeps collapsed boundary ranges attached after same-index inserts', () => {
    const root = sharedRoot()
    const input: Value = [
      paragraph([{ bold: true, text: 'He' }, { text: 'llo' }]),
    ]
    const range: Range = {
      anchor: { path: [0, 1], offset: 0 },
      focus: { path: [0, 1], offset: 0 },
    }

    writeSlateValueToYjs(root, input)
    const relativeRange = slateRangeToYjsRelativeRange(root, input, range)
    const text = root.toArray()[0] as Y.XmlElement
    const sharedText = text.toArray()[0] as Y.XmlText

    sharedText.insert(2, 'X')

    assert.deepEqual(
      yjsRelativeRangeToSlateRange(
        root,
        readSlateValueFromYjs(root)!,
        relativeRange
      ),
      range
    )
  })

  it('preserves concurrent marks applied to the same text after reconnect', async () => {
    const seedDoc = new Y.Doc()
    const docA = new Y.Doc()
    const docB = new Y.Doc()
    const rootA = docA.getXmlElement('slate')
    const rootB = docB.getXmlElement('slate')
    const editorA = seedEditor([paragraph('Hello')], {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 5 },
    })
    const editorB = seedEditor([paragraph('Hello')], {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 5 },
    })

    writeSlateValueToYjs(seedDoc.getXmlElement('slate'), [paragraph('Hello')])
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(seedDoc))
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(seedDoc))
    connectEditors(
      { editor: editorA, root: rootA },
      { editor: editorB, root: rootB }
    )

    editorA.update((tx) => {
      tx.marks.toggle('bold')
    })
    editorB.update((tx) => {
      tx.marks.toggle('italic')
    })

    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB), 'network')
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA), 'network')
    await Promise.resolve()

    assert.deepEqual(value(editorA), [
      paragraph([{ bold: true, italic: true, text: 'Hello' }]),
    ])
    assert.deepEqual(value(editorB), value(editorA))
  })

  it('preserves concurrent mark removal when another peer adds a mark', async () => {
    const seedDoc = new Y.Doc()
    const docA = new Y.Doc()
    const docB = new Y.Doc()
    const rootA = docA.getXmlElement('slate')
    const rootB = docB.getXmlElement('slate')
    const initialValue: Value = [paragraph([{ bold: true, text: 'Hello' }])]
    const initialSelection = {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 5 },
    }
    const editorA = seedEditor(initialValue, initialSelection)
    const editorB = seedEditor(initialValue, initialSelection)

    writeSlateValueToYjs(seedDoc.getXmlElement('slate'), initialValue)
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(seedDoc))
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(seedDoc))
    connectEditors(
      { editor: editorA, root: rootA },
      { editor: editorB, root: rootB }
    )

    editorA.update((tx) => {
      tx.marks.toggle('bold')
    })
    editorB.update((tx) => {
      tx.marks.toggle('italic')
    })

    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB), 'network')
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA), 'network')
    await Promise.resolve()

    assert.deepEqual(value(editorA), [
      paragraph([{ italic: true, text: 'Hello' }]),
    ])
    assert.deepEqual(value(editorB), value(editorA))
  })

  it('trusts Yjs delta attributes over stale text-leaf metadata', () => {
    const root = sharedRoot()
    const input: Value = [paragraph([{ bold: true, text: 'Hello' }])]

    writeSlateValueToYjs(root, input)
    const text = root.toArray()[0] as Y.XmlElement
    const sharedText = text.toArray()[0] as Y.XmlText

    sharedText.format(0, 'Hello'.length, {
      bold: null,
      italic: true,
    })
    sharedText.setAttribute('slate:text-leaves', [
      { attributes: { bold: true, italic: true }, length: 'Hello'.length },
    ])

    assert.deepEqual(readSlateValueFromYjs(root), [
      paragraph([{ italic: true, text: 'Hello' }]),
    ])
  })

  it('trusts aligned delta mark removal over stale text-leaf metadata', () => {
    const root = sharedRoot()
    const input: Value = [
      paragraph([
        { bold: true, color: 'red', text: 'He' },
        { bold: true, color: 'blue', text: 'llo' },
      ]),
    ]

    writeSlateValueToYjs(root, input)
    const text = root.toArray()[0] as Y.XmlElement
    const sharedText = text.toArray()[0] as Y.XmlText

    sharedText.format(0, 'He'.length, { bold: null })

    assert.deepEqual(readSlateValueFromYjs(root), [
      paragraph([
        { color: 'red', text: 'He' },
        { bold: true, color: 'blue', text: 'llo' },
      ]),
    ])
  })

  it('trusts collapsed delta mark removal over stale text-leaf metadata', () => {
    const root = sharedRoot()
    const input: Value = [
      paragraph([{ bold: true, text: 'He' }, { text: 'llo' }]),
    ]

    writeSlateValueToYjs(root, input)
    const text = root.toArray()[0] as Y.XmlElement
    const sharedText = text.toArray()[0] as Y.XmlText

    sharedText.format(0, 'He'.length, { bold: null })
    sharedText.setAttribute('slate:text-leaves', [
      { attributes: { bold: true }, length: 'He'.length },
      { length: 'llo'.length },
    ])

    assert.deepEqual(readSlateValueFromYjs(root), [
      paragraph([{ text: 'He' }, { text: 'llo' }]),
    ])
  })

  it('trusts aligned delta mark changes over stale text-leaf metadata', () => {
    const root = sharedRoot()
    const input: Value = [
      paragraph([
        { color: 'red', text: 'He' },
        { color: 'red', text: 'llo' },
      ]),
    ]

    writeSlateValueToYjs(root, input)
    const text = root.toArray()[0] as Y.XmlElement
    const sharedText = text.toArray()[0] as Y.XmlText

    sharedText.format(0, 'He'.length, { color: 'blue' })
    sharedText.setAttribute('slate:text-leaves', [
      { attributes: { color: 'red' }, length: 'He'.length },
      { attributes: { color: 'red' }, length: 'llo'.length },
    ])

    assert.deepEqual(readSlateValueFromYjs(root), [
      paragraph([
        { color: 'blue', text: 'He' },
        { color: 'red', text: 'llo' },
      ]),
    ])
  })

  it('trusts partial delta mark removal over stale text-leaf metadata', () => {
    const root = sharedRoot()
    const input: Value = [
      paragraph([{ bold: true, color: 'red', text: 'Hello' }]),
    ]

    writeSlateValueToYjs(root, input)
    const text = root.toArray()[0] as Y.XmlElement
    const sharedText = text.toArray()[0] as Y.XmlText

    sharedText.format(0, 'He'.length, { color: null, italic: true })
    sharedText.setAttribute('slate:text-leaves', [
      {
        attributes: { bold: true, color: 'red' },
        length: 'Hello'.length,
      },
    ])

    assert.deepEqual(readSlateValueFromYjs(root), [
      paragraph([
        { bold: true, italic: true, text: 'He' },
        { bold: true, color: 'red', text: 'llo' },
      ]),
    ])
  })

  it('trusts full-range delta mark removal over stale text-leaf metadata', () => {
    const root = sharedRoot()
    const input: Value = [
      paragraph([
        { bold: true, text: 'He' },
        { bold: true, text: 'llo' },
      ]),
    ]

    writeSlateValueToYjs(root, input)
    const text = root.toArray()[0] as Y.XmlElement
    const sharedText = text.toArray()[0] as Y.XmlText

    sharedText.format(0, 'Hello'.length, { bold: null })
    sharedText.setAttribute('slate:text-leaves', [
      { attributes: { bold: true }, length: 'He'.length },
      { attributes: { bold: true }, length: 'llo'.length },
    ])

    assert.deepEqual(readSlateValueFromYjs(root), [
      paragraph([{ text: 'He' }, { text: 'llo' }]),
    ])
  })

  it('trusts single-leaf delta mark removal over stale text-leaf metadata', () => {
    const root = sharedRoot()
    const input: Value = [paragraph([{ bold: true, text: 'Hello' }])]

    writeSlateValueToYjs(root, input)
    const text = root.toArray()[0] as Y.XmlElement
    const sharedText = text.toArray()[0] as Y.XmlText

    sharedText.format(0, 'Hello'.length, { bold: null })
    sharedText.setAttribute('slate:text-leaves', [
      { attributes: { bold: true }, length: 'Hello'.length },
    ])

    assert.deepEqual(readSlateValueFromYjs(root), [
      paragraph([{ text: 'Hello' }]),
    ])
  })

  it('preserves metadata-only leaf attributes from older documents', () => {
    const root = sharedRoot()
    const paragraphElement = new Y.XmlElement('slate-element')
    const sharedText = new Y.XmlText()

    paragraphElement.setAttribute('type', 'paragraph')
    sharedText.applyDelta(
      [{ attributes: { bold: true }, insert: 'some text' }],
      { sanitize: false }
    )
    sharedText.setAttribute('slate:text-leaves', [
      { attributes: { bold: true }, length: 'some '.length },
      { length: 'text'.length },
    ])
    paragraphElement.insert(0, [sharedText])
    root.insert(0, [paragraphElement])

    assert.deepEqual(readSlateValueFromYjs(root), [
      paragraph([{ bold: true, text: 'some ' }, { text: 'text' }]),
    ])
  })

  it('preserves exact metadata-only leaf attributes from older documents', () => {
    const root = sharedRoot()
    const paragraphElement = new Y.XmlElement('slate-element')
    const sharedText = new Y.XmlText()

    paragraphElement.setAttribute('type', 'paragraph')
    sharedText.insert(0, 'Hello')
    sharedText.setAttribute('slate:text-leaves', [
      { attributes: { bold: true }, length: 'Hello'.length },
    ])
    paragraphElement.insert(0, [sharedText])
    root.insert(0, [paragraphElement])

    assert.deepEqual(readSlateValueFromYjs(root), [
      paragraph([{ bold: true, text: 'Hello' }]),
    ])
  })

  it('preserves split metadata-only leaf attributes from older documents', () => {
    const root = sharedRoot()
    const paragraphElement = new Y.XmlElement('slate-element')
    const sharedText = new Y.XmlText()

    paragraphElement.setAttribute('type', 'paragraph')
    sharedText.insert(0, 'Hello')
    sharedText.setAttribute('slate:text-leaves', [
      { attributes: { bold: true }, length: 'He'.length },
      { attributes: { bold: true }, length: 'llo'.length },
    ])
    paragraphElement.insert(0, [sharedText])
    root.insert(0, [paragraphElement])

    assert.deepEqual(readSlateValueFromYjs(root), [
      paragraph([
        { bold: true, text: 'He' },
        { bold: true, text: 'llo' },
      ]),
    ])
  })

  it('preserves metadata-only attributes after later partial mark changes', () => {
    const root = sharedRoot()
    const paragraphElement = new Y.XmlElement('slate-element')
    const sharedText = new Y.XmlText()

    paragraphElement.setAttribute('type', 'paragraph')
    sharedText.insert(0, 'Hello')
    sharedText.setAttribute('slate:text-leaves', [
      { attributes: { bold: true }, length: 'Hello'.length },
    ])
    sharedText.format(2, 3, { italic: true })
    paragraphElement.insert(0, [sharedText])
    root.insert(0, [paragraphElement])

    assert.deepEqual(readSlateValueFromYjs(root), [
      paragraph([
        { bold: true, text: 'He' },
        { bold: true, italic: true, text: 'llo' },
      ]),
    ])
  })

  it('preserves metadata-only attributes after later full-range mark additions', () => {
    const root = sharedRoot()
    const paragraphElement = new Y.XmlElement('slate-element')
    const sharedText = new Y.XmlText()

    paragraphElement.setAttribute('type', 'paragraph')
    sharedText.insert(0, 'Hello')
    sharedText.setAttribute('slate:text-leaves', [
      { attributes: { bold: true }, length: 'Hello'.length },
    ])
    sharedText.format(0, 'Hello'.length, { italic: true })
    paragraphElement.insert(0, [sharedText])
    root.insert(0, [paragraphElement])

    assert.deepEqual(readSlateValueFromYjs(root), [
      paragraph([{ bold: true, italic: true, text: 'Hello' }]),
    ])
  })

  it('preserves metadata-only attributes on delta-unformatted slices', () => {
    const root = sharedRoot()
    const paragraphElement = new Y.XmlElement('slate-element')
    const sharedText = new Y.XmlText()

    paragraphElement.setAttribute('type', 'paragraph')
    sharedText.insert(0, 'Hello')
    sharedText.setAttribute('slate:text-leaves', [
      { attributes: { color: 'red' }, length: 'Hello'.length },
    ])
    sharedText.format(0, 'He'.length, { color: 'blue' })
    paragraphElement.insert(0, [sharedText])
    root.insert(0, [paragraphElement])

    assert.deepEqual(readSlateValueFromYjs(root), [
      paragraph([
        { color: 'blue', text: 'He' },
        { color: 'red', text: 'llo' },
      ]),
    ])
  })

  it('preserves versioned metadata-only split mark removals', () => {
    const root = sharedRoot()
    const paragraphElement = new Y.XmlElement('slate-element')
    const sharedText = new Y.XmlText()

    root.setAttribute('slate:version', '1')
    paragraphElement.setAttribute('type', 'paragraph')
    sharedText.applyDelta(
      [{ attributes: { bold: true }, insert: 'some text' }],
      { sanitize: false }
    )
    sharedText.setAttribute('slate:text-leaves', [
      { attributes: { bold: true }, length: 'some '.length },
      { length: 'text'.length },
    ])
    paragraphElement.insert(0, [sharedText])
    root.insert(0, [paragraphElement])

    assert.deepEqual(readSlateValueFromYjs(root), [
      paragraph([{ bold: true, text: 'some ' }, { text: 'text' }]),
    ])
  })

  it('preserves legacy metadata leaf attributes after later aligned mark changes', () => {
    const root = sharedRoot()
    const paragraphElement = new Y.XmlElement('slate-element')
    const sharedText = new Y.XmlText()

    paragraphElement.setAttribute('type', 'paragraph')
    sharedText.applyDelta(
      [{ attributes: { bold: true }, insert: 'some text' }],
      { sanitize: false }
    )
    sharedText.setAttribute('slate:text-leaves', [
      { attributes: { bold: true }, length: 'some '.length },
      { length: 'text'.length },
    ])
    sharedText.format(0, 'some '.length, { italic: true })
    paragraphElement.insert(0, [sharedText])
    root.insert(0, [paragraphElement])

    assert.deepEqual(readSlateValueFromYjs(root), [
      paragraph([
        { bold: true, italic: true, text: 'some ' },
        { text: 'text' },
      ]),
    ])
  })

  it('preserves aligned delta marks on legacy metadata leaves', () => {
    const root = sharedRoot()
    const paragraphElement = new Y.XmlElement('slate-element')
    const sharedText = new Y.XmlText()

    paragraphElement.setAttribute('type', 'paragraph')
    sharedText.applyDelta(
      [{ insert: 'some ' }, { attributes: { bold: true }, insert: 'text' }],
      { sanitize: false }
    )
    sharedText.setAttribute('slate:text-leaves', [
      { attributes: { bold: true }, length: 'some '.length },
      { length: 'text'.length },
    ])
    paragraphElement.insert(0, [sharedText])
    root.insert(0, [paragraphElement])

    assert.deepEqual(readSlateValueFromYjs(root), [
      paragraph([
        { bold: true, text: 'some ' },
        { bold: true, text: 'text' },
      ]),
    ])
  })

  it('preserves delta slices across stale metadata boundaries', () => {
    const root = sharedRoot()
    const paragraphElement = new Y.XmlElement('slate-element')
    const sharedText = new Y.XmlText()

    paragraphElement.setAttribute('type', 'paragraph')
    sharedText.applyDelta(
      [
        { attributes: { bold: true }, insert: 'H' },
        { attributes: { bold: true, italic: true }, insert: 'ell' },
        { attributes: { italic: true }, insert: 'o' },
      ],
      { sanitize: false }
    )
    sharedText.setAttribute('slate:text-leaves', [
      { attributes: { bold: true }, length: 'Hell'.length },
      { length: 'o'.length },
    ])
    paragraphElement.insert(0, [sharedText])
    root.insert(0, [paragraphElement])

    assert.deepEqual(readSlateValueFromYjs(root), [
      paragraph([
        { bold: true, text: 'H' },
        { bold: true, italic: true, text: 'ell' },
        { italic: true, text: 'o' },
      ]),
    ])
  })

  it('syncs text split leaf attributes when text content is unchanged', () => {
    const root = sharedRoot()
    const first = seedEditor([paragraph([{ bold: true, text: 'some text' }])])
    const second = seedEditor()

    first.extend(createYjsExtension({ sharedRoot: root }))
    second.extend(createYjsExtension({ sharedRoot: root }))
    first.update((tx) => {
      ;(tx as typeof tx & { yjs: SlateYjsTxApi }).yjs.connect()
    })
    second.update((tx) => {
      ;(tx as typeof tx & { yjs: SlateYjsTxApi }).yjs.connect()
    })

    first.update((tx) => {
      tx.operations.replay([
        {
          path: [0, 0],
          position: 5,
          properties: {},
          root: 'main',
          type: 'split_node',
        },
      ])
    })

    assert.deepEqual(value(second), [
      paragraph([{ bold: true, text: 'some ' }, { text: 'text' }]),
    ])
  })

  it('preserves legacy metadata-only attributes after text splits', () => {
    const root = sharedRoot()
    const paragraphElement = new Y.XmlElement('slate-element')
    const sharedText = new Y.XmlText()

    paragraphElement.setAttribute('type', 'paragraph')
    sharedText.insert(0, 'Hello')
    sharedText.setAttribute('slate:text-leaves', [
      { attributes: { bold: true }, length: 'Hello'.length },
    ])
    paragraphElement.insert(0, [sharedText])
    root.insert(0, [paragraphElement])

    const editor = createEditor()

    editor.extend(createYjsExtension({ sharedRoot: root }))
    editor.update((tx) => {
      ;(tx as typeof tx & { yjs: SlateYjsTxApi }).yjs.connect()
    })
    editor.update((tx) => {
      tx.operations.replay([
        {
          path: [0, 0],
          position: 'He'.length,
          properties: { bold: true },
          root: 'main',
          type: 'split_node',
        },
      ])
    })

    assert.deepEqual(readSlateValueFromYjs(root), [
      paragraph([
        { bold: true, text: 'He' },
        { bold: true, text: 'llo' },
      ]),
    ])
  })

  it('backfills legacy metadata-only attributes before versioning local edits', () => {
    const root = sharedRoot()
    const paragraphElement = new Y.XmlElement('slate-element')
    const sharedText = new Y.XmlText()

    paragraphElement.setAttribute('type', 'paragraph')
    sharedText.insert(0, 'Hello')
    sharedText.setAttribute('slate:text-leaves', [
      { attributes: { bold: true }, length: 'Hello'.length },
    ])
    paragraphElement.insert(0, [sharedText])
    root.insert(0, [paragraphElement])

    const editor = createEditor()

    editor.extend(createYjsExtension({ sharedRoot: root }))
    editor.update((tx) => {
      ;(tx as typeof tx & { yjs: SlateYjsTxApi }).yjs.connect()
    })
    editor.update((tx) => {
      tx.operations.replay([
        {
          offset: 'Hello'.length,
          path: [0, 0],
          text: '!',
          type: 'insert_text',
        },
      ])
    })

    assert.equal(root.getAttribute('slate:version'), '1')
    assert.deepEqual(readSlateValueFromYjs(root), [
      paragraph([{ bold: true, text: 'Hello!' }]),
    ])
  })

  it('syncs text merge leaf attributes when text content is unchanged', () => {
    const root = sharedRoot()
    const first = seedEditor([
      paragraph([{ bold: true, text: 'some ' }, { text: 'text' }]),
    ])
    const second = seedEditor()

    first.extend(createYjsExtension({ sharedRoot: root }))
    second.extend(createYjsExtension({ sharedRoot: root }))
    first.update((tx) => {
      ;(tx as typeof tx & { yjs: SlateYjsTxApi }).yjs.connect()
    })
    second.update((tx) => {
      ;(tx as typeof tx & { yjs: SlateYjsTxApi }).yjs.connect()
    })

    first.update((tx) => {
      tx.operations.replay([
        {
          path: [0, 1],
          position: 'some '.length,
          properties: {},
          root: 'main',
          type: 'merge_node',
        },
      ])
    })

    assert.deepEqual(value(second), [
      paragraph([{ bold: true, text: 'some text' }]),
    ])
  })

  it('removes empty text leaves after element merge cleanup', () => {
    const root = sharedRoot()
    const editor = seedEditor([paragraph('Hello'), paragraph('')])

    writeSlateValueToYjs(root, [paragraph('Hello'), paragraph('')])
    connectEditors({ editor, root })

    editor.update((tx) => {
      tx.operations.replay([
        {
          path: [1],
          position: 1,
          properties: { type: 'paragraph' },
          root: 'main',
          type: 'merge_node',
        },
        {
          path: [0, 1],
          position: 'Hello'.length,
          properties: {},
          root: 'main',
          type: 'merge_node',
        },
      ])
    })

    assert.deepEqual(readSlateValueFromYjs(root), [paragraph('Hello')])
  })

  it('syncs local commits to connected peers through extension state and tx groups', () => {
    const root = sharedRoot()
    const first = seedEditor([paragraph('one')], {
      anchor: { path: [0, 0], offset: 3 },
      focus: { path: [0, 0], offset: 3 },
    })
    const second = seedEditor()

    first.extend(createYjsExtension({ sharedRoot: root }))
    second.extend(createYjsExtension({ sharedRoot: root }))

    first.update((tx) => {
      ;(tx as typeof tx & { yjs: SlateYjsTxApi }).yjs.connect()
    })
    second.update((tx) => {
      ;(tx as typeof tx & { yjs: SlateYjsTxApi }).yjs.connect()
    })

    first.update((tx) => {
      tx.text.insert('!', { at: { path: [0, 0], offset: 3 } })
    })

    assert.deepEqual(value(second), [paragraph('one!')])
    assert.equal(
      first.read(
        (state) =>
          (state as typeof state & { yjs: SlateYjsStateApi }).yjs.getState()
            .exports
      ),
      1
    )
    assert.equal(
      second.read(
        (state) =>
          (state as typeof state & { yjs: SlateYjsStateApi }).yjs.getState()
            .imports
      ),
      1
    )
  })

  it('syncs value replacement commits even when they are snapshot-only', () => {
    const root = sharedRoot()
    const first = seedEditor([paragraph('one')])
    const second = seedEditor()

    first.extend(createYjsExtension({ sharedRoot: root }))
    second.extend(createYjsExtension({ sharedRoot: root }))
    first.update((tx) => {
      ;(tx as typeof tx & { yjs: SlateYjsTxApi }).yjs.connect()
    })
    second.update((tx) => {
      ;(tx as typeof tx & { yjs: SlateYjsTxApi }).yjs.connect()
    })

    first.update((tx) => {
      tx.value.replace({
        children: [paragraph('replacement')],
        marks: null,
        selection: {
          anchor: { path: [0, 0], offset: 'replacement'.length },
          focus: { path: [0, 0], offset: 'replacement'.length },
        },
      })
    })

    assert.deepEqual(value(first), [paragraph('replacement')])
    assert.deepEqual(value(second), [paragraph('replacement')])
  })

  it('pauses remote imports and reconciles on resume', () => {
    const root = sharedRoot()
    const first = seedEditor([paragraph('one')], {
      anchor: { path: [0, 0], offset: 3 },
      focus: { path: [0, 0], offset: 3 },
    })
    const second = seedEditor()

    first.extend(createYjsExtension({ sharedRoot: root }))
    second.extend(createYjsExtension({ sharedRoot: root }))
    first.update((tx) => {
      ;(tx as typeof tx & { yjs: SlateYjsTxApi }).yjs.connect()
    })
    second.update((tx) => {
      ;(tx as typeof tx & { yjs: SlateYjsTxApi }).yjs.connect()
    })
    second.update((tx) => {
      ;(tx as typeof tx & { yjs: SlateYjsTxApi }).yjs.pause()
    })

    first.update((tx) => {
      tx.text.insert('!', { at: { path: [0, 0], offset: 3 } })
    })

    assert.deepEqual(value(second), [paragraph('one')])

    second.update((tx) => {
      ;(tx as typeof tx & { yjs: SlateYjsTxApi }).yjs.resume()
    })

    assert.deepEqual(value(second), [paragraph('one!')])
  })

  it('exports local selection through awareness and projects remote cursors', () => {
    const root = sharedRoot()
    const awareness = new TestAwareness(1)
    const controller = createYjsController({
      awareness,
      sharedRoot: root,
    })
    const editor = seedEditor([paragraph('hello')])
    const range: Range = {
      anchor: { path: [0, 0], offset: 1 },
      focus: { path: [0, 0], offset: 4 },
    }

    editor.extend(controller.extension)
    controller.connect()

    editor.update((tx) => {
      tx.selection.set(range)
    })

    const relativeSelection = awareness.getStates().get(1)?.selection

    assert(relativeSelection)

    awareness.setRemoteState(2, {
      selection: relativeSelection,
      user: { color: 'tomato', name: 'Ada' },
    })

    assert.deepEqual(controller.getRemoteCursorStates(), [
      {
        clientId: 2,
        data: { color: 'tomato', name: 'Ada' },
        range,
        user: { color: 'tomato', name: 'Ada' },
      },
    ])
  })

  it('keeps bootstrap out of undo history and restores content through Yjs undo', async () => {
    const root = sharedRoot()
    const controller = createYjsController({ sharedRoot: root })
    const editor = seedEditor([paragraph('one')], {
      anchor: { path: [0, 0], offset: 3 },
      focus: { path: [0, 0], offset: 3 },
    })

    editor.extend(controller.extension)
    controller.connect()

    editor.update((tx) => {
      tx.text.insert('!', { at: { path: [0, 0], offset: 3 } })
    })

    assert.deepEqual(value(editor), [paragraph('one!')])

    controller.undo()
    await Promise.resolve()

    assert.deepEqual(value(editor), [paragraph('one')])
    assert.deepEqual(selection(editor), {
      anchor: { path: [0, 0], offset: 3 },
      focus: { path: [0, 0], offset: 3 },
    })
  })

  it('keeps Yjs undo and redo independent from editor history helpers', async () => {
    const root = sharedRoot()
    const controller = createYjsController({ sharedRoot: root })
    const editor = seedEditor([paragraph('one')], {
      anchor: { path: [0, 0], offset: 3 },
      focus: { path: [0, 0], offset: 3 },
    }) as ReturnType<typeof createEditor> & {
      redo: () => void
      undo: () => void
    }
    let editorUndoCalls = 0
    let editorRedoCalls = 0

    editor.undo = () => {
      editorUndoCalls++
    }
    editor.redo = () => {
      editorRedoCalls++
    }

    editor.extend(controller.extension)
    controller.connect()

    editor.update((tx) => {
      tx.text.insert('!', { at: { path: [0, 0], offset: 3 } })
    })

    assert.deepEqual(value(editor), [paragraph('one!')])

    editor.update((tx) => {
      ;(tx as typeof tx & { yjs: SlateYjsTxApi }).yjs.undo()
    })
    await Promise.resolve()
    await Promise.resolve()

    assert.equal(editorUndoCalls, 0)
    assert.deepEqual(value(editor), [paragraph('one')])

    editor.update((tx) => {
      ;(tx as typeof tx & { yjs: SlateYjsTxApi }).yjs.redo()
    })
    await Promise.resolve()
    await Promise.resolve()

    assert.equal(editorRedoCalls, 0)
    assert.deepEqual(value(editor), [paragraph('one!')])
  })

  it('preserves concurrent appends when a disconnected replace is undone before sync', async () => {
    const initialValue: Value = [
      paragraph('Shared Slate Yjs document.'),
      paragraph('Use either editor; the other peer follows.'),
    ]
    const seedDoc = new Y.Doc()
    const docA = new Y.Doc()
    const docB = new Y.Doc()
    const rootA = docA.getXmlElement('slate')
    const rootB = docB.getXmlElement('slate')
    const editorA = seedEditor(initialValue, {
      anchor: { path: [1, 0], offset: 42 },
      focus: { path: [1, 0], offset: 42 },
    })
    const editorB = seedEditor(initialValue)
    const replaceOperation: Operation = {
      children: initialValue,
      index: 0,
      newChildren: [paragraph('Lin canonical snapshot.')],
      newSelection: {
        anchor: { path: [0, 0], offset: 23 },
        focus: { path: [0, 0], offset: 23 },
      },
      path: [],
      root: 'main',
      selection: {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [1, 0], offset: 42 },
      },
      type: 'replace_children',
    }

    writeSlateValueToYjs(seedDoc.getXmlElement('slate'), initialValue)
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(seedDoc))
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(seedDoc))
    const [, controllerB] = connectEditors(
      { editor: editorA, root: rootA },
      { editor: editorB, root: rootB }
    )

    editorB.update((tx) => {
      tx.operations.replay([replaceOperation])
    })

    assert.deepEqual(value(editorB), [paragraph('Lin canonical snapshot.')])

    controllerB.undo()
    await Promise.resolve()

    assert.deepEqual(value(editorB), initialValue)

    editorA.update((tx) => {
      tx.text.insert(' Ada', { at: { path: [1, 0], offset: 42 } })
    })

    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA), 'network')
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB), 'network')
    await Promise.resolve()

    assert.deepEqual(value(editorA), [
      paragraph('Shared Slate Yjs document.'),
      paragraph('Use either editor; the other peer follows. Ada'),
    ])
    assert.deepEqual(value(editorB), value(editorA))
  })

  it('merges disconnected merge_node with a concurrent text edit in the surviving branch', async () => {
    const initialValue: Value = [paragraph('alpha'), paragraph('beta')]
    const seedDoc = new Y.Doc()
    const docA = new Y.Doc()
    const docB = new Y.Doc()
    const docC = new Y.Doc()
    const rootA = docA.getXmlElement('slate')
    const rootB = docB.getXmlElement('slate')
    const rootC = docC.getXmlElement('slate')
    const editorA = seedEditor(initialValue)
    const editorB = seedEditor(initialValue)
    const editorC = seedEditor(initialValue)

    writeSlateValueToYjs(seedDoc.getXmlElement('slate'), initialValue)
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(seedDoc))
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(seedDoc))
    Y.applyUpdate(docC, Y.encodeStateAsUpdate(seedDoc))
    connectEditors(
      { editor: editorA, root: rootA },
      { editor: editorB, root: rootB },
      { editor: editorC, root: rootC }
    )

    editorB.update((tx) => {
      tx.operations.replay([
        {
          path: [1],
          position: 1,
          properties: { type: 'paragraph' },
          root: 'main',
          type: 'merge_node',
        },
      ])
    })

    editorC.update((tx) => {
      tx.text.insert('!', { at: { path: [0, 0], offset: 5 } })
    })

    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB), 'network')
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docC), 'network')
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA), 'network')
    Y.applyUpdate(docC, Y.encodeStateAsUpdate(docA), 'network')
    await Promise.resolve()

    assert.equal(valueText(value(editorA)), 'alpha!beta')
    assert.deepEqual(value(editorB), value(editorA))
    assert.deepEqual(value(editorC), value(editorA))
  })

  it('preserves a concurrent left-branch edit when Backspace merge normalization reconnects', async () => {
    const initialValue: Value = [paragraph('alpha'), paragraph('beta')]
    const seedDoc = new Y.Doc()
    const docA = new Y.Doc()
    const docB = new Y.Doc()
    const rootA = docA.getXmlElement('slate')
    const rootB = docB.getXmlElement('slate')
    const editorA = seedEditor(initialValue)
    const editorB = seedEditor(initialValue)

    writeSlateValueToYjs(seedDoc.getXmlElement('slate'), initialValue)
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(seedDoc))
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(seedDoc))
    connectEditors(
      { editor: editorA, root: rootA },
      { editor: editorB, root: rootB }
    )

    editorB.update((tx) => {
      tx.operations.replay([
        {
          path: [1],
          position: 1,
          properties: { type: 'paragraph' },
          root: 'main',
          type: 'merge_node',
        },
        {
          path: [0, 1],
          position: 5,
          properties: {},
          root: 'main',
          type: 'merge_node',
        },
      ])
    })

    editorA.update((tx) => {
      tx.text.insert('!', { at: { path: [0, 0], offset: 5 } })
    })

    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA), 'network')
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB), 'network')
    await Promise.resolve()

    assert.equal(valueText(value(editorA)), 'alpha!beta')
    assert.deepEqual(value(editorB), value(editorA))
  })

  it('preserves concurrent text positions when an offline split reconnects', async () => {
    const cases = [
      {
        expected: [paragraph('al!pha'), paragraph('beta')],
        offset: 2,
      },
      {
        expected: [paragraph('alpha!'), paragraph('beta')],
        offset: 5,
      },
      {
        expected: [paragraph('alpha!'), paragraph('beta')],
        offset: 7,
      },
    ]

    for (const { expected, offset } of cases) {
      const initialValue: Value = [paragraph('alphabeta')]
      const seedDoc = new Y.Doc()
      const docA = new Y.Doc()
      const docB = new Y.Doc()
      const rootA = docA.getXmlElement('slate')
      const rootB = docB.getXmlElement('slate')
      const editorA = seedEditor(initialValue)
      const editorB = seedEditor(initialValue)

      writeSlateValueToYjs(seedDoc.getXmlElement('slate'), initialValue)
      Y.applyUpdate(docA, Y.encodeStateAsUpdate(seedDoc))
      Y.applyUpdate(docB, Y.encodeStateAsUpdate(seedDoc))
      connectEditors(
        { editor: editorA, root: rootA },
        { editor: editorB, root: rootB }
      )

      editorB.update((tx) => {
        tx.operations.replay([
          {
            path: [0, 0],
            position: 'alpha'.length,
            properties: {},
            root: 'main',
            type: 'split_node',
          },
          {
            path: [0],
            position: 1,
            properties: { type: 'paragraph' },
            root: 'main',
            type: 'split_node',
          },
        ])
      })

      editorA.update((tx) => {
        tx.text.insert('!', { at: { path: [0, 0], offset } })
      })

      Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA), 'network')
      Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB), 'network')
      await Promise.resolve()

      assert.deepEqual(value(editorA), expected)
      assert.deepEqual(value(editorB), expected)
    }
  })

  it('merges disconnected remove_node with a concurrent edit outside the removed node', async () => {
    const initialValue: Value = [paragraph('alpha'), paragraph('beta')]
    const seedDoc = new Y.Doc()
    const docA = new Y.Doc()
    const docB = new Y.Doc()
    const docC = new Y.Doc()
    const rootA = docA.getXmlElement('slate')
    const rootB = docB.getXmlElement('slate')
    const rootC = docC.getXmlElement('slate')
    const editorA = seedEditor(initialValue)
    const editorB = seedEditor(initialValue)
    const editorC = seedEditor(initialValue)

    writeSlateValueToYjs(seedDoc.getXmlElement('slate'), initialValue)
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(seedDoc))
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(seedDoc))
    Y.applyUpdate(docC, Y.encodeStateAsUpdate(seedDoc))
    connectEditors(
      { editor: editorA, root: rootA },
      { editor: editorB, root: rootB },
      { editor: editorC, root: rootC }
    )

    editorB.update((tx) => {
      tx.operations.replay([
        {
          node: paragraph('beta'),
          path: [1],
          root: 'main',
          type: 'remove_node',
        },
      ])
    })

    editorC.update((tx) => {
      tx.text.insert('!', { at: { path: [0, 0], offset: 5 } })
    })

    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB), 'network')
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docC), 'network')
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA), 'network')
    Y.applyUpdate(docC, Y.encodeStateAsUpdate(docA), 'network')
    await Promise.resolve()

    assert.deepEqual(value(editorA), [paragraph('alpha!')])
    assert.deepEqual(value(editorB), value(editorA))
    assert.deepEqual(value(editorC), value(editorA))
  })

  it('merges disconnected replace_fragment with a concurrent sibling edit', async () => {
    const initialValue: Value = [paragraph('alpha'), paragraph('beta')]
    const seedDoc = new Y.Doc()
    const docA = new Y.Doc()
    const docB = new Y.Doc()
    const docC = new Y.Doc()
    const rootA = docA.getXmlElement('slate')
    const rootB = docB.getXmlElement('slate')
    const rootC = docC.getXmlElement('slate')
    const editorA = seedEditor(initialValue)
    const editorB = seedEditor(initialValue)
    const editorC = seedEditor(initialValue)

    writeSlateValueToYjs(seedDoc.getXmlElement('slate'), initialValue)
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(seedDoc))
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(seedDoc))
    Y.applyUpdate(docC, Y.encodeStateAsUpdate(seedDoc))
    connectEditors(
      { editor: editorA, root: rootA },
      { editor: editorB, root: rootB },
      { editor: editorC, root: rootC }
    )

    editorB.update((tx) => {
      tx.operations.replay([
        {
          children: [{ text: 'alpha' }],
          newChildren: [{ text: 'omega' }],
          newSelection: {
            anchor: { path: [0, 0], offset: 5 },
            focus: { path: [0, 0], offset: 5 },
          },
          path: [0],
          root: 'main',
          selection: {
            anchor: { path: [0, 0], offset: 0 },
            focus: { path: [0, 0], offset: 5 },
          },
          type: 'replace_fragment',
        },
      ])
    })

    editorC.update((tx) => {
      tx.text.insert('!', { at: { path: [1, 0], offset: 4 } })
    })

    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB), 'network')
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docC), 'network')
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA), 'network')
    Y.applyUpdate(docC, Y.encodeStateAsUpdate(docA), 'network')
    await Promise.resolve()

    assert.deepEqual(value(editorA), [paragraph('omega'), paragraph('beta!')])
    assert.deepEqual(value(editorB), value(editorA))
    assert.deepEqual(value(editorC), value(editorA))
  })

  it('encodes forward move_node operations into the Yjs tree', () => {
    const initialValue: Value = [
      paragraph('alpha'),
      paragraph('beta'),
      paragraph('gamma'),
    ]
    const root = sharedRoot()
    const editor = seedEditor(initialValue)

    writeSlateValueToYjs(root, initialValue)
    connectEditors({ editor, root })

    editor.update((tx) => {
      tx.nodes.move({ at: [0], to: [1] })
    })

    assert.deepEqual(readSlateValueFromYjs(root), [
      paragraph('beta'),
      paragraph('alpha'),
      paragraph('gamma'),
    ])
  })

  it('merges disconnected move_node with a concurrent edit in an unmoved sibling', async () => {
    const initialValue: Value = [
      paragraph('alpha'),
      paragraph('beta'),
      paragraph('gamma'),
    ]
    const seedDoc = new Y.Doc()
    const docA = new Y.Doc()
    const docB = new Y.Doc()
    const docC = new Y.Doc()
    const rootA = docA.getXmlElement('slate')
    const rootB = docB.getXmlElement('slate')
    const rootC = docC.getXmlElement('slate')
    const editorA = seedEditor(initialValue)
    const editorB = seedEditor(initialValue)
    const editorC = seedEditor(initialValue)

    writeSlateValueToYjs(seedDoc.getXmlElement('slate'), initialValue)
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(seedDoc))
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(seedDoc))
    Y.applyUpdate(docC, Y.encodeStateAsUpdate(seedDoc))
    connectEditors(
      { editor: editorA, root: rootA },
      { editor: editorB, root: rootB },
      { editor: editorC, root: rootC }
    )

    editorB.update((tx) => {
      tx.operations.replay([
        {
          newPath: [0],
          path: [1],
          root: 'main',
          type: 'move_node',
        },
      ])
    })

    editorC.update((tx) => {
      tx.text.insert('!', { at: { path: [2, 0], offset: 5 } })
    })

    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB), 'network')
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docC), 'network')
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA), 'network')
    Y.applyUpdate(docC, Y.encodeStateAsUpdate(docA), 'network')
    await Promise.resolve()

    assert.deepEqual(value(editorA), [
      paragraph('beta'),
      paragraph('alpha'),
      paragraph('gamma!'),
    ])
    assert.deepEqual(value(editorB), value(editorA))
    assert.deepEqual(value(editorC), value(editorA))
  })
})
