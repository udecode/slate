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
  await selectPeerTextRange(page, peer, 0, 0, length)
}

const getPeerParagraphTexts = (page: Page, peer: PeerId) =>
  peerTextbox(page, peer).evaluate((textbox) =>
    [...textbox.querySelectorAll('p')].map((paragraph) => {
      const clone = paragraph.cloneNode(true) as HTMLElement

      clone
        .querySelectorAll('[data-slate-placeholder="true"]')
        .forEach((placeholder) => {
          placeholder.remove()
        })

      return (clone.textContent ?? '').replaceAll('\uFEFF', '')
    })
  )

const getPeerLayoutProof = (page: Page, peer: PeerId) =>
  peerTextbox(page, peer).evaluate((textbox) => {
    const editorRect = textbox.getBoundingClientRect()

    return {
      editorHeight: Math.round(editorRect.height),
      paragraphs: [...textbox.querySelectorAll('p')].map((paragraph) => {
        const rect = paragraph.getBoundingClientRect()

        return {
          height: Math.round(rect.height),
          text: paragraph.textContent ?? '',
        }
      }),
    }
  })

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
  await peerTextbox(page, peer).evaluate((textbox, nextParagraphs) => {
    const handle = (
      textbox as HTMLElement & {
        __slateBrowserHandle?: {
          applyOperations: (
            operations: readonly Record<string, unknown>[],
            options?: Record<string, unknown>
          ) => void
        }
      }
    ).__slateBrowserHandle

    if (!handle?.applyOperations) {
      throw new Error('Peer editor does not expose Slate browser handle setup')
    }

    const toParagraph = (text: string) => ({
      children: [{ text }],
      type: 'paragraph',
    })
    const currentParagraphs = [...textbox.querySelectorAll('p')].map(
      (paragraph) =>
        (paragraph.textContent ?? '')
          .replaceAll('\uFEFF', '')
          .replaceAll('\n', '')
    )
    const operations: Record<string, unknown>[] = []
    const [currentFirst = ''] = currentParagraphs
    const [nextFirst = ''] = nextParagraphs

    for (let index = currentParagraphs.length - 1; index > 0; index--) {
      operations.push({
        node: toParagraph(currentParagraphs[index] ?? ''),
        path: [index],
        root: 'main',
        type: 'remove_node',
      })
    }

    if (currentFirst.length > 0) {
      operations.push({
        offset: 0,
        path: [0, 0],
        root: 'main',
        text: currentFirst,
        type: 'remove_text',
      })
    }

    if (nextFirst.length > 0) {
      operations.push({
        offset: 0,
        path: [0, 0],
        root: 'main',
        text: nextFirst,
        type: 'insert_text',
      })
    }

    nextParagraphs.slice(1).forEach((paragraph, index) => {
      operations.push({
        node: toParagraph(paragraph),
        path: [index + 1],
        root: 'main',
        type: 'insert_node',
      })
    })

    handle.applyOperations(operations, { tag: 'yjs-example-test-setup' })
  }, paragraphs)
}

const placePeerCaret = async (
  page: Page,
  peer: PeerId,
  paragraphIndex: number,
  offset: number
) => {
  const position = await page.evaluate(
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

      const textboxRect = textbox.getBoundingClientRect()
      const paragraphRect = paragraph!.getBoundingClientRect()
      const toTextboxPoint = (x: number, y: number) => ({
        x: Math.max(1, Math.min(textboxRect.width - 1, x - textboxRect.left)),
        y: Math.max(1, Math.min(textboxRect.height - 1, y - textboxRect.top)),
      })

      if (offset <= 0) {
        return toTextboxPoint(
          paragraphRect.left + 2,
          paragraphRect.top + paragraphRect.height / 2
        )
      }

      const range = document.createRange()
      const boundedOffset = Math.min(offset, textNode.textContent?.length ?? 0)

      range.setStart(textNode, 0)
      range.setEnd(textNode, boundedOffset)

      const rect = range.getBoundingClientRect()

      return toTextboxPoint(
        Math.max(paragraphRect.left + 2, rect.right + 1),
        rect.top + rect.height / 2
      )
    },
    { offset, paragraphIndex, peer }
  )

  await peerTextbox(page, peer).click({ position })
}

