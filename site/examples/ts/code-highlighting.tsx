import { css } from '@emotion/css'
import Prism from 'prismjs'
import 'prismjs/components/prism-java'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-jsx'
import 'prismjs/components/prism-markdown'
import 'prismjs/components/prism-php'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-sql'
import 'prismjs/components/prism-tsx'
import 'prismjs/components/prism-typescript'
import type React from 'react'
import type { ChangeEvent, PointerEvent } from 'react'
import {
  type Descendant,
  defineEditorExtension,
  type EditorSnapshot,
  NodeApi,
  type RuntimeId,
} from 'slate'
import { isHotkey } from 'slate-dom'
import { history } from 'slate-history'
import {
  Editable,
  editableKeyCommands,
  type RenderElementProps,
  Slate,
  type SlateProjection,
  useEditor,
  useElementPath,
  useSlateDecorationSource,
  useSlateEditor,
} from 'slate-react'
import { Button, Icon, Toolbar } from './components'
import type {
  CodeBlockElement,
  CodeLineElement,
  CustomEditor,
  CustomText,
} from './custom-types.d'
import { normalizeTokens } from './utils/normalize-tokens'

const ParagraphType = 'paragraph'
const CodeBlockType = 'code-block'
const CodeLineType = 'code-line'
const CodeIndent = '  '

const CodeHighlightingExample = () => {
  const editor = useSlateEditor({
    extensions: [history(), codeHighlighting()],
    initialValue: [
      {
        type: ParagraphType,
        children: toChildren(
          "Here's one containing a single paragraph block with some text in it:"
        ),
      },
      {
        type: CodeBlockType,
        language: 'jsx',
        children: toCodeLines(`// Add the initial value.
const initialValue = [
  {
    type: 'paragraph',
    children: [{ text: 'A line of text in a paragraph.' }]
  }
]

const App = () => {
  const editor = useSlateEditor({
    initialValue,
  })

  return (
    <Slate editor={editor}>
      <Editable />
    </Slate>
  )
}`),
      },
      {
        type: ParagraphType,
        children: toChildren(
          'If you are using TypeScript, create the editor from the final value shape and pass extension factories at creation time. The example below includes the custom types required for the rest of this example.'
        ),
      },
      {
        type: CodeBlockType,
        language: 'typescript',
        children: toCodeLines(`// TypeScript users only add this code
import { Descendant } from 'slate'
import { useSlateEditor } from 'slate-react'

type CustomElement = { type: 'paragraph'; children: CustomText[] }
type CustomText = { text: string }
type CustomValue = CustomElement[]

const editor = useSlateEditor<CustomValue>({ initialValue })`),
      },
      {
        type: ParagraphType,
        children: toChildren('There you have it!'),
      },
    ],
  })

  const codeHighlightingSource = useSlateDecorationSource(editor, {
    id: 'code-highlighting',
    dirtiness: ['text', 'node'],
    read: ({ snapshot }) => collectCodeProjections(snapshot.children),
    runtimeScope: ({ snapshot }) => collectCodeRuntimeScope(snapshot),
  })

  return (
    <Slate decorationSources={[codeHighlightingSource]} editor={editor}>
      <ExampleToolbar />
      <Editable
        renderElement={ElementWrapper}
        renderSegment={(segment, children) => {
          const data = Object.assign(
            {},
            ...segment.slices.map((slice) => slice.data ?? {})
          )
          const className = Object.entries(data)
            .filter(([, value]) => value === true)
            .map(([key]) => key)
            .join(' ')

          return className ? (
            <span className={className}>{children}</span>
          ) : (
            children
          )
        }}
      />
      <style>{prismThemeCss}</style>
    </Slate>
  )
}

const codeHighlighting = () =>
  defineEditorExtension<CustomEditor>()({
    capabilities: editableKeyCommands(({ editor, event }) => {
      const codeEditor = editor as unknown as CustomEditor

      if (isHotkey(['mod+shift+c', 'mod+alt+c'], event)) {
        event.preventDefault()
        convertSelectionToCodeBlock(codeEditor)
        return true
      }

      const isTab = isHotkey('tab', event)
      const isShiftTab = isHotkey('shift+tab', event)

      if (!isTab && !isShiftTab) {
        return
      }

      event.preventDefault()

      const handledCodeLines = updateSelectedCodeLines(
        codeEditor,
        isShiftTab ? 'outdent' : 'indent'
      )

      if (!handledCodeLines && isTab) {
        codeEditor.update((tx) => {
          tx.text.insert(CodeIndent)
        })
      }

      return true
    }),
    name: 'code-highlighting',
  })

