import {
  type CreateEditorOptions,
  createEditor,
  defineEditorExtension,
  type Editor,
  type EditorExtensionRegistrationContext,
  type Value,
} from 'slate'
import {
  type DOMApi,
  type DOMEditorOptions,
  EDITOR_TO_PENDING_SELECTION,
} from 'slate-dom'
import { installDOM } from 'slate-dom/internal'
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
const defaultHistoryExtension = history()
type HistoryExtension = typeof defaultHistoryExtension
type ReactDefaultExtensions<TExtensions extends readonly unknown[]> = readonly [
  ReactExtension,
  HistoryExtension,
  ...TExtensions,
]
export type ReactEditorInstance<
  V extends Value = Value,
  TExtensions extends readonly unknown[] = readonly [],
> = Omit<Editor<V, ReactDefaultExtensions<TExtensions>>, 'api' | 'getApi'> & {
  api: Editor<V, ReactDefaultExtensions<TExtensions>>['api']
  getApi: Editor<V, ReactDefaultExtensions<TExtensions>>['getApi']
}

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

export const react = (options: ReactEditorOptions = {}) =>
  defineEditorExtension({
    conflicts: ['dom'],
    name: 'react',
    register(context: EditorExtensionRegistrationContext<Editor>) {
      const editor = installDOM(context.editor, options)
      const { clipboard, ...domApi } = editor.dom

      Reflect.deleteProperty(editor, 'dom')
      installReactTransforms(editor)

      const frozenDOMApi = Object.freeze(domApi) as DOMApi

      return {
        capabilities: {
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
): ReactEditorInstance<V, TExtensions>

export function createReactEditor<
  V extends Value = Value,
  const TExtensions extends readonly unknown[] = readonly [],
>(
  options: CreateReactEditorOptions<V, TExtensions> = {}
): ReactEditorInstance<V, TExtensions> {
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
  }) as ReactEditorInstance<V, TExtensions>
}
