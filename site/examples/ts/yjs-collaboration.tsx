import { css } from '@emotion/css'
import type { SlateYjsTxApi } from '@slate/yjs'
import {
  createYjsExtension,
  type SlateYjsAwareness,
  writeSlateValueToYjs,
} from '@slate/yjs'
import {
  useSlateYjsRemoteCursorStates,
  useSlateYjsState,
} from '@slate/yjs/react'
import { useMemo, useSyncExternalStore } from 'react'
import type { Editor, Range, Value } from 'slate'
import {
  Editable,
  Slate,
  useEditor,
  useSlateEditor,
  useSlateHistory,
} from 'slate-react'
import * as Y from 'yjs'

type PeerId = 'a' | 'b'

type NetworkConnection = 'connected' | 'disconnected'

const PEER_CLIENT_IDS = {
  a: 101,
  b: 202,
} as const satisfies Record<PeerId, number>

const CLIENT_PEERS = new Map<number, PeerId>(
  Object.entries(PEER_CLIENT_IDS).map(([peer, clientId]) => [
    clientId,
    peer as PeerId,
  ])
)

type ExampleConnectionState = {
  connections: Map<PeerId, boolean>
}

type ExampleAwarenessHub = {
  emit: () => void
  isClientConnected: (clientID: number) => boolean
  listeners: Set<() => void>
  states: Map<number, Record<string, unknown>>
}

class ExampleAwareness implements SlateYjsAwareness {
  clientID: number
  private readonly hub: ExampleAwarenessHub

  constructor(clientID: number, hub: ExampleAwarenessHub) {
    this.clientID = clientID
    this.hub = hub
    this.hub.states.set(clientID, {})
  }

  getStates() {
    const states = new Map<number, Record<string, unknown>>()
    const viewerConnected = this.hub.isClientConnected(this.clientID)

    for (const [clientID, state] of this.hub.states) {
      if (
        clientID === this.clientID ||
        (viewerConnected && this.hub.isClientConnected(clientID))
      ) {
        states.set(clientID, state)
      }
    }

    return states
  }

  off(_event: 'change', listener: () => void) {
    this.hub.listeners.delete(listener)
  }

  on(_event: 'change', listener: () => void) {
    this.hub.listeners.add(listener)
  }

  setLocalStateField(field: string, value: unknown) {
    this.hub.states.set(this.clientID, {
      ...(this.hub.states.get(this.clientID) ?? {}),
      [field]: value,
      user: this.hub.states.get(this.clientID)?.user,
    })
    this.hub.emit()
  }

  setUser(user: Record<string, unknown>) {
    this.hub.states.set(this.clientID, {
      ...(this.hub.states.get(this.clientID) ?? {}),
      user,
    })
    this.hub.emit()
  }
}

const NETWORK_ORIGIN = Symbol('slate-yjs-example-network')

class ExampleNetwork {
  private readonly awarenessHub: ExampleAwarenessHub
  private readonly connections: Map<PeerId, boolean>
  private readonly docs: Record<PeerId, Y.Doc>
  private readonly listeners = new Set<() => void>()

  constructor(
    docs: Record<PeerId, Y.Doc>,
    connectionState: ExampleConnectionState,
    awarenessHub: ExampleAwarenessHub
  ) {
    this.awarenessHub = awarenessHub
    this.connections = connectionState.connections
    this.docs = docs

    for (const peer of ['a', 'b'] as const) {
      this.docs[peer].on('update', (update: Uint8Array, origin: unknown) => {
        if (origin === NETWORK_ORIGIN || !this.isConnected(peer)) {
          return
        }

        for (const target of ['a', 'b'] as const) {
          if (target !== peer && this.isConnected(target)) {
            Y.applyUpdate(this.docs[target], update, NETWORK_ORIGIN)
          }
        }
      })
    }
  }

  connect(peer: PeerId) {
    if (this.isConnected(peer)) {
      return
    }

    this.connections.set(peer, true)

    for (const target of ['a', 'b'] as const) {
      if (target !== peer && this.isConnected(target)) {
        this.exchangeState(peer, target)
      }
    }

    this.notify()
  }

