import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createEditor, type Descendant, Editor, Node } from '../src'
import { setEditorTargetRuntime } from '../src/internal'

const paragraph = (text: string): Descendant => ({
  type: 'paragraph',
  children: [{ text }],
})

const quote = (text: string): Descendant => ({
  type: 'quote',
  children: [paragraph(text)],
})

const setupEditor = () => {
  const editor = createEditor()

  Editor.replace(editor, {
    children: [paragraph('one'), paragraph('two')],
    selection: {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 3 },
    },
  })

  return editor
}

const setupCollapsedEditor = () => {
  const editor = createEditor()

  Editor.replace(editor, {
    children: [paragraph('one'), paragraph('two')],
    selection: {
      anchor: { path: [0, 0], offset: 1 },
      focus: { path: [0, 0], offset: 1 },
    },
  })

  return editor
}

const setupWrappedEditor = () => {
  const editor = createEditor()

  Editor.replace(editor, {
    children: [quote('one'), quote('two')],
    selection: {
      anchor: { path: [0, 0, 0], offset: 0 },
      focus: { path: [0, 0, 0], offset: 3 },
    },
  })

  return editor
}

const setupThreeBlockEditor = () => {
  const editor = createEditor()

  Editor.replace(editor, {
    children: [paragraph('one'), paragraph('two'), paragraph('three')],
    selection: {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 3 },
    },
  })

  return editor
}

const setupSplitTextEditor = () => {
  const editor = createEditor()

  Editor.replace(editor, {
    children: [
      {
        type: 'paragraph',
        children: [{ text: 'one' }, { text: 'two' }],
      },
    ],
    selection: {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    },
  })

  return editor
}

