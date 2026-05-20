import { expect, type Locator, type Page, test } from '@playwright/test'
import {
  assertNoIllegalKernelTransitions,
  createSlateBrowserEditorHarness,
  createSlateBrowserTextInsertionGauntlet,
} from 'slate-browser/playwright'

const focusTextboxEnd = async (textbox: Locator) => {
  await textbox.evaluate((element: Element) => {
    const editable = element as HTMLElement
    const root = editable.getRootNode() as Document | ShadowRoot
    const selection =
      'getSelection' in root ? root.getSelection() : window.getSelection()
    const range = editable.ownerDocument.createRange()

    editable.focus()
    range.selectNodeContents(editable)
    range.collapse(false)
    selection?.removeAllRanges()
    selection?.addRange(range)
  })
}

const selectEnd = async (
  editor: ReturnType<typeof createSlateBrowserEditorHarness>
) => {
  const selection = {
    anchor: { path: [0, 0], offset: 51 },
    focus: { path: [0, 0], offset: 51 },
  }

  await editor.selection.select(selection)
  await expect.poll(() => editor.selection.get()).toEqual(selection)
}

const waitForShadowBreakSync = async ({
  page,
  textbox,
}: {
  page: Page
  textbox: Locator
}) => {
  await expect(textbox.locator('[data-slate-node="element"]')).toHaveCount(2)
  await page.waitForTimeout(100)
  await focusTextboxEnd(textbox)
}

const typeShadowText = async ({
  browserName,
  textbox,
  page,
  projectName,
  text,
}: {
  browserName: string
  textbox: Locator
  page: Page
  projectName: string
  text: string
}) => {
  if (projectName === 'mobile') {
    await page.keyboard.type(text, { delay: 50 })
    return
  }

  if (browserName === 'webkit') {
    await textbox.pressSequentially(text, { delay: 25 })
    return
  }

  await page.keyboard.insertText(text)
}

test.describe('shadow-dom example', () => {
  test.beforeEach(async ({ page }) => await page.goto('/examples/shadow-dom'))

  test('renders slate editor inside nested shadow', async ({ page }) => {
    const outerShadow = page.locator('[data-cy="outer-shadow-root"]')
    const innerShadow = outerShadow.locator('> div')

    await expect(innerShadow.getByRole('textbox')).toHaveCount(1)
  })

  test('renders slate editor inside nested shadow and edits content', async ({
    browserName,
    page,
  }, testInfo) => {
    const outerShadow = page.locator('[data-cy="outer-shadow-root"]')
    const innerShadow = outerShadow.locator('> div')
    const textbox = innerShadow.getByRole('textbox')
    const editor = createSlateBrowserEditorHarness(page, 'shadow-dom', textbox)

    // Ensure the textbox is present
    await expect(textbox).toHaveCount(1)

    if (browserName === 'webkit' || testInfo.project.name === 'mobile') {
      await selectEnd(editor)
      await editor.insertText(' Hello, Playwright!')
    } else {
      await textbox.click()
      await focusTextboxEnd(textbox)
      await typeShadowText({
        browserName,
        textbox,
        page,
        projectName: testInfo.project.name,
        text: ' Hello, Playwright!',
      })
    }

    await expect.poll(() => editor.get.text()).toContain('Hello, Playwright!')
    await expect(textbox).toContainText('Hello, Playwright!')
  })

  test('runs generated shadow DOM typing gauntlet without illegal kernel transitions', async ({
    page,
  }, testInfo) => {
    const outerShadow = page.locator('[data-cy="outer-shadow-root"]')
    const innerShadow = outerShadow.locator('> div')
    const textbox = innerShadow.getByRole('textbox')
    await expect(textbox).toHaveCount(1)

    const editor = createSlateBrowserEditorHarness(page, 'shadow-dom', textbox)
    await selectEnd(editor)

    const result = await editor.scenario.run(
      'shadow-dom-generated-typing-gauntlet',
      createSlateBrowserTextInsertionGauntlet({
        insertedText: 'ShadowProof',
        textAfterInsert: 'ShadowProof',
      }),
      {
        metadata: {
          capabilities: ['kernel-trace', 'shadow-dom', 'text-mutation'],
          platform: testInfo.project.name,
          transport: 'semantic-handle',
        },
        tracePath: testInfo.outputPath('shadow-dom-typing-gauntlet.json'),
      }
    )

    assertNoIllegalKernelTransitions(result)
  })

  test('keeps shadow DOM ArrowLeft movement model-owned inside the shadow root', async ({
    page,
  }, testInfo) => {
    if (testInfo.project.name === 'mobile') {
      return
    }

    const outerShadow = page.locator('[data-cy="outer-shadow-root"]')
    const innerShadow = outerShadow.locator('> div')
    const textbox = innerShadow.getByRole('textbox')
    await expect(textbox).toHaveCount(1)

    const editor = createSlateBrowserEditorHarness(page, 'shadow-dom', textbox)
    await selectEnd(editor)
    await editor.press('ArrowLeft')

    await expect
      .poll(() => editor.selection.get())
      .toEqual({
        anchor: { path: [0, 0], offset: 50 },
        focus: { path: [0, 0], offset: 50 },
      })
    expect(await editor.get.kernelTrace()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: expect.objectContaining({
            axis: 'horizontal',
            kind: 'move-selection',
          }),
          eventFamily: 'keydown',
          movement: expect.objectContaining({
            axis: 'horizontal',
            ownership: 'model-owned',
            reason: 'model-horizontal-inline-void',
          }),
        }),
      ])
    )
  })

  test('user can type add a new line in editor inside shadow DOM', async ({
    browserName,
    page,
  }, testInfo) => {
    const consoleErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text())
      }
    })

    const pageErrors: Error[] = []
    page.on('pageerror', (error) => {
      pageErrors.push(error)
    })

    const outerShadow = page.locator('[data-cy="outer-shadow-root"]')
    const innerShadow = outerShadow.locator('> div')
    const textbox = innerShadow.getByRole('textbox')
    const editor = createSlateBrowserEditorHarness(page, 'shadow-dom', textbox)

    if (browserName === 'webkit' || testInfo.project.name === 'mobile') {
      await selectEnd(editor)
      await editor.insertBreak()
    } else {
      await textbox.click()
      await focusTextboxEnd(textbox)
      await page.keyboard.press('Enter')
    }
    await waitForShadowBreakSync({ page, textbox })
    if (browserName === 'webkit' || testInfo.project.name === 'mobile') {
      await editor.insertText('New line text')
    } else {
      await typeShadowText({
        browserName,
        textbox,
        page,
        projectName: testInfo.project.name,
        text: 'New line text',
      })
    }

    expect(consoleErrors, 'Console errors occurred').toEqual([])
    expect(pageErrors, 'Page errors occurred').toEqual([])

    await expect(textbox).toContainText('New line text')
    expect(await editor.get.text()).toContain('New line text')
  })
})
