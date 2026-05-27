import { expect, type Locator, test } from '@playwright/test'
import {
  createSlateBrowserEditorHarness,
  openExample,
  recordSlateBrowserRuntimeErrors,
} from 'slate-browser/playwright'

const SHARED_ROOT = 'synced-block:shared:body'
const SEPARATE_ROOT = 'synced-block:separate:body'
const SHARED_BODY_FIRST = 'Shared mission statement'
const SHARED_BODY_SECOND = 'Editing any copy updates every synced copy.'

const getBrowserUndoHotkey = async (root: Locator) =>
  root
    .page()
    .evaluate(() =>
      /Mac OS X/.test(navigator.userAgent) ? 'Meta+Z' : 'Control+Z'
    )

const getBrowserRedoHotkey = async (root: Locator) =>
  root
    .page()
    .evaluate(() =>
      /Mac OS X/.test(navigator.userAgent) ? 'Meta+Shift+Z' : 'Control+Shift+Z'
    )

const getSyncedBlock = (
  page: Parameters<typeof openExample>[0],
  index: number
) => page.locator('[data-slate-synced-block]').nth(index)

const getSyncedBlockByRoot = (
  page: Parameters<typeof openExample>[0],
  root: string,
  index = 0
) => page.locator(`[data-slate-synced-root="${root}"]`).nth(index)

const getSyncedEditor = (
  page: Parameters<typeof openExample>[0],
  index: number
) => getSyncedBlock(page, index).locator('[data-slate-editor="true"]')

const getSyncedEditorByRoot = (
  page: Parameters<typeof openExample>[0],
  root: string,
  index = 0
) =>
  getSyncedBlockByRoot(page, root, index).locator('[data-slate-editor="true"]')

const firstSharedOwner = {
  childRoot: SHARED_ROOT,
  ownerPath: [1],
  ownerRoot: 'main',
}

const firstSharedProjectionGraph = [
  { path: [0], root: 'main' },
  { owner: firstSharedOwner, path: [0], root: SHARED_ROOT },
]

const focusRoot = async (
  root:
    | ReturnType<typeof getSyncedEditor>
    | ReturnType<typeof getSyncedEditorByRoot>
) => {
  await root.evaluate((element: HTMLElement) => {
    element.focus()
  })
}

const getNativeSelectionText = (page: Parameters<typeof openExample>[0]) =>
  page.evaluate(() => window.getSelection()?.toString() ?? '')

const dragFromLocatorToLocator = async ({
  from,
  page,
  to,
}: {
  from: Locator
  page: Parameters<typeof openExample>[0]
  to: Locator
}) => {
  const fromBox = await from.boundingBox()
  const toBox = await to.boundingBox()

  if (!fromBox || !toBox) {
    throw new Error('Cannot drag across unmounted text locators')
  }

  await page.mouse.move(fromBox.x + fromBox.width - 1, fromBox.y + 4)
  await page.mouse.down()
  await page.mouse.move(toBox.x + Math.min(toBox.width, 18), toBox.y + 4, {
    steps: 8,
  })
  await page.mouse.up()
}

const getViewSelection = (
  root:
    | ReturnType<typeof getSyncedEditor>
    | ReturnType<typeof getSyncedEditorByRoot>
) =>
  root.evaluate((element: HTMLElement) => {
    const handle = (
      element as HTMLElement & {
        __slateBrowserHandle?: {
          getViewSelection?: () => unknown
        }
      }
    ).__slateBrowserHandle

    return handle?.getViewSelection?.() ?? null
  })

const setViewSelection = (
  root:
    | ReturnType<typeof getSyncedEditor>
    | ReturnType<typeof getSyncedEditorByRoot>,
  selection: unknown
) =>
  root.evaluate((element: HTMLElement, nextSelection) => {
    const handle = (
      element as HTMLElement & {
        __slateBrowserHandle?: {
          setViewSelection?: (selection: unknown) => void
        }
      }
    ).__slateBrowserHandle

    if (!handle?.setViewSelection) {
      throw new Error('This editor surface does not expose setViewSelection')
    }

    handle.setViewSelection(nextSelection)
  }, selection)

const getProjectedNativeAffordanceMatrix = (
  root:
    | ReturnType<typeof getSyncedEditor>
    | ReturnType<typeof getSyncedEditorByRoot>
) =>
  root.evaluate((element: HTMLElement) => {
    const handle = (
      element as HTMLElement & {
        __slateBrowserHandle?: {
          getProjectedNativeAffordanceMatrix?: () => unknown
        }
      }
    ).__slateBrowserHandle

    return handle?.getProjectedNativeAffordanceMatrix?.() ?? null
  })

