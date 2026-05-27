import type { ChangeEvent } from 'react'
import { defineStateField, type EditorCommit, type Node } from 'slate'
import {
  Editable,
  Slate,
  useEditorState,
  useSetStateField,
  useSlateEditor,
  useSlateHistory,
  useSlateRootChrome,
  useSlateRootState,
  useStateFieldValue,
} from 'slate-react'

const documentTitle = defineStateField({
  key: 'document.title',
  collab: 'shared',
  history: 'push',
  initial: () => 'Untitled',
  persist: true,
})

const rootText = (state: { nodes: { children: () => readonly Node[] } }) =>
  state.nodes
    .children()
    .map((node) => {
      const children =
        'children' in node && Array.isArray(node.children) ? node.children : []

      return children
        .map((child) =>
          typeof (child as { text?: unknown }).text === 'string'
            ? (child as { text: string }).text
            : ''
        )
        .join('')
    })
    .join(' ')

const formatList = (items: readonly string[]) =>
  items.length === 0 ? 'none' : items.join(',')

const formatCommit = (commit: EditorCommit | null) => {
  if (!commit) {
    return 'commit:none;ops:none;state:none;tags:none'
  }

  return [
    `commit:${commit.version}`,
    `ops:${formatList(commit.operations.map((operation) => operation.type))}`,
    `roots:${formatList(
      commit.operations.map(
        (operation) => (operation as { root?: string }).root ?? 'main'
      )
    )}`,
    `state:${formatList(commit.dirtyStateKeys)}`,
    `tags:${formatList(commit.tags)}`,
  ].join(';')
}

const RootStatus = ({ id, root }: { id: string; root: string }) => {
  const text = useSlateRootState(root, rootText)

  return (
    <span className="slate-multi-root-document-badge" id={id}>
      {root}:{text}
    </span>
  )
}

const RootEditor = ({
  className = 'slate-multi-root-document-editor',
  id,
  label,
  placeholder,
  root,
}: {
  className?: string
  id: string
  label: string
  placeholder: string
  root?: string
}) => {
  const rootKey = root ?? 'main'
  const chrome = useSlateRootChrome(rootKey)

  return (
    <section
      className="slate-multi-root-document-root-section"
      id={`${id}-surface`}
      {...chrome.props}
    >
      <div className="slate-multi-root-document-root-header">
        <span>{label}</span>
        <RootStatus id={`${id}-status`} root={rootKey} />
      </div>
      <Editable
        aria-label={label}
        autoFocus={rootKey === 'main'}
        className={className}
        id={id}
        placeholder={placeholder}
        readOnly={false}
        root={root}
      />
    </section>
  )
}

const MultiRootPanel = () => {
  const history = useSlateHistory()
  const titleHistory = useSlateHistory({ focusPolicy: 'preserve-dom' })
  const title = useStateFieldValue(documentTitle)
  const setTitleField = useSetStateField(documentTitle)
  const commitSummary = useEditorState((state) =>
    formatCommit(state.value.lastCommit())
  )

  const setTitle = (value: string) => {
    setTitleField(value)
  }

  const onTitleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setTitle(event.currentTarget.value)
  }

  return (
    <div className="slate-multi-root-document-page">
      <div className="slate-multi-root-document-top-bar">
        <label className="slate-multi-root-document-title-label">
          Document title
          <input
            aria-label="Document title"
            className="slate-multi-root-document-title-input"
            onChange={onTitleChange}
            onKeyDown={titleHistory.onKeyDown}
            value={title}
          />
        </label>
        <button
          className="slate-multi-root-document-button"
          onClick={() => setTitle('Board Review Draft')}
          type="button"
        >
          Set review title
        </button>
        <button
          className="slate-multi-root-document-button"
          disabled={!history.canUndo}
          onClick={history.undo}
          type="button"
        >
          Undo document change
        </button>
        <button
          className="slate-multi-root-document-button"
          disabled={!history.canRedo}
          onClick={history.redo}
          type="button"
        >
          Redo document change
        </button>
      </div>
      <div className="slate-multi-root-document-document">
        <RootEditor
          id="multi-root-header"
          label="Header editor"
          placeholder="Add a running header"
          root="header"
        />
        <RootEditor
          className="slate-multi-root-document-editor slate-multi-root-document-body-editor"
          id="multi-root-main"
          label="Body editor"
          placeholder="Draft the body"
        />
        <RootEditor
          id="multi-root-footer"
          label="Footer editor"
          placeholder="Add a footer note"
          root="footer"
        />
      </div>
      <div className="slate-multi-root-document-status">
        <span className="slate-multi-root-document-badge" id="multi-root-title">
          title:{title}
        </span>
        <span
          className="slate-multi-root-document-badge"
          id="multi-root-commit"
        >
          {commitSummary}
        </span>
      </div>
    </div>
  )
}

const MultiRootDocumentExample = () => {
  const editor = useSlateEditor({
    extensions: [documentTitle],
    initialValue: {
      roots: {
        footer: [
          {
            type: 'paragraph',
            children: [{ text: 'Prepared for leadership review' }],
          },
        ],
        header: [
          {
            type: 'paragraph',
            children: [{ text: 'Confidential quarterly plan' }],
          },
        ],
        main: [
          {
            type: 'paragraph',
            children: [{ text: 'The body root carries the document content.' }],
          },
          {
            type: 'paragraph',
            children: [{ text: 'Header and footer are editable roots.' }],
          },
        ],
      },
      state: {
        [documentTitle.key]: 'Q2 Operating Plan',
      },
    },
  })

  return (
    <Slate editor={editor}>
      <MultiRootPanel />
    </Slate>
  )
}

export default MultiRootDocumentExample
