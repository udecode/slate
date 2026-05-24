import { css } from '@emotion/css'
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

const pageCss = css`
  max-width: 880px;
  margin: 32px auto;
  padding: 0 24px 56px;
`

const topBarCss = css`
  display: grid;
  grid-template-columns: minmax(240px, 1fr) auto auto;
  gap: 12px;
  align-items: end;
  margin-bottom: 14px;

  @media (max-width: 720px) {
    grid-template-columns: 1fr;
  }
`

const titleLabelCss = css`
  display: grid;
  gap: 6px;
  font-size: 13px;
  font-weight: 650;
`

const titleInputCss = css`
  width: 100%;
  min-width: 0;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 20px;
  font-weight: 700;
`

const buttonCss = css`
  min-height: 42px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: white;
  padding: 9px 12px;
  cursor: pointer;
  font-weight: 650;
`

const documentCss = css`
  border: 1px solid #d8dee9;
  border-radius: 8px;
  background: #fff;
`

const rootSectionCss = css`
  display: grid;
  gap: 8px;
  padding: 16px 18px;
  pointer-events: auto;

  & + & {
    border-top: 1px solid #e5e7eb;
  }
`

const rootHeaderCss = css`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 700;
`

const badgeCss = css`
  max-width: 100%;
  overflow: hidden;
  border-radius: 999px;
  background: #111827;
  color: white;
  padding: 3px 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const editorCss = css`
  min-height: 72px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 12px 14px;
  background: #f9fafb;
  pointer-events: auto;
  position: relative;
  z-index: 1;
`

const bodyEditorCss = css`
  ${editorCss};
  min-height: 136px;
  background: #ffffff;
`

const statusCss = css`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 14px 0 0;
`

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
    <span className={badgeCss} id={id}>
      {root}:{text}
    </span>
  )
}

const RootEditor = ({
  className = editorCss,
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
    <section className={rootSectionCss} id={`${id}-surface`} {...chrome.props}>
      <div className={rootHeaderCss}>
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
    <div className={pageCss}>
      <div className={topBarCss}>
        <label className={titleLabelCss}>
          Document title
          <input
            aria-label="Document title"
            className={titleInputCss}
            onChange={onTitleChange}
            onKeyDown={titleHistory.onKeyDown}
            value={title}
          />
        </label>
        <button
          className={buttonCss}
          onClick={() => setTitle('Board Review Draft')}
          type="button"
        >
          Set review title
        </button>
        <button
          className={buttonCss}
          disabled={!history.canUndo}
          onClick={history.undo}
          type="button"
        >
          Undo document change
        </button>
        <button
          className={buttonCss}
          disabled={!history.canRedo}
          onClick={history.redo}
          type="button"
        >
          Redo document change
        </button>
      </div>
      <div className={documentCss}>
        <RootEditor
          id="multi-root-header"
          label="Header editor"
          placeholder="Add a running header"
          root="header"
        />
        <RootEditor
          className={bodyEditorCss}
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
      <div className={statusCss}>
        <span className={badgeCss} id="multi-root-title">
          title:{title}
        </span>
        <span className={badgeCss} id="multi-root-commit">
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
