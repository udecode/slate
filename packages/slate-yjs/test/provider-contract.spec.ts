import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createEditor, type Descendant, type Range } from 'slate'
import { Editor } from 'slate/internal'
import { history } from 'slate-history'
import * as Y from 'yjs'

import { createYjsExtension } from '../src'
import type {
  YjsExtensionOptions,
  YjsProviderEvent,
  YjsProviderEventHandler,
  YjsProviderLike,
  YjsProviderStatus,
  YjsProviderStatusPayload,
  YjsProviderSyncedPayload,
} from '../src/core/types'
import {
  createYjsPeer,
  FakeAwareness,
  getYjsState,
  runYjsUpdate,
} from './support/collaboration'

const paragraph = (text: string): Descendant => ({
  type: 'paragraph',
  children: [{ text }],
})

const initialValue = () => [paragraph('alpha'), paragraph('beta')]

const selection = (): Range => ({
  anchor: { path: [0, 0], offset: 1 },
  focus: { path: [0, 0], offset: 3 },
})

class FakeProvider implements YjsProviderLike {
  readonly awareness = new FakeAwareness(12)
  readonly doc = new Y.Doc()

  readonly calls: string[] = []

  status: YjsProviderStatus = 'disconnected'
  synced = false

  private readonly statusListeners = new Set<
    (status: YjsProviderStatusPayload) => void
  >()
  private readonly syncedListeners = new Set<
    (synced: YjsProviderSyncedPayload) => void
  >()
  private readonly syncListeners = new Set<
    (synced: YjsProviderSyncedPayload) => void
  >()

  connect() {
    this.calls.push('connect')
    this.emitStatus('connected')
  }

  destroy() {
    this.calls.push('destroy')
  }

  disconnect() {
    this.calls.push('disconnect')
    this.emitStatus('disconnected')
  }

  emitStatus(status: YjsProviderStatusPayload) {
    this.status = typeof status === 'string' ? status : status.status

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

  emitSyncedState(synced: boolean) {
    this.synced = synced

    for (const listener of this.syncedListeners) {
      listener({ state: synced })
    }
  }

  emitSync(synced: boolean) {
    this.synced = synced

    for (const listener of this.syncListeners) {
      listener(synced)
    }
  }

  off(event: YjsProviderEvent, handler: YjsProviderEventHandler) {
    if (event === 'status') {
      this.statusListeners.delete(
        handler as (status: YjsProviderStatusPayload) => void
      )
    } else if (event === 'sync') {
      this.syncListeners.delete(
        handler as (synced: YjsProviderSyncedPayload) => void
      )
    } else {
      this.syncedListeners.delete(
        handler as (synced: YjsProviderSyncedPayload) => void
      )
    }
  }

  on(event: YjsProviderEvent, handler: YjsProviderEventHandler) {
    if (event === 'status') {
      this.statusListeners.add(
        handler as (status: YjsProviderStatusPayload) => void
      )
    } else if (event === 'sync') {
      this.syncListeners.add(
        handler as (synced: YjsProviderSyncedPayload) => void
      )
    } else {
      this.syncedListeners.add(
        handler as (synced: YjsProviderSyncedPayload) => void
      )
    }
  }
}

class DeferredConnectProvider extends FakeProvider {
  override connect() {
    this.calls.push('connect')
  }
}

class AsyncDisconnectProvider extends FakeProvider {
  resolveDisconnect: (() => void) | null = null

  override disconnect() {
    this.calls.push('disconnect')

    return new Promise<void>((resolve) => {
      this.resolveDisconnect = () => {
        this.emitStatus('disconnected')
        resolve()
      }
    })
  }
}

class StatusOnlyProvider extends FakeProvider {
  override connect() {
    this.calls.push('connect')
    this.status = 'connected'
  }

