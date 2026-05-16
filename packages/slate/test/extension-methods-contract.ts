import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Editor } from 'slate/internal'

import {
  createEditor,
  defineEditorExtension,
  type EditorExtensionInput,
  type EditorExtensionRuntimeState,
} from '../src'

const asExtensionInput = (extension: unknown): EditorExtensionInput =>
  extension as EditorExtensionInput

describe('extension method hard cut', () => {
  it('rejects legacy object methods before mutating the editor', () => {
    const editor = createEditor()
    const legacyExtension = asExtensionInput({
      name: 'legacy-link',
      methods: {
        insertLink() {},
      },
    })

    assert.throws(
      () => editor.extend(legacyExtension),
      /Editor extension "legacy-link" cannot use methods\. Add state or tx groups instead\./
    )
    assert.equal('insertText' in editor, false)
    assert.equal('insertLink' in editor, false)
    assert.equal(Editor.getExtensionRegistry(editor).extensions.size, 0)
  })

  it('rejects public command slots before mutating the editor', () => {
    const editor = createEditor()
    const commandExtension = asExtensionInput({
      commands: [
        {
          handler: () => ({ handled: false }),
          type: 'insert_text',
        },
      ],
      name: 'command-extension',
    })

    assert.throws(
      () => editor.extend(commandExtension),
      /Editor extension "command-extension" cannot use commands\. Add state or tx groups instead\./
    )
    assert.equal(Editor.getExtensionRegistry(editor).extensions.size, 0)
    assert.equal(Editor.getExtensionRegistry(editor).commands.size, 0)
  })

  it('rejects legacy functional methods before mutating the editor', () => {
    const editor = createEditor()
    const legacyExtension = asExtensionInput({
      name: 'legacy-wrapper',
      methods() {
        return {
          insertText() {},
        }
      },
    })

    assert.throws(
      () => editor.extend(legacyExtension),
      /Editor extension "legacy-wrapper" cannot use methods\. Add state or tx groups instead\./
    )
    assert.equal('insertText' in editor, false)
    assert.equal(Editor.getExtensionRegistry(editor).extensions.size, 0)
  })

  it('keeps dependency validation on namespace extensions before mutating the editor', () => {
    const editor = createEditor()
    const missingDependency = defineEditorExtension({
      name: 'dependent',
      dependencies: ['missing'],
      state: {
        dependent() {
          return {}
        },
      },
    })
    const a = defineEditorExtension({
      name: 'a',
      dependencies: ['b'],
    })
    const b = defineEditorExtension({
      name: 'b',
      dependencies: ['a'],
    })

    assert.throws(
      () => editor.extend(missingDependency),
      /missing dependency "missing"/
    )
    assert.throws(() => editor.extend([a, b]), /cyclic dependency/)
    assert.equal(Editor.getExtensionRegistry(editor).extensions.size, 0)
    assert.equal(
      editor.read((state) => 'dependent' in state),
      false
    )
  })

  it('rolls back earlier namespace groups when a later extension fails', () => {
    const editor = createEditor()
    const first = defineEditorExtension({
      name: 'first-table',
      state: {
        table() {
          return { source: 'first' }
        },
      },
    })
    const second = defineEditorExtension({
      name: 'second-table',
      state: {
        table() {
          return { source: 'second' }
        },
      },
    })

    assert.throws(
      () => editor.extend([first, second]),
      /state group "table".*conflicts/
    )
    assert.equal(Editor.getExtensionRegistry(editor).extensions.size, 0)
    assert.equal(
      editor.read((state) => 'table' in state),
      false
    )
  })

  it('installs register output with options, cleanup signal, and extension-local state', () => {
    const editor = createEditor()
    const cleanupEvents: string[] = []
    let runtimeMode: EditorExtensionRuntimeState<'text' | 'cell'> | null = null

    const unextend = editor.extend(
      defineEditorExtension({
        name: 'runtime-table',
        options: { initialMode: 'text' as const },
        register(context) {
          assert.equal(context.name, 'runtime-table')
          assert.equal(context.options.initialMode, 'text')

          const mode = context.runtimeState<'text' | 'cell'>(
            context.options.initialMode
          )
          runtimeMode = mode
          context.signal.addEventListener('abort', () => {
            cleanupEvents.push(`abort:${mode.get()}`)
          })

          return {
            cleanup() {
              cleanupEvents.push(`cleanup:${mode.get()}`)
            },
            state: {
              table() {
                return {
                  mode: () => mode.get(),
                }
              },
            },
            tx: {
              table() {
                return {
                  setMode(nextMode: 'text' | 'cell') {
                    mode.set(nextMode)
                  },
                }
              },
            },
          }
        },
      })
    )

    assert.equal(
      editor.read((state) =>
        (state as typeof state & { table: { mode(): string } }).table.mode()
      ),
      'text'
    )

    editor.update((tx) => {
      ;(
        tx as typeof tx & { table: { setMode(mode: 'text' | 'cell'): void } }
      ).table.setMode('cell')
    })

    assert.equal(
      editor.read((state) =>
        (state as typeof state & { table: { mode(): string } }).table.mode()
      ),
      'cell'
    )

    unextend()

    assert.deepEqual(cleanupEvents, ['abort:cell', 'cleanup:cell'])
    assert.throws(
      () => runtimeMode?.get(),
      /Editor extension runtime state has been cleaned up/
    )
    assert.equal(
      editor.read((state) => 'table' in state),
      false
    )
  })

  it('extension transform middleware can delegate and override insertText args', () => {
    const editor = createEditor()
    const seenText: string[] = []

    Editor.replace(editor, {
      children: [{ type: 'paragraph', children: [{ text: 'one' }] }],
      selection: {
        anchor: { path: [0, 0], offset: 3 },
        focus: { path: [0, 0], offset: 3 },
      },
      marks: null,
    })

    editor.extend(
      defineEditorExtension({
        name: 'insert-text-transform',
        transforms: {
          insertText({ next, text }) {
            seenText.push(text)

            if (text === '?') {
              next({ text: '!' })
              return
            }

            next()
          },
        },
      })
    )

    editor.update(() => {
      Editor.insertText(editor, '!')
      Editor.insertText(editor, '?')
    })

    assert.deepEqual(seenText, ['!', '?'])
    assert.equal(Editor.string(editor, [0]), 'one!!')
  })

  it('extension transform middleware handles deleteBackward by not calling next', () => {
    const editor = createEditor()
    const seenUnits: string[] = []

    Editor.replace(editor, {
      children: [{ type: 'paragraph', children: [{ text: 'one' }] }],
      selection: {
        anchor: { path: [0, 0], offset: 3 },
        focus: { path: [0, 0], offset: 3 },
      },
      marks: null,
    })

    editor.extend(
      defineEditorExtension({
        name: 'delete-backward-transform',
        transforms: {
          deleteBackward({ unit }) {
            seenUnits.push(unit)
          },
        },
      })
    )

    Editor.deleteBackward(editor)

    assert.deepEqual(seenUnits, ['character'])
    assert.equal(Editor.string(editor, [0]), 'one')
  })

  it('validates peer dependencies and conflicts before mutating the editor', () => {
    const editor = createEditor()
    const missingPeer = defineEditorExtension({
      name: 'needs-peer',
      peerDependencies: ['peer-host'],
      state: {
        needsPeer() {
          return {}
        },
      },
    })

    assert.throws(
      () => editor.extend(missingPeer),
      /missing peer dependency "peer-host"/
    )
    assert.equal(Editor.getExtensionRegistry(editor).extensions.size, 0)
    assert.equal(
      editor.read((state) => 'needsPeer' in state),
      false
    )

    const peerHost = defineEditorExtension({ name: 'peer-host' })
    const cleanupHost = editor.extend(peerHost)
    const cleanupPeer = editor.extend(missingPeer)

    assert.equal(
      Editor.getExtensionRegistry(editor).extensions.has('needs-peer'),
      true
    )

    cleanupPeer()
    cleanupHost()

    assert.throws(
      () =>
        editor.extend([
          defineEditorExtension({
            conflicts: ['conflict-b'],
            name: 'conflict-a',
          }),
          defineEditorExtension({ name: 'conflict-b' }),
        ]),
      /Editor extension "conflict-a" conflicts with "conflict-b"/
    )
    assert.equal(Editor.getExtensionRegistry(editor).extensions.size, 0)

    const cleanupInstalled = editor.extend(
      defineEditorExtension({
        conflicts: ['late-conflict'],
        name: 'installed-conflict',
      })
    )

    assert.throws(
      () => editor.extend(defineEditorExtension({ name: 'late-conflict' })),
      /Editor extension "late-conflict" conflicts with "installed-conflict"/
    )
    assert.equal(
      Editor.getExtensionRegistry(editor).extensions.has('late-conflict'),
      false
    )

    cleanupInstalled()
  })
})
