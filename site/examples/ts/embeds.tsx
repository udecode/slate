import React, { type ChangeEvent, useMemo } from 'react'
import { defineEditorExtension } from 'slate'
import {
  Editable,
  editableRenderers,
  type RenderElementProps,
  type RenderVoidProps,
  Slate,
  useEditor,
  useSlateEditor,
} from 'slate-react'
import type {
  CustomEditor,
  CustomElement,
  ParagraphElement as ParagraphElementType,
  VideoElement as VideoElementType,
} from './custom-types.d'

const EmbedsExample = () => {
  const editor = useSlateEditor({
    extensions: [embed()],
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
      <Editable placeholder="Enter some text..." />
    </Slate>
  )
}

const embed = () =>
  defineEditorExtension<CustomEditor>()({
    capabilities: editableRenderers<unknown, CustomElement>({
      elements: {
        paragraph: ParagraphElement,
      },
      voids: {
        video: ({ element }) => <VideoElement element={element} />,
      },
    }),
    name: 'embed',
    elements: [{ type: 'video', void: 'block' }],
  })

const ParagraphElement = ({
  attributes,
  children,
}: RenderElementProps<ParagraphElementType>) => (
  <p {...attributes}>{children}</p>
)

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
          const path = editor.api.dom.resolvePath(element)

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
