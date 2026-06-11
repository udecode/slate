import { describe, expect, test } from 'bun:test'

import { attachPageScreenshot } from '../../src/playwright'

describe('playwright attachments', () => {
  test('attaches screenshots through the Playwright test output path', async () => {
    const screenshotCalls: unknown[] = []
    const attachCalls: unknown[] = []
    const page = {
      screenshot: async (options: unknown) => {
        screenshotCalls.push(options)
      },
    } as Parameters<typeof attachPageScreenshot>[0]
    const testInfo = {
      attach: async (name: string, options: unknown) => {
        attachCalls.push({ name, options })
      },
      outputPath: (name: string) => `/tmp/${name}`,
    } as Parameters<typeof attachPageScreenshot>[1]

    const path = await attachPageScreenshot(page, testInfo, 'proof.png', {
      fullPage: true,
    })

    expect(path).toBe('/tmp/proof.png')
    expect(screenshotCalls).toEqual([
      { fullPage: true, path: '/tmp/proof.png' },
    ])
    expect(attachCalls).toEqual([
      {
        name: 'proof.png',
        options: { contentType: 'image/png', path: '/tmp/proof.png' },
      },
    ])
  })

  test('matches jpeg attachment content type to screenshot options', async () => {
    const attachCalls: unknown[] = []
    const page = {
      screenshot: async () => {},
    } as Parameters<typeof attachPageScreenshot>[0]
    const testInfo = {
      attach: async (name: string, options: unknown) => {
        attachCalls.push({ name, options })
      },
      outputPath: (name: string) => `/tmp/${name}`,
    } as Parameters<typeof attachPageScreenshot>[1]

    await attachPageScreenshot(page, testInfo, 'proof.jpg', { type: 'jpeg' })

    expect(attachCalls).toEqual([
      {
        name: 'proof.jpg',
        options: { contentType: 'image/jpeg', path: '/tmp/proof.jpg' },
      },
    ])
  })
})
