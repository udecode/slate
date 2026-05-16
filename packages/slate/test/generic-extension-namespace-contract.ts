import {
  createEditor,
  defineEditorExtension,
  type EditorPublicTransformMiddlewareKey,
  type Value,
} from 'slate'

type CustomText = {
  text: string
  bold?: true
}

type ParagraphElement = {
  type: 'paragraph'
  url?: string
  children: CustomText[]
}

type ImageElement = {
  type: 'image'
  src: string
  children: CustomText[]
}

type CustomValue = (ParagraphElement | ImageElement)[]

type AssertNever<T extends never> = T

const acceptedTransformMiddlewareKeys = [
  'addMark',
  'collapse',
  'delete',
  'deleteBackward',
  'deleteForward',
  'deleteFragment',
  'deselect',
  'insertBreak',
  'insertFragment',
  'insertNode',
  'insertNodes',
  'insertSoftBreak',
  'insertText',
  'liftNodes',
  'mergeNodes',
  'move',
  'moveNodes',
  'removeMark',
  'removeNodes',
  'select',
  'setNodes',
  'setPoint',
  'setSelection',
  'splitNodes',
  'toggleMark',
  'unsetNodes',
  'unwrapNodes',
  'wrapNodes',
] as const satisfies readonly EditorPublicTransformMiddlewareKey[]

type AcceptedTransformMiddlewareKey =
  (typeof acceptedTransformMiddlewareKeys)[number]
type MissingTransformMiddlewareKey = Exclude<
  EditorPublicTransformMiddlewareKey,
  AcceptedTransformMiddlewareKey
>
type ExtraTransformMiddlewareKey = Exclude<
  AcceptedTransformMiddlewareKey,
  EditorPublicTransformMiddlewareKey
>
type _NoMissingTransformMiddlewareKey =
  AssertNever<MissingTransformMiddlewareKey>
type _NoExtraTransformMiddlewareKey = AssertNever<ExtraTransformMiddlewareKey>

declare module 'slate' {
  interface EditorStateExtensionGroups<V extends Value = Value> {
    link: {
      nested: {
        canOpen: () => boolean
      }
      selectedHref: () => string | null
      value: V
    }
    table: {
      isInTable: () => boolean
      rowCount: () => number
    }
  }

  interface EditorTxExtensionGroups<V extends Value = Value> {
    link: {
      nested: {
        remove: () => void
      }
      setHref: (href: string) => void
    }
    media: {
      insertImage: (src: string) => void
    }
    table: {
      insertRow: () => void
      rowCount: () => number
    }
  }
}

const editor = createEditor<CustomValue>()

const extension = defineEditorExtension<typeof editor>({
  name: 'generic-namespace',
  state: {
    link(state) {
      const value: CustomValue = state.value.get()

      return {
        nested: {
          canOpen: () => state.selection.get() != null,
        },
        selectedHref: () => null,
        value,
      }
    },
    table(state) {
      return {
        isInTable: () => state.nodes.hasPath([0]),
        rowCount: () => state.value.get().length,
      }
    },
  },
  tx: {
    link(tx) {
      return {
        nested: {
          remove() {
            tx.nodes.remove({ at: [0] })
          },
        },
        setHref(href) {
          tx.nodes.set({ url: href }, { at: [0] })
        },
      }
    },
    media(tx) {
      return {
        insertImage(src) {
          tx.nodes.insert({
            type: 'image',
            src,
            children: [{ text: '' }],
          } satisfies ImageElement)
        },
      }
    },
    table(tx) {
      return {
        insertRow() {
          tx.nodes.insert(
            {
              type: 'paragraph',
              children: [{ text: 'row' }],
            } satisfies ParagraphElement,
            { at: [tx.value.get().length] }
          )
        },
        rowCount: () => tx.value.get().length,
      }
    },
  },
})

const runtimeExtension = defineEditorExtension({
  name: 'runtime-generic-namespace',
  options: {
    initialMode: 'text' as const,
  },
  register(context) {
    const initialMode: 'text' = context.options.initialMode
    const signal: AbortSignal = context.signal
    const mode = context.runtimeState<'text' | 'cell'>(initialMode)

    void signal

    return {
      cleanup() {
        mode.set('text')
      },
      state: {
        table(state) {
          return {
            isInTable: () => mode.get() === 'cell' && state.nodes.hasPath([0]),
            rowCount: () => state.value.get().length,
          }
        },
      },
      tx: {
        table(tx) {
          return {
            insertRow() {
              mode.set('cell')
              tx.nodes.insert({
                type: 'paragraph',
                children: [{ text: 'row' }],
              } satisfies ParagraphElement)
            },
            rowCount: () => tx.value.get().length,
          }
        },
      },
    }
  },
})

defineEditorExtension({
  name: 'bad-runtime-command-namespace',
  // @ts-expect-error registration output does not expose public command slots
  register() {
    return {
      commands: [
        {
          handler: () => ({ handled: false }),
          type: 'insert_text',
        },
      ],
    }
  },
})

defineEditorExtension<typeof editor>({
  name: 'bad-link-namespace',
  state: {
    // @ts-expect-error augmented link state groups must return the declared shape
    link() {
      return {
        selectedHref: () => null,
      }
    },
  },
})

defineEditorExtension<typeof editor>({
  // @ts-expect-error raw Slate extensions do not expose public command slots
  commands: [
    {
      handler: () => ({ handled: false }),
      type: 'insert_text',
    },
  ],
  name: 'bad-command-namespace',
})

defineEditorExtension<typeof editor>({
  name: 'bad-engine-transform',
  transforms: {
    // @ts-expect-error engine controls are not transform middleware keys
    normalize() {},
  },
})

editor.extend(extension)

const selectedHref: string | null = editor.read((state) =>
  state.link.selectedHref()
)
const customValue: CustomValue = editor.read((state) => state.link.value)
const canOpen: boolean = editor.read((state) => state.link.nested.canOpen())
const tableRowCount: number = editor.read((state) => state.table.rowCount())
const isInTable: boolean = editor.read((state) => state.table.isInTable())

editor.update((tx) => {
  const beforeInsert: number = tx.table.rowCount()
  tx.table.insertRow()
  const afterInsert: number = tx.table.rowCount()

  tx.link.setHref('https://example.com')
  tx.link.nested.remove()
  tx.media.insertImage('image.png')

  void beforeInsert
  void afterInsert
})

const assertExtensionNamespacesStayScoped = () => {
  // @ts-expect-error extension groups do not mutate the editor object
  editor.link

  // @ts-expect-error tx groups do not mutate the editor object
  editor.table.insertRow()

  editor.read((state) => {
    // @ts-expect-error tx-only groups are not exposed in read state
    state.media.insertImage('image.png')
    // @ts-expect-error table transforms are only exposed in update tx
    state.table.insertRow()
  })
}

void assertExtensionNamespacesStayScoped
void runtimeExtension
void selectedHref
void customValue
void canOpen
void tableRowCount
void isInTable
