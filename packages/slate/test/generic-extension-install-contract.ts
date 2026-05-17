import {
  createEditor,
  type Descendant,
  defineEditorExtension,
  type Value,
} from 'slate'

type CustomText = {
  text: string
  checked?: true
}

type ChecklistElement = {
  type: 'checklist'
  children: CustomText[]
}

type CustomValue = ChecklistElement[]

declare module 'slate' {
  interface EditorStateExtensionGroups<V extends Value = Value> {
    checklist: {
      isActive: () => boolean
      value: () => V
    }
  }

  interface EditorTxExtensionGroups<V extends Value = Value> {
    checklist: {
      toggle: () => void
      value: () => V
    }
  }
}

const initialValue: CustomValue = [
  { type: 'checklist', children: [{ text: 'todo' }] },
]

const ChecklistExtension = defineEditorExtension({
  name: 'checklist',
  capabilities: {
    checklist: {
      toggle() {},
    },
  },
  state: {
    checklist(state) {
      return {
        isActive: () => state.selection.get() != null,
        value: () => state.value.get() as CustomValue,
      }
    },
  },
  tx: {
    checklist(tx) {
      return {
        toggle() {
          tx.nodes.set({ checked: true }, { at: [0, 0] })
        },
        value: () => tx.value.get() as CustomValue,
      }
    },
  },
})

const editor = createEditor({
  initialValue,
  extensions: [ChecklistExtension],
})

const installedValue: CustomValue = editor.read((state) =>
  state.checklist.value()
)
const installedActive: boolean = editor.read((state) =>
  state.checklist.isActive()
)

editor.update((tx) => {
  const value: CustomValue = tx.checklist.value()
  tx.checklist.toggle()

  void value
})

editor.api.checklist.toggle()
editor.getApi(ChecklistExtension).toggle()

const OtherChecklistExtension = defineEditorExtension({
  name: 'other-checklist',
  capabilities: {
    checklist: {
      toggle() {},
    },
  },
})

const plainEditor = createEditor({ initialValue })

// @ts-expect-error extension state groups are only present when installed
plainEditor.read((state) => state.checklist.isActive())

// @ts-expect-error extension tx groups are only present when installed
plainEditor.update((tx) => tx.checklist.toggle())

// @ts-expect-error extension api handles are only present when installed
plainEditor.api.checklist.toggle()

// @ts-expect-error capability lookup by string is not public API
editor.getApi('checklist')

// @ts-expect-error uninstalled extension tokens cannot access installed API
editor.getApi(OtherChecklistExtension)

const _keepsValueInference: Descendant = installedValue[0]
const _keepsBooleanInference: boolean = installedActive
