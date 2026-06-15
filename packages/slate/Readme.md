# slate

Core Slate editor runtime.

`slate` owns the document model, operations, paths, points, ranges, transforms,
transactions, state fields, schema extension runtime, and pure node/location
helper namespaces.

## Editor Lifecycle

```ts
import { createEditor } from 'slate'

const editor = createEditor({
  initialValue: [{ type: 'paragraph', children: [{ text: '' }] }],
})

const value = editor.read((state) => state.value.get())

editor.update((tx) => {
  tx.text.insert('Hello')
})
```

Use `editor.read(...)` for coherent state reads. Use `editor.update(...)` for
document, selection, mark, root, state-field, and operation changes.

Use `isEditor` when library code needs to validate an unknown value before
treating it as an editor.

`createEditorRuntime` and `createEditorView` create root-scoped views over one
runtime for framework packages and advanced multi-root integrations. App UI
normally starts from the framework package helper, such as `useSlateEditor` in
`slate-react`.

## Runtime Identity

Slate paths are live coordinates. Runtime ids are local node identities for the
current editor runtime. Use them when a local projection, DOM binding, widget,
or long-lived target needs to survive inserts, moves, splits, and deletes.

```ts
const textRuntimeId = editor.read((state) => state.runtime.idAt([0, 0]))

editor.update((tx) => {
  tx.nodes.insert({ type: 'paragraph', children: [{ text: 'Before' }] }, {
    at: [0],
  })

  const currentPath = textRuntimeId
    ? tx.runtime.pathOf(textRuntimeId)
    : null
})
```

Runtime ids are not document data. `state.value.get()` returns serializable
Slate JSON without runtime ids, indexes, or DOM metadata. Persist your own
semantic ids when the document needs product identity; use runtime ids for local
editor identity.

## Public Type Groups

Core document and editor shapes include `Editor`, `BaseEditor`, `Value`,
`InitialValue`, `Selection`, `RootKey`, and `RuntimeId`.

Runtime, view, snapshot, and commit types include `EditorRuntime`,
`EditorView`, `EditorSnapshot`, `EditorCommit`, `EditorCommitClass`,
`SnapshotInput`, and `SnapshotListener`.

Read/update API types include `EditorStateView`, `EditorStateValueApi`,
`EditorUpdateTransaction`, `EditorTransactionValueApi`, `EditorUpdateOptions`,
and `EditorUpdateMetadata`.

Extension and schema types include `EditorExtension`, `EditorExtensionInput`,
`EditorExtensionSetupContext`, `EditorExtensionSetupOutput`,
`EditorExtensionRuntimeState`, `EditorExtensionStateGroup`,
`EditorExtensionStateGroups`, `EditorExtensionTxGroup`,
`EditorExtensionTxGroups`, `EditorExtensionOperations`, `EditorElementSpec`,
`EditorElementBehavior`, `EditorElementContentRootSpec`,
`EditorElementPropertyDescriptor`, `EditorElementPropertyKind`,
`EditorElementVoidKind`, `StateFieldDescriptor`, `StateFieldValueInput`, and
`EditorStateField`.

Middleware and debug APIs include `EditorTransformApi`,
`EditorTransformMiddlewareArgs`, `EditorTransformMiddlewareContext`,
`EditorTransformMiddlewareMap`, `EditorQueryGroup`,
`EditorQueryMiddlewareContext`, `EditorQueryMiddlewareMap`,
`EditorQueryMiddlewareResult`, `EditorOperationApplyContext`,
`EditorOperationApplyHandler`, `setDebugValueScrubber`, and
`DebugValueScrubber`.

The `/internal` package subpath is reserved for sibling Slate packages in this
repo. Apps, plugins, and framework adapters should use the root `slate` export.

## Extension Authoring

```ts
import { defineEditorExtension, defineStateField, elementProperty } from 'slate'
```

Extensions register schema facts, state groups, transaction groups,
normalizers, operation middleware, commit listeners, and runtime APIs without
mutating random fields onto the editor object.

## Helper Namespaces

Pure data helpers live on `ElementApi`, `LocationApi`, `NodeApi`,
`OperationApi`, `PathApi`, `PathRefApi`, `PointApi`, `PointRefApi`, `RangeApi`,
`RangeRefApi`, `SpanApi`, and `TextApi`.
