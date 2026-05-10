import { expect, Page, test } from '@playwright/test'
import {
  assertNoIllegalKernelTransitions,
  createSlateBrowserClipboardPasteGauntlet,
  createSlateBrowserDropDataGauntlet,
  openExample,
  recordSlateBrowserRuntimeErrors,
} from 'slate-browser/playwright'

const GOOGLE_DOCS_FONT_SIZE_HTML = `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid"><p dir="ltr" style="line-height:1.56;margin-top:10pt;margin-bottom:0pt;"><span style="font-size:24pt;font-family:Lato,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;text-decoration:none;white-space:pre-wrap;">Random text at </span><span style="font-size:36pt;font-family:Lato,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;text-decoration:none;white-space:pre-wrap;">36 pt</span></p></b>`

const GOOGLE_DOCS_BIU_HTML = `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;font-family:Arial;color:#000000;background-color:transparent;font-weight:700;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre-wrap;">Bold</span></p><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;font-family:Arial;color:#000000;background-color:transparent;font-weight:400;font-style:italic;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre-wrap;">Italic</span></p><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;font-family:Arial;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:underline;-webkit-text-decoration-skip:none;text-decoration-skip-ink:none;vertical-align:baseline;white-space:pre-wrap;">underline</span></p><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;font-family:Arial;color:#000000;background-color:transparent;font-weight:700;font-style:italic;font-variant:normal;text-decoration:underline;-webkit-text-decoration-skip:none;text-decoration-skip-ink:none;vertical-align:baseline;white-space:pre-wrap;">Bold Italic Underline</span></p></b><br class="Apple-interchange-newline">`

const GOOGLE_DOCS_TABS_HTML = `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-tabs"><p dir="ltr" style="line-height:1.38;margin-left:36pt;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;font-family:Arial;color:#000000;background-color:transparent;font-weight:400;font-style:normal;text-decoration:none;vertical-align:baseline;white-space:pre-wrap;">Hello</span><span style="font-size:11pt;font-family:Arial;color:#000000;background-color:transparent;font-weight:400;font-style:normal;text-decoration:none;vertical-align:baseline;white-space:pre-wrap;"><span class="Apple-tab-span" style="white-space:pre;">\t</span></span><span style="font-size:11pt;font-family:Arial;color:#000000;background-color:transparent;font-weight:400;font-style:normal;text-decoration:none;vertical-align:baseline;white-space:pre-wrap;">world</span></p><span style="font-size:11pt;font-family:Arial;color:#000000;background-color:transparent;font-weight:400;font-style:normal;text-decoration:none;vertical-align:baseline;white-space:pre-wrap;">Hello</span><span style="font-size:11pt;font-family:Arial;color:#000000;background-color:transparent;font-weight:400;font-style:normal;text-decoration:none;vertical-align:baseline;white-space:pre-wrap;"><span class="Apple-tab-span" style="white-space:pre;">\t</span></span><span style="font-size:11pt;font-family:Arial;color:#000000;background-color:transparent;font-weight:400;font-style:normal;text-decoration:none;vertical-align:baseline;white-space:pre-wrap;">world</span></b>`

const SEMANTIC_B_HTML = `<p><b>Semantic Bold</b><b style="font-weight:normal;"> Normal Wrapper</b></p>`

const PARAGRAPH_ALIGN_HTML = `<p align="right">Right aligned</p><p align="right" style="text-align: center;">CSS wins</p><p align="super-weird-stuff">Invalid ignored</p>`

const MULTILINE_EXTRA_NEWLINES_HTML =
  '<p>Hello\n</p>\n\n<p>\n\nWorld\n\n</p>\n\n<p>Hello\n\n   World   \n\n!\n\n</p><p>Hello <b>World</b> <i>!</i></p>'

const CODE_SOURCE_TEXT = `function run() {
  return true;
}`

