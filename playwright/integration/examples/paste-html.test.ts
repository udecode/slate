import { expect, Page, test } from '@playwright/test'
import {
  assertNoIllegalKernelTransitions,
  createSlateBrowserClipboardPasteGauntlet,
  createSlateBrowserDropDataGauntlet,
  openExample,
} from 'slate-browser/playwright'

const GOOGLE_DOCS_FONT_SIZE_HTML = `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid"><p dir="ltr" style="line-height:1.56;margin-top:10pt;margin-bottom:0pt;"><span style="font-size:24pt;font-family:Lato,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;text-decoration:none;white-space:pre-wrap;">Random text at </span><span style="font-size:36pt;font-family:Lato,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;text-decoration:none;white-space:pre-wrap;">36 pt</span></p></b>`

const GOOGLE_SHEETS_TABLE_HTML = `<google-sheets-html-origin><style type="text/css"><!--td {border: 1px solid #cccccc;}br {mso-data-placement:same-cell;}--></style><table xmlns="http://www.w3.org/1999/xhtml" cellspacing="0" cellpadding="0" dir="ltr" border="1" style="table-layout:fixed;font-size:10pt;font-family:Arial;width:0px;border-collapse:collapse;border:none" data-sheets-root="1"><tbody><tr style="height:21px;"><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;font-weight:bold;" data-sheets-value="{&quot;1&quot;:2,&quot;2&quot;:&quot;Surface&quot;}">Surface</td><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;font-style:italic;" data-sheets-value="{&quot;1&quot;:2,&quot;2&quot;:&quot;MWP_WORK_LS_COMPOSER&quot;}">MWP_WORK_LS_COMPOSER</td><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;text-decoration:underline;text-align:right;" data-sheets-value="{&quot;1&quot;:3,&quot;3&quot;:77349}">77349</td></tr><tr style="height:21px;"><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;" data-sheets-value="{&quot;1&quot;:2,&quot;2&quot;:&quot;Slate&quot;}">Slate</td><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;text-decoration:line-through;" data-sheets-value="{&quot;1&quot;:2,&quot;2&quot;:&quot;old editor&quot;}">old editor</td><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;" data-sheets-value="{&quot;1&quot;:2,&quot;2&quot;:&quot;mixed bold&quot;}"><span style="font-size:10pt;font-family:Arial;font-style:normal;">mixed </span><span style="font-size:10pt;font-family:Arial;font-weight:bold;font-style:normal;">bold</span></td></tr></tbody></table>`

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

  test('treats iOS prediction payload as plain text inside formatted selection', async ({
    page,
  }) => {
    const editor = await openExample(page, 'paste-html', {
      ready: {
        editor: 'visible',
      },
    })
    const insertedText = 'Prediction'

    await editor.selection.select({
      anchor: { path: [0, 1], offset: 0 },
      focus: { path: [0, 1], offset: 0 },
    })

    await insertDataWithHandle(editor, {
      html: insertedText,
      text: insertedText,
    })

    await expect(editor.root.locator('code').first()).toHaveText(
      `${insertedText}'text/plain'`
    )
    await editor.assert.selection({
      anchor: { path: [0, 1], offset: insertedText.length },
      focus: { path: [0, 1], offset: insertedText.length },
    })
  })

  test('preserves Google Docs font-size spans from rich HTML paste', async ({
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
        html: GOOGLE_DOCS_FONT_SIZE_HTML,
        text: 'Random text at 36 pt',
      })
    } else {
      await editor.clipboard.pasteHtml(
        GOOGLE_DOCS_FONT_SIZE_HTML,
        'Random text at 36 pt'
      )
    }

    await editor.assert.text('Random text at 36 pt')

    const styledLeaves = editor.root.locator('span[style*="font-size"]')
    await expect(styledLeaves).toHaveCount(2)
    await expect(styledLeaves.nth(0)).toHaveText('Random text at ')
    await expect(styledLeaves.nth(0)).toHaveCSS('font-size', '32px')
    await expect(styledLeaves.nth(1)).toHaveText('36 pt')
    await expect(styledLeaves.nth(1)).toHaveCSS('font-size', '48px')
  })

  test('imports Google Sheets table HTML as table rows and cells', async ({
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
        html: GOOGLE_SHEETS_TABLE_HTML,
        text: 'Surface\tMWP_WORK_LS_COMPOSER\t77349\nSlate\told editor\tmixed bold',
      })
    } else {
      await editor.clipboard.pasteHtml(
        GOOGLE_SHEETS_TABLE_HTML,
        'Surface\tMWP_WORK_LS_COMPOSER\t77349\nSlate\told editor\tmixed bold'
      )
    }

    await editor.assert.text(
      'SurfaceMWP_WORK_LS_COMPOSER77349Slateold editormixed bold'
    )
    await expect(editor.root.locator('table')).toHaveCount(1)
    await expect(editor.root.locator('tr')).toHaveCount(2)
    await expect(editor.root.locator('td')).toHaveCount(6)
    await expect(editor.root.locator('td').nth(0).locator('strong')).toHaveText(
      'Surface'
    )
    await expect(editor.root.locator('td').nth(1).locator('em')).toHaveText(
      'MWP_WORK_LS_COMPOSER'
    )
    await expect(editor.root.locator('td').nth(2).locator('u')).toHaveText(
      '77349'
    )
    await expect(editor.root.locator('td').nth(4).locator('del')).toHaveText(
      'old editor'
    )
    await expect(editor.root.locator('td').nth(5).locator('strong')).toHaveText(
      'bold'
    )
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
