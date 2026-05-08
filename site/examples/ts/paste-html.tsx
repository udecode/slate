import { css } from '@emotion/css'
import type React from 'react'
import { useCallback, useMemo } from 'react'
import type { Element as SlateElement } from 'slate'
import { withHistory } from 'slate-history'
import {
  Editable,
  type RenderElementProps,
  type RenderLeafProps,
  type RenderVoidProps,
  Slate,
  useEditorFocused,
  useElementSelected,
  useSlateEditor,
} from 'slate-react'

import type {
  CustomEditor,
  CustomValue,
  ImageElement as ImageElementType,
} from './custom-types.d'
import { withHtml } from './paste-html-import'

const PasteHtmlExample = () => {
  const renderElement = useCallback(
    (props: RenderElementProps) => <Element {...props} />,
    []
  )
  const renderLeaf = useCallback(
    (props: RenderLeafProps) => <Leaf {...props} />,
    []
  )
  const editor = useSlateEditor<CustomValue, CustomEditor>({
    withEditor: (editor) => withHtml(withHistory(editor)),
    initialValue,
  })
  return (
    <Slate editor={editor}>
      <Editable
        placeholder="Paste in some HTML..."
        renderElement={renderElement}
        renderLeaf={renderLeaf}
        renderVoid={(props) =>
          isImageElement(props.element) ? (
            <ImageElement element={props.element} path={props.path} />
          ) : null
        }
      />
    </Slate>
  )
}

const Element = (props: RenderElementProps) => {
  const { attributes, children, element } = props

  switch (element.type) {
    case 'block-quote':
      return <blockquote {...attributes}>{children}</blockquote>
    case 'code-block':
      return (
        <pre>
          <code {...attributes}>{children}</code>
        </pre>
      )
    case 'bulleted-list':
      return <ul {...attributes}>{children}</ul>
    case 'heading-one':
      return <h1 {...attributes}>{children}</h1>
    case 'heading-two':
      return <h2 {...attributes}>{children}</h2>
    case 'heading-three':
      return <h3 {...attributes}>{children}</h3>
    case 'heading-four':
      return <h4 {...attributes}>{children}</h4>
    case 'heading-five':
      return <h5 {...attributes}>{children}</h5>
    case 'heading-six':
      return <h6 {...attributes}>{children}</h6>
    case 'list-item':
      return <li {...attributes}>{children}</li>
    case 'numbered-list':
      return <ol {...attributes}>{children}</ol>
    case 'table':
      return (
        <table>
          <tbody {...attributes}>{children}</tbody>
        </table>
      )
    case 'table-cell':
      return <td {...attributes}>{children}</td>
    case 'table-row':
      return <tr {...attributes}>{children}</tr>
    case 'link':
      return (
        <SafeLink attributes={attributes} href={element.url}>
          {children}
        </SafeLink>
      )
    default:
      return <p {...attributes}>{children}</p>
  }
}

const allowedSchemes = ['http:', 'https:', 'mailto:', 'tel:']

interface SafeLinkProps {
  attributes: Record<string, unknown>
  children: React.ReactNode
  href: string
}

const SafeLink = ({ children, href, attributes }: SafeLinkProps) => {
  const safeHref = useMemo(() => {
    let parsedUrl: URL | null = null
    try {
      parsedUrl = new URL(href)
      // eslint-disable-next-line no-empty
    } catch {}
    if (parsedUrl && allowedSchemes.includes(parsedUrl.protocol)) {
      return parsedUrl.href
    }
    return 'about:blank'
  }, [href])

  return (
    <a href={safeHref} {...attributes}>
      {children}
    </a>
  )
}

const ImageElement = ({ element, path }: RenderVoidProps<ImageElementType>) => {
  const focused = useEditorFocused()
  const selected = useElementSelected(path)

  return (
    <img
      className={css`
        display: block;
        max-width: 100%;
        max-height: 20em;
        box-shadow: ${selected && focused ? '0 0 0 2px blue;' : 'none'};
      `}
      src={element.url}
    />
  )
}

const isImageElement = (element: SlateElement): element is ImageElementType =>
  element.type === 'image'

const Leaf = ({ attributes, children, leaf }: RenderLeafProps) => {
  const leafFontSize = (leaf as unknown as { fontSize?: unknown }).fontSize
  const fontSize = typeof leafFontSize === 'string' ? leafFontSize : undefined

  if (leaf.bold) {
    children = <strong>{children}</strong>
  }

  if (leaf.code) {
    children = <code>{children}</code>
  }

  if (leaf.italic) {
    children = <em>{children}</em>
  }

  if (leaf.underline) {
    children = <u>{children}</u>
  }

  if (leaf.strikethrough) {
    children = <del>{children}</del>
  }

  return (
    <span {...attributes} style={fontSize ? { fontSize } : undefined}>
      {children}
    </span>
  )
}

const initialValue: CustomValue = [
  {
    type: 'paragraph',
    children: [
      {
        text: "By default, pasting content into a Slate editor will use the clipboard's ",
      },
      { text: "'text/plain'", code: true },
      {
        text: " data. That's okay for some use cases, but sometimes you want users to be able to paste in content and have it maintain its formatting. To do this, your editor needs to handle ",
      },
      { text: "'text/html'", code: true },
      { text: ' data. ' },
    ],
  },
  {
    type: 'paragraph',
    children: [{ text: 'This is an example of doing exactly that!' }],
  },
  {
    type: 'paragraph',
    children: [
      {
        text: "Try it out for yourself! Copy and paste some rendered HTML rich text content (not the source code) from another site into this editor and it's formatting should be preserved.",
      },
    ],
  },
]

export default PasteHtmlExample
