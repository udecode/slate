import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Frame, Page } from '@playwright/test'

import {
  composeText,
  enableCompositionKeyEvents,
} from '../../src/playwright/ime'

const createPage = () =>
  ({
    context: () => ({
      browser: () => ({
        browserType: () => ({
          name: () => 'chromium',
        }),
      }),
      newCDPSession: async () => {
        throw new Error('CDP should not be used for synthetic composition')
      },
    }),
    evaluate: async () => {
      throw new Error('Synthetic composition evaluated in the top-level page')
    },
  }) as unknown as Page

const createSurface = () =>
  ({
    evaluate: async <Result, Arg>(callback: (arg: Arg) => Result, arg: Arg) =>
      callback(arg),
  }) as unknown as Frame

describe('playwright IME helpers', () => {
  beforeAll(() => {
    if (!GlobalRegistrator.isRegistered) {
      GlobalRegistrator.register()
    }
  })

  afterAll(async () => {
    if (GlobalRegistrator.isRegistered) {
      await GlobalRegistrator.unregister()
    }
  })

  test('runs synthetic composition against the resolved editor surface', async () => {
    document.body.innerHTML = '<div contenteditable="true">hello</div>'

    const active = document.querySelector('div')!
    const text = active.firstChild as Text
    const range = document.createRange()
    const selection = window.getSelection()!
    const events: string[] = []

    active.addEventListener('compositionstart', (event) => {
      events.push(event.type)
    })
    active.addEventListener('compositionupdate', (event) => {
      events.push(event.type)
    })
    active.addEventListener('compositionend', (event) => {
      events.push(event.type)
    })

    active.focus()
    range.setStart(text, 1)
    range.setEnd(text, 4)
    selection.removeAllRanges()
    selection.addRange(range)

    await composeText(createPage(), createSurface(), ['é'], 'é', {
      transport: 'synthetic',
    })

    expect(active.textContent).toBe('héo')
    expect(events).toEqual([
      'compositionstart',
      'compositionupdate',
      'compositionend',
    ])
  })

  test('installs composition key events once on the resolved editor surface', async () => {
    document.body.innerHTML = '<div contenteditable="true">hello</div>'

    const active = document.querySelector('div')!
    const keydownEvents: string[] = []

    active.addEventListener('keydown', (event) => {
      keydownEvents.push(`${event.key}:${event.keyCode}`)
    })
    active.focus()

    await enableCompositionKeyEvents(createSurface())
    await enableCompositionKeyEvents(createSurface())
    window.dispatchEvent(
      new CompositionEvent('compositionstart', {
        bubbles: true,
        data: 'é',
      })
    )

    expect(keydownEvents).toEqual(['Unidentified:220'])
  })
})
