import {
  type CreateEditorOptions,
  createEditor,
  defineEditorExtension,
  type Editor,
  type EditorExtensionSetupContext,
  type Value,
} from 'slate'
import type { DOMApi, DOMEditorOptions } from 'slate-dom'
import { EDITOR_TO_PENDING_SELECTION, installDOM } from 'slate-dom/internal'
import { history } from 'slate-history'
import {
  getEditorTransformRegistry,
  setEditorTransformRegistry,
} from '../editable/runtime-editor-api'

const ANDROID_USER_AGENT_RE = /Android/

export interface ReactEditorOptions extends DOMEditorOptions {}

export type ReactApi = {
  isComposing: () => boolean
  isFocused: () => boolean
  isReadOnly: () => boolean
}

type ReactExtension = ReturnType<typeof react>
const historyExtension = history()
type HistoryExtension = typeof historyExtension
type ReactDefaultExtensions<TExtensions extends readonly unknown[]> = readonly [
  ReactExtension,
  HistoryExtension,
  ...TExtensions,
]
export type ReactEditor<
  V extends Value = Value,
  TExtensions extends readonly unknown[] = readonly [],
> = Editor<V, ReactDefaultExtensions<TExtensions>>

export type ReactEditorContextValue<V extends Value = Value> = Omit<
  Editor<V, readonly [ReactExtension]>,
  'api' | 'getApi'
> & {
  api: Editor<V, readonly [ReactExtension]>['api']
  getApi: Editor<V, readonly [ReactExtension]>['getApi']
}

export type CreateReactEditorOptions<
  V extends Value = Value,
  TExtensions extends readonly unknown[] = readonly [],
> = CreateEditorOptions<V, TExtensions> & ReactEditorOptions

const installReactTransforms = (editor: Editor) => {
  const transforms = getEditorTransformRegistry(editor)

  if (
    typeof navigator !== 'undefined' &&
    ANDROID_USER_AGENT_RE.test(navigator.userAgent)
  ) {
    setEditorTransformRegistry(editor, {
      ...transforms,
      insertText: (text, options) => {
        // COMPAT: Android devices can apply pending selection after insertText.
        EDITOR_TO_PENDING_SELECTION.delete(editor)

        return transforms.insertText(text, options)
      },
    })
  }
}

const createReactApi = (domApi: DOMApi): ReactApi =>
  Object.freeze({
    isComposing: () => domApi.isComposing(),
    isFocused: () => domApi.isFocused(),
    isReadOnly: () => domApi.isReadOnly(),
  })

/**
 * Installs the DOM bridge and exposes React focus, read-only, and composition
 * APIs through the editor extension system.
 */
export const react = (options: ReactEditorOptions = {}) =>
  defineEditorExtension({
    conflicts: ['dom'],
    name: 'react',
    setup(context: EditorExtensionSetupContext<Editor>) {
      const editor = installDOM(context.editor, options)
      const { clipboard, ...domApi } = editor.dom

      Reflect.deleteProperty(editor, 'dom')
      installReactTransforms(editor)

      const frozenDOMApi = Object.freeze(domApi) as DOMApi

      return {
        api: {
          clipboard,
          dom: frozenDOMApi,
          react: createReactApi(frozenDOMApi),
        },
      }
    },
  })

export function createReactEditor<
  V extends Value = Value,
  const TExtensions extends readonly unknown[] = readonly [],
>(
  options?: CreateReactEditorOptions<V, TExtensions>
): ReactEditor<V, TExtensions>

/**
 * Creates a React editor with the React bridge and history extension installed
 * before any custom extensions.
 */
export function createReactEditor<
  V extends Value = Value,
  const TExtensions extends readonly unknown[] = readonly [],
>(
  options: CreateReactEditorOptions<V, TExtensions> = {}
): ReactEditor<V, TExtensions> {
  const { clipboardFormatKey, extensions, ...editorOptions } = options
  const reactOptions = { clipboardFormatKey }
  const editorExtensions = [
    react(reactOptions),
    history(),
    ...((extensions ?? []) as TExtensions),
  ] as const

  return createEditor({
    ...editorOptions,
    extensions: editorExtensions,
  }) as ReactEditor<V, TExtensions>
}
