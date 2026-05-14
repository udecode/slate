# Editable Component

`Editable` renders the editable document surface for the nearest `Slate` provider. App code customizes what content looks like; the runtime owns browser selection, DOM repair, void shells, and editing events.

```tsx
<Slate editor={editor} initialValue={initialValue}>
  <Editable renderElement={renderElement} renderLeaf={renderLeaf} />
</Slate>
```

## Props

```typescript
type EditableProps = {
  autoFocus?: boolean
  className?: string
  decorate?: (entry: NodeEntry) => EditableDecoration[]
  disableDefaultStyles?: boolean
  id?: string
  renderingStrategy?: RenderingStrategyOptions | null
  onBeforeInput?: React.FormEventHandler<HTMLDivElement>
  onDOMBeforeInput?: (
    event: InputEvent,
    context: EditableDOMBeforeInputContext
  ) => boolean | EditableRepairRequest | void
  onCommand?: (
    command: EditableCommand,
    context: EditableCommandContext
  ) => boolean | EditableRepairRequest | void
  onKeyDown?: EditableKeyDownHandler
  onRenderingStrategyMetrics?: (
    metrics: EditableRenderingStrategyMetrics
  ) => void
  onPaste?: React.ClipboardEventHandler<HTMLDivElement>
  placeholder?: React.ReactNode
  readOnly?: boolean
  renderElement?: (props: RenderElementProps) => React.ReactNode
  renderLeaf?: (props: RenderLeafProps) => React.ReactNode
  renderPlaceholder?: (props: RenderPlaceholderProps) => React.ReactNode
  renderSegment?: (
    segment: EditableTextSegment,
    children: React.ReactNode
  ) => React.ReactNode
  renderText?: (props: RenderTextProps) => React.ReactNode
  renderVoid?: (props: RenderVoidProps) => React.ReactNode
  scrollSelectionIntoView?: (editor: Editor, domRange: globalThis.Range) => void
  spellCheck?: boolean
  style?: React.CSSProperties
}
```

`Editable` also accepts safe `div` attributes such as `aria-*`, `data-*`, and event handlers that are not owned by Slate.

## `renderElement`

Use `renderElement` for normal elements that render Slate-managed children.

```tsx
const renderElement = ({ attributes, children, element }) => {
  switch (element.type) {
    case 'code':
      return (
        <pre {...attributes}>
          <code>{children}</code>
        </pre>
      )
    default:
      return <p {...attributes}>{children}</p>
  }
}
```

Always spread `attributes` on the top-level DOM element and render `children`.

## `renderVoid`

Use `renderVoid` for void elements. A void renderer returns visible content only.

```tsx
const renderVoid = ({ element }) => {
  switch (element.type) {
    case 'image':
      return <ImageElement element={element} />
    default:
      return null
  }
}
```

Do not render `children`, hidden text anchors, or shell wrappers in normal void renderers. Slate renders the shell and model anchor for you.

If a void needs selected UI, subscribe from inside the void component.

```tsx
const ImageElement = ({ element }) => {
  const selected = useElementSelected({ mode: 'collapsed' })

  return <img data-selected={selected || undefined} src={element.url} />
}
```

If an event handler needs the current location of the rendered element, resolve
the path inside the handler.

```tsx
const ImageElement = ({ element }) => {
  const editor = useEditor()

  return (
    <button
      onClick={() => {
        const path = editor.dom.findPath(element)

        editor.update((tx) => {
          tx.nodes.remove({ at: path, voids: true })
        })
      }}
    />
  )
}
```

## `renderLeaf`

Use `renderLeaf` for text marks.

```tsx
const renderLeaf = ({ attributes, children, leaf }) => {
  return (
    <span
      {...attributes}
      style={{
        fontWeight: leaf.bold ? 'bold' : 'normal',
        fontStyle: leaf.italic ? 'italic' : 'normal',
      }}
    >
      {children}
    </span>
  )
}
```

## `renderText`

Use `renderText` when you need to wrap a whole text node, regardless of how decorations split it into leaves.

```tsx
const renderText = ({ attributes, children, text }) => {
  return (
    <span {...attributes} data-commented={text.commentId || undefined}>
      {children}
    </span>
  )
}
```

## `decorate`

Use `Editable.decorate` for simple editor-local ranges such as a one-off search
match or lightweight syntax highlight.

```tsx
<Editable
  decorate={([node, path]) => {
    if (!TextApi.isText(node)) return []

    const start = node.text.indexOf(query)

    return start === -1
      ? []
      : [
          {
            anchor: { path, offset: start },
            data: { search: true },
            focus: { path, offset: start + query.length },
          },
        ]
  }}
  renderSegment={(segment, children) =>
    segment.slices.some((slice) => slice.data?.search) ? (
      <mark>{children}</mark>
    ) : (
      children
    )
  }
/>
```

`decorate` is a convenience adapter over the projection runtime. Use
provider-owned `decorationSources` when the ranges are shared with other UI,
come from external state, update frequently, or need source-scoped refreshes.

## `renderSegment`

`renderSegment` renders text after projection sources split it into projected slices. Use it for search results, comments, diagnostics, and other render-time overlays.

```tsx
<Editable
  renderSegment={(segment, children) =>
    segment.slices.length > 0 ? <mark>{children}</mark> : children
  }
/>
```

Normal apps should pass `decorationSources` and `annotationStore` to `Slate`, then render projected text through `renderSegment`.

