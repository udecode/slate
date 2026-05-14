import { css, cx } from '@emotion/css'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Range, Editor as SlateEditor, Value } from 'slate'
import { Editor } from 'slate/internal'
import { withHistory } from 'slate-history'
import {
  Editable,
  type ReactEditor,
  Slate,
  useEditorSelector,
  useSlateEditor,
} from 'slate-react'
import {
  connectYjsLocalAwareness,
  createYjsExtension,
  createYjsLocalAwareness,
  type YjsController,
  type YjsLocalAwareness,
} from 'slate-yjs'
import {
  RemoteCursorOverlay,
  useRemoteCursorDecorations,
  useRemoteCursorStates,
  useYjsControllerState,
  type YjsRemoteCursorState,
} from 'slate-yjs/react'
import * as Y from 'yjs'

const initialValue: Value = [
  {
    type: 'paragraph',
    children: [{ text: 'Alpha shared document' }],
  },
]

const emptyValue: Value = [
  {
    type: 'paragraph',
    children: [{ text: '' }],
  },
]

type PeerEnvironment = {
  awareness: YjsLocalAwareness
  controller: YjsController
  doc: Y.Doc
}

type CollaborationEnvironment = {
  left: PeerEnvironment
  right: PeerEnvironment
}

const panelCss = css`
  max-width: 1180px;
  margin: 32px auto 56px;
  padding: 0 24px;
  color: #172033;
  font-family:
    ui-sans-serif,
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
`

const headerCss = css`
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
`

const titleCss = css`
  margin: 0;
  font-size: 28px;
  line-height: 1.1;
`

const metricRowCss = css`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`

const metricCss = css`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid #d7dde8;
  border-radius: 999px;
  padding: 6px 10px;
  background: #f8fafc;
  color: #334155;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
`

const controlsCss = css`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0 0 18px;
`

const buttonCss = css`
  border: 1px solid #b9c3d4;
  border-radius: 8px;
  background: white;
  color: #172033;
  padding: 8px 11px;
  cursor: pointer;
  font-weight: 650;

  &:hover {
    border-color: #2563eb;
    color: #1d4ed8;
  }

  &:focus-visible {
    outline: 2px solid #2563eb;
    outline-offset: 2px;
  }
`

const peerGridCss = css`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;

  @media (max-width: 760px) {
    grid-template-columns: 1fr;
  }
`

const peerPanelCss = css`
  border: 1px solid #d7dde8;
  border-radius: 8px;
  background: white;
  overflow: hidden;
`

const peerHeaderCss = css`
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid #e4e8f0;
  background: #f8fafc;
`

const peerTitleCss = css`
  margin: 0;
  font-size: 16px;
`

const editorWrapCss = css`
  position: relative;
  min-height: 180px;
  padding: 14px 16px 18px;
`

const editorCss = css`
  min-height: 118px;
  border: 1px solid #e4e8f0;
  border-radius: 8px;
  padding: 14px;
  line-height: 1.55;

  &:focus {
    outline: 2px solid #2563eb;
    outline-offset: 2px;
  }
`

const readoutCss = css`
  display: grid;
  grid-template-columns: minmax(120px, 160px) minmax(0, 1fr);
  gap: 8px;
  padding: 0 16px 14px;
  font-size: 13px;
`

const codeCss = css`
  overflow: hidden;
  border-radius: 6px;
  background: #111827;
  color: white;
  padding: 4px 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const overlayCss = css`
  position: absolute;
  top: 12px;
  right: 16px;
  z-index: 1;
  display: flex;
  gap: 6px;
  font-size: 12px;
  font-weight: 700;
`

const remoteCursorChipCss = css`
  border-radius: 999px;
  background: white;
  padding: 3px 8px;
  box-shadow: 0 0 0 1px #d7dde8;
`

const sharedCss = css`
  margin-top: 16px;
  border-top: 1px solid #e4e8f0;
  padding-top: 14px;
