import type { Descendant } from 'slate'
import type { DOMClipboardInsertDataHandler } from 'slate-dom'
import { jsx } from 'slate-hyperscript'

import type {
  CustomEditor,
  CustomElement,
  CustomElementType,
} from './custom-types.d'

interface ElementAttributes {
  type: CustomElementType
  url?: string
}

// COMPAT: `B` is omitted here because Google Docs uses `<b>` in weird ways.
interface TextAttributes {
  code?: boolean
  fontSize?: string
  strikethrough?: boolean
  italic?: boolean
  bold?: boolean
  underline?: boolean
}

const ELEMENT_TAGS: Record<string, (el: HTMLElement) => ElementAttributes> = {
  A: (el) => ({ type: 'link', url: el.getAttribute('href')! }),
  BLOCKQUOTE: () => ({ type: 'block-quote' }),
  H1: () => ({ type: 'heading-one' }),
  H2: () => ({ type: 'heading-two' }),
  H3: () => ({ type: 'heading-three' }),
  H4: () => ({ type: 'heading-four' }),
  H5: () => ({ type: 'heading-five' }),
  H6: () => ({ type: 'heading-six' }),
  IMG: (el) => ({ type: 'image', url: el.getAttribute('src')! }),
  LI: () => ({ type: 'list-item' }),
  OL: () => ({ type: 'numbered-list' }),
  P: () => ({ type: 'paragraph' }),
  PRE: () => ({ type: 'code-block' }),
  TABLE: () => ({ type: 'table' }),
  TD: () => ({ type: 'table-cell' }),
  TH: () => ({ type: 'table-cell' }),
  TR: () => ({ type: 'table-row' }),
  UL: () => ({ type: 'bulleted-list' }),
}

const TEXT_TAGS: Record<string, () => TextAttributes> = {
  CODE: () => ({ code: true }),
  DEL: () => ({ strikethrough: true }),
  EM: () => ({ italic: true }),
  I: () => ({ italic: true }),
  S: () => ({ strikethrough: true }),
  STRONG: () => ({ bold: true }),
  U: () => ({ underline: true }),
}

const INLINE_ELEMENT_TYPES = new Set<CustomElementType>(['link'])
const IGNORED_TAGS = new Set(['COL', 'COLGROUP', 'META', 'SCRIPT', 'STYLE'])

const hasTextAttributes = (attrs: TextAttributes) =>
  Object.keys(attrs).length > 0

const normalizeFontSize = (fontSize: string) => {
  const value = fontSize.trim()

  return /^\d+(\.\d+)?(px|pt|em|rem|%)$/i.test(value) ? value : undefined
}

const getStyledTextAttributes = (el: HTMLElement): TextAttributes => {
  const attrs: TextAttributes = {}
  const { fontSize, fontStyle, fontWeight, textDecorationLine } = el.style
  const parsedFontWeight = Number.parseInt(fontWeight, 10)
  const normalizedFontSize = normalizeFontSize(fontSize)

  if (
    fontWeight === 'bold' ||
    fontWeight === 'bolder' ||
    parsedFontWeight >= 600
  ) {
    attrs.bold = true
  }

  if (fontStyle === 'italic' || fontStyle === 'oblique') {
    attrs.italic = true
  }

  if (textDecorationLine.includes('underline')) {
    attrs.underline = true
  }

  if (textDecorationLine.includes('line-through')) {
    attrs.strikethrough = true
  }

  if (normalizedFontSize) {
    attrs.fontSize = normalizedFontSize
  }

  return attrs
}

const applyTextAttributes = (children: any[], attrs: TextAttributes): any[] => {
  if (!hasTextAttributes(attrs)) {
    return children
  }

  return children.map((child) => {
    if (typeof child === 'string') {
      return jsx('text', attrs, child)
    }

    if (child && typeof child === 'object') {
      if ('text' in child && !('children' in child)) {
        return { ...child, ...attrs }
      }

      if (Array.isArray(child.children)) {
        return {
          ...child,
          children: applyTextAttributes(child.children, attrs),
        }
      }
    }

    return child
  })
}

const isTopLevelBlock = (node: unknown): node is CustomElement =>
  typeof node === 'object' &&
  node != null &&
  'children' in node &&
  'type' in node &&
  !INLINE_ELEMENT_TYPES.has((node as CustomElement).type)

const normalizeBodyFragment = (children: any[]): Descendant[] => {
  const fragment: Descendant[] = []
  let inlineChildren: any[] = []

  const flushInlineChildren = () => {
    if (inlineChildren.length === 0) {
      return
    }

    fragment.push({
      type: 'paragraph',
      children: inlineChildren,
    })
    inlineChildren = []
  }

  for (const child of children) {
    if (isTopLevelBlock(child)) {
      flushInlineChildren()
      fragment.push(child)
      continue
    }

    inlineChildren.push(child)
  }

  flushInlineChildren()

  return fragment
}

export const deserialize = (el: HTMLElement | ChildNode): any => {
  if (el.nodeType === 3) {
    return el.textContent
  }
  if (el.nodeType !== 1) {
    return null
  }
  if (el.nodeName === 'BR') {
    return '\n'
  }

  const { nodeName } = el
  if (IGNORED_TAGS.has(nodeName)) {
    return null
  }

  let parent = el

  if (
    nodeName === 'PRE' &&
    el.childNodes[0] &&
    el.childNodes[0].nodeName === 'CODE'
  ) {
    parent = el.childNodes[0]
  }
  let children = Array.from(parent.childNodes)
    .flatMap(deserialize)
    .filter((child) => child != null)

  if (children.length === 0) {
    children = [{ text: '' }]
  }

  const textAttributes = {
    ...(TEXT_TAGS[nodeName]?.() ?? {}),
    ...getStyledTextAttributes(el as HTMLElement),
  }
  children = applyTextAttributes(children, textAttributes)

  if (el.nodeName === 'BODY') {
    return jsx('fragment', {}, normalizeBodyFragment(children))
  }

  if (ELEMENT_TAGS[nodeName]) {
    const attrs = ELEMENT_TAGS[nodeName](el as HTMLElement)
    return jsx('element', attrs, children)
  }

  return children
}

const insertHtmlData = (editor: CustomEditor, data: DataTransfer) => {
  const html = data.getData('text/html')

  if (!html) {
    return false
  }

  const hasPlainText = Array.from(data.types).includes('text/plain')
  const text = hasPlainText ? data.getData('text/plain') : ''

  // iOS word prediction/autocorrect can send identical HTML and plain text.
  if (text && html === text) {
    editor.update((tx) => {
      tx.text.insert(text)
    })
    return true
  }

  const parsed = new DOMParser().parseFromString(html, 'text/html')
  const fragment = deserialize(parsed.body)
  editor.update((tx) => {
    tx.nodes.insert(fragment)
  })
  return true
}

export const withHtml = (editor: CustomEditor) => {
  const insertData: DOMClipboardInsertDataHandler = (_domEditor, data) =>
    insertHtmlData(editor, data)

  editor.extend({
    name: 'paste-html',
    capabilities: {
      'dom.clipboard.insertData': insertData,
    },
    elements: [
      { inline: true, type: 'link' },
      { type: 'image', void: 'block' },
    ],
  })

  return editor
}
