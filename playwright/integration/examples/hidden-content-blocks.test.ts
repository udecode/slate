import { expect, type Page, test } from '@playwright/test'

import { openExample } from 'slate-browser/playwright'

const dragTextRange = async (
  page: Page,
  {
    end,
    start,
  }: {
    end: { offset: number; text: string }
    start: { offset: number; text: string }
  }
) => {
  const points = await page.evaluate(
    ({ end, start }) => {
      const root = document.querySelector('#hidden-content-blocks-editor')

      if (!root) {
        throw new Error('Hidden content blocks editor is not mounted')
      }

      const textNodes: Text[] = []
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)

      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.nodeValue?.trim()) {
          textNodes.push(node as Text)
        }
      }

      const pointFor = ({ offset, text }: { offset: number; text: string }) => {
        const node = textNodes.find((textNode) =>
          textNode.nodeValue?.includes(text)
        )

        if (!node) {
          throw new Error(`Cannot find text node containing "${text}"`)
        }

        const range = document.createRange()

        range.setStart(node, offset)
        range.collapse(true)

        const rect = range.getBoundingClientRect()

        return {
          x: rect.left,
          y: rect.top + rect.height / 2,
        }
      }

      return {
        end: pointFor(end),
        start: pointFor(start),
      }
    },
    { end, start }
  )

  await page.mouse.move(points.start.x, points.start.y)
  await page.mouse.down()
  await page.mouse.move(points.end.x, points.end.y, { steps: 20 })
  await page.mouse.up()
}

