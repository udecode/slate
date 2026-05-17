import {
  createEditor,
  type Operation,
  type Node as SlateNode,
  type SnapshotChange,
  type Value,
  type ValueOf,
} from 'slate'
import { history } from 'slate-history'
import * as SlateReact from 'slate-react'
import {
  createReactEditor,
  type EditorSelectorOptions,
  react,
  useEditorSelector,
  useSlateEditor,
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

const initialValue: CustomValue = [
  { type: 'paragraph', children: [{ text: 'initial', bold: true }] },
]

declare const dataTransfer: DataTransfer
declare const slateNode: SlateNode

const ReactExtension = react()
const HistoryExtension = history()
const baseEditor = createEditor({ initialValue })
const reactEditor = createEditor({
  extensions: [ReactExtension],
  initialValue,
})
const historyReactEditor = createReactEditor({
  extensions: [HistoryExtension],
  initialValue,
})

const baseValue: ValueOf<typeof baseEditor> = [
  { type: 'paragraph', children: [{ text: 'one', bold: true }] },
]

const reactValue: ValueOf<typeof reactEditor> = [
  { type: 'paragraph', children: [{ text: 'one', bold: true }] },
]

reactEditor.api.dom.resolvePath(slateNode)
reactEditor.api.clipboard.insertData(dataTransfer)
reactEditor.api.react.isComposing()
reactEditor.getApi(ReactExtension).isComposing()

historyReactEditor.read((state) => {
  const undos = state.history.undos()

  void undos
})

historyReactEditor.update((tx) => {
  tx.history.undo()
})

historyReactEditor.api.history.withoutSaving(() => {})
historyReactEditor.api.dom.focus()
historyReactEditor.api.clipboard.writeSelection(dataTransfer)
historyReactEditor.api.react.isFocused()

const selectorOptions: EditorSelectorOptions<typeof historyReactEditor> = {
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
  const selected = useEditorSelector(
    (selectedEditor: typeof historyReactEditor, operations) => {
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
  const inferredSelected: number = selected

  void inferredSelected
  void selected

  return null
}

const HookProbe = () => {
  const hookEditor = useSlateEditor({
    extensions: [history()],
    initialValue,
  })
  const valueFromHook: CustomValue = hookEditor.read((state) =>
    state.value.get()
  )

  hookEditor.read((state) => {
    const undos = state.history.undos()

    void undos
  })

  hookEditor.update((tx) => {
    tx.history.undo()
  })

  hookEditor.api.history.withoutSaving(() => {})
  hookEditor.api.dom.focus()
  hookEditor.api.react.isComposing()

  void valueFromHook

  return null
}

// @ts-expect-error React is not installed on a plain editor
baseEditor.api.react.isComposing()

// @ts-expect-error DOM is not installed on a plain editor
baseEditor.api.dom.focus()

// @ts-expect-error public React helper namespace is cut
type _NoReactEditor = SlateReact.ReactEditor<Value>

// @ts-expect-error public withReact wrapper is cut
SlateReact.withReact

useSlateEditor({
  initialValue,
  // @ts-expect-error withEditor wrapper composition is cut
  withEditor: (editor) => editor,
})

void baseValue
void reactValue
void SelectorProbe
void HookProbe
