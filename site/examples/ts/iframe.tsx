import type React from 'react'
import { type PointerEvent, useState } from 'react'
import { createPortal } from 'react-dom'
import { defineEditorExtension } from 'slate'
import { isHotkey } from 'slate-dom'
import {
  Editable,
  type EditableLeafRendererProps,
  editableKeyCommands,
  editableRenderers,
  type RenderElementProps,
  Slate,
  useEditor,
  useEditorSelector,
  useSlateEditor,
} from 'slate-react'

import { Button, Icon, Toolbar } from './components'
import type {
  CustomEditor,
  CustomText,
  CustomTextKey,
  CustomValue,
  ParagraphElement as ParagraphElementType,
} from './custom-types.d'
import { isMarkActive, toggleMark } from './mark-utils'

const HOTKEYS: Record<string, CustomTextKey> = {
  'mod+b': 'bold',
  'mod+i': 'italic',
  'mod+u': 'underline',
  'mod+`': 'code',
}

const MARK_HOTKEYS = Object.entries(HOTKEYS)

const IFrameExample = () => {
  const initialValue: CustomValue = [
    {
      type: 'paragraph',
      children: [
        {
          text: 'In this example, the document gets rendered into a controlled ',
        },
        { text: '<iframe>', code: true },
        {
          text: '. This is ',
        },
        {
          text: 'particularly',
          italic: true,
        },
        {
          text: ' useful, when you need to separate the styles for your editor contents from the ones addressing your UI.',
        },
      ],
    },
    {
      type: 'paragraph',
      children: [
        {
          text: 'This also the only reliable method to preview any ',
        },
        {
          text: 'media queries',
          bold: true,
        },
        {
          text: ' in your CSS.',
        },
      ],
    },
  ]
  const editor = useSlateEditor({
    extensions: [iframeKeyCommands()],
    initialValue,
  })

  return (
    <Slate editor={editor}>
      <Toolbar>
        <MarkButton format="bold" icon="format_bold" />
        <MarkButton format="italic" icon="format_italic" />
        <MarkButton format="underline" icon="format_underlined" />
        <MarkButton format="code" icon="code" />
      </Toolbar>
      <IFrame onBlur={() => editor.api.dom.deselect()}>
        <Editable autoFocus placeholder="Enter some rich text…" spellCheck />
      </IFrame>
    </Slate>
  )
}

const iframeKeyCommands = () =>
  defineEditorExtension<CustomEditor>()({
    capabilities: {
      ...editableRenderers<CustomText, ParagraphElementType>({
        elements: {
          paragraph: ParagraphElement,
        },
        leaves: {
          underline: UnderlineLeaf,
          italic: ItalicLeaf,
          code: CodeLeaf,
          bold: BoldLeaf,
        },
      }),
      ...editableKeyCommands(({ editor, event }) => {
        const iframeEditor = editor as unknown as CustomEditor

        for (const [hotkey, mark] of MARK_HOTKEYS) {
          if (isHotkey(hotkey, event)) {
            toggleMark(iframeEditor, mark)
            return true
          }
        }
      }),
    },
    name: 'iframe-key-commands',
  })

const ParagraphElement = ({
  attributes,
  children,
}: RenderElementProps<ParagraphElementType>) => (
  <p {...attributes}>{children}</p>
)

const BoldLeaf = ({ children }: EditableLeafRendererProps<CustomText>) => (
  <strong>{children}</strong>
)

const CodeLeaf = ({ children }: EditableLeafRendererProps<CustomText>) => (
  <code>{children}</code>
)

const ItalicLeaf = ({ children }: EditableLeafRendererProps<CustomText>) => (
  <em>{children}</em>
)

const UnderlineLeaf = ({ children }: EditableLeafRendererProps<CustomText>) => (
  <u>{children}</u>
)

interface MarkButtonProps {
  format: CustomTextKey
  icon: string
}

const MarkButton = ({ format, icon }: MarkButtonProps) => {
  const editor = useEditor<CustomEditor>()
  const active = useEditorSelector((editor: CustomEditor) =>
    isMarkActive(editor, format)
  )
  return (
    <Button
      active={active}
      onClick={() => toggleMark(editor, format)}
      onPointerDown={(event: PointerEvent<HTMLButtonElement>) => {
        event.preventDefault()
      }}
    >
      <Icon>{icon}</Icon>
    </Button>
  )
}

interface IFrameProps extends React.IframeHTMLAttributes<HTMLIFrameElement> {
  children: React.ReactNode
}

const IFrame = ({ children, ...props }: IFrameProps) => {
  const [iframeBody, setIframeBody] = useState<HTMLElement | null>(null)
  const handleLoad = (e: React.SyntheticEvent<HTMLIFrameElement>) => {
    const iframe = e.target as HTMLIFrameElement
    if (!iframe.contentDocument) return
    setIframeBody(iframe.contentDocument.body)
  }
  return (
    <iframe srcDoc={'<!DOCTYPE html>'} {...props} onLoad={handleLoad}>
      {iframeBody && createPortal(children, iframeBody)}
    </iframe>
  )
}

export default IFrameExample
