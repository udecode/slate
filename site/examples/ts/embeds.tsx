import React, { type ChangeEvent, useMemo } from 'react'
import { createEditor, defineEditorExtension } from 'slate'
import { withHistory } from 'slate-history'
import {
  Editable,
  type RenderElementProps,
  Slate,
  withReact,
} from 'slate-react'
import type {
  CustomEditor,
  CustomValue,
  RenderVoidPropsFor,
  VideoElement as VideoElementType,
} from './custom-types.d'

const EmbedsExample = () => {
  const editor = useMemo(
    () => withEmbeds(withHistory(withReact(createEditor<CustomValue>()))),
    []
  )
  return (
    <Slate editor={editor} initialValue={initialValue}>
      <Editable
        placeholder="Enter some text..."
        renderElement={(props) => <Element {...props} />}
        renderVoid={(props) => (
          <VideoElement {...(props as RenderVoidPropsFor<VideoElementType>)} />
        )}
      />
    </Slate>
  )
}

const embedsExtension = defineEditorExtension<CustomEditor>({
  name: 'embeds',
  methods(editor) {
    const nextIsVoid = editor.isVoid

    return {
      isVoid(element) {
        return element.type === 'video' ? true : nextIsVoid(element)
      },
    }
  },
})

const withEmbeds = (editor: CustomEditor) => {
  editor.extend(embedsExtension)
  return editor
}

const Element = (props: RenderElementProps) => {
  const { attributes, children } = props

  return <p {...attributes}>{children}</p>
}

const allowedSchemes = ['http:', 'https:']

const VideoElement = ({
  actions,
  element,
}: RenderVoidPropsFor<VideoElementType>) => {
  const { url } = element

  const safeUrl = useMemo(() => {
    let parsedUrl: URL | null = null
    try {
      parsedUrl = new URL(url)
      // eslint-disable-next-line no-empty
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
          actions.setElement({ url: val })
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

const initialValue: CustomValue = [
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
]

export default EmbedsExample
