import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createEditor,
  defineEditorExtension,
  type Editor,
  type Path,
  type Value,
} from 'slate'

type CustomText = {
  text: string
}

type ParagraphElement = {
  type: 'paragraph'
  children: CustomText[]
}

type CustomValue = ParagraphElement[]

declare module 'slate' {
  interface EditorExtensionGroups<V extends Value = Value> {
    blockSelection: {
      clear: () => void
      select: (path: Path) => void
      selectedPath: () => Path | null
    }
  }

  interface EditorStateExtensionGroups<V extends Value = Value> {
    blockSelection: {
      hasSelection: () => boolean
      selectedPath: () => Path | null
    }
  }

  interface EditorTxExtensionGroups<V extends Value = Value> {
    blockSelection: {
      removeSelected: () => void
      selectedPath: () => Path | null
    }
  }
}

const selectedBlockPaths = new WeakMap<Editor, Path | null>()

const paragraph = (text: string): ParagraphElement => ({
  type: 'paragraph',
  children: [{ text }],
})

const createBlockSelectionExtension = <TEditor extends Editor<CustomValue>>() =>
  defineEditorExtension<TEditor>({
    editor: {
      blockSelection(editor) {
        return {
          clear() {
            selectedBlockPaths.set(editor, null)
          },
          select(path) {
            selectedBlockPaths.set(editor, [...path] as Path)
          },
          selectedPath() {
            return selectedBlockPaths.get(editor) ?? null
          },
        }
      },
    },
    name: 'block-selection-contract',
    state: {
      blockSelection(_state, editor) {
        return {
          hasSelection: () => selectedBlockPaths.get(editor) != null,
          selectedPath: () => selectedBlockPaths.get(editor) ?? null,
        }
      },
    },
    tx: {
      blockSelection(tx, editor) {
        return {
          removeSelected() {
            const path = selectedBlockPaths.get(editor)

            if (!path) {
              return
            }

            tx.nodes.remove({ at: path })
            selectedBlockPaths.set(editor, null)
          },
          selectedPath: () => selectedBlockPaths.get(editor) ?? null,
        }
      },
    },
  })

const createBlockSelectionEditor = () => {
  const editor = createEditor<CustomValue>()

  editor.update((tx) => {
    tx.value.replace({
      children: [paragraph('one'), paragraph('two')],
      selection: null,
    })
  })

  return editor
}

const assertTypes = (editor: ReturnType<typeof createBlockSelectionEditor>) => {
  editor.blockSelection.select([0])

  editor.read((state) => {
    const hasSelection: boolean = state.blockSelection.hasSelection()

    // @ts-expect-error local editor actions are not deterministic read state
    state.blockSelection.select([0])

    return hasSelection
  })

  editor.update((tx) => {
    tx.blockSelection.removeSelected()

    // @ts-expect-error local editor actions are not transaction transforms
    tx.blockSelection.select([0])
  })
}

describe('extension namespace contract', () => {
  it('installs local editor actions, state reads, and tx writes as one extension namespace', () => {
    const headlessEditor = createEditor<CustomValue>()
    const editor = createBlockSelectionEditor()
    const cleanup = editor.extend(createBlockSelectionExtension())

    assert.equal('blockSelection' in headlessEditor, false)
    assert.equal(editor.blockSelection.selectedPath(), null)
    assert.equal(
      editor.read((state) => state.blockSelection.hasSelection()),
      false
    )

    editor.blockSelection.select([1])

    assert.deepEqual(editor.blockSelection.selectedPath(), [1])
    assert.deepEqual(
      editor.read((state) => state.blockSelection.selectedPath()),
      [1]
    )

    editor.update((tx) => {
      assert.deepEqual(tx.blockSelection.selectedPath(), [1])
      tx.blockSelection.removeSelected()
    })

    assert.deepEqual(
      editor.read((state) => state.value.get()),
      [paragraph('one')]
    )
    assert.equal(editor.blockSelection.selectedPath(), null)

    const editorSurface = editor as unknown as Record<string, unknown>
    assert.equal('api' in editorSurface, false)
    assert.equal('tf' in editorSurface, false)
    assert.equal('commands' in editorSurface, false)

    cleanup()

    assert.equal('blockSelection' in editor, false)
    assert.equal(
      editor.read((state) => 'blockSelection' in state),
      false
    )
  })

  it('rejects editor extension groups that collide with the editor surface', () => {
    const editor = createBlockSelectionEditor()

    assert.throws(
      () =>
        editor.extend(
          defineEditorExtension({
            editor: {
              read() {
                return {}
              },
            },
            name: 'bad-editor-group',
          })
        ),
      /editor group "read" conflicts with an existing editor property/
    )
  })
})

void assertTypes
