import type { Descendant, Editor, Element, Operation, Range } from 'slate'
import { createEditor, NodeApi, OperationApi } from 'slate'
import { Editor as EditorApi } from 'slate/internal'

export type YjsEditorAdapter = {
  readonly importing: () => boolean
  readonly readChildren: () => readonly Element[]
  readonly readChildrenBeforeOperations: (
    operations: readonly Operation[]
  ) => Element[]
  readonly replaceValue: (
    children: readonly Descendant[],
    selection: Range | null
  ) => void
}

const remoteImportOptions = {
  metadata: {
    collab: { origin: 'remote', saveToHistory: false },
    history: { mode: 'skip' },
    selection: { dom: 'preserve', focus: false, scroll: false },
  },
  tag: ['collaboration', 'remote-yjs-import'],
} as const

const SELECTION_ROOT_TYPE = 'slate-yjs-selection-root'

const rangePoints = (
  range: Range
): readonly [Range['anchor'], Range['focus']] =>
  [range.anchor, range.focus] as const

const sanitizeImportSelection = (
  children: readonly Descendant[],
  selection: Range | null
): Range | null => {
  if (selection === null) {
    return null
  }

  const root: Element = { children: [...children], type: SELECTION_ROOT_TYPE }

  return rangePoints(selection).every((point) =>
    isValidImportSelectionPoint(root, point)
  )
    ? selection
    : null
}

const isValidImportSelectionPoint = (
  root: Element,
  point: Range['anchor']
): boolean => {
  const node = NodeApi.getIf(root, point.path)

  return (
    node !== undefined &&
    NodeApi.isText(node) &&
    point.offset >= 0 &&
    point.offset <= node.text.length
  )
}

export const createYjsEditorAdapter = (editor: Editor): YjsEditorAdapter => {
  let importing = false

  const readChildren = (): readonly Element[] =>
    editor.read((state) => [...state.value.get().roots.main])

  const readChildrenBeforeOperations = (
    operations: readonly Operation[]
  ): Element[] => {
    const baselineEditor = createEditor()

    EditorApi.replace(baselineEditor, {
      children: [...readChildren()],
      marks: null,
      selection: null,
    })
    baselineEditor.update((tx) => {
      tx.operations.replay([...operations].reverse().map(OperationApi.inverse))
    })

    return EditorApi.getSnapshot(baselineEditor).children
  }

  const replaceValue = (
    children: readonly Descendant[],
    selection: Range | null
  ): void => {
    const nextSelection = sanitizeImportSelection(children, selection)

    importing = true

    try {
      editor.update((tx) => {
        tx.value.replace({
          children: [...children],
          marks: null,
          selection: nextSelection,
        })
      }, remoteImportOptions)
    } finally {
      importing = false
    }
  }

  return {
    importing: () => importing,
    readChildren,
    readChildrenBeforeOperations,
    replaceValue,
  }
}