describe('primitive method runtime contract', () => {
  it('wrapNodes uses the transaction target when at is omitted inside editor.update', () => {
    const editor = setupEditor()
    let calls = 0

    setEditorTargetRuntime(editor, {
      resolveImplicitTarget() {
        calls += 1

        return {
          anchor: { path: [1, 0], offset: 0 },
          focus: { path: [1, 0], offset: 3 },
        }
      },
    })

    editor.update(() => {
      editor.wrapNodes({ type: 'quote', children: [] } as never)
    })

    assert.equal(calls, 1)
    assert.deepEqual(Editor.getChildren(editor), [
      paragraph('one'),
      quote('two'),
    ])
  })

  it('removeNodes uses the transaction target when at is omitted inside editor.update', () => {
    const editor = setupEditor()
    let calls = 0

    setEditorTargetRuntime(editor, {
      resolveImplicitTarget() {
        calls += 1

        return {
          anchor: { path: [1, 0], offset: 0 },
          focus: { path: [1, 0], offset: 3 },
        }
      },
    })

    editor.update(() => {
      editor.removeNodes()
    })

    assert.equal(calls, 1)
    assert.deepEqual(Editor.getChildren(editor), [paragraph('one')])
  })

  it('splitNodes uses the transaction target when at is omitted inside editor.update', () => {
    const editor = setupCollapsedEditor()
    let calls = 0

    setEditorTargetRuntime(editor, {
      resolveImplicitTarget() {
        calls += 1

        return {
          anchor: { path: [1, 0], offset: 1 },
          focus: { path: [1, 0], offset: 1 },
        }
      },
    })

    editor.update(() => {
      editor.splitNodes()
    })

    assert.equal(calls, 1)
    assert.deepEqual(Editor.getChildren(editor), [
      paragraph('one'),
      paragraph('t'),
      paragraph('wo'),
    ])
  })

  it('insertText uses the transaction target when at is omitted inside editor.update', () => {
    const editor = setupCollapsedEditor()
    let calls = 0

    setEditorTargetRuntime(editor, {
      resolveImplicitTarget() {
        calls += 1

        return {
          anchor: { path: [1, 0], offset: 1 },
          focus: { path: [1, 0], offset: 1 },
        }
      },
    })

    editor.update(() => {
      editor.insertText('X')
    })

    assert.equal(calls, 1)
    assert.deepEqual(Editor.getChildren(editor), [
      paragraph('one'),
      paragraph('tXwo'),
    ])
    assert.deepEqual(editor.getSelection(), {
      anchor: { path: [1, 0], offset: 2 },
      focus: { path: [1, 0], offset: 2 },
    })
  })

  it('insertText in an empty block remains an operation commit, not a replacement', () => {
    const editor = createEditor()

    Editor.replace(editor, {
      children: [paragraph('')],
      selection: {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 0 },
      },
    })

    editor.update(() => {
      editor.insertText('U')
    })

    const commit = Editor.getLastCommit(editor)

    assert.equal(Editor.string(editor, []), 'U')
    assert.deepEqual(commit?.classes, ['text'])
    assert.deepEqual(commit?.operations, [
      {
        offset: 0,
        path: [0, 0],
        text: 'U',
        type: 'insert_text',
      },
    ])
  })

  it('insertText with active marks advances selection so follow-up text stays marked', () => {
    const editor = setupCollapsedEditor()
    let calls = 0

    editor.addMark('bold', true)

    setEditorTargetRuntime(editor, {
      resolveImplicitTarget() {
        calls += 1

        return {
          anchor: { path: [1, 0], offset: 1 },
          focus: { path: [1, 0], offset: 1 },
        }
      },
    })

    editor.update(() => {
      editor.insertText('M')
    })

    setEditorTargetRuntime(editor, null)

    editor.update(() => {
      editor.insertText('ARK')
    })

    assert.equal(calls, 1)
    assert.deepEqual(Editor.getChildren(editor), [
      paragraph('one'),
      {
        type: 'paragraph',
        children: [{ text: 't' }, { bold: true, text: 'MARK' }, { text: 'wo' }],
      },
    ])
    assert.deepEqual(editor.getSelection(), {
      anchor: { path: [1, 1], offset: 4 },
      focus: { path: [1, 1], offset: 4 },
    })
  })

  it('insertText with active marks ignores the transaction-resolved read-only target', () => {
    const editor = createEditor()
    let calls = 0

    editor.isElementReadOnly = (element) => element.type === 'read-only'

    Editor.replace(editor, {
      children: [
        paragraph('one'),
        {
          type: 'read-only',
          children: [{ text: 'two' }],
        },
      ],
      selection: {
        anchor: { path: [0, 0], offset: 1 },
        focus: { path: [0, 0], offset: 1 },
      },
      marks: { bold: true },
    })

    setEditorTargetRuntime(editor, {
      resolveImplicitTarget() {
        calls += 1

        return {
          anchor: { path: [1, 0], offset: 1 },
          focus: { path: [1, 0], offset: 1 },
        }
      },
    })

    editor.update(() => {
      editor.insertText('X')
    })

    assert.equal(calls, 1)
    assert.deepEqual(Editor.getChildren(editor), [
      paragraph('one'),
      {
        type: 'read-only',
        children: [{ text: 'two' }],
      },
    ])
  })

  it('setNodes uses the transaction target when at is omitted inside editor.update', () => {
    const editor = setupEditor()
    let calls = 0

    setEditorTargetRuntime(editor, {
      resolveImplicitTarget() {
        calls += 1

        return {
          anchor: { path: [1, 0], offset: 0 },
          focus: { path: [1, 0], offset: 3 },
        }
      },
    })

    editor.update(() => {
      editor.setNodes({ type: 'heading-one' } as never)
    })

    assert.equal(calls, 1)
    assert.deepEqual(Editor.getChildren(editor), [
      paragraph('one'),
      { type: 'heading-one', children: [{ text: 'two' }] },
    ])
  })

  it('unsetNodes uses the transaction target when at is omitted inside editor.update', () => {
    const editor = createEditor()
    let calls = 0

    Editor.replace(editor, {
      children: [
        paragraph('one'),
        { type: 'paragraph', align: 'center', children: [{ text: 'two' }] },
      ],
      selection: {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 3 },
      },
    })

    setEditorTargetRuntime(editor, {
      resolveImplicitTarget() {
        calls += 1

        return {
          anchor: { path: [1, 0], offset: 0 },
          focus: { path: [1, 0], offset: 3 },
        }
      },
    })

    editor.update(() => {
      editor.unsetNodes('align' as never)
    })

    assert.equal(calls, 1)
    assert.deepEqual(Editor.getChildren(editor), [
      paragraph('one'),
      paragraph('two'),
    ])
  })

  it('delete uses the transaction target when at is omitted inside editor.update', () => {
    const editor = setupEditor()
    let calls = 0

    setEditorTargetRuntime(editor, {
      resolveImplicitTarget() {
        calls += 1

        return {
          anchor: { path: [1, 0], offset: 0 },
          focus: { path: [1, 0], offset: 3 },
        }
      },
    })

    editor.update(() => {
      editor.delete()
    })

    assert.equal(calls, 1)
    assert.deepEqual(Editor.getChildren(editor), [
      paragraph('one'),
      paragraph(''),
    ])
  })

  it('insertFragment uses the transaction target when at is omitted inside editor.update', () => {
    const editor = setupCollapsedEditor()
    let calls = 0

    setEditorTargetRuntime(editor, {
      resolveImplicitTarget() {
        calls += 1

        return {
          anchor: { path: [1, 0], offset: 1 },
          focus: { path: [1, 0], offset: 1 },
        }
      },
    })

    editor.update(() => {
      editor.insertFragment([{ text: 'X' }])
    })

    assert.equal(calls, 1)
    assert.deepEqual(Editor.getChildren(editor), [
      paragraph('one'),
      paragraph('tXwo'),
    ])
  })

  it('unwrapNodes uses the transaction target when at is omitted inside editor.update', () => {
    const editor = setupWrappedEditor()
    let calls = 0

    setEditorTargetRuntime(editor, {
      resolveImplicitTarget() {
        calls += 1

        return {
          anchor: { path: [1, 0, 0], offset: 0 },
          focus: { path: [1, 0, 0], offset: 3 },
        }
      },
    })

    editor.update(() => {
      editor.unwrapNodes({
        match: (node) => Node.isElement(node) && node.type === 'quote',
      })
    })

    assert.equal(calls, 1)
    assert.deepEqual(Editor.getChildren(editor), [
      quote('one'),
      paragraph('two'),
    ])
  })

  it('liftNodes uses the transaction target when at is omitted inside editor.update', () => {
    const editor = setupWrappedEditor()
    let calls = 0

    setEditorTargetRuntime(editor, {
      resolveImplicitTarget() {
        calls += 1

        return {
          anchor: { path: [1, 0, 0], offset: 0 },
          focus: { path: [1, 0, 0], offset: 3 },
        }
      },
    })

    editor.update(() => {
      editor.liftNodes({
        match: (node) => Node.isElement(node) && node.type === 'paragraph',
      })
    })

    assert.equal(calls, 1)
    assert.deepEqual(Editor.getChildren(editor), [
      quote('one'),
      paragraph('two'),
    ])
  })

  it('moveNodes uses the transaction target when at is omitted inside editor.update', () => {
    const editor = setupThreeBlockEditor()
    let calls = 0

    setEditorTargetRuntime(editor, {
      resolveImplicitTarget() {
        calls += 1

        return {
          anchor: { path: [1, 0], offset: 0 },
          focus: { path: [1, 0], offset: 3 },
        }
      },
    })

    editor.update(() => {
      editor.moveNodes({ to: [0] })
    })

    assert.equal(calls, 1)
    assert.deepEqual(Editor.getChildren(editor), [
      paragraph('two'),
      paragraph('one'),
      paragraph('three'),
    ])
  })

  it('mergeNodes uses the transaction target when at is omitted inside editor.update', () => {
    const editor = setupSplitTextEditor()
    let calls = 0

    setEditorTargetRuntime(editor, {
      resolveImplicitTarget() {
        calls += 1

        return {
          anchor: { path: [0, 1], offset: 0 },
          focus: { path: [0, 1], offset: 0 },
        }
      },
    })

    editor.update(() => {
      editor.mergeNodes({ match: (node) => Node.isText(node) })
    })

    assert.equal(calls, 1)
    assert.deepEqual(Editor.getChildren(editor), [
      {
        type: 'paragraph',
        children: [{ text: 'onetwo' }],
      },
    ])
  })

  it('insertNodes uses the transaction target when at is omitted inside editor.update', () => {
    const editor = setupCollapsedEditor()
    let calls = 0

    setEditorTargetRuntime(editor, {
      resolveImplicitTarget() {
        calls += 1

        return {
          anchor: { path: [1, 0], offset: 1 },
          focus: { path: [1, 0], offset: 1 },
        }
      },
    })

    editor.update(() => {
      editor.insertNodes({ text: 'X' })
    })

    assert.equal(calls, 1)
    assert.deepEqual(Editor.getChildren(editor), [
      paragraph('one'),
      {
        type: 'paragraph',
        children: [{ text: 't' }, { text: 'X' }, { text: 'wo' }],
      },
    ])
  })

  it('insertBreak uses the transaction target when at is omitted inside editor.update', () => {
    const editor = setupCollapsedEditor()
    let calls = 0

    setEditorTargetRuntime(editor, {
      resolveImplicitTarget() {
        calls += 1

        return {
          anchor: { path: [1, 0], offset: 1 },
          focus: { path: [1, 0], offset: 1 },
        }
      },
    })

    editor.update(() => {
      editor.insertBreak()
    })

    assert.equal(calls, 1)
    assert.deepEqual(Editor.getChildren(editor), [
      paragraph('one'),
      paragraph('t'),
      paragraph('wo'),
    ])
  })

  it('deleteBackward uses the transaction target when at is omitted inside editor.update', () => {
    const editor = setupEditor()
    let calls = 0

    setEditorTargetRuntime(editor, {
      resolveImplicitTarget() {
        calls += 1

        return {
          anchor: { path: [1, 0], offset: 1 },
          focus: { path: [1, 0], offset: 1 },
        }
      },
    })

    editor.update(() => {
      editor.deleteBackward('character')
    })

    assert.equal(calls, 1)
    assert.deepEqual(Editor.getChildren(editor), [
      paragraph('one'),
      paragraph('wo'),
    ])
  })

  it('deleteForward uses the transaction target when at is omitted inside editor.update', () => {
    const editor = setupEditor()
    let calls = 0

    setEditorTargetRuntime(editor, {
      resolveImplicitTarget() {
        calls += 1

        return {
          anchor: { path: [1, 0], offset: 1 },
          focus: { path: [1, 0], offset: 1 },
        }
      },
    })

    editor.update(() => {
      editor.deleteForward('character')
    })

    assert.equal(calls, 1)
    assert.deepEqual(Editor.getChildren(editor), [
      paragraph('one'),
      paragraph('to'),
    ])
  })

  it('deleteFragment uses the transaction target when at is omitted inside editor.update', () => {
    const editor = setupCollapsedEditor()
    let calls = 0

    setEditorTargetRuntime(editor, {
      resolveImplicitTarget() {
        calls += 1

        return {
          anchor: { path: [1, 0], offset: 0 },
          focus: { path: [1, 0], offset: 3 },
        }
      },
    })

    editor.update(() => {
      editor.deleteFragment()
    })

    assert.equal(calls, 1)
    assert.deepEqual(Editor.getChildren(editor), [
      paragraph('one'),
      paragraph(''),
    ])
  })
})
