import { css } from '@emotion/css'
import { type CSSProperties, useState } from 'react'
import { type EditorSnapshot, NodeApi, type Range } from 'slate'
import {
  Editable,
  Slate,
  type SlateRangeDecoration,
  useEditor,
  useEditorState,
  useSlateEditor,
  useSlateRangeDecorationSource,
} from 'slate-react'

import { Instruction } from './components'

type LintSeverity = 'error' | 'info' | 'warning'

type LintIssue = {
  id: string
  message: string
  ruleId: string
  severity: LintSeverity
  fixText?: string
}

type LintMode = 'local' | 'off' | 'server'

type LintIssueDecoration = {
  data: LintIssue
  key: string
  range: Range
}

const NO_LINT_ISSUES: readonly LintIssueDecoration[] = []

const panelCss = css`
  max-width: 760px;
  margin: 40px auto;
  padding: 0 24px 48px;
`

const controlsCss = css`
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin: 0 0 16px;
`

const buttonCss = css`
  border: 1px solid #d1d5db;
  background: white;
  padding: 10px 14px;
  border-radius: 10px;
  cursor: pointer;
  font-weight: 600;

  &:disabled {
    color: #9ca3af;
    cursor: not-allowed;
  }
`

const statusCss = css`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0 0 16px;
`

const codeCss = css`
  padding: 3px 8px;
  border-radius: 999px;
  background: #111827;
  color: white;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
`

const issueListCss = css`
  display: grid;
  gap: 8px;
  margin: 0 0 20px;
  padding: 0;
  list-style: none;
`

const issueCss = css`
  padding: 8px 10px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #f9fafb;
`

const lintStyles: Record<LintSeverity, CSSProperties> = {
  error: {
    backgroundColor: '#fee2e2',
    borderBottom: '2px solid #dc2626',
  },
  info: {
    backgroundColor: '#dbeafe',
    borderBottom: '2px solid #2563eb',
  },
  warning: {
    backgroundColor: '#fef3c7',
    borderBottom: '2px solid #f59e0b',
  },
}

const rootFor = (snapshot: EditorSnapshot) => ({
  children: snapshot.children,
})

const keyFor = (ruleId: string, range: Range) =>
  `${ruleId}:${range.anchor.path.join('.')}:${range.anchor.offset}`

const createIssue = (
  range: Range,
  issue: Omit<LintIssue, 'id'>
): LintIssueDecoration => {
  const id = keyFor(issue.ruleId, range)

  return {
    data: {
      ...issue,
      id,
    },
    key: id,
    range,
  }
}

const collectLintIssues = (
  snapshot: EditorSnapshot,
  {
    includeServerDiagnostics = false,
  }: {
    includeServerDiagnostics?: boolean
  } = {}
): LintIssueDecoration[] => {
  const root = rootFor(snapshot)
  const issues: LintIssueDecoration[] = []

  issues.push(
    ...NodeApi.findTextRanges(
      root,
      /\b(obviously|clearly|evidently|simply)\b/gi
    ).map((range) =>
      createIssue(range, {
        message: 'Avoid filler words in product copy.',
        ruleId: 'style-filler-word',
        severity: 'warning',
      })
    )
  )

  issues.push(
    ...NodeApi.findTextRanges(root, / , ?/g).map((range) =>
      createIssue(range, {
        fixText: ', ',
        message: 'Remove the space before commas.',
        ruleId: 'comma-spacing',
        severity: 'error',
      })
    )
  )

  if (includeServerDiagnostics) {
    issues.push(
      ...NodeApi.findTextRanges(root, 'server diagnostics', {
        caseSensitive: false,
      }).map((range) =>
        createIssue(range, {
          message: 'Server rule prefers "remote lint results" here.',
          ruleId: 'server-terminology',
          severity: 'info',
        })
      )
    )
  }

  return issues
}

const formatIssues = (issues: readonly LintIssueDecoration[]) =>
  issues.length === 0
    ? 'none'
    : issues
        .map((issue) => `${issue.data.ruleId}:${issue.data.severity}`)
        .join('|')

const getSegmentIssue = (
  slices: readonly { data?: unknown }[]
): LintIssue | null => {
  const issues = slices
    .map((slice) => slice.data as LintIssue | undefined)
    .filter((issue): issue is LintIssue => Boolean(issue))

  return (
    issues.find((issue) => issue.severity === 'error') ??
    issues.find((issue) => issue.severity === 'warning') ??
    issues[0] ??
    null
  )
}

