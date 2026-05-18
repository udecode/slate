import { createEditor, defineEditorExtension } from 'slate'
import { describe, expect, it } from 'vitest'

import { shouldFlushStoredTextDiffForTransformMiddleware } from '../src/hooks/android-input-manager/android-input-manager'

describe('Android input manager transform middleware flush policy', () => {
  it('flushes stored text diffs when insertText transform middleware is registered', () => {
    const editor = createEditor({
      extensions: [
        defineEditorExtension({
          name: 'insert-text-transform',
          transforms: {
            insertText({ next }) {
              next()
            },
          },
        }),
      ],
    })

    expect(
      shouldFlushStoredTextDiffForTransformMiddleware(editor as never, {
        start: 0,
        end: 0,
        text: ' ',
      })
    ).toBe(true)
  })

  it('keeps plain editors on the deferred pending-diff path', () => {
    const editor = createEditor()

    expect(
      shouldFlushStoredTextDiffForTransformMiddleware(editor as never, {
        start: 0,
        end: 0,
        text: ' ',
      })
    ).toBe(false)
  })

  it('does not fast-flush delete diffs through insertText middleware', () => {
    const editor = createEditor({
      extensions: [
        defineEditorExtension({
          name: 'insert-text-transform',
          transforms: {
            insertText({ next }) {
              next()
            },
          },
        }),
      ],
    })

    expect(
      shouldFlushStoredTextDiffForTransformMiddleware(editor as never, {
        start: 0,
        end: 1,
        text: '',
      })
    ).toBe(false)
  })

  it('does not treat unrelated transform middleware as insertText policy', () => {
    const editor = createEditor({
      extensions: [
        defineEditorExtension({
          name: 'insert-break-transform',
          transforms: {
            insertBreak({ next }) {
              next()
            },
          },
        }),
      ],
    })

    expect(
      shouldFlushStoredTextDiffForTransformMiddleware(editor as never, {
        start: 0,
        end: 0,
        text: ' ',
      })
    ).toBe(false)
  })
})
