import { css } from '@emotion/css'
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

const panelCss = css`
  max-width: 760px;
  margin: 40px auto;
  padding: 0 24px 48px;
`

const topBarCss = css`
  display: grid;
  grid-template-columns: minmax(220px, 1fr) auto;
  gap: 12px;
  align-items: end;
  margin-bottom: 14px;

  @media (max-width: 640px) {
    grid-template-columns: 1fr;
  }
`

const titleLabelCss = css`
  display: grid;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
`

const titleInputCss = css`
  width: 100%;
  min-width: 0;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 20px;
  font-weight: 650;
`

const toggleLabelCss = css`
  display: inline-flex;
  gap: 8px;
  align-items: center;
  min-height: 42px;
  font-size: 14px;
  font-weight: 600;
`

const controlsCss = css`
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 0 0 14px;
`

const buttonCss = css`
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: white;
  padding: 9px 12px;
  cursor: pointer;
  font-weight: 650;
`

const statusCss = css`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
`

const codeCss = css`
  padding: 3px 8px;
  border-radius: 999px;
  background: #111827;
  color: white;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
`

const editorCss = css`
  min-height: 118px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 14px 16px;
  background: #ffffff;
`

const editorSurfaceCss = css`
  display: contents;
`

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
    <div className={panelCss}>
      <div className={topBarCss}>
        <label className={titleLabelCss}>
          Document title
          <input
            aria-label="Document title"
            className={titleInputCss}
            onChange={updateTitle}
            onKeyDown={handleTitleKeyDown}
            ref={titleInputRef}
            value={title}
          />
        </label>
        <label className={toggleLabelCss}>
          <input
            aria-label="Enable spellcheck"
            checked={spellcheckEnabled}
            onChange={updateSpellcheck}
            type="checkbox"
          />
          Spellcheck
        </label>
      </div>
      <div className={controlsCss}>
        <button
          className={buttonCss}
          onClick={() => setTitle('Q3 Launch Brief')}
          type="button"
        >
          Set Q3 title
        </button>
        <button
          className={buttonCss}
          onClick={() => {
            editor.update((tx) => tx.history.undo())
          }}
          type="button"
        >
          Undo document change
        </button>
        <button
          className={buttonCss}
          onClick={() => {
            editor.update((tx) => tx.history.redo())
          }}
          type="button"
        >
          Redo document change
        </button>
        <button
          className={buttonCss}
          onClick={receiveRemoteTitle}
          type="button"
        >
          Receive remote title
        </button>
      </div>
      <div className={statusCss}>
        <span className={codeCss} id="document-state-title">
          title:{title}
        </span>
        <span className={codeCss} id="document-state-spellcheck">
          spellcheck:{spellcheckEnabled ? 'on' : 'off'}
        </span>
        <span className={codeCss} id="document-state-commit">
          {commitSummary}
        </span>
      </div>
      <div className={editorSurfaceCss} id="document-state-editor-surface">
        <Editable
          className={editorCss}
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
