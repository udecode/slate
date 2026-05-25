import { css, cx } from '@emotion/css'
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
import { useMemo, useState, useSyncExternalStore } from 'react'
import { type Editor, NodeApi, type Range, type Value } from 'slate'
import {
  Editable,
  type RenderElementProps,
  type RenderLeafProps,
  Slate,
  useEditor,
  useEditorSelector,
  useSlateEditor,
  useSlateHistory,
} from 'slate-react'
import * as Y from 'yjs'
import { Icon } from './components'

const PEERS = [
  {
    id: 'a',
    clientId: 101,
    color: '#2563eb',
    displayName: 'Stanford Schulist',
    userName: 'Ada',
  },
  {
    id: 'b',
    clientId: 202,
    color: '#f97316',
    displayName: 'Wilhelmine Wyman',
    userName: 'Lin',
  },
  {
    id: 'c',
    clientId: 303,
    color: '#16a34a',
    displayName: "Lulu O'Conner",
    userName: 'Kai',
  },
  {
    id: 'd',
    clientId: 404,
    color: '#7c3aed',
    displayName: 'Aiden Rice',
    userName: 'Nia',
  },
] as const

type Peer = (typeof PEERS)[number]
type PeerId = Peer['id']
type MarkFormat = 'bold' | 'italic' | 'underline' | 'code' | 'link'
type BlockFormat =
  | 'heading-one'
  | 'heading-two'
  | 'block-quote'
  | 'numbered-list'
  | 'bulleted-list'

type NetworkConnection = 'connected' | 'disconnected'

const PEER_IDS = PEERS.map((peer) => peer.id)
const PEER_BY_ID = new Map<PeerId, Peer>(PEERS.map((peer) => [peer.id, peer]))

const CLIENT_PEERS = new Map<number, PeerId>(
  PEERS.map((peer) => [peer.clientId, peer.id])
)

const MARK_CONTROLS: { format: MarkFormat; icon: string; label: string }[] = [
  { format: 'bold', icon: 'format_bold', label: 'Bold' },
  { format: 'italic', icon: 'format_italic', label: 'Italic' },
  { format: 'underline', icon: 'format_underlined', label: 'Underline' },
  { format: 'code', icon: 'code', label: 'Code' },
  { format: 'link', icon: 'link', label: 'Link' },
]

