import { expect, Page, test } from '@playwright/test'
import {
  assertNoIllegalKernelTransitions,
  createSlateBrowserClipboardPasteGauntlet,
  createSlateBrowserDropDataGauntlet,
  openExample,
} from 'slate-browser/playwright'

const insertDataWithHandle = async (
  editor: Awaited<ReturnType<typeof openExample>>,
  payload: { html?: string; text?: string }
) => {
  await editor.root.evaluate((element: HTMLElement, nextPayload) => {
    const handle = (element as Record<string, any>).__slateBrowserHandle

    if (!handle?.insertData) {
      throw new Error('Missing Slate browser insertData handle')
    }

    handle.insertData(nextPayload)
  }, payload)
}

test.describe('paste html example', () => {
  test.beforeEach(async ({ page }) => await page.goto('/examples/paste-html'))

  const pasteHtml = async (page: Page, htmlContent: string) => {
    await page.getByRole('textbox').click()
    await page.getByRole('textbox').selectText()
    await page.keyboard.press('Backspace')
    await page
      .getByRole('textbox')
      .evaluate((el: HTMLElement, htmlContent: string) => {
        const clipboardEvent = Object.assign(
          new Event('paste', { bubbles: true, cancelable: true }),
          {
            clipboardData: {
              getData: (type = 'text/html') => htmlContent,
              types: ['text/html'],
            },
          }
        )
        el.dispatchEvent(clipboardEvent)
      }, htmlContent)
  }

  test('pasted bold text uses <strong>', async ({ page }) => {
    await pasteHtml(page, '<strong>Hello Bold</strong>')
    expect(await page.locator('strong').textContent()).toContain('Hello')
  })

  test('pasted code uses <code>', async ({ page }) => {
    await pasteHtml(page, '<code>console.log("hello from slate!")</code>')
    await expect(
      page.getByRole('textbox').locator('code').filter({ hasText: 'slate!' })
    ).toHaveCount(1)
  })

  test('keeps caret editable after rich HTML paste over selected content', async ({
    page,
  }, testInfo) => {
    const editor = await openExample(page, 'paste-html', {
      ready: {
        editor: 'visible',
      },
    })

    await editor.selection.selectAll()
    if (testInfo.project.name === 'mobile') {
      await insertDataWithHandle(editor, {
        html: '<strong>Hello Bold</strong>',
        text: 'Hello Bold',
      })
    } else {
      await editor.clipboard.pasteHtml(
        '<strong>Hello Bold</strong>',
        'Hello Bold'
      )
    }

    await editor.assert.text('Hello Bold')
    await expect(
      editor.root.locator('strong').filter({ hasText: 'Hello' })
    ).toHaveCount(1)
    if (testInfo.project.name === 'mobile') {
      await editor.selection.select({
        anchor: { path: [0, 0], offset: 'Hello Bold'.length },
        focus: { path: [0, 0], offset: 'Hello Bold'.length },
      })
      return
    }
    expect(await editor.get.selection()).not.toBe(null)

    if (testInfo.project.name === 'mobile') {
      await editor.insertText('!')
    } else {
      await editor.type('!')
    }

    await editor.assert.text('Hello Bold!')
    await expect(
      editor.root.locator('strong').filter({ hasText: 'Hello' })
    ).toHaveCount(1)
    if (testInfo.project.name !== 'mobile') {
      expect(await editor.get.selection()).not.toBe(null)
    }
  })

  test('runs generated clipboard paste gauntlet without illegal kernel transitions', async ({
    page,
  }, testInfo) => {
    if (testInfo.project.name === 'mobile') {
      return
    }

    const editor = await openExample(page, 'paste-html', {
      ready: {
        editor: 'visible',
      },
    })

    const result = await editor.scenario.run(
      'paste-html-generated-clipboard-gauntlet',
      createSlateBrowserClipboardPasteGauntlet({
        html: '<strong>Hello Bold</strong>',
        plainText: 'Hello Bold',
        textAfterPaste: 'Hello Bold',
      }),
      {
        metadata: {
          capabilities: ['clipboard', 'html-paste', 'kernel-trace'],
          platform: testInfo.project.name,
          transport: 'clipboard',
        },
        tracePath: testInfo.outputPath('paste-html-clipboard-gauntlet.json'),
      }
    )

    assertNoIllegalKernelTransitions(result)
    expect(result.metadata.claim).toBe('desktop-native-clipboard')
    await expect(
      editor.root.locator('strong').filter({ hasText: 'Hello' })
    ).toHaveCount(1)
  })

  test('runs generated drop data gauntlet without illegal kernel transitions', async ({
    page,
  }, testInfo) => {
    const editor = await openExample(page, 'paste-html', {
      ready: {
        editor: 'visible',
      },
    })

    const result = await editor.scenario.run(
      'paste-html-generated-drop-data-gauntlet',
      createSlateBrowserDropDataGauntlet({
        html: '<strong>Dropped Bold</strong>',
        plainText: 'Dropped Bold',
        textAfterDrop: 'Dropped Bold',
      }),
      {
        metadata: {
          capabilities: ['drop', 'html-drop', 'kernel-trace'],
          platform: testInfo.project.name,
          transport: 'synthetic-datatransfer-drop',
        },
        tracePath: testInfo.outputPath('paste-html-drop-data-gauntlet.json'),
      }
    )

    assertNoIllegalKernelTransitions(result)
    expect(result.metadata.claim).toBe('synthetic-datatransfer')
    await expect(
      editor.root.locator('strong').filter({ hasText: 'Dropped' })
    ).toHaveCount(1)
  })
})