test.describe('hidden content blocks example', () => {
  test('keeps active tab panel spacing stable when switching tabs', async ({
    page,
  }) => {
    await openExample(page, 'hidden-content-blocks', {
      ready: {
        editor: 'visible',
        text: /Overview tab visible text/,
      },
    })

    const activePanelOffset = () =>
      page.evaluate(() => {
        const list = document.querySelector('[data-slot="tabs-list"]')
        const activePanel = document.querySelector(
          '[data-slot="tabs-content"][data-state="active"]'
        )

        if (!list || !activePanel) {
          throw new Error('Tabs layout is not mounted')
        }

        const listRect = list.getBoundingClientRect()
        const panelRect = activePanel.getBoundingClientRect()

        return Math.round((panelRect.top - listRect.bottom) * 100) / 100
      })

    const overviewOffset = await activePanelOffset()

    await page.getByTestId('tab-details').click()
    await expect(page.getByTestId('tab-details')).toHaveAttribute(
      'data-state',
      'active'
    )

    await expect.poll(activePanelOffset).toBe(overviewOffset)
  })

  test('keeps shadcn hidden content out of the DOM until opened', async ({
    page,
  }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))

    const editor = await openExample(page, 'hidden-content-blocks', {
      ready: {
        editor: 'visible',
        text: /Accordion body/,
      },
    })

    await expect(editor.root).not.toContainText('Accordion secret alpha')
    await expect(editor.root).not.toContainText('Collapsible hidden note')
    await expect(editor.root).not.toContainText('Details tab hidden text')
    await expect(
      editor.root.locator('[data-slate-dom-coverage-boundary]')
    ).toHaveCount(3)
    await expect(
      page.getByTestId('hidden-content-native-surface')
    ).toContainText('degraded')

    await page.getByTestId('accordion-trigger').click()
    await expect(editor.root).toContainText('Accordion secret alpha')
    await expect(editor.root).toContainText('Accordion secret beta')

    await page.getByTestId('collapsible-trigger').click()
    await expect(editor.root).toContainText('Collapsible hidden note')

    await page.getByTestId('tab-details').click()
    await expect(editor.root).toContainText('Details tab hidden text')
    await expect(editor.root).not.toContainText('Overview tab visible text')
    await expect(
      editor.root.locator('[data-slate-dom-coverage-boundary]')
    ).toHaveCount(1)
    await expect.poll(() => pageErrors).toEqual([])
  })

  test('copies model-backed shadcn hidden content while DOM is absent', async ({
    page,
  }) => {
    const editor = await openExample(page, 'hidden-content-blocks', {
      ready: {
        editor: 'visible',
        text: /Accordion body/,
      },
    })

    await expect(editor.root).not.toContainText('Accordion secret alpha')
    await page.getByTestId('select-copy-accordion').click()
    await expect(page.getByTestId('hidden-content-copy-preview')).toContainText(
      'Accordion secret alpha'
    )

    await expect(editor.root).not.toContainText('Collapsible hidden note')
    await page.getByTestId('select-copy-collapsible').click()
    await expect(page.getByTestId('hidden-content-copy-preview')).toContainText(
      'Collapsible hidden note'
    )

    await expect(editor.root).not.toContainText('Details tab hidden text')
    await page.getByTestId('select-copy-details').click()
    await expect(page.getByTestId('hidden-content-copy-preview')).toContainText(
      'Details tab hidden text'
    )

    await page.getByTestId('policy-copy-exclude').click()
    await expect(page.getByTestId('hidden-content-copy-policy')).toContainText(
      'exclude'
    )
    await page.getByTestId('select-copy-details').click()
    await expect(page.getByTestId('hidden-content-copy-preview')).toContainText(
      'copy payload appears here'
    )

    await page.getByTestId('policy-copy-materialize').click()
    await expect(page.getByTestId('hidden-content-copy-policy')).toContainText(
      'materialize'
    )
    await page.getByTestId('select-copy-details').click()
    await expect(page.getByTestId('hidden-content-copy-preview')).toContainText(
      'Details tab hidden text'
    )
    await expect(page.getByTestId('tab-details')).toHaveAttribute(
      'data-state',
      'active'
    )
  })

  test('controls selection policy for inactive tab navigation', async ({
    page,
  }) => {
    const editor = await openExample(page, 'hidden-content-blocks', {
      ready: {
        editor: 'visible',
        text: /Overview tab visible text/,
      },
    })

    await expect(
      page.getByTestId('hidden-content-selection-policy')
    ).toContainText('boundary')
    await expect(page.getByTestId('hidden-content-find-policy')).toContainText(
      'not-native-until-mounted'
    )

    const intro = 'Intro visible before hidden blocks.'
    await editor.selection.collapse({ offset: intro.length, path: [0, 0] })
    await page.keyboard.press('ArrowRight')
    await editor.assert.selection({
      anchor: { offset: 0, path: [2, 0, 0] },
      focus: { offset: 0, path: [2, 0, 0] },
    })
    await expect(editor.root).not.toContainText('Accordion secret alpha')
    await expect(page.getByTestId('tab-overview')).toHaveAttribute(
      'data-state',
      'active'
    )
    await expect(page.getByTestId('tab-details')).toHaveAttribute(
      'data-state',
      'inactive'
    )

    const overview = 'Overview tab visible text'
    await editor.selection.collapse({
      offset: overview.length,
      path: [2, 0, 0],
    })
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('ArrowRight')
    }

    await expect(page.getByTestId('tab-overview')).toHaveAttribute(
      'data-state',
      'active'
    )
    await expect(page.getByTestId('tab-details')).toHaveAttribute(
      'data-state',
      'inactive'
    )
    await expect(editor.root).toContainText('Overview tab visible text')
    await expect(editor.root).not.toContainText('Details tab hidden text')

    await page.getByTestId('policy-selection-model-backed').click()
    await expect(
      page.getByTestId('hidden-content-selection-policy')
    ).toContainText('model-backed')
    await editor.selection.collapse({
      offset: overview.length,
      path: [2, 0, 0],
    })
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('ArrowRight')
    }

    await expect(page.getByTestId('tab-overview')).toHaveAttribute(
      'data-state',
      'active'
    )
    await expect(page.getByTestId('tab-details')).toHaveAttribute(
      'data-state',
      'inactive'
    )

    await page.getByTestId('policy-find-native').click()
    await expect(page.getByTestId('hidden-content-find-policy')).toContainText(
      'native'
    )
    await page.getByTestId('policy-selection-materialize').click()
    await expect(
      page.getByTestId('hidden-content-selection-policy')
    ).toContainText('materialize')
    await editor.selection.collapse({
      offset: overview.length,
      path: [2, 0, 0],
    })
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('ArrowRight')
    }

    await expect(page.getByTestId('tab-overview')).toHaveAttribute(
      'data-state',
      'inactive'
    )
    await expect(page.getByTestId('tab-details')).toHaveAttribute(
      'data-state',
      'active'
    )
    await expect(editor.root).not.toContainText('Overview tab visible text')
    await expect(editor.root).toContainText('Details tab hidden text')
  })

  test('keeps shifted boundary navigation out of shadcn chrome selection', async ({
    page,
  }) => {
    const editor = await openExample(page, 'hidden-content-blocks', {
      ready: {
        editor: 'visible',
        text: /Overview tab visible text/,
      },
    })

    const intro = 'Intro visible before hidden blocks.'
    await editor.selection.select({
      anchor: { offset: intro.length - 3, path: [0, 0] },
      focus: { offset: intro.length, path: [0, 0] },
    })
    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ''))
      .toBe('ks.')
    await page.keyboard.press('Shift+ArrowRight')
    await editor.assert.selection({
      anchor: { offset: intro.length - 3, path: [0, 0] },
      focus: { offset: 1, path: [2, 0, 0] },
    })
    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ''))
      .toBe('ks.\nO')
    await page.keyboard.press('Shift+ArrowRight')
    await editor.assert.selection({
      anchor: { offset: intro.length - 3, path: [0, 0] },
      focus: { offset: 2, path: [2, 0, 0] },
    })
    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ''))
      .toBe('ks.\nOv')
    await expect(page.getByTestId('tab-overview')).toHaveAttribute(
      'data-state',
      'active'
    )
    await expect(page.getByTestId('tab-details')).toHaveAttribute(
      'data-state',
      'inactive'
    )

    await editor.selection.select({
      anchor: { offset: intro.length - 3, path: [0, 0] },
      focus: { offset: intro.length, path: [0, 0] },
    })
    await page.keyboard.press('Control+Shift+ArrowRight')
    await editor.assert.selection({
      anchor: { offset: intro.length - 3, path: [0, 0] },
      focus: { offset: 'Overview'.length, path: [2, 0, 0] },
    })
    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ''))
      .toBe('ks.\nOverview')
    await expect(editor.root).not.toContainText('Accordion secret alpha')
    await expect(editor.root).not.toContainText('Details tab hidden text')
  })

  test('preserves the unselected active tab suffix when deleting across visible hidden content', async ({
    page,
  }) => {
    const editor = await openExample(page, 'hidden-content-blocks', {
      query: { accordion_open: true },
      ready: {
        editor: 'visible',
        text: /Accordion secret alpha/,
      },
    })

    await dragTextRange(page, {
      start: {
        offset: 'Intro visible '.length,
        text: 'Intro visible before hidden blocks.',
      },
      end: {
        offset: 'Overview tab'.length,
        text: 'Overview tab visible text',
      },
    })

    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ''))
      .toBe(
        [
          'before hidden blocks.',
          'Accordion secret alpha',
          'Accordion secret beta',
          'Overview tab',
        ].join('\n')
      )

    await page.keyboard.press('Backspace')

    await expect.poll(() => editor.get.modelText()).toContain(' visible text')
    await expect(editor.root).not.toContainText('Accordion secret alpha')
    await expect(
      page.locator('[data-slot="tabs-content"][data-state="active"]')
    ).toContainText(' visible text')
    await expect(
      page.locator('[data-slot="tabs-content"][data-state="active"]')
    ).not.toContainText('Details tab hidden text')
  })

  test('preserves the unselected second tab suffix when deleting across visible hidden content', async ({
    page,
  }) => {
    const editor = await openExample(page, 'hidden-content-blocks', {
      query: { accordion_open: true, tab: 'details' },
      ready: {
        editor: 'visible',
        text: /Details tab hidden text/,
      },
    })

    await dragTextRange(page, {
      start: {
        offset: 'Intro visible '.length,
        text: 'Intro visible before hidden blocks.',
      },
      end: {
        offset: 'Details tab'.length,
        text: 'Details tab hidden text',
      },
    })

    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ''))
      .toBe(
        [
          'before hidden blocks.',
          'Accordion secret alpha',
          'Accordion secret beta',
          'Details tab',
        ].join('\n')
      )

    await page.keyboard.press('Backspace')

    await expect.poll(() => editor.get.modelText()).toContain(' hidden text')
    await expect(editor.root).not.toContainText('Accordion secret alpha')
    await expect(page.getByTestId('tab-details')).toHaveAttribute(
      'data-state',
      'active'
    )
    await expect(
      page.locator('[data-slot="tabs-content"][data-state="active"]')
    ).toContainText(' hidden text')
    await expect(
      page.locator('[data-slot="tabs-content"][data-state="active"]')
    ).not.toContainText('Overview tab visible text')
  })
})
