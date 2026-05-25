import { expect, type Page, test } from '@playwright/test'

import { openExample } from 'slate-browser/playwright'

type PeerId = 'a' | 'b' | 'c' | 'd'

const byTestId = (page: Page, id: string) =>
  page.locator(`[data-test-id="${id}"]`)

const peerSurface = (page: Page, peer: PeerId) =>
  page.locator(`#yjs-peer-${peer}-editor-surface`)

const peerTextbox = (page: Page, peer: PeerId) =>
  peerSurface(page, peer).locator('[role="textbox"]')

const selectFirstText = async (page: Page, peer: PeerId, length: number) => {
  await peerTextbox(page, peer).click({ position: { x: 8, y: 28 } })
  await page.keyboard.press('Home')
  await page.keyboard.down('Shift')

  for (let index = 0; index < length; index++) {
    await page.keyboard.press('ArrowRight')
  }

  await page.keyboard.up('Shift')
}

const getPeerParagraphTexts = (page: Page, peer: PeerId) =>
  peerTextbox(page, peer).evaluate((textbox) =>
    [...textbox.querySelectorAll('p')].map(
      (paragraph) => paragraph.textContent ?? ''
    )
  )

const getHistoryShortcuts = (page: Page) =>
  page.evaluate(() =>
    /Mac|iPhone|iPad/.test(navigator.platform)
      ? { redo: 'Meta+Shift+Z', undo: 'Meta+Z' }
      : { redo: 'Control+Shift+Z', undo: 'Control+Z' }
  )

const replacePeerText = async (
  page: Page,
  peer: PeerId,
  paragraphs: string[]
) => {
  await peerTextbox(page, peer).click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type(paragraphs[0] ?? '')

  for (const paragraph of paragraphs.slice(1)) {
    await page.keyboard.press('Enter')
    await page.keyboard.type(paragraph)
  }
}

const placePeerCaret = async (
  page: Page,
  peer: PeerId,
  paragraphIndex: number,
  offset: number
) => {
  const point = await page.evaluate(
    ({ offset, paragraphIndex, peer }) => {
      const root = document.querySelector(`#yjs-peer-${peer}-editor-surface`)
      const textbox = root?.querySelector<HTMLElement>('[role="textbox"]')
      const paragraph = textbox?.querySelectorAll('p')[paragraphIndex]
      const textNode = paragraph
        ? document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT).nextNode()
        : null

      if (!textbox || !textNode) {
        throw new Error(`Peer ${peer} paragraph ${paragraphIndex} not found`)
      }

      const paragraphRect = paragraph!.getBoundingClientRect()

      if (offset <= 0) {
        return {
          x: paragraphRect.left + 2,
          y: paragraphRect.top + paragraphRect.height / 2,
        }
      }

      const range = document.createRange()
      const boundedOffset = Math.min(offset, textNode.textContent?.length ?? 0)

      range.setStart(textNode, 0)
      range.setEnd(textNode, boundedOffset)

      const rect = range.getBoundingClientRect()

      return {
        x: Math.max(paragraphRect.left + 2, rect.right + 1),
        y: rect.top + rect.height / 2,
      }
    },
    { offset, paragraphIndex, peer }
  )

  await page.mouse.click(point.x, point.y)
}

const selectPeerParagraphNode = async (
  page: Page,
  peer: PeerId,
  paragraphIndex: number
) => {
  await page.evaluate(
    ({ paragraphIndex, peer }) => {
      const root = document.querySelector(`#yjs-peer-${peer}-editor-surface`)
      const textbox = root?.querySelector<HTMLElement>('[role="textbox"]')
      const paragraph = textbox?.querySelectorAll('p')[paragraphIndex]

      if (!textbox || !paragraph) {
        throw new Error(`Peer ${peer} paragraph ${paragraphIndex} not found`)
      }

      const range = document.createRange()

      range.selectNode(paragraph)

      const selection = document.getSelection()

      selection?.removeAllRanges()
      selection?.addRange(range)
      textbox.focus()
      document.dispatchEvent(new Event('selectionchange'))
    },
    { paragraphIndex, peer }
  )
}

