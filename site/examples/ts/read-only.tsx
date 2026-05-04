import type { Value } from 'slate'
import { Editable, Slate, useSlateEditor } from 'slate-react'

const ReadOnlyExample = () => {
  const editor = useSlateEditor({ initialValue })
  return (
    <Slate editor={editor}>
      <Editable placeholder="Enter some plain text..." readOnly />
    </Slate>
  )
}

const initialValue: Value = [
  {
    type: 'paragraph',
    children: [
      {
        text: 'This example shows what happens when the Editor is set to readOnly, it is not editable',
      },
    ],
  },
]

export default ReadOnlyExample
