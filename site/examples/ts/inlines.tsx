import { css } from '@emotion/css'
import { isKeyHotkey } from 'is-hotkey'
import isUrl from 'is-url'
import type React from 'react'
import { type ClipboardEvent, type PointerEvent, useMemo } from 'react'
import { createEditor, defineEditorExtension, Editor, Node, Range } from 'slate'
import { withHistory } from 'slate-history'
import * as SlateReact from 'slate-react'
import {
  Editable,
  type EditableInputRule,
  type RenderElementProps,
  type RenderLeafProps,
  useSelected,
  useSlate,
  withReact,
} from 'slate-react'

import { Button, Icon, Toolbar } from './components'
import type {
  ButtonElement,
  CustomEditor,
  CustomElement,
  CustomValue,
  LinkElement,
  RenderElementPropsFor,
} from './custom-types.d'

const initialValue: CustomValue = [
  {
    type: 'paragraph',
    children: [
      {
        text: 'In addition to block nodes, you can create inline nodes. Here is a ',
      },
      {
        type: 'link',
        url: 'https://en.wikipedia.org/wiki/Hypertext',
        children: [{ text: 'hyperlink' }],
      },
      {
        text: ', and here is a more unusual inline: an ',
      },
      {
        type: 'button',
        children: [{ text: 'editable button' }],
      },
      {
        text: '! Here is a read-only inline: ',
      },
      {
        type: 'badge',
        children: [{ text: 'Approved' }],
      },
      {
        text: '.',
      },
    ],
  },
  {
    type: 'paragraph',
    children: [
      {
        text: 'There are two ways to add links. You can either add a link via the toolbar icon above, or if you want in on a little secret, copy a URL to your keyboard and paste it while a range of text is selected. ',
      },
      // The following is an example of an inline at the end of a block.
      // This is an edge case that can cause issues.
      {
        type: 'link',
        url: 'https://twitter.com/JustMissEmma/status/1448679899531726852',
        children: [{ text: 'Finally, here is our favorite dog video.' }],
      },
      { text: '' },
    ],
  },
]
const InlinesExample = () => {
  const editor = useMemo(
    () =>
      withInlines(
        withHistory(withReact(createEditor<CustomValue>()))
      ) as CustomEditor,
    []
  )
  const inputRules = useMemo<readonly EditableInputRule[]>(
    () => [
      ({ data, editor: ruleEditor, inputType }) =>
        inputType === 'insertText' &&
        typeof data === 'string' &&
        isUrl(data) &&
        wrapLink(ruleEditor as CustomEditor, data),
    ],
    []
  )
  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const text = event.clipboardData.getData('text/plain')

    if (text && isUrl(text)) {
      event.preventDefault()
      wrapLink(editor, text)
    }
  }

  const onKeyCommand = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const selection = editor.getSelection()

    // Default left/right behavior is unit:'character'.
    // This fails to distinguish between two cursor positions, such as
    // <inline>foo<cursor/></inline> vs <inline>foo</inline><cursor/>.
    // Here we modify the behavior to unit:'offset'.
    // This lets the user step into and out of the inline without stepping over characters.
    // You may wish to customize this further to only use unit:'offset' in specific cases.
    if (selection && Range.isCollapsed(selection)) {
      const { nativeEvent } = event
      if (isKeyHotkey('left', nativeEvent)) {
        editor.update(() => {
          editor.move({ unit: 'offset', reverse: true })
        })
        return true
      }
      if (isKeyHotkey('right', nativeEvent)) {
        editor.update(() => {
          editor.move({ unit: 'offset' })
        })
        return true
      }
    }
  }

  return (
    <SlateReact.Slate editor={editor} initialValue={initialValue}>
      <Toolbar>
        <AddLinkButton />
        <RemoveLinkButton />
        <ToggleEditableButtonButton />
      </Toolbar>
      <Editable
        inputRules={inputRules}
        onKeyCommand={onKeyCommand}
        onPaste={onPaste}
        placeholder="Enter some text..."
        renderElement={(props: RenderElementProps) => <Element {...props} />}
        renderLeaf={(props: RenderLeafProps) => <Text {...props} />}
      />
    </SlateReact.Slate>
  )
}

