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
