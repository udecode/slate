import { JSDOM } from 'jsdom'
import { createEditor, type Descendant, type Range } from 'slate'
import { Editor } from 'slate/internal'

import {
  type DOMEditor,
  EDITOR_TO_ELEMENT,
  EDITOR_TO_KEY_TO_ELEMENT,
  EDITOR_TO_WINDOW,
  ELEMENT_TO_NODE,
  IS_COMPOSING,
  NODE_TO_ELEMENT,
  withDOM,
} from '../src/index'
import { DOMCoverage } from '../src/internal'

const createNestedEditor = () => {
  const editor = withDOM(createEditor()) as DOMEditor

  Editor.replace(editor, {
    children: [
      {
        type: 'section',
        children: [
          {
            type: 'summary',
            children: [{ text: 'Summary' }],
          },
          {
            type: 'paragraph',
            children: [{ text: 'Hidden alpha' }],
          },
        ],
      },
      {
        type: 'paragraph',
        children: [{ text: 'Visible beta' }],
      },
      {
        type: 'footer',
        children: [{ text: 'Hidden omega' }],
      },
    ] satisfies Descendant[],
  })

  return editor
}

const createLargeEditor = (blocks: number) => {
  const editor = withDOM(createEditor()) as DOMEditor

  Editor.replace(editor, {
    children: Array.from({ length: blocks }, (_, index) => ({
      type: 'paragraph',
      children: [{ text: `Block ${index}` }],
    })) satisfies Descendant[],
  })

  return editor
}

const withDom = (run: (document: Document) => void) => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>')

  try {
    run(dom.window.document)
  } finally {
    dom.window.close()
  }
}

const mountEditorRoot = (
  editor: DOMEditor,
  document: Document,
  root = document.createElement('div')
) => {
  root.setAttribute('data-slate-editor', 'true')
  root.setAttribute('contenteditable', 'true')
  document.body.appendChild(root)

  EDITOR_TO_ELEMENT.set(editor, root)
  EDITOR_TO_WINDOW.set(editor, document.defaultView!)
  ELEMENT_TO_NODE.set(root, editor)
  NODE_TO_ELEMENT.set(editor, root)
  EDITOR_TO_KEY_TO_ELEMENT.set(
    editor,
    EDITOR_TO_KEY_TO_ELEMENT.get(editor) ?? new WeakMap()
  )

  return root
}

const getRuntimeId = (editor: DOMEditor, path: number[]) => {
  const runtimeId = Editor.getRuntimeId(editor, path)

  if (!runtimeId) {
    throw new Error(`Missing runtime id at ${path.join('.')}`)
  }

  return runtimeId
}

class FakeDataTransfer {
  private readonly data = new Map<string, string>()

  getData(type: string) {
    return this.data.get(type) ?? ''
  }

  setData(type: string, value: string) {
    this.data.set(type, value)
  }
}

const registerSectionBodyBoundary = (editor: DOMEditor) =>
  DOMCoverage.registerBoundary(editor, {
    boundaryId: 'section-body',
    anchor: { type: 'summary-slot', runtimeId: getRuntimeId(editor, [0, 0]) },
    copyPolicy: 'include-model',
    coveredPathRanges: [{ anchor: [0, 1], focus: [0, 1] }],
    coveredRuntimeRanges: [
      {
        anchor: getRuntimeId(editor, [0, 1]),
        focus: getRuntimeId(editor, [0, 1]),
      },
    ],
    findPolicy: 'not-native-until-mounted',
    ownerPath: [0],
    ownerRuntimeId: getRuntimeId(editor, [0]),
    reason: 'app-collapse',
    selectionPolicy: 'boundary',
    state: 'intentionally-hidden',
    version: 1,
  })

const registerNestedParagraphBoundary = (editor: DOMEditor) =>
  DOMCoverage.registerBoundary(editor, {
    boundaryId: 'nested-paragraph',
    anchor: { type: 'placeholder', runtimeId: getRuntimeId(editor, [0, 1]) },
    copyPolicy: 'summary-only',
    coveredPathRanges: [{ anchor: [0, 1, 0], focus: [0, 1, 0] }],
    coveredRuntimeRanges: [],
    findPolicy: 'not-native-until-mounted',
    ownerPath: [0, 1],
    ownerRuntimeId: getRuntimeId(editor, [0, 1]),
    reason: 'app-collapse',
    selectionPolicy: 'materialize',
    state: 'intentionally-hidden',
    version: 1,
  })

