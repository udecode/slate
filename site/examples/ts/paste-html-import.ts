import { type Descendant, Node } from 'slate'
import type { DOMClipboardInsertDataHandler } from 'slate-dom'
import { jsx } from 'slate-hyperscript'

import type {
  CustomEditor,
  CustomElement,
  CustomElementType,
} from './custom-types.d'

interface ElementAttributes {
  type: CustomElementType
  align?: string
  language?: string
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
  P: (el) => withElementAlign({ type: 'paragraph' }, el),
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
const LIST_TEXT_BOUNDARY_TAGS = new Set(['DIV'])
const ELEMENT_ALIGN_VALUES = new Set(['center', 'justify', 'left', 'right'])
const CODE_LINE_BOUNDARY_TAGS = new Set(['DIV', 'P'])
const CODE_WHITE_SPACE_VALUES = new Set(['pre', 'pre-wrap', 'break-spaces'])

const hasTextAttributes = (attrs: TextAttributes) =>
  Object.keys(attrs).length > 0

const normalizeFontSize = (fontSize: string) => {
  const value = fontSize.trim()

  return /^\d+(\.\d+)?(px|pt|em|rem|%)$/i.test(value) ? value : undefined
}

const getElementAlign = (el: HTMLElement) => {
  const value = (el.style.textAlign || el.getAttribute('align') || '')
    .trim()
    .toLowerCase()

  return ELEMENT_ALIGN_VALUES.has(value) ? value : undefined
}

const withElementAlign = (
  attrs: ElementAttributes,
  el: HTMLElement
): ElementAttributes => {
  const align = getElementAlign(el)

  return align ? { ...attrs, align } : attrs
}

const isExplicitNonBoldFontWeight = (fontWeight: string) => {
  const value = fontWeight.trim().toLowerCase()

  if (!value) {
    return false
  }

  if (value === 'normal' || value === 'lighter') {
    return true
  }

  const parsedFontWeight = Number.parseInt(value, 10)

  return Number.isFinite(parsedFontWeight) && parsedFontWeight < 600
}

const getTextTagAttributes = (
  nodeName: string,
  el: HTMLElement
): TextAttributes => {
  if (nodeName === 'B') {
    return isExplicitNonBoldFontWeight(el.style.fontWeight)
      ? {}
      : { bold: true }
  }

  return TEXT_TAGS[nodeName]?.() ?? {}
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

const normalizeInlineChildren = (children: any[]) =>
  children.map((child) =>
    typeof child === 'string' ? jsx('text', {}, child) : child
  )

const getGitHubCodeLineElements = (el: HTMLElement) =>
  Array.from(el.querySelectorAll<HTMLElement>('.blob-code-inner.js-file-line'))

const normalizeCodeText = (text: string) =>
  text.replaceAll('\u00a0', ' ').replace(/\r\n?/g, '\n').replace(/\n+$/g, '')

const isPreservedWhiteSpaceElement = (el: HTMLElement) => {
  if (el.nodeName === 'PRE' || el.nodeName === 'CODE') {
    return true
  }

  return CODE_WHITE_SPACE_VALUES.has(el.style.whiteSpace.trim().toLowerCase())
}

const shouldPreserveTextNewlines = (node: ChildNode) => {
  let parent = node.parentElement

  while (parent) {
    if (isPreservedWhiteSpaceElement(parent)) {
      return true
    }

    if (parent.nodeName === 'BODY') {
      return false
    }

    parent = parent.parentElement
  }

  return false
}

const normalizeTextNode = (node: ChildNode) => {
  const text = node.textContent ?? ''

  if (shouldPreserveTextNewlines(node)) {
    return text
  }

  return text.replace(/\r\n?/g, '\n').replaceAll('\n', '')
}

const collectInlineCodeText = (node: ChildNode): string => {
  if (node.nodeType === 3) {
    return node.textContent ?? ''
  }

  if (node.nodeType !== 1) {
    return ''
  }

  const el = node as HTMLElement

  if (el.nodeName === 'BR') {
    return '\n'
  }

  return Array.from(el.childNodes).map(collectInlineCodeText).join('')
}

const getDirectCodeLineChildren = (el: HTMLElement) =>
  Array.from(el.children).filter((child) =>
    CODE_LINE_BOUNDARY_TAGS.has(child.nodeName)
  )

const collectCodeSourceText = (el: HTMLElement) => {
  const githubCodeLines = getGitHubCodeLineElements(el)

  if (githubCodeLines.length > 0) {
    return normalizeCodeText(
      githubCodeLines.map((line) => collectInlineCodeText(line)).join('\n')
    )
  }

  const directCodeLineChildren = getDirectCodeLineChildren(el)

  if (directCodeLineChildren.length > 1) {
    return normalizeCodeText(
      directCodeLineChildren
        .map((line) => collectInlineCodeText(line))
        .join('\n')
    )
  }

  return normalizeCodeText(collectInlineCodeText(el))
}

const hasCodeWhiteSpace = (el: HTMLElement) => {
  const whiteSpace = el.style.whiteSpace.trim().toLowerCase()

  return CODE_WHITE_SPACE_VALUES.has(whiteSpace)
}

const isCodeSourceElement = (el: HTMLElement) => {
  if (getGitHubCodeLineElements(el).length > 0) {
    return true
  }

  if (el.nodeName === 'PRE') {
    return true
  }

  if (el.nodeName === 'CODE') {
    return collectCodeSourceText(el).includes('\n')
  }

  return hasCodeWhiteSpace(el) && getDirectCodeLineChildren(el).length > 1
}

const createCodeBlockElement = (text: string) =>
  jsx(
    'element',
    { language: 'text', type: 'code-block' },
    jsx('text', {}, text)
  )

const isTopLevelBlock = (node: unknown): node is CustomElement =>
  typeof node === 'object' &&
  node != null &&
  'children' in node &&
  'type' in node &&
  !INLINE_ELEMENT_TYPES.has((node as CustomElement).type)

const getMeaningfulChildren = (children: any[]) =>
  children.filter(
    (child) => !(typeof child === 'string' && child.trim() === '')
  )

const deserializeChild = (
  child: ChildNode,
  index: number,
  siblings: ChildNode[],
  parentNodeName: string
): any[] => {
  const value = deserialize(child)
  const values = Array.isArray(value) ? value : [value]
  const meaningfulValues = getMeaningfulChildren(values)

  if (
    child.nodeType === 1 &&
    parentNodeName === 'LI' &&
    LIST_TEXT_BOUNDARY_TAGS.has(child.nodeName) &&
    (index > 0 || index < siblings.length - 1)
  ) {
    if (
      meaningfulValues.length > 0 &&
      meaningfulValues.every(isTopLevelBlock)
    ) {
      return meaningfulValues
    }

    return [
      jsx('element', { type: 'paragraph' }, normalizeInlineChildren(values)),
    ]
  }

  return values
}

const isEmptyTextBlock = (node: Descendant) =>
  Node.isElement(node) &&
  node.children.length === 1 &&
  Node.isText(node.children[0]) &&
  node.children[0].text === ''

const hasTopLevelBlockFragment = (fragment: unknown) =>
  Array.isArray(fragment) && fragment.some(isTopLevelBlock)

const normalizeBodyFragment = (children: any[]): Descendant[] => {
  const fragment: Descendant[] = []
  let inlineChildren: any[] = []

  const flushInlineChildren = () => {
    if (inlineChildren.length === 0) {
      return
    }

    fragment.push({
      type: 'paragraph',
      children: normalizeInlineChildren(inlineChildren),
    })
    inlineChildren = []
  }

  for (const child of children) {
    if (typeof child === 'string' && child.trim() === '') {
      continue
    }

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
    return normalizeTextNode(el)
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

  if (isCodeSourceElement(el as HTMLElement)) {
    return createCodeBlockElement(collectCodeSourceText(el as HTMLElement))
  }

  let parent = el

  if (
    nodeName === 'PRE' &&
    el.childNodes[0] &&
    el.childNodes[0].nodeName === 'CODE'
  ) {
    parent = el.childNodes[0]
  }
  const childNodes = Array.from(parent.childNodes)
  let children = childNodes
    .flatMap((child, index) =>
      deserializeChild(child, index, childNodes, parent.nodeName)
    )
    .filter((child) => child != null)

  if (children.length === 0) {
    children = [{ text: '' }]
  }

  const textAttributes = {
    ...getTextTagAttributes(nodeName, el as HTMLElement),
    ...getStyledTextAttributes(el as HTMLElement),
  }
  children = applyTextAttributes(children, textAttributes)

  if (nodeName === 'P') {
    const meaningfulChildren = getMeaningfulChildren(children)

    if (
      meaningfulChildren.length > 0 &&
      meaningfulChildren.every(isTopLevelBlock)
    ) {
      return meaningfulChildren
    }
  }

  if (nodeName === 'DIV') {
    return jsx('fragment', {}, normalizeBodyFragment(children))
  }

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
  const dropEmptyPasteTarget = hasTopLevelBlockFragment(fragment)
  editor.update((tx) => {
    tx.nodes.insert(fragment)
    const firstNode = tx.value.get()[0]
    if (dropEmptyPasteTarget && firstNode && isEmptyTextBlock(firstNode)) {
      tx.nodes.remove({ at: [0] })
    }
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