const CODE_SOURCE_HTML_CASES = [
  {
    name: 'Quip-style pre with br line breaks',
    html: `<pre>function run() {<br>  return true;<br>}</pre>`,
  },
  {
    name: 'code element with br line breaks',
    html: `<code data-language="javascript" data-highlight-language="javascript"><span>function run() {</span><br><span>  return true;</span><br><span>}</span></code>`,
  },
  {
    name: 'VS Code-style whitespace pre divs',
    html: `<div style="white-space: pre;"><div><span>function</span> run() {</div><div>  return true;</div><div>}</div></div>`,
  },
  {
    name: 'GitHub-style code table without line gutters',
    html: `<table class="highlight"><tbody><tr><td class="blob-num" data-line-number="1"></td><td class="blob-code blob-code-inner js-file-line">function run() {</td></tr><tr><td class="blob-num" data-line-number="2"></td><td class="blob-code blob-code-inner js-file-line">  return true;</td></tr><tr><td class="blob-num" data-line-number="3"></td><td class="blob-code blob-code-inner js-file-line">}</td></tr></tbody></table>`,
  },
] as const

const GOOGLE_DOCS_TABLE_HTML = `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid"><div dir="ltr"><table style="border-collapse:collapse;table-layout:fixed;width:468pt"><colgroup><col><col><col></colgroup><tbody><tr><td><p><span style="font-size:11pt;font-family:Arial;font-weight:400;font-style:normal;text-decoration:none;white-space:pre-wrap;">a</span></p></td><td><p><span style="font-size:11pt;font-family:Arial;font-weight:400;font-style:normal;text-decoration:none;white-space:pre-wrap;">b</span></p><p><span style="font-size:11pt;font-family:Arial;font-weight:400;font-style:normal;text-decoration:none;white-space:pre-wrap;">b</span></p></td><td><p><span style="font-size:11pt;font-family:Arial;font-weight:400;font-style:normal;text-decoration:none;white-space:pre-wrap;">c</span></p></td></tr><tr><td><p><span style="font-size:11pt;font-family:Arial;font-weight:400;font-style:normal;text-decoration:none;white-space:pre-wrap;">d</span></p></td><td><p><span style="font-size:11pt;font-family:Arial;font-weight:400;font-style:normal;text-decoration:none;white-space:pre-wrap;">e</span></p></td><td><p><span style="font-size:11pt;font-family:Arial;font-weight:400;font-style:normal;text-decoration:none;white-space:pre-wrap;">f</span></p></td></tr></tbody></table></div></b>`

const QUIP_TABLE_HTML = `<meta charset="utf-8"><table style="border-collapse:collapse;"><col style="width:90px;"><col style="width:90px;"><col style="width:90px;"><tr><td style="border:1px solid rgb(230,230,230);text-align:left;">a</td><td style="border:1px solid rgb(230,230,230);text-align:left;">b<br>b</td><td style="border:1px solid rgb(230,230,230);text-align:left;">c</td></tr><tr><td style="border:1px solid rgb(230,230,230);text-align:left;">d</td><td style="border:1px solid rgb(230,230,230);text-align:left;">e</td><td style="border:1px solid rgb(230,230,230);text-align:left;">f</td></tr></table>`

const GOOGLE_SHEETS_TABLE_HTML = `<google-sheets-html-origin><style type="text/css"><!--td {border: 1px solid #cccccc;}br {mso-data-placement:same-cell;}--></style><table xmlns="http://www.w3.org/1999/xhtml" cellspacing="0" cellpadding="0" dir="ltr" border="1" style="table-layout:fixed;font-size:10pt;font-family:Arial;width:0px;border-collapse:collapse;border:none" data-sheets-root="1"><tbody><tr style="height:21px;"><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;font-weight:bold;" data-sheets-value="{&quot;1&quot;:2,&quot;2&quot;:&quot;Surface&quot;}">Surface</td><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;font-style:italic;" data-sheets-value="{&quot;1&quot;:2,&quot;2&quot;:&quot;MWP_WORK_LS_COMPOSER&quot;}">MWP_WORK_LS_COMPOSER</td><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;text-decoration:underline;text-align:right;" data-sheets-value="{&quot;1&quot;:3,&quot;3&quot;:77349}">77349</td></tr><tr style="height:21px;"><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;" data-sheets-value="{&quot;1&quot;:2,&quot;2&quot;:&quot;Slate&quot;}">Slate</td><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;text-decoration:line-through;" data-sheets-value="{&quot;1&quot;:2,&quot;2&quot;:&quot;old editor&quot;}">old editor</td><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;" data-sheets-value="{&quot;1&quot;:2,&quot;2&quot;:&quot;mixed bold&quot;}"><span style="font-size:10pt;font-family:Arial;font-style:normal;">mixed </span><span style="font-size:10pt;font-family:Arial;font-weight:bold;font-style:normal;">bold</span></td></tr></tbody></table>`