const BLOCK_CONTROLS: { format: BlockFormat; icon: string; label: string }[] = [
  { format: 'heading-one', icon: 'looks_one', label: 'Heading one' },
  { format: 'heading-two', icon: 'looks_two', label: 'Heading two' },
  { format: 'block-quote', icon: 'format_quote', label: 'Quote' },
  {
    format: 'numbered-list',
    icon: 'format_list_numbered',
    label: 'Numbered list',
  },
  {
    format: 'bulleted-list',
    icon: 'format_list_bulleted',
    label: 'Bulleted list',
  },
]

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

    for (const peer of PEER_IDS) {
      this.docs[peer].on('update', (update: Uint8Array, origin: unknown) => {
        if (origin === NETWORK_ORIGIN || !this.isConnected(peer)) {
          return
        }

        for (const target of PEER_IDS) {
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

    for (const target of PEER_IDS) {
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
    children: [{ text: 'Hello world!' }],
  },
]

const createConnectionState = (): ExampleConnectionState => ({
  connections: new Map<PeerId, boolean>(
    PEERS.map((peer) => [peer.id, true] as const)
  ),
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
  const docs = {} as Record<PeerId, Y.Doc>
  const awareness = {} as Record<PeerId, ExampleAwareness>
  const sharedRoots = {} as Record<PeerId, Y.XmlElement>
  const connectionState = createConnectionState()
  const hub = createAwarenessHub(connectionState)

  writeSlateValueToYjs(seedRoot, initialValue)

  for (const peer of PEERS) {
    const doc = new Y.Doc()
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(seedDoc), NETWORK_ORIGIN)
    docs[peer.id] = doc
    awareness[peer.id] = new ExampleAwareness(peer.clientId, hub)
    awareness[peer.id].setUser({ color: peer.color, name: peer.userName })
    sharedRoots[peer.id] = doc.getXmlElement('slate')
  }

  return {
    awareness,
    network: new ExampleNetwork(docs, connectionState, hub),
    sharedRoots,
  }
}

const pageCss = css`
  box-sizing: border-box;
  width: min(1040px, calc(100vw - 48px));
  margin: -20px 0 -20px 50%;
  padding: 44px 40px 72px;
  transform: translateX(-50%);
  background: #ffffff;
`

const gridCss = css`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;

  @media (max-width: 860px) {
    grid-template-columns: 1fr;
  }
`

const peerCss = css`
  min-width: 0;
  border: 1px solid #e5e7eb;
  background: #f3f4f6;
  padding: 18px;
  transition:
    background-color 120ms ease,
    border-color 120ms ease;
`

const peerOfflineCss = css`
  border-color: #fecaca;
  background: #fee2e2;
`

const peerHeaderCss = css`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding-bottom: 14px;
`

const titleCss = css`
  margin: 0;
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.2;
`

const headerActionsCss = css`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
`

const toolbarCss = css`
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  border: 1px solid #e5e7eb;
  border-bottom: 0;
  background: #ffffff;
  padding: 10px 12px 0;
`

const markButtonCss = css`
  display: inline-flex;
  min-width: 18px;
  height: 24px;
  align-items: center;
  justify-content: center;
  border: 0;
  background: transparent;
  color: #f9a8b8;
  cursor: pointer;
  padding: 0;

  &:hover,
  &:focus-visible {
    color: #db2777;
  }
`

const markButtonActiveCss = css`
  color: #be123c;
`

const iconCss = css`
  font-size: 17px;
  line-height: 1;
`

const buttonCss = css`
  min-height: 34px;
  border: 1px solid #db7093;
  border-radius: 0;
  background: transparent;
  padding: 7px 10px;
  color: #db7093;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;

  &:hover {
    background: #fff1f2;
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
  min-height: 78px;
  border: 1px solid #e5e7eb;
  border-top: 0;
  padding: 8px 12px 18px;
  background: #ffffff;
  box-shadow: 0 1px 4px rgb(15 23 42 / 0.12);
  outline: none;

  p,
  blockquote,
  h1,
  h2,
  ol,
  ul {
    margin: 0;
  }

  h1 {
    font-size: 20px;
  }

  h2 {
    font-size: 17px;
  }

  blockquote {
    border-left: 3px solid #f9a8b8;
    padding-left: 10px;
  }

  code {
    border-radius: 3px;
    background: #f3f4f6;
    padding: 1px 3px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
`

const simulationControlsCss = css`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding-top: 10px;
`

const diagnosticPanelCss = css`
  display: grid;
  gap: 4px;
  margin-top: 10px;
  border-top: 1px solid #e5e7eb;
  padding-top: 8px;
  color: #64748b;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  line-height: 1.35;
`

const diagnosticLineCss = css`
  display: block;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
`

const userLineCss = css`
  display: inline-flex;
  align-items: center;
  gap: 6px;
`

const userSwatchCss = css`
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--yjs-user-color);
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

const getActiveMarks = (editor: Editor) =>
  editor.read((state) => state.marks.get()) as Partial<
    Record<MarkFormat, boolean>
  > | null

const isMarkActive = (editor: Editor, format: MarkFormat) =>
  getActiveMarks(editor)?.[format] === true

const toggleMark = (editor: Editor, format: MarkFormat) => {
  editor.update((tx) => {
    tx.marks.toggle(format)
  })
}

const isBlockActive = (editor: Editor, format: BlockFormat) => {
  const selection = editor.read((state) => state.selection.get())

  if (!selection) {
    return false
  }

  return editor.read((state) =>
    state.nodes.some({
      at: state.ranges.unhang(selection),
      match: (node) => NodeApi.isElement(node) && node.type === format,
    })
  )
}

const toggleBlock = (editor: Editor, format: BlockFormat) => {
  const nextType = isBlockActive(editor, format) ? 'paragraph' : format

  editor.update((tx) => {
    tx.nodes.set(
      { type: nextType },
      {
        match: (node) => NodeApi.isElement(node) && tx.nodes.isBlock(node),
      }
    )
  })
}

const Element = ({ attributes, children, element }: RenderElementProps) => {
  switch ((element as { type?: string }).type) {
    case 'heading-one':
      return <h1 {...attributes}>{children}</h1>
    case 'heading-two':
      return <h2 {...attributes}>{children}</h2>
    case 'block-quote':
      return <blockquote {...attributes}>{children}</blockquote>
    case 'numbered-list':
      return (
        <ol {...attributes}>
          <li>{children}</li>
        </ol>
      )
    case 'bulleted-list':
      return (
        <ul {...attributes}>
          <li>{children}</li>
        </ul>
      )
    default:
      return <p {...attributes}>{children}</p>
  }
}

const Leaf = ({ attributes, children, leaf }: RenderLeafProps) => {
  const marks = leaf as Partial<Record<MarkFormat, boolean>>

  if (marks.bold) {
    children = <strong>{children}</strong>
  }
  if (marks.code) {
    children = <code>{children}</code>
  }
  if (marks.italic) {
    children = <em>{children}</em>
  }
  if (marks.underline) {
    children = <u>{children}</u>
  }
  if (marks.link) {
    children = (
      <span style={{ color: '#db2777', textDecoration: 'underline' }}>
        {children}
      </span>
    )
  }

  return <span {...attributes}>{children}</span>
}

const MarkButton = ({
  format,
  icon,
  label,
  testPrefix,
}: {
  format: MarkFormat
  icon: string
  label: string
  testPrefix: string
}) => {
  const editor = useEditor<Editor>()
  const active = useEditorSelector((editor: Editor) =>
    isMarkActive(editor, format)
  )

  return (
    <button
      aria-label={label}
      className={cx(markButtonCss, active && markButtonActiveCss)}
      data-test-id={`${testPrefix}-mark-${format}`}
      onClick={() => toggleMark(editor, format)}
      onMouseDown={(event) => event.preventDefault()}
      type="button"
    >
      <Icon className={iconCss}>{icon}</Icon>
    </button>
  )
}

const BlockButton = ({
  format,
  icon,
  label,
  testPrefix,
}: {
  format: BlockFormat
  icon: string
  label: string
  testPrefix: string
}) => {
  const editor = useEditor<Editor>()
  const active = useEditorSelector((editor: Editor) =>
    isBlockActive(editor, format)
  )

  return (
    <button
      aria-label={label}
      className={cx(markButtonCss, active && markButtonActiveCss)}
      data-test-id={`${testPrefix}-block-${format}`}
      onClick={() => toggleBlock(editor, format)}
      onMouseDown={(event) => event.preventDefault()}
      type="button"
    >
      <Icon className={iconCss}>{icon}</Icon>
    </button>
  )
}

const PeerPanel = ({
  id,
  network,
  onRemove,
}: {
  id: PeerId
  network: ExampleNetwork
  onRemove: (id: PeerId) => void
}) => {
  const editor = useEditor<Editor>()
  const history = useSlateHistory()
  const state = useSlateYjsState(editor)
  const remoteCursors = useSlateYjsRemoteCursorStates(editor)
  const networkConnection = useNetworkConnection(network, id)
  const testPrefix = `yjs-peer-${id}`
  const peer = PEER_BY_ID.get(id)!
  const isOnline = networkConnection === 'connected'
  const visibleRemoteCursors = remoteCursors.filter((cursor) => cursor.range)

  const connect = () => network.connect(id)
  const disconnect = () => network.disconnect(id)
  const toggleConnection = isOnline ? disconnect : connect
  const remove = () => {
    disconnect()
    onRemove(id)
  }
  const reconcile = () =>
    editor.update((tx) => {
      ;(tx as typeof tx & { yjs: SlateYjsTxApi }).yjs.reconcile()
    })
  const undo = () => history.undo()
  const redo = () => history.redo()

  const appendText = () => {
    const point = getDocumentEnd(editor)

    insertTextAsUser(
      editor,
      { anchor: point, focus: point },
      ` ${peer.userName}`
    )
  }

  const selectFirstWord = () => {
    selectDOMRange(editor, getFirstWordRange(editor))
  }

  const replaceDocument = () => {
    replaceTextAsUser(editor, `${peer.userName} canonical snapshot.`)
  }
  const canMoveSecondBlock = useEditorSelector((editor: Editor) =>
    editor.read((state) => (state.value.get().roots.main ?? []).length > 1)
  )
  const moveSecondBlockToTop = () => {
    editor.update((tx) => {
      tx.nodes.move({ at: [1], to: [0] })
    })
  }

  return (
    <section
      className={cx(peerCss, !isOnline && peerOfflineCss)}
      data-test-id={`${testPrefix}-panel`}
    >
      <header className={peerHeaderCss}>
        <h2 className={titleCss}>Editor: {peer.displayName}</h2>
        <div className={headerActionsCss}>
          <button
            className={buttonCss}
            data-test-id={`${testPrefix}-${isOnline ? 'disconnect' : 'connect'}`}
            onClick={toggleConnection}
            type="button"
          >
            Go {isOnline ? 'offline' : 'online'}
          </button>
          <button
            className={buttonCss}
            data-test-id={`${testPrefix}-remove`}
            onClick={remove}
            type="button"
          >
            Remove
          </button>
        </div>
      </header>
      <div className={toolbarCss}>
        {MARK_CONTROLS.map((control) => (
          <MarkButton
            key={control.format}
            testPrefix={testPrefix}
            {...control}
          />
        ))}
        {BLOCK_CONTROLS.map((control) => (
          <BlockButton
            key={control.format}
            testPrefix={testPrefix}
            {...control}
          />
        ))}
      </div>
      <div id={`${testPrefix}-editor-surface`}>
        <Editable
          className={editorCss}
          placeholder="Write..."
          renderElement={Element}
          renderLeaf={Leaf}
        />
      </div>
      <div className={simulationControlsCss}>
        <button
          className={buttonCss}
          data-test-id={`${testPrefix}-append`}
          onClick={appendText}
          onMouseDown={(event) => event.preventDefault()}
          type="button"
        >
          Append
        </button>
        <button
          className={buttonCss}
          data-test-id={`${testPrefix}-select`}
          onClick={selectFirstWord}
          onMouseDown={(event) => event.preventDefault()}
          type="button"
        >
          Select
        </button>
        <button
          className={buttonCss}
          data-test-id={`${testPrefix}-replace`}
          onClick={replaceDocument}
          onMouseDown={(event) => event.preventDefault()}
          type="button"
        >
          Replace
        </button>
        <button
          className={buttonCss}
          data-test-id={`${testPrefix}-move`}
          disabled={!canMoveSecondBlock}
          onClick={moveSecondBlockToTop}
          onMouseDown={(event) => event.preventDefault()}
          type="button"
        >
          Move
        </button>
        <button
          className={buttonCss}
          data-test-id={`${testPrefix}-undo`}
          disabled={!history.canUndo}
          onClick={undo}
          type="button"
        >
          Undo
        </button>
        <button
          className={buttonCss}
          data-test-id={`${testPrefix}-redo`}
          disabled={!history.canRedo}
          onClick={redo}
          type="button"
        >
          Redo
        </button>
        <button
          className={buttonCss}
          data-test-id={`${testPrefix}-reconcile`}
          onClick={reconcile}
          type="button"
        >
          Reconcile
        </button>
      </div>
      <div className={diagnosticPanelCss}>
        <output className={userLineCss} data-test-id={`${testPrefix}-user`}>
          <span
            className={userSwatchCss}
            style={{ '--yjs-user-color': peer.color } as React.CSSProperties}
          />
          user:{peer.userName} client:{peer.clientId}
        </output>
        <output
          className={diagnosticLineCss}
          data-test-id={`${testPrefix}-connection`}
        >
          net:{networkConnection} yjs:{state.connection}
        </output>
        <output
          className={diagnosticLineCss}
          data-test-id={`${testPrefix}-counts`}
        >
          e:{state.exports} i:{state.imports} r:{state.revision}
        </output>
        <output
          className={diagnosticLineCss}
          data-test-id={`${testPrefix}-cursors`}
        >
          {visibleRemoteCursors.length === 0
            ? 'remote:none'
            : visibleRemoteCursors
                .map(
                  (cursor) =>
                    `${cursor.clientId}:${formatRange(cursor.range)}:${JSON.stringify(cursor.user)}`
                )
                .join('\n')}
        </output>
      </div>
    </section>
  )
}

const PeerEditor = ({
  network,
  onRemove,
  peer,
}: {
  network: ReturnType<typeof createNetwork>
  onRemove: (id: PeerId) => void
  peer: Peer
}) => {
  const extension = useMemo(
    () =>
      createYjsExtension({
        autoConnect: true,
        awareness: network.awareness[peer.id],
        sharedRoot: network.sharedRoots[peer.id],
      }),
    [network, peer.id]
  )
  const editor = useSlateEditor({
    extensions: [extension] as const,
    ...(peer.id === 'a'
      ? {
          initialSelection: {
            anchor: { path: [0, 0], offset: 0 },
            focus: { path: [0, 0], offset: 0 },
          },
        }
      : {}),
    initialValue,
  })

  return (
    <Slate editor={editor}>
      <PeerPanel id={peer.id} network={network.network} onRemove={onRemove} />
    </Slate>
  )
}

const YjsCollaborationExample = () => {
  const network = useMemo(() => createNetwork(), [])
  const [visiblePeerIds, setVisiblePeerIds] = useState<PeerId[]>(() => [
    ...PEER_IDS,
  ])
  const removePeer = (id: PeerId) => {
    setVisiblePeerIds((current) => current.filter((peerId) => peerId !== id))
  }

  return (
    <main className={pageCss}>
      <div className={gridCss}>
        {visiblePeerIds.map((peerId) => {
          const peer = PEER_BY_ID.get(peerId)!

          return (
            <PeerEditor
              key={peer.id}
              network={network}
              onRemove={removePeer}
              peer={peer}
            />
          )
        })}
      </div>
    </main>
  )
}

export default YjsCollaborationExample