const LintingPanel = ({
  lintMode,
  setLintMode,
  setSourceLabel,
  sourceLabel,
}: {
  lintMode: LintMode
  setLintMode: (mode: LintMode) => void
  setSourceLabel: (label: string) => void
  sourceLabel: string
}) => {
  const editor = useEditor()
  const diagnostics = useEditorState(
    (state) =>
      lintMode === 'off'
        ? NO_LINT_ISSUES
        : collectLintIssues(state.runtime.snapshot(), {
            includeServerDiagnostics: lintMode === 'server',
          }),
    { deps: [lintMode] }
  )

  const collectFromEditor = (mode: LintMode) =>
    mode === 'off'
      ? NO_LINT_ISSUES
      : collectLintIssues(
          editor.read((state) => state.runtime.snapshot()),
          {
            includeServerDiagnostics: mode === 'server',
          }
        )

  const runLocalLint = () => {
    setLintMode('local')
    setSourceLabel('local')
  }

  const applyFirstFix = () => {
    const mode = lintMode === 'off' ? 'local' : lintMode
    const fix = collectFromEditor(mode).find(
      (diagnostic) => diagnostic.data.fixText
    )

    const fixText = fix?.data.fixText

    if (!fixText) {
      return
    }

    editor.update((tx) => {
      tx.text.delete({ at: fix.range })
      tx.text.insert(fixText, { at: fix.range.anchor })
    })
    setLintMode(mode)
    setSourceLabel('fixed')
  }

  const receiveServerDiagnostics = () => {
    setLintMode('server')
    setSourceLabel('server')
  }

  const clearDiagnostics = () => {
    setLintMode('off')
    setSourceLabel('cleared')
  }

  return (
    <div className={panelCss}>
      <Instruction>
        This linter keeps findings outside the Slate document.{' '}
        <code>useSlateRangeDecorationSource</code> reads the current editor
        snapshot, maps lint findings to ranges, and refreshes on text edits or
        external source changes.
      </Instruction>
      <div className={controlsCss}>
        <button className={buttonCss} onClick={runLocalLint} type="button">
          Run linter
        </button>
        <button
          className={buttonCss}
          disabled={!diagnostics.some((diagnostic) => diagnostic.data.fixText)}
          onClick={applyFirstFix}
          type="button"
        >
          Apply first fix
        </button>
        <button
          className={buttonCss}
          onClick={receiveServerDiagnostics}
          type="button"
        >
          Receive server diagnostics
        </button>
        <button className={buttonCss} onClick={clearDiagnostics} type="button">
          Clear diagnostics
        </button>
      </div>
      <div className={statusCss}>
        <span className={codeCss} id="linting-source">
          source:{sourceLabel}
        </span>
        <span className={codeCss} id="linting-count">
          issues:{diagnostics.length}
        </span>
        <span className={codeCss} id="linting-snapshot">
          {formatIssues(diagnostics)}
        </span>
      </div>
      <ul className={issueListCss} id="linting-issues">
        {diagnostics.map((diagnostic) => (
          <li
            className={issueCss}
            data-lint-issue={diagnostic.data.id}
            key={diagnostic.data.id}
          >
            <strong>{diagnostic.data.severity}</strong>:{' '}
            {diagnostic.data.message}
          </li>
        ))}
      </ul>
      <Editable
        id="external-decoration-sources"
        renderSegment={(segment, children) => {
          const issue = getSegmentIssue(segment.slices)

          return issue ? (
            <span
              data-lint-rule={issue.ruleId}
              data-lint-severity={issue.severity}
              style={{
                borderRadius: 4,
                ...lintStyles[issue.severity],
              }}
            >
              {children}
            </span>
          ) : (
            children
          )
        }}
        style={{ minHeight: 96 }}
      />
    </div>
  )
}

const LintingExample = () => {
  const editor = useSlateEditor({
    initialValue: [
      {
        type: 'paragraph',
        children: [
          {
            text: 'This paragraph obviously has a spacing problem ,and the linter should report it.',
          },
        ],
      },
      {
        type: 'paragraph',
        children: [
          {
            text: 'Server diagnostics can arrive later without changing the Slate document.',
          },
        ],
      },
    ],
  })
  const [lintMode, setLintMode] = useState<LintMode>('off')
  const [sourceLabel, setSourceLabel] = useState('idle')

  const lintingSource = useSlateRangeDecorationSource<LintIssue>(editor, {
    deps: [lintMode],
    id: 'linting',
    dirtiness: ['text', 'external'],
    read: ({ snapshot }): readonly SlateRangeDecoration<LintIssue>[] =>
      lintMode === 'off'
        ? []
        : collectLintIssues(snapshot, {
            includeServerDiagnostics: lintMode === 'server',
          }),
  })

  return (
    <Slate decorationSources={[lintingSource]} editor={editor}>
      <LintingPanel
        lintMode={lintMode}
        setLintMode={setLintMode}
        setSourceLabel={setSourceLabel}
        sourceLabel={sourceLabel}
      />
    </Slate>
  )
}

export default LintingExample