  disconnect(peer: PeerId) {
    if (!this.isConnected(peer)) {
      return
    }

    this.connections.set(peer, false)
    this.notify()
  }

  getConnection(peer: PeerId): NetworkConnection {
    return this.isConnected(peer) ? 'connected' : 'disconnected'
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  private exchangeState(peer: PeerId, target: PeerId) {
    Y.applyUpdate(
      this.docs[peer],
      Y.encodeStateAsUpdate(this.docs[target]),
      NETWORK_ORIGIN
    )
    Y.applyUpdate(
      this.docs[target],
      Y.encodeStateAsUpdate(this.docs[peer]),
      NETWORK_ORIGIN
    )
  }

  private isConnected(peer: PeerId) {
    return this.connections.get(peer) === true
  }

  private notify() {
    for (const listener of this.listeners) {
      listener()
    }

    this.awarenessHub.emit()
  }
}

const initialValue: Value = [
  {
    type: 'paragraph',
    children: [{ text: 'Shared Slate Yjs document.' }],
  },
  {
    type: 'paragraph',
    children: [{ text: 'Use either editor; the other peer follows.' }],
  },
]

const createConnectionState = (): ExampleConnectionState => ({
  connections: new Map<PeerId, boolean>([
    ['a', true],
    ['b', true],
  ]),
})

const createAwarenessHub = (
  connectionState: ExampleConnectionState
): ExampleAwarenessHub => {
  const hub: ExampleAwarenessHub = {
    emit: () => {
      for (const listener of hub.listeners) {
        listener()
      }
    },
    isClientConnected: (clientID) => {
      const peer = CLIENT_PEERS.get(clientID)

      return !peer || connectionState.connections.get(peer) === true
    },
    listeners: new Set(),
    states: new Map(),
  }

  return hub
}

const createNetwork = () => {
  const seedDoc = new Y.Doc()
  const seedRoot = seedDoc.getXmlElement('slate')
  const docA = new Y.Doc()
  const docB = new Y.Doc()
  const connectionState = createConnectionState()
  const hub = createAwarenessHub(connectionState)
  const awarenessA = new ExampleAwareness(PEER_CLIENT_IDS.a, hub)
  const awarenessB = new ExampleAwareness(PEER_CLIENT_IDS.b, hub)

  writeSlateValueToYjs(seedRoot, initialValue)
  Y.applyUpdate(docA, Y.encodeStateAsUpdate(seedDoc), NETWORK_ORIGIN)
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(seedDoc), NETWORK_ORIGIN)

  awarenessA.setUser({ color: '#2563eb', name: 'Ada' })
  awarenessB.setUser({ color: '#f97316', name: 'Lin' })

  return {
    awarenessA,
    awarenessB,
    network: new ExampleNetwork({ a: docA, b: docB }, connectionState, hub),
    sharedRootA: docA.getXmlElement('slate'),
    sharedRootB: docB.getXmlElement('slate'),
  }
}

const pageCss = css`
  max-width: 1180px;
  margin: 32px auto;
  padding: 0 20px 48px;
`

const gridCss = css`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;

  @media (max-width: 860px) {
    grid-template-columns: 1fr;
  }
`

const peerCss = css`
  min-width: 0;
  border: 1px solid #d6dde8;
  border-radius: 8px;
  background: #fff;
`

const peerHeaderCss = css`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  border-bottom: 1px solid #e5e7eb;
  padding: 12px 14px;
`

const titleCss = css`
  margin: 0;
  font-size: 15px;
  line-height: 1.2;
`

const statusCss = css`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-end;
`

const pillCss = css`
  min-height: 24px;
  border-radius: 999px;
  background: #0f172a;
  color: white;
  padding: 4px 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 1.2;
`

const toolbarCss = css`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px 14px 0;
`

const buttonCss = css`
  min-height: 34px;
  border: 1px solid #bcc7d8;
  border-radius: 8px;
  background: #f8fafc;
  padding: 7px 10px;
  color: #111827;
  cursor: pointer;
  font-size: 13px;
  font-weight: 650;

  &:hover {
    background: #eef2f7;
  }

  &:disabled {
    border-color: #d1d5db;
    background: #e5e7eb;
    color: #6b7280;
    cursor: not-allowed;
  }

  &:disabled:hover {
    background: #e5e7eb;
  }
`

