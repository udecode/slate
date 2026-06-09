import type { Frame, Page } from '@playwright/test'

type CompositionSurface = Page | Frame

export const enableCompositionKeyEvents = async (
  surface: CompositionSurface
) => {
  await surface.evaluate(() => {
    const target = window as Window & {
      __SLATE_BROWSER_COMPOSITION_KEY_EVENTS__?: boolean
    }

    if (target.__SLATE_BROWSER_COMPOSITION_KEY_EVENTS__) {
      return
    }

    target.__SLATE_BROWSER_COMPOSITION_KEY_EVENTS__ = true

    window.addEventListener(
      'compositionstart',
      () => {
        document.activeElement?.dispatchEvent(
          new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'Unidentified',
            keyCode: 220,
          })
        )
      },
      true
    )
  })
}

export const composeText = async (
  page: Page,
  surface: CompositionSurface,
  steps: readonly string[],
  committedText: string,
  {
    transport = 'native',
  }: {
    transport?: 'native' | 'synthetic'
  } = {}
) => {
  const browserName = page.context().browser()?.browserType().name()

  if (browserName !== 'chromium' || transport === 'synthetic') {
    await surface.evaluate(
      ({ composedSteps, finalText }) => {
        const active = document.activeElement as HTMLElement | null
        const selection = document.getSelection()

        if (!active || !selection || selection.rangeCount === 0) {
          throw new Error('Missing active editable selection for composition')
        }

        const range = selection.getRangeAt(0).cloneRange()
        const dispatchCompositionEvent = (
          type: 'compositionstart' | 'compositionupdate' | 'compositionend',
          data: string
        ) => {
          active.dispatchEvent(
            new CompositionEvent(type, {
              bubbles: true,
              cancelable: true,
              data,
            })
          )
        }
        const createInputEvent = (
          type: 'beforeinput' | 'input',
          inputType: string,
          data: string
        ) => {
          if (typeof InputEvent === 'function') {
            return new InputEvent(type, {
              bubbles: true,
              cancelable: type === 'beforeinput',
              data,
              inputType,
            })
          }

          const event = new Event(type, {
            bubbles: true,
            cancelable: type === 'beforeinput',
          }) as InputEvent
          Object.defineProperties(event, {
            data: { value: data },
            inputType: { value: inputType },
          })

          return event
        }
        const dispatchInputEvent = (
          type: 'beforeinput' | 'input',
          inputType: string,
          data: string
        ) => {
          const event = createInputEvent(type, inputType, data)
          active.dispatchEvent(event)

          return event
        }

        dispatchCompositionEvent('compositionstart', composedSteps[0] ?? '')

        composedSteps.forEach((text) => {
          dispatchCompositionEvent('compositionupdate', text)
        })

        const beforeInputEvent = dispatchInputEvent(
          'beforeinput',
          'insertFromComposition',
          finalText
        )

        if (!beforeInputEvent.defaultPrevented) {
          range.deleteContents()

          const textNode = document.createTextNode(finalText)

          range.insertNode(textNode)
          range.setStart(textNode, finalText.length)
          range.setEnd(textNode, finalText.length)
          selection.removeAllRanges()
          selection.addRange(range)

          dispatchInputEvent('input', 'insertFromComposition', finalText)
        }

        dispatchCompositionEvent('compositionend', finalText)
      },
      { composedSteps: steps, finalText: committedText }
    )

    return
  }

  const client = await page.context().newCDPSession(page)

  for (const text of steps) {
    await client.send('Input.imeSetComposition', {
      selectionStart: text.length,
      selectionEnd: text.length,
      text,
    })
  }

  await client.send('Input.insertText', {
    text: committedText,
  })
}

export const composeTextDirect = async (page: Page, committedText: string) => {
  await page.keyboard.insertText(committedText)
}
