import { css } from '@emotion/css'
import imageExtensions from 'image-extensions'
import isHotkey from 'is-hotkey'
import isUrl from 'is-url'
import { type PointerEvent, useMemo } from 'react'
import { createEditor, defineEditorExtension } from 'slate'
import { withHistory } from 'slate-history'
import {
  Editable,
  type RenderElementProps,
  Slate,
  useSlateStatic,
  withReact,
} from 'slate-react'

import { Button, Icon, Toolbar } from './components'
import type {
  CustomEditor,
  CustomValue,
  ImageElement,
  ParagraphElement,
  RenderVoidPropsFor,
} from './custom-types.d'

const ImagesExample = () => {
  const editor = useMemo(
    () =>
      withImages(
        withHistory(withReact(createEditor<CustomValue>()))
      ) as CustomEditor,
    []
  )

  return (
    <Slate editor={editor} initialValue={initialValue}>
      <Toolbar>
        <InsertImageButton />
      </Toolbar>
      <Editable
        onKeyCommand={(event) => {
          if (isHotkey('mod+a', event)) {
            editor.update(() => {
              editor.select([])
            })
            return true
          }
        }}
        placeholder="Enter some text..."
        renderElement={(props: RenderElementProps) => <Element {...props} />}
        renderVoid={(props) => (
          <Image {...(props as RenderVoidPropsFor<ImageElement>)} />
        )}
      />
    </Slate>
  )
}

const imagesExtension = defineEditorExtension<CustomEditor>({
  name: 'images',
  methods(editor) {
    const nextInsertData = editor.insertData
    const nextIsVoid = editor.isVoid

    return {
      insertData(data: DataTransfer) {
        const text = data.getData('text/plain')
        const { files } = data

        if (files && files.length > 0) {
          Array.from(files).forEach((file) => {
            const reader = new FileReader()
            const [mime] = file.type.split('/')

            if (mime === 'image') {
              reader.addEventListener('load', () => {
                const url = reader.result
                insertImage(this, url as string)
              })

              reader.readAsDataURL(file)
            }
          })
        } else if (isImageUrl(text)) {
          insertImage(this, text)
        } else {
          nextInsertData(data)
        }
      },
      isVoid(element) {
        return element.type === 'image' ? true : nextIsVoid(element)
      },
    }
  },
})

const withImages = (editor: CustomEditor) => {
  editor.extend(imagesExtension)
  return editor
}

const insertImage = (editor: CustomEditor, url: string) => {
  const text = { text: '' }
  const image: ImageElement = { type: 'image', url, children: [text] }
  const paragraph: ParagraphElement = {
    type: 'paragraph',
    children: [{ text: '' }],
  }
  editor.update(() => {
    editor.insertNodes(image)
    editor.insertNodes(paragraph)
  })
}

const Element = (props: RenderElementProps) => {
  const { attributes, children } = props

  return <p {...attributes}>{children}</p>
}

const Image = ({
  actions,
  element,
  focused,
  selected,
}: RenderVoidPropsFor<ImageElement>) => {
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
        onClick={() => actions.remove()}
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
  const editor = useSlateStatic<CustomEditor>()
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

const initialValue: CustomValue = [
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
]

export default ImagesExample