const HEADER_TABLE_HTML = `<table><thead><tr><th>Animal</th><th>Feet</th></tr></thead><tbody><tr><td>Cat</td><td>4</td></tr></tbody></table>`

const COMMENT_BOUNDED_TABLE_HTML = `<html><body><p>outside before</p><!--StartFragment--><table><tbody><tr><td><p>123</p></td></tr><tr><td><p>456</p></td></tr></tbody></table><!--EndFragment--><p>outside after</p></body></html>`

const LEXICAL_IMAGE_HTML_CASES = [
  {
    caption: null,
    html: `<p><img alt="" height="inherit" src="/test/image.jpg" width="inherit"></p>`,
    text: '',
  },
  {
    caption: 'caption text',
    html: `<div role="paragraph"><figure><img alt="" height="inherit" src="/test/image.jpg" width="inherit"><figcaption><span style="white-space: pre-wrap">caption text</span></figcaption></figure></div>`,
    text: 'caption text',
  },
] as const

const LEXICAL_CORE_HTML_BLOCK_CASES = [
  {
    blockTexts: ['Hello!'],
    html: 'Hello!',
    name: 'plain DOM text node',
  },
  {
    blockTexts: ['Hello!', ''],
    html: '<p>Hello!<p>',
    name: 'malformed paragraph pair',
  },
  {
    blockTexts: ['123', '456'],
    html: '123<div>456</div>',
    name: 'single div boundary',
  },
  {
    blockTexts: ['a b c d e', 'f g h'],
    html: '<div>a b <span>c d <span>e</span></span><div>f <span>g h</span></div></div>',
    name: 'nested spans and divs',
  },
  {
    blockTexts: ['123', '456'],
    html: '<div><span>123<div>456</div></span></div>',
    name: 'nested span in a div',
  },
  {
    blockTexts: ['123', '456'],
    html: '<span>123<div>456</div></span>',
    name: 'nested div in a span',
  },
] as const

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

  test('imports source-code HTML as a code block without source gutters', async ({
    page,
  }) => {
    for (const codeCase of CODE_SOURCE_HTML_CASES) {
      await page.goto('/examples/paste-html')
      const editor = await openExample(page, 'paste-html', {
        ready: {
          editor: 'visible',
        },
      })

      await editor.selection.selectAll()
      await insertDataWithHandle(editor, {
        html: codeCase.html,
        text: CODE_SOURCE_TEXT,
      })

      await expect(editor.root.locator('pre')).toHaveCount(1)
      await expect(editor.root.locator('table')).toHaveCount(0)
      await expect
        .poll(
          async () =>
            editor.root
              .locator('pre code')
              .evaluate((element) => element.textContent),
          { message: codeCase.name }
        )
        .toBe(CODE_SOURCE_TEXT)
    }
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
    await expect(editor.root.locator('strong')).toHaveText('Hello Bold!')
    if (testInfo.project.name !== 'mobile') {
      expect(await editor.get.selection()).not.toBe(null)
    }
  })

  test('pastes copied rendered Slate content as an internal fragment before HTML import', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'Desktop clipboard repro')

    const runtimeErrors = recordSlateBrowserRuntimeErrors(page)
    const editor = await openExample(page, 'paste-html', {
      ready: {
        editor: 'visible',
      },
    })
    const copiedText =
      "Try it out for yourself! Copy and paste some rendered HTML rich text content (not the source code) from another site into this editor and it's formatting should be preserved."
    const firstParagraphRemainder =
      " default, pasting content into a Slate editor will use the clipboard's 'text/plain' data. That's okay for some use cases, but sometimes you want users to be able to paste in content and have it maintain its formatting. To do this, your editor needs to handle 'text/html' data. "

    try {
      await editor.selection.selectDOM({
        anchor: { path: [2, 0], offset: 0 },
        focus: { path: [2, 0], offset: copiedText.length },
      })

      const payload = await editor.clipboard.copyPayload()

      expect(payload.html).toContain('data-slate-fragment=')

      await editor.selection.collapse({ path: [0, 0], offset: 2 })
      await editor.focus()
      await editor.root.press('ControlOrMeta+V')

      await editor.assert.blockTexts([
        'By',
        copiedText,
        firstParagraphRemainder,
        'This is an example of doing exactly that!',
        copiedText,
      ])
      runtimeErrors.assertNone()
    } finally {
      runtimeErrors.stop()
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

  for (const coreCase of LEXICAL_CORE_HTML_BLOCK_CASES) {
    test(`imports Lexical core HTML block shape: ${coreCase.name}`, async ({
      page,
    }) => {
      const editor = await openExample(page, 'paste-html', {
        ready: {
          editor: 'visible',
        },
      })

      await editor.selection.selectAll()
      await insertDataWithHandle(editor, { html: coreCase.html })

      await editor.assert.blockTexts([...coreCase.blockTexts])
    })
  }

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

  test('preserves Google Docs BIU formatting from rich HTML paste', async ({
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
        html: GOOGLE_DOCS_BIU_HTML,
        text: 'Bold\nItalic\nunderline\nBold Italic Underline',
      })
    } else {
      await editor.clipboard.pasteHtml(
        GOOGLE_DOCS_BIU_HTML,
        'Bold\nItalic\nunderline\nBold Italic Underline'
      )
    }

    const paragraphs = editor.root.locator('p')
    const bold = paragraphs
      .filter({ hasText: /^Bold$/ })
      .locator('span[style*="font-size"]')
    const italic = paragraphs
      .filter({ hasText: /^Italic$/ })
      .locator('span[style*="font-size"]')
    const underline = paragraphs
      .filter({ hasText: /^underline$/ })
      .locator('span[style*="font-size"]')
    const combined = paragraphs
      .filter({ hasText: /^Bold Italic Underline$/ })
      .locator('span[style*="font-size"]')

    await expect(bold).toHaveCSS('font-size', '14.6667px')
    await expect(bold.locator('strong')).toHaveText('Bold')
    await expect(italic.locator('em')).toHaveText('Italic')
    await expect(underline.locator('u')).toHaveText('underline')
    await expect(combined.locator('strong')).toHaveText('Bold Italic Underline')
    await expect(combined.locator('em')).toHaveText('Bold Italic Underline')
    await expect(combined.locator('u')).toHaveText('Bold Italic Underline')
  })

  test('keeps semantic b bold without marking normal-weight wrappers', async ({
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
        html: SEMANTIC_B_HTML,
        text: 'Semantic Bold Normal Wrapper',
      })
    } else {
      await editor.clipboard.pasteHtml(
        SEMANTIC_B_HTML,
        'Semantic Bold Normal Wrapper'
      )
    }

    await expect(
      editor.root.locator('strong').filter({ hasText: 'Semantic Bold' })
    ).toHaveCount(1)
    await expect(
      editor.root.locator('strong').filter({ hasText: 'Normal Wrapper' })
    ).toHaveCount(0)
  })

  test('imports Google Docs tab spans and loose line from rich HTML paste', async ({
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
        html: GOOGLE_DOCS_TABS_HTML,
        text: 'Hello\tworld\nHello\tworld',
      })
    } else {
      await editor.clipboard.pasteHtml(
        GOOGLE_DOCS_TABS_HTML,
        'Hello\tworld\nHello\tworld'
      )
    }

    await expect
      .poll(async () =>
        editor.root
          .locator('p')
          .evaluateAll((paragraphs) =>
            paragraphs
              .map((paragraph) => paragraph.textContent)
              .filter((text) => text)
          )
      )
      .toEqual(['Hello\tworld', 'Hello\tworld'])
  })

  test('imports paragraph alignment from CSS and legacy align HTML', async ({
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
        html: PARAGRAPH_ALIGN_HTML,
        text: 'Right aligned\nCSS wins\nInvalid ignored',
      })
    } else {
      await editor.clipboard.pasteHtml(
        PARAGRAPH_ALIGN_HTML,
        'Right aligned\nCSS wins\nInvalid ignored'
      )
    }

    await editor.assert.text('Right alignedCSS winsInvalid ignored')

    const paragraphs = editor.root.locator('p')
    await expect(paragraphs.filter({ hasText: /^Right aligned$/ })).toHaveCount(
      1
    )
    await expect(paragraphs.filter({ hasText: /^CSS wins$/ })).toHaveCount(1)
    await expect(
      paragraphs.filter({ hasText: /^Invalid ignored$/ })
    ).toHaveCount(1)
    await expect
      .poll(async () =>
        Promise.all(
          ['Right aligned', 'CSS wins', 'Invalid ignored'].map(async (text) =>
            paragraphs
              .filter({ hasText: new RegExp(`^${text}$`) })
              .evaluate((node) => (node as HTMLElement).style.textAlign)
          )
        )
      )
      .toEqual(['right', 'center', ''])
  })

  test('normalizes extra newlines from multiline HTML paragraphs', async ({
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
        html: MULTILINE_EXTRA_NEWLINES_HTML,
        text: 'Hello\nWorld\nHello   World   !\nHello World !',
      })
    } else {
      await editor.clipboard.pasteHtml(
        MULTILINE_EXTRA_NEWLINES_HTML,
        'Hello\nWorld\nHello   World   !\nHello World !'
      )
    }

    const paragraphs = editor.root.locator('p')
    await expect(paragraphs).toHaveCount(4)
    await expect(paragraphs.nth(0)).toHaveText('Hello', {
      useInnerText: true,
    })
    await expect(paragraphs.nth(1)).toHaveText('World', {
      useInnerText: true,
    })
    await expect(paragraphs.nth(2)).toHaveText('Hello   World   !', {
      useInnerText: true,
    })
    await expect(paragraphs.nth(3)).toHaveText('Hello World !', {
      useInnerText: true,
    })
    await expect(paragraphs.nth(3).locator('strong')).toHaveText('World')
    await expect(paragraphs.nth(3).locator('em')).toHaveText('!')
  })

  test('imports an anchor element from rich HTML paste', async ({
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
        html: '<a href="https://facebook.com">Facebook!</a>',
        text: 'Facebook!',
      })
    } else {
      await editor.clipboard.pasteHtml(
        '<a href="https://facebook.com">Facebook!</a>',
        'Facebook!'
      )
    }

    await editor.assert.text('Facebook!')

    const link = editor.root.locator('a').filter({ hasText: 'Facebook!' })
    await expect(link).toHaveCount(1)
    await expect(link).toHaveAttribute('href', 'https://facebook.com/')
  })

  test('imports noisy link in list HTML without losing the link', async ({
    page,
  }, testInfo) => {
    const editor = await openExample(page, 'paste-html', {
      ready: {
        editor: 'visible',
      },
    })
    const html = `<div>Line 0</div><ul><li><div>Line 1 <a href="https://www.internalfb.com/removed?entry_point=20">Some link</a>.</div></li><li><div>Line 2.</div></li></ul>`

    await editor.selection.selectAll()
    if (testInfo.project.name === 'mobile') {
      await insertDataWithHandle(editor, {
        html,
        text: 'Line 0\nLine 1 Some link.\nLine 2.',
      })
    } else {
      await editor.clipboard.pasteHtml(
        html,
        'Line 0\nLine 1 Some link.\nLine 2.'
      )
    }

    await expect(
      editor.root.locator('p').filter({ hasText: 'Line 0' })
    ).toHaveCount(1)
    await expect(editor.root.locator('ul')).toHaveCount(1)
    await expect(editor.root.locator('li')).toHaveCount(2)
    await expect(editor.root.locator('li').nth(0)).toContainText(
      'Line 1 Some link.'
    )
    await expect(editor.root.locator('li').nth(1)).toContainText('Line 2.')

    const link = editor.root.locator('li a').filter({ hasText: 'Some link' })
    await expect(link).toHaveCount(1)
    await expect(link).toHaveAttribute(
      'href',
      'https://www.internalfb.com/removed?entry_point=20'
    )
  })

  test('imports a basic unordered list from rich HTML paste', async ({
    page,
  }, testInfo) => {
    const editor = await openExample(page, 'paste-html', {
      ready: {
        editor: 'visible',
      },
    })
    const html = '<ul><li>Hello</li><li>world!</li></ul>'

    await editor.selection.selectAll()
    if (testInfo.project.name === 'mobile') {
      await insertDataWithHandle(editor, {
        html,
        text: 'Hello\nworld!',
      })
    } else {
      await editor.clipboard.pasteHtml(html, 'Hello\nworld!')
    }

    await editor.assert.text('Helloworld!')
    await expect(editor.root.locator('ul')).toHaveCount(1)
    await expect(editor.root.locator('li')).toHaveCount(2)
    await expect(editor.root.locator('li').nth(0)).toHaveText('Hello')
    await expect(editor.root.locator('li').nth(1)).toHaveText('world!')
  })

  test('imports compact nested list variants from rich HTML paste', async ({
    page,
  }, testInfo) => {
    const cases = [
      {
        html: '<ul><li>Hello</li><li><ul><li>awesome</li></ul></li><li>world!</li></ul>',
        text: 'Hello\nawesome\nworld!',
        expectedText: 'Helloawesomeworld!',
      },
      {
        html: '<ul><ul><li>Hello</li></ul><li>world!</li></ul>',
        text: 'Hello\nworld!',
        expectedText: 'Helloworld!',
      },
      {
        html: '<ul><li>Hello<ul><li>world!</li></ul></li></ul>',
        text: 'Hello\nworld!',
        expectedText: 'Helloworld!',
      },
    ]

    for (const listCase of cases) {
      await page.goto('/examples/paste-html')
      const editor = await openExample(page, 'paste-html', {
        ready: {
          editor: 'visible',
        },
      })

      await editor.selection.selectAll()
      if (testInfo.project.name === 'mobile') {
        await insertDataWithHandle(editor, {
          html: listCase.html,
          text: listCase.text,
        })
      } else {
        await editor.clipboard.pasteHtml(listCase.html, listCase.text)
      }

      await editor.assert.text(listCase.expectedText)
      await expect(editor.root.locator('ul ul')).toHaveCount(1)
    }
  })

  test('imports nested divs in list items as visible boundaries', async ({
    page,
  }, testInfo) => {
    const editor = await openExample(page, 'paste-html', {
      ready: {
        editor: 'visible',
      },
    })
    const html = '<ol><li>1<div>2</div>3</li><li>A<div>B</div>C</li></ol>'

    await editor.selection.selectAll()
    if (testInfo.project.name === 'mobile') {
      await insertDataWithHandle(editor, {
        html,
        text: '1\n2\n3\nA\nB\nC',
      })
    } else {
      await editor.clipboard.pasteHtml(html, '1\n2\n3\nA\nB\nC')
    }

    await expect(editor.root.locator('ol')).toHaveCount(1)
    await expect(editor.root.locator('li')).toHaveCount(2)
    await expect(editor.root.locator('li').nth(0)).toContainText('1')
    await expect(editor.root.locator('li').nth(0)).toContainText('2')
    await expect(editor.root.locator('li').nth(0)).toContainText('3')
    await expect(editor.root.locator('li').nth(1)).toContainText('A')
    await expect(editor.root.locator('li').nth(1)).toContainText('B')
    await expect(editor.root.locator('li').nth(1)).toContainText('C')
    await expect(editor.root.locator('li').nth(0).locator('p')).toHaveText('2')
    await expect(editor.root.locator('li').nth(1).locator('p')).toHaveText('B')
  })

  test('imports Lexical image HTML with optional captions', async ({
    page,
  }, testInfo) => {
    for (const imageCase of LEXICAL_IMAGE_HTML_CASES) {
      await page.goto('/examples/paste-html')
      const editor = await openExample(page, 'paste-html', {
        ready: {
          editor: 'visible',
        },
      })

      await editor.selection.selectAll()
      if (testInfo.project.name === 'mobile') {
        await insertDataWithHandle(editor, imageCase)
      } else {
        await editor.clipboard.pasteHtml(imageCase.html, imageCase.text)
      }

      await expect(editor.root.locator('img')).toHaveCount(1)
      await expect(editor.root.locator('img')).toHaveAttribute(
        'src',
        /\/test\/image\.jpg$/
      )

      if (imageCase.caption) {
        await expect(editor.root.locator('p')).toHaveText(imageCase.caption)
        await expect.poll(() => editor.get.modelText()).toBe(imageCase.caption)
      } else {
        await expect(editor.root.locator('p')).toHaveCount(0)
        await expect.poll(() => editor.get.modelText()).toBe('')
      }
    }
  })

  test('imports Google Docs table HTML with cell paragraphs', async ({
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
        html: GOOGLE_DOCS_TABLE_HTML,
        text: 'a\tb\nb\tc\nd\te\tf',
      })
    } else {
      await editor.clipboard.pasteHtml(
        GOOGLE_DOCS_TABLE_HTML,
        'a\tb\nb\tc\nd\te\tf'
      )
    }

    await editor.assert.text('abbcdef')
    await expect(editor.root.locator('table')).toHaveCount(1)
    await expect(editor.root.locator('tr')).toHaveCount(2)
    await expect(editor.root.locator('td')).toHaveCount(6)

    const cells = editor.root.locator('td')
    await expect(cells.nth(0).locator('p')).toHaveText('a')
    await expect(cells.nth(1).locator('p')).toHaveText(['b', 'b'])
    await expect(cells.nth(2).locator('p')).toHaveText('c')
    await expect(cells.nth(3).locator('p')).toHaveText('d')
    await expect(cells.nth(4).locator('p')).toHaveText('e')
    await expect(cells.nth(5).locator('p')).toHaveText('f')
    await expect(cells.nth(1).locator('span[style*="font-size"]')).toHaveCount(
      2
    )
    await expect(
      cells.nth(1).locator('span[style*="font-size"]').first()
    ).toHaveCSS('font-size', '14.6667px')
  })

  test('imports Quip table HTML with a cell line break', async ({
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
        html: QUIP_TABLE_HTML,
        text: 'a\tb\nb\tc\nd\te\tf',
      })
    } else {
      await editor.clipboard.pasteHtml(QUIP_TABLE_HTML, 'a\tb\nb\tc\nd\te\tf')
    }

    await editor.assert.text('ab\nbcdef')
    await expect(editor.root.locator('table')).toHaveCount(1)
    await expect(editor.root.locator('tr')).toHaveCount(2)
    await expect(editor.root.locator('td')).toHaveCount(6)

    const cells = editor.root.locator('td')
    await expect(cells.nth(0)).toHaveText('a')
    await expect(cells.nth(1)).toHaveText('b b')
    await expect(cells.nth(2)).toHaveText('c')
    await expect(cells.nth(3)).toHaveText('d')
    await expect(cells.nth(4)).toHaveText('e')
    await expect(cells.nth(5)).toHaveText('f')
    await expect
      .poll(async () => cells.nth(1).evaluate((element) => element.textContent))
      .toBe('b\nb')
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

  test('imports table header cells as plain table cells', async ({
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
        html: HEADER_TABLE_HTML,
        text: 'Animal\tFeet\nCat\t4',
      })
    } else {
      await editor.clipboard.pasteHtml(
        HEADER_TABLE_HTML,
        'Animal\tFeet\nCat\t4'
      )
    }

    await editor.assert.text('AnimalFeetCat4')
    await expect(editor.root.locator('table')).toHaveCount(1)
    await expect(editor.root.locator('tr')).toHaveCount(2)
    await expect(editor.root.locator('td')).toHaveCount(4)
    await expect(editor.root.locator('td').nth(0)).toHaveText('Animal')
    await expect(editor.root.locator('td').nth(1)).toHaveText('Feet')
    await expect(editor.root.locator('td').nth(2)).toHaveText('Cat')
    await expect(editor.root.locator('td').nth(3)).toHaveText('4')
  })

  test('imports only the comment-bounded fragment from wrapped clipboard HTML', async ({
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
        html: COMMENT_BOUNDED_TABLE_HTML,
        text: '123\n456',
      })
    } else {
      await editor.clipboard.pasteHtml(COMMENT_BOUNDED_TABLE_HTML, '123\n456')
    }

    await editor.assert.text('123456')
    await expect(editor.root).not.toContainText('outside before')
    await expect(editor.root).not.toContainText('outside after')
    await expect(editor.root.locator('table')).toHaveCount(1)
    await expect(editor.root.locator('tr')).toHaveCount(2)
    await expect(editor.root.locator('td')).toHaveCount(2)
    await expect(editor.root.locator('td').nth(0).locator('p')).toHaveText(
      '123'
    )
    await expect(editor.root.locator('td').nth(1).locator('p')).toHaveText(
      '456'
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