const ElementWrapper = (props: RenderElementProps) => {
  const { attributes, children, element } = props
  const editor = useEditor<CustomEditor>()
  const path = useElementPath()

  if (element.type === CodeBlockType) {
    const setLanguage = (language: string) => {
      if (!path) {
        return
      }

      editor.update((tx) => {
        tx.nodes.set({ language }, { at: path })
      })
    }

    return (
      <div
        {...attributes}
        className={css(`
        font-family: monospace;
        font-size: 16px;
        line-height: 20px;
        margin-top: 0;
        background: rgba(0, 20, 60, .03);
        padding: 5px 13px;
      `)}
        spellCheck={false}
        style={{ position: 'relative' }}
      >
        <LanguageSelect
          onChange={(e) => setLanguage(e.target.value)}
          value={element.language}
        />
        {children}
      </div>
    )
  }

  if (element.type === CodeLineType) {
    return (
      <div {...attributes} style={{ position: 'relative' }}>
        {children}
      </div>
    )
  }

  const Tag = editor.read((state) => state.schema.isInline(element))
    ? 'span'
    : 'div'
  return (
    <Tag {...attributes} style={{ position: 'relative' }}>
      {children}
    </Tag>
  )
}

const ExampleToolbar = () => {
  return (
    <Toolbar>
      <CodeBlockButton />
    </Toolbar>
  )
}

const CodeBlockButton = () => {
  const editor = useEditor<CustomEditor>()

  return (
    <Button
      active
      data-test-id="code-block-button"
      onClick={() => convertSelectionToCodeBlock(editor)}
      onPointerDown={(event: PointerEvent<HTMLButtonElement>) => {
        event.preventDefault()
      }}
    >
      <Icon>code</Icon>
    </Button>
  )
}

const convertSelectionToCodeBlock = (editor: CustomEditor) => {
  editor.update((tx) => {
    tx.nodes.wrap(
      { type: CodeBlockType, language: 'html', children: [] },
      {
        match: (node) => NodeApi.isElement(node) && node.type === ParagraphType,
        split: true,
      }
    )
    tx.nodes.set(
      { type: CodeLineType },
      {
        match: (node) => NodeApi.isElement(node) && node.type === ParagraphType,
      }
    )
  })
}

const collectCodeProjections = (
  nodes: readonly Descendant[],
  path: number[] = [],
  language: string | undefined = undefined
): SlateProjection<Record<string, true>>[] => {
  const projections: SlateProjection<Record<string, true>>[] = []

  nodes.forEach((node, nodeIndex) => {
    const nodePath = [...path, nodeIndex]
    const nodeLanguage =
      NodeApi.isElement(node) && node.type === CodeBlockType
        ? (node as CodeBlockElement).language
        : language

    if (NodeApi.isText(node) && nodeLanguage) {
      projections.push(
        ...collectCodeTextProjections(node.text, nodePath, nodeLanguage)
      )
    }

    if (NodeApi.isElement(node)) {
      projections.push(
        ...collectCodeProjections(node.children, nodePath, nodeLanguage)
      )
    }
  })

  return projections
}

const collectCodeRuntimeScope = (
  snapshot: EditorSnapshot,
  nodes: readonly Descendant[] = snapshot.children,
  path: number[] = [],
  language: string | undefined = undefined
): RuntimeId[] => {
  const runtimeIds: RuntimeId[] = []

  nodes.forEach((node, nodeIndex) => {
    const nodePath = [...path, nodeIndex]
    const nodeLanguage =
      NodeApi.isElement(node) && node.type === CodeBlockType
        ? (node as CodeBlockElement).language
        : language

    if (NodeApi.isText(node) && nodeLanguage) {
      const runtimeId = snapshot.index.pathToId[nodePath.join('.')]

      if (runtimeId) {
        runtimeIds.push(runtimeId)
      }
      return
    }

    if (NodeApi.isElement(node)) {
      runtimeIds.push(
        ...collectCodeRuntimeScope(
          snapshot,
          node.children,
          nodePath,
          nodeLanguage
        )
      )
    }
  })

  return runtimeIds
}

const collectCodeTextProjections = (
  text: string,
  path: number[],
  language = 'jsx'
): SlateProjection<Record<string, true>>[] => {
  const grammar = Prism.languages[language]

  if (!grammar) {
    return []
  }

  const tokens = Prism.tokenize(text, grammar)
  const normalizedTokens = normalizeTokens(tokens)
  const projections: SlateProjection<Record<string, true>>[] = []
  let start = 0

  normalizedTokens.forEach((lineTokens, lineIndex) => {
    for (const token of lineTokens) {
      const length = token.content.length
      if (!length) {
        continue
      }

      const end = start + length

      projections.push({
        data: {
          token: true,
          ...Object.fromEntries(token.types.map((type) => [type, true])),
        },
        key: `code:${path.join('.')}:${start}:${end}`,
        range: {
          anchor: { path, offset: start },
          focus: { path, offset: end },
        },
      })

      start = end
    }

    if (lineIndex < normalizedTokens.length - 1) {
      start += 1
    }
  })

  return projections
}

