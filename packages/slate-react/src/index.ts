// Components

// Utils
export { NODE_TO_INDEX, NODE_TO_PARENT } from 'slate-dom'
export {
  createSlateAnnotationStore,
  type SlateAnnotation,
  type SlateAnnotationAnchor,
  type SlateAnnotationProjectionData,
  type SlateAnnotationRefreshOptions,
  type SlateAnnotationSnapshot,
  type SlateAnnotationStore,
  type SlateAnnotationStoreMetrics,
  type SlateAnnotationStoreRefreshOptions,
  type SlateResolvedAnnotation,
} from './annotation-store'
export type {
  EditableDOMBeforeInputContext,
  EditableDOMBeforeInputHandler,
  EditableDOMStrategyCohort,
  EditableDOMStrategyDegradationMode,
  EditableDOMStrategyEffectiveType,
  EditableDOMStrategyMetrics,
  EditableDOMStrategyMetricsBase,
  EditableHandlerResult,
  EditableInputEventContext,
  EditableKeyDownContext,
  EditableKeyDownHandler,
} from './components/editable'
export {
  DefaultPlaceholder,
  defaultScrollSelectionIntoView,
} from './components/editable'
export { EditableElement } from './components/editable-element'
export type {
  EditableTextLeafProps as RenderLeafProps,
  EditableTextRenderPlaceholderProps as RenderPlaceholderProps,
  EditableTextRenderTextProps as RenderTextProps,
} from './components/editable-text'
export { EditableText } from './components/editable-text'
export type {
  EditableDecorate,
  EditableDecoration,
  EditableDOMCoverageBoundaryPlaceholderContext,
  EditableDOMCoverageBoundaryProps,
  EditableDOMCoverageBoundaryScope,
  EditableElementSlots,
  EditableLayout,
  EditableRenderElementProps as RenderElementProps,
  EditableRenderVoidProps as RenderVoidProps,
  EditableTextBlocksProps as EditableProps,
  EditableTextBlocksProps,
} from './components/editable-text-blocks'
export {
  EditableTextBlocks as Editable,
  EditableTextBlocks,
} from './components/editable-text-blocks'
export { Slate, type SlateChange, type SlateProps } from './components/slate'
export { SlateElement } from './components/slate-element'
export { SlateLeaf } from './components/slate-leaf'
export { SlatePlaceholder } from './components/slate-placeholder'
export { SlateText } from './components/slate-text'
export { TextString } from './components/text-string'
export { ZeroWidthString } from './components/zero-width-string'
export {
  composeDecorationSources,
  createDecorationSource,
  createRangeDecorationSource,
  type SlateDecoration,
  type SlateDecorationSource,
  type SlateDecorationSourceOptions,
  type SlateDecorationSourceReadContext,
  type SlateRangeDecoration,
  type SlateRangeDecorationSourceOptions,
} from './decoration-source'
export type {
  DOMStrategyOptions,
  DOMStrategyType,
} from './dom-strategy/create-segment-plan'
export {
  type EditorDecorationSelectorContext,
  type EditorDecorationSelectorOptions,
  useDecorationSelector,
} from './hooks/use-decoration-selector'
export { useEditor } from './hooks/use-editor'
export { useEditorComposing } from './hooks/use-editor-composing'
export { useEditorFocused } from './hooks/use-editor-focused'
export { useEditorReadOnly } from './hooks/use-editor-read-only'
export { useEditorSelection } from './hooks/use-editor-selection'
export {
  type EditorSelectorOptions,
  type EditorStateSelectorOptions,
  useEditorSelector,
  useEditorState,
} from './hooks/use-editor-selector'
// Hooks
export { useElement } from './hooks/use-element'
export { useElementPath } from './hooks/use-element-path'
export {
  type UseElementSelectedMode,
  type UseElementSelectedOptions,
  useElementSelected,
} from './hooks/use-element-selected'
export {
  type EditorNodeSelectorContext,
  type EditorRuntimeSelectorOptions,
  type EditorTextSelectorContext,
  useNodeSelector,
  useTextSelector,
} from './hooks/use-node-selector'
export {
  type SlateAnnotationStoreProjector,
  useSlateAnnotationStore,
} from './hooks/use-slate-annotation-store'
export {
  useSlateAnnotation,
  useSlateAnnotations,
} from './hooks/use-slate-annotations'
export {
  type UseSlateDecorationSourceOptions,
  type UseSlateRangeDecorationSourceOptions,
  useSlateDecorationSource,
  useSlateRangeDecorationSource,
} from './hooks/use-slate-decoration-source'
export {
  type UseSlateEditorOptions,
  useSlateEditor,
} from './hooks/use-slate-editor'
export {
  type SlateHistoryController,
  type SlateHistoryFocusPolicy,
  type UseSlateHistoryOptions,
  useSlateHistory,
} from './hooks/use-slate-history'
export { useSlateNodeRef } from './hooks/use-slate-node-ref'
export {
  type SlateProjectionEntry,
  type SlateProjectionStore,
  useSlateProjections,
} from './hooks/use-slate-projections'
export {
  type SlateRootChromeController,
  type UseSlateRootChromeOptions,
  useSlateRootChrome,
} from './hooks/use-slate-root-chrome'
export {
  type SlateCommandFocusPolicy,
  type SlateRootEditor,
  SlateRuntime,
  type SlateRuntimeProps,
  type SlateRuntimeStateSelectorOptions,
  type SlateRuntimeValue,
  type UseSlateCommandCallbackOptions,
  type UseSlateRootEditorOptions,
  type UseSlateRuntimeOptions,
  type UseSlateViewEffectOptions,
  useSlateActiveEditor,
  useSlateActiveRoot,
  useSlateCommandCallback,
  useSlateRootEditor,
  useSlateRootState,
  useSlateRuntime,
  useSlateRuntimeState,
  useSlateViewEffect,
  useSlateViewState,
} from './hooks/use-slate-runtime'
export {
  type SlateWidgetStoreProjector,
  useSlateWidgetStore,
} from './hooks/use-slate-widget-store'
export { useSlateWidget, useSlateWidgets } from './hooks/use-slate-widgets'
export {
  type StateFieldSetter,
  type UseStateFieldValueOptions,
  useSetStateField,
  useStateFieldValue,
} from './hooks/use-state-field'
// Plugin
export {
  type CreateReactEditorOptions,
  createReactEditor,
  type ReactApi,
  type ReactEditor,
  type ReactEditorOptions,
  react,
} from './plugin/with-react'
export {
  createSlateProjectionStore,
  isSlateSourceDirty,
  type SlateCustomSourceDirtiness,
  type SlateProjection,
  type SlateProjectionRefreshListener,
  type SlateProjectionRefreshResult,
  type SlateProjectionRuntimeScope,
  type SlateProjectionSlice,
  type SlateProjectionSource,
  type SlateProjectionStoreMetrics,
  type SlateProjectionStoreOptions,
  type SlateProjectionStoreRefreshOptions,
  type SlateRangeProjection,
  type SlateSourceDirtiness,
  type SlateSourceDirtinessClass,
  type SlateSourceDirtinessContext,
} from './projection-store'
export {
  createSlateWidgetStore,
  type SlateResolvedWidget,
  type SlateWidget,
  type SlateWidgetAnchor,
  type SlateWidgetSnapshot,
  type SlateWidgetStore,
  type SlateWidgetStoreMetrics,
} from './widget-store'
