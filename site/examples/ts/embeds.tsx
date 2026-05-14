import React, { type ChangeEvent, useMemo } from 'react'
import type { Element as SlateElement } from 'slate'
import { withHistory } from 'slate-history'
import {
  Editable,
  type RenderElementProps,
  type RenderVoidProps,
  Slate,
  useEditor,
  useSlateEditor,
} from 'slate-react'
import type {
  CustomEditor,
  CustomValue,
  VideoElement as VideoElementType,
} from './custom-types.d'

const EmbedsExample = () => {
  const editor = useSlateEditor<CustomValue, CustomEditor>({
    withEditor: (editor) => withEmbeds(withHistory(editor)),
    initialValue: [
      {
        type: 'paragraph',
        children: [
          {
            text: 'In addition to simple image nodes, you can actually create complex embedded nodes. For example, this one contains an input element that lets you change the video being rendered!',
          },
        ],
      },
      {
        type: 'video',
        url: 'https://player.vimeo.com/video/26689853',
        children: [{ text: '' }],
      },
      {
        type: 'paragraph',
        children: [
          {
            text: 'Try it out! This editor is built to handle Vimeo embeds, but you could handle any type.',
          },
        ],
      },
    ],
  })
  return (
    <Slate editor={editor}>
      <Editable
        placeholder="Enter some text..."
        renderElement={(props) => <Element {...props} />}
        renderVoid={(props) =>
          isVideoElement(props.element) ? (
            <VideoElement element={props.element} />
          ) : null
        }
      />
    </Slate>
  )
}

const withEmbeds = (editor: CustomEditor) => {
  editor.extend({
    name: 'embeds',
    elements: [{ type: 'video', void: 'block' }],
  })

  return editor
}

const Element = (props: RenderElementProps) => {
  const { attributes, children } = props

  return <p {...attributes}>{children}</p>
}

const isVideoElement = (element: SlateElement): element is VideoElementType =>
  element.type === 'video'

const allowedSchemes = ['http:', 'https:']

const VideoElement = ({ element }: RenderVoidProps<VideoElementType>) => {
  const editor = useEditor<CustomEditor>()
  const { url } = element

  const safeUrl = useMemo(() => {
    let parsedUrl: URL | null = null
    try {
      parsedUrl = new URL(url)
    } catch {}
    if (parsedUrl && allowedSchemes.includes(parsedUrl.protocol)) {
      return parsedUrl.href
    }
    return 'about:blank'
  }, [url])

  return (
    <>
      <div
        style={{
          padding: '75% 0 0 0',
          position: 'relative',
        }}
      >
        <iframe
          frameBorder="0"
          src={`${safeUrl}?title=0&byline=0&portrait=0`}
          style={{
            position: 'absolute',
            top: '0',
            left: '0',
            width: '100%',
            height: '100%',
          }}
        />
      </div>
      <UrlInput
        onChange={(val) => {
          const path = editor.dom.resolvePath(element)

          if (!path) {
            return
          }

          editor.update((tx) => {
            tx.nodes.set({ url: val }, { at: path, voids: true })
          })
        }}
        url={url}
      />
    </>
  )
}

interface UrlInputProps {
  url: string
  onChange: (url: string) => void
}

const UrlInput = ({ url, onChange }: UrlInputProps) => {
  const [value, setValue] = React.useState(url)
  return (
    <input
      onChange={(e: ChangeEvent<HTMLInputElement>) => {
        const newUrl = e.target.value
        setValue(newUrl)
        onChange(newUrl)
      }}
      onClick={(e: React.MouseEvent) => e.stopPropagation()}
      style={{
        marginTop: '5px',
        boxSizing: 'border-box',
      }}
      type="text"
      value={value}
    />
  )
}

export default EmbedsExample