## `placeholder` And `renderPlaceholder`

Use `placeholder` for the normal empty-editor message.

```tsx
<Editable placeholder="Start typing..." />
```

Use `renderPlaceholder` when the placeholder needs custom markup.

```tsx
<Editable
  placeholder="Start typing..."
  renderPlaceholder={({ attributes, children }) => (
    <span {...attributes}>{children}</span>
  )}
/>
```

Keep the provided attributes. They make the placeholder behave like editor chrome instead of document content.

## Event Props

Use `onKeyDown` for keyboard shortcuts.

```tsx
<Editable
  onKeyDown={event => {
    if (event.key === 'b' && event.metaKey) {
      event.preventDefault()
      editor.update(tx => {
        tx.marks.toggle('bold')
      })
    }
  }}
/>
```

Use `onCommand` for editor behavior that can arrive from native input or keyboard shortcuts. Slate passes semantic commands for formatting, history, delete, paste, text insertion, and line breaks without making app code parse browser `inputType` strings.

```tsx
<Editable
  onCommand={(command, { editor }) => {
    if (command.kind !== 'format') {
      return
    }

    switch (command.format) {
      case 'bold':
      case 'italic':
      case 'underline':
        editor.update(tx => {
          tx.marks.toggle(command.format)
        })
        return true
    }
  }}
/>
```

Use `onDOMBeforeInput` only when you need the raw native `InputEvent`. It receives the native event plus Slate's current command/context classification. Returning `true` or calling `event.preventDefault()` marks the event handled.

## Projection Sources

Put decoration sources and the annotation store on `Slate`, not `Editable`. The provider owns editor-level projection sources so the editor surface, toolbar, and overlay UI read the same committed projection.

```tsx
<Slate
  annotationStore={commentStore}
  decorationSources={[searchSource]}
  editor={editor}
>
  <Editable renderSegment={renderSearchMatch} />
  <CommentsSidebar store={commentStore} />
</Slate>
```

Inline, void, selectable, and read-only behavior belongs to the editor schema.

```tsx
editor.extend({
  elements: [
    {
      type: 'mention',
      void: 'markable-inline',
    },
  ],
  name: 'mentions',
})
```

Product input rules belong in higher-level command layers or editor extensions. Keep raw `Editable` focused on rendering and DOM events.

## Rendering Strategy

`Editable` applies safe staged rendering automatically. Use `renderingStrategy="staged"` to lock that behavior explicitly, or `renderingStrategy="full"` to render the full document surface for debugging.

Use shell mode only when a huge document needs aggressive mounting control. The runtime keeps the active editing corridor mounted and renders far-away regions as semantic shells.

```tsx
<Editable
  renderingStrategy={{
    overscan: 0,
    type: 'shell',
    segmentSize: 100,
    previewChars: 96,
    threshold: 2000,
  }}
/>
```

Shell mode keeps typing, selection, and overlay work local to the active region.

Use `onRenderingStrategyMetrics` to wire production RUM or a Datadog dashboard. The
callback runs after commit and reports the current document cohort, requested
strategy, effective strategy, degradation mode, mounted/pending counts, DOM
coverage boundary counts, visible DOM node count, and editable descendant count.

```tsx
<Editable
  renderingStrategy="staged"
  onRenderingStrategyMetrics={metrics => {
    datadogRum.addAction('slate.rendering_strategy.surface', metrics)
  }}
/>
```

Track dashboards by interaction name, cohort, document size, requested strategy,
effective strategy, degradation mode, native surface completion, boundary count,
visible DOM count, editable descendant count, custom renderer flag, browser,
mobile/desktop, IME state, and release version. Virtualized, shell, and
`staged-warmup` metrics are degraded-mode signals; do not mix them with complete
DOM-present default rows.

## DOM Coverage Boundaries

`renderElement` receives `slots.unstableBoundary` for model content whose DOM is
intentionally not mounted. Use it for collapsed sections or hidden element
shells that still exist in the Slate value.

```tsx
const renderElement = ({ children, element, slots }) => {
  if (element.type === 'section') {
    return (
      <EditableElement>
        {React.Children.toArray(children)[0]}
        <slots.unstableBoundary
          boundaryId="section-body"
          mounted={!element.collapsed}
          scope={{ from: 1, type: 'children' }}
        >
          <button type="button">Show section</button>
        </slots.unstableBoundary>
      </EditableElement>
    )
  }

  if (element.type === 'hidden-header') {
    return (
      <slots.unstableBoundary
        boundaryId="hidden-header"
        copyPolicy="exclude"
        mounted={!element.hidden}
        reason="app-hidden"
        scope={{ type: 'self' }}
        selectionPolicy="boundary"
      >
        <button type="button">Show header</button>
      </slots.unstableBoundary>
    )
  }

  return <EditableElement>{children}</EditableElement>
}
```

Boundary content is model-present but DOM-incomplete while `mounted` is `false`.
Slate maps selection, copy, paste, and DOM point import through the boundary
registry instead of resolving missing descendants with raw DOM lookups. Hidden
text is not available to native browser find or screen-reader traversal until
the boundary is mounted. Copy behavior follows `copyPolicy`; collapsed document
sections usually use `include-model`, while app-hidden headers and footers
usually use `exclude`.

## Styling

Use `style` or `className` for editor styling.

```tsx
<Editable style={{ minHeight: 200 }} />
```

Pass `disableDefaultStyles` only when your CSS replaces Slate's default editable-surface styles.
