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
  api: {
    checklist: {
      toggle() {},
    },
  },
  state: {
    checklist(state) {
      return {
        isActive: () => state.selection.get() != null,
        value: () => state.value.get().roots.main as CustomValue,
      }
    },
  },
  tx: {
    checklist(tx) {
      return {
        toggle() {
          tx.nodes.set({ checked: true }, { at: [0, 0] })
        },
        value: () => tx.value.get().roots.main as CustomValue,
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
  api: {
    checklist: {
      toggle() {},
    },
  },
})

defineEditorExtension({
  name: 'old-capabilities',
  // @ts-expect-error public extension authoring uses api, not capabilities
  capabilities: {
    checklist: {
      toggle() {},
    },
  },
})

const DisabledChecklistExtension = defineEditorExtension({
  enabled: false,
  name: 'checklist',
})

const disabledEditor = createEditor({
  initialValue,
  extensions: [ChecklistExtension, DisabledChecklistExtension],
})

// @ts-expect-error disabled extensions do not contribute state groups
disabledEditor.read((state) => state.checklist.isActive())

// @ts-expect-error disabled extensions do not contribute tx groups
disabledEditor.update((tx) => tx.checklist.toggle())

// @ts-expect-error disabled extensions do not contribute api handles
disabledEditor.api.checklist.toggle()

// @ts-expect-error disabled extension tokens cannot access installed API
disabledEditor.getApi(ChecklistExtension)

const FirstSameNameExtension = defineEditorExtension({
  name: 'same-name',
  api: {
    sameName: {
      firstOnly() {},
    },
  },
})

const SecondSameNameExtension = defineEditorExtension({
  name: 'same-name',
  api: {
    sameName: {
      secondOnly() {},
    },
  },
})

const latestWinsEditor = createEditor({
  initialValue,
  extensions: [FirstSameNameExtension, SecondSameNameExtension],
})

latestWinsEditor.api.sameName.secondOnly()

// @ts-expect-error latest same-name extension replaces earlier type output
latestWinsEditor.api.sameName.firstOnly()

latestWinsEditor.getApi(SecondSameNameExtension).secondOnly()

// @ts-expect-error replaced extension tokens cannot access installed API
latestWinsEditor.getApi(FirstSameNameExtension)

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
