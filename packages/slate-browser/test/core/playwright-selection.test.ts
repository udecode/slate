import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

import { takeSelectionSnapshot } from '../../src/playwright'

const createPage = () =>
  ({
    evaluate: async <T>(
      callback: (arg: { key: string }) => T,
      arg: { key: string }
    ) => callback(arg),
  }) as Parameters<typeof takeSelectionSnapshot>[0]

describe('playwright selection snapshots', () => {
  beforeAll(() => {
    if (!GlobalRegistrator.isRegistered) {
      GlobalRegistrator.register()
    }
  })

  afterAll(async () => {
    if (GlobalRegistrator.isRegistered) {
      await GlobalRegistrator.unregister()
    }
  })

  test('normalizes zero-width DOM artifact offsets back to editor offset zero', async () => {
    document.body.innerHTML = `
      <div data-slate-editor="true">
        <span data-slate-node="text" data-slate-path="0,0">
          <span data-slate-leaf="true">
            <span data-slate-zero-width="n" data-slate-length="0">\uFEFF<br /></span>
          </span>
        </span>
      </div>
    `

    const marker = document.querySelector('[data-slate-zero-width="n"]')!
    const text = marker.firstChild as Text
    const br = marker.querySelector('br')!
    const selection = window.getSelection()!
    const page = createPage()

    const expectZeroWidthOffset = async (node: Node, offset: number) => {
      const range = document.createRange()

      range.setStart(node, offset)
      range.setEnd(node, offset)
      selection.removeAllRanges()
      selection.addRange(range)

      expect(await takeSelectionSnapshot(page)).toEqual({
        anchor: {
          path: [0, 0],
          offset: 0,
        },
        focus: {
          path: [0, 0],
          offset: 0,
        },
      })
    }

    await expectZeroWidthOffset(text, 1)
    await expectZeroWidthOffset(marker, 1)
    await expectZeroWidthOffset(br, 0)
  })
})
