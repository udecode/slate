import { defineEditorExtension } from 'slate'

import { YjsController } from './controller'
import type { YjsExtensionOptions } from './types'

export const createYjsExtension = (options: YjsExtensionOptions = {}) =>
  defineEditorExtension({
    name: 'yjs',
    setup(context) {
      const controller = new YjsController(context.editor, options)

      controller.seed()

      return {
        cleanup() {
          controller.destroy()
        },
        onCommit({ commit, snapshot }) {
          controller.handleCommit(commit, snapshot)
        },
        state: {
          yjs: () => controller.state(),
        },
        tx: {
          yjs: () => controller.tx(),
        },
      }
    },
  })
