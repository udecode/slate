import { expect, type Locator, type Page, test } from '@playwright/test'

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

const selectDOMTextRange = async (
  editor: Awaited<ReturnType<typeof openExample>>,
  {
    anchorOffset,
    anchorPath,
    anchorText,
    focusOffset,
    focusPath,
    focusText,
  }: {
    anchorOffset: number
    anchorPath: number[]
    anchorText: string
    focusOffset: number
    focusPath: number[]
    focusText: string
  }
) =>
  editor.root.evaluate(
    (
      element: HTMLElement,
      {
        anchorOffset,
        anchorPath,
        anchorText,
        focusOffset,
        focusPath,
        focusText,
      }: {
        anchorOffset: number
        anchorPath: number[]
        anchorText: string
        focusOffset: number
        focusPath: number[]
        focusText: string
      }
    ) => {
      const handle = (element as Record<string, any>).__slateBrowserHandle

      if (!handle?.selectRange) {
        throw new Error('Missing Slate browser handle')
      }

      const findTextNode = (text: string) => {
        const walker = element.ownerDocument.createTreeWalker(
          element,
          NodeFilter.SHOW_TEXT
        )
        let current = walker.nextNode()

        while (current) {
          if (current.textContent === text) {
            return current
          }
          current = walker.nextNode()
        }

        throw new Error(`Cannot find DOM text node: ${text}`)
      }

      handle.selectRange({
        anchor: { path: anchorPath, offset: anchorOffset },
        focus: { path: focusPath, offset: focusOffset },
      })
      element.focus()

      const selection = element.ownerDocument.getSelection()

      if (!selection) {
        throw new Error('Cannot access document selection')
      }

      const range = element.ownerDocument.createRange()
      range.setStart(findTextNode(anchorText), anchorOffset)
      range.setEnd(findTextNode(focusText), focusOffset)
      selection.removeAllRanges()
      selection.addRange(range)
      element.ownerDocument.dispatchEvent(
        new Event('selectionchange', { bubbles: true })
      )
    },
    {
      anchorOffset,
      anchorPath,
      anchorText,
      focusOffset,
      focusPath,
      focusText,
    }
  )

const cancelNativeComposition = async (
  page: Page,
  steps: readonly string[]
) => {
  const client = await page.context().newCDPSession(page)

  for (const text of steps) {
    await client.send('Input.imeSetComposition', {
      selectionEnd: text.length,
      selectionStart: text.length,
      text,
    })
  }

  await client.send('Input.imeSetComposition', {
    selectionEnd: 0,
    selectionStart: 0,
    text: '',
  })
  await client.send('Input.insertText', {
    text: '',
  })
}

const dispatchCompositionEnd = async (root: Locator, data = 'あああ') => {
  await root.evaluate((element: HTMLElement, text) => {
    element.dispatchEvent(
      new CompositionEvent('compositionend', {
        bubbles: true,
        cancelable: false,
        data: text,
      })
    )
  }, data)
}

const replaceModelRangeDuringDOMComposition = async (
  editor: Awaited<ReturnType<typeof openExample>>,
  {
    composingText,
    overlapSelection,
    replacementText,
    steps,
  }: {
    composingText: string
    overlapSelection: {
      anchor: { path: number[]; offset: number }
      focus: { path: number[]; offset: number }
    }
    replacementText: string
    steps: string[]
  }
) =>
  editor.root.evaluate(
    (
      element: HTMLElement,
      {
        composingText,
        overlapSelection,
        replacementText,
        steps,
      }: {
        composingText: string
        overlapSelection: {
          anchor: { path: number[]; offset: number }
          focus: { path: number[]; offset: number }
        }
        replacementText: string
        steps: string[]
      }
    ) => {
      const selection = element.ownerDocument.getSelection()
      const handle = (element as Record<string, any>).__slateBrowserHandle

      if (!selection || selection.rangeCount === 0) {
        throw new Error('Cannot compose without a DOM selection')
      }
      if (!handle?.selectRange || !handle?.insertText) {
        throw new Error('Missing Slate browser handle')
      }

      const compositionRange = selection.getRangeAt(0).cloneRange()
      const dispatchCompositionEvent = (
        type: 'compositionstart' | 'compositionupdate' | 'compositionend',
        data: string
      ) => {
        element.dispatchEvent(
          new CompositionEvent(type, {
            bubbles: true,
            cancelable: true,
            data,
          })
        )
      }

      dispatchCompositionEvent('compositionstart', steps[0] ?? '')
      steps.forEach((text) => {
        dispatchCompositionEvent('compositionupdate', text)
      })

      compositionRange.deleteContents()
      const composedNode = element.ownerDocument.createTextNode(composingText)
      compositionRange.insertNode(composedNode)
      compositionRange.setStart(composedNode, composingText.length)
      compositionRange.setEnd(composedNode, composingText.length)
      selection.removeAllRanges()
      selection.addRange(compositionRange)
      element.ownerDocument.dispatchEvent(
        new Event('selectionchange', { bubbles: true })
      )

      handle.selectRange(overlapSelection)
      handle.insertText(replacementText)

      dispatchCompositionEvent('compositionend', composingText)
      element.ownerDocument.dispatchEvent(
        new Event('selectionchange', { bubbles: true })
      )
    },
    {
      composingText,
      overlapSelection,
      replacementText,
      steps,
    }
  )

const applyModelOperationsDuringDOMComposition = async (
  editor: Awaited<ReturnType<typeof openExample>>,
  {
    composingText,
    operations,
    steps,
  }: {
    composingText: string
    operations: unknown[]
    steps: string[]
  }
) =>
  editor.root.evaluate(
    (
      element: HTMLElement,
      {
        composingText,
        operations,
        steps,
      }: {
        composingText: string
        operations: unknown[]
        steps: string[]
      }
    ) => {
      const selection = element.ownerDocument.getSelection()
      const handle = (element as Record<string, any>).__slateBrowserHandle

      if (!selection || selection.rangeCount === 0) {
        throw new Error('Cannot compose without a DOM selection')
      }
      if (!handle?.applyOperations) {
        throw new Error('Missing Slate browser handle')
      }

      const compositionRange = selection.getRangeAt(0).cloneRange()
      const dispatchCompositionEvent = (
        type: 'compositionstart' | 'compositionupdate' | 'compositionend',
        data: string
      ) => {
        element.dispatchEvent(
          new CompositionEvent(type, {
            bubbles: true,
            cancelable: true,
            data,
          })
        )
      }

      dispatchCompositionEvent('compositionstart', steps[0] ?? '')
      steps.forEach((text) => {
        dispatchCompositionEvent('compositionupdate', text)
      })

      compositionRange.deleteContents()
      const composedNode = element.ownerDocument.createTextNode(composingText)
      compositionRange.insertNode(composedNode)
      compositionRange.setStart(composedNode, composingText.length)
      compositionRange.setEnd(composedNode, composingText.length)
      selection.removeAllRanges()
      selection.addRange(compositionRange)
      element.ownerDocument.dispatchEvent(
        new Event('selectionchange', { bubbles: true })
      )

      handle.applyOperations(operations)

      dispatchCompositionEvent('compositionend', composingText)
      element.ownerDocument.dispatchEvent(
        new Event('selectionchange', { bubbles: true })
      )
    },
    {
      composingText,
      operations,
      steps,
    }
  )

