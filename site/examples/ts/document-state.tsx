import { type ChangeEvent, type KeyboardEvent, useRef } from 'react'
import { defineStateField, type EditorCommit } from 'slate'
import {
  Editable,
  type ReactEditor,
  Slate,
  useEditor,
  useEditorState,
  useSetStateField,
  useSlateEditor,
  useStateFieldValue,
} from 'slate-react'

const documentTitle = defineStateField({
  key: 'document.title',
  collab: 'shared',
  history: 'push',
  initial: () => 'Untitled',
  persist: true,
})

const spellcheck = defineStateField({
  key: 'document.settings.spellcheck',
  collab: 'shared',
  history: 'push',
  initial: () => true,
  persist: true,
})

const formatList = (items: readonly string[]) =>
  items.length === 0 ? 'none' : items.join(',')

const formatCommit = (commit: EditorCommit | null) => {
  if (!commit) {
    return 'commit:none;ops:none;state:none;tags:none'
  }

  return [
    `commit:${commit.version}`,
    `ops:${formatList(commit.operations.map((operation) => operation.type))}`,
    `state:${formatList(commit.dirtyStateKeys)}`,
    `tags:${formatList(commit.tags)}`,
  ].join(';')
}

const getHistoryShortcut = (event: KeyboardEvent<HTMLInputElement>) => {
  const key = event.key.toLowerCase()
  const modifier = event.metaKey || event.ctrlKey

  if (!modifier || event.altKey) {
    return null
  }

  if (key === 'z') {
    return event.shiftKey ? 'redo' : 'undo'
  }

  if (key === 'y' && !event.shiftKey) {
    return 'redo'
  }

  return null
}

const DocumentStatePanel = () => {
  const editor = useEditor<ReactEditor>()
  const title = useStateFieldValue(documentTitle)
  const setTitle = useSetStateField(documentTitle)
  const spellcheckEnabled = useStateFieldValue(spellcheck)
  const setSpellcheckEnabled = useSetStateField(spellcheck)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const commitSummary = useEditorState((state) =>
    formatCommit(state.value.lastCommit())
  )

  const updateTitle = (event: ChangeEvent<HTMLInputElement>) => {
    setTitle(event.currentTarget.value)
  }

  const updateSpellcheck = (event: ChangeEvent<HTMLInputElement>) => {
    setSpellcheckEnabled(event.currentTarget.checked)
  }

  const restoreTitleFocus = () => {
    const input = titleInputRef.current

    if (!input) {
      return
    }

    const focusInput = () => {
      if (document.activeElement !== input) {
        input.focus({ preventScroll: true })
      }
    }

    queueMicrotask(focusInput)
    requestAnimationFrame(focusInput)
  }

  const handleTitleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const direction = getHistoryShortcut(event)

    if (!direction) {
      return
    }

    const hasHistoryBatch = editor.read((state) =>
      direction === 'undo'
        ? state.history.undos().length > 0
        : state.history.redos().length > 0
    )

    event.preventDefault()
    event.stopPropagation()

    if (!hasHistoryBatch) {
      restoreTitleFocus()
      return
    }

    editor.update(
      (tx) => {
        if (direction === 'undo') {
          tx.history.undo()
        } else {
          tx.history.redo()
        }
      },
      {
        metadata: {
          selection: { dom: 'preserve', focus: false, scroll: false },
        },
      }
    )
    restoreTitleFocus()
  }

  const receiveRemoteTitle = () => {
    const previousValue = editor.read((state) => state.getField(documentTitle))

    editor.update(
      (tx) => {
        tx.statePatches.replay([
          {
            key: documentTitle.key,
            previousValue,
            value: 'Remote Q2 Brief',
          },
        ])
      },
      {
        metadata: {
          collab: { origin: 'remote', saveToHistory: false },
          history: { mode: 'skip' },
          selection: { dom: 'preserve', focus: false, scroll: false },
        },
        tag: ['collaboration', 'remote-state'],
      }
    )
  }

  return (
    <div className="slate-document-state-panel">
      <div className="slate-document-state-top-bar">
        <label className="slate-document-state-title-label">
          Document title
          <input
            aria-label="Document title"
            className="slate-document-state-title-input"
            onChange={updateTitle}
            onKeyDown={handleTitleKeyDown}
            ref={titleInputRef}
            value={title}
          />
        </label>
        <label className="slate-document-state-toggle-label">
          <input
            aria-label="Enable spellcheck"
            checked={spellcheckEnabled}
            onChange={updateSpellcheck}
            type="checkbox"
          />
          Spellcheck
        </label>
      </div>
      <div className="slate-document-state-controls">
        <button
          className="slate-document-state-button"
          onClick={() => setTitle('Q3 Launch Brief')}
          type="button"
        >
          Set Q3 title
        </button>
        <button
          className="slate-document-state-button"
          onClick={() => {
            editor.update((tx) => tx.history.undo())
          }}
          type="button"
        >
          Undo document change
        </button>
        <button
          className="slate-document-state-button"
          onClick={() => {
            editor.update((tx) => tx.history.redo())
          }}
          type="button"
        >
          Redo document change
        </button>
        <button
          className="slate-document-state-button"
          onClick={receiveRemoteTitle}
          type="button"
        >
          Receive remote title
        </button>
      </div>
      <div className="slate-document-state-status">
        <span className="slate-document-state-code" id="document-state-title">
          title:{title}
        </span>
        <span
          className="slate-document-state-code"
          id="document-state-spellcheck"
        >
          spellcheck:{spellcheckEnabled ? 'on' : 'off'}
        </span>
        <span className="slate-document-state-code" id="document-state-commit">
          {commitSummary}
        </span>
      </div>
      <div
        className="slate-document-state-editor-surface"
        id="document-state-editor-surface"
      >
        <Editable
          className="slate-document-state-editor"
          id="document-state"
          spellCheck={spellcheckEnabled}
        />
      </div>
    </div>
  )
}

const DocumentStateExample = () => {
  const editor = useSlateEditor({
    extensions: [documentTitle, spellcheck],
    initialValue: {
      children: [
        {
          type: 'paragraph',
          children: [{ text: 'The body is still normal Slate content.' }],
        },
        {
          type: 'paragraph',
          children: [{ text: 'Title changes never need invisible nodes.' }],
        },
      ],
      state: {
        [documentTitle.key]: 'Q2 Planning Brief',
        [spellcheck.key]: true,
      },
    },
  })

  return (
    <Slate editor={editor}>
      <DocumentStatePanel />
    </Slate>
  )
}

export default DocumentStateExample