const inlinesExtension = defineEditorExtension<CustomEditor>({
  name: 'inlines',
  methods(editor) {
    const nextIsElementReadOnly = editor.isElementReadOnly
    const nextIsInline = editor.isInline
    const nextIsSelectable = editor.isSelectable

    return {
      isElementReadOnly(element: CustomElement) {
        return element.type === 'badge' || nextIsElementReadOnly(element)
      },
      isInline(element: CustomElement) {
        return (
          ['link', 'button', 'badge'].includes(element.type) ||
          nextIsInline(element)
        )
      },
      isSelectable(element: CustomElement) {
        return element.type !== 'badge' && nextIsSelectable(element)
      },
    }
  },
})

const withInlines = (editor: CustomEditor) => {
  editor.extend(inlinesExtension)
  return editor
}

const insertLink = (editor: CustomEditor, url: string) => {
  if (Editor.getSelection(editor)) {
    wrapLink(editor, url)
  }
}

const insertButton = (editor: CustomEditor) => {
  if (Editor.getSelection(editor)) {
    wrapButton(editor)
  }
}

const isLinkActive = (editor: CustomEditor): boolean => {
  const [link] = Editor.nodes(editor, {
    match: (n) => Node.isElement(n) && n.type === 'link',
  })
  return !!link
}

const isButtonActive = (editor: CustomEditor): boolean => {
  const [button] = Editor.nodes(editor, {
    match: (n) => Node.isElement(n) && n.type === 'button',
  })
  return !!button
}

const unwrapLink = (editor: CustomEditor) => {
  editor.update(() => {
    editor.unwrapNodes({
      match: (n) => Node.isElement(n) && n.type === 'link',
    })
  })
}

const unwrapButton = (editor: CustomEditor) => {
  editor.update(() => {
    editor.unwrapNodes({
      match: (n) => Node.isElement(n) && n.type === 'button',
    })
  })
}

const wrapLink = (editor: CustomEditor, url: string) => {
  if (isLinkActive(editor)) {
    unwrapLink(editor)
  }

  const selection = editor.getSelection()
  const isCollapsed = selection && Range.isCollapsed(selection)
  const link: LinkElement = {
    type: 'link',
    url,
    children: isCollapsed ? [{ text: url }] : [],
  }

  editor.update(() => {
    if (isCollapsed) {
      editor.insertNodes(link)
    } else {
      editor.wrapNodes(link, { split: true })
      editor.collapse({ edge: 'end' })
    }
  })

  return true
}

const wrapButton = (editor: CustomEditor) => {
  if (isButtonActive(editor)) {
    unwrapButton(editor)
  }

  const selection = editor.getSelection()
  const isCollapsed = selection && Range.isCollapsed(selection)
  const button: ButtonElement = {
    type: 'button',
    children: isCollapsed ? [{ text: 'Edit me!' }] : [],
  }

  editor.update(() => {
    if (isCollapsed) {
      editor.insertNodes(button)
    } else {
      editor.wrapNodes(button, { split: true })
      editor.collapse({ edge: 'end' })
    }
  })
}

// Put this at the start and end of an inline component to work around this Chromium bug:
// https://bugs.chromium.org/p/chromium/issues/detail?id=1249405
const InlineChromiumBugfix = () => (
  <span
    className={css`
      font-size: 0;
    `}
    contentEditable={false}
  >
    {String.fromCodePoint(160) /* Non-breaking space */}
  </span>
)

const allowedSchemes = ['http:', 'https:', 'mailto:', 'tel:']

const LinkComponent = ({
  attributes,
  children,
  element,
}: RenderElementPropsFor<LinkElement>) => {
  const selected = useSelected()
  const safeUrl = useMemo(() => {
    let parsedUrl: URL | null = null
    try {
      parsedUrl = new URL(element.url)
      // eslint-disable-next-line no-empty
    } catch {}
    if (parsedUrl && allowedSchemes.includes(parsedUrl.protocol)) {
      return parsedUrl.href
    }
    return 'about:blank'
  }, [element.url])

  return (
    <a
      {...attributes}
      className={
        selected
          ? css`
              box-shadow: 0 0 0 3px #ddd;
            `
          : ''
      }
      href={safeUrl}
    >
      <InlineChromiumBugfix />
      {children}
      <InlineChromiumBugfix />
    </a>
  )
}