const median = (values: number[]) => {
  const sorted = [...values].sort((left, right) => left - right)

  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

const measureRepeated = (run: () => void) => {
  const startedAt = performance.now()

  for (let index = 0; index < 100; index++) {
    run()
  }

  return performance.now() - startedAt
}

describe('DOM coverage boundaries', () => {
  test('resolves a nested hidden child point to a boundary instead of a DOM point', () => {
    withDom((document) => {
      const editor = createNestedEditor()

      mountEditorRoot(editor, document)

      registerSectionBodyBoundary(editor)

      const hiddenPoint = { path: [0, 1, 0], offset: 3 }

      expect(() => editor.dom.toDOMPoint(hiddenPoint)).toThrow(
        /Cannot resolve a DOM node from Slate node/
      )
      expect(
        DOMCoverage.toDOMPointOrBoundary(editor, hiddenPoint)
      ).toMatchObject({
        boundary: {
          boundaryId: 'section-body',
          reason: 'app-collapse',
          state: 'intentionally-hidden',
        },
        type: 'boundary',
      })
    })
  })

  test('tracks first and last root self boundaries without covering siblings', () => {
    const editor = createNestedEditor()

    DOMCoverage.registerBoundary(editor, {
      boundaryId: 'hidden-header',
      anchor: { type: 'placeholder', runtimeId: getRuntimeId(editor, [0]) },
      copyPolicy: 'exclude',
      coveredPathRanges: [{ anchor: [0], focus: [0] }],
      coveredRuntimeRanges: [],
      findPolicy: 'not-native-until-mounted',
      ownerPath: [0],
      ownerRuntimeId: getRuntimeId(editor, [0]),
      reason: 'app-hidden',
      selectionPolicy: 'boundary',
      state: 'intentionally-hidden',
      version: 1,
    })
    DOMCoverage.registerBoundary(editor, {
      boundaryId: 'hidden-footer',
      anchor: { type: 'placeholder', runtimeId: getRuntimeId(editor, [2]) },
      copyPolicy: 'exclude',
      coveredPathRanges: [{ anchor: [2], focus: [2] }],
      coveredRuntimeRanges: [],
      findPolicy: 'not-native-until-mounted',
      ownerPath: [2],
      ownerRuntimeId: getRuntimeId(editor, [2]),
      reason: 'app-hidden',
      selectionPolicy: 'boundary',
      state: 'intentionally-hidden',
      version: 1,
    })

    expect(
      DOMCoverage.getBoundaryForPoint(editor, { path: [0, 0, 0], offset: 0 })
        ?.boundaryId
    ).toBe('hidden-header')
    expect(
      DOMCoverage.getBoundaryForPoint(editor, { path: [2, 0], offset: 0 })
        ?.boundaryId
    ).toBe('hidden-footer')
    expect(
      DOMCoverage.getBoundaryForPoint(editor, { path: [1, 0], offset: 0 })
    ).toBeNull()
  })

  test('resolves a range crossing hidden content to boundary policy', () => {
    const editor = createNestedEditor()
    const range: Range = {
      anchor: { path: [0, 0, 0], offset: 0 },
      focus: { path: [1, 0], offset: 7 },
    }

    registerSectionBodyBoundary(editor)

    expect(DOMCoverage.toDOMRangeOrBoundary(editor, range)).toMatchObject({
      boundaries: [{ boundaryId: 'section-body' }],
      range,
      type: 'boundary-range',
    })
  })

  test('uses parent-hidden policy before nested child policy regardless of registration order', () => {
    const editor = createNestedEditor()

    registerNestedParagraphBoundary(editor)
    registerSectionBodyBoundary(editor)

    expect(
      DOMCoverage.getBoundaryForPoint(editor, { path: [0, 1, 0], offset: 0 })
    ).toMatchObject({
      boundaryId: 'section-body',
      copyPolicy: 'include-model',
      selectionPolicy: 'boundary',
    })

    expect(
      DOMCoverage.getBoundariesForRange(editor, {
        anchor: { path: [0, 1, 0], offset: 0 },
        focus: { path: [0, 1, 0], offset: 6 },
      }).map((boundary) => boundary.boundaryId)
    ).toEqual(['section-body', 'nested-paragraph'])
  })

  test('imports a placeholder DOM point as a boundary point', () => {
    withDom((document) => {
      const editor = createNestedEditor()
      const root = mountEditorRoot(editor, document)
      const placeholder = document.createElement('button')

      registerSectionBodyBoundary(editor)
      placeholder.setAttribute(
        DOMCoverage.boundaryElementAttribute,
        'section-body'
      )
      placeholder.setAttribute(DOMCoverage.boundaryEdgeAttribute, 'anchor')
      root.appendChild(placeholder)

      expect(
        DOMCoverage.toSlatePointFromBoundary(editor, [placeholder, 0])
      ).toMatchObject({
        boundary: { boundaryId: 'section-body' },
        edge: 'anchor',
        type: 'boundary-point',
      })
      expect(
        editor.dom.toSlatePoint([placeholder, 0], {
          exactMatch: true,
          suppressThrow: false,
        })
      ).toEqual({
        path: [0, 1, 0],
        offset: 0,
      })
      expect(
        DOMCoverage.toSlatePointFromBoundary(editor, [root, 1])
      ).toMatchObject({
        boundary: { boundaryId: 'section-body' },
        edge: 'anchor',
        type: 'boundary-point',
      })
      expect(
        editor.dom.toSlatePoint([root, 1], {
          exactMatch: true,
          suppressThrow: false,
        })
      ).toEqual({
        path: [0, 1, 0],
        offset: 0,
      })
    })
  })

  test('dispatches materialization through the internal boundary hook', () => {
    const editor = createNestedEditor()
    const materialized: string[] = []

    registerSectionBodyBoundary(editor)
    DOMCoverage.setMaterializeHandler(editor, (boundary, reason) => {
      materialized.push(`${boundary.boundaryId}:${reason}`)
      return true
    })

    expect(
      DOMCoverage.materializeBoundary(editor, 'section-body', 'selection')
    ).toEqual({
      boundaryId: 'section-body',
      reason: 'selection',
      status: 'handled',
    })
    expect(materialized).toEqual(['section-body:selection'])
  })

  test('does not materialize boundaries while composition is active', () => {
    const editor = createNestedEditor()
    const materialized: string[] = []

    registerSectionBodyBoundary(editor)
    DOMCoverage.setMaterializeHandler(editor, (boundary, reason) => {
      materialized.push(`${boundary.boundaryId}:${reason}`)
      return true
    })
    IS_COMPOSING.set(editor, true)

    try {
      expect(
        DOMCoverage.materializeBoundary(editor, 'section-body', 'selection')
      ).toEqual({
        boundaryId: 'section-body',
        reason: 'selection',
        status: 'unhandled',
      })
      expect(materialized).toEqual([])
    } finally {
      IS_COMPOSING.delete(editor)
    }
  })

  test('writes model-backed clipboard data when selection crosses hidden content', () => {
    withDom((document) => {
      const editor = createNestedEditor()
      const clipboard = new FakeDataTransfer()
      const staleDom = document.createElement('span')

      mountEditorRoot(editor, document)
      registerSectionBodyBoundary(editor)
      staleDom.textContent = 'STALE HIDDEN DOM'
      document.body.appendChild(staleDom)

      editor.update((tx) => {
        tx.selection.set({
          anchor: { path: [0, 1, 0], offset: 0 },
          focus: { path: [0, 1, 0], offset: 12 },
        })
      })

      editor.dom.clipboard.writeSelection(clipboard as unknown as DataTransfer)

      expect(clipboard.getData('text/plain')).toBe('Hidden alpha')
      expect(clipboard.getData('text/html')).toContain('Hidden alpha')
      expect(clipboard.getData('text/html')).not.toContain('STALE')
      expect(clipboard.getData('application/x-slate-fragment')).not.toBe('')
    })
  })

  test('pastes over a hidden selection through the model without stale DOM', () => {
    withDom((document) => {
      const editor = createNestedEditor()
      const clipboard = new FakeDataTransfer()
      const staleDom = document.createElement('span')

      mountEditorRoot(editor, document)
      registerSectionBodyBoundary(editor)
      staleDom.textContent = 'STALE HIDDEN DOM'
      document.body.appendChild(staleDom)
      clipboard.setData('text/plain', 'Pasted alpha')

      editor.update((tx) => {
        tx.selection.set({
          anchor: { path: [0, 1, 0], offset: 0 },
          focus: { path: [0, 1, 0], offset: 12 },
        })
        editor.dom.clipboard.insertData(clipboard as unknown as DataTransfer)
      })

      expect(Editor.getSnapshot(editor).children).toEqual([
        {
          type: 'section',
          children: [
            {
              type: 'summary',
              children: [{ text: 'Summary' }],
            },
            {
              type: 'paragraph',
              children: [{ text: 'Pasted alpha' }],
            },
          ],
        },
        {
          type: 'paragraph',
          children: [{ text: 'Visible beta' }],
        },
        {
          type: 'footer',
          children: [{ text: 'Hidden omega' }],
        },
      ])
      expect(staleDom.textContent).toBe('STALE HIDDEN DOM')
    })
  })

  test('programmatic selection inside a materialize boundary uses the hook instead of raw DOM lookup', () => {
    const editor = createNestedEditor()
    const materialized: string[] = []
    const hiddenPoint = { path: [0, 1, 0], offset: 0 }

    registerNestedParagraphBoundary(editor)
    DOMCoverage.setMaterializeHandler(editor, (boundary, reason) => {
      materialized.push(`${boundary.boundaryId}:${reason}`)
      return true
    })

    expect(() => editor.dom.toDOMPoint(hiddenPoint)).toThrow(
      /Cannot resolve a DOM node from Slate node/
    )
    expect(DOMCoverage.toDOMPointOrBoundary(editor, hiddenPoint)).toMatchObject(
      {
        boundary: {
          boundaryId: 'nested-paragraph',
          selectionPolicy: 'materialize',
        },
        type: 'boundary',
      }
    )
    expect(
      DOMCoverage.materializeBoundary(
        editor,
        'nested-paragraph',
        'programmatic'
      )
    ).toEqual({
      boundaryId: 'nested-paragraph',
      reason: 'programmatic',
      status: 'handled',
    })
    expect(materialized).toEqual(['nested-paragraph:programmatic'])
  })

  test('invalidates a boundary when split moves covered runtime outside its owner', () => {
    const editor = createNestedEditor()

    registerSectionBodyBoundary(editor)

    editor.update((tx) => {
      tx.nodes.split({ at: [0, 1] })
    })

    expect(DOMCoverage.getBoundary(editor, 'section-body')).toBeNull()
    expect(
      DOMCoverage.getBoundaryForPoint(editor, { path: [1, 0, 0], offset: 0 })
    ).toBeNull()
  })

  test('invalidates a boundary when merge removes its owner runtime', () => {
    const editor = withDOM(createEditor()) as DOMEditor

    Editor.replace(editor, {
      children: [
        {
          type: 'paragraph',
          children: [{ text: 'Before' }],
        },
        {
          type: 'section',
          children: [
            {
              type: 'summary',
              children: [{ text: 'Summary' }],
            },
            {
              type: 'paragraph',
              children: [{ text: 'Hidden alpha' }],
            },
          ],
        },
      ] satisfies Descendant[],
    })

    DOMCoverage.registerBoundary(editor, {
      boundaryId: 'merged-section-body',
      anchor: { type: 'placeholder', runtimeId: getRuntimeId(editor, [1, 1]) },
      copyPolicy: 'include-model',
      coveredPathRanges: [{ anchor: [1, 1], focus: [1, 1] }],
      coveredRuntimeRanges: [
        {
          anchor: getRuntimeId(editor, [1, 1]),
          focus: getRuntimeId(editor, [1, 1]),
        },
      ],
      findPolicy: 'not-native-until-mounted',
      ownerPath: [1],
      ownerRuntimeId: getRuntimeId(editor, [1]),
      reason: 'app-collapse',
      selectionPolicy: 'boundary',
      state: 'intentionally-hidden',
      version: 1,
    })

    editor.update((tx) => {
      tx.nodes.merge({ at: [1] })
    })

    expect(DOMCoverage.getBoundary(editor, 'merged-section-body')).toBeNull()
    expect(
      DOMCoverage.getBoundaryForPoint(editor, { path: [0, 2, 0], offset: 0 })
    ).toBeNull()
  })

  test('looks up points outside 100 boundaries in a 5000-block document within the stress budget', () => {
    const editor = createLargeEditor(5000)
    const outsidePoint = { path: [4999, 0], offset: 0 }
    const baselineSamples = Array.from({ length: 25 }, () =>
      measureRepeated(() => {
        Editor.hasPath(editor, outsidePoint.path)
      })
    )

    for (let index = 0; index < 100; index++) {
      const path = [index * 40]

      DOMCoverage.registerBoundary(editor, {
        boundaryId: `hidden-${index}`,
        anchor: { type: 'placeholder', runtimeId: getRuntimeId(editor, path) },
        copyPolicy: 'include-model',
        coveredPathRanges: [{ anchor: path, focus: path }],
        coveredRuntimeRanges: [],
        findPolicy: 'not-native-until-mounted',
        ownerPath: path,
        ownerRuntimeId: getRuntimeId(editor, path),
        reason: 'app-collapse',
        selectionPolicy: 'boundary',
        state: 'intentionally-hidden',
        version: 1,
      })
    }

    const coverageSamples = Array.from({ length: 25 }, () =>
      measureRepeated(() => {
        DOMCoverage.getBoundaryForPoint(editor, outsidePoint)
      })
    )

    expect(
      median(coverageSamples) - median(baselineSamples)
    ).toBeLessThanOrEqual(5)
  })
})