const editorCss = css`
  min-height: 188px;
  margin: 12px 14px;
  border: 1px solid #dfe5ee;
  border-radius: 8px;
  padding: 14px 16px;
  background: #ffffff;
`

const cursorCss = css`
  display: grid;
  gap: 6px;
  min-height: 72px;
  border-top: 1px solid #e5e7eb;
  padding: 12px 14px 14px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 1.45;
  color: #334155;
`

const getDocumentEnd = (editor: Editor): Range['anchor'] =>
  editor.read((state) => {
    return state.points.end([])
  })

const getDocumentRange = (editor: Editor): Range =>
  editor.read((state) => ({
    anchor: state.points.start([]),
    focus: state.points.end([]),
  }))

const getFirstWordRange = (editor: Editor): Range =>
  editor.read((state) => {
    const text = state.text.string([0])
    const end = Math.min(text.length, Math.max(1, text.indexOf(' ')))

    return {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: end },
    }
  })

const formatRange = (range: Range | null) =>
  range
    ? `${range.anchor.path.join('.')}:${range.anchor.offset}-${range.focus.path.join('.')}:${range.focus.offset}`
    : 'none'

const useNetworkConnection = (
  network: ExampleNetwork,
  peer: PeerId
): NetworkConnection =>
  useSyncExternalStore(
    network.subscribe,
    () => network.getConnection(peer),
    () => network.getConnection(peer)
  )

type DOMRangeEditor = Editor & {
  api: {
    dom: {
      assertDOMNode: (node: Editor) => HTMLElement
      focus: () => void
      resolveDOMRange: (range: Range) => globalThis.Range | null
    }
  }
}

const getDOMEditor = (editor: Editor) => editor as DOMRangeEditor

const selectDOMRange = (editor: Editor, range: Range) => {
  const domEditor = getDOMEditor(editor)
  const element = domEditor.api.dom.assertDOMNode(domEditor)
  const domRange = domEditor.api.dom.resolveDOMRange(range)

  if (!domRange) {
    return false
  }

  element.focus({ preventScroll: true })

  const selection = element.ownerDocument.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(domRange)
  element.ownerDocument.dispatchEvent(
    new element.ownerDocument.defaultView!.Event('selectionchange')
  )

  return true
}

const insertTextAsUser = (editor: Editor, range: Range, text: string) => {
  const domEditor = getDOMEditor(editor)
  const element = domEditor.api.dom.assertDOMNode(domEditor)

  if (!selectDOMRange(editor, range)) {
    return
  }

  element.ownerDocument.execCommand('insertText', false, text)
}

const replaceTextAsUser = (editor: Editor, text: string) => {
  const domEditor = getDOMEditor(editor)
  const element = domEditor.api.dom.assertDOMNode(domEditor)
  const domRange = domEditor.api.dom.resolveDOMRange(getDocumentRange(editor))

  if (!domRange) {
    return
  }

  element.focus({ preventScroll: true })

  const selection = element.ownerDocument.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(domRange)

  const event = new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    data: text,
    inputType: 'insertText',
  }) as InputEvent & { getTargetRanges: () => StaticRange[] }

  event.getTargetRanges = () => [
    new StaticRange({
      endContainer: domRange.endContainer,
      endOffset: domRange.endOffset,
      startContainer: domRange.startContainer,
      startOffset: domRange.startOffset,
    }),
  ]

  element.dispatchEvent(event)

  if (!event.defaultPrevented) {
    element.ownerDocument.execCommand('insertText', false, text)
  }
}

