const environmentUrl = new URL('../src/utils/environment.ts', import.meta.url)
  .href

const getEnvironmentSupport = async (userAgent: string) => {
  const child = Bun.spawn({
    cmd: [
      process.execPath,
      '--eval',
      `
delete globalThis.navigator
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { userAgent: ${JSON.stringify(userAgent)} },
})
Object.defineProperty(globalThis, 'InputEvent', {
  configurable: true,
  value: class InputEvent {
    getTargetRanges() {
      return []
    }
  },
})

const env = await import(${JSON.stringify(environmentUrl)})
console.log(JSON.stringify({
  hasBeforeInputSupport: Boolean(env.HAS_BEFORE_INPUT_SUPPORT),
  isAndroidChromeLegacy: Boolean(env.IS_ANDROID_CHROME_LEGACY),
  isChromeLegacy: Boolean(env.IS_CHROME_LEGACY),
}))
      `,
    ],
    stderr: 'pipe',
    stdout: 'pipe',
  })

  const [exitCode, stderr, stdout] = await Promise.all([
    child.exited,
    child.stderr.text(),
    child.stdout.text(),
  ])

  expect(stderr).toBe('')
  expect(exitCode).toBe(0)

  return JSON.parse(stdout) as {
    hasBeforeInputSupport: boolean
    isAndroidChromeLegacy: boolean
    isChromeLegacy: boolean
  }
}

describe('slate-dom environment', () => {
  test('disables beforeinput support for desktop Chrome 75', async () => {
    const environment = await getEnvironmentSupport(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/75.0.3770.100 Safari/537.36'
    )

    expect(environment.isChromeLegacy).toBe(true)
    expect(environment.isAndroidChromeLegacy).toBe(false)
    expect(environment.hasBeforeInputSupport).toBe(false)
  })

  test('disables beforeinput support for Android Chrome legacy', async () => {
    const environment = await getEnvironmentSupport(
      'Mozilla/5.0 (Linux; Android 8.0.0; Pixel Build/OPR6.170623.012) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/59.0.3071.125 Mobile Safari/537.36'
    )

    expect(environment.isChromeLegacy).toBe(true)
    expect(environment.isAndroidChromeLegacy).toBe(true)
    expect(environment.hasBeforeInputSupport).toBe(false)
  })

  test('keeps beforeinput support for modern Chrome', async () => {
    const environment = await getEnvironmentSupport(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    )

    expect(environment.isChromeLegacy).toBe(false)
    expect(environment.isAndroidChromeLegacy).toBe(false)
    expect(environment.hasBeforeInputSupport).toBe(true)
  })
})