test.describe('yjs collaboration example', () => {
  test('syncs marks applied from one editor to all connected editors', async ({
    page,
  }) => {
    await openExample(page, 'yjs-collaboration', {
      ready: { editor: 'visible' },
      surface: { scope: '#yjs-peer-a-editor-surface' },
    })

    await byTestId(page, 'yjs-peer-a-select').click()
    await byTestId(page, 'yjs-peer-a-mark-bold').click()

    for (const peer of ['a', 'b', 'c', 'd'] as const) {
      await expect(peerSurface(page, peer).locator('strong')).toContainText(
        'Hello'
      )
    }
  })

  test('projects awareness selection to the remote peer', async ({ page }) => {
    await openExample(page, 'yjs-collaboration', {
      ready: { editor: 'visible' },
      surface: { scope: '#yjs-peer-a-editor-surface' },
    })

    await byTestId(page, 'yjs-peer-a-select').click()

    await expect(byTestId(page, 'yjs-peer-b-cursors')).toContainText(
      '101:0.0:0-0.0:5'
    )
  })

  test('clears remote cursor presence while a peer is disconnected', async ({
    page,
  }) => {
    await openExample(page, 'yjs-collaboration', {
      ready: { editor: 'visible' },
      surface: { scope: '#yjs-peer-a-editor-surface' },
    })

    await byTestId(page, 'yjs-peer-a-select').click()

    await expect(byTestId(page, 'yjs-peer-b-cursors')).toContainText(
      '101:0.0:0-0.0:5'
    )

    await byTestId(page, 'yjs-peer-a-disconnect').click()

    await expect(byTestId(page, 'yjs-peer-b-cursors')).toHaveText('remote:none')

    await byTestId(page, 'yjs-peer-a-connect').click()

    await expect(byTestId(page, 'yjs-peer-b-cursors')).toContainText(
      '101:0.0:0-0.0:5'
    )
  })

  test('keeps peers converged through append, undo, and redo', async ({
    page,
  }) => {
    await openExample(page, 'yjs-collaboration', {
      ready: { editor: 'visible' },
      surface: { scope: '#yjs-peer-a-editor-surface' },
    })

    await byTestId(page, 'yjs-peer-a-append').click()

    await expect(peerSurface(page, 'a')).toContainText('Ada')
    await expect(peerSurface(page, 'b')).toContainText('Ada')

    await byTestId(page, 'yjs-peer-a-undo').click()

    await expect(peerSurface(page, 'a')).not.toContainText('Ada')
    await expect(peerSurface(page, 'b')).not.toContainText('Ada')

    await byTestId(page, 'yjs-peer-a-redo').click()

    await expect(peerSurface(page, 'a')).toContainText('Ada')
    await expect(peerSurface(page, 'b')).toContainText('Ada')
  })

  test('shares user history between keyboard undo and redo', async ({
    page,
  }) => {
    await page.goto(
      `${process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3100'}/examples/yjs-collaboration`
    )
    await peerSurface(page, 'a').locator('[role="textbox"]').waitFor()
    const typedText = ' typed-history'

    await page.evaluate(() => {
      const root = document.querySelector('#yjs-peer-a-editor-surface')
      const textbox = root?.querySelector<HTMLElement>('[role="textbox"]')

      if (!textbox?.firstChild) {
        throw new Error('Peer A textbox text node not found')
      }

      const textNode = document
        .createTreeWalker(textbox, NodeFilter.SHOW_TEXT)
        .nextNode()

      if (!textNode) {
        throw new Error('Peer A textbox text node not found')
      }

      const range = document.createRange()
      range.setStart(textNode, textNode.textContent?.length ?? 0)
      range.setEnd(textNode, textNode.textContent?.length ?? 0)

      const selection = document.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      textbox.focus()
      document.dispatchEvent(new Event('selectionchange'))
    })
    await page.keyboard.type(typedText)

    await expect(peerSurface(page, 'a')).toContainText(typedText)
    await expect(peerSurface(page, 'b')).toContainText(typedText)

    await peerSurface(page, 'a').locator('[role="textbox"]').focus()
    const { redo, undo } = await getHistoryShortcuts(page)

    await page.keyboard.press(undo)

    await expect(peerSurface(page, 'a')).not.toContainText(typedText)
    await expect(peerSurface(page, 'b')).not.toContainText(typedText)

    await page.keyboard.press(redo)

    await expect(peerSurface(page, 'a')).toContainText(typedText)
    await expect(peerSurface(page, 'b')).toContainText(typedText)
  })

  test('clears stale local undo after a remote replace deletes that edit', async ({
    page,
  }) => {
    const pageErrors: string[] = []

    page.on('pageerror', (error) => {
      pageErrors.push(String(error.message || error))
    })

    await openExample(page, 'yjs-collaboration', {
      ready: { editor: 'visible' },
      surface: { scope: '#yjs-peer-a-editor-surface' },
    })

    await byTestId(page, 'yjs-peer-a-append').click()

    await expect(peerSurface(page, 'a')).toContainText('Ada')

    await byTestId(page, 'yjs-peer-b-replace').click()

    await expect(peerSurface(page, 'a')).toContainText(
      'Lin canonical snapshot.'
    )
    await expect(peerSurface(page, 'b')).toContainText(
      'Lin canonical snapshot.'
    )

    await peerSurface(page, 'a').locator('[role="textbox"]').focus()
    const { undo } = await getHistoryShortcuts(page)

    await page.keyboard.press(undo)

    await expect(peerSurface(page, 'a')).toContainText(
      'Lin canonical snapshot.'
    )
    await expect(peerSurface(page, 'b')).toContainText(
      'Lin canonical snapshot.'
    )
    expect(pageErrors).toEqual([])
  })

  test('exports replace snapshots to connected peers', async ({ page }) => {
    await openExample(page, 'yjs-collaboration', {
      ready: { editor: 'visible' },
      surface: { scope: '#yjs-peer-a-editor-surface' },
    })

    await byTestId(page, 'yjs-peer-b-replace').click()

    await expect(peerSurface(page, 'a')).toContainText(
      'Lin canonical snapshot.'
    )
    await expect(peerSurface(page, 'b')).toContainText(
      'Lin canonical snapshot.'
    )
    await expect(peerSurface(page, 'a')).not.toContainText('Hello world!')
  })

  test('disconnect and connect recover a stale peer', async ({ page }) => {
    await openExample(page, 'yjs-collaboration', {
      ready: { editor: 'visible' },
      surface: { scope: '#yjs-peer-a-editor-surface' },
    })

    await byTestId(page, 'yjs-peer-b-disconnect').click()

    await byTestId(page, 'yjs-peer-a-append').click()

    await expect(peerSurface(page, 'a')).toContainText('Ada')
    await expect(peerSurface(page, 'b')).not.toContainText('Ada')

    await byTestId(page, 'yjs-peer-b-reconcile').click()

    await expect(peerSurface(page, 'b')).not.toContainText('Ada')

    await byTestId(page, 'yjs-peer-b-connect').click()
    await expect(peerSurface(page, 'b')).toContainText('Ada')
  })

  test('merges local disconnected appends when the peer reconnects', async ({
    page,
  }) => {
    await openExample(page, 'yjs-collaboration', {
      ready: { editor: 'visible' },
      surface: { scope: '#yjs-peer-a-editor-surface' },
    })

    await byTestId(page, 'yjs-peer-b-disconnect').click()

    await byTestId(page, 'yjs-peer-b-append').click()

    await expect(peerSurface(page, 'b')).toContainText('Lin')
    await expect(peerSurface(page, 'a')).not.toContainText('Lin')

    await byTestId(page, 'yjs-peer-a-append').click()

    await expect(peerSurface(page, 'a')).toContainText('Ada')
    await expect(peerSurface(page, 'b')).not.toContainText('Ada')

    await byTestId(page, 'yjs-peer-b-connect').click()

    await expect(peerSurface(page, 'a')).toContainText('Ada')
    await expect(peerSurface(page, 'a')).toContainText('Lin')
    await expect(peerSurface(page, 'b')).toContainText('Ada')
    await expect(peerSurface(page, 'b')).toContainText('Lin')
  })

  test('keeps disconnected local edit undoable after reconnect', async ({
    page,
  }) => {
    await openExample(page, 'yjs-collaboration', {
      ready: { editor: 'visible' },
      surface: { scope: '#yjs-peer-a-editor-surface' },
    })

    await byTestId(page, 'yjs-peer-b-disconnect').click()
    await byTestId(page, 'yjs-peer-b-append').click()
    await byTestId(page, 'yjs-peer-a-append').click()
    await byTestId(page, 'yjs-peer-b-connect').click()

    await expect(peerSurface(page, 'a')).toContainText('Ada')
    await expect(peerSurface(page, 'a')).toContainText('Lin')
    await expect(peerSurface(page, 'b')).toContainText('Ada')
    await expect(peerSurface(page, 'b')).toContainText('Lin')

    await byTestId(page, 'yjs-peer-b-undo').click()

    await expect(peerSurface(page, 'a')).toContainText('Ada')
    await expect(peerSurface(page, 'a')).not.toContainText('Lin')
    await expect(peerSurface(page, 'b')).toContainText('Ada')
    await expect(peerSurface(page, 'b')).not.toContainText('Lin')
  })

  test('preserves remote appends when an offline replace is undone before reconnect', async ({
    page,
  }) => {
    await openExample(page, 'yjs-collaboration', {
      ready: { editor: 'visible' },
      surface: { scope: '#yjs-peer-a-editor-surface' },
    })

    await byTestId(page, 'yjs-peer-b-disconnect').click()
    await byTestId(page, 'yjs-peer-b-replace').click()

    await expect(peerSurface(page, 'b')).toContainText(
      'Lin canonical snapshot.'
    )

    await byTestId(page, 'yjs-peer-b-undo').click()

    await expect(peerSurface(page, 'b')).toContainText('Hello world!')

    await byTestId(page, 'yjs-peer-a-append').click()

    await expect(peerSurface(page, 'a')).toContainText('Ada')
    await expect(peerSurface(page, 'b')).not.toContainText('Ada')

    await byTestId(page, 'yjs-peer-b-connect').click()

    await expect(peerSurface(page, 'a')).toContainText('Ada')
    await expect(peerSurface(page, 'b')).toContainText('Ada')
  })

  test('preserves concurrent text when an offline Backspace merge reconnects', async ({
    page,
  }) => {
    const editor = await openExample(page, 'yjs-collaboration', {
      ready: { editor: 'visible' },
      surface: { scope: '#yjs-peer-a-editor-surface' },
    })

    await replacePeerText(page, 'a', ['alpha', 'beta'])
    await expect
      .poll(() => getPeerParagraphTexts(page, 'b'))
      .toEqual(['alpha', 'beta'])

    await byTestId(page, 'yjs-peer-b-disconnect').click()
    await placePeerCaret(page, 'b', 1, 0)
    await page.keyboard.press('Backspace')
    await expect
      .poll(() => getPeerParagraphTexts(page, 'b'))
      .toEqual(['alphabeta'])

    await editor.selection.selectDOM({
      anchor: { path: [0, 0], offset: 'alpha'.length },
      focus: { path: [0, 0], offset: 'alpha'.length },
    })
    await page.keyboard.type('!')
    await expect
      .poll(() => getPeerParagraphTexts(page, 'a'))
      .toEqual(['alpha!', 'beta'])

    await byTestId(page, 'yjs-peer-b-connect').click()

    for (const peer of ['a', 'b', 'c', 'd'] as const) {
      await expect
        .poll(() => getPeerParagraphTexts(page, peer))
        .toEqual(['alpha!beta'])
    }
  })

  test('preserves concurrent text when an offline block removal reconnects', async ({
    page,
  }) => {
    const editor = await openExample(page, 'yjs-collaboration', {
      ready: { editor: 'visible' },
      surface: { scope: '#yjs-peer-a-editor-surface' },
    })

    await replacePeerText(page, 'a', ['alpha', 'beta'])
    await expect
      .poll(() => getPeerParagraphTexts(page, 'b'))
      .toEqual(['alpha', 'beta'])

    await byTestId(page, 'yjs-peer-b-disconnect').click()
    await selectPeerParagraphNode(page, 'b', 1)
    await page.keyboard.press('Backspace')
    await expect.poll(() => getPeerParagraphTexts(page, 'b')).toEqual(['alpha'])

    await editor.selection.selectDOM({
      anchor: { path: [0, 0], offset: 'alpha'.length },
      focus: { path: [0, 0], offset: 'alpha'.length },
    })
    await page.keyboard.type('!')
    await expect
      .poll(() => getPeerParagraphTexts(page, 'a'))
      .toEqual(['alpha!', 'beta'])

    await byTestId(page, 'yjs-peer-b-connect').click()

    for (const peer of ['a', 'b', 'c', 'd'] as const) {
      await expect
        .poll(() => getPeerParagraphTexts(page, peer))
        .toEqual(['alpha!'])
    }
  })

  test('preserves concurrent sibling text when an offline move reconnects', async ({
    page,
  }) => {
    const editor = await openExample(page, 'yjs-collaboration', {
      ready: { editor: 'visible' },
      surface: { scope: '#yjs-peer-a-editor-surface' },
    })

    await replacePeerText(page, 'a', ['alpha', 'beta', 'gamma'])
    await expect
      .poll(() => getPeerParagraphTexts(page, 'b'))
      .toEqual(['alpha', 'beta', 'gamma'])

    await byTestId(page, 'yjs-peer-b-disconnect').click()
    await byTestId(page, 'yjs-peer-b-move').click()
    await expect
      .poll(() => getPeerParagraphTexts(page, 'b'))
      .toEqual(['beta', 'alpha', 'gamma'])

    await editor.selection.selectDOM({
      anchor: { path: [2, 0], offset: 'gamma'.length },
      focus: { path: [2, 0], offset: 'gamma'.length },
    })
    await page.keyboard.type('!')
    await expect
      .poll(() => getPeerParagraphTexts(page, 'a'))
      .toEqual(['alpha', 'beta', 'gamma!'])

    await byTestId(page, 'yjs-peer-b-connect').click()

    for (const peer of ['a', 'b', 'c', 'd'] as const) {
      await expect
        .poll(() => getPeerParagraphTexts(page, peer))
        .toEqual(['beta', 'alpha', 'gamma!'])
    }
  })

  test('merges offline mark, text replacement, and paragraph insertion edits', async ({
    page,
  }) => {
    await openExample(page, 'yjs-collaboration', {
      ready: { editor: 'visible' },
      surface: { scope: '#yjs-peer-a-editor-surface' },
    })

    for (const peer of ['b', 'c', 'd'] as const) {
      await byTestId(page, `yjs-peer-${peer}-disconnect`).click()
    }

    await selectFirstText(page, 'b', 'Hello'.length)
    await byTestId(page, 'yjs-peer-b-mark-bold').click()
    await expect(peerSurface(page, 'b').locator('strong')).toContainText(
      'Hello'
    )

    await selectFirstText(page, 'c', 'Hello'.length)
    await page.keyboard.type('Hi')

    await peerTextbox(page, 'd').click({ position: { x: 8, y: 28 } })
    await page.keyboard.press('Meta+ArrowRight')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Test')

    await expect(peerSurface(page, 'c')).toContainText('Hi world!')
    await expect(peerSurface(page, 'd')).toContainText('Test')

    for (const peer of ['b', 'c', 'd'] as const) {
      await byTestId(page, `yjs-peer-${peer}-connect`).click()
    }

    for (const peer of ['a', 'b', 'c', 'd'] as const) {
      await expect(peerSurface(page, peer)).toContainText('Hi world!')
      await expect(peerSurface(page, peer)).toContainText('Test')
      await expect
        .poll(() => getPeerParagraphTexts(page, peer))
        .toEqual(['Hi world!', 'Test'])
    }
  })

  test('keeps expanded browser selection deletion synchronized', async ({
    page,
  }) => {
    const editor = await openExample(page, 'yjs-collaboration', {
      ready: { editor: 'visible' },
      surface: { scope: '#yjs-peer-a-editor-surface' },
    })

    await editor.selection.selectDOM({
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 'Hello'.length },
    })
    await editor.assert.selection({
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 'Hello'.length },
    })

    await page.keyboard.press('Delete')

    await expect(peerSurface(page, 'a')).not.toContainText('Hello')
    await expect(peerSurface(page, 'b')).not.toContainText('Hello')
    await expect
      .poll(() => editor.selection.get())
      .toEqual({
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 0 },
      })
  })
})
