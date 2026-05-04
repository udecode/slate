import type { Value } from 'slate'
import { withHistory } from 'slate-history'
import { Editable, Slate, useSlateEditor } from 'slate-react'

const PlainTextExample = () => {
  const editor = useSlateEditor({ enhance: withHistory, initialValue })
  return (
    <Slate editor={editor}>
      <Editable placeholder="Enter some plain text..." />
    </Slate>
  )
}

const initialValue: Value = [
  {
    type: 'paragraph',
    children: [
      { text: 'This is editable plain text, just like a <textarea>!' },
    ],
  },
]

export default PlainTextExample
