# React Editor Setup

Create React-backed editors with `createReactEditor`.

```tsx
import { useState } from 'react'
import { createReactEditor } from 'slate-react'

const [editor] = useState(() =>
  createReactEditor({
    initialValue: [{ type: 'paragraph', children: [{ text: '' }] }],
  })
)
```

`createReactEditor` installs React, DOM, clipboard, and default history
capabilities. The editor exposes host APIs through `editor.api`.

```typescript
editor.api.dom.focus()
editor.api.clipboard.insertTextData(dataTransfer)
editor.api.react.isComposing()
```

Use the lower-level `react()` extension only when composing extensions through
`createEditor`.

```typescript
import { createEditor } from 'slate'
import { react } from 'slate-react'

const editor = createEditor({
  extensions: [react()],
  initialValue: [{ type: 'paragraph', children: [{ text: '' }] }],
})
```

Configure the internal Slate clipboard payload with `clipboardFormatKey`.

```typescript
const editor = createReactEditor({
  clipboardFormatKey: 'x-acme-editor-fragment',
  initialValue,
})
```

See [React Editor](./react-editor.md) for DOM, focus, selection, and clipboard
APIs.
