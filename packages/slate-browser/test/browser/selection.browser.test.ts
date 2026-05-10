import { expect, it } from 'vitest'

import {
  takeDOMSelectionSnapshot,
  takeEditorSelectionSnapshot,
} from '../../src/browser/selection'

it('captures DOM and editor-shaped selection snapshots for a simple editor tree', () => {
  document.body.innerHTML = `
    <div data-slate-editor="true">
      <span data-slate-node="text"><span data-slate-string>alpha</span></span>
      <span data-slate-node="text"><span data-slate-string>beta</span></span>
    </div>
  `

  const root = document.querySelector('[data-slate-editor="true"]')!
  const first = root.querySelector('[data-slate-string]')!.firstChild as Text
  const selection = document.getSelection()!
  const range = document.createRange()

  range.setStart(first, 2)
  range.setEnd(first, 4)
  selection.removeAllRanges()
  selection.addRange(range)

  expect(takeDOMSelectionSnapshot(selection)).toEqual({
    anchorNodeText: 'alpha',
    anchorOffset: 2,
    focusNodeText: 'alpha',
    focusOffset: 4,
  })

  expect(takeEditorSelectionSnapshot(root, selection)).toEqual({
    anchor: {
      path: [0, 0],
      offset: 2,
    },
    focus: {
      path: [0, 0],
      offset: 4,
    },
  })
})

it('normalizes FEFF zero-width DOM offsets back to editor offset zero', () => {
  document.body.innerHTML = `
    <div data-slate-editor="true">
      <span data-slate-node="text">
        <span data-slate-leaf="true">
          <span data-slate-zero-width="n" data-slate-length="0">\uFEFF<br /></span>
        </span>
      </span>
    </div>
  `

  const root = document.querySelector('[data-slate-editor="true"]')!
  const marker = root.querySelector('[data-slate-zero-width="n"]')!
  const text = marker.firstChild as Text
  const selection = document.getSelection()!
  const range = document.createRange()

  range.setStart(text, 1)
  range.setEnd(text, 1)
  selection.removeAllRanges()
  selection.addRange(range)

  expect(takeDOMSelectionSnapshot(selection)).toEqual({
    anchorNodeText: '\uFEFF',
    anchorOffset: 1,
    focusNodeText: '\uFEFF',
    focusOffset: 1,
  })

  expect(takeEditorSelectionSnapshot(root, selection)).toEqual({
    anchor: {
      path: [0, 0],
      offset: 0,
    },
    focus: {
      path: [0, 0],
      offset: 0,
    },
  })
})

it('maps RTL DOM selections while preserving browser geometry direction', () => {
  document.body.innerHTML = `
    <div
      data-slate-editor="true"
      dir="rtl"
      style="font: 18px Arial; line-height: 24px; width: 240px;"
    >
      <span data-slate-node="text"><span data-slate-string>אבגד</span></span>
    </div>
  `

  const root = document.querySelector('[data-slate-editor="true"]')!
  const text = root.querySelector('[data-slate-string]')!.firstChild as Text
  const selection = document.getSelection()!
  const range = document.createRange()
  const firstCharacterRange = document.createRange()
  const lastCharacterRange = document.createRange()

  range.setStart(text, 1)
  range.setEnd(text, 3)
  selection.removeAllRanges()
  selection.addRange(range)
  firstCharacterRange.setStart(text, 0)
  firstCharacterRange.setEnd(text, 1)
  lastCharacterRange.setStart(text, 3)
  lastCharacterRange.setEnd(text, 4)

  expect(takeEditorSelectionSnapshot(root, selection)).toEqual({
    anchor: {
      path: [0, 0],
      offset: 1,
    },
    focus: {
      path: [0, 0],
      offset: 3,
    },
  })
  expect(firstCharacterRange.getBoundingClientRect().left).toBeGreaterThan(
    lastCharacterRange.getBoundingClientRect().left
  )
})

it('keeps wrapped-line DOM rectangles tied to one editor selection', () => {
  document.body.innerHTML = `
    <div
      data-slate-editor="true"
      style="font: 16px monospace; line-height: 20px; width: 90px;"
    >
      <span data-slate-node="text">
        <span data-slate-string>alpha beta gamma delta epsilon</span>
      </span>
    </div>
  `

  const root = document.querySelector('[data-slate-editor="true"]')!
  const text = root.querySelector('[data-slate-string]')!.firstChild as Text
  const selection = document.getSelection()!
  const range = document.createRange()

  range.setStart(text, 0)
  range.setEnd(text, text.textContent?.length ?? 0)
  selection.removeAllRanges()
  selection.addRange(range)

  const rects = Array.from(range.getClientRects())

  expect(takeEditorSelectionSnapshot(root, selection)).toEqual({
    anchor: {
      path: [0, 0],
      offset: 0,
    },
    focus: {
      path: [0, 0],
      offset: text.textContent?.length ?? 0,
    },
  })
  expect(rects.length).toBeGreaterThan(1)
  expect(
    new Set(rects.map((rect) => Math.round(rect.top))).size
  ).toBeGreaterThan(1)
})
