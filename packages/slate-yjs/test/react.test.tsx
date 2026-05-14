import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { act, render, renderHook } from '@testing-library/react'
import { createEditor, type Value } from 'slate'
import { Editor } from 'slate/internal'
import * as Y from 'yjs'

import {
  connectYjsLocalAwareness,
  createYjsExtension,
  createYjsLocalAwareness,
} from '../src'
import { RemoteCursorOverlay, useYjsControllerState } from '../src/react'

const paragraph = (text: string): Value[number] => ({
  type: 'paragraph',
  children: [{ text }],
})

const createEditorWithText = (text: string) => {
  const editor = createEditor()

  Editor.replace(editor, {
    children: [paragraph(text)],
    marks: null,
    selection: {
      anchor: { path: [0, 0], offset: text.length },
      focus: { path: [0, 0], offset: text.length },
    },
  })

  return editor
}

describe('slate-yjs React bindings', () => {
  it('subscribes to controller state and renders remote cursor overlays', () => {
    const leftDoc = new Y.Doc()
    const rightDoc = new Y.Doc()
    const leftRoot = leftDoc.get('content', Y.XmlText) as Y.XmlText
    const rightRoot = rightDoc.get('content', Y.XmlText) as Y.XmlText
    const leftAwareness = createYjsLocalAwareness(1)
    const rightAwareness = createYjsLocalAwareness(2)
    const leftController = createYjsExtension({
      awareness: leftAwareness,
      sharedRoot: leftRoot,
    })
    const rightController = createYjsExtension({
      awareness: rightAwareness,
      sharedRoot: rightRoot,
    })
    const leftEditor = createEditorWithText('alpha')
    const rightEditor = createEditorWithText('')
    const unextendLeft = leftEditor.extend(leftController.extension)
    const unextendRight = rightEditor.extend(rightController.extension)
    const disconnectAwareness = connectYjsLocalAwareness(
      leftAwareness,
      rightAwareness
    )

    leftAwareness.setLocalState({
      user: { color: '#2563eb', name: 'Left' },
    })
    rightAwareness.setLocalState({
      user: { color: '#059669', name: 'Right' },
    })

    const { result } = renderHook(() => useYjsControllerState(leftController))

    assert.equal(result.current.connection, 'disconnected')

    act(() => {
      leftController.connect()
      Y.applyUpdate(rightDoc, Y.encodeStateAsUpdate(leftDoc))
      rightController.connect()
    })

    assert.equal(result.current.connection, 'connected')

    const rendered = render(
      <RemoteCursorOverlay controller={rightController} />
    )

    assert.equal(rendered.container.textContent, 'Left')

    act(() => {
      leftEditor.update((tx) => {
        tx.selection.set({
          anchor: { path: [0, 0], offset: 1 },
          focus: { path: [0, 0], offset: 4 },
        })
      })
    })

    assert.equal(rendered.container.textContent, 'Left')
    assert.equal(
      rendered.container.querySelector('[data-slate-yjs-remote-cursor="1"]')
        ?.textContent,
      'Left'
    )

    act(() => {
      disconnectAwareness()
      unextendLeft()
      unextendRight()
    })
  })
})
