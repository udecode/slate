import { css } from '@emotion/css'
import type { ChangeEvent } from 'react'
import {
  defineEditorExtension,
  type Editor,
  NodeApi,
  PointApi,
  RangeApi,
  type Element as SlateElement,
} from 'slate'
import { history } from 'slate-history'
import {
  Editable,
  type RenderElementProps,
  Slate,
  useEditor,
  useEditorReadOnly,
  useSlateEditor,
} from 'slate-react'
import type {
  CheckListItemElement as CheckListItemType,
  CustomEditor,
  RenderElementPropsFor,
} from './custom-types.d'

const CheckListsExample = () => {
  const editor = useSlateEditor({
    extensions: [history(), checklist()],
    initialValue: [
      {
        type: 'paragraph',
        children: [
          {
            text: 'With Slate you can build complex block types that have their own embedded content and behaviors, like rendering checkboxes inside check list items!',
          },
        ],
      },
      {
        type: 'check-list-item',
        checked: true,
        children: [{ text: 'Slide to the left.' }],
      },
      {
        type: 'check-list-item',
        checked: true,
        children: [{ text: 'Slide to the right.' }],
      },
      {
        type: 'check-list-item',
        checked: false,
        children: [{ text: 'Criss-cross.' }],
      },
      {
        type: 'check-list-item',
        checked: true,
        children: [{ text: 'Criss-cross!' }],
      },
      {
        type: 'check-list-item',
        checked: false,
        children: [{ text: 'Cha cha real smooth…' }],
      },
      {
        type: 'check-list-item',
        checked: false,
        children: [{ text: "Let's go to work!" }],
      },
      {
        type: 'paragraph',
        children: [{ text: 'Try it out for yourself!' }],
      },
    ],
  })

  return (
    <Slate editor={editor}>
      <Editable
        autoFocus
        placeholder="Get to work…"
        renderElement={Element}
        spellCheck
      />
    </Slate>
  )
}

const checklist = () =>
  defineEditorExtension({
    name: 'checklists',
    transforms: {
      deleteBackward({ editor, next }) {
        if (applyChecklistBackspaceStart(editor)) return

        next()
      },
    },
  })

const applyChecklistBackspaceStart = (editor: Editor) => {
  const selection = editor.read((state) => state.selection.get())

  if (!selection || !RangeApi.isCollapsed(selection)) {
    return false
  }

  const match = editor.read((state) =>
    state.nodes.find({
      match: (n) => NodeApi.isElement(n) && n.type === 'check-list-item',
    })
  )

  if (!match) {
    return false
  }

  const [, path] = match
  const start = editor.read((state) => state.points.start(path))

  if (!PointApi.equals(selection.anchor, start)) {
    return false
  }

  const newProperties: Partial<SlateElement> = {
    type: 'paragraph',
  }
  editor.update((tx) => {
    tx.nodes.set(newProperties, {
      match: (n) => NodeApi.isElement(n) && n.type === 'check-list-item',
    })
    tx.selection.set(start)
  })
  return true
}

const Element = (props: RenderElementProps) => {
  const { attributes, children, element } = props

  switch (element.type) {
    case 'check-list-item':
      return <CheckListItemElement {...props} />
    default:
      return <p {...attributes}>{children}</p>
  }
}

const CheckListItemElement = ({
  attributes,
  children,
  element,
}: RenderElementPropsFor<CheckListItemType>) => {
  const { checked } = element
  const editor = useEditor<CustomEditor>()
  const readOnly = useEditorReadOnly()
  return (
    <div
      {...attributes}
      className={css`
        display: flex;
        flex-direction: row;
        align-items: center;

        & + & {
          margin-top: 0;
        }
      `}
    >
      <span
        className={css`
          margin-right: 0.75em;
        `}
        contentEditable={false}
      >
        <input
          checked={checked}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            const path = editor.api.dom.resolvePath(element)

            if (!path) {
              return
            }

            const newProperties: Partial<SlateElement> = {
              checked: event.target.checked,
            }
            editor.update((tx) => {
              tx.nodes.set(newProperties, { at: path })
            })
          }}
          type="checkbox"
        />
      </span>
      <span
        className={css`
          flex: 1;
          opacity: ${checked ? 0.666 : 1};
          text-decoration: ${checked ? 'line-through' : 'none'};

          &:focus {
            outline: none;
          }
        `}
        contentEditable={!readOnly}
        suppressContentEditableWarning
      >
        {children}
      </span>
    </div>
  )
}

export default CheckListsExample