const selectPeerTextRange = async (
  page: Page,
  peer: PeerId,
  paragraphIndex: number,
  anchorOffset: number,
  focusOffset: number
) => {
  if (anchorOffset === focusOffset) {
    await placePeerCaret(page, peer, paragraphIndex, anchorOffset)
    return
  }

  await peerTextbox(page, peer).click()
  await page.evaluate(
    ({ anchorOffset, focusOffset, paragraphIndex, peer }) => {
      const root = document.querySelector(`#yjs-peer-${peer}-editor-surface`)
      const textbox = root?.querySelector<HTMLElement>('[role="textbox"]')
      const paragraph = textbox?.querySelectorAll('p')[paragraphIndex]

      if (!textbox || !paragraph) {
        throw new Error(`Peer ${peer} paragraph ${paragraphIndex} not found`)
      }

      const findPoint = (offset: number) => {
        const walker = document.createTreeWalker(
          paragraph,
          NodeFilter.SHOW_TEXT
        )
        let seen = 0
        let textNode = walker.nextNode()

        while (textNode) {
          const text = textNode.textContent ?? ''
          const visibleText = text.replaceAll('\uFEFF', '')

          if (visibleText.length === 0) {
            textNode = walker.nextNode()
            continue
          }

          const nextSeen = seen + visibleText.length

          if (offset <= nextSeen) {
            return {
              node: textNode,
              offset: Math.max(0, offset - seen),
            }
          }

          seen = nextSeen
          textNode = walker.nextNode()
        }

        return {
          node: paragraph,
          offset: paragraph.childNodes.length,
        }
      }

      const anchor = findPoint(anchorOffset)
      const focus = findPoint(focusOffset)
      const range = document.createRange()

      range.setStart(anchor.node, anchor.offset)
      range.setEnd(focus.node, focus.offset)

      const selection = document.getSelection()

      selection?.removeAllRanges()
      selection?.addRange(range)
      textbox.focus()

      const handle = (
        textbox as HTMLElement & {
          __slateBrowserHandle?: {
            selectRange: (range: {
              anchor: { offset: number; path: number[] }
              focus: { offset: number; path: number[] }
            }) => void
          }
        }
      ).__slateBrowserHandle

      handle?.selectRange?.({
        anchor: { path: [paragraphIndex, 0], offset: anchorOffset },
        focus: { path: [paragraphIndex, 0], offset: focusOffset },
      })

      document.dispatchEvent(new Event('selectionchange'))
    },
    { anchorOffset, focusOffset, paragraphIndex, peer }
  )
}

const selectPeerSlateRange = async (
  page: Page,
  peer: PeerId,
  range: {
    anchor: { offset: number; path: number[] }
    focus: { offset: number; path: number[] }
  }
) => {
  await peerTextbox(page, peer).click()
  await page.evaluate(
    ({ peer, range }) => {
      const root = document.querySelector(`#yjs-peer-${peer}-editor-surface`)
      const textbox = root?.querySelector<HTMLElement>('[role="textbox"]')

      if (!textbox) {
        throw new Error(`Peer ${peer} textbox not found`)
      }

      const findPoint = (path: number[], offset: number) => {
        const [paragraphIndex] = path
        const paragraph = textbox.querySelectorAll('p')[paragraphIndex!]

        if (!paragraph) {
          throw new Error(`Peer ${peer} paragraph ${paragraphIndex} not found`)
        }

        const walker = document.createTreeWalker(
          paragraph,
          NodeFilter.SHOW_TEXT
        )
        let seen = 0
        let textNode = walker.nextNode()

        while (textNode) {
          const text = textNode.textContent ?? ''
          const visibleText = text.replaceAll('\uFEFF', '')

          if (visibleText.length === 0) {
            textNode = walker.nextNode()
            continue
          }

          const nextSeen = seen + visibleText.length

          if (offset <= nextSeen) {
            return {
              node: textNode,
              offset: Math.max(0, offset - seen),
            }
          }

          seen = nextSeen
          textNode = walker.nextNode()
        }

        return {
          node: paragraph,
          offset: paragraph.childNodes.length,
        }
      }

      const anchor = findPoint(range.anchor.path, range.anchor.offset)
      const focus = findPoint(range.focus.path, range.focus.offset)
      const domRange = document.createRange()

      domRange.setStart(anchor.node, anchor.offset)
      domRange.setEnd(focus.node, focus.offset)

      const selection = document.getSelection()

      selection?.removeAllRanges()
      selection?.addRange(domRange)
      textbox.focus()

      const handle = (
        textbox as HTMLElement & {
          __slateBrowserHandle?: {
            selectRange: (range: {
              anchor: { offset: number; path: number[] }
              focus: { offset: number; path: number[] }
            }) => void
          }
        }
      ).__slateBrowserHandle

      handle?.selectRange?.(range)
      document.dispatchEvent(new Event('selectionchange'))
    },
    { peer, range }
  )
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
      textbox.dataset.yjsSelectedParagraphNode = String(paragraphIndex)
      textbox.focus()
      document.dispatchEvent(new Event('selectionchange'))
    },
    { paragraphIndex, peer }
  )
}

