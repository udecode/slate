import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  createEditor,
  type Descendant,
  defineEditorExtension,
  Editor,
  Element,
  type Editor as SlateEditor,
} from '../src'

const paragraph = (text: string): Descendant => ({
  type: 'paragraph',
  children: [{ text }],
})

const findElementByType = (
  nodes: readonly Descendant[],
  type: string
): Element | null => {
  for (const node of nodes) {
    if (!Element.isElement(node)) {
      continue
    }

    if (node.type === type) {
      return node
    }

    const child = findElementByType(node.children, type)

    if (child) {
      return child
    }
  }

  return null
}

type LinkEditor = SlateEditor & {
  insertLink: (url: string, text: string) => void
}

type MentionEditor = LinkEditor & {
  insertMention: (character: string) => void
}

type TodoEditor = SlateEditor & {
  toggleTodo: (checked?: boolean) => void
}

const createLinkExtension = () =>
  defineEditorExtension<LinkEditor>({
    name: 'link',
    capabilities: {
      inline: { type: 'link' },
    },
    methods(editor) {
      const nextIsInline = editor.isInline

      return {
        insertLink(url: string, text: string) {
          this.update(() => {
            this.insertNode({
              type: 'link',
              url,
              children: [{ text }],
            })
          })
        },
        isInline(element) {
          return element.type === 'link' || nextIsInline(element)
        },
      }
    },
  })

const createMentionExtension = () =>
  defineEditorExtension<MentionEditor>({
    name: 'mention',
    dependencies: ['link'],
    methods(editor) {
      const nextIsInline = editor.isInline
      const nextIsVoid = editor.isVoid

      return {
        insertMention(character: string) {
          this.update(() => {
            this.insertNode({
              type: 'mention',
              character,
              children: [{ text: '' }],
            })
          })
        },
        isInline(element) {
          return element.type === 'mention' || nextIsInline(element)
        },
        isVoid(element) {
          return element.type === 'mention' || nextIsVoid(element)
        },
      }
    },
  })

const createTodoExtension = () =>
  defineEditorExtension<TodoEditor>({
    name: 'todo',
    capabilities: {
      block: { type: 'todo-list' },
      blockChild: { parentType: 'todo-list', type: 'todo-item' },
    },
    methods: {
      toggleTodo(checked = true) {
        this.update(() => {
          this.unwrapNodes({
            match: (node) => Element.isElement(node) && node.type === 'list',
          })
          this.setNodes({
            checked,
            type: 'todo-item',
          } as Partial<Element>)
          this.wrapNodes({
            type: 'todo-list',
            children: [],
          } as Element)
        })
      },
    },
  })

describe('extension method runtime', () => {
  it('installs dependency-ordered domain methods through editor.extend', () => {
    const editor = createEditor() as MentionEditor

    Editor.replace(editor, {
      children: [paragraph('hello')],
      selection: {
        anchor: { path: [0, 0], offset: 5 },
        focus: { path: [0, 0], offset: 5 },
      },
    })

    const unextend = editor.extend([
      createMentionExtension(),
      createLinkExtension(),
    ])

    editor.insertLink('https://example.com', 'site')
    editor.insertMention('Leia')

    const children = Editor.getChildren(editor)
    const linkNode = findElementByType(children, 'link')
    const mentionNode = findElementByType(children, 'mention')
    const registry = Editor.getExtensionRegistry(editor)

    assert.deepEqual([...registry.extensions.keys()], ['link', 'mention'])
    assert.deepEqual(registry.capabilities.get('inline'), [{ type: 'link' }])
    assert.ok(linkNode)
    assert.ok(mentionNode)
    assert.equal(editor.isInline(linkNode), true)
    assert.equal(editor.isInline(mentionNode), true)
    assert.equal(editor.isVoid(mentionNode), true)

    unextend()

    assert.equal(registry.extensions.size, 0)
    assert.equal(registry.capabilities.has('inline'), false)
    assert.equal('insertLink' in editor, false)
    assert.equal('insertMention' in editor, false)
  })

  it('lets extensions expose custom block methods with update-scoped primitives', () => {
    const editor = createEditor() as TodoEditor

    Editor.replace(editor, {
      children: [paragraph('task')],
      selection: {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 4 },
      },
    })

    editor.extend(createTodoExtension())
    editor.toggleTodo(false)

    assert.deepEqual(Editor.getChildren(editor), [
      {
        type: 'todo-list',
        children: [
          {
            checked: false,
            type: 'todo-item',
            children: [{ text: 'task' }],
          },
        ],
      },
    ])
  })

  it('composes method wrappers deterministically by dependency order', () => {
    const editor = createEditor()
    const calls: string[] = []

    Editor.replace(editor, {
      children: [paragraph('')],
      selection: {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 0 },
      },
    })

    const uppercase = defineEditorExtension({
      name: 'uppercase',
      methods(editor) {
        const nextInsertText = editor.insertText

        return {
          insertText(text: string, options) {
            calls.push('uppercase')
            nextInsertText(text.toUpperCase(), options)
          },
        }
      },
    })

    const suffix = defineEditorExtension({
      name: 'suffix',
      dependencies: ['uppercase'],
      methods(editor) {
        const nextInsertText = editor.insertText

        return {
          insertText(text: string, options) {
            calls.push('suffix')
            nextInsertText(`${text}!`, options)
          },
        }
      },
    })

    editor.extend([suffix, uppercase])
    editor.insertText('a')

    assert.deepEqual(calls, ['suffix', 'uppercase'])
    assert.equal(Editor.string(editor, [0]), 'A!')
  })

  it('rejects missing and cyclic dependencies before mutating the editor', () => {
    const editor = createEditor()
    const originalInsertText = editor.insertText
    const missingDependency = defineEditorExtension({
      name: 'dependent',
      dependencies: ['missing'],
      methods: {
        insertText() {},
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
    assert.equal(editor.insertText, originalInsertText)
    assert.equal(Editor.getExtensionRegistry(editor).extensions.size, 0)
  })

  it('rejects duplicate extension methods unless composition is declared by dependency', () => {
    const editor = createEditor() as SlateEditor & {
      toggleTodo?: () => void
    }
    const first = defineEditorExtension({
      name: 'todo-a',
      methods: {
        toggleTodo() {},
      },
    })
    const second = defineEditorExtension({
      name: 'todo-b',
      methods: {
        toggleTodo() {},
      },
    })

    assert.throws(
      () => editor.extend([first, second]),
      /method "toggleTodo".*todo-b.*todo-a/
    )
    assert.equal(editor.toggleTodo, undefined)
    assert.equal(Editor.getExtensionRegistry(editor).extensions.size, 0)
  })
})
