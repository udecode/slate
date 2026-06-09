import {
  type Editor as EditorType,
  InternalEditor,
  type Value,
} from '../interfaces/editor'

export {
  defineCommand,
  executeCommand,
  registerCommand,
} from '../core/command-registry'
export {
  getEditorRuntime,
  setEditorRuntime,
} from '../core/editor-runtime'
export {
  getExtensionRegistry as getEditorExtensionRegistry,
  inheritExtensionRegistry as inheritEditorExtensionRegistry,
} from '../core/extension-registry'
export {
  applyOperation,
  applyStatePatches,
  getCurrentMarks as getEditorCurrentMarks,
  getCurrentSelectionRoot as getEditorSelectionRoot,
  getEditorOperationRoot,
  getLiveNode as getEditorLiveNode,
  getLiveSelection as getEditorLiveSelection,
  getLiveText as getEditorLiveText,
  getSnapshotVersion,
  setChildren as setEditorChildren,
  setCurrentMarks as setEditorMarks,
  setCurrentSelection as setEditorSelection,
  setTargetRuntime as setEditorTargetRuntime,
  shouldSaveStatePatch,
  withOperationRootChildren,
} from '../core/public-state'
export { hasTransformMiddleware as hasEditorTransformMiddleware } from '../core/transform-middleware'
export {
  getEditorTransformRegistry,
  setEditorTransformRegistry,
} from '../core/transform-registry'
export { formatDebugValue } from '../utils/format-debug-value'
export {
  getOperationRoot,
  getRangeRoot,
  MAIN_ROOT_KEY,
} from './root-location'

const Editor = InternalEditor

export interface Editor<
  V extends Value = any,
  TExtensions extends readonly unknown[] = readonly [],
> extends EditorType<V, TExtensions> {}

export type SlateEditor<
  V extends Value = any,
  TExtensions extends readonly unknown[] = readonly [],
> = EditorType<V, TExtensions>

export { Editor }
