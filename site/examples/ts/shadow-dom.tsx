import { useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import type { Value } from 'slate'
import { withHistory } from 'slate-history'
import { Editable, Slate, useSlateEditor } from 'slate-react'

const ShadowDOM = () => {
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (container.current!.shadowRoot) return

    // Create a shadow DOM
    const outerShadowRoot = container.current!.attachShadow({ mode: 'open' })
    const host = document.createElement('div')
    outerShadowRoot.appendChild(host)

    // Create a nested shadow DOM
    const innerShadowRoot = host.attachShadow({ mode: 'open' })
    const reactRoot = document.createElement('div')
    innerShadowRoot.appendChild(reactRoot)

    // Render the editor within the nested shadow DOM
    const root = createRoot(reactRoot)
    root.render(<ShadowEditor />)
  })

  return <div data-cy="outer-shadow-root" ref={container} />
}

const ShadowEditor = () => {
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
    children: [{ text: 'This Editor is rendered within a nested Shadow DOM.' }],
  },
]

export default ShadowDOM
