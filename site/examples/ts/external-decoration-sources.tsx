import { css } from '@emotion/css'
import { type CSSProperties, useMemo, useRef, useState } from 'react'
import type { Value } from 'slate'
import {
  createDecorationSource,
  Editable,
  Slate,
  type SlateProjection,
  useSlateEditor,
} from 'slate-react'

import { Instruction } from './components'

type Tone = 'cool' | 'danger' | 'warm'
type Mode = 'alpha' | 'beta' | 'both' | 'none'

type DiagnosticProjection = SlateProjection<{
  label: string
  tone: Tone
}>

const initialChildren: Value = [
  {
    type: 'paragraph',
    children: [
      {
        text: 'External diagnostics can highlight editor content without pretending the data lives inside the Slate document.',
      },
    ],
  },
  {
    type: 'paragraph',
    children: [
      {
        text: 'Use this when search hits, review overlays, or remote diagnostics are owned by app state outside the editor snapshot.',
      },
    ],
  },
]

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
`

const statusCss = css`
  display: grid;
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

const toneStyles: Record<Tone, CSSProperties> = {
  cool: {
    backgroundColor: '#dbeafe',
    borderBottom: '2px solid #3b82f6',
  },
  danger: {
    backgroundColor: '#fee2e2',
    borderBottom: '2px solid #dc2626',
  },
  warm: {
    backgroundColor: '#fef3c7',
    borderBottom: '2px solid #f59e0b',
  },
}

const buildSnapshot = (
  mode: Mode,
  tone: Tone
): readonly DiagnosticProjection[] => {
  if (mode === 'none') {
    return []
  }

  const entries: DiagnosticProjection[] = []

  if (mode === 'alpha' || mode === 'both') {
    entries.push({
      data: {
        label: 'diagnostic-alpha',
        tone,
      },
      key: 'diagnostic-alpha',
      range: {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 20 },
      },
    })
  }

  if (mode === 'beta' || mode === 'both') {
    entries.push({
      data: {
        label: 'diagnostic-beta',
        tone,
      },
      key: 'diagnostic-beta',
      range: {
        anchor: { path: [1, 0], offset: 9 },
        focus: { path: [1, 0], offset: 34 },
      },
    })
  }

  return entries
}

const formatSnapshot = (snapshot: readonly DiagnosticProjection[]) =>
  snapshot.length === 0
    ? 'none'
    : snapshot
        .map((entry) => {
          const data =
            (entry.data as
              | {
                  label?: string
                  tone?: Tone
                }
              | undefined) ?? {}

          return `${entry.key}:${entry.range.anchor.path.join('.')}.${
            entry.range.anchor.offset
          }-${entry.range.focus.path.join('.')}.${entry.range.focus.offset}:${
            data.label ?? 'none'
          }:${data.tone ?? 'none'}`
        })
        .join('|')

const nextTone = (tone: Tone): Tone =>
  tone === 'warm' ? 'cool' : tone === 'cool' ? 'danger' : 'warm'

const ExternalDecorationSourcesExample = () => {
  const editor = useSlateEditor({ initialValue: initialChildren })
  const [mode, setMode] = useState<Mode>('alpha')
  const [tone, setTone] = useState<Tone>('warm')
  const [externalSnapshot, setExternalSnapshot] = useState<
    readonly DiagnosticProjection[]
  >(() => buildSnapshot('alpha', 'warm'))
  const externalSnapshotRef = useRef(externalSnapshot)

  const externalSource = useMemo(
    () =>
      createDecorationSource(editor, {
        dirtiness: 'external',
        id: 'external-diagnostics',
        read: () => externalSnapshotRef.current,
      }),
    [editor]
  )

  const applySnapshot = (
    next: readonly DiagnosticProjection[],
    nextMode: Mode,
    nextToneValue: Tone
  ) => {
    externalSnapshotRef.current = next
    setExternalSnapshot(next)
    setMode(nextMode)
    setTone(nextToneValue)
    externalSource.refresh({
      reason: 'external',
      sourceId: 'external-diagnostics',
    })
  }

  return (
    <div className={panelCss}>
      <Instruction>
        This example keeps overlay data in app-owned external state. The editor
        only consumes projected slices. Each button mutates external state, then
        calls{' '}
        <code>
          {
            'projectionStore.refresh({ reason: "external", sourceId: "external-diagnostics" })'
          }
        </code>{' '}
        to prove the explicit external refresh path.
      </Instruction>
      <div className={controlsCss}>
        <button
          className={buttonCss}
          onClick={() =>
            applySnapshot(buildSnapshot('alpha', tone), 'alpha', tone)
          }
          type="button"
        >
          Show alpha diagnostics
        </button>
        <button
          className={buttonCss}
          onClick={() =>
            applySnapshot(buildSnapshot('beta', tone), 'beta', tone)
          }
          type="button"
        >
          Show beta diagnostics
        </button>
        <button
          className={buttonCss}
          onClick={() =>
            applySnapshot(buildSnapshot('both', tone), 'both', tone)
          }
          type="button"
        >
          Show both diagnostics
        </button>
        <button
          className={buttonCss}
          onClick={() =>
            applySnapshot(buildSnapshot('none', tone), 'none', tone)
          }
          type="button"
        >
          Clear diagnostics
        </button>
        <button
          className={buttonCss}
          onClick={() => {
            const updatedTone = nextTone(tone)
            applySnapshot(buildSnapshot(mode, updatedTone), mode, updatedTone)
          }}
          type="button"
        >
          Rotate tone
        </button>
      </div>
      <div className={statusCss}>
        <span className={codeCss} id="external-decoration-mode">
          mode:{mode}
        </span>
        <span className={codeCss} id="external-decoration-tone">
          tone:{tone}
        </span>
        <span className={codeCss} id="external-decoration-update">
          {
            'last-update:refresh({ reason: "external", sourceId: "external-diagnostics" })'
          }
        </span>
        <span className={codeCss} id="external-decoration-snapshot">
          {formatSnapshot(externalSnapshot)}
        </span>
      </div>
      <Slate decorationSources={[externalSource]} editor={editor}>
        <Editable
          id="external-decoration-sources"
          renderSegment={(segment, children) => {
            const slice =
              (segment.slices[0]?.data as
                | {
                    tone?: Tone
                  }
                | undefined) ?? null

            return segment.slices.length > 0 ? (
              <span
                data-external-tone={slice?.tone ?? 'none'}
                style={{
                  borderRadius: 4,
                  ...toneStyles[slice?.tone ?? 'warm'],
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
      </Slate>
    </div>
  )
}

export default ExternalDecorationSourcesExample