const commitDOMComposition = async (
  editor: Awaited<ReturnType<typeof openExample>>,
  {
    committedText,
    steps,
  }: {
    committedText: string
    steps: string[]
  }
) =>
  editor.root.evaluate(
    (
      element: HTMLElement,
      {
        committedText,
        steps,
      }: {
        committedText: string
        steps: string[]
      }
    ) => {
      const selection = element.ownerDocument.getSelection()

      if (!selection || selection.rangeCount === 0) {
        throw new Error('Cannot compose without a DOM selection')
      }

      const compositionRange = selection.getRangeAt(0).cloneRange()
      const dispatchCompositionEvent = (
        type: 'compositionstart' | 'compositionupdate' | 'compositionend',
        data: string
      ) => {
        element.dispatchEvent(
          new CompositionEvent(type, {
            bubbles: true,
            cancelable: true,
            data,
          })
        )
      }

      dispatchCompositionEvent('compositionstart', steps[0] ?? '')
      steps.forEach((text) => {
        dispatchCompositionEvent('compositionupdate', text)
      })

      compositionRange.deleteContents()
      const composedNode = element.ownerDocument.createTextNode(committedText)
      compositionRange.insertNode(composedNode)
      compositionRange.setStart(composedNode, committedText.length)
      compositionRange.setEnd(composedNode, committedText.length)
      selection.removeAllRanges()
      selection.addRange(compositionRange)
      element.ownerDocument.dispatchEvent(
        new Event('selectionchange', { bubbles: true })
      )

      dispatchCompositionEvent('compositionend', committedText)
      element.ownerDocument.dispatchEvent(
        new Event('selectionchange', { bubbles: true })
      )
    },
    {
      committedText,
      steps,
    }
  )

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
      const shouldUseHandleFallback = /Firefox/.test(navigator.userAgent)

      if (shouldUseHandleFallback) {
        const handle = (element as Record<string, any>).__slateBrowserHandle

        if (!handle?.insertData) {
          throw new Error('Missing Slate browser insertData handle')
        }

        handle.importDOMSelection?.()
        handle.insertData(payload)
        return
      }

      const event = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      })

      element.dispatchEvent(event)

      if (!event.defaultPrevented) {
        const handle = (element as Record<string, any>).__slateBrowserHandle

        if (!handle?.insertData) {
          throw new Error('Missing Slate browser insertData handle')
        }

        handle.importDOMSelection?.()
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

test.describe('rendering strategy runtime example', () => {
  test('keeps DOM-owned text sync explicit and opt-out safe', async ({
    page,
  }, testInfo) => {
    const defaultEditor = await openExample(
      page,
      'rendering-strategy-runtime',
      {
        ready: {
          editor: 'visible',
          text: /default block 1/,
        },
        surface: { scope: '[data-runtime-editor="default"]' },
      }
    )

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

    const customEditor = await openExample(page, 'rendering-strategy-runtime', {
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

    const leafEditor = await openExample(page, 'rendering-strategy-runtime', {
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

    const projectionEditor = await openExample(
      page,
      'rendering-strategy-runtime',
      {
        ready: {
          editor: 'visible',
          text: /projection block 1/,
        },
        surface: { scope: '[data-runtime-editor="projection"]' },
      }
    )

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

  test('proves DOM-present rendering-strategy input can use real browser-native typing', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === 'mobile',
      'real native keyboard insertion proof is owned by desktop browser projects'
    )

    const blockIndex = 0
    const blockText = `dom-native block ${blockIndex + 1}`
    const editor = await openExample(page, 'rendering-strategy-runtime', {
      query: {
        blocks: 1200,
        runtime_mode: 'staged-native-input',
      },
      ready: {
        editor: 'visible',
        text: /dom-native block 1/,
      },
      surface: { scope: '[data-runtime-editor="staged-native"]' },
    })

    const block = editor.root.getByText(blockText).first()

    await expect(block).toBeVisible()
    await clickTextEnd(block)
    await editor.assert.domCaret({
      offset: blockText.length,
      text: blockText,
    })

    await page.keyboard.type('a')

    await editor.assert.text(`${blockText}a`)
    await expect
      .poll(() => editor.get.selection())
      .toEqual({
        anchor: { path: [0, 0], offset: blockText.length + 1 },
        focus: { path: [0, 0], offset: blockText.length + 1 },
      })
    await editor.assert.domCaret({
      offset: blockText.length + 1,
      text: `${blockText}a`,
    })
    expect(await editor.get.kernelTrace()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventFamily: 'input',
          nativeAllowed: true,
          ownership: 'native-allowed',
        }),
      ])
    )
  })

  test('renders the full TanStack-backed experimental virtualized example with bounded DOM', async ({
    page,
  }) => {
    const editor = await openExample(page, 'rendering-strategy-runtime', {
      query: {
        blocks: 1000,
        runtime_mode: 'virtualized-full',
      },
      ready: {
        editor: 'visible',
        text: /virtualized block 1/,
      },
      surface: { scope: '[data-runtime-editor="virtualized-full"]' },
    })

    await expect(
      editor.root.locator('[data-slate-rendering-strategy-virtualizer="true"]')
    ).toBeVisible()
    await expect(
      editor.root.locator('[data-slate-rendering-strategy-shell="true"]')
    ).toHaveCount(0)
    await expect(
      page.locator('[data-runtime-virtualized-metrics="true"]')
    ).toContainText('"effectiveStrategy": "virtualized"')

    expect(
      await editor.root.locator('[data-slate-node="element"]').count()
    ).toBeLessThan(100)
    await expect(editor.root).not.toContainText('virtualized block 900')

    await editor.root.evaluate((element: HTMLElement) => {
      element.scrollTop = element.scrollHeight
      element.dispatchEvent(new Event('scroll', { bubbles: true }))
    })

    await expect(editor.root.getByText('virtualized block 1000')).toBeVisible()
  })

  test('exposes TanStack-backed experimental virtualized controls and warning', async ({
    page,
  }) => {
    const editor = await openExample(page, 'rendering-strategy-runtime', {
      query: {
        blocks: 1000,
        runtime_mode: 'virtualized-full',
      },
      ready: {
        editor: 'visible',
        text: /virtualized block 1/,
      },
      surface: { scope: '[data-runtime-editor="virtualized-full"]' },
    })

    await expect(
      page.locator('[data-runtime-virtualized-controls="true"]')
    ).toBeVisible()
    await expect(
      page.getByText('Experimental. Not production-ready.')
    ).toBeVisible()
    await expect(page.getByRole('spinbutton', { name: 'Blocks' })).toHaveValue(
      '1000'
    )
    await expect(
      editor.root.locator('[data-slate-rendering-strategy-virtualizer="true"]')
    ).toBeVisible()

    await page.getByRole('spinbutton', { name: 'Blocks' }).fill('1200')
    await page.getByRole('button', { name: 'Apply blocks' }).click()
    await expect(
      page.locator('[data-runtime-virtualized-metrics="true"]')
    ).toContainText('"documentSize": 1200')
  })

  test('commits IME composition through the browser editing path', async ({
    page,
  }) => {
    const editor = await openExample(page, 'rendering-strategy-runtime', {
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

  test('records runtime metadata for committed IME composition', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Chromium CDP IME proof')

    const editor = await openExample(page, 'rendering-strategy-runtime', {
      ready: {
        editor: 'visible',
        text: /default block 1/,
      },
      surface: { scope: '[data-runtime-editor="default"]' },
    })
    const initialText = 'default block 1'

    await collapseDOMSelectionToTextEnd(editor.locator.text([0, 0]), {
      anchor: { path: [0, 0], offset: initialText.length },
      focus: { path: [0, 0], offset: initialText.length },
    })

    await editor.ime.compose({
      committedText: 'すし',
      steps: ['す', 'すし'],
      text: 'すし',
      transport: 'native',
    })

    await editor.assert.text(`${initialText}すし`)

    const compositionTrace = (await editor.get.kernelTrace()).filter((entry) =>
      entry.eventFamily.startsWith('composition')
    )

    expect(compositionTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventFamily: 'compositionstart',
          frameId: expect.any(Number),
          intent: 'composition',
          nativeAllowed: true,
          ownership: 'native-allowed',
          targetOwner: 'editor',
          transition: expect.objectContaining({ allowed: true }),
        }),
        expect.objectContaining({
          eventFamily: 'compositionupdate',
          frameId: expect.any(Number),
          intent: 'composition',
          nativeAllowed: true,
          ownership: 'native-allowed',
          targetOwner: 'editor',
          transition: expect.objectContaining({ allowed: true }),
        }),
        expect.objectContaining({
          eventFamily: 'compositionend',
          frameId: expect.any(Number),
          intent: 'composition',
          nativeAllowed: true,
          ownership: 'native-allowed',
          targetOwner: 'editor',
          transition: expect.objectContaining({ allowed: true }),
        }),
      ])
    )
  })

  test('undoes committed IME composition as one history step', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Chromium CDP IME proof')

    const editor = await openExample(page, 'rendering-strategy-runtime', {
      ready: {
        editor: 'visible',
        text: /default block 1/,
      },
      surface: { scope: '[data-runtime-editor="default"]' },
    })
    const initialText = 'default block 1'

    await collapseDOMSelectionToTextEnd(editor.locator.text([0, 0]), {
      anchor: { path: [0, 0], offset: initialText.length },
      focus: { path: [0, 0], offset: initialText.length },
    })
    await expect
      .poll(() => editor.selection.get())
      .toEqual({
        anchor: { path: [0, 0], offset: initialText.length },
        focus: { path: [0, 0], offset: initialText.length },
      })

    await editor.ime.compose({
      committedText: 'すし',
      steps: ['ｓ', 'す', 'すｓ', 'すｓｈ', 'すし'],
      text: 'すし',
      transport: 'native',
    })
    await editor.assert.text(`${initialText}すし`)
    await editor.assert.kernelTrace({
      eventFamily: 'compositionend',
      transition: { allowed: true },
    })

    await editor.undo()

    await expect.poll(() => editor.get.modelText()).toContain(initialText)
    await expect.poll(() => editor.get.modelText()).not.toContain('すし')
    await editor.assert.text(initialText)
    await editor.assert.selection({
      anchor: { path: [0, 0], offset: initialText.length },
      focus: { path: [0, 0], offset: initialText.length },
    })
  })

  test('undoes native text and immediately following IME composition together', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Chromium CDP IME proof')

    const editor = await openExample(page, 'rendering-strategy-runtime', {
      ready: {
        editor: 'visible',
        text: /default block 1/,
      },
      surface: { scope: '[data-runtime-editor="default"]' },
    })
    const initialText = 'default block 1'

    await collapseDOMSelectionToTextEnd(editor.locator.text([0, 0]), {
      anchor: { path: [0, 0], offset: initialText.length },
      focus: { path: [0, 0], offset: initialText.length },
    })
    await editor.ime.enableKeyEvents()

    const client = await page.context().newCDPSession(page)

    await client.send('Input.insertText', { text: 'a' })
    await client.send('Input.imeSetComposition', {
      selectionEnd: 1,
      selectionStart: 1,
      text: 'ｓ',
    })
    await client.send('Input.imeSetComposition', {
      selectionEnd: 1,
      selectionStart: 1,
      text: 'す',
    })
    await client.send('Input.insertText', { text: 'す' })

    await editor.assert.text(`${initialText}aす`)

    await editor.undo()

    await editor.assert.text(initialText)
    await editor.assert.selection({
      anchor: { path: [0, 0], offset: initialText.length },
      focus: { path: [0, 0], offset: initialText.length },
    })
  })

  test('undoes delayed Hiragana IME compositions as separate history steps', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Chromium CDP IME proof')

    const editor = await openExample(page, 'rendering-strategy-runtime', {
      ready: {
        editor: 'visible',
        text: /default block 1/,
      },
      surface: { scope: '[data-runtime-editor="default"]' },
    })
    const initialText = 'default block 1'

    await collapseDOMSelectionToTextEnd(editor.locator.text([0, 0]), {
      anchor: { path: [0, 0], offset: initialText.length },
      focus: { path: [0, 0], offset: initialText.length },
    })
    await editor.ime.compose({
      committedText: 'すし',
      steps: ['ｓ', 'す', 'すｓ', 'すｓｈ', 'すし'],
      text: 'すし',
      transport: 'native',
    })

    await page.waitForTimeout(1050)

    await editor.ime.enableKeyEvents()
    const client = await page.context().newCDPSession(page)
    await client.send('Input.insertText', { text: ' ' })

    await page.waitForTimeout(1050)

    await editor.ime.compose({
      committedText: 'もじあ',
      steps: ['m', 'も', 'もj', 'もじ', 'もじあ'],
      text: 'もじあ',
      transport: 'native',
    })

    await editor.assert.text(`${initialText}すし もじあ`)
    await editor.assert.selection({
      anchor: {
        path: [0, 0],
        offset: initialText.length + 'すし もじあ'.length,
      },
      focus: {
        path: [0, 0],
        offset: initialText.length + 'すし もじあ'.length,
      },
    })

    await editor.undo()

    await editor.assert.text(`${initialText}すし `)
    await expect.poll(() => editor.get.modelText()).not.toContain('もじあ')
    await editor.assert.selection({
      anchor: { path: [0, 0], offset: initialText.length + 'すし '.length },
      focus: { path: [0, 0], offset: initialText.length + 'すし '.length },
    })

    await editor.undo()

    await editor.assert.text(`${initialText}すし`)
    await expect.poll(() => editor.get.modelText()).not.toContain('すし ')
    await editor.assert.selection({
      anchor: { path: [0, 0], offset: initialText.length + 'すし'.length },
      focus: { path: [0, 0], offset: initialText.length + 'すし'.length },
    })

    await editor.undo()

    await editor.assert.text(initialText)
    await expect.poll(() => editor.get.modelText()).not.toContain('すし')
    await editor.assert.selection({
      anchor: { path: [0, 0], offset: initialText.length },
      focus: { path: [0, 0], offset: initialText.length },
    })
  })

  test('restores expanded selection after undoing IME replacement', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Chromium CDP IME proof')

    const editor = await openExample(page, 'rendering-strategy-runtime', {
      ready: {
        editor: 'visible',
        text: /default block 1/,
      },
      surface: { scope: '[data-runtime-editor="default"]' },
    })
    const initialText = 'ab'

    await editor.selection.select({
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 'default block 1'.length },
    })
    await editor.insertText(initialText)
    await page.waitForTimeout(1050)
    await editor.selection.selectDOM({
      anchor: { path: [0, 0], offset: initialText.length },
      focus: { path: [0, 0], offset: 1 },
    })
    await editor.assert.selection({
      anchor: { path: [0, 0], offset: initialText.length },
      focus: { path: [0, 0], offset: 1 },
    })

    await editor.ime.enableKeyEvents()
    const client = await page.context().newCDPSession(page)
    await client.send('Input.imeSetComposition', {
      selectionEnd: 1,
      selectionStart: 1,
      text: 'ｓ',
    })
    await client.send('Input.imeSetComposition', {
      selectionEnd: 1,
      selectionStart: 1,
      text: 'す',
    })
    await client.send('Input.insertText', { text: 'す' })

    await editor.assert.text('aす')
    await editor.assert.kernelTrace({
      eventFamily: 'compositionend',
      transition: { allowed: true },
    })

    await editor.undo()

    await editor.assert.text(initialText)
    await editor.assert.selection({
      anchor: { path: [0, 0], offset: initialText.length },
      focus: { path: [0, 0], offset: 1 },
    })
  })

  test('replaces an existing word with IME composition', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Chromium CDP IME proof')

    const editor = await openExample(page, 'rendering-strategy-runtime', {
      ready: {
        editor: 'visible',
        text: /default block 1/,
      },
      surface: { scope: '[data-runtime-editor="default"]' },
    })
    const initialText = 'default block 1'
    const text = 'one two three'

    await editor.selection.select({
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: initialText.length },
    })
    await editor.insertText(text)
    await editor.selection.selectDOM({
      anchor: { path: [0, 0], offset: 'one '.length },
      focus: { path: [0, 0], offset: 'one two'.length },
    })

    await editor.ime.compose({
      committedText: 'zero',
      steps: ['seven', 'zero'],
      text: 'zero',
      transport: 'native',
    })

    await editor.assert.text('one zero three')
    await editor.assert.selection({
      anchor: { path: [0, 0], offset: 'one zero'.length },
      focus: { path: [0, 0], offset: 'one zero'.length },
    })
    await editor.assert.kernelTrace({
      eventFamily: 'compositionend',
      transition: { allowed: true },
    })
  })

  test('commits IME composition at the start of a text block', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Chromium DOM-change proof')

    const editor = await openExample(page, 'rendering-strategy-runtime', {
      ready: {
        editor: 'visible',
        text: /default block 1/,
      },
      surface: { scope: '[data-runtime-editor="default"]' },
    })
    const initialText = 'default block 1'
    const text = 'foo'
    const committedText = '!?'

    await editor.selection.select({
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: initialText.length },
    })
    await editor.insertText(text)
    await editor.selection.selectDOM({
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    })

    await commitDOMComposition(editor, {
      committedText,
      steps: ['!', committedText],
    })

    await editor.assert.text(`${committedText}${text}`)
    await editor.assert.selection({
      anchor: { path: [0, 0], offset: committedText.length },
      focus: { path: [0, 0], offset: committedText.length },
    })
    await editor.assert.domCaret({
      offset: committedText.length,
      text: `${committedText}${text}`,
    })
    await editor.assert.kernelTrace({
      eventFamily: 'compositionend',
      transition: { allowed: true },
    })
  })

  test('commits IME composition inside existing text', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Chromium DOM-change proof')

    const editor = await openExample(page, 'rendering-strategy-runtime', {
      ready: {
        editor: 'visible',
        text: /default block 1/,
      },
      surface: { scope: '[data-runtime-editor="default"]' },
    })
    const initialText = 'default block 1'
    const text = 'foo'
    const committedText = 'xyz'

    await editor.selection.select({
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: initialText.length },
    })
    await editor.insertText(text)
    await editor.selection.selectDOM({
      anchor: { path: [0, 0], offset: 1 },
      focus: { path: [0, 0], offset: 1 },
    })

    await commitDOMComposition(editor, {
      committedText,
      steps: ['x', 'xy', committedText],
    })

    await editor.assert.text('fxyzoo')
    await editor.assert.selection({
      anchor: { path: [0, 0], offset: 'fxyz'.length },
      focus: { path: [0, 0], offset: 'fxyz'.length },
    })
    await editor.assert.domCaret({
      offset: 'fxyz'.length,
      text: 'fxyzoo',
    })
    await editor.assert.kernelTrace({
      eventFamily: 'compositionend',
      transition: { allowed: true },
    })
  })

  test('commits IME composition at the end of a text block', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Chromium DOM-change proof')

    const editor = await openExample(page, 'rendering-strategy-runtime', {
      ready: {
        editor: 'visible',
        text: /default block 1/,
      },
      surface: { scope: '[data-runtime-editor="default"]' },
    })
    const initialText = 'default block 1'
    const text = 'foo'
    const committedText = '!?'

    await editor.selection.select({
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: initialText.length },
    })
    await editor.insertText(text)
    await editor.selection.selectDOM({
      anchor: { path: [0, 0], offset: text.length },
      focus: { path: [0, 0], offset: text.length },
    })

    await commitDOMComposition(editor, {
      committedText,
      steps: ['!', committedText],
    })

    await editor.assert.text(`${text}${committedText}`)
    await editor.assert.selection({
      anchor: { path: [0, 0], offset: `${text}${committedText}`.length },
      focus: { path: [0, 0], offset: `${text}${committedText}`.length },
    })
    await editor.assert.domCaret({
      offset: `${text}${committedText}`.length,
      text: `${text}${committedText}`,
    })
    await editor.assert.kernelTrace({
      eventFamily: 'compositionend',
      transition: { allowed: true },
    })
  })

  test('commits IME composition between emoji text', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Chromium DOM-change proof')

    const editor = await openExample(page, 'rendering-strategy-runtime', {
      ready: {
        editor: 'visible',
        text: /default block 1/,
      },
      surface: { scope: '[data-runtime-editor="default"]' },
    })
    const initialText = 'default block 1'
    const text = '🙂🙂'
    const firstEmojiOffset = '🙂'.length
    const committedText = 'すし'

    await editor.selection.select({
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: initialText.length },
    })
    await editor.insertText(text)
    await editor.selection.selectDOM({
      anchor: { path: [0, 0], offset: firstEmojiOffset },
      focus: { path: [0, 0], offset: firstEmojiOffset },
    })

    await commitDOMComposition(editor, {
      committedText,
      steps: ['す', committedText],
    })

    await editor.assert.text('🙂すし🙂')
    await editor.assert.selection({
      anchor: {
        path: [0, 0],
        offset: firstEmojiOffset + committedText.length,
      },
      focus: {
        path: [0, 0],
        offset: firstEmojiOffset + committedText.length,
      },
    })
    await editor.assert.kernelTrace({
      eventFamily: 'compositionend',
      transition: { allowed: true },
    })
  })

  test('does not push canceled IME composition onto history', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Chromium CDP IME proof')

    const editor = await openExample(page, 'rendering-strategy-runtime', {
      ready: {
        editor: 'visible',
        text: /default block 1/,
      },
      surface: { scope: '[data-runtime-editor="default"]' },
    })
    const initialText = 'default block 1'
    const typedText = '!'

    await collapseDOMSelectionToTextEnd(editor.locator.text([0, 0]), {
      anchor: { path: [0, 0], offset: initialText.length },
      focus: { path: [0, 0], offset: initialText.length },
    })
    await editor.insertText(typedText)
    await editor.assert.text(`${initialText}${typedText}`)

    await cancelNativeComposition(page, ['ｓ'])

    await editor.assert.text(`${initialText}${typedText}`)

    await editor.undo()

    await expect.poll(() => editor.get.modelText()).toContain(initialText)
    await expect.poll(() => editor.get.modelText()).not.toContain(typedText)
    await editor.assert.text(initialText)
  })

  test('keeps text stable after type-delete-cancel IME composition', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Chromium CDP IME proof')

    const editor = await openExample(page, 'rendering-strategy-runtime', {
      ready: {
        editor: 'visible',
        text: /default block 1/,
      },
      surface: { scope: '[data-runtime-editor="default"]' },
    })
    const initialText = 'default block 1'
    const canceledSteps = ['ｓ', 'す', 'すｓ', 'すｓｈ', 'すし', 'す']

    await collapseDOMSelectionToTextEnd(editor.locator.text([0, 0]), {
      anchor: { path: [0, 0], offset: initialText.length },
      focus: { path: [0, 0], offset: initialText.length },
    })
    await editor.ime.enableKeyEvents()

    await cancelNativeComposition(page, canceledSteps)

    await editor.assert.text(initialText)
    await editor.assert.selection({
      anchor: { path: [0, 0], offset: initialText.length },
      focus: { path: [0, 0], offset: initialText.length },
    })

    await page.keyboard.type(' ')
    await page.keyboard.press('ArrowLeft')
    await editor.assert.selection({
      anchor: { path: [0, 0], offset: initialText.length },
      focus: { path: [0, 0], offset: initialText.length },
    })

    await cancelNativeComposition(page, canceledSteps)

    await editor.assert.text(`${initialText} `)
    await editor.assert.selection({
      anchor: { path: [0, 0], offset: initialText.length },
      focus: { path: [0, 0], offset: initialText.length },
    })
  })

  test('keeps canceled IME caret anchored for the next typed character', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Chromium CDP IME proof')

    const editor = await openExample(page, 'rendering-strategy-runtime', {
      ready: {
        editor: 'visible',
        text: /default block 1/,
      },
      surface: { scope: '[data-runtime-editor="default"]' },
    })
    const initialText = 'default block 1'
    const anchorOffset = 'default '.length
    const canceledSteps = ['ｓ', 'す', 'すｓ', 'すし']

    await editor.selection.selectDOM({
      anchor: { path: [0, 0], offset: anchorOffset },
      focus: { path: [0, 0], offset: anchorOffset },
    })
    await editor.ime.enableKeyEvents()

    await cancelNativeComposition(page, canceledSteps)

    await editor.assert.text(initialText)
    await editor.assert.selection({
      anchor: { path: [0, 0], offset: anchorOffset },
      focus: { path: [0, 0], offset: anchorOffset },
    })

    await page.keyboard.type('x')

    await editor.assert.text('default xblock 1')
    await editor.assert.selection({
      anchor: { path: [0, 0], offset: anchorOffset + 1 },
      focus: { path: [0, 0], offset: anchorOffset + 1 },
    })
  })

  test('drops active IME composition when a model change overlaps it', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Chromium IME proof')

    const editor = await openExample(page, 'rendering-strategy-runtime', {
      ready: {
        editor: 'visible',
        text: /default block 1/,
      },
      surface: { scope: '[data-runtime-editor="default"]' },
    })
    const initialText = 'default block 1'
    const compositionPoint = { path: [0, 0], offset: 'default '.length }

    await editor.selection.selectDOM({
      anchor: compositionPoint,
      focus: compositionPoint,
    })
    await editor.assert.domSelection({
      anchorNodeText: initialText,
      anchorOffset: compositionPoint.offset,
      focusNodeText: initialText,
      focusOffset: compositionPoint.offset,
    })

    await replaceModelRangeDuringDOMComposition(editor, {
      composingText: 'すし',
      overlapSelection: {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: initialText.length },
      },
      replacementText: '---',
      steps: ['す', 'すし'],
    })

    await editor.assert.blockTexts(['---', 'default block 2'])
    await expect.poll(() => editor.get.modelText()).toContain('default block 6')
    await expect.poll(() => editor.get.modelText()).not.toContain('すし')
    await editor.assert.selection({
      anchor: { path: [0, 0], offset: 3 },
      focus: { path: [0, 0], offset: 3 },
    })
    await editor.assert.domCaret({
      offset: 3,
      text: '---',
    })
    await editor.assert.kernelTrace({
      eventFamily: 'compositionend',
      transition: { allowed: true },
    })
  })

  test('drops active IME composition when a model change partially overlaps it', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Chromium IME proof')

    const editor = await openExample(page, 'rendering-strategy-runtime', {
      ready: {
        editor: 'visible',
        text: /default block 1/,
      },
      surface: { scope: '[data-runtime-editor="default"]' },
    })
    const initialText = 'default block 1'
    const compositionPoint = { path: [0, 0], offset: 'default '.length }

    await editor.selection.selectDOM({
      anchor: compositionPoint,
      focus: compositionPoint,
    })
    await editor.assert.domSelection({
      anchorNodeText: initialText,
      anchorOffset: compositionPoint.offset,
      focusNodeText: initialText,
      focusOffset: compositionPoint.offset,
    })

    await replaceModelRangeDuringDOMComposition(editor, {
      composingText: 'すし',
      overlapSelection: {
        anchor: { path: [0, 0], offset: 10 },
        focus: { path: [0, 0], offset: initialText.length },
      },
      replacementText: '---',
      steps: ['す', 'すし'],
    })

    await editor.assert.blockTexts(['default bl---', 'default block 2'])
    await expect.poll(() => editor.get.modelText()).toContain('default block 6')
    await expect.poll(() => editor.get.modelText()).not.toContain('すし')
    await editor.assert.selection({
      anchor: { path: [0, 0], offset: 'default bl---'.length },
      focus: { path: [0, 0], offset: 'default bl---'.length },
    })
    await editor.assert.domCaret({
      offset: 'default bl---'.length,
      text: 'default bl---',
    })
    await editor.assert.kernelTrace({
      eventFamily: 'compositionend',
      transition: { allowed: true },
    })
  })

  test('drops active IME composition when a model change happens at its insertion point', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Chromium IME proof')

    const editor = await openExample(page, 'rendering-strategy-runtime', {
      ready: {
        editor: 'visible',
        text: /default block 1/,
      },
      surface: { scope: '[data-runtime-editor="default"]' },
    })
    const initialText = 'default block 1'
    const compositionPoint = { path: [0, 0], offset: 'default '.length }

    await editor.selection.selectDOM({
      anchor: compositionPoint,
      focus: compositionPoint,
    })
    await editor.assert.domSelection({
      anchorNodeText: initialText,
      anchorOffset: compositionPoint.offset,
      focusNodeText: initialText,
      focusOffset: compositionPoint.offset,
    })

    await replaceModelRangeDuringDOMComposition(editor, {
      composingText: 'すし',
      overlapSelection: {
        anchor: compositionPoint,
        focus: compositionPoint,
      },
      replacementText: '!',
      steps: ['す', 'すし'],
    })

    await editor.assert.blockTexts(['default !block 1', 'default block 2'])
    await expect.poll(() => editor.get.modelText()).toContain('default block 6')
    await expect.poll(() => editor.get.modelText()).not.toContain('すし')
    await editor.assert.selection({
      anchor: { path: [0, 0], offset: compositionPoint.offset + 1 },
      focus: { path: [0, 0], offset: compositionPoint.offset + 1 },
    })
    await editor.assert.domCaret({
      offset: compositionPoint.offset + 1,
      text: 'default !block 1',
    })
    await editor.assert.kernelTrace({
      eventFamily: 'compositionend',
      transition: { allowed: true },
    })
  })

  test('keeps active IME composition when a model change happens elsewhere', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Chromium IME proof')

    const editor = await openExample(page, 'rendering-strategy-runtime', {
      ready: {
        editor: 'visible',
        text: /default block 1/,
      },
      surface: { scope: '[data-runtime-editor="default"]' },
    })
    const initialText = 'default block 1'
    const compositionPoint = { path: [0, 0], offset: 'default '.length }

    await editor.selection.selectDOM({
      anchor: compositionPoint,
      focus: compositionPoint,
    })
    await editor.assert.domSelection({
      anchorNodeText: initialText,
      anchorOffset: compositionPoint.offset,
      focusNodeText: initialText,
      focusOffset: compositionPoint.offset,
    })

    await applyModelOperationsDuringDOMComposition(editor, {
      composingText: 'すし',
      operations: [
        {
          offset: 0,
          path: [1, 0],
          text: '!',
          type: 'insert_text',
        },
      ],
      steps: ['す', 'すし'],
    })

    await editor.assert.blockTexts(['default すしblock 1', '!default block 2'])
    await expect.poll(() => editor.get.modelText()).toContain('default block 6')
    await editor.assert.selection({
      anchor: { path: [0, 0], offset: compositionPoint.offset + 2 },
      focus: { path: [0, 0], offset: compositionPoint.offset + 2 },
    })
    await editor.assert.domCaret({
      offset: compositionPoint.offset + 2,
      text: 'default すしblock 1',
    })
    await editor.assert.kernelTrace({
      eventFamily: 'compositionend',
      transition: { allowed: true },
    })
  })

  test('commits rapidly following IME compositions in separate text blocks', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Chromium CDP IME proof')

    const editor = await openExample(page, 'rendering-strategy-runtime', {
      ready: {
        editor: 'visible',
        text: /default block 1/,
      },
      surface: { scope: '[data-runtime-editor="default"]' },
    })
    const firstText = 'default block 1'
    const secondText = 'default block 2'

    await collapseDOMSelectionToTextEnd(editor.locator.text([0, 0]), {
      anchor: { path: [0, 0], offset: firstText.length },
      focus: { path: [0, 0], offset: firstText.length },
    })
    await editor.ime.compose({
      committedText: '!',
      steps: ['!'],
      text: '!',
      transport: 'native',
    })

    await collapseDOMSelectionToTextEnd(editor.locator.text([1, 0]), {
      anchor: { path: [1, 0], offset: secondText.length },
      focus: { path: [1, 0], offset: secondText.length },
    })
    await editor.ime.compose({
      committedText: '.',
      steps: ['.'],
      text: '.',
      transport: 'native',
    })

    await editor.assert.blockTexts([`${firstText}!`, `${secondText}.`])
    await expect.poll(() => editor.get.modelText()).toContain('default block 6')
    await editor.assert.selection({
      anchor: { path: [1, 0], offset: secondText.length + 1 },
      focus: { path: [1, 0], offset: secondText.length + 1 },
    })
    await editor.assert.domCaret({
      offset: secondText.length + 1,
      text: `${secondText}.`,
    })

    const compositionEndTrace = (await editor.get.kernelTrace()).filter(
      (entry) => entry.eventFamily === 'compositionend'
    )

    expect(compositionEndTrace.length).toBeGreaterThanOrEqual(2)
  })

  test('commits cross-paragraph IME composition as one replacement', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Chromium IME proof')

    const editor = await openExample(page, 'rendering-strategy-runtime', {
      ready: {
        editor: 'visible',
        text: /default block 1/,
      },
      surface: { scope: '[data-runtime-editor="default"]' },
    })
    const firstText = 'default block 1'
    const secondText = 'default block 2'
    const prefixOffset = 'default '.length
    const suffixOffset = 'default'.length
    const committedText = 'すし'
    const expectedText = `default ${committedText} block 2`

    await selectDOMTextRange(editor, {
      anchorOffset: prefixOffset,
      anchorPath: [0, 0],
      anchorText: firstText,
      focusOffset: suffixOffset,
      focusPath: [1, 0],
      focusText: secondText,
    })
    await editor.assert.domSelection({
      anchorNodeText: firstText,
      anchorOffset: prefixOffset,
      focusNodeText: secondText,
      focusOffset: suffixOffset,
    })

    await commitDOMComposition(editor, {
      committedText,
      steps: ['す', committedText],
    })

    await editor.assert.blockTexts([expectedText, 'default block 3'])
    await expect.poll(() => editor.get.modelText()).toContain('default block 6')
    await expect.poll(() => editor.get.modelText()).not.toContain(secondText)
    await expect.poll(() => editor.get.modelText()).not.toContain('すしすし')
    await editor.assert.selection({
      anchor: { path: [0, 0], offset: prefixOffset + committedText.length },
      focus: { path: [0, 0], offset: prefixOffset + committedText.length },
    })
    await editor.assert.domCaret({
      offset: prefixOffset + committedText.length,
      text: expectedText,
    })
    await editor.assert.kernelTrace({
      eventFamily: 'compositionend',
      transition: { allowed: true },
    })
  })

  test('deletes shell-backed selection after WebKit compositionend', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'webkit', 'WebKit compositionend proof')

    const editor = await openExample(page, 'rendering-strategy-runtime', {
      ready: {
        editor: 'visible',
        text: /default block 1/,
      },
      surface: { scope: '[data-runtime-editor="default"]' },
    })

    await editor.root.evaluate((element: HTMLElement) => {
      element.focus()
    })
    await dispatchCompositionEnd(editor.root)
    await page.keyboard.press('ControlOrMeta+A')

    await expect(editor.root).toHaveAttribute(
      'data-slate-rendering-strategy-selection',
      'shell-backed'
    )
    await expect
      .poll(() => editor.selection.get())
      .toEqual({
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [5, 0], offset: 'default block 6'.length },
      })

    await page.keyboard.press('Backspace')

    await expect(editor.root).not.toContainText('default block 1')
    await expect(editor.root).not.toContainText('default block 6')
    await expect.poll(() => editor.get.modelText()).not.toContain('default')
    await editor.assert.selection({
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    })
  })

  test('runs generated composition gauntlet without illegal kernel transitions', async ({
    page,
  }, testInfo) => {
    const editor = await openExample(page, 'rendering-strategy-runtime', {
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
      'rendering-strategy-generated-composition-gauntlet',
      createSlateBrowserCompositionGauntlet({
        committedText: 'すし',
        steps: ['す', 'すし'],
        text: 'すし',
        textAfterComposition: 'default block 1すし',
        transport:
          testInfo.project.name === 'chromium' ? 'native' : 'synthetic',
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
          'rendering-strategy-composition-gauntlet.json'
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
    const editor = await openExample(page, 'rendering-strategy-runtime', {
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
    const editor = await openExample(page, 'rendering-strategy-runtime', {
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
    const editor = await openExample(page, 'rendering-strategy-runtime', {
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
    const editor = await openExample(page, 'rendering-strategy-runtime', {
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
    const editor = await openExample(page, 'rendering-strategy-runtime', {
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
    const editor = await openExample(page, 'rendering-strategy-runtime', {
      ready: {
        editor: 'visible',
        text: /default block 1/,
      },
      surface: { scope: '[data-runtime-editor="default"]' },
    })

    const result = await editor.scenario.run(
      'rendering-strategy-generated-shell-activation-gauntlet',
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
          'rendering-strategy-shell-activation-gauntlet.json'
        ),
      }
    )

    assertNoIllegalKernelTransitions(result)
  })

  test('imports native mouse drag selection inside mounted rendering-strategy content', async ({
    page,
  }, testInfo) => {
    const editor = await openExample(page, 'rendering-strategy-runtime', {
      ready: {
        editor: 'visible',
        text: /default block 1/,
      },
      surface: { scope: '[data-runtime-editor="default"]' },
    })

    const result = await editor.scenario.run(
      'rendering-strategy-native-drag-selection',
      [
        {
          kind: 'dragTextSelection',
          selector:
            '[data-runtime-editor="default"] span[data-slate-string="true"]',
          steps: 12,
        },
      ],
      {
        metadata: {
          capabilities: ['kernel-trace', 'rendering-strategy', 'selection'],
          platform: testInfo.project.name,
          transport: 'mouse',
        },
        tracePath: testInfo.outputPath(
          'rendering-strategy-native-drag-selection.json'
        ),
      }
    )

    await expect.poll(() => editor.get.selectedText()).toContain('block')
    await expect
      .poll(() => editor.selection.get())
      .toMatchObject({
        anchor: { path: [0, 0] },
        focus: { path: [0, 0] },
      })
    await expect
      .poll(() =>
        editor.root.evaluate(
          (element) =>
            element.getAttribute('data-slate-rendering-strategy-selection') ??
            ''
        )
      )
      .not.toBe('shell-backed')

    const selection = await editor.selection.get()

    expect(selection).not.toBeNull()
    expect(selection?.anchor.offset).not.toBe(selection?.focus.offset)
    assertNoIllegalKernelTransitions(result)
  })

  test('preserves Slate fragment paste over shell-backed selection', async ({
    page,
  }) => {
    const editor = await openExample(page, 'rendering-strategy-runtime', {
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
      'data-slate-rendering-strategy-selection',
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

  test('copies full shell-backed selection through Slate clipboard data', async ({
    page,
  }) => {
    const editor = await openExample(page, 'rendering-strategy-runtime', {
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
      'data-slate-rendering-strategy-selection',
      'shell-backed'
    )
    const payload = await editor.clipboard.copyEventPayload()

    expect(payload.text).toContain('default block 1')
    expect(payload.text).toContain('default block 6')
    expect(payload.types).toEqual(
      expect.arrayContaining(['text/html', 'text/plain'])
    )
    expect(payload.html).toContain('data-slate-fragment')
  })

  test('copies partial shell-backed selection through Slate clipboard data', async ({
    page,
  }) => {
    const editor = await openExample(page, 'rendering-strategy-runtime', {
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

    await expect(editor.root).toHaveAttribute(
      'data-slate-rendering-strategy-selection',
      'shell-backed'
    )

    const payload = await editor.clipboard.copyEventPayload()

    expect(payload.text).toBe('default block 3')
    expect(payload.types).toEqual(
      expect.arrayContaining(['text/html', 'text/plain'])
    )
    expect(payload.html).toContain('data-slate-fragment')
  })

  test('rebases shell-backed selection bookmarks through remote text operations', async ({
    page,
  }, testInfo) => {
    const editor = await openExample(page, 'rendering-strategy-runtime', {
      ready: {
        editor: 'visible',
        text: /default block 1/,
      },
      surface: { scope: '[data-runtime-editor="default"]' },
    })

    await editor.selection.select({
      anchor: { path: [2, 0], offset: 1 },
      focus: { path: [2, 0], offset: 'default '.length },
    })

    await expect(editor.root).toHaveAttribute(
      'data-slate-rendering-strategy-selection',
      'shell-backed'
    )

    const bookmark = await editor.selection.capture({ affinity: 'inward' })

    const result = await editor.scenario.run(
      'rendering-strategy-shell-bookmark-remote-rebase',
      [
        {
          kind: 'applyOperations',
          operations: [
            {
              offset: 0,
              path: [2, 0],
              text: 'remote ',
              type: 'insert_text',
            },
          ],
          tag: 'remote-import',
        },
      ],
      {
        metadata: {
          capabilities: [
            'collaboration',
            'rendering-strategy',
            'range-ref',
            'selection',
          ],
          platform: testInfo.project.name,
          transport: 'semantic-handle',
        },
        tracePath: testInfo.outputPath(
          'rendering-strategy-shell-bookmark-remote-rebase.json'
        ),
      }
    )

    const expectedSelection = {
      anchor: { path: [2, 0], offset: 'remote '.length + 1 },
      focus: { path: [2, 0], offset: 'remote default '.length },
    }

    await expect
      .poll(() => editor.selection.resolve(bookmark))
      .toEqual(expectedSelection)

    await editor.selection.restore(bookmark)
    await expect
      .poll(() =>
        editor.root.evaluate(
          (element) =>
            element.getAttribute('data-slate-rendering-strategy-selection') ??
            ''
        )
      )
      .not.toBe('shell-backed')

    const payload = await editor.clipboard.copyPayload()

    expect(payload.text).toBe('efault ')
    expect(await editor.selection.unref(bookmark)).toEqual(expectedSelection)
    assertNoIllegalKernelTransitions(result)
  })

  test('preserves Slate fragment paste over partial shelled selection', async ({
    page,
  }) => {
    const editor = await openExample(page, 'rendering-strategy-runtime', {
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
      'data-slate-rendering-strategy-selection',
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
    const editor = await openExample(page, 'rendering-strategy-runtime', {
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
      'data-slate-rendering-strategy-selection',
      'shell-backed'
    )
    await expect
      .poll(() => editor.selection.get())
      .toEqual({
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [5, 0], offset: 'rich block 6'.length },
      })

    await dispatchPaste(editor.root, {
      html: '<strong>rich marker</strong>',
      text: 'rich marker',
    })

    await editor.assert.text('rich marker')
    await expect(
      editor.root.locator('[data-runtime-bold="true"]').first()
    ).toBeVisible()
  })

  test('renders inline content inside rendering-strategy runtime', async ({
    page,
  }) => {
    const editor = await openExample(page, 'rendering-strategy-runtime', {
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

  test('renders void content inside rendering-strategy runtime', async ({
    page,
  }) => {
    const editor = await openExample(page, 'rendering-strategy-runtime', {
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
    const editor = await openExample(page, 'rendering-strategy-runtime', {
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

  test('renders table content inside rendering-strategy runtime', async ({
    page,
  }) => {
    const editor = await openExample(page, 'rendering-strategy-runtime', {
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

  test('renders rendering-strategy runtime inside Shadow DOM', async ({
    page,
  }) => {
    const editor = await openExample(page, 'rendering-strategy-runtime', {
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
