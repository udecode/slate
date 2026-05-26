import {
  createEditorRuntime,
  createEditorView,
  defineEditorExtension,
  type Point,
  type RootKey,
} from 'slate'
import { setDOMClipboardFormatKey } from 'slate-dom/internal'
import { describe, expect, it } from 'vitest'

import {
  getProjectedViewSelectionFragment,
  writeProjectedViewSelectionClipboardData,
} from '../src/editable/projected-clipboard'
import type { ReactRuntimeEditor } from '../src/plugin/react-editor'
import {
  createSlateProjectionGraph,
  type SlateProjectionOwner,
} from '../src/projection-graph'
import {
  createSlateViewSelection,
  writeSlateViewSelection,
} from '../src/view-selection'

const SHARED_ROOT = 'synced-block:shared:body' as RootKey

const contentRootExtension = defineEditorExtension({
  elements: [
    {
      type: 'content-card',
      contentRoot: { slot: 'body' },
      void: 'editable-island',
    },
  ],
  name: 'projected-clipboard-test',
})

const paragraph = (text: string) => ({
  type: 'paragraph',
  children: [{ text }],
})

const contentCard = (bodyRoot = SHARED_ROOT) => ({
  type: 'content-card',
  childRoots: { body: bodyRoot },
  children: [{ text: '' }],
})

const sharedOwner = {
  childRoot: SHARED_ROOT,
  ownerPath: [1],
  ownerRoot: 'main',
} satisfies SlateProjectionOwner

const point = (
  root: RootKey | undefined,
  path: readonly number[],
  offset: number
): Point => ({
  ...(root ? { root } : {}),
  path: [...path],
  offset,
})

const createFixture = () => {
  const runtime = createEditorRuntime({
    extensions: [contentRootExtension],
    initialValue: {
      roots: {
        [SHARED_ROOT]: [paragraph('Inside'), paragraph('More')],
        main: [paragraph('Before'), contentCard(), paragraph('After')],
      },
    },
  })
  const editor = createEditorView(runtime, {
    root: 'main',
  }) as unknown as ReactRuntimeEditor
  const graph = createSlateProjectionGraph([
    { path: [0], root: 'main' },
    { owner: sharedOwner, path: [0], root: SHARED_ROOT },
  ])

  writeSlateViewSelection(
    editor,
    createSlateViewSelection(graph, {
      anchor: { point: point(undefined, [0, 0], 'Bef'.length) },
      focus: {
        owner: sharedOwner,
        point: point(SHARED_ROOT, [0, 0], 'In'.length),
      },
    })
  )

  return { editor }
}

const createClipboardData = () => {
  const data = new Map<string, string>()

  return {
    data,
    setData: (type: string, value: string) => {
      data.set(type, value)
    },
  }
}

const decodeSlateFragment = (encoded: string) =>
  JSON.parse(decodeURIComponent(globalThis.atob(encoded)))

describe('projected clipboard', () => {
  it('serializes projected selection fragments in visible order across roots', () => {
    const { editor } = createFixture()

    expect(getProjectedViewSelectionFragment(editor)).toEqual([
      paragraph('ore'),
      paragraph('In'),
    ])
  })

  it('writes plain text, html, and Slate fragment data from the projected model selection', () => {
    const { editor } = createFixture()
    const clipboardData = createClipboardData()

    expect(
      writeProjectedViewSelectionClipboardData(editor, clipboardData)
    ).toBe(true)
    expect(clipboardData.data.get('text/plain')).toBe('ore\nIn')
    expect(clipboardData.data.get('text/html')).toContain(
      'data-slate-fragment='
    )
    expect(
      decodeSlateFragment(
        clipboardData.data.get('application/x-slate-fragment')!
      )
    ).toEqual([paragraph('ore'), paragraph('In')])
  })

  it('uses the editor clipboard format key for projected Slate fragment data', () => {
    const { editor } = createFixture()
    const clipboardData = createClipboardData()

    setDOMClipboardFormatKey(editor, 'x-custom-slate-fragment')

    expect(
      writeProjectedViewSelectionClipboardData(editor, clipboardData)
    ).toBe(true)
    expect(clipboardData.data.get('application/x-slate-fragment')).toBe(
      undefined
    )
    expect(
      decodeSlateFragment(
        clipboardData.data.get('application/x-custom-slate-fragment')!
      )
    ).toEqual([paragraph('ore'), paragraph('In')])
    expect(clipboardData.data.get('text/html')).toContain(
      'data-slate-fragment-format="x-custom-slate-fragment"'
    )
  })
})
