import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Point, Range, Value } from 'slate'
import * as Y from 'yjs'

import {
  decodeYRelativePosition,
  encodeYRelativePosition,
  readSlateValueFromYjs,
  slatePointToTextOffset,
  slatePointToYRelativePosition,
  slateRangeToYRelativeRange,
  slateValueToYText,
  writeSlateValueToYjs,
  yRelativePositionToSlatePoint,
  yRelativeRangeToSlateRange,
} from '../src/core'

const paragraph = (text: string): Value[number] => ({
  type: 'paragraph',
  children: [{ text }],
})

const createRoot = () => {
  const doc = new Y.Doc()

  return doc.get('content', Y.XmlText) as Y.XmlText
}

describe('slate-yjs codec', () => {
  it('stores Slate structure while mirroring linear Yjs text', () => {
    const root = createRoot()
    const value: Value = [paragraph('alpha'), paragraph('beta')]

    writeSlateValueToYjs(root, value)

    assert.equal(slateValueToYText(value), 'alphabeta')
    assert.equal(root.toString(), 'alphabeta')
    assert.deepEqual(readSlateValueFromYjs(root), value)

    root.insert(root.length, '!')

    assert.deepEqual(readSlateValueFromYjs(root), [
      paragraph('alpha'),
      paragraph('beta!'),
    ])
  })

  it('round-trips Slate points through Yjs relative positions after remote text edits', () => {
    const root = createRoot()
    const value: Value = [paragraph('abcdef')]
    const point: Point = { path: [0, 0], offset: 3 }

    writeSlateValueToYjs(root, value)

    const relativePosition = slatePointToYRelativePosition(root, value, point)
    const encoded = encodeYRelativePosition(relativePosition)

    root.insert(0, 'XY')

    const nextValue = readSlateValueFromYjs(root)

    assert(nextValue)
    assert.deepEqual(
      yRelativePositionToSlatePoint(
        root,
        nextValue,
        decodeYRelativePosition(encoded)
      ),
      { path: [0, 0], offset: 5 }
    )
  })

  it('maps ranges and unicode offsets without splitting surrogate pairs manually', () => {
    const root = createRoot()
    const text = 'Iñtërnâtiônàlizætiøn☃💩\uFEFF'
    const value: Value = [paragraph(text)]
    const range: Range = {
      anchor: { path: [0, 0], offset: 1 },
      focus: { path: [0, 0], offset: text.length },
    }

    writeSlateValueToYjs(root, value)

    assert.equal(
      slatePointToTextOffset(value, { path: [0, 0], offset: text.length }),
      text.length
    )

    const relativeRange = slateRangeToYRelativeRange(root, value, range)

    assert.deepEqual(
      yRelativeRangeToSlateRange(root, value, relativeRange),
      range
    )
  })
})
