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
import {
  type ChangeEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useMemo,
} from 'react'
import {
  type Descendant,
  type EditorSnapshot,
  Node,
  type RuntimeId,
  type Node as SlateNode,
} from 'slate'
import { isHotkey } from 'slate-dom'
import { withHistory } from 'slate-history'
import {
  createDecorationSource,
  Editable,
  type RenderElementProps,
  Slate,
  type SlateProjection,
  useEditor,
  useSlateEditor,
} from 'slate-react'
import { Button, Icon, Toolbar } from './components'
import type {
  CodeBlockElement,
  CodeLineElement,
  CustomEditor,
  CustomElement,
  CustomText,
  CustomValue,
} from './custom-types.d'
import { normalizeTokens } from './utils/normalize-tokens'

const ParagraphType = 'paragraph'
const CodeBlockType = 'code-block'
const CodeLineType = 'code-line'

const CodeHighlightingExample = () => {
  const editor = useSlateEditor<CustomValue, CustomEditor>({
    withEditor: (editor) => withHistory(editor) as CustomEditor,
    initialValue,
  })

  const onKeyDown = useOnKeydown(editor)
  const codeHighlightingSource = useMemo(
    () =>
      createDecorationSource(editor, {
        id: 'code-highlighting',
        dirtiness: ['text', 'node'],
        read: ({ snapshot }) => collectCodeProjections(snapshot.children),
        runtimeScope: ({ snapshot }) => collectCodeRuntimeScope(snapshot),
      }),
    [editor]
  )

  useEffect(
    () => () => codeHighlightingSource.destroy(),
    [codeHighlightingSource]
  )

  return (
    <Slate decorationSources={[codeHighlightingSource]} editor={editor}>
      <ExampleToolbar />
      <Editable
        onKeyDown={onKeyDown}
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

const ElementWrapper = (props: RenderElementProps) => {
  const { attributes, children, element, path } = props
  const editor = useEditor<CustomEditor>()

  if (element.type === CodeBlockType) {
    const setLanguage = (language: string) => {
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
  const handleClick = () => {
    editor.update((tx) => {
      tx.nodes.wrap(
        { type: CodeBlockType, language: 'html', children: [] },
        {
          match: (n: SlateNode) =>
            Node.isElement(n) && n.type === ParagraphType,
          split: true,
        }
      )
      tx.nodes.set(
        { type: CodeLineType },
        {
          match: (n: SlateNode) =>
            Node.isElement(n) && n.type === ParagraphType,
        }
      )
    })
  }

  return (
    <Button
      active
      data-test-id="code-block-button"
      onClick={handleClick}
      onPointerDown={(event: PointerEvent<HTMLButtonElement>) => {
        event.preventDefault()
      }}
    >
      <Icon>code</Icon>
    </Button>
  )
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
      Node.isElement(node) && node.type === CodeBlockType
        ? (node as CodeBlockElement).language
        : language

    if (Node.isText(node) && nodeLanguage) {
      projections.push(
        ...collectCodeTextProjections(node.text, nodePath, nodeLanguage)
      )
    }

    if (Node.isElement(node)) {
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
      Node.isElement(node) && node.type === CodeBlockType
        ? (node as CodeBlockElement).language
        : language

    if (Node.isText(node) && nodeLanguage) {
      const runtimeId = snapshot.index.pathToId[nodePath.join('.')]

      if (runtimeId) {
        runtimeIds.push(runtimeId)
      }
      return
    }

    if (Node.isElement(node)) {
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

const useOnKeydown = (editor: CustomEditor) => {
  const onKeyDown: React.KeyboardEventHandler<HTMLDivElement> = useCallback(
    (e) => {
      if (isHotkey('tab', e)) {
        // handle tab key, insert spaces
        e.preventDefault()

        editor.update((tx) => {
          tx.text.insert('  ')
        })
      }
    },
    [editor]
  )

  return onKeyDown
}

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

const initialValue: CustomElement[] = [
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
  const editor = useSlateEditor<CustomValue, CustomEditor>({
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
      'If you are using TypeScript, create the editor with a value generic and compose editor wrappers from that typed editor. The example below includes the custom types required for the rest of this example.'
    ),
  },
  {
    type: CodeBlockType,
    language: 'typescript',
    children: toCodeLines(`// TypeScript users only add this code
import { Descendant } from 'slate'
import type { ReactEditor } from 'slate-react'
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
]

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