test.describe('synced blocks example', () => {
  test('smoke renders synced copies around normal paragraphs', async ({
    page,
  }) => {
    await openExample(page, 'synced-blocks', {
      ready: { editor: 'visible' },
    })

    await expect(page.locator('.example-page-title')).toContainText(
      'Synced Blocks'
    )
    await expect(page.locator('[data-slate-synced-block]')).toHaveCount(3)
    await expect(getSyncedEditorByRoot(page, SHARED_ROOT, 0)).toContainText(
      'Shared mission statement'
    )
    await expect(getSyncedEditorByRoot(page, SHARED_ROOT, 1)).toContainText(
      'Shared mission statement'
    )
    await expect(getSyncedEditorByRoot(page, SEPARATE_ROOT)).toContainText(
      'Separate synced document'
    )
    await expect(page.getByText('p1')).toBeVisible()
    await expect(page.getByText('p2')).toBeVisible()
  })

  test('editing one synced copy updates the other mounted copy', async ({
    page,
  }) => {
    await openExample(page, 'synced-blocks', {
      ready: { editor: 'visible' },
    })

    const firstEditor = getSyncedEditorByRoot(page, SHARED_ROOT, 0)
    const secondEditor = getSyncedEditorByRoot(page, SHARED_ROOT, 1)
    const separateEditor = getSyncedEditorByRoot(page, SEPARATE_ROOT)
    const first = createSlateBrowserEditorHarness(
      page,
      'synced-blocks-first-copy',
      firstEditor
    )

    await first.selection.collapse({ path: [0, 0], offset: 0 })
    await first.insertText('Team ')

    await expect(firstEditor).toContainText('Team Shared mission statement')
    await expect(secondEditor).toContainText('Team Shared mission statement')
    await expect(separateEditor).not.toContainText('Team ')
  })

  test('undo and redo keep focus in the active synced copy', async ({
    page,
  }) => {
    const runtimeErrors = recordSlateBrowserRuntimeErrors(page, {
      patterns: ['Cannot find a descendant', 'Could not set focus'],
    })

    try {
      await openExample(page, 'synced-blocks', {
        ready: { editor: 'visible' },
      })

      const firstEditor = getSyncedEditorByRoot(page, SHARED_ROOT, 0)
      const secondEditor = getSyncedEditorByRoot(page, SHARED_ROOT, 1)
      const second = createSlateBrowserEditorHarness(
        page,
        'synced-blocks-second-copy',
        secondEditor
      )

      await second.selection.collapse({ path: [0, 0], offset: 0 })
      await focusRoot(secondEditor)
      await second.insertText('Second ')
      await expect(secondEditor).toBeFocused()
      await expect(firstEditor).toContainText('Second Shared mission statement')

      await second.undo()
      await expect(secondEditor).toBeFocused()
      await expect(firstEditor).not.toContainText('Second ')
      await expect(secondEditor).not.toContainText('Second ')

      await second.redo()
      await expect(secondEditor).toBeFocused()
      await expect(firstEditor).toContainText('Second Shared mission statement')
      await expect(secondEditor).toContainText(
        'Second Shared mission statement'
      )

      runtimeErrors.assertNone()
    } finally {
      runtimeErrors.stop()
    }
  })

  test('undo and redo restore focus while walking history across main and synced roots', async ({
    page,
  }) => {
    const runtimeErrors = recordSlateBrowserRuntimeErrors(page, {
      patterns: ['Cannot find a descendant', 'Could not set focus'],
    })

    try {
      await openExample(page, 'synced-blocks', {
        ready: { editor: 'visible' },
      })

      const outerEditor = page.locator('[data-slate-editor="true"]').first()
      const firstEditor = getSyncedEditorByRoot(page, SHARED_ROOT, 0)
      const secondEditor = getSyncedEditorByRoot(page, SHARED_ROOT, 1)
      const outer = createSlateBrowserEditorHarness(
        page,
        'synced-blocks-outer',
        outerEditor
      )
      const second = createSlateBrowserEditorHarness(
        page,
        'synced-blocks-second-copy',
        secondEditor
      )

      await outer.selection.collapse({ path: [0, 0], offset: 'p1'.length })
      await focusRoot(outerEditor)
      await outer.insertText(' main')

      await second.selection.collapse({ path: [0, 0], offset: 0 })
      await focusRoot(secondEditor)
      await second.insertText(' synced')

      await outer.selection.collapse({ path: [6, 0], offset: 'p2'.length })
      await focusRoot(outerEditor)
      await outer.insertText(' tail')

      await expect(page.getByText('p1 main')).toBeVisible()
      await expect(firstEditor).toContainText(' syncedShared mission statement')
      await expect(secondEditor).toContainText(
        ' syncedShared mission statement'
      )
      await expect(page.getByText('p2 tail')).toBeVisible()

      const undoHotkey = await getBrowserUndoHotkey(outerEditor)
      const redoHotkey = await getBrowserRedoHotkey(outerEditor)

      await focusRoot(outerEditor)
      await outerEditor.press(undoHotkey)
      await expect(outerEditor).toBeFocused()
      await expect(page.getByText('p2 tail')).toHaveCount(0)
      await expect(page.getByText('p2')).toBeVisible()

      await page.keyboard.press(undoHotkey)
      await expect(secondEditor).toBeFocused()
      await expect(firstEditor).not.toContainText(
        ' syncedShared mission statement'
      )
      await expect(secondEditor).not.toContainText(
        ' syncedShared mission statement'
      )

      await page.keyboard.press(undoHotkey)
      await expect(outerEditor).toBeFocused()
      await expect(page.getByText('p1 main')).toHaveCount(0)
      await expect(page.getByText('p1')).toBeVisible()

      await page.keyboard.press(redoHotkey)
      await expect(outerEditor).toBeFocused()
      await expect(page.getByText('p1 main')).toBeVisible()

      await page.keyboard.press(redoHotkey)
      await expect(secondEditor).toBeFocused()
      await expect(secondEditor).toContainText(
        ' syncedShared mission statement'
      )

      runtimeErrors.assertNone()
    } finally {
      runtimeErrors.stop()
    }
  })

  test('moves ArrowDown through paragraphs, separate synced roots, and repeated synced copies', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Desktop vertical content-root proof uses Chromium caret geometry'
    )

    await openExample(page, 'synced-blocks', {
      ready: { editor: 'visible' },
    })

    const outerEditor = page.locator('[data-slate-editor="true"]').first()
    const firstEditor = getSyncedEditorByRoot(page, SHARED_ROOT, 0)
    const separateEditor = getSyncedEditorByRoot(page, SEPARATE_ROOT)
    const secondEditor = getSyncedEditorByRoot(page, SHARED_ROOT, 1)
    const outer = createSlateBrowserEditorHarness(
      page,
      'synced-blocks-outer',
      outerEditor
    )
    const first = createSlateBrowserEditorHarness(
      page,
      'synced-blocks-first-copy',
      firstEditor
    )
    const separate = createSlateBrowserEditorHarness(
      page,
      'synced-blocks-separate-copy',
      separateEditor
    )
    const second = createSlateBrowserEditorHarness(
      page,
      'synced-blocks-second-copy',
      secondEditor
    )

    await outer.selection.collapse({ path: [0, 0], offset: 1 })
    await focusRoot(outerEditor)
    await outer.press('ArrowDown')

    await expect(firstEditor).toBeFocused()
    await expect.poll(() => first.selection.get()).not.toBe(null)

    await first.selection.collapse({
      path: [1, 0],
      offset: SHARED_BODY_SECOND.length,
    })
    await focusRoot(firstEditor)
    await first.press('ArrowDown')

    await expect(outerEditor).toBeFocused()
    await expect
      .poll(() => outer.selection.get())
      .toMatchObject({
        anchor: { path: [2, 0] },
        focus: { path: [2, 0] },
      })

    await outer.selection.collapse({ path: [2, 0], offset: 10 })
    await focusRoot(outerEditor)
    await outer.press('ArrowDown')

    await expect(separateEditor).toBeFocused()
    await expect.poll(() => separate.selection.get()).not.toBe(null)

    await separate.selection.collapse({
      path: [1, 0],
      offset: 'This block proves a different synced root stays isolated.'
        .length,
    })
    await focusRoot(separateEditor)
    await separate.press('ArrowDown')

    await expect(outerEditor).toBeFocused()
    await expect
      .poll(() => outer.selection.get())
      .toMatchObject({
        anchor: { path: [4, 0] },
        focus: { path: [4, 0] },
      })

    await outer.selection.collapse({ path: [4, 0], offset: 10 })
    await focusRoot(outerEditor)
    await outer.press('ArrowDown')

    await expect(secondEditor).toBeFocused()
    await expect.poll(() => second.selection.get()).not.toBe(null)

    await second.selection.collapse({
      path: [1, 0],
      offset: SHARED_BODY_SECOND.length,
    })
    await focusRoot(secondEditor)
    await second.press('ArrowDown')

    await expect(outerEditor).toBeFocused()
    await expect
      .poll(() => outer.selection.get())
      .toMatchObject({
        anchor: { path: [6, 0] },
        focus: { path: [6, 0] },
      })
  })

  test('moves ArrowUp through repeated synced copies, separate synced roots, and paragraphs', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Desktop vertical content-root proof uses Chromium caret geometry'
    )

    await openExample(page, 'synced-blocks', {
      ready: { editor: 'visible' },
    })

    const outerEditor = page.locator('[data-slate-editor="true"]').first()
    const firstEditor = getSyncedEditorByRoot(page, SHARED_ROOT, 0)
    const separateEditor = getSyncedEditorByRoot(page, SEPARATE_ROOT)
    const secondEditor = getSyncedEditorByRoot(page, SHARED_ROOT, 1)
    const outer = createSlateBrowserEditorHarness(
      page,
      'synced-blocks-outer',
      outerEditor
    )
    const first = createSlateBrowserEditorHarness(
      page,
      'synced-blocks-first-copy',
      firstEditor
    )
    const separate = createSlateBrowserEditorHarness(
      page,
      'synced-blocks-separate-copy',
      separateEditor
    )
    const second = createSlateBrowserEditorHarness(
      page,
      'synced-blocks-second-copy',
      secondEditor
    )

    await outer.selection.collapse({ path: [6, 0], offset: 0 })
    await focusRoot(outerEditor)
    await outer.press('ArrowUp')

    await expect(secondEditor).toBeFocused()
    await expect.poll(() => second.selection.get()).not.toBe(null)

    await second.selection.collapse({ path: [0, 0], offset: 0 })
    await focusRoot(secondEditor)
    await second.press('ArrowUp')

    await expect(outerEditor).toBeFocused()
    await expect
      .poll(() => outer.selection.get())
      .toMatchObject({
        anchor: { path: [4, 0] },
        focus: { path: [4, 0] },
      })

    await outer.selection.collapse({ path: [4, 0], offset: 0 })
    await focusRoot(outerEditor)
    await outer.press('ArrowUp')

    await expect(separateEditor).toBeFocused()
    await expect.poll(() => separate.selection.get()).not.toBe(null)

    await separate.selection.collapse({ path: [0, 0], offset: 0 })
    await focusRoot(separateEditor)
    await separate.press('ArrowUp')

    await expect(outerEditor).toBeFocused()
    await expect
      .poll(() => outer.selection.get())
      .toMatchObject({
        anchor: { path: [2, 0] },
        focus: { path: [2, 0] },
      })

    await outer.selection.collapse({ path: [2, 0], offset: 0 })
    await focusRoot(outerEditor)
    await outer.press('ArrowUp')

    await expect(firstEditor).toBeFocused()
    await expect.poll(() => first.selection.get()).not.toBe(null)
  })

  test('projects Shift+Arrow across synced roots without expanding the root-local Slate selection', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Desktop projected selection proof uses Chromium caret geometry'
    )

    await openExample(page, 'synced-blocks', {
      ready: { editor: 'visible' },
    })

    const outerEditor = page.locator('[data-slate-editor="true"]').first()
    const firstEditor = getSyncedEditorByRoot(page, SHARED_ROOT, 0)
    const secondEditor = getSyncedEditorByRoot(page, SHARED_ROOT, 1)
    const outer = createSlateBrowserEditorHarness(
      page,
      'synced-blocks-outer',
      outerEditor
    )
    const first = createSlateBrowserEditorHarness(
      page,
      'synced-blocks-first-copy',
      firstEditor
    )

    await outer.selection.collapse({ path: [0, 0], offset: 1 })
    await focusRoot(outerEditor)
    await outer.press('Shift+ArrowDown')

    await expect
      .poll(() => outer.selection.get())
      .toEqual({
        anchor: { path: [0, 0], offset: 1 },
        focus: { path: [0, 0], offset: 1 },
      })
    expect(await getNativeSelectionText(page)).not.toBe('\n')
    await expect
      .poll(() => getViewSelection(outerEditor))
      .toMatchObject({
        anchor: {
          point: { path: [0, 0], offset: 1 },
        },
        focus: {
          owner: {
            childRoot: SHARED_ROOT,
            ownerPath: [1],
            ownerRoot: 'main',
          },
          point: {
            path: [0, 0],
            root: SHARED_ROOT,
          },
        },
        segments: {
          backward: false,
        },
      })

    await outer.press('ArrowDown')

    await expect(firstEditor).toBeFocused()
    await expect.poll(() => getViewSelection(outerEditor)).toBe(null)

    await first.insertText('Projected ')
    await expect(firstEditor).toContainText('Projected ')
    await expect(secondEditor).toContainText('Projected ')

    await outer.selection.collapse({ path: [6, 0], offset: 0 })
    await focusRoot(outerEditor)
    await outer.press('Shift+ArrowUp')

    await expect
      .poll(() => outer.selection.get())
      .toEqual({
        anchor: { path: [6, 0], offset: 0 },
        focus: { path: [6, 0], offset: 0 },
      })
    expect(await getNativeSelectionText(page)).not.toBe('\n')
    await expect
      .poll(() => getViewSelection(outerEditor))
      .toMatchObject({
        anchor: {
          point: { path: [6, 0], offset: 0 },
        },
        focus: {
          owner: {
            childRoot: SHARED_ROOT,
            ownerPath: [5],
            ownerRoot: 'main',
          },
          point: {
            root: SHARED_ROOT,
          },
        },
        segments: {
          backward: true,
        },
      })
  })

  test('extends Shift+Arrow through synced blocks like sibling blocks', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Desktop projected selection proof uses Chromium caret geometry'
    )

    await openExample(page, 'synced-blocks', {
      ready: { editor: 'visible' },
    })

    const outerEditor = page.locator('[data-slate-editor="true"]').first()
    const outer = createSlateBrowserEditorHarness(
      page,
      'synced-blocks-outer',
      outerEditor
    )

    await outer.selection.collapse({ path: [0, 0], offset: 1 })
    await focusRoot(outerEditor)

    await outer.press('Shift+ArrowDown')
    await expect
      .poll(() => getViewSelection(outerEditor))
      .toMatchObject({
        anchor: { point: { path: [0, 0], offset: 1 } },
        focus: {
          owner: firstSharedOwner,
          point: { path: [0, 0], root: SHARED_ROOT },
        },
        segments: { backward: false },
      })
    await outer.press('Shift+ArrowDown')
    await expect
      .poll(() => getViewSelection(outerEditor))
      .toMatchObject({
        anchor: { point: { path: [0, 0], offset: 1 } },
        focus: {
          owner: firstSharedOwner,
          point: { path: [1, 0], root: SHARED_ROOT },
        },
        segments: { backward: false },
      })

    await outer.press('Shift+ArrowDown')
    await expect(outerEditor).toBeFocused()
    await expect
      .poll(() => getViewSelection(outerEditor))
      .toMatchObject({
        anchor: { point: { path: [0, 0], offset: 1 } },
        focus: { point: { path: [2, 0] } },
        segments: { backward: false },
      })

    await page.keyboard.press('ArrowDown')
    await expect.poll(() => getViewSelection(outerEditor)).toBe(null)

    await outer.selection.collapse({ path: [6, 0], offset: 0 })
    await focusRoot(outerEditor)
    await outer.press('Shift+ArrowUp')
    await expect
      .poll(() => getViewSelection(outerEditor))
      .toMatchObject({
        anchor: { point: { path: [6, 0], offset: 0 } },
        focus: {
          owner: {
            childRoot: SHARED_ROOT,
            ownerPath: [5],
            ownerRoot: 'main',
          },
          point: { root: SHARED_ROOT },
        },
        segments: { backward: true },
      })
  })

  test('mouse selection across synced blocks becomes the same visible-order selection as sibling blocks', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Desktop mouse selection proof uses Chromium pointer selection'
    )

    await openExample(page, 'synced-blocks', {
      ready: { editor: 'visible' },
    })

    const outerEditor = page.locator('[data-slate-editor="true"]').first()
    const firstEditor = getSyncedEditorByRoot(page, SHARED_ROOT, 0)

    await dragFromLocatorToLocator({
      from: outerEditor.getByText('p1', { exact: true }),
      page,
      to: firstEditor.getByText(SHARED_BODY_FIRST, { exact: true }),
    })

    await expect
      .poll(() => getViewSelection(outerEditor))
      .toMatchObject({
        anchor: {
          point: { path: [0, 0] },
        },
        focus: {
          owner: firstSharedOwner,
          point: { path: [0, 0], root: SHARED_ROOT },
        },
        segments: { backward: false },
      })
    await expect.poll(() => getNativeSelectionText(page)).not.toBe('\n')
    expect(await getNativeSelectionText(page)).not.toContain('Editing original')

    await setViewSelection(outerEditor, null)
    await dragFromLocatorToLocator({
      from: firstEditor.getByText(SHARED_BODY_SECOND, { exact: true }),
      page,
      to: outerEditor.getByText('Between synced copies.', { exact: true }),
    })

    await expect
      .poll(() => getViewSelection(outerEditor))
      .toMatchObject({
        anchor: {
          owner: firstSharedOwner,
          point: { path: [1, 0], root: SHARED_ROOT },
        },
        focus: {
          point: { path: [2, 0] },
        },
        segments: { backward: false },
      })
    await expect.poll(() => getNativeSelectionText(page)).not.toBe('\n')
    expect(await getNativeSelectionText(page)).not.toContain('Editing original')
  })

  test('extends Shift+ArrowLeft and Shift+ArrowRight through synced blocks like sibling text', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Desktop projected selection proof uses Chromium keyboard events'
    )

    await openExample(page, 'synced-blocks', {
      ready: { editor: 'visible' },
    })

    const outerEditor = page.locator('[data-slate-editor="true"]').first()
    const outer = createSlateBrowserEditorHarness(
      page,
      'synced-blocks-outer',
      outerEditor
    )

    await outer.selection.collapse({ path: [0, 0], offset: 'p1'.length })
    await focusRoot(outerEditor)
    await outer.press('Shift+ArrowRight')
    await expect
      .poll(() => getViewSelection(outerEditor))
      .toMatchObject({
        anchor: { point: { path: [0, 0], offset: 'p1'.length } },
        focus: {
          owner: firstSharedOwner,
          point: { path: [0, 0], root: SHARED_ROOT, offset: 0 },
        },
        segments: { backward: false },
      })

    await outer.press('Shift+ArrowRight')
    await expect
      .poll(() => getViewSelection(outerEditor))
      .toMatchObject({
        anchor: { point: { path: [0, 0], offset: 'p1'.length } },
        focus: {
          owner: firstSharedOwner,
          point: { path: [0, 0], root: SHARED_ROOT, offset: 1 },
        },
        segments: { backward: false },
      })

    await setViewSelection(outerEditor, null)
    await outer.selection.collapse({ path: [6, 0], offset: 0 })
    await focusRoot(outerEditor)
    await outer.press('Shift+ArrowLeft')
    await expect
      .poll(() => getViewSelection(outerEditor))
      .toMatchObject({
        anchor: { point: { path: [6, 0], offset: 0 } },
        focus: {
          owner: {
            childRoot: SHARED_ROOT,
            ownerPath: [5],
            ownerRoot: 'main',
          },
          point: {
            path: [1, 0],
            root: SHARED_ROOT,
            offset: SHARED_BODY_SECOND.length,
          },
        },
        segments: { backward: true },
      })

    await outer.press('Shift+ArrowLeft')
    await expect
      .poll(() => getViewSelection(outerEditor))
      .toMatchObject({
        anchor: { point: { path: [6, 0], offset: 0 } },
        focus: {
          owner: {
            childRoot: SHARED_ROOT,
            ownerPath: [5],
            ownerRoot: 'main',
          },
          point: {
            path: [1, 0],
            root: SHARED_ROOT,
            offset: SHARED_BODY_SECOND.length - 1,
          },
        },
        segments: { backward: true },
      })
  })

  test('keeps ordinary Shift+Arrow selection local inside normal paragraphs', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Desktop native selection proof uses Chromium keyboard events'
    )

    await openExample(page, 'synced-blocks', {
      ready: { editor: 'visible' },
    })

    const outerEditor = page.locator('[data-slate-editor="true"]').first()
    const outer = createSlateBrowserEditorHarness(
      page,
      'synced-blocks-outer',
      outerEditor
    )

    await outer.selection.collapse({ path: [0, 0], offset: 0 })
    await focusRoot(outerEditor)
    await outer.press('Shift+ArrowRight')

    await expect.poll(() => getViewSelection(outerEditor)).toBe(null)
    await expect
      .poll(() => outer.selection.get())
      .toEqual({
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 1 },
      })
    await expect.poll(() => getNativeSelectionText(page)).toBe('p')
  })

  test('extends word selection from the projected synced-block focus', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Desktop projected word-selection proof uses Chromium keyboard events'
    )

    await openExample(page, 'synced-blocks', {
      ready: { editor: 'visible' },
    })

    const outerEditor = page.locator('[data-slate-editor="true"]').first()
    const outer = createSlateBrowserEditorHarness(
      page,
      'synced-blocks-outer',
      outerEditor
    )

    await outer.selection.collapse({ path: [0, 0], offset: 'p1'.length })
    await focusRoot(outerEditor)
    await outer.press('Shift+ArrowRight')
    await expect
      .poll(() => getViewSelection(outerEditor))
      .toMatchObject({
        anchor: { point: { path: [0, 0], offset: 'p1'.length } },
        focus: {
          owner: firstSharedOwner,
          point: { path: [0, 0], root: SHARED_ROOT, offset: 0 },
        },
      })

    await outer.press('Control+Shift+ArrowRight')
    await expect
      .poll(() => getViewSelection(outerEditor))
      .toMatchObject({
        anchor: { point: { path: [0, 0], offset: 'p1'.length } },
        focus: {
          owner: firstSharedOwner,
          point: {
            path: [0, 0],
            root: SHARED_ROOT,
            offset: 'Shared'.length,
          },
        },
        segments: { backward: false },
      })
  })

  test('typing over a projected Shift+Arrow selection replaces text across the outer and synced roots', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Desktop projected input proof uses Chromium caret geometry'
    )

    await openExample(page, 'synced-blocks', {
      ready: { editor: 'visible' },
    })

    const outerEditor = page.locator('[data-slate-editor="true"]').first()
    const firstEditor = getSyncedEditorByRoot(page, SHARED_ROOT, 0)
    const secondEditor = getSyncedEditorByRoot(page, SHARED_ROOT, 1)
    const outer = createSlateBrowserEditorHarness(
      page,
      'synced-blocks-outer',
      outerEditor
    )

    await outer.selection.collapse({ path: [0, 0], offset: 1 })
    await focusRoot(outerEditor)
    await setViewSelection(outerEditor, {
      anchor: { point: { path: [0, 0], offset: 1 } },
      focus: {
        owner: firstSharedOwner,
        point: { path: [0, 0], root: SHARED_ROOT, offset: 2 },
      },
      graph: firstSharedProjectionGraph,
    })
    await expect.poll(() => getViewSelection(outerEditor)).not.toBe(null)

    await page.keyboard.type('X')

    const syncedRemainder = SHARED_BODY_FIRST.slice(2)

    await expect(page.getByText('pX')).toBeVisible()
    await expect(firstEditor).toContainText(syncedRemainder)
    await expect(firstEditor).not.toContainText(SHARED_BODY_FIRST)
    await expect(secondEditor).toContainText(syncedRemainder)
    await expect.poll(() => getViewSelection(outerEditor)).toBe(null)
    await expect
      .poll(() => outer.selection.get())
      .toEqual({
        anchor: { path: [0, 0], offset: 2 },
        focus: { path: [0, 0], offset: 2 },
      })

    await outer.undo()

    await expect(page.getByText('p1')).toBeVisible()
    await expect(firstEditor).toContainText(SHARED_BODY_FIRST)
    await expect(secondEditor).toContainText(SHARED_BODY_FIRST)
    await expect
      .poll(() => getViewSelection(outerEditor))
      .toMatchObject({
        focus: {
          owner: firstSharedOwner,
          point: { path: [0, 0], root: SHARED_ROOT, offset: 2 },
        },
      })

    await outer.redo()

    await expect(page.getByText('pX')).toBeVisible()
    await expect(firstEditor).toContainText(syncedRemainder)
    await expect(secondEditor).toContainText(syncedRemainder)
    await expect.poll(() => getViewSelection(outerEditor)).toBe(null)
  })

  test('Backspace over a projected Shift+Arrow selection removes text across the outer and synced roots', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Desktop projected input proof uses Chromium caret geometry'
    )

    await openExample(page, 'synced-blocks', {
      ready: { editor: 'visible' },
    })

    const outerEditor = page.locator('[data-slate-editor="true"]').first()
    const firstEditor = getSyncedEditorByRoot(page, SHARED_ROOT, 0)
    const secondEditor = getSyncedEditorByRoot(page, SHARED_ROOT, 1)
    const outer = createSlateBrowserEditorHarness(
      page,
      'synced-blocks-outer',
      outerEditor
    )

    await outer.selection.collapse({ path: [0, 0], offset: 1 })
    await focusRoot(outerEditor)
    await setViewSelection(outerEditor, {
      anchor: { point: { path: [0, 0], offset: 1 } },
      focus: {
        owner: firstSharedOwner,
        point: { path: [0, 0], root: SHARED_ROOT, offset: 2 },
      },
      graph: firstSharedProjectionGraph,
    })
    await expect.poll(() => getViewSelection(outerEditor)).not.toBe(null)

    await page.keyboard.press('Backspace')

    const syncedRemainder = SHARED_BODY_FIRST.slice(2)

    await expect(outerEditor.getByText('p', { exact: true })).toBeVisible()
    await expect(firstEditor).toContainText(syncedRemainder)
    await expect(firstEditor).not.toContainText(SHARED_BODY_FIRST)
    await expect(secondEditor).toContainText(syncedRemainder)
    await expect.poll(() => getViewSelection(outerEditor)).toBe(null)
    await expect
      .poll(() => outer.selection.get())
      .toEqual({
        anchor: { path: [0, 0], offset: 1 },
        focus: { path: [0, 0], offset: 1 },
      })
  })

  test('copies a projected selection from visible order instead of root-local DOM selection', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Chromium synthetic clipboard payload proof'
    )

    await openExample(page, 'synced-blocks', {
      ready: { editor: 'visible' },
    })

    const outerEditor = page.locator('[data-slate-editor="true"]').first()
    const outer = createSlateBrowserEditorHarness(
      page,
      'synced-blocks-outer',
      outerEditor
    )

    await outer.selection.collapse({ path: [0, 0], offset: 1 })
    await focusRoot(outerEditor)
    await setViewSelection(outerEditor, {
      anchor: { point: { path: [0, 0], offset: 1 } },
      focus: {
        owner: firstSharedOwner,
        point: { path: [0, 0], root: SHARED_ROOT, offset: 2 },
      },
      graph: firstSharedProjectionGraph,
    })

    const payload = await outer.clipboard.copyEventPayload()

    expect(payload.types).toEqual(
      expect.arrayContaining([
        'application/x-slate-fragment',
        'text/html',
        'text/plain',
      ])
    )
    expect(payload.text).toBe('1\nSh')
    expect(payload.html).toContain('data-slate-fragment=')
  })

  test('classifies projected selection native affordances without claiming native parity', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Chromium matrix smoke keeps the browser handle honest'
    )

    await openExample(page, 'synced-blocks', {
      ready: { editor: 'visible' },
    })

    const outerEditor = page.locator('[data-slate-editor="true"]').first()
    const outer = createSlateBrowserEditorHarness(
      page,
      'synced-blocks-outer',
      outerEditor
    )

    await outer.selection.collapse({ path: [0, 0], offset: 1 })
    await focusRoot(outerEditor)
    await setViewSelection(outerEditor, {
      anchor: { point: { path: [0, 0], offset: 1 } },
      focus: {
        owner: firstSharedOwner,
        point: { path: [0, 0], root: SHARED_ROOT, offset: 2 },
      },
      graph: firstSharedProjectionGraph,
    })

    const nativeSelectionText = await getNativeSelectionText(page)
    const matrix = await getProjectedNativeAffordanceMatrix(outerEditor)

    expect(nativeSelectionText).not.toBe('1\nSh')
    expect(matrix).toMatchObject({
      clipboard: { status: 'supported' },
      find: { status: 'degraded' },
      ime: { status: 'degraded' },
      mobileSelection: { status: 'unsupported' },
      screenReader: { status: 'degraded' },
      spellcheck: { status: 'degraded' },
    })
  })

  test('moves ArrowLeft and ArrowRight through the active repeated synced copy', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Desktop boundary proof uses keyboard focus and caret geometry'
    )

    await openExample(page, 'synced-blocks', {
      ready: { editor: 'visible' },
    })

    const outerEditor = page.locator('[data-slate-editor="true"]').first()
    const secondEditor = getSyncedEditorByRoot(page, SHARED_ROOT, 1)
    const outer = createSlateBrowserEditorHarness(
      page,
      'synced-blocks-outer',
      outerEditor
    )
    const second = createSlateBrowserEditorHarness(
      page,
      'synced-blocks-second-copy',
      secondEditor
    )

    await outer.selection.collapse({
      path: [4, 0],
      offset: 'Between synced documents.'.length,
    })
    await focusRoot(outerEditor)
    await outer.press('ArrowRight')

    await expect(secondEditor).toBeFocused()
    await expect
      .poll(() => second.selection.get())
      .toEqual({
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 0 },
      })

    await second.selection.collapse({
      path: [1, 0],
      offset: SHARED_BODY_SECOND.length,
    })
    await focusRoot(secondEditor)
    await second.press('ArrowRight')

    await expect(outerEditor).toBeFocused()
    await expect
      .poll(() => outer.selection.get())
      .toEqual({
        anchor: { path: [6, 0], offset: 0 },
        focus: { path: [6, 0], offset: 0 },
      })

    await outer.selection.collapse({ path: [6, 0], offset: 0 })
    await focusRoot(outerEditor)
    await outer.press('ArrowLeft')

    await expect(secondEditor).toBeFocused()
    await expect
      .poll(() => second.selection.get())
      .toEqual({
        anchor: { path: [1, 0], offset: SHARED_BODY_SECOND.length },
        focus: { path: [1, 0], offset: SHARED_BODY_SECOND.length },
      })

    await second.selection.collapse({ path: [0, 0], offset: 0 })
    await focusRoot(secondEditor)
    await second.press('ArrowLeft')

    await expect(outerEditor).toBeFocused()
    await expect
      .poll(() => outer.selection.get())
      .toEqual({
        anchor: {
          path: [4, 0],
          offset: 'Between synced documents.'.length,
        },
        focus: {
          path: [4, 0],
          offset: 'Between synced documents.'.length,
        },
      })
  })

  test('Cmd+Arrow jumps between the active synced copy and document boundaries', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Desktop command-arrow proof uses Chromium keyboard events'
    )

    await openExample(page, 'synced-blocks', {
      ready: { editor: 'visible' },
    })

    const outerEditor = page.locator('[data-slate-editor="true"]').first()
    const secondEditor = getSyncedEditorByRoot(page, SHARED_ROOT, 1)
    const outer = createSlateBrowserEditorHarness(
      page,
      'synced-blocks-outer',
      outerEditor
    )
    const second = createSlateBrowserEditorHarness(
      page,
      'synced-blocks-second-copy',
      secondEditor
    )

    await second.selection.collapse({ path: [0, 0], offset: 0 })
    await focusRoot(secondEditor)
    await second.press('Meta+ArrowDown')

    await expect(outerEditor).toBeFocused()
    await expect
      .poll(() => outer.selection.get())
      .toEqual({
        anchor: { path: [6, 0], offset: 'p2'.length },
        focus: { path: [6, 0], offset: 'p2'.length },
      })

    await outer.press('Meta+ArrowUp')

    await expect(outerEditor).toBeFocused()
    await expect
      .poll(() => outer.selection.get())
      .toEqual({
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 0 },
      })
  })

  test('Cmd+Shift+Arrow extends selection between synced copies and document boundaries', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Desktop command-shift-arrow proof uses Chromium keyboard events'
    )

    await openExample(page, 'synced-blocks', {
      ready: { editor: 'visible' },
    })

    const outerEditor = page.locator('[data-slate-editor="true"]').first()
    const secondEditor = getSyncedEditorByRoot(page, SHARED_ROOT, 1)
    const outer = createSlateBrowserEditorHarness(
      page,
      'synced-blocks-outer',
      outerEditor
    )
    const second = createSlateBrowserEditorHarness(
      page,
      'synced-blocks-second-copy',
      secondEditor
    )

    await outer.selection.collapse({ path: [0, 0], offset: 1 })
    await focusRoot(outerEditor)
    await outer.press('Meta+Shift+ArrowDown')
    await expect
      .poll(() => getViewSelection(outerEditor))
      .toMatchObject({
        anchor: { point: { path: [0, 0], offset: 1 } },
        focus: { point: { path: [6, 0], offset: 'p2'.length } },
        segments: { backward: false },
      })

    await setViewSelection(outerEditor, null)
    await second.selection.collapse({ path: [0, 0], offset: 1 })
    await focusRoot(secondEditor)
    await second.press('Meta+Shift+ArrowUp')
    await expect
      .poll(() => getViewSelection(outerEditor))
      .toMatchObject({
        anchor: {
          owner: {
            childRoot: SHARED_ROOT,
            ownerPath: [5],
            ownerRoot: 'main',
          },
          point: { path: [0, 0], root: SHARED_ROOT, offset: 1 },
        },
        focus: { point: { path: [0, 0], offset: 0 } },
        segments: { backward: true },
      })
  })

  test('clicking outside a synced block moves focus back to the outer editor', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Desktop click-outside proof uses real mouse clicks'
    )

    await openExample(page, 'synced-blocks', {
      ready: { editor: 'visible' },
    })

    const outerEditor = page.locator('[data-slate-editor="true"]').first()
    const firstEditor = getSyncedEditor(page, 0)
    const first = createSlateBrowserEditorHarness(
      page,
      'synced-blocks-first-copy',
      firstEditor
    )

    await first.selection.collapse({ path: [0, 0], offset: 0 })
    await firstEditor.evaluate((element: HTMLElement) => {
      element.focus()
    })
    await expect(firstEditor).toBeFocused()

    await page.getByText('p2').click()

    await expect(outerEditor).toBeFocused()
    await expect(firstEditor).not.toBeFocused()
  })

  test('duplicate shares the root and unsync clones one copy', async ({
    page,
  }) => {
    await openExample(page, 'synced-blocks', {
      ready: { editor: 'visible' },
    })

    await page
      .getByRole('button', { name: 'Duplicate synced block' })
      .first()
      .click()
    await expect(page.locator('[data-slate-synced-block]')).toHaveCount(4)
    await expect(
      page.locator(`[data-slate-synced-root="${SHARED_ROOT}"]`)
    ).toHaveCount(3)

    const firstEditor = getSyncedEditor(page, 0)
    const duplicatedEditor = getSyncedEditor(page, 1)
    const first = createSlateBrowserEditorHarness(
      page,
      'synced-blocks-first-copy',
      firstEditor
    )

    await first.selection.collapse({ path: [0, 0], offset: 0 })
    await first.insertText('Shared ')
    await expect(duplicatedEditor).toContainText(
      'Shared Shared mission statement'
    )

    await page
      .getByRole('button', { name: 'Unsync synced block' })
      .nth(1)
      .click()

    await first.selection.collapse({ path: [0, 0], offset: 0 })
    await first.insertText('Live ')

    await expect(firstEditor).toContainText(
      'Live Shared Shared mission statement'
    )
    await expect(duplicatedEditor).toContainText(
      'Shared Shared mission statement'
    )
    await expect(duplicatedEditor).not.toContainText(
      'Live Shared Shared mission statement'
    )
  })
})