test.describe('yjs collaboration example', () => {
  test('renders the full operation control matrix', async ({ page }) => {
    await openExample(page, 'yjs-collaboration', {
      ready: { editor: 'visible' },
      surface: { scope: '#yjs-peer-a-editor-surface' },
    })

    const controls = [
      'append',
      'replace',
      'remove-node',
      'split-node',
      'merge-node',
      'move-down',
      'set-node',
      'unset-node',
      'wrap-node',
      'unwrap',
      'lift',
      'insert-fragment',
      'delete-fragment',
      'delete-backward',
      'insert-text',
      'move',
    ]

    for (const control of controls) {
      await expect(byTestId(page, `yjs-peer-a-${control}`)).toBeVisible()
    }
  })

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

  test('keyboard undo matches one toolbar undo step and publishes the cursor', async ({
    page,
  }) => {
    const editor = await openExample(page, 'yjs-collaboration', {
      ready: { editor: 'visible' },
      surface: { scope: '#yjs-peer-a-editor-surface' },
    })
    const initialText = 'Hello world!'
    const appendedOnce = `${initialText} Ada`
    const appendedTwice = `${appendedOnce} Ada`
    const nextSelection = {
      anchor: { path: [0, 0], offset: appendedOnce.length },
      focus: { path: [0, 0], offset: appendedOnce.length },
    }

    await editor.selection.selectDOM({
      anchor: { path: [0, 0], offset: initialText.length },
      focus: { path: [0, 0], offset: initialText.length },
    })
    await byTestId(page, 'yjs-peer-a-append').click()
    await byTestId(page, 'yjs-peer-a-append').click()

    for (const peer of ['a', 'b', 'c', 'd'] as const) {
      await expect
        .poll(() => getPeerParagraphTexts(page, peer))
        .toEqual([appendedTwice])
    }

    await peerTextbox(page, 'a').focus()
    const { undo } = await getHistoryShortcuts(page)

    await page.keyboard.press(undo)

    for (const peer of ['a', 'b', 'c', 'd'] as const) {
      await expect
        .poll(() => getPeerParagraphTexts(page, peer))
        .toEqual([appendedOnce])
    }
    await expect.poll(() => editor.selection.get()).toEqual(nextSelection)
    await expect(byTestId(page, 'yjs-peer-b-cursors')).toContainText(
      `101:0.0:${appendedOnce.length}-0.0:${appendedOnce.length}`
    )
  })

  test('keeps peers usable after selecting all and deleting', async ({
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

    const editorA = peerTextbox(page, 'a')

    await editorA.click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.press('Backspace')

    await expect(editorA).toBeFocused()
    await expect(editorA.locator('p')).toHaveCount(1)
    await expect(peerTextbox(page, 'b').locator('p')).toHaveCount(1)
    await expect
      .poll(() =>
        editorA.evaluate((textbox) => {
          const paragraph = textbox.querySelector('p')
          const placeholder = textbox.querySelector(
            '[data-slate-placeholder="true"]'
          )

          if (!paragraph || !placeholder) {
            return null
          }

          const paragraphRect = paragraph.getBoundingClientRect()
          const placeholderRect = placeholder.getBoundingClientRect()

          return {
            leftDelta: Math.abs(placeholderRect.left - paragraphRect.left),
            topDelta: Math.abs(placeholderRect.top - paragraphRect.top),
            widthDelta: Math.abs(placeholderRect.width - paragraphRect.width),
          }
        })
      )
      .toEqual({ leftDelta: 0, topDelta: 0, widthDelta: 0 })

    const { undo } = await getHistoryShortcuts(page)

    await page.keyboard.press(undo)

    for (const peer of ['a', 'b', 'c', 'd'] as const) {
      await expect
        .poll(() => getPeerParagraphTexts(page, peer))
        .toEqual(['Hello world!'])
    }

    expect(pageErrors).toEqual([])
  })

  test('keeps single-line select-all deletion focused for continued typing', async ({
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

    const editorA = peerTextbox(page, 'a')

    await editorA.click()
    await expect
      .poll(() => getPeerParagraphTexts(page, 'a'))
      .toEqual(['Hello world!'])
    await expect
      .poll(() => getPeerParagraphTexts(page, 'b'))
      .toEqual(['Hello world!'])

    await page.keyboard.press('ControlOrMeta+A')
    await expect(editorA).toBeFocused()
    await expect
      .poll(() => page.evaluate(() => getSelection()?.toString()))
      .toBe('Hello world!')

    await page.keyboard.press('Backspace')

    await expect(editorA).toBeFocused()
    await page.keyboard.type('2')

    for (const peer of ['a', 'b', 'c', 'd'] as const) {
      await expect.poll(() => getPeerParagraphTexts(page, peer)).toEqual(['2'])
    }

    expect(pageErrors).toEqual([])
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

  test('clears stale local undo after a remote replace deletes an offline mark', async ({
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

    await byTestId(page, 'yjs-peer-b-disconnect').click()
    await selectFirstText(page, 'b', 'Hello'.length)
    await byTestId(page, 'yjs-peer-b-mark-bold').click()

    await expect(peerSurface(page, 'b').locator('strong')).toContainText(
      'Hello'
    )
    await expect(byTestId(page, 'yjs-peer-b-undo')).toBeEnabled()

    await byTestId(page, 'yjs-peer-a-replace').click()

    await expect(peerSurface(page, 'a')).toContainText(
      'Ada canonical snapshot.'
    )
    await expect(peerSurface(page, 'b')).toContainText('Hello world!')

    await byTestId(page, 'yjs-peer-b-connect').click()

    await expect(peerSurface(page, 'b')).toContainText(
      'Ada canonical snapshot.'
    )
    await expect(byTestId(page, 'yjs-peer-b-undo')).toBeDisabled()

    await peerSurface(page, 'b').locator('[role="textbox"]').focus()
    const { undo } = await getHistoryShortcuts(page)

    await page.keyboard.press(undo)

    await expect(peerSurface(page, 'b')).toContainText(
      'Ada canonical snapshot.'
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
    await openExample(page, 'yjs-collaboration', {
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

    await selectPeerTextRange(page, 'a', 0, 'alpha'.length, 'alpha'.length)
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

  test('undoes offline split paragraph insertion after reconnect', async ({
    page,
  }) => {
    await openExample(page, 'yjs-collaboration', {
      ready: { editor: 'visible' },
      surface: { scope: '#yjs-peer-a-editor-surface' },
    })

    await replacePeerText(page, 'a', ['alpha'])
    await expect.poll(() => getPeerParagraphTexts(page, 'b')).toEqual(['alpha'])

    await byTestId(page, 'yjs-peer-b-disconnect').click()
    await placePeerCaret(page, 'b', 0, 'alpha'.length)
    await page.keyboard.press('Enter')
    await page.keyboard.type('beta')
    await expect
      .poll(() => getPeerParagraphTexts(page, 'b'))
      .toEqual(['alpha', 'beta'])

    await selectPeerTextRange(page, 'a', 0, 'alpha'.length, 'alpha'.length)
    await page.keyboard.type('!')
    await expect
      .poll(() => getPeerParagraphTexts(page, 'a'))
      .toEqual(['alpha!'])

    await byTestId(page, 'yjs-peer-b-connect').click()

    for (const peer of ['a', 'b', 'c', 'd'] as const) {
      await expect
        .poll(() => getPeerParagraphTexts(page, peer))
        .toEqual(['alpha!', 'beta'])
    }

    await peerTextbox(page, 'b').focus()
    const { undo } = await getHistoryShortcuts(page)

    await page.keyboard.press(undo)

    for (const peer of ['a', 'b', 'c', 'd'] as const) {
      await expect
        .poll(() => getPeerParagraphTexts(page, peer))
        .toEqual(['alpha!'])
    }
  })

  test('keeps public split button undo converged after reconnect', async ({
    page,
  }) => {
    await openExample(page, 'yjs-collaboration', {
      ready: { editor: 'visible' },
      surface: { scope: '#yjs-peer-a-editor-surface' },
    })

    await replacePeerText(page, 'a', ['alphabeta'])
    await expect
      .poll(() => getPeerParagraphTexts(page, 'b'))
      .toEqual(['alphabeta'])

    await byTestId(page, 'yjs-peer-b-disconnect').click()
    await byTestId(page, 'yjs-peer-b-split-node').click()
    await expect
      .poll(() => getPeerParagraphTexts(page, 'b'))
      .toEqual(['alph', 'abeta'])

    await byTestId(page, 'yjs-peer-a-insert-text').click()
    await expect
      .poll(() => getPeerParagraphTexts(page, 'a'))
      .toEqual(['alphabeta!'])

    await byTestId(page, 'yjs-peer-b-connect').click()

    for (const peer of ['a', 'b', 'c', 'd'] as const) {
      await expect
        .poll(() => getPeerParagraphTexts(page, peer))
        .toEqual(['alph!', 'abeta'])
    }

    await byTestId(page, 'yjs-peer-b-undo').click()

    for (const peer of ['a', 'b', 'c', 'd'] as const) {
      await expect
        .poll(() => getPeerParagraphTexts(page, peer))
        .toEqual(['alph!abeta'])
    }
  })

  test('preserves concurrent text when an offline wrap button reconnects', async ({
    page,
  }) => {
    await openExample(page, 'yjs-collaboration', {
      ready: { editor: 'visible' },
      surface: { scope: '#yjs-peer-a-editor-surface' },
    })

    await replacePeerText(page, 'a', ['alpha', 'beta'])
    await expect
      .poll(() => getPeerParagraphTexts(page, 'b'))
      .toEqual(['alpha', 'beta'])

    await byTestId(page, 'yjs-peer-b-disconnect').click()
    await byTestId(page, 'yjs-peer-b-wrap-node').click()
    await expect
      .poll(() => getPeerParagraphTexts(page, 'b'))
      .toEqual(['alpha', 'beta'])

    await byTestId(page, 'yjs-peer-a-insert-text').click()
    await expect
      .poll(() => getPeerParagraphTexts(page, 'a'))
      .toEqual(['alpha!', 'beta'])

    await byTestId(page, 'yjs-peer-b-connect').click()

    for (const peer of ['a', 'b', 'c', 'd'] as const) {
      await expect
        .poll(() => getPeerParagraphTexts(page, peer))
        .toEqual(['alpha!', 'beta'])
    }
  })

  test('preserves concurrent text when an offline insert fragment reconnects', async ({
    page,
  }) => {
    await openExample(page, 'yjs-collaboration', {
      ready: { editor: 'visible' },
      surface: { scope: '#yjs-peer-a-editor-surface' },
    })

    await replacePeerText(page, 'a', ['alpha'])
    await expect.poll(() => getPeerParagraphTexts(page, 'b')).toEqual(['alpha'])

    await byTestId(page, 'yjs-peer-b-disconnect').click()
    await byTestId(page, 'yjs-peer-b-insert-fragment').click()
    await expect
      .poll(() => getPeerParagraphTexts(page, 'b'))
      .toEqual(['alphaLin fragment'])

    await byTestId(page, 'yjs-peer-a-append').click()
    await expect
      .poll(() => getPeerParagraphTexts(page, 'a'))
      .toEqual(['alpha Ada'])

    await byTestId(page, 'yjs-peer-b-connect').click()

    for (const peer of ['a', 'b', 'c', 'd'] as const) {
      await expect
        .poll(() => getPeerParagraphTexts(page, peer))
        .toEqual(['alpha AdaLin fragment'])
    }
  })

  test('undoes offline Backspace merge after a concurrent text edit reconnects', async ({
    page,
  }) => {
    await openExample(page, 'yjs-collaboration', {
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

    await selectPeerTextRange(page, 'a', 0, 'alpha'.length, 'alpha'.length)
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

    await peerTextbox(page, 'b').focus()
    const { undo } = await getHistoryShortcuts(page)

    await page.keyboard.press(undo)

    for (const peer of ['a', 'b', 'c', 'd'] as const) {
      await expect
        .poll(() => getPeerParagraphTexts(page, peer))
        .toEqual(['alpha!', 'beta'])
    }
  })

  test('preserves absorbed-block text when an offline expanded deletion reconnects', async ({
    page,
  }) => {
    await openExample(page, 'yjs-collaboration', {
      ready: { editor: 'visible' },
      surface: { scope: '#yjs-peer-a-editor-surface' },
    })

    await replacePeerText(page, 'a', ['alpha', 'beta', 'gamma'])
    await expect
      .poll(() => getPeerParagraphTexts(page, 'b'))
      .toEqual(['alpha', 'beta', 'gamma'])

    await byTestId(page, 'yjs-peer-b-disconnect').click()
    await selectPeerSlateRange(page, 'b', {
      anchor: { path: [0, 0], offset: 2 },
      focus: { path: [2, 0], offset: 2 },
    })
    await page.keyboard.press('Delete')
    await expect.poll(() => getPeerParagraphTexts(page, 'b')).toEqual(['almma'])

    await selectPeerTextRange(page, 'a', 2, 'gamma'.length, 'gamma'.length)
    await page.keyboard.type('!')
    await expect
      .poll(() => getPeerParagraphTexts(page, 'a'))
      .toEqual(['alpha', 'beta', 'gamma!'])

    await byTestId(page, 'yjs-peer-b-connect').click()

    for (const peer of ['a', 'b', 'c', 'd'] as const) {
      await expect
        .poll(() => getPeerParagraphTexts(page, peer))
        .toEqual(['almma!'])
    }

    await peerTextbox(page, 'b').focus()
    const { undo } = await getHistoryShortcuts(page)

    await page.keyboard.press(undo)

    for (const peer of ['a', 'b', 'c', 'd'] as const) {
      await expect
        .poll(() => getPeerParagraphTexts(page, peer))
        .toEqual(['alpha', 'beta', 'gamma!'])
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

  test('preserves concurrent text inside a block whose text is removed offline', async ({
    page,
  }) => {
    await openExample(page, 'yjs-collaboration', {
      ready: { editor: 'visible' },
      surface: { scope: '#yjs-peer-a-editor-surface' },
    })

    await replacePeerText(page, 'a', ['alpha', 'beta'])
    await expect
      .poll(() => getPeerParagraphTexts(page, 'b'))
      .toEqual(['alpha', 'beta'])

    await byTestId(page, 'yjs-peer-b-disconnect').click()
    await selectPeerTextRange(page, 'b', 1, 0, 'beta'.length)
    await page.keyboard.press('Backspace')
    await expect
      .poll(() => getPeerParagraphTexts(page, 'b'))
      .toEqual(['alpha', ''])

    await selectPeerTextRange(page, 'a', 1, 'beta'.length, 'beta'.length)
    await page.keyboard.type('!')
    await expect
      .poll(() => getPeerParagraphTexts(page, 'a'))
      .toEqual(['alpha', 'beta!'])

    await byTestId(page, 'yjs-peer-b-connect').click()

    for (const peer of ['a', 'b', 'c', 'd'] as const) {
      await expect
        .poll(() => getPeerParagraphTexts(page, peer))
        .toEqual(['alpha', '!'])
    }

    await peerTextbox(page, 'b').focus()
    const { undo } = await getHistoryShortcuts(page)

    await page.keyboard.press(undo)

    for (const peer of ['a', 'b', 'c', 'd'] as const) {
      await expect
        .poll(() => getPeerParagraphTexts(page, peer))
        .toEqual(['alpha', 'beta!'])
    }
  })

  test('undoes an offline selection replacement without dropping concurrent text', async ({
    page,
  }) => {
    await openExample(page, 'yjs-collaboration', {
      ready: { editor: 'visible' },
      surface: { scope: '#yjs-peer-a-editor-surface' },
    })

    await replacePeerText(page, 'a', ['alpha beta'])
    await expect
      .poll(() => getPeerParagraphTexts(page, 'b'))
      .toEqual(['alpha beta'])

    await byTestId(page, 'yjs-peer-b-disconnect').click()
    await selectPeerTextRange(page, 'b', 0, 0, 'alpha'.length)
    await page.keyboard.type('ALPHA')
    await expect
      .poll(() => getPeerParagraphTexts(page, 'b'))
      .toEqual(['ALPHA beta'])

    await selectPeerTextRange(
      page,
      'a',
      0,
      'alpha beta'.length,
      'alpha beta'.length
    )
    await page.keyboard.type('!')
    await expect
      .poll(() => getPeerParagraphTexts(page, 'a'))
      .toEqual(['alpha beta!'])

    await byTestId(page, 'yjs-peer-b-connect').click()

    for (const peer of ['a', 'b', 'c', 'd'] as const) {
      await expect
        .poll(() => getPeerParagraphTexts(page, peer))
        .toEqual(['ALPHA beta!'])
    }

    await peerTextbox(page, 'b').focus()
    const { undo } = await getHistoryShortcuts(page)

    await page.keyboard.press(undo)

    for (const peer of ['a', 'b', 'c', 'd'] as const) {
      await expect
        .poll(() => getPeerParagraphTexts(page, peer))
        .toEqual(['alpha beta!'])
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

  test('keeps offline move undo and redo converged after reconnect', async ({
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

    await peerTextbox(page, 'b').focus()
    const { redo, undo } = await getHistoryShortcuts(page)

    await page.keyboard.press(undo)

    for (const peer of ['a', 'b', 'c', 'd'] as const) {
      await expect
        .poll(() => getPeerParagraphTexts(page, peer))
        .toEqual(['alpha', 'beta', 'gamma!'])
    }

    await page.keyboard.press(redo)

    for (const peer of ['a', 'b', 'c', 'd'] as const) {
      await expect
        .poll(() => getPeerParagraphTexts(page, peer))
        .toEqual(['beta', 'alpha', 'gamma!'])
    }
  })

  test('keeps peer DOM layout synchronized after rapid history button replay', async ({
    page,
  }) => {
    await openExample(page, 'yjs-collaboration', {
      ready: { editor: 'visible' },
      surface: { scope: '#yjs-peer-a-editor-surface' },
    })

    await placePeerCaret(page, 'a', 0, 'Hello world!'.length)

    for (let index = 0; index < 3; index++) {
      await page.keyboard.press('Enter')
    }

    await expect
      .poll(() => getPeerParagraphTexts(page, 'b'))
      .toEqual(['Hello world!', '', '', ''])

    for (let index = 0; index < 3; index++) {
      await byTestId(page, 'yjs-peer-a-undo').click()
    }
    for (let index = 0; index < 3; index++) {
      await byTestId(page, 'yjs-peer-a-redo').click()
    }

    await expect
      .poll(async () => {
        const proofs = await Promise.all(
          (['a', 'b', 'c', 'd'] as const).map((peer) =>
            getPeerLayoutProof(page, peer)
          )
        )
        const heights = proofs.map((proof) => proof.editorHeight)
        const heightSpread = Math.max(...heights) - Math.min(...heights)
        const paragraphHeights = proofs.flatMap((proof) =>
          proof.paragraphs.map((paragraph) => paragraph.height)
        )
        const paragraphHeightSpread =
          Math.max(...paragraphHeights) - Math.min(...paragraphHeights)
        const paragraphTexts = proofs.map((proof) =>
          proof.paragraphs.map((paragraph) => paragraph.text)
        )

        return {
          heightSpread,
          paragraphHeightSpread,
          paragraphTexts,
        }
      })
      .toEqual({
        heightSpread: 0,
        paragraphHeightSpread: 0,
        paragraphTexts: [
          ['Hello world!', '', '', ''],
          ['Hello world!', '', '', ''],
          ['Hello world!', '', '', ''],
          ['Hello world!', '', '', ''],
        ],
      })
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

    await placePeerCaret(page, 'd', 0, 'Hello world!'.length)
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
