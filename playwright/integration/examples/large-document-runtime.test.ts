import { expect, type Locator, test } from '@playwright/test'

import {
  assertNoIllegalKernelTransitions,
  createSlateBrowserCompositionGauntlet,
  createSlateBrowserShellActivationGauntlet,
  openExample,
} from 'slate-browser/playwright'

const clickTextEnd = async (text: Locator) => {
  const box = await text.boundingBox()

  if (!box) {
    throw new Error('Cannot click the end of an unmounted text node')
  }

  await text.click({
    position: {
      x: Math.max(1, box.width - 1),
      y: Math.max(1, box.height / 2),
    },
  })
}

const collapseDOMSelectionToTextEnd = async (
  text: Locator,
  selection: {
    anchor: { path: number[]; offset: number }
    focus: { path: number[]; offset: number }
  }
) => {
  await text.evaluate((element: HTMLElement, nextSelection) => {
    const root = element.closest(
      '[data-slate-editor="true"]'
    ) as HTMLElement | null
    const walker = element.ownerDocument.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT
    )
    let lastText: Node | null = null
    let current = walker.nextNode()

    while (current) {
      lastText = current
      current = walker.nextNode()
    }

    if (!root || !lastText) {
      throw new Error('Cannot collapse selection to text end')
    }

    const handle = (root as Record<string, any>).__slateBrowserHandle

    handle?.selectRange?.(nextSelection)
    root.focus()

    const selection = element.ownerDocument.getSelection()

    if (!selection) {
      throw new Error('Cannot access document selection')
    }

    selection.removeAllRanges()
    selection.collapse(lastText, lastText.textContent?.length ?? 0)
    element.ownerDocument.dispatchEvent(
      new Event('selectionchange', { bubbles: true })
    )
  }, selection)
}

const dispatchPaste = async (
  root: Locator,
  {
    html,
    text,
  }: {
    html: string
    text: string
  }
) => {
  await root.evaluate(
    (element: HTMLElement, payload) => {
      const data = new DataTransfer()
      data.setData('text/html', payload.html)
      data.setData('text/plain', payload.text)

      const event = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      })

      element.dispatchEvent(event)

      const shouldForceHandleFallback = /Firefox/.test(navigator.userAgent)

      if (shouldForceHandleFallback || !event.defaultPrevented) {
        const handle = (element as Record<string, any>).__slateBrowserHandle

        if (!handle?.insertData) {
          throw new Error('Missing Slate browser insertData handle')
        }

        handle.insertData(payload)
      }
    },
    { html, text }
  )
}

const pasteSlateFragment = async (
  root: Locator,
  fragment: unknown,
  plainText: string
) => {
  const encoded = Buffer.from(
    encodeURIComponent(JSON.stringify(fragment))
  ).toString('base64')
  const html = `<span data-slate-fragment="${encoded}">${plainText}</span>`

  await dispatchPaste(root, { html, text: plainText })
}