type CodeIndentAction = 'indent' | 'outdent'

type EditorPoint = {
  path: number[]
  offset: number
}

type EditorRange = {
  anchor: EditorPoint
  focus: EditorPoint
}

const updateSelectedCodeLines = (
  editor: CustomEditor,
  action: CodeIndentAction
) => {
  const snapshot = editor.read((state) => ({
    children: state.value.get(),
    selection: state.selection.get(),
  }))
  const selection = snapshot.selection

  if (!selection) {
    return false
  }

  const isCollapsed = isSamePoint(selection.anchor, selection.focus)

  if (isCollapsed && action === 'indent') {
    return false
  }

  const codeLinePaths = getSelectedCodeLinePaths(snapshot.children, selection)

  if (!codeLinePaths.length) {
    return false
  }

  editor.update((tx) => {
    for (const linePath of [...codeLinePaths].reverse()) {
      const textPath = getFirstTextPath(snapshot.children, linePath)

      if (!textPath) {
        continue
      }

      if (action === 'indent') {
        tx.text.insert(CodeIndent, { at: { path: textPath, offset: 0 } })
        continue
      }

      const outdentWidth = getOutdentWidth(snapshot.children, textPath)

      if (outdentWidth > 0) {
        tx.text.delete({
          at: {
            anchor: { path: textPath, offset: 0 },
            focus: { path: textPath, offset: outdentWidth },
          },
        })
      }
    }
  })

  return true
}

const getSelectedCodeLinePaths = (
  children: readonly Descendant[],
  selection: EditorRange
) => {
  const [start, end] = getOrderedPoints(selection)
  const startLinePath = getCodeLinePath(children, start.path)
  const endLinePath = getCodeLinePath(children, end.path)

  if (!startLinePath || !endLinePath) {
    return []
  }

  const startCodeBlockPath = startLinePath.slice(0, -1)
  const endCodeBlockPath = endLinePath.slice(0, -1)

  if (!isSamePath(startCodeBlockPath, endCodeBlockPath)) {
    return []
  }

  const codeBlock = getDescendant(children, startCodeBlockPath)
  const startIndex = startLinePath.at(-1)
  const endIndex = endLinePath.at(-1)

  if (
    startIndex == null ||
    endIndex == null ||
    !codeBlock ||
    !NodeApi.isElement(codeBlock) ||
    codeBlock.type !== CodeBlockType
  ) {
    return []
  }

  const codeLinePaths: number[][] = []

  codeBlock.children.slice(startIndex, endIndex + 1).forEach((node, index) => {
    if (NodeApi.isElement(node) && node.type === CodeLineType) {
      codeLinePaths.push([...startCodeBlockPath, startIndex + index])
    }
  })

  return codeLinePaths
}

const getCodeLinePath = (
  children: readonly Descendant[],
  path: readonly number[]
) => {
  const node = getDescendant(children, path)

  if (node && NodeApi.isElement(node) && node.type === CodeLineType) {
    return [...path]
  }

  const parentPath = path.slice(0, -1)
  const parent = getDescendant(children, parentPath)

  if (parent && NodeApi.isElement(parent) && parent.type === CodeLineType) {
    return parentPath
  }

  return null
}

const getFirstTextPath = (
  children: readonly Descendant[],
  linePath: readonly number[]
) => {
  const line = getDescendant(children, linePath)

  if (!line || !NodeApi.isElement(line)) {
    return null
  }

  const textIndex = line.children.findIndex((child) => NodeApi.isText(child))

  return textIndex === -1 ? null : [...linePath, textIndex]
}

const getOutdentWidth = (
  children: readonly Descendant[],
  textPath: readonly number[]
) => {
  const textNode = getDescendant(children, textPath)

  if (!textNode || !NodeApi.isText(textNode)) {
    return 0
  }

  if (textNode.text.startsWith(CodeIndent)) {
    return CodeIndent.length
  }

  if (textNode.text.startsWith('\t') || textNode.text.startsWith(' ')) {
    return 1
  }

  return 0
}

const getDescendant = (
  children: readonly Descendant[],
  path: readonly number[]
): Descendant | null => {
  let descendants = children
  let node: Descendant | null = null

  for (const index of path) {
    node = descendants[index] ?? null

    if (!node) {
      return null
    }

    descendants = NodeApi.isElement(node) ? node.children : []
  }

  return node
}

const getOrderedPoints = ({ anchor, focus }: EditorRange) =>
  comparePoints(anchor, focus) <= 0 ? [anchor, focus] : [focus, anchor]

const comparePoints = (point: EditorPoint, another: EditorPoint) => {
  const pathComparison = comparePaths(point.path, another.path)

  return pathComparison === 0 ? point.offset - another.offset : pathComparison
}