const PeerPanel = ({
  id,
  name,
  network,
}: {
  id: PeerId
  name: string
  network: ExampleNetwork
}) => {
  const editor = useEditor<Editor>()
  const history = useSlateHistory()
  const state = useSlateYjsState(editor)
  const remoteCursors = useSlateYjsRemoteCursorStates(editor)
  const networkConnection = useNetworkConnection(network, id)
  const testPrefix = `yjs-peer-${id}`

  const connect = () => network.connect(id)
  const disconnect = () => network.disconnect(id)
  const reconcile = () =>
    editor.update((tx) => {
      ;(tx as typeof tx & { yjs: SlateYjsTxApi }).yjs.reconcile()
    })
  const undo = () => history.undo()
  const redo = () => history.redo()

  const appendText = () => {
    const point = getDocumentEnd(editor)

    insertTextAsUser(editor, { anchor: point, focus: point }, ` ${name}`)
  }

  const selectFirstWord = () => {
    selectDOMRange(editor, getFirstWordRange(editor))
  }

  const replaceDocument = () => {
    replaceTextAsUser(editor, `${name} canonical snapshot.`)
  }

  return (
    <section className={peerCss} data-test-id={`${testPrefix}-panel`}>
      <header className={peerHeaderCss}>
        <h2 className={titleCss}>{name}</h2>
        <div className={statusCss}>
          <output className={pillCss} data-test-id={`${testPrefix}-connection`}>
            net:{networkConnection} yjs:{state.connection}
          </output>
          <output className={pillCss} data-test-id={`${testPrefix}-counts`}>
            e:{state.exports} i:{state.imports} r:{state.revision}
          </output>
        </div>
      </header>
      <div className={toolbarCss}>
        <button
          className={buttonCss}
          data-test-id={`${testPrefix}-connect`}
          onClick={connect}
        >
          Connect
        </button>
        <button
          className={buttonCss}
          data-test-id={`${testPrefix}-disconnect`}
          onClick={disconnect}
        >
          Disconnect
        </button>
        <button
          className={buttonCss}
          data-test-id={`${testPrefix}-append`}
          onClick={appendText}
          onMouseDown={(event) => event.preventDefault()}
        >
          Append
        </button>
        <button
          className={buttonCss}
          data-test-id={`${testPrefix}-select`}
          onClick={selectFirstWord}
          onMouseDown={(event) => event.preventDefault()}
        >
          Select
        </button>
        <button
          className={buttonCss}
          data-test-id={`${testPrefix}-replace`}
          onClick={replaceDocument}
          onMouseDown={(event) => event.preventDefault()}
        >
          Replace
        </button>
        <button
          className={buttonCss}
          data-test-id={`${testPrefix}-undo`}
          disabled={!history.canUndo}
          onClick={undo}
        >
          Undo
        </button>
        <button
          className={buttonCss}
          data-test-id={`${testPrefix}-redo`}
          disabled={!history.canRedo}
          onClick={redo}
        >
          Redo
        </button>
        <button
          className={buttonCss}
          data-test-id={`${testPrefix}-reconcile`}
          onClick={reconcile}
        >
          Reconcile
        </button>
      </div>
      <div id={`${testPrefix}-editor-surface`}>
        <Editable className={editorCss} placeholder="Write..." />
      </div>
      <output className={cursorCss} data-test-id={`${testPrefix}-cursors`}>
        {remoteCursors.length === 0
          ? 'remote:none'
          : remoteCursors
              .map(
                (cursor) =>
                  `${cursor.clientId}:${formatRange(cursor.range)}:${JSON.stringify(cursor.user)}`
              )
              .join('\n')}
      </output>
    </section>
  )
}

const YjsCollaborationExample = () => {
  const network = useMemo(() => createNetwork(), [])
  const extensionA = useMemo(
    () =>
      createYjsExtension({
        autoConnect: true,
        awareness: network.awarenessA,
        sharedRoot: network.sharedRootA,
      }),
    [network]
  )
  const extensionB = useMemo(
    () =>
      createYjsExtension({
        autoConnect: true,
        awareness: network.awarenessB,
        sharedRoot: network.sharedRootB,
      }),
    [network]
  )
  const editorA = useSlateEditor({
    extensions: [extensionA] as const,
    initialSelection: {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    },
    initialValue,
  })
  const editorB = useSlateEditor({
    extensions: [extensionB] as const,
    initialSelection: {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    },
    initialValue,
  })

  return (
    <main className={pageCss}>
      <div className={gridCss}>
        <Slate editor={editorA}>
          <PeerPanel id="a" name="Ada" network={network.network} />
        </Slate>
        <Slate editor={editorB}>
          <PeerPanel id="b" name="Lin" network={network.network} />
        </Slate>
      </div>
    </main>
  )
}

export default YjsCollaborationExample