test.describe('large document runtime example', () => {
  test('keeps DOM-owned text sync explicit and opt-out safe', async ({
    page,
  }, testInfo) => {
    const defaultEditor = await openExample(page, 'large-document-runtime', {
      ready: {
        editor: 'visible',
        text: /default block 1/,
      },
      surface: { scope: '[data-runtime-editor="default"]' },
    })

    await expect(defaultEditor.locator.text([0, 0])).toHaveAttribute(
      'data-slate-dom-sync',
      'true'
    )

    if (testInfo.project.name === 'mobile') {
      await defaultEditor.selection.select({
        anchor: { path: [0, 0], offset: 'default block 1'.length },
        focus: { path: [0, 0], offset: 'default block 1'.length },
      })
      await defaultEditor.insertText('!')
      await expect
        .poll(() => defaultEditor.get.modelText())
        .toContain('default block 1!')
      await defaultEditor.assert.text('default block 1!')
    } else {
      await clickTextEnd(defaultEditor.locator.text([0, 0]))
      await page.keyboard.type('!')
      await defaultEditor.assert.text('default block 1!')
    }

    const customEditor = await openExample(page, 'large-document-runtime', {
      ready: {
        editor: 'visible',
        text: /custom block 1/,
      },
      surface: { scope: '[data-runtime-editor="custom"]' },
    })

    await expect(customEditor.locator.text([0, 0])).not.toHaveAttribute(
      'data-slate-dom-sync',
      'true'
    )
    await expect(
      customEditor.root.locator('[data-runtime-custom-text="true"]').first()
    ).toBeVisible()

    if (testInfo.project.name === 'mobile') {
      await customEditor.selection.select({
        anchor: { path: [0, 0], offset: 'custom block 1'.length },
        focus: { path: [0, 0], offset: 'custom block 1'.length },
      })
      await customEditor.insertText('!')
      await expect
        .poll(() => customEditor.get.modelText())
        .toContain('custom block 1!')
      await customEditor.assert.text('custom block 1!')
    } else {
      await clickTextEnd(customEditor.locator.text([0, 0]))
      await page.keyboard.type('!')
      await customEditor.assert.text('custom block 1!')
    }

    const leafEditor = await openExample(page, 'large-document-runtime', {
      ready: {
        editor: 'visible',
        text: /leaf block 1/,
      },
      surface: { scope: '[data-runtime-editor="leaf"]' },
    })

    await expect(leafEditor.locator.text([0, 0])).not.toHaveAttribute(
      'data-slate-dom-sync',
      'true'
    )
    await expect(
      leafEditor.root.locator('[data-runtime-custom-leaf="true"]').first()
    ).toBeVisible()

    if (testInfo.project.name === 'mobile') {
      await leafEditor.selection.select({
        anchor: { path: [0, 0], offset: 'leaf block 1'.length },
        focus: { path: [0, 0], offset: 'leaf block 1'.length },
      })
      await leafEditor.insertText('!')
      await expect
        .poll(() => leafEditor.get.modelText())
        .toContain('leaf block 1!')
      await leafEditor.assert.text('leaf block 1!')
    } else {
      await clickTextEnd(leafEditor.locator.text([0, 0]))
      await page.keyboard.type('!')
      await leafEditor.assert.text('leaf block 1!')
    }

    const projectionEditor = await openExample(page, 'large-document-runtime', {
      ready: {
        editor: 'visible',
        text: /projection block 1/,
      },
      surface: { scope: '[data-runtime-editor="projection"]' },
    })

    await expect(projectionEditor.locator.text([0, 0])).not.toHaveAttribute(
      'data-slate-dom-sync',
      'true'
    )
    await expect(
      projectionEditor.root.locator('[data-runtime-projection="true"]').first()
    ).toBeVisible()

    if (testInfo.project.name === 'mobile') {
      await projectionEditor.selection.select({
        anchor: { path: [0, 0], offset: 'projection block 1'.length },
        focus: { path: [0, 0], offset: 'projection block 1'.length },
      })
      await projectionEditor.insertText('!')
      await expect
        .poll(() => projectionEditor.get.modelText())
        .toContain('projection block 1!')
      await projectionEditor.assert.text('projection block 1!')
    } else {
      await clickTextEnd(projectionEditor.locator.text([0, 0]))
      await page.keyboard.type('!')
      await projectionEditor.assert.text('projection block 1!')
    }
  })

  test('commits IME composition through the browser editing path', async ({
    page,
  }) => {
    const editor = await openExample(page, 'large-document-runtime', {
      ready: {
        editor: 'visible',
        text: /default block 1/,
      },
      surface: { scope: '[data-runtime-editor="default"]' },
    })

    await collapseDOMSelectionToTextEnd(editor.locator.text([0, 0]), {
      anchor: { path: [0, 0], offset: 'default block 1'.length },
      focus: { path: [0, 0], offset: 'default block 1'.length },
    })
    await expect
      .poll(() => editor.selection.get())
      .toEqual({
        anchor: { path: [0, 0], offset: 'default block 1'.length },
        focus: { path: [0, 0], offset: 'default block 1'.length },
      })
    await editor.ime.compose({
      committedText: 'すし',
      steps: ['す', 'すし'],
      text: 'すし',
    })

    await editor.assert.text('default block 1すし')
  })

  test('runs generated composition gauntlet without illegal kernel transitions', async ({
    page,
  }, testInfo) => {
    const editor = await openExample(page, 'large-document-runtime', {
      ready: {
        editor: 'visible',
        text: /default block 1/,
      },
      surface: { scope: '[data-runtime-editor="default"]' },
    })

    await collapseDOMSelectionToTextEnd(editor.locator.text([0, 0]), {
      anchor: { path: [0, 0], offset: 'default block 1'.length },
      focus: { path: [0, 0], offset: 'default block 1'.length },
    })
    await expect
      .poll(() => editor.selection.get())
      .toEqual({
        anchor: { path: [0, 0], offset: 'default block 1'.length },
        focus: { path: [0, 0], offset: 'default block 1'.length },
      })

    const result = await editor.scenario.run(
      'large-document-generated-composition-gauntlet',
      createSlateBrowserCompositionGauntlet({
        committedText: 'すし',
        steps: ['す', 'すし'],
        text: 'すし',
        textAfterComposition: 'default block 1すし',
      }),
      {
        metadata: {
          capabilities: ['composition', 'ime', 'kernel-trace'],
          platform: testInfo.project.name,
          transport:
            testInfo.project.name === 'chromium'
              ? 'native-composition'
              : 'synthetic-composition',
        },
        tracePath: testInfo.outputPath(
          'large-document-composition-gauntlet.json'
        ),
      }
    )

    assertNoIllegalKernelTransitions(result)
    expect(result.metadata.claim).toBe(
      testInfo.project.name === 'chromium'
        ? 'desktop-native-ime-composition'
        : testInfo.project.name === 'mobile'
          ? 'mobile-synthetic-composition'
          : 'synthetic-composition'
    )
  })

  test('undoes directly synced browser typing', async ({ page }) => {
    const editor = await openExample(page, 'large-document-runtime', {
      ready: {
        editor: 'visible',
        text: /default block 1/,
      },
      surface: { scope: '[data-runtime-editor="default"]' },
    })

    await expect(editor.locator.text([0, 0])).toHaveAttribute(
      'data-slate-dom-sync',
      'true'
    )

    await editor.selection.select({
      anchor: { path: [0, 0], offset: 'default block 1'.length },
      focus: { path: [0, 0], offset: 'default block 1'.length },
    })
    await editor.insertText('!')
    await expect
      .poll(() => editor.get.modelText())
      .toContain('default block 1!')
    await editor.assert.text('default block 1!')

    await editor.undo()

    await expect
      .poll(() => editor.get.modelText())
      .not.toContain('default block 1!')
    await editor.assert.text('default block 1')
    await expect(editor.root).not.toContainText('default block 1!')
  })

  test('redoes directly synced model typing', async ({ page }) => {
    const editor = await openExample(page, 'large-document-runtime', {
      ready: {
        editor: 'visible',
        text: /default block 1/,
      },
      surface: { scope: '[data-runtime-editor="default"]' },
    })

    await editor.selection.select({
      anchor: { path: [0, 0], offset: 'default block 1'.length },
      focus: { path: [0, 0], offset: 'default block 1'.length },
    })
    await editor.insertText('!')
    await editor.undo()
    await expect
      .poll(() => editor.get.modelText())
      .not.toContain('default block 1!')

    await editor.redo()

    await expect
      .poll(() => editor.get.modelText())
      .toContain('default block 1!')
    await editor.assert.text('default block 1!')
  })

  test('deletes backward after directly synced model typing', async ({
    page,
  }) => {
    const editor = await openExample(page, 'large-document-runtime', {
      ready: {
        editor: 'visible',
        text: /default block 1/,
      },
      surface: { scope: '[data-runtime-editor="default"]' },
    })

    await editor.selection.select({
      anchor: { path: [0, 0], offset: 'default block 1'.length },
      focus: { path: [0, 0], offset: 'default block 1'.length },
    })
    await editor.insertText('!')
    await expect
      .poll(() => editor.get.modelText())
      .toContain('default block 1!')

    await editor.deleteBackward()

    await expect
      .poll(() => editor.get.modelText())
      .not.toContain('default block 1!')
    await editor.assert.text('default block 1')
  })

  test('deletes forward after directly synced model typing', async ({
    page,
  }) => {
    const editor = await openExample(page, 'large-document-runtime', {
      ready: {
        editor: 'visible',
        text: /default block 1/,
      },
      surface: { scope: '[data-runtime-editor="default"]' },
    })

    await editor.selection.select({
      anchor: { path: [0, 0], offset: 'default block '.length },
      focus: { path: [0, 0], offset: 'default block '.length },
    })

    await editor.deleteForward()

    await expect
      .poll(() => editor.get.modelText())
      .not.toContain('default block 1')
    await editor.assert.text('default block')
  })

  test('activates shells by keyboard without focus mutation', async ({
    page,
  }) => {
    const editor = await openExample(page, 'large-document-runtime', {
      ready: {
        editor: 'visible',
        text: /default block 1/,
      },
      surface: { scope: '[data-runtime-editor="default"]' },
    })

    const shell = page.getByRole('button', {
      name: /Open document section 2: default block 3/,
    })

    await shell.focus()
    await expect(shell).toBeFocused()
    await expect.poll(() => editor.selection.get()).toBe(null)
    await expect(shell).toBeVisible()

    await shell.press('Enter')

    await expect(shell).toHaveCount(0)
    await expect
      .poll(() => editor.selection.get())
      .toEqual({
        anchor: { path: [2, 0], offset: 0 },
        focus: { path: [2, 0], offset: 0 },
      })
  })

  test('runs generated shell activation gauntlet without illegal kernel transitions', async ({
    page,
  }, testInfo) => {
    const editor = await openExample(page, 'large-document-runtime', {
      ready: {
        editor: 'visible',
        text: /default block 1/,
      },
      surface: { scope: '[data-runtime-editor="default"]' },
    })

    const result = await editor.scenario.run(
      'large-document-generated-shell-activation-gauntlet',
      createSlateBrowserShellActivationGauntlet({
        buttonName: /Open document section 2: default block 3/,
        expectedSelection: {
          anchor: { path: [2, 0], offset: 0 },
          focus: { path: [2, 0], offset: 0 },
        },
      }),
      {
        metadata: {
          capabilities: ['kernel-trace', 'semantic-shell', 'selection'],
          platform: testInfo.project.name,
          transport: 'keyboard',
        },
        tracePath: testInfo.outputPath(
          'large-document-shell-activation-gauntlet.json'
        ),
      }
    )

    assertNoIllegalKernelTransitions(result)
  })

  test('preserves Slate fragment paste over shell-backed selection', async ({
    page,
  }) => {
    const editor = await openExample(page, 'large-document-runtime', {
      ready: {
        editor: 'visible',
        text: /default block 1/,
      },
      surface: { scope: '[data-runtime-editor="default"]' },
    })

    await editor.root.evaluate((element: HTMLElement) => {
      element.focus()
    })
    await page.keyboard.press('ControlOrMeta+A')

    await expect(editor.root).toHaveAttribute(
      'data-slate-large-document-selection',
      'shell-backed'
    )
    await expect
      .poll(() => editor.selection.get())
      .toEqual({
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [5, 0], offset: 'default block 6'.length },
      })

    await pasteSlateFragment(
      editor.root,
      [
        {
          type: 'paragraph',
          children: [{ text: 'fragment marker' }],
        },
      ],
      'plain fallback'
    )

    await editor.assert.text('fragment marker')
  })

  test('preserves Slate fragment paste over partial shelled selection', async ({
    page,
  }) => {
    const editor = await openExample(page, 'large-document-runtime', {
      ready: {
        editor: 'visible',
        text: /default block 1/,
      },
      surface: { scope: '[data-runtime-editor="default"]' },
    })

    await editor.selection.select({
      anchor: { path: [2, 0], offset: 0 },
      focus: { path: [2, 0], offset: 'default block 3'.length },
    })

    await expect
      .poll(() => editor.selection.get())
      .toEqual({
        anchor: { path: [2, 0], offset: 0 },
        focus: { path: [2, 0], offset: 'default block 3'.length },
      })
    await expect(editor.root).toHaveAttribute(
      'data-slate-large-document-selection',
      'shell-backed'
    )

    await pasteSlateFragment(
      editor.root,
      [
        {
          type: 'paragraph',
          children: [{ text: 'partial fragment marker' }],
        },
      ],
      'plain fallback'
    )

    await expect(editor.root).toContainText('partial fragment marker')
    await expect(editor.root).not.toContainText('plain fallback')
  })

  test('preserves app-owned rich HTML paste over shell-backed selection', async ({
    page,
  }) => {
    const editor = await openExample(page, 'large-document-runtime', {
      ready: {
        editor: 'visible',
        text: /rich block 1/,
      },
      surface: { scope: '[data-runtime-editor="rich"]' },
    })

    await editor.root.evaluate((element: HTMLElement) => {
      element.focus()
    })
    await page.keyboard.press('ControlOrMeta+A')

    await expect(editor.root).toHaveAttribute(
      'data-slate-large-document-selection',
      'shell-backed'
    )

    await dispatchPaste(editor.root, {
      html: '<strong>rich marker</strong>',
      text: 'rich marker',
    })

    await editor.assert.text('rich marker')
    await expect(
      editor.root.locator('[data-runtime-bold="true"]').first()
    ).toBeVisible()
  })

  test('renders inline content inside large-document runtime', async ({
    page,
  }) => {
    const editor = await openExample(page, 'large-document-runtime', {
      ready: {
        editor: 'visible',
        text: /mixed inline link block 1/,
      },
      surface: { scope: '[data-runtime-editor="mixed"]' },
    })

    await expect(
      editor.root.locator('[data-runtime-inline="true"]').first()
    ).toBeVisible()
    await expect(editor.root.getByRole('button')).toHaveCount(2)
  })

  test('renders void content inside large-document runtime', async ({
    page,
  }) => {
    const editor = await openExample(page, 'large-document-runtime', {
      ready: {
        editor: 'visible',
        text: /void card/,
      },
      surface: { scope: '[data-runtime-editor="void"]' },
    })

    await expect(
      editor.root.locator('[data-runtime-void="true"]').first()
    ).toBeVisible()
    await expect(editor.root.locator('[data-slate-void="true"]')).toHaveCount(1)
  })

  test('selects void content by browser click without mutating content', async ({
    page,
  }) => {
    const editor = await openExample(page, 'large-document-runtime', {
      ready: {
        editor: 'visible',
        text: /void card/,
      },
      surface: { scope: '[data-runtime-editor="void"]' },
    })

    await editor.root.locator('[data-runtime-void="true"]').first().click()
    await editor.assert.kernelTrace({
      eventFamily: 'click',
      transition: { allowed: true },
    })

    await expect
      .poll(() => editor.selection.get())
      .toEqual({
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 0 },
      })
    await expect(
      editor.root.locator('[data-runtime-void="true"]')
    ).toContainText('void card')
    await expect.poll(() => editor.get.modelText()).toContain('void block 2')
  })

  test('renders table content inside large-document runtime', async ({
    page,
  }) => {
    const editor = await openExample(page, 'large-document-runtime', {
      ready: {
        editor: 'visible',
        text: /table cell 1/,
      },
      surface: { scope: '[data-runtime-editor="table"]' },
    })

    await expect(
      editor.root.locator('[data-runtime-table="true"]').first()
    ).toBeVisible()
    await expect(editor.root.getByText('table cell 2')).toBeVisible()
  })

  test('renders large-document runtime inside Shadow DOM', async ({ page }) => {
    const editor = await openExample(page, 'large-document-runtime', {
      ready: {
        editor: 'visible',
        text: /shadow block 1/,
      },
      surface: { scope: '[data-runtime-editor="shadow"]' },
    })

    await expect(editor.root).toContainText('shadow block 1')
    await expect(editor.root.getByRole('button')).toHaveCount(2)
  })
})
