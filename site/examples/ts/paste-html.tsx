import { css } from '@emotion/css'
import type React from 'react'
import { useMemo } from 'react'
import type { Element as SlateElement } from 'slate'
import { withHistory } from 'slate-history'
import {
  Editable,
  type RenderElementProps,
  type RenderLeafProps,
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
  const editor = useSlateEditor<CustomValue, CustomEditor>({
    withEditor: (editor) => withHtml(withHistory(editor)),
    initialValue: [
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
    ],
  })

  return (
    <Slate editor={editor}>
      <Editable
        placeholder="Paste in some HTML..."
        renderElement={Element}
        renderLeaf={Leaf}
        renderVoid={(props) =>
          isImageElement(props.element) ? (
            <ImageElement element={props.element} />
          ) : null
        }
      />
    </Slate>
  )
}

const Element = (props: RenderElementProps) => {
  const { attributes, children, element } = props
  const style = getElementStyle(element)

  switch (element.type) {
    case 'block-quote':
      return (
        <blockquote style={style} {...attributes}>
          {children}
        </blockquote>
      )
    case 'code-block':
      return (
        <pre>
          <code {...attributes}>{children}</code>
        </pre>
      )
    case 'bulleted-list':
      return (
        <ul style={style} {...attributes}>
          {children}
        </ul>
      )
    case 'heading-one':
      return (
        <h1 style={style} {...attributes}>
          {children}
        </h1>
      )
    case 'heading-two':
      return (
        <h2 style={style} {...attributes}>
          {children}
        </h2>
      )
    case 'heading-three':
      return (
        <h3 style={style} {...attributes}>
          {children}
        </h3>
      )
    case 'heading-four':
      return (
        <h4 style={style} {...attributes}>
          {children}
        </h4>
      )
    case 'heading-five':
      return (
        <h5 style={style} {...attributes}>
          {children}
        </h5>
      )
    case 'heading-six':
      return (
        <h6 style={style} {...attributes}>
          {children}
        </h6>
      )
    case 'list-item':
      return (
        <li style={style} {...attributes}>
          {children}
        </li>
      )
    case 'numbered-list':
      return (
        <ol style={style} {...attributes}>
          {children}
        </ol>
      )
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
      return (
        <p style={style} {...attributes}>
          {children}
        </p>
      )
  }
}

const getElementStyle = (
  element: SlateElement
): React.CSSProperties | undefined => {
  const align =
    'align' in element && typeof element.align === 'string'
      ? element.align
      : undefined

  return align
    ? { textAlign: align as React.CSSProperties['textAlign'] }
    : undefined
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

const ImageElement = ({ element }: { element: ImageElementType }) => {
  const focused = useEditorFocused()
  const selected = useElementSelected()

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

export default PasteHtmlExample