const EditableButtonComponent = ({
  attributes,
  children,
}: RenderElementProps) => {
  return (
    /*
      Note that this is not a true button, but a span with button-like CSS.
      True buttons are display:inline-block, but Chrome and Safari
      have a bad bug with display:inline-block inside contenteditable:
      - https://bugs.webkit.org/show_bug.cgi?id=105898
      - https://bugs.chromium.org/p/chromium/issues/detail?id=1088403
      Worse, one cannot override the display property: https://github.com/w3c/csswg-drafts/issues/3226
      The only current workaround is to emulate the appearance of a display:inline button using CSS.
    */
    <span
      {...attributes}
      // Margin is necessary to clearly show the cursor adjacent to the button
      className={css`
        margin: 0 0.1em;

        background-color: #efefef;
        padding: 2px 6px;
        border: 1px solid #767676;
        border-radius: 2px;
        font-size: 0.9em;
      `}
      onClick={(ev) => ev.preventDefault()}
    >
      <InlineChromiumBugfix />
      {children}
      <InlineChromiumBugfix />
    </span>
  )
}

const BadgeComponent = ({
  attributes,
  children,
  element,
}: RenderElementProps) => {
  const selected = useSelected()

  return (
    <span
      {...attributes}
      className={css`
        background-color: green;
        color: white;
        padding: 2px 6px;
        border-radius: 2px;
        font-size: 0.9em;
        ${selected && 'box-shadow: 0 0 0 3px #ddd;'}
      `}
      contentEditable={false}
      data-playwright-selected={selected}
    >
      <InlineChromiumBugfix />
      {children}
      <InlineChromiumBugfix />
    </span>
  )
}

const Element = (props: RenderElementProps) => {
  const { attributes, children, element } = props
  switch (element.type) {
    case 'link':
      return <LinkComponent {...props} />
    case 'button':
      return <EditableButtonComponent {...props} />
    case 'badge':
      return <BadgeComponent {...props} />
    default:
      return <p {...attributes}>{children}</p>
  }
}

const Text = (props: RenderLeafProps) => {
  const { attributes, children, leaf } = props
  return (
    <span
      // The following is a workaround for a Chromium bug where,
      // if you have an inline at the end of a block,
      // clicking the end of a block puts the cursor inside the inline
      // instead of inside the final {text: ''} node
      // https://github.com/ianstormtaylor/slate/issues/4704#issuecomment-1006696364
      className={
        leaf.text === ''
          ? css`
              padding-left: 0.1px;
            `
          : undefined
      }
      {...attributes}
    >
      {children}
    </span>
  )
}

const AddLinkButton = () => {
  const editor = useSlate<CustomEditor>()
  return (
    <Button
      active={isLinkActive(editor)}
      onClick={() => {
        const url = window.prompt('Enter the URL of the link:')
        if (!url) return
        insertLink(editor, url)
      }}
      onPointerDown={(event: PointerEvent<HTMLButtonElement>) =>
        event.preventDefault()
      }
    >
      <Icon>link</Icon>
    </Button>
  )
}

const RemoveLinkButton = () => {
  const editor = useSlate<CustomEditor>()

  return (
    <Button
      active={isLinkActive(editor)}
      onClick={() => {
        if (isLinkActive(editor)) {
          unwrapLink(editor)
        }
      }}
      onPointerDown={(event: PointerEvent<HTMLButtonElement>) =>
        event.preventDefault()
      }
    >
      <Icon>link_off</Icon>
    </Button>
  )
}

const ToggleEditableButtonButton = () => {
  const editor = useSlate<CustomEditor>()
  return (
    <Button
      active
      onClick={() => {
        if (isButtonActive(editor)) {
          unwrapButton(editor)
        } else {
          insertButton(editor)
        }
      }}
      onPointerDown={(event: PointerEvent<HTMLButtonElement>) =>
        event.preventDefault()
      }
    >
      <Icon>smart_button</Icon>
    </Button>
  )
}

export default InlinesExample
