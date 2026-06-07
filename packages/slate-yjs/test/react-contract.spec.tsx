import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import React, { act, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import type { Descendant, Editor, Range } from 'slate'
import type * as Y from 'yjs'

import type {
  YjsProviderEvent,
  YjsProviderEventHandler,
  YjsProviderLike,
  YjsProviderStatus,
  YjsRemoteCursorDecorationData,
} from '../src'
import {
  useYjsProviderStatus,
  useYjsProviderSynced,
  useYjsRemoteCursorDecorationSource,
  useYjsRemoteCursorOverlayPositions,
} from '../src/react'
import {
  createYjsPeer,
  FakeAwareness,
  type Peer,
  runYjsUpdate,
} from './support/collaboration'

const shouldUnregisterHappyDOM = !GlobalRegistrator.isRegistered

if (shouldUnregisterHappyDOM) {
  GlobalRegistrator.register()
}
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

after(() => {
  if (shouldUnregisterHappyDOM) {
    GlobalRegistrator.unregister()
  }
})

const paragraph = (text: string): Descendant => ({
  type: 'paragraph',
  children: [{ text }],
})

const initialValue = () => [
  paragraph('alpha'),
  paragraph('beta'),
  paragraph('gamma'),
]

const selection = (path = [0, 0], offset = 1): Range => ({
  anchor: { path, offset },
  focus: { path, offset: offset + 2 },
})

const render = (element: React.ReactNode) => {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)

  act(() => {
    root.render(element)
  })

  return {
    container,
    unmount() {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
  }
}

const sendRemoteSelection = (
  peer: Peer,
  awareness: FakeAwareness,
  range: Range,
  clientId = 101
) => {
  runYjsUpdate(peer, (yjs) => {
    yjs.sendSelection(range)
    awareness.setRemoteState(clientId, {
      data: { color: 'tomato', name: 'Ada' },
      selection: awareness.getLocalState()?.selection,
    })
  })
}

class FakeProvider implements YjsProviderLike {
  awareness = new FakeAwareness(7)
  doc?: Y.Doc
  status: YjsProviderStatus = 'connecting'
  synced = false

  private readonly statusListeners = new Set<
    (status: YjsProviderStatus) => void
  >()
  private readonly syncedListeners = new Set<(synced: boolean) => void>()

  emitStatus(status: YjsProviderStatus) {
    this.status = status
    for (const listener of this.statusListeners) {
      listener(status)
    }
  }

  emitSynced(synced: boolean) {
    this.synced = synced
    for (const listener of this.syncedListeners) {
      listener(synced)
    }
  }

  off(event: YjsProviderEvent, handler: YjsProviderEventHandler) {
    if (event === 'status') {
      this.statusListeners.delete(
        handler as (status: YjsProviderStatus) => void
      )
    } else {
      this.syncedListeners.delete(handler as (synced: boolean) => void)
    }
  }

  on(event: YjsProviderEvent, handler: YjsProviderEventHandler) {
    if (event === 'status') {
      this.statusListeners.add(handler as (status: YjsProviderStatus) => void)
    } else {
      this.syncedListeners.add(handler as (synced: boolean) => void)
    }
  }
}

describe('@slate/yjs react contract', () => {
  it('rerenders provider status hooks from provider lifecycle events', () => {
    const provider = new FakeProvider()
    const peer = createYjsPeer({
      children: initialValue(),
      clientId: 'a',
      provider,
    })

    const ProviderProbe = ({ editor }: { editor: Editor }) => {
      const status = useYjsProviderStatus(editor)
      const synced = useYjsProviderSynced(editor)

      return (
        <output>
          {status ?? 'none'}:{String(synced)}
        </output>
      )
    }

    const view = render(<ProviderProbe editor={peer.editor} />)

    assert.equal(view.container.textContent, 'connecting:false')

    act(() => {
      provider.emitStatus('connected')
    })
    assert.equal(view.container.textContent, 'connected:false')

    act(() => {
      provider.emitSynced(true)
    })
    assert.equal(view.container.textContent, 'connected:true')

    view.unmount()
    peer.cleanup()
  })

  it('exposes remote cursors as a DOM-neutral decoration source', () => {
    const awareness = new FakeAwareness(2)
    const peer = createYjsPeer({
      awareness,
      children: initialValue(),
      clientId: 'b',
      numericClientId: 2,
    })
    ;(peer.editor as any).api = {
      ...(peer.editor as any).api,
      dom: {
        isFocused: () => true,
      },
    }
    let source: ReturnType<typeof useYjsRemoteCursorDecorationSource> | null =
      null
    let lastRefreshRequiresDOMSelectionExport: boolean | null = null

    const DecorationProbe = ({ editor }: { editor: Editor }) => {
      const cursorSource = useYjsRemoteCursorDecorationSource(editor)

      useEffect(() => {
        source = cursorSource

        return cursorSource.subscribeProjectionRefresh((result) => {
          lastRefreshRequiresDOMSelectionExport =
            result.requiresDOMSelectionExport
        })
      }, [cursorSource])

      return null
    }

    const view = render(<DecorationProbe editor={peer.editor} />)

    act(() => {
      sendRemoteSelection(peer, awareness, selection([0, 0], 1))
    })

    assert.ok(source)
    const slices = Object.values(source.getSnapshot()).flat()

    assert.equal(lastRefreshRequiresDOMSelectionExport, true)
    assert.equal(slices.length, 1)
    assert.equal(
      (
        slices[0]?.data as
          | YjsRemoteCursorDecorationData<{ color: string; name: string }>
          | undefined
      )?.clientId,
      101
    )
    assert.deepEqual(
      (
        slices[0]?.data as
          | YjsRemoteCursorDecorationData<{ color: string; name: string }>
          | undefined
      )?.data,
      { color: 'tomato', name: 'Ada' }
    )

    view.unmount()
    peer.cleanup()
  })

  it('refreshes remote cursor decorations when decoration deps change', () => {
    const awareness = new FakeAwareness(4)
    const peer = createYjsPeer({
      awareness,
      children: initialValue(),
      clientId: 'd',
      numericClientId: 4,
    })
    let source: ReturnType<
      typeof useYjsRemoteCursorDecorationSource<
        { color: string; name: string },
        { clientId: number; label: string }
      >
    > | null = null
    let setLabel: ((label: string) => void) | null = null

    const DecorationProbe = ({ editor }: { editor: Editor }) => {
      const [label, updateLabel] = React.useState('Ada')
      const cursorSource = useYjsRemoteCursorDecorationSource<
        { color: string; name: string },
        { clientId: number; label: string }
      >(editor, {
        decorate: (cursor) => ({ clientId: cursor.clientId, label }),
        deps: [label],
      })

      useEffect(() => {
        setLabel = updateLabel
        source = cursorSource
      }, [cursorSource, updateLabel])

      return null
    }

    const view = render(<DecorationProbe editor={peer.editor} />)

    act(() => {
      sendRemoteSelection(peer, awareness, selection([0, 0], 1))
    })

    assert.ok(source)
    assert.equal(
      Object.values(source.getSnapshot()).flat()[0]?.data.label,
      'Ada'
    )

    act(() => {
      setLabel?.('Grace')
    })

    assert.equal(
      Object.values(source.getSnapshot()).flat()[0]?.data.label,
      'Grace'
    )

    view.unmount()
    peer.cleanup()
  })

  it('resolves remote cursor overlay rectangles through the editor DOM API', () => {
    const awareness = new FakeAwareness(3)
    const peer = createYjsPeer({
      awareness,
      children: initialValue(),
      clientId: 'c',
      numericClientId: 3,
    })
    let rect = {
      bottom: 40,
      height: 20,
      left: 10,
      right: 30,
      top: 20,
      width: 20,
      x: 10,
      y: 20,
    } as DOMRect

    ;(peer.editor as any).api = {
      ...(peer.editor as any).api,
      dom: {
        resolveRangeRect: () => rect,
      },
    }

    const OverlayProbe = ({ editor }: { editor: Editor }) => {
      const [positions] = useYjsRemoteCursorOverlayPositions(editor)

      return (
        <output>
          {positions.map(
            (position) => `${position.clientId}:${position.rect?.x}`
          )}
        </output>
      )
    }

    const view = render(<OverlayProbe editor={peer.editor} />)

    act(() => {
      sendRemoteSelection(peer, awareness, selection([1, 0], 1))
    })

    assert.equal(view.container.textContent, '101:10')

    act(() => {
      rect = {
        ...rect,
        left: 25,
        right: 45,
        x: 25,
      }
      peer.editor.update((tx) => {
        tx.text.insert('!', { at: { path: [0, 0], offset: 'alpha'.length } })
      })
    })

    assert.equal(view.container.textContent, '101:25')

    view.unmount()
    peer.cleanup()
  })

  it('refreshes remote cursor overlay data when overlay deps change', () => {
    const awareness = new FakeAwareness(5)
    const peer = createYjsPeer({
      awareness,
      children: initialValue(),
      clientId: 'e',
      numericClientId: 5,
    })
    let setLabel: ((label: string) => void) | null = null

    ;(peer.editor as any).api = {
      ...(peer.editor as any).api,
      dom: {
        resolveRangeRect: () => null,
      },
    }

    const OverlayProbe = ({ editor }: { editor: Editor }) => {
      const [label, updateLabel] = React.useState('Ada')
      const [positions] = useYjsRemoteCursorOverlayPositions<
        { color: string; name: string },
        { label: string }
      >(editor, {
        data: () => ({ label }),
        deps: [label],
      })

      useEffect(() => {
        setLabel = updateLabel
      }, [updateLabel])

      return <output>{positions[0]?.data.label}</output>
    }

    const view = render(<OverlayProbe editor={peer.editor} />)

    act(() => {
      sendRemoteSelection(peer, awareness, selection([1, 0], 1))
    })

    assert.equal(view.container.textContent, 'Ada')

    act(() => {
      setLabel?.('Grace')
    })

    assert.equal(view.container.textContent, 'Grace')

    view.unmount()
    peer.cleanup()
  })
})
