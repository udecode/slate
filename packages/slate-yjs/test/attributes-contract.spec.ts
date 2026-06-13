import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Descendant } from 'slate'
import * as Y from 'yjs'

import {
  getYjsAttributes,
  setSlateYjsAttribute,
  setYjsAttribute,
} from '../src/core/attributes'
import { createYjsNodes, readSlateValueFromYjs } from '../src/core/document'
import {
  createSplitElement,
  setYjsNodeAttributes,
} from '../src/core/replacement'

describe('@slate/yjs attribute contract', () => {
  it('writes non-string Yjs attributes through the interop boundary', () => {
    const doc = new Y.Doc()
    const root = doc.get('slate', Y.XmlElement)
    const text = new Y.XmlText()

    root.insert(0, [text])
    setYjsAttribute(text, 'bold', true)
    setYjsAttribute(text, 'level', 2)

    assert.deepEqual(getYjsAttributes(text), {
      bold: true,
      level: 2,
    })
  })

  it('preserves uniform object text attributes across separate Yjs delta parts', () => {
    const doc = new Y.Doc()
    const root = doc.get('slate', Y.XmlElement)
    const paragraph = new Y.XmlElement('paragraph')
    const text = new Y.XmlText()

    setSlateYjsAttribute(paragraph, 'type', 'paragraph')
    root.insert(0, [paragraph])
    paragraph.insert(0, [text])
    text.applyDelta(
      [
        { attributes: { style: { color: 'red' } }, insert: 'a' },
        { attributes: { style: { color: 'red' } }, insert: 'b' },
      ],
      { sanitize: false }
    )

    assert.deepEqual(readSlateValueFromYjs(root), [
      {
        children: [{ style: { color: 'red' }, text: 'ab' }],
        type: 'paragraph',
      },
    ])
  })

  it('does not rewrite semantically unchanged object attributes', () => {
    const doc = new Y.Doc()
    const root = doc.get('slate', Y.XmlElement)
    const [text] = createYjsNodes([{ style: { color: 'red' }, text: 'alpha' }])
    let updates = 0

    assert.ok(text instanceof Y.XmlText)
    root.insert(0, [text])
    doc.on('update', () => {
      updates++
    })

    setYjsNodeAttributes(
      text,
      { style: { color: 'red' } },
      { style: { color: 'red' } }
    )

    assert.equal(updates, 0)
  })

  it('rejects Slate-authored attributes reserved for internal Yjs state', () => {
    for (const key of ['slate:yjs-hidden', 'slate:type']) {
      const node = {
        children: [{ text: 'alpha' }],
        [key]: true,
        type: 'paragraph',
      } as unknown as Descendant

      assert.throws(
        () => createYjsNodes([node]),
        new RegExp(`Cannot set internal Yjs attribute "${key}"`)
      )
    }
  })

  it('rejects split-created element properties reserved for internal Yjs state', () => {
    const original = new Y.XmlElement('paragraph')

    assert.throws(
      () =>
        createSplitElement(
          original,
          { 'slate:yjs-hidden': true, type: 'paragraph' },
          []
        ),
      /Cannot set internal Yjs attribute "slate:yjs-hidden"/
    )
  })
})