  override disconnect() {
    this.calls.push('disconnect')
    this.status = 'disconnected'
  }
}

class FireAndForgetDisconnectProvider extends FakeProvider {
  override disconnect() {
    this.calls.push('disconnect')
  }
}

const createYjsUpdate = (children: Descendant[]) => {
  const doc = new Y.Doc()

  createEditor({
    extensions: [
      createYjsExtension({
        clientId: 'seed',
        doc,
        rootName: 'slate',
      }),
    ],
    initialValue: children,
  })

  return Y.encodeStateAsUpdate(doc)
}

const seedProviderDoc = (
  provider: FakeProvider,
  children: Descendant[] = initialValue()
) => {
  Y.applyUpdate(provider.doc, createYjsUpdate(children))
  provider.synced = true
}

const createProviderEditor = (
  provider: FakeProvider,
  options: Partial<YjsExtensionOptions> = {}
) => {
  const editor = createEditor()

  Editor.replace(editor, {
    children: initialValue(),
    marks: null,
    selection: null,
  })

  const cleanup = editor.extend(
    createYjsExtension({
      clientId: 'provider-peer',
      provider,
      rootName: 'slate',
      ...options,
    })
  )

  return { cleanup, editor }
}

const createProviderEditorWithHistory = (
  provider: FakeProvider,
  order: 'history-first' | 'yjs-first'
) => {
  const editor = createEditor()
  const cleanups: (() => void)[] = []

  Editor.replace(editor, {
    children: initialValue(),
    marks: null,
    selection: null,
  })

  if (order === 'history-first') {
    cleanups.push(editor.extend(history()))
  }

  cleanups.push(
    editor.extend(
      createYjsExtension({
        clientId: `provider-peer-${order}`,
        provider,
        rootName: 'slate',
      })
    )
  )

  if (order === 'yjs-first') {
    cleanups.push(editor.extend(history()))
  }

  return {
    cleanup: () => {
      for (const cleanup of [...cleanups].reverse()) {
        cleanup()
      }
    },
    editor,
  }
}

describe('@slate/yjs provider contract', () => {
  it('returns nullable provider state without a provider', () => {
    const peer = createYjsPeer({
      children: initialValue(),
      clientId: 'a',
    })

    assert.equal(getYjsState(peer).providerStatus(), null)
    assert.equal(getYjsState(peer).providerSynced(), null)

    runYjsUpdate(peer, (yjs) => {
      yjs.disconnect()
      assert.equal(getYjsState(peer).connected(), false)
      yjs.reconnect()
    })

    assert.equal(getYjsState(peer).connected(), true)
  })

  it('uses provider doc and awareness as additive defaults', () => {
    const provider = new FakeProvider()
    seedProviderDoc(provider)
    const { cleanup, editor } = createProviderEditor(provider)
    const yjs = editor.read((state) => (state as any).yjs)

    assert.equal(yjs.doc(), provider.doc)
    assert.equal(yjs.providerStatus(), 'disconnected')
    assert.equal(yjs.providerSynced(), true)
    assert.equal(yjs.connected(), false)

    editor.update((tx) => {
      ;(tx as any).yjs.sendSelection(selection(), { name: 'Provider peer' })
    })

    assert.deepEqual(provider.awareness.getLocalState()?.data, {
      name: 'Provider peer',
    })

    cleanup()
  })

  it('subscribes to provider status and provider-reported sync changes', () => {
    const provider = new FakeProvider()
    const { cleanup, editor } = createProviderEditor(provider)
    const yjs = editor.read((state) => (state as any).yjs)
    const seen: [YjsProviderStatus | null, boolean | null][] = []
    const unsubscribe = yjs.subscribeProvider(() => {
      seen.push([yjs.providerStatus(), yjs.providerSynced()])
    })

    provider.emitStatus('connecting')
    provider.emitSync(true)
    provider.emitStatus({ status: 'connected' })
    provider.emitSynced(false)
    provider.emitSyncedState(true)
    unsubscribe()
    provider.emitStatus('disconnected')

    assert.deepEqual(seen, [
      ['connecting', false],
      ['connecting', true],
      ['connected', true],
      ['connected', false],
      ['connected', true],
    ])

    cleanup()
  })

  it('does not seed a provider-owned document before provider sync', () => {
    const provider = new FakeProvider()
    const { cleanup, editor } = createProviderEditor(provider)
    const root = provider.doc.get('slate', Y.XmlElement)

    assert.equal(root.length, 0)

    Y.applyUpdate(provider.doc, createYjsUpdate([paragraph('remote')]))

    assert.equal(Editor.string(editor, [0]), 'remote')

    provider.emitSync(true)

    assert.equal(Editor.string(editor, [0]), 'remote')
    assert.equal(root.length, 1)

    cleanup()
  })

  it('does not reconcile an unsafe empty provider doc before sync', () => {
    const provider = new FakeProvider()
    const { cleanup, editor } = createProviderEditor(provider)
    const root = provider.doc.get('slate', Y.XmlElement)

    editor.update((tx) => {
      ;(tx as any).yjs.reconcile()
    })

    assert.equal(Editor.string(editor, [0]), 'alpha')
    assert.equal(root.length, 0)

    cleanup()
  })

  it('does not save rejected pre-sync provider edits in Slate history', async () => {
    for (const order of ['history-first', 'yjs-first'] as const) {
      const provider = new FakeProvider()
      const { cleanup, editor } = createProviderEditorWithHistory(
        provider,
        order
      )

      editor.update((tx) => {
        tx.text.insert('!', { at: { path: [0, 0], offset: 'alpha'.length } })
      })
      await Promise.resolve()

      assert.equal(Editor.string(editor, [0]), 'alpha', order)
      assert.equal(
        editor.read((state) => (state as any).history.undos().length),
        0,
        order
      )

      editor.update((tx) => {
        ;(tx as any).history.undo()
      })

      assert.equal(Editor.string(editor, [0]), 'alpha', order)

      cleanup()
    }
  })

  it('exports local edits after remote content arrives before provider sync', () => {
    const provider = new FakeProvider()
    const { cleanup, editor } = createProviderEditor(provider)
    const root = provider.doc.get('slate', Y.XmlElement)

    Y.applyUpdate(provider.doc, createYjsUpdate([paragraph('remote')]))

    assert.equal(Editor.string(editor, [0]), 'remote')
    assert.equal(root.length, 1)

    editor.update((tx) => {
      tx.text.insert('!', { at: { path: [0, 0], offset: 'remote'.length } })
    })

    assert.equal(Editor.string(editor, [0]), 'remote!')

    provider.emitSync(true)

    assert.equal(Editor.string(editor, [0]), 'remote!')
    assert.equal(root.length, 1)

    cleanup()
  })

  it('seeds empty synced provider docs by default', () => {
    const provider = new FakeProvider()
    const { cleanup, editor } = createProviderEditor(provider)
    const root = provider.doc.get('slate', Y.XmlElement)

    assert.equal(root.length, 0)
    provider.emitSync(true)

    assert.equal(Editor.string(editor, [0]), 'alpha')
    assert.equal(root.length, 2)

    editor.update((tx) => {
      tx.text.insert('!', { at: { path: [0, 0], offset: 'alpha'.length } })
    })

    assert.equal(Editor.string(editor, [0]), 'alpha!')
    assert.equal(root.length, 2)

    cleanup()
  })

  it('allows apps to opt out of seeding empty synced provider docs', () => {
    const provider = new FakeProvider()
    const { cleanup, editor } = createProviderEditor(provider, {
      seedProviderOnSync: false,
    })
    const root = provider.doc.get('slate', Y.XmlElement)

    provider.emitSync(true)

    assert.equal(Editor.string(editor, [0]), 'alpha')
    assert.equal(root.length, 0)

    editor.update((tx) => {
      tx.text.insert('!', { at: { path: [0, 0], offset: 'alpha'.length } })
    })

    assert.equal(Editor.string(editor, [0]), 'alpha')
    assert.equal(root.length, 0)

    cleanup()
  })

  it('rejects local edits before an empty provider doc syncs', () => {
    const provider = new FakeProvider()
    const { cleanup, editor } = createProviderEditor(provider)
    const root = provider.doc.get('slate', Y.XmlElement)

    assert.equal(root.length, 0)
    assert.doesNotThrow(() => {
      editor.update((tx) => {
        tx.text.insert('!', { at: { path: [0, 0], offset: 'alpha'.length } })
      })
    })
    assert.equal(Editor.string(editor, [0]), 'alpha')
    assert.equal(root.length, 0)

    provider.emitSync(true)

    assert.equal(Editor.string(editor, [0]), 'alpha')
    assert.equal(root.length, 2)

    editor.update((tx) => {
      tx.text.insert('!', { at: { path: [0, 0], offset: 'alpha'.length } })
    })

    assert.equal(Editor.string(editor, [0]), 'alpha!')
    assert.equal(root.length, 2)

    cleanup()
  })

  it('keeps provider content authoritative after rejecting pre-sync edits', () => {
    const provider = new FakeProvider()
    const { cleanup, editor } = createProviderEditor(provider)
    const root = provider.doc.get('slate', Y.XmlElement)

    editor.update((tx) => {
      tx.text.insert('!', { at: { path: [0, 0], offset: 'alpha'.length } })
    })

    assert.equal(Editor.string(editor, [0]), 'alpha')
    assert.equal(root.length, 0)

    Y.applyUpdate(provider.doc, createYjsUpdate([paragraph('remote')]))

    assert.equal(Editor.string(editor, [0]), 'remote')
    assert.equal(root.length, 1)

    provider.emitSync(true)

    assert.equal(Editor.string(editor, [0]), 'remote')
    assert.equal(root.length, 1)

    cleanup()
  })

  it('does not seed provider docs with unknown sync state by default', () => {
    const provider = new FakeProvider()
    delete (provider as Partial<FakeProvider>).synced
    const { cleanup, editor } = createProviderEditor(provider)
    const root = provider.doc.get('slate', Y.XmlElement)

    assert.equal(root.length, 0)

    editor.update((tx) => {
      tx.text.insert('!', { at: { path: [0, 0], offset: 'alpha'.length } })
    })

    assert.equal(Editor.string(editor, [0]), 'alpha')
    assert.equal(root.length, 0)

    cleanup()
  })

  it('does not seed provider docs with unknown sync state when explicitly requested', () => {
    const provider = new FakeProvider()
    delete (provider as Partial<FakeProvider>).synced
    const { cleanup, editor } = createProviderEditor(provider, {
      seedProviderOnSync: true,
    })
    const root = provider.doc.get('slate', Y.XmlElement)

    assert.equal(root.length, 0)

    editor.update((tx) => {
      tx.text.insert('!', { at: { path: [0, 0], offset: 'alpha'.length } })
    })

    assert.equal(Editor.string(editor, [0]), 'alpha')
    assert.equal(root.length, 0)

    provider.emitSync(true)

    assert.equal(Editor.string(editor, [0]), 'alpha')
    assert.equal(root.length, 2)

    cleanup()
  })

  it('treats an explicit provider doc as sync-gated provider state', () => {
    const provider = new FakeProvider()
    const { cleanup, editor } = createProviderEditor(provider, {
      doc: provider.doc,
      seedProviderOnSync: true,
    })
    const root = provider.doc.get('slate', Y.XmlElement)

    assert.equal(root.length, 0)

    editor.update((tx) => {
      tx.text.insert('!', { at: { path: [0, 0], offset: 'alpha'.length } })
    })

    assert.equal(Editor.string(editor, [0]), 'alpha')
    assert.equal(root.length, 0)

    provider.emitSync(true)

    assert.equal(Editor.string(editor, [0]), 'alpha')
    assert.equal(root.length, 2)

    cleanup()
  })

  it('sync-gates explicit docs even when providers do not expose a doc property', () => {
    const provider = new FakeProvider()
    const doc = provider.doc
    delete (provider as Partial<FakeProvider>).doc
    const { cleanup, editor } = createProviderEditor(provider, {
      doc,
      seedProviderOnSync: true,
    })
    const root = doc.get('slate', Y.XmlElement)

    assert.equal(root.length, 0)

    editor.update((tx) => {
      tx.text.insert('!', { at: { path: [0, 0], offset: 'alpha'.length } })
    })

    assert.equal(Editor.string(editor, [0]), 'alpha')
    assert.equal(root.length, 0)

    provider.emitSync(true)

    assert.equal(Editor.string(editor, [0]), 'alpha')
    assert.equal(root.length, 2)

    cleanup()
  })

  it('seeds empty provider docs on sync when explicitly requested', () => {
    const provider = new FakeProvider()
    const { cleanup, editor } = createProviderEditor(provider, {
      seedProviderOnSync: true,
    })
    const root = provider.doc.get('slate', Y.XmlElement)

    assert.equal(root.length, 0)
    provider.emitSync(true)

    assert.equal(Editor.string(editor, [0]), 'alpha')
    assert.equal(root.length, 2)

    editor.update((tx) => {
      tx.text.insert('!', { at: { path: [0, 0], offset: 'alpha'.length } })
    })

    assert.equal(Editor.string(editor, [0]), 'alpha!')

    editor.update((tx) => {
      ;(tx as any).yjs.undo()
    })

    assert.equal(Editor.string(editor, [0]), 'alpha')

    cleanup()
  })

  it('uses provider status events as the remote cursor visibility gate', () => {
    const provider = new FakeProvider()
    provider.status = 'connected'
    seedProviderDoc(provider)
    const { cleanup, editor } = createProviderEditor(provider)
    const yjs = editor.read((state) => (state as any).yjs)

    editor.update((tx) => {
      ;(tx as any).yjs.sendSelection(selection(), { name: 'Remote peer' })
    })
    provider.awareness.setRemoteState(88, {
      data: { name: 'Remote peer' },
      selection: provider.awareness.getLocalState()?.selection,
    })

    assert.equal(yjs.connected(), true)
    assert.equal(yjs.remoteCursors().length, 1)

    provider.emitStatus({ status: 'disconnected' })

    assert.equal(yjs.connected(), false)
    assert.deepEqual(yjs.remoteCursors(), [])

    provider.emitStatus('connected')

    assert.equal(yjs.connected(), true)
    assert.equal(yjs.remoteCursors().length, 1)

    cleanup()
  })

  it('does not expose stale cursors while provider connect is pending', () => {
    const provider = new DeferredConnectProvider()
    seedProviderDoc(provider)
    const { cleanup, editor } = createProviderEditor(provider)
    const yjs = editor.read((state) => (state as any).yjs)

    editor.update((tx) => {
      ;(tx as any).yjs.sendSelection(selection(), { name: 'Remote peer' })
    })
    provider.awareness.setRemoteState(88, {
      data: { name: 'Remote peer' },
      selection: provider.awareness.getLocalState()?.selection,
    })

    assert.equal(yjs.connected(), false)
    assert.deepEqual(yjs.remoteCursors(), [])

    editor.update((tx) => {
      ;(tx as any).yjs.connect()
    })

    assert.deepEqual(provider.calls, ['connect'])
    assert.equal(yjs.providerStatus(), 'disconnected')
    assert.equal(yjs.connected(), false)
    assert.deepEqual(yjs.remoteCursors(), [])

    provider.emitStatus('connected')

    assert.equal(yjs.connected(), true)
    assert.equal(yjs.remoteCursors().length, 1)

    cleanup()
  })

  it('reads imperative provider status after lifecycle calls without events', () => {
    const provider = new StatusOnlyProvider()
    seedProviderDoc(provider)
    const { cleanup, editor } = createProviderEditor(provider)
    const yjs = editor.read((state) => (state as any).yjs)

    assert.equal(yjs.providerStatus(), 'disconnected')
    assert.equal(yjs.connected(), false)

    editor.update((tx) => {
      ;(tx as any).yjs.connect()
    })

    assert.deepEqual(provider.calls, ['connect'])
    assert.equal(yjs.providerStatus(), 'connected')
    assert.equal(yjs.connected(), true)

    editor.update((tx) => {
      ;(tx as any).yjs.disconnect()
    })

    assert.deepEqual(provider.calls, ['connect', 'disconnect'])
    assert.equal(yjs.providerStatus(), 'disconnected')
    assert.equal(yjs.connected(), false)

    cleanup()
  })

  it('keeps local disconnect authoritative while provider status is stale', () => {
    const provider = new FireAndForgetDisconnectProvider()
    provider.status = 'connected'
    seedProviderDoc(provider)
    const { cleanup, editor } = createProviderEditor(provider)
    const yjs = editor.read((state) => (state as any).yjs)

    assert.equal(yjs.connected(), true)

    editor.update((tx) => {
      ;(tx as any).yjs.disconnect()
    })

    assert.deepEqual(provider.calls, ['disconnect'])
    assert.equal(yjs.providerStatus(), 'connected')
    assert.equal(yjs.connected(), false)

    cleanup()
  })

  it('delegates reconnect to optional provider transport methods in order', () => {
    const provider = new FakeProvider()
    const { cleanup, editor } = createProviderEditor(provider)

    editor.update((tx) => {
      ;(tx as any).yjs.reconnect()
    })

    assert.deepEqual(provider.calls, ['disconnect', 'connect'])
    assert.equal(
      editor.read((state) => (state as any).yjs.connected()),
      true
    )
    assert.equal(
      editor.read((state) => (state as any).yjs.providerStatus()),
      'connected'
    )

    cleanup()
  })

  it('waits for async provider disconnect before reconnecting', async () => {
    const provider = new AsyncDisconnectProvider()
    const { cleanup, editor } = createProviderEditor(provider)

    editor.update((tx) => {
      ;(tx as any).yjs.reconnect()
    })

    assert.deepEqual(provider.calls, ['disconnect'])

    provider.resolveDisconnect?.()
    await Promise.resolve()

    assert.deepEqual(provider.calls, ['disconnect', 'connect'])

    cleanup()
  })

  it('keeps pause separate from provider disconnect', () => {
    const provider = new FakeProvider()
    const { cleanup, editor } = createProviderEditor(provider)

    editor.update((tx) => {
      ;(tx as any).yjs.pause()
      ;(tx as any).yjs.disconnect()
    })

    const yjs = editor.read((state) => (state as any).yjs)

    assert.equal(yjs.paused(), true)
    assert.equal(yjs.connected(), false)
    assert.deepEqual(provider.calls, ['disconnect'])

    cleanup()
  })

  it('cleans up provider listeners and local awareness selection without destroying app-owned providers', () => {
    const provider = new FakeProvider()
    seedProviderDoc(provider)
    const { cleanup, editor } = createProviderEditor(provider)
    let notifications = 0
    const unsubscribe = editor
      .read((state) => (state as any).yjs)
      .subscribeProvider(() => {
        notifications += 1
      })

    editor.update((tx) => {
      ;(tx as any).yjs.sendSelection(selection(), { name: 'Provider peer' })
    })

    cleanup()
    unsubscribe()
    provider.emitStatus('connected')
    provider.emitSynced(true)

    assert.equal(notifications, 0)
    assert.deepEqual(provider.calls, [])
    assert.equal(provider.awareness.getLocalState()?.selection, null)
    assert.deepEqual(provider.awareness.getLocalState()?.data, {
      name: 'Provider peer',
    })
  })

  it('does not create provider awareness state during cleanup', () => {
    const provider = new FakeProvider()
    seedProviderDoc(provider)
    const { cleanup } = createProviderEditor(provider)

    assert.equal(provider.awareness.getLocalState(), null)
    assert.equal(
      provider.awareness.getStates().has(provider.awareness.clientID),
      false
    )

    cleanup()

    assert.equal(provider.awareness.getLocalState(), null)
    assert.equal(
      provider.awareness.getStates().has(provider.awareness.clientID),
      false
    )
  })

  it('destroys providers only when explicitly owned by the editor', () => {
    const provider = new FakeProvider()
    provider.synced = true
    const { cleanup } = createProviderEditor(provider, {
      destroyProviderOnUnmount: true,
    })

    cleanup()

    assert.deepEqual(provider.calls, ['destroy'])
  })
})
