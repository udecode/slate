import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import * as Y from 'yjs'

import { getYjsAttributes, setYjsAttribute } from '../src/core/attributes'

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
})
