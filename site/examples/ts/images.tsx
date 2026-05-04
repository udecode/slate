import { css } from '@emotion/css'
import imageExtensions from 'image-extensions'
import isUrl from 'is-url'
import type { PointerEvent } from 'react'
import type { Path, Element as SlateElement } from 'slate'
import { isHotkey } from 'slate-dom'
import { withHistory } from 'slate-history'
import {
  Editable,
  type RenderElementProps,
  Slate,
  useEditor,
  useEditorFocused,
  useElementSelected,
  useSlateEditor,
} from 'slate-react'

import { Button, Icon, Toolbar } from './components'
import type {
  CustomEditor,
  CustomValue,
  ImageElement,
  ParagraphElement,
} from './custom-types.d'

const ImagesExample = () => {
  const editor = useSlateEditor<CustomValue, CustomEditor>({
    enhance: (editor) => withImages(withHistory(editor) as CustomEditor),
    initialValue,
  })

  return (
    <Slate editor={editor}>
      <Toolbar>
        <InsertImageButton />
      </Toolbar>
      <Editable
        onKeyDown={(event) => {
          if (isHotkey('mod+a', event)) {
            editor.update((tx) => {
              tx.selection.set([])
            })
            return true
          }
        }}
        placeholder="Enter some text..."
        renderElement={(props: RenderElementProps) => <Element {...props} />}
        renderVoid={(props) =>
          isImageElement(props.element) ? (
            <Image element={props.element} target={props.target} />
          ) : null
        }
      />
    </Slate>
  )
}

const withImages = (editor: CustomEditor) => {
  editor.extend({
    name: 'images',
    capabilities: {
      'dom.clipboard.insertData': (_editor: unknown, data: DataTransfer) =>
        insertImageData(editor, data),
    },
    elements: [{ type: 'image', void: 'block' }],
  })

  return editor
}

const insertImageData = (editor: CustomEditor, data: DataTransfer) => {
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

const isImageElement = (element: SlateElement): element is ImageElement =>
  element.type === 'image'

const Element = (props: RenderElementProps) => {
  const { attributes, children } = props

  return <p {...attributes}>{children}</p>
}

const Image = ({
  element,
  target,
}: {
  element: ImageElement
  target: Path
}) => {
  const editor = useEditor<CustomEditor>()
  const focused = useEditorFocused()
  const selected = useElementSelected(target)

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
          editor.update((tx) => {
            tx.nodes.remove({ at: target, voids: true })
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