`

const createEnvironment = (): CollaborationEnvironment => {
  const leftDoc = new Y.Doc()
  const rightDoc = new Y.Doc()
  const leftRoot = leftDoc.get('content', Y.XmlText) as Y.XmlText
  const rightRoot = rightDoc.get('content', Y.XmlText) as Y.XmlText
  const leftAwareness = createYjsLocalAwareness(1)
  const rightAwareness = createYjsLocalAwareness(2)

  leftAwareness.setLocalState({
    user: { color: '#2563eb', name: 'Left' },
  })
  rightAwareness.setLocalState({
    user: { color: '#059669', name: 'Right' },
  })

  return {
    left: {
      awareness: leftAwareness,
      controller: createYjsExtension({
        awareness: leftAwareness,
        sharedRoot: leftRoot,
      }),
      doc: leftDoc,
    },
    right: {
      awareness: rightAwareness,
      controller: createYjsExtension({
        awareness: rightAwareness,
        sharedRoot: rightRoot,
      }),
      doc: rightDoc,
    },
  }
}

const connectLocalDocs = (leftDoc: Y.Doc, rightDoc: Y.Doc) => {
  const syncLeftToRight = (update: Uint8Array, origin: unknown) => {
    if (origin !== rightDoc) {
      Y.applyUpdate(rightDoc, update, leftDoc)
    }
  }
  const syncRightToLeft = (update: Uint8Array, origin: unknown) => {
    if (origin !== leftDoc) {
      Y.applyUpdate(leftDoc, update, rightDoc)
    }
  }

  leftDoc.on('update', syncLeftToRight)
  rightDoc.on('update', syncRightToLeft)

  return () => {
    leftDoc.off('update', syncLeftToRight)
    rightDoc.off('update', syncRightToLeft)
  }
}

const endPoint = (editor: SlateEditor) => ({
  path: [0, 0],
  offset: Editor.string(editor, [0]).length,
})

const boundedSelection = (editor: SlateEditor): Range => {
  const text = Editor.string(editor, [0])
  const end = Math.min(Math.max(text.length, 1), 5)

  return {
    anchor: { path: [0, 0], offset: Math.min(1, end) },
    focus: { path: [0, 0], offset: end },
  }
}

const insertText = (editor: SlateEditor, text: string) => {
  editor.update((tx) => {
    tx.text.insert(text, { at: endPoint(editor) })
  })
}

const selectPreviewRange = (editor: SlateEditor) => {
  editor.update((tx) => {
    tx.selection.set(boundedSelection(editor))
  })
}

const PeerReadout = ({
  controller,
  prefix,
}: {
  controller: YjsController
  prefix: string
}) => {
  const text = useEditorSelector((editor) => Editor.string(editor, []))
  const cursors = useRemoteCursorStates(controller)

  return (
    <div className={readoutCss}>
      <strong>Text</strong>
      <span className={codeCss} id={`${prefix}-text`}>
        {text}
      </span>
      <strong>Remote cursors</strong>
      <span className={codeCss} id={`${prefix}-cursors`}>
        {cursors.length === 0
          ? 'none'
          : cursors
              .map((cursor) =>
                cursor.range
                  ? `${cursor.user?.name ?? cursor.clientId}:${cursor.range.anchor.offset}-${cursor.range.focus.offset}`
                  : `${cursor.user?.name ?? cursor.clientId}:none`
              )
              .join('|')}
      </span>
    </div>
  )
}

const PeerPanel = ({
  accent,
  controller,
  editor,
  label,
  prefix,
}: {
  accent: string
  controller: YjsController
  editor: ReactEditor
  label: string
  prefix: string
}) => {
  const state = useYjsControllerState(controller)
  const decorate = useRemoteCursorDecorations(controller)

  return (
    <section className={peerPanelCss}>
      <div className={peerHeaderCss}>
        <h2 className={peerTitleCss}>{label}</h2>
        <div className={metricRowCss}>
          <span className={metricCss} id={`${prefix}-connection`}>
            {state.connection}
          </span>
          <span className={metricCss} id={`${prefix}-exports`}>
            out {state.exports}
          </span>
          <span className={metricCss} id={`${prefix}-imports`}>
            in {state.imports}
          </span>
        </div>
      </div>
      <Slate editor={editor}>
        <div className={editorWrapCss}>
          <RemoteCursorOverlay
            className={overlayCss}
            controller={controller}
            renderCursor={(cursor) => (
              <span
                className={remoteCursorChipCss}
                style={{ color: cursor.user?.color ?? accent }}
              >
                {cursor.user?.name ?? `Peer ${cursor.clientId}`}
              </span>
            )}
          />
          <Editable
            className={editorCss}
            decorate={decorate}
            id={`${prefix}-editor`}
            renderSegment={(segment, children) => {
              const cursor = segment.slices
                .map(
                  (slice) =>
                    (
                      slice.data as
                        | { cursor?: YjsRemoteCursorState }
                        | undefined
                    )?.cursor
                )
                .find(Boolean)

              return cursor ? (
                <span
                  data-test-id={`${prefix}-remote-cursor-segment`}
                  style={{
                    background: `${cursor.user?.color ?? accent}26`,
                    boxShadow: `inset 0 -2px 0 ${cursor.user?.color ?? accent}`,
                  }}
                >
                  {children}
                </span>
              ) : (
                children
              )
            }}
            spellCheck={false}
          />
        </div>
        <PeerReadout controller={controller} prefix={prefix} />
      </Slate>
    </section>
  )
}

const SharedSnapshot = ({
  environment,
}: {
  environment: CollaborationEnvironment
}) => {
  const left = useYjsControllerState(environment.left.controller)
  const right = useYjsControllerState(environment.right.controller)
  const sharedText = environment.left.doc.get('content', Y.XmlText).toString()

  return (
    <div className={cx(sharedCss, readoutCss)}>
      <strong>Shared text</strong>
      <span className={codeCss} id="yjs-shared-text">
        {sharedText}
      </span>
      <strong>Revisions</strong>
      <span className={codeCss} id="yjs-revisions">
        {left.revision}:{right.revision}
      </span>
    </div>
  )
}

const CollaborationSession = ({ onReset }: { onReset: () => void }) => {
  const environment = useMemo(() => createEnvironment(), [])
  const leftEditor = useSlateEditor({
    initialValue,
    withEditor: withHistory,
  })
  const rightEditor = useSlateEditor({
    initialValue: emptyValue,
    withEditor: withHistory,
  })

  useEffect(() => {
    const disconnectDocs = connectLocalDocs(
      environment.left.doc,
      environment.right.doc
    )
    const disconnectAwareness = connectYjsLocalAwareness(
      environment.left.awareness,
      environment.right.awareness
    )
    const unextendLeft = leftEditor.extend(
      environment.left.controller.extension
    )
    const unextendRight = rightEditor.extend(
      environment.right.controller.extension
    )

    environment.left.controller.connect()
    environment.right.controller.connect()

    return () => {
      environment.left.controller.disconnect()
      environment.right.controller.disconnect()
      unextendLeft()
      unextendRight()
      disconnectAwareness()
      disconnectDocs()
    }
  }, [environment, leftEditor, rightEditor])

  const insertLeft = useCallback(() => {
    insertText(leftEditor, '!')
  }, [leftEditor])
  const insertRight = useCallback(() => {
    insertText(rightEditor, '?')
  }, [rightEditor])
  const selectLeft = useCallback(() => {
    selectPreviewRange(leftEditor)
  }, [leftEditor])
  const selectRight = useCallback(() => {
    selectPreviewRange(rightEditor)
  }, [rightEditor])
  const insertConcurrent = useCallback(() => {
    insertText(leftEditor, ' L')
    insertText(rightEditor, ' R')
  }, [leftEditor, rightEditor])
  const insertUnicode = useCallback(() => {
    insertText(leftEditor, ' Iñtërnâtiônàlizætiøn☃💩\uFEFF')
  }, [leftEditor])

  return (
    <main className={panelCss}>
      <div className={headerCss}>
        <h1 className={titleCss}>Yjs Collaboration</h1>
        <div className={metricRowCss}>
          <span className={metricCss}>offline transport</span>
          <span className={metricCss}>two editors</span>
        </div>
      </div>
      <div className={controlsCss}>
        <button className={buttonCss} onClick={insertLeft} type="button">
          Left insert
        </button>
        <button className={buttonCss} onClick={insertRight} type="button">
          Right insert
        </button>
        <button className={buttonCss} onClick={selectLeft} type="button">
          Left selection
        </button>
        <button className={buttonCss} onClick={selectRight} type="button">
          Right selection
        </button>
        <button className={buttonCss} onClick={insertConcurrent} type="button">
          Concurrent edit
        </button>
        <button className={buttonCss} onClick={insertUnicode} type="button">
          Unicode
        </button>
        <button
          className={buttonCss}
          onClick={() => {
            environment.right.controller.pause()
          }}
          type="button"
        >
          Pause right
        </button>
        <button
          className={buttonCss}
          onClick={() => {
            environment.right.controller.resume()
          }}
          type="button"
        >
          Resume right
        </button>
        <button
          className={buttonCss}
          onClick={() => {
            environment.left.controller.undo()
          }}
          type="button"
        >
          Undo left
        </button>
        <button
          className={buttonCss}
          onClick={() => {
            environment.left.controller.redo()
          }}
          type="button"
        >
          Redo left
        </button>
        <button className={buttonCss} onClick={onReset} type="button">
          Reset
        </button>
      </div>
      <div className={peerGridCss}>
        <PeerPanel
          accent="#2563eb"
          controller={environment.left.controller}
          editor={leftEditor}
          label="Left"
          prefix="yjs-left"
        />
        <PeerPanel
          accent="#059669"
          controller={environment.right.controller}
          editor={rightEditor}
          label="Right"
          prefix="yjs-right"
        />
      </div>
      <SharedSnapshot environment={environment} />
    </main>
  )
}

const YjsCollaborationExample = () => {
  const [sessionKey, setSessionKey] = useState(0)

  return (
    <CollaborationSession
      key={sessionKey}
      onReset={() => {
        setSessionKey((key) => key + 1)
      }}
    />
  )
}

export default YjsCollaborationExample