const comparePaths = (path: readonly number[], another: readonly number[]) => {
  const length = Math.min(path.length, another.length)

  for (let index = 0; index < length; index++) {
    const left = path[index]
    const right = another[index]

    if (left !== right) {
      return left < right ? -1 : 1
    }
  }

  return path.length - another.length
}

const isSamePoint = (point: EditorPoint, another: EditorPoint) =>
  point.offset === another.offset && isSamePath(point.path, another.path)

const isSamePath = (path: readonly number[], another: readonly number[]) =>
  path.length === another.length &&
  path.every((segment, index) => segment === another[index])

interface LanguageSelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  value?: string
  onChange: (event: ChangeEvent<HTMLSelectElement>) => void
}

const LanguageSelect = (props: LanguageSelectProps) => {
  return (
    <select
      className={css`
        position: absolute;
        right: 5px;
        top: 5px;
        z-index: 1;
      `}
      contentEditable={false}
      data-test-id="language-select"
      {...props}
    >
      <option value="css">CSS</option>
      <option value="html">HTML</option>
      <option value="java">Java</option>
      <option value="javascript">JavaScript</option>
      <option value="jsx">JSX</option>
      <option value="markdown">Markdown</option>
      <option value="php">PHP</option>
      <option value="python">Python</option>
      <option value="sql">SQL</option>
      <option value="tsx">TSX</option>
      <option value="typescript">TypeScript</option>
    </select>
  )
}

const toChildren = (content: string): CustomText[] => [{ text: content }]
const toCodeLines = (content: string): CodeLineElement[] =>
  content
    .split('\n')
    .map((line) => ({ type: CodeLineType, children: toChildren(line) }))

// Prismjs theme stored as a string instead of emotion css function.
// It is useful for copy/pasting different themes. Also lets keeping simpler Leaf implementation
// In the real project better to use just css file
const prismThemeCss = `
/**
 * prism.js default theme for JavaScript, CSS and HTML
 * Based on dabblet (http://dabblet.com)
 * @author Lea Verou
 */

code[class*="language-"],
pre[class*="language-"] {
    color: black;
    background: none;
    text-shadow: 0 1px white;
    font-family: Consolas, Monaco, 'Andale Mono', 'Ubuntu Mono', monospace;
    font-size: 1em;
    text-align: left;
    white-space: pre;
    word-spacing: normal;
    word-break: normal;
    word-wrap: normal;
    line-height: 1.5;

    -moz-tab-size: 4;
    -o-tab-size: 4;
    tab-size: 4;

    -webkit-hyphens: none;
    -moz-hyphens: none;
    -ms-hyphens: none;
    hyphens: none;
}

pre[class*="language-"]::-moz-selection, pre[class*="language-"] ::-moz-selection,
code[class*="language-"]::-moz-selection, code[class*="language-"] ::-moz-selection {
    text-shadow: none;
    background: #b3d4fc;
}

pre[class*="language-"]::selection, pre[class*="language-"] ::selection,
code[class*="language-"]::selection, code[class*="language-"] ::selection {
    text-shadow: none;
    background: #b3d4fc;
}

@media print {
    code[class*="language-"],
    pre[class*="language-"] {
        text-shadow: none;
    }
}

/* Code blocks */
pre[class*="language-"] {
    padding: 1em;
    margin: .5em 0;
    overflow: auto;
}

:not(pre) > code[class*="language-"],
pre[class*="language-"] {
    background: #f5f2f0;
}

/* Inline code */
:not(pre) > code[class*="language-"] {
    padding: .1em;
    border-radius: .3em;
    white-space: normal;
}

.token.comment,
.token.prolog,
.token.doctype,
.token.cdata {
    color: slategray;
}

.token.punctuation {
    color: #999;
}

.token.namespace {
    opacity: .7;
}

.token.property,
.token.tag,
.token.boolean,
.token.number,
.token.constant,
.token.symbol,
.token.deleted {
    color: #905;
}

.token.selector,
.token.attr-name,
.token.string,
.token.char,
.token.builtin,
.token.inserted {
    color: #690;
}

.token.operator,
.token.entity,
.token.url,
.language-css .token.string,
.style .token.string {
    color: #9a6e3a;
    /* This background color was intended by the author of this theme. */
    background: hsla(0, 0%, 100%, .5);
}

.token.atrule,
.token.attr-value,
.token.keyword {
    color: #07a;
}

.token.function,
.token.class-name {
    color: #DD4A68;
}

.token.regex,
.token.important,
.token.variable {
    color: #e90;
}

.token.important,
.token.bold {
    font-weight: bold;
}
.token.italic {
    font-style: italic;
}

.token.entity {
    cursor: help;
}
`

export default CodeHighlightingExample
