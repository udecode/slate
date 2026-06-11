import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import * as Y from 'yjs'

describe('@slate/yjs document id contract', () => {
  it('keeps generated virtual node ids unique across isolated browser bundles', async () => {
    const nonce = Date.now()
    const first = await import(`../src/core/document.ts?first=${nonce}`)
    const second = await import(`../src/core/document.ts?second=${nonce}`)

    const firstDoc = new Y.Doc()
    firstDoc.clientID = 101
    const firstRoot = firstDoc.get('slate', Y.XmlElement)
    const firstText = new Y.XmlText()

    firstRoot.insert(0, [firstText])
    first.createVirtualYjsMovePlaceholder(firstText)

    const secondDoc = new Y.Doc()
    secondDoc.clientID = 202
    const secondRoot = secondDoc.get('slate', Y.XmlElement)
    const secondParagraph = new Y.XmlElement('paragraph')
    const secondWrapper = new Y.XmlElement('block-quote')

    secondRoot.insert(0, [secondWrapper, secondParagraph])
    second.setVirtualYjsMove(secondRoot, secondParagraph, secondWrapper)

    assert.notEqual(
      firstText.getAttribute('slate:yjs-id'),
      secondParagraph.getAttribute('slate:yjs-id')
    )
  })
})
