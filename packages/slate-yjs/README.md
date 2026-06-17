# @slate/yjs

Yjs collaboration bindings for Slate editors.

`@slate/yjs` maps Slate operations, selection state, awareness, provider
lifecycle, and undo/redo coordination onto a Yjs document. Provider packages
stay at the application edge: wrap your Hocuspocus, WebSocket, WebRTC, or
custom provider as a `YjsProviderLike`, then pass it to `createYjsExtension`.

```tsx
import { createEditor } from 'slate'
import { createYjsExtension } from '@slate/yjs'
import { history } from 'slate-history'

const editor = createEditor({
  extensions: [
    history(),
    createYjsExtension({
      clientId: 'local-user',
      doc,
      provider,
      rootName: 'slate',
    }),
  ],
  initialValue,
})
```

React apps can render remote cursor decorations and provider state through the
React subpath.

```tsx
import {
  useYjsProviderStatus,
  useYjsProviderSynced,
  useYjsRemoteCursors,
} from '@slate/yjs/react'
```

## Boundaries

- `@slate/yjs` owns the Slate/Yjs adapter, awareness model, provider lifecycle
  bridge, operation replay, and Yjs-aware undo/redo coordination.
- App code owns transport packages, authentication, persistence, room naming,
  server scaling, and provider-specific options.
- Provider integrations are peer application code. The package does not depend
  on Hocuspocus, `y-websocket`, IndexedDB, WebRTC, or another transport
  package.
- Public imports are `@slate/yjs`, `@slate/yjs/core`, and `@slate/yjs/react`.
  The `@slate/yjs/internal` subpath is reserved for sibling Slate packages.

## Related Docs

- [Slate Yjs](../../docs/libraries/slate-yjs.md)
- [Operation Replay Substrate](../../docs/walkthroughs/07-operation-replay-substrate.md)
- [Slate v2 Release](../../docs/releases/slate-v2.md)
