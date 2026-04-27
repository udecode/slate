import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  createEditor,
  type Descendant,
  Editor,
  Node,
  setTargetRuntime,
} from '../src'

const paragraph = (text: string, props: Record<string, unknown> = {}) =>
  ({
    type: 'paragraph',
    ...props,
    children: [{ text }],
  }) as Descendant

const setupEditor = () => {
  const editor = createEditor()

  Editor.replace(editor, {
    children: [paragraph('one'), paragraph('two')],
    selection: {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    },
  })

  return editor
}

describe('transaction target runtime', () => {
  it('resolves implicit targets through the installed runtime', () => {
    const editor = setupEditor()
    let calls = 0

    setTargetRuntime(editor, {
      resolveImplicitTarget(_editor, request) {
        calls += 1
        assert.deepEqual(request.fallback, {
          anchor: { path: [0, 0], offset: 0 },
          focus: { path: [0, 0], offset: 0 },
        })

        return {
          anchor: { path: [1, 0], offset: 0 },
          focus: { path: [1, 0], offset: 0 },
        }
      },
    })

    editor.update(() => {
      editor.setNodes({ type: 'heading-one' } as never)
    })

    assert.equal(calls, 1)
    assert.equal((Editor.getChildren(editor)[0] as any).type, 'paragraph')
    assert.equal((Editor.getChildren(editor)[1] as any).type, 'heading-one')
    assert.deepEqual(Editor.getLiveSelection(editor), {
      anchor: { path: [1, 0], offset: 0 },
      focus: { path: [1, 0], offset: 0 },
    })
  })

  it('does not invoke target runtime for explicit targets', () => {
    const editor = setupEditor()
    let calls = 0

    setTargetRuntime(editor, {
      resolveImplicitTarget() {
        calls += 1
        return null
      },
    })

    editor.update(() => {
      editor.setNodes({ type: 'heading-one' } as never, { at: [1] })
    })

    assert.equal(calls, 0)
    assert.equal((Editor.getChildren(editor)[0] as any).type, 'paragraph')
    assert.equal((Editor.getChildren(editor)[1] as any).type, 'heading-one')
  })

  it('does not invoke target runtime for explicit primitive targets', () => {
    const cases: Array<{
      run: (editor: ReturnType<typeof setupEditor>) => void
      name: string
    }> = [
      {
        name: 'select',
        run: (editor) =>
          editor.select({
            anchor: { path: [1, 0], offset: 0 },
            focus: { path: [1, 0], offset: 0 },
          }),
      },
      {
        name: 'setNodes',
        run: (editor) =>
          editor.setNodes({ type: 'heading-one' } as never, { at: [1] }),
      },
      {
        name: 'insertText',
        run: (editor) =>
          editor.insertText('!', { at: { path: [1, 0], offset: 3 } }),
      },
      {
        name: 'delete',
        run: (editor) =>
          editor.delete({
            at: {
              anchor: { path: [1, 0], offset: 0 },
              focus: { path: [1, 0], offset: 1 },
            },
          }),
      },
      {
        name: 'insertFragment',
        run: (editor) =>
          editor.insertFragment([{ text: '!' }], {
            at: { path: [1, 0], offset: 3 },
          }),
      },
      {
        name: 'insertNodes',
        run: (editor) =>
          editor.insertNodes(
            { text: '!' },
            { at: { path: [1, 0], offset: 3 } }
          ),
      },
      {
        name: 'removeNodes',
        run: (editor) => editor.removeNodes({ at: [1] }),
      },
      {
        name: 'wrapNodes',
        run: (editor) =>
          editor.wrapNodes({ type: 'quote', children: [] } as never, {
            at: [1],
          }),
      },
      {
        name: 'unwrapNodes',
        run: (editor) => {
          editor.wrapNodes({ type: 'quote', children: [] } as never, {
            at: [1],
          })
          editor.unwrapNodes({
            at: [1, 0],
            match: (node) => Node.isElement(node) && node.type === 'quote',
          })
        },
      },
    ]

    for (const { name, run } of cases) {
      const editor = setupEditor()
      let calls = 0

      setTargetRuntime(editor, {
        resolveImplicitTarget() {
          calls += 1
          return null
        },
      })

      editor.update(() => {
        run(editor)
      })

      assert.equal(calls, 0, name)
    }
  })

  it('exposes model selection reads without target freshness', () => {
    const editor = setupEditor()
    let calls = 0
    let selection = null as ReturnType<typeof Editor.getLiveSelection>

    setTargetRuntime(editor, {
      resolveImplicitTarget() {
        calls += 1
        return {
          anchor: { path: [1, 0], offset: 0 },
          focus: { path: [1, 0], offset: 0 },
        }
      },
    })

    Editor.withTransaction(editor, (tx) => {
      selection = tx.getModelSelection()
    })

    assert.equal(calls, 0)
    assert.deepEqual(selection, {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    })
  })

  it('resolves an implicit target only once per transaction', () => {
    const editor = setupEditor()
    let calls = 0

    setTargetRuntime(editor, {
      resolveImplicitTarget() {
        calls += 1

        return {
          anchor: { path: [1, 0], offset: 0 },
          focus: { path: [1, 0], offset: 0 },
        }
      },
    })

    Editor.withTransaction(editor, (tx) => {
      assert.deepEqual(tx.resolveTarget(), {
        anchor: { path: [1, 0], offset: 0 },
        focus: { path: [1, 0], offset: 0 },
      })
      assert.deepEqual(tx.resolveTarget(), {
        anchor: { path: [1, 0], offset: 0 },
        focus: { path: [1, 0], offset: 0 },
      })
    })

    assert.equal(calls, 1)
  })
})
