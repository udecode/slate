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

  it('resolves editor api handles only from installed extension tokens', () => {
    const installed = defineEditorExtension({
      name: 'history',
      api: {
        history: {
          withoutSaving(fn: () => void) {
            fn()
          },
        },
      },
    })
    const fresh = defineEditorExtension({
      name: 'history',
      api: {
        history: {
          withoutSaving(fn: () => void) {
            fn()
          },
        },
      },
    })
    const editor = createEditor({ extensions: [installed] })
    let called = false

    assert.equal(editor.getApi(installed), editor.api.history)
    editor.getApi(installed).withoutSaving(() => {
      called = true
    })
    assert.equal(called, true)
    assert.throws(
      () => editor.getApi(fresh),
      /Editor extension "history" is not installed on this editor\./
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

  it('extension transform middleware covers every public mutating transform key', () => {
    const createEditorWithTransformSpy = (seen: string[]) => {
      const editor = createEditor()

      Editor.replace(editor, {
        children: [
          { type: 'paragraph', children: [{ text: 'one' }] },
          { type: 'paragraph', children: [{ text: 'two' }] },
        ],
        selection: {
          anchor: { path: [0, 0], offset: 1 },
          focus: { path: [0, 0], offset: 2 },
        },
        marks: null,
      })

      editor.extend(
        defineEditorExtension({
          name: 'full-transform-spy',
          transforms: {
            addMark({ key }) {
              assert.equal(key, 'bold')
              seen.push('addMark')
            },
            collapse({ options }) {
              assert.equal(options?.edge, 'start')
              seen.push('collapse')
            },
            delete({ options }) {
              assert.equal(options?.unit, 'character')
              seen.push('delete')
            },
            deleteBackward({ unit }) {
              assert.equal(unit, 'character')
              seen.push('deleteBackward')
            },
            deleteForward({ unit }) {
              assert.equal(unit, 'word')
              seen.push('deleteForward')
            },
            deleteFragment({ options }) {
              assert.equal(options?.direction, 'backward')
              seen.push('deleteFragment')
            },
            deselect() {
              seen.push('deselect')
            },
            insertBreak() {
              seen.push('insertBreak')
            },
            insertFragment({ fragment }) {
              assert.deepEqual(fragment, [
                { type: 'paragraph', children: [{ text: 'fragment' }] },
              ])
              seen.push('insertFragment')
            },
            insertNode({ node }) {
              assert.deepEqual(node, {
                type: 'paragraph',
                children: [{ text: 'node' }],
              })
              seen.push('insertNode')
            },
            insertNodes({ nodes }) {
              assert.equal(Array.isArray(nodes), true)
              seen.push('insertNodes')
            },
            insertSoftBreak() {
              seen.push('insertSoftBreak')
            },
            insertText({ text }) {
              assert.equal(text, '!')
              seen.push('insertText')
            },
            liftNodes({ options }) {
              assert.deepEqual(options?.at, [0])
              seen.push('liftNodes')
            },
            mergeNodes({ options }) {
              assert.deepEqual(options?.at, [1])
              seen.push('mergeNodes')
            },
            move({ options }) {
              assert.equal(options?.distance, 1)
              seen.push('move')
            },
            moveNodes({ options }) {
              assert.deepEqual(options.to, [1])
              seen.push('moveNodes')
            },
            removeMark({ key }) {
              assert.equal(key, 'bold')
              seen.push('removeMark')
            },
            removeNodes({ options }) {
              assert.deepEqual(options?.at, [0])
              seen.push('removeNodes')
            },
            select({ target }) {
              assert.deepEqual(target, { path: [0, 0], offset: 0 })
              seen.push('select')
            },
            setNodes({ props }) {
              assert.deepEqual(props, { type: 'heading' })
              seen.push('setNodes')
            },
            setPoint({ options, props }) {
              assert.equal(options?.edge, 'anchor')
              assert.equal(props.offset, 0)
              seen.push('setPoint')
            },
            setSelection({ props }) {
              assert.equal(props.anchor?.offset, 0)
              seen.push('setSelection')
            },
            splitNodes({ options }) {
              assert.equal(options?.always, true)
              seen.push('splitNodes')
            },
            toggleMark({ key, value }) {
              assert.equal(key, 'bold')
              assert.equal(value, true)
              seen.push('toggleMark')
            },
            unsetNodes({ props }) {
              assert.deepEqual(props, ['bold'])
              seen.push('unsetNodes')
            },
            unwrapNodes({ options }) {
              assert.deepEqual(options?.at, [0])
              seen.push('unwrapNodes')
            },
            wrapNodes({ element }) {
              assert.equal(element.type, 'quote')
              seen.push('wrapNodes')
            },
          },
        })
      )

      return editor
    }

    const expectTransformHandled = (
      name: string,
      invoke: (editor: ReturnType<typeof createEditor>) => void
    ) => {
      const seen: string[] = []
      const editor = createEditorWithTransformSpy(seen)

      invoke(editor)

      assert.deepEqual(seen, [name])
    }

    expectTransformHandled('addMark', (editor) =>
      Editor.addMark(editor, 'bold', true)
    )
    expectTransformHandled('collapse', (editor) =>
      Editor.collapse(editor, { edge: 'start' })
    )
    expectTransformHandled('delete', (editor) =>
      Editor.delete(editor, { unit: 'character' })
    )
    expectTransformHandled('deleteBackward', (editor) =>
      Editor.deleteBackward(editor)
    )
    expectTransformHandled('deleteForward', (editor) =>
      Editor.deleteForward(editor, { unit: 'word' })
    )
    expectTransformHandled('deleteFragment', (editor) =>
      Editor.deleteFragment(editor, { direction: 'backward' })
    )
    expectTransformHandled('deselect', (editor) => Editor.deselect(editor))
    expectTransformHandled('insertBreak', (editor) =>
      Editor.insertBreak(editor)
    )
    expectTransformHandled('insertFragment', (editor) =>
      Editor.insertFragment(editor, [
        { type: 'paragraph', children: [{ text: 'fragment' }] },
      ])
    )
    expectTransformHandled('insertNode', (editor) =>
      Editor.insertNode(editor, {
        type: 'paragraph',
        children: [{ text: 'node' }],
      })
    )
    expectTransformHandled('insertNodes', (editor) =>
      Editor.insertNodes(editor, [
        { type: 'paragraph', children: [{ text: 'nodes' }] },
      ])
    )
    expectTransformHandled('insertSoftBreak', (editor) =>
      Editor.insertSoftBreak(editor)
    )
    expectTransformHandled('insertText', (editor) =>
      Editor.insertText(editor, '!')
    )
    expectTransformHandled('liftNodes', (editor) =>
      Editor.liftNodes(editor, { at: [0] })
    )
    expectTransformHandled('mergeNodes', (editor) =>
      Editor.mergeNodes(editor, { at: [1] })
    )
    expectTransformHandled('move', (editor) =>
      Editor.move(editor, { distance: 1 })
    )
    expectTransformHandled('moveNodes', (editor) =>
      Editor.moveNodes(editor, { at: [0], to: [1] })
    )
    expectTransformHandled('removeMark', (editor) =>
      Editor.removeMark(editor, 'bold')
    )
    expectTransformHandled('removeNodes', (editor) =>
      Editor.removeNodes(editor, { at: [0] })
    )
    expectTransformHandled('select', (editor) =>
      Editor.select(editor, { path: [0, 0], offset: 0 })
    )
    expectTransformHandled('setNodes', (editor) =>
      Editor.setNodes(editor, { type: 'heading' })
    )
    expectTransformHandled('setPoint', (editor) =>
      Editor.setPoint(editor, { offset: 0 }, { edge: 'anchor' })
    )
    expectTransformHandled('setSelection', (editor) =>
      Editor.setSelection(editor, {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 0 },
      })
    )
    expectTransformHandled('splitNodes', (editor) =>
      Editor.splitNodes(editor, { always: true })
    )
    expectTransformHandled('toggleMark', (editor) =>
      Editor.toggleMark(editor, 'bold', true)
    )
    expectTransformHandled('unsetNodes', (editor) =>
      Editor.unsetNodes(editor, ['bold'])
    )
    expectTransformHandled('unwrapNodes', (editor) =>
      Editor.unwrapNodes(editor, { at: [0] })
    )
    expectTransformHandled('wrapNodes', (editor) =>
      Editor.wrapNodes(editor, {
        type: 'quote',
        children: [],
      })
    )
  })

  it('extension transform middleware can delegate and override insertNode args', () => {
    const editor = createEditor()
    const seenNodes: unknown[] = []

    Editor.replace(editor, {
      children: [{ type: 'paragraph', children: [{ text: 'one' }] }],
      selection: null,
      marks: null,
    })

    editor.extend(
      defineEditorExtension({
        name: 'insert-node-transform',
        transforms: {
          insertNode({ next, node, options }) {
            seenNodes.push(node)
            next({
              node: {
                type: 'paragraph',
                children: [{ text: 'override' }],
              },
              options,
            })
          },
        },
      })
    )

    Editor.insertNode(
      editor,
      { type: 'paragraph', children: [{ text: 'original' }] },
      { at: [1] }
    )

    assert.deepEqual(seenNodes, [
      { type: 'paragraph', children: [{ text: 'original' }] },
    ])
    assert.deepEqual(Editor.getSnapshot(editor).children, [
      { type: 'paragraph', children: [{ text: 'one' }] },
      { type: 'paragraph', children: [{ text: 'override' }] },
    ])
  })

  it('extension transform middleware rejects double next calls', () => {
    const editor = createEditor()

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
        name: 'double-next-transform',
        transforms: {
          insertText({ next }) {
            next()
            next()
          },
        },
      })
    )

    assert.throws(
      () => Editor.insertText(editor, '!'),
      /Transform middleware next\(\) cannot be called more than once\./
    )
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

  it('uses latest same-name extensions and enabled false tombstones', () => {
    const editor = createEditor()
    const first = defineEditorExtension({
      api: {
        duplicate: {
          value: 'first',
        },
      },
      name: 'duplicate',
      state: {
        duplicate() {
          return { value: () => 'first' }
        },
      },
    })
    const second = defineEditorExtension({
      api: {
        duplicate: {
          value: 'second',
        },
      },
      name: 'duplicate',
      state: {
        duplicate() {
          return { value: () => 'second' }
        },
      },
    })

    editor.extend([first, second])

    assert.equal(
      (editor.api as { duplicate?: { value: string } }).duplicate?.value,
      'second'
    )
    assert.equal(
      editor.read((state) =>
        (
          state as unknown as { duplicate: { value: () => string } }
        ).duplicate.value()
      ),
      'second'
    )
    assert.throws(
      () => editor.getApi(first),
      /Editor extension "duplicate" is not installed on this editor\./
    )

    editor.extend(
      defineEditorExtension({
        enabled: false,
        name: 'duplicate',
      })
    )

    assert.equal((editor.api as { duplicate?: unknown }).duplicate, undefined)
    assert.equal(
      editor.read((state) => 'duplicate' in state),
      false
    )
    assert.equal(
      Editor.getExtensionRegistry(editor).extensions.has('duplicate'),
      false
    )
  })
})
