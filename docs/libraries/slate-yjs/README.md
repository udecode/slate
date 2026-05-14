# Slate Yjs

`slate-yjs` binds a Slate editor to a Yjs document through Slate's extension
runtime. The package owns the Yjs root, awareness state, relative-position
helpers, remote import metadata, and React cursor projection helpers.

## Basic setup

Create a `Y.Doc`, choose a shared `Y.XmlText` root, and extend the editor with
the controller's extension.

```tsx
import { createEditor } from 'slate'
import { createYjsExtension, createYjsLocalAwareness } from 'slate-yjs'
import * as Y from 'yjs'

const editor = createEditor()
const doc = new Y.Doc()
const sharedRoot = doc.get('content', Y.XmlText)
const awareness = createYjsLocalAwareness(doc.clientID)

const yjs = createYjsExtension({
  awareness,
  sharedRoot,
})

const unextend = editor.extend(yjs.extension)

yjs.connect()
```

Call `disconnect()` and the `unextend` cleanup when the editor leaves the
collaboration session.

```tsx
yjs.disconnect()
unextend()
```

## Public surface

The root export and `slate-yjs/core` expose the same core helpers:

- `createYjsExtension(options)` creates the controller and Slate extension.
- `createYjsLocalAwareness(clientID)` creates a deterministic awareness object
  for tests, examples, and local transports.
- `connectYjsLocalAwareness(a, b)` connects two local awareness objects.
- `slatePointToYRelativePosition(...)` and
  `yRelativePositionToSlatePoint(...)` map Slate points to Yjs relative
  positions.
- `slateRangeToYRelativeRange(...)` and `yRelativeRangeToSlateRange(...)` map
  ranges for cursor and selection transport.
- `readSlateValueFromYjs(...)`, `writeSlateValueToYjs(...)`, and
  `applyYjsEventsToEditor(...)` provide the codec and remote import path.

The `slate-yjs/react` export contains React helpers:

- `useYjsControllerState(controller)`
- `useRemoteCursorStates(controller)`
- `useRemoteCursorDecorations(controller)`
- `RemoteCursorOverlay`

## Controller state

The controller exposes a small state object for UI and diagnostics.

```tsx
const state = yjs.getState()

state.connection // 'connected' | 'disconnected' | 'paused'
state.exports
state.imports
state.revision
```

Local document commits are exported when the controller is connected. Remote
imports enter Slate through `editor.update(...)` with collaboration metadata,
history skip policy, and selection side-effect suppression.

Selection-only commits are written to awareness instead of the Yjs document.
Remote cursor data is projected from awareness into Slate ranges with Yjs
relative positions.

## React cursor projection

Use `useRemoteCursorDecorations` with `Editable` when remote cursor ranges
should render inside text.

```tsx
import { Editable, Slate } from 'slate-react'
import { useRemoteCursorDecorations } from 'slate-yjs/react'

const EditorView = ({ controller, editor }) => {
  const decorate = useRemoteCursorDecorations(controller)

  return (
    <Slate editor={editor}>
      <Editable decorate={decorate} />
    </Slate>
  )
}
```

Use `RemoteCursorOverlay` for a compact peer list or demo overlay.

```tsx
<RemoteCursorOverlay controller={controller} />
```

## Example

The `Yjs Collaboration` example runs two local Slate editors against two Yjs
documents with an in-memory transport. It covers document edits, awareness
cursor projection, pause/resume recovery, undo/redo, Unicode text, and reset
controls.

Open `/examples/yjs-collaboration` in the examples site.
