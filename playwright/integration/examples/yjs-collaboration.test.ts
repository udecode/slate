import { expect, type Page, test } from '@playwright/test'

import { openExample } from 'slate-browser/playwright'

const byTestId = (page: Page, id: string) =>
  page.locator(`[data-test-id="${id}"]`)

const peerSurface = (page: Page, peer: 'a' | 'b') =>
  page.locator(`#yjs-peer-${peer}-editor-surface`)

test.describe('yjs collaboration example', () => {
  test('projects awareness selection to the remote peer', async ({ page }) => {
    await openExample(page, 'yjs-collaboration', {
      ready: { editor: 'visible' },
      surface: { scope: '#yjs-peer-a-editor-surface' },
    })

    await byTestId(page, 'yjs-peer-a-select').click()

    await expect(byTestId(page, 'yjs-peer-b-cursors')).toContainText(
      '101:0.0:0-0.0:6'
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
      '101:0.0:0-0.0:6'
    )

    await byTestId(page, 'yjs-peer-a-disconnect').click()

    await expect(byTestId(page, 'yjs-peer-b-cursors')).toHaveText('remote:none')

    await byTestId(page, 'yjs-peer-a-connect').click()

    await expect(byTestId(page, 'yjs-peer-b-cursors')).toContainText(
      '101:0.0:0-0.0:6'
    )
  })

  test('keeps peers converged through append, undo, and redo buttons', async ({
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

  test('routes append button through native editor input', async ({ page }) => {
    await openExample(page, 'yjs-collaboration', {
      ready: { editor: 'visible' },
      surface: { scope: '#yjs-peer-a-editor-surface' },
    })

    await page.evaluate(() => {
      const root = document.querySelector('#yjs-peer-a-editor-surface')
      const editor = root?.querySelector('[role="textbox"]')

      if (!editor) {
        throw new Error('Editor textbox not found')
      }

      const events: string[] = []
      const record = (event: Event) => {
        events.push(
          `${event.type}:${(event as InputEvent).inputType ?? 'none'}:${(event as InputEvent).data ?? ''}`
        )
      }

      editor.addEventListener('beforeinput', record)
      editor.addEventListener('input', record)
      ;(
        window as typeof window & { __yjsInputEvents?: string[] }
      ).__yjsInputEvents = events
    })

    await byTestId(page, 'yjs-peer-a-append').click()

    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as typeof window & { __yjsInputEvents?: string[] })
              .__yjsInputEvents ?? []
        )
      )
      .toContain('input:insertText: Ada')
    await expect(peerSurface(page, 'b')).toContainText('Ada')
  })

  test('shares user history between keyboard undo and redo button', async ({
    page,
  }) => {
    const editor = await openExample(page, 'yjs-collaboration', {
      ready: { editor: 'visible' },
      surface: { scope: '#yjs-peer-a-editor-surface' },
    })
    const typedText = ' typed-history'

    await editor.selection.selectDOM({
      anchor: {
        path: [1, 0],
        offset: 'Use either editor; the other peer follows.'.length,
      },
      focus: {
        path: [1, 0],
        offset: 'Use either editor; the other peer follows.'.length,
      },
    })
    await page.keyboard.type(typedText)

    await expect(peerSurface(page, 'a')).toContainText(typedText)
    await expect(peerSurface(page, 'b')).toContainText(typedText)

    await page.keyboard.press('ControlOrMeta+Z')

    await expect(peerSurface(page, 'a')).not.toContainText(typedText)
    await expect(peerSurface(page, 'b')).not.toContainText(typedText)

    await byTestId(page, 'yjs-peer-a-redo').click()

    await expect(peerSurface(page, 'a')).toContainText(typedText)
    await expect(peerSurface(page, 'b')).toContainText(typedText)
  })

  test('replace button uses user history', async ({ page }) => {
    await openExample(page, 'yjs-collaboration', {
      ready: { editor: 'visible' },
      surface: { scope: '#yjs-peer-a-editor-surface' },
    })

    await byTestId(page, 'yjs-peer-b-replace').click()

    await expect(peerSurface(page, 'a')).toContainText(
      'Lin canonical snapshot.'
    )
    await expect(byTestId(page, 'yjs-peer-b-undo')).toBeEnabled()

    await byTestId(page, 'yjs-peer-b-undo').click()

    await expect(peerSurface(page, 'a')).toContainText(
      'Shared Slate Yjs document.'
    )
    await expect(peerSurface(page, 'a')).not.toContainText(
      'Lin canonical snapshot.'
    )
    await expect(byTestId(page, 'yjs-peer-b-redo')).toBeEnabled()

    await byTestId(page, 'yjs-peer-b-redo').click()

    await expect(peerSurface(page, 'a')).toContainText(
      'Lin canonical snapshot.'
    )
    await expect(peerSurface(page, 'b')).toContainText(
      'Lin canonical snapshot.'
    )
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
    await expect(byTestId(page, 'yjs-peer-a-undo')).toBeEnabled()

    await byTestId(page, 'yjs-peer-b-replace').click()

    await expect(peerSurface(page, 'a')).toContainText(
      'Lin canonical snapshot.'
    )
    const undoButton = byTestId(page, 'yjs-peer-a-undo')

    await expect(undoButton).toBeDisabled()
    await expect(undoButton).toHaveCSS('background-color', 'rgb(229, 231, 235)')
    await expect(undoButton).toHaveCSS('cursor', 'not-allowed')
    expect(pageErrors).toEqual([])
  })

  test('exports replace button snapshots to connected peers', async ({
    page,
  }) => {
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
    await expect(peerSurface(page, 'a')).not.toContainText(
      'Shared Slate Yjs document.'
    )
  })

  test('disconnect and connect buttons recover a stale peer', async ({
    page,
  }) => {
    await openExample(page, 'yjs-collaboration', {
      ready: { editor: 'visible' },
      surface: { scope: '#yjs-peer-a-editor-surface' },
    })

    await byTestId(page, 'yjs-peer-b-disconnect').click()
    await expect(byTestId(page, 'yjs-peer-b-connection')).toContainText(
      'disconnected'
    )

    await byTestId(page, 'yjs-peer-a-append').click()

    await expect(peerSurface(page, 'a')).toContainText('Ada')
    await expect(peerSurface(page, 'b')).not.toContainText('Ada')

    await byTestId(page, 'yjs-peer-b-reconcile').click()

    await expect(peerSurface(page, 'b')).not.toContainText('Ada')
    await expect(byTestId(page, 'yjs-peer-b-connection')).toContainText(
      'disconnected'
    )

    await byTestId(page, 'yjs-peer-b-connect').click()
    await expect(byTestId(page, 'yjs-peer-b-connection')).toContainText(
      'connected'
    )
  })

  test('merges local disconnected appends when the peer reconnects', async ({
    page,
  }) => {
    await openExample(page, 'yjs-collaboration', {
      ready: { editor: 'visible' },
      surface: { scope: '#yjs-peer-a-editor-surface' },
    })

    await byTestId(page, 'yjs-peer-b-disconnect').click()
    await expect(byTestId(page, 'yjs-peer-b-connection')).toContainText(
      'disconnected'
    )

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
    await expect(byTestId(page, 'yjs-peer-b-undo')).toBeEnabled()

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

    await expect(peerSurface(page, 'b')).toContainText(
      'Shared Slate Yjs document.'
    )

    await byTestId(page, 'yjs-peer-a-append').click()

    await expect(peerSurface(page, 'a')).toContainText('Ada')
    await expect(peerSurface(page, 'b')).not.toContainText('Ada')

    await byTestId(page, 'yjs-peer-b-connect').click()

    await expect(peerSurface(page, 'a')).toContainText('Ada')
    await expect(peerSurface(page, 'b')).toContainText('Ada')
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
      focus: { path: [0, 0], offset: 'Shared'.length },
    })
    await editor.assert.selection({
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 'Shared'.length },
    })

    await page.keyboard.press('Delete')

    await expect(peerSurface(page, 'a')).not.toContainText('Shared')
    await expect(peerSurface(page, 'b')).not.toContainText('Shared')
    await expect
      .poll(() => editor.selection.get())
      .toEqual({
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 0 },
      })
  })
})
