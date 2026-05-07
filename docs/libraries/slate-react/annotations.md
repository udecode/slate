# Annotations

Annotations attach durable ranges to editor text and publish them to React
rendering, sidebars, and widgets.

Use annotations when a range has identity beyond a single render pass: review
comments, issue markers, tracked external diagnostics, resolved threads, or
anchored suggestions.

Use decorations for transient paint such as search matches. Use widgets for UI
that hangs off a node, selection, or annotation.

## Annotation Shape

```ts
type SlateAnnotationAnchor = {
  resolve(): Range | null
  unref?(): Range | null
}

type SlateAnnotation<TData, TProjection> = {
  anchor: SlateAnnotationAnchor
  data?: TData
  id: string
  projection?: TProjection
}
```

`anchor` resolves the current range. A local `Bookmark` satisfies this contract.
Adapters can use the same contract for service-owned anchors, Yjs relative
positions, or document-embedded ids.

`data` is application metadata. It is returned by `useSlateAnnotation` and
`useSlateAnnotations`.

`projection` is the small render-facing payload copied into text projection
slices. Put only fields that affect inline paint here.

```tsx
const annotations = comments.map((comment) => ({
  anchor: comment.anchor,
  data: comment,
  id: comment.id,
  projection: {
    status: comment.status,
    tone: comment.tone,
  },
}))
```

## Local Bookmarks

Use a bookmark when the anchor belongs to the local editor runtime.

```tsx
const anchor = editor.read((state) =>
  state.ranges.bookmark({
    anchor: { path: [0, 0], offset: 3 },
    focus: { path: [0, 0], offset: 18 },
  })
)

const annotationStore = useSlateAnnotationStore(editor, [
  {
    anchor,
    data: { label: 'Comment 1' },
    id: 'comment-1',
    projection: { tone: 'review' },
  },
])
```

Pass the store to `Slate` when editor-local annotation UI lives under that
provider. `useSlateAnnotations()` and `useSlateAnnotation(id)` read that store
by default.

```tsx
<Slate annotationStore={annotationStore} editor={editor}>
  <Editable renderSegment={renderCommentSegment} />
  <CommentsSidebar />
</Slate>

function CommentsSidebar() {
  const snapshot = useSlateAnnotations()

  return snapshot.allIds.map((id) => {
    const comment = snapshot.byId.get(id)

    return <CommentThread key={id} comment={comment} />
  })
}
```

Release bookmarks when the app removes the annotation.

```tsx
anchor.unref()
```

## External Comment Stores

Comment bodies, permissions, resolved state, and audit events belong to the app
or collaboration service. The Slate document value owns document content.

```tsx
const comments = useCommentChannel()

const annotations = comments.map((comment) => ({
  anchor: comment.anchor,
  data: {
    body: comment.body,
    label: comment.label,
    status: comment.status,
  },
  id: comment.id,
  projection: {
    status: comment.status,
    tone: comment.tone,
  },
}))
```

When an external store knows which comments changed, refresh those ids.

```tsx
annotationStore.refresh({
  ids: [threadId],
  reason: 'annotation',
})
```

Refresh semantics:

- omit `ids` for a full refresh
- pass an empty array for a no-op
- pass ids to re-resolve only those annotations

## Comment-Only Collaboration

Use separate channels for the document and the comments.

```tsx
// Writer lane: document channel.
writerEditor.update((tx) => {
  tx.text.insert('hello', { at })
})

// Reviewer lane: annotation channel.
commentsMap.set(threadId, {
  anchor,
  body,
  status: 'open',
})

annotationStore.refresh({ ids: [threadId], reason: 'annotation' })
```

A read-only reviewer can select text, create a comment anchor, and update a
thread without document-write permission. The collaboration adapter resolves the
anchor against the current document snapshot for rendering.

The `collaborative-comments` example renders this as two editors:

- writer editor on the left, editable document channel
- reviewer editor on the right, read-only document with writable comments
- shared external comment state
- same resolved anchors rendered in both panes

The reviewer comment controls do not call `editor.update` or mutate
`Editor.children`.

## Yjs-Style Adapter

A Yjs adapter can keep the document and comments in separate shared types.

```ts
type YjsAnnotationAnchor = {
  resolve(): Range | null
  unref(): Range | null
}

const anchor = yjsAnnotationAdapter.anchorFromSlateRange(editor, range)

yComments.set(threadId, {
  anchor,
  body,
  status: 'open',
})
```

The adapter owns mapping, drift recovery, deletion policy, and permissions.
Slate React owns projection once the adapter provides an anchor.

## Document-Embedded Ids

Document-embedded ids are useful when the product wants comments to copy, paste,
serialize, or travel with document content.

Use this as an adapter strategy, not as the default storage model for comment
bodies or permissions. The document may store a lightweight id; the comment
thread still belongs to the app or collaboration service.

## Performance Rules

Keep annotation rows stable when their range and render payload do not change.

Keep body text, author data, permissions, and long thread metadata in `data`.
Keep inline paint fields in `projection`.

Use `refresh({ ids })` for external comment updates when the changed ids are
known. Fall back to `refresh()` when the external source cannot provide ids.

Runtime subscribers wake only when their projected ranges or projection data
change. A comment body edit should wake annotation/sidebar subscribers without
repainting inline text when `projection` is unchanged.
