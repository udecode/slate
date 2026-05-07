import {
  createEditor,
  type Operation,
  type SnapshotChange,
  type Value,
  type ValueOf,
} from 'slate'
import { type HistoryEditor, withHistory } from 'slate-history'
import {
  type EditorSelectorOptions,
  type ReactEditor,
  useEditorSelector,
  useSlateEditor,
  withReact,
} from 'slate-react'

type CustomText = {
  text: string
  bold?: true
}

type ParagraphElement = {
  type: 'paragraph'
  children: CustomText[]
}

type LinkElement = {
  type: 'link'
  url: string
  children: CustomText[]
}

type CustomValue = (ParagraphElement | LinkElement)[]

type FooEditor<V> = {
  fooValue(): V
}

type OptionalDecorationEditor<V extends Value> = ReactEditor<V> &
  HistoryEditor<V> & {
    nodeToDecorations?: Map<object, unknown[]>
  }

const withFoo = <T extends ReactEditor<any>>(
  editor: T
): T & FooEditor<ValueOf<T>> => editor as T & FooEditor<ValueOf<T>>

const baseEditor = createEditor<CustomValue>()
const editor = withReact(baseEditor)
const historyReactEditor = withHistory(withReact(createEditor<CustomValue>()))
const reactEditor: ReactEditor<CustomValue> = editor
const typedHistoryReactEditor: ReactEditor<CustomValue> &
  HistoryEditor<CustomValue> = historyReactEditor
const initialValue: CustomValue = [
  { type: 'paragraph', children: [{ text: 'initial', bold: true }] },
]

const baseValue: ValueOf<typeof baseEditor> = [
  { type: 'paragraph', children: [{ text: 'one', bold: true }] },
]

editor.extend({
  elements: [{ inline: true, type: 'link' }],
  name: 'generic-react-editor-contract',
})

type _Value = ValueOf<typeof reactEditor>

const value: _Value = [
  { type: 'paragraph', children: [{ text: 'one', bold: true }] },
]

const selectorOptions: EditorSelectorOptions<typeof reactEditor> = {
  shouldUpdate: (operations, change) => {
    const typedOperations: readonly Operation<CustomValue>[] | undefined =
      operations
    const typedChange: SnapshotChange<CustomValue> | undefined = change

    void typedOperations
    void typedChange

    return true
  },
}

const SelectorProbe = () => {
  const selected = useEditorSelector<number, typeof reactEditor>(
    (selectedEditor, operations) => {
      const valueFromSelector: CustomValue = selectedEditor.read((state) =>
        state.value.get()
      )
      const typedOperations: readonly Operation<CustomValue>[] | undefined =
        operations

      void valueFromSelector
      void typedOperations

      return valueFromSelector.length
    },
    undefined,
    selectorOptions
  )

  void selected

  return null
}

const HookProbe = () => {
  const hookEditor = useSlateEditor({
    initialValue,
    withEditor: withHistory,
  })
  const typedHookEditor: ReactEditor<CustomValue> & HistoryEditor<CustomValue> =
    hookEditor
  const optionalDecorationEditor: OptionalDecorationEditor<CustomValue> =
    hookEditor
  const valueFromHook: CustomValue = hookEditor.read((state) =>
    state.value.get()
  )
  const composedHookEditor = useSlateEditor({
    initialValue,
    withEditor: (editor) => withFoo(withHistory(editor)),
  })
  const typedComposedHookEditor: ReactEditor<CustomValue> &
    HistoryEditor<CustomValue> &
    FooEditor<CustomValue> = composedHookEditor

  typedHookEditor.undo()
  optionalDecorationEditor.undo()
  typedComposedHookEditor.undo()

  void valueFromHook

  return null
}

void value
void baseValue
void typedHistoryReactEditor
void SelectorProbe
void HookProbe
