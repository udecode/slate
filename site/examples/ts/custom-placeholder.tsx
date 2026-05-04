import type { Value } from 'slate'
import { withHistory } from 'slate-history'
import {
  Editable,
  type RenderPlaceholderProps,
  Slate,
  useSlateEditor,
} from 'slate-react'

const initialValue: Value = [
  {
    type: 'paragraph',
    children: [{ text: '' }],
  },
]

const PlainTextExample = () => {
  const editor = useSlateEditor({ withEditor: withHistory, initialValue })
  return (
    <Slate editor={editor}>
      <Editable
        placeholder="Type something"
        renderPlaceholder={({
          children,
          attributes,
        }: RenderPlaceholderProps) => (
          <div {...attributes}>
            <p>{children}</p>
            <pre>
              Use the renderPlaceholder prop to customize rendering of the
              placeholder
            </pre>
          </div>
        )}
      />
    </Slate>
  )
}

export default PlainTextExample
