import { css } from '@emotion/css'
import imageExtensions from 'image-extensions'
import isUrl from 'is-url'
import type { PointerEvent } from 'react'
import { defineEditorExtension } from 'slate'
import { isHotkey } from 'slate-dom'
import {
  Editable,
  type RenderElementProps,
  type RenderVoidProps,
  Slate,
  useEditor,
  useEditorFocused,
  useElementSelected,
  useSlateEditor,
} from 'slate-react'

import { Button, Icon, Toolbar } from './components'
import type {
  CustomEditor,
  CustomElement,
  ImageElement,
  ParagraphElement,
} from './custom-types.d'

const ImagesExample = () => {
  const editor = useSlateEditor({
    extensions: [image()],
    initialValue: [
      {
        type: 'paragraph',
        children: [
          {
            text: 'In addition to nodes that contain editable text, you can also create other types of nodes, like images or videos.',
          },
        ],
      },
      {
        type: 'image',
        url: 'https://source.unsplash.com/kFrdX5IeQzI',
        children: [{ text: '' }],
      },
      {
        type: 'paragraph',
        children: [
          {
            text: 'This example shows images in action. It features two ways to add images. You can either add an image via the toolbar icon above, or if you want in on a little secret, copy an image URL to your clipboard and paste it anywhere in the editor!',
          },
        ],
      },
      {
        type: 'paragraph',
        children: [
          {
            text: 'You can delete images with the cross in the top left. Try deleting this sheep:',
          },
        ],
      },
      {
        type: 'image',
        url: 'https://source.unsplash.com/zOwZKwZOZq8',
        children: [{ text: '' }],
      },
    ],
  })

  return (
    <Slate editor={editor}>
      <Toolbar>
        <InsertImageButton />
      </Toolbar>
      <Editable
        onKeyDown={(event) => {
          if (!isHotkey('mod+a', event)) {
            return
          }

          editor.update((tx) => {
            tx.selection.set([])
          })

          return true
        }}
        placeholder="Enter some text..."
        renderElement={renderElement}
        renderVoid={renderVoid}
      />
    </Slate>
  )
}

const image = () =>
  defineEditorExtension<CustomEditor>()({
    name: 'image',
    clipboard: {
      insertData(data, { editor, next }) {
        const text = data.getData('text/plain')
        const imageFiles = Array.from(data.files ?? []).filter(
          (file) => file.type.split('/')[0] === 'image'
        )

        if (imageFiles.length > 0) {
          imageFiles.forEach((file) => {
            const reader = new FileReader()

            reader.addEventListener('load', () => {
              const url = reader.result
              insertImage(editor, url as string)
            })

            reader.readAsDataURL(file)
          })
          return true
        }

        if (isImageUrl(text)) {
          insertImage(editor, text)
          return true
        }
        return next()
      },
    },
    elements: [{ type: 'image', void: 'block' }],
  })

const renderElement = (props: RenderElementProps<CustomElement>) => {
  switch (props.element.type) {
    case 'paragraph':
      return <Paragraph {...(props as RenderElementProps<ParagraphElement>)} />
    default:
      return <p {...props.attributes}>{props.children}</p>
  }
}

const renderVoid = ({ element }: RenderVoidProps<CustomElement>) => {
  switch (element.type) {
    case 'image':
      return <Image element={element as ImageElement} />
    default:
      return null
  }
}

const insertImage = (editor: CustomEditor, url: string) => {
  const text = { text: '' }
  const image: ImageElement = { type: 'image', url, children: [text] }
  const paragraph: ParagraphElement = {
    type: 'paragraph',
    children: [{ text: '' }],
  }
  editor.update((tx) => {
    tx.nodes.insert(image)
    tx.nodes.insert(paragraph)
  })
}

const Paragraph = ({
  attributes,
  children,
}: RenderElementProps<ParagraphElement>) => <p {...attributes}>{children}</p>

const Image = ({ element }: RenderVoidProps<ImageElement>) => {
  const editor = useEditor<CustomEditor>()
  const focused = useEditorFocused()
  const selected = useElementSelected({ mode: 'collapsed' })

  return (
    <div style={{ position: 'relative' }}>
      <img
        className={css`
          display: block;
          max-width: 100%;
          max-height: 20em;
          box-shadow: ${selected && focused ? '0 0 0 3px #B4D5FF' : 'none'};
        `}
        src={element.url}
      />
      <Button
        active
        className={css`
          display: ${selected && focused ? 'inline' : 'none'};
          position: absolute;
          top: 0.5em;
          left: 0.5em;
          background-color: white;
        `}
        onClick={() => {
          const path = editor.api.dom.resolvePath(element)

          if (!path) {
            return
          }

          editor.update((tx) => {
            tx.nodes.remove({ at: path, voids: true })
          })
        }}
        onPointerDown={(event: PointerEvent<HTMLButtonElement>) => {
          event.preventDefault()
        }}
      >
        <Icon>delete</Icon>
      </Button>
    </div>
  )
}

const InsertImageButton = () => {
  const editor = useEditor<CustomEditor>()
  return (
    <Button
      onClick={() => {
        const url = window.prompt('Enter the URL of the image:')
        if (url && !isImageUrl(url)) {
          alert('URL is not an image')
          return
        }
        url && insertImage(editor, url)
      }}
      onPointerDown={(event: PointerEvent<HTMLButtonElement>) =>
        event.preventDefault()
      }
    >
      <Icon>image</Icon>
    </Button>
  )
}

const isImageUrl = (url: string): boolean => {
  if (!url) return false
  if (!isUrl(url)) return false
  const ext = new URL(url).pathname.split('.').pop()
  return imageExtensions.includes(ext!)
}

export default ImagesExample
