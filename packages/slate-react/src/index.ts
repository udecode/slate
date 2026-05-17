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
  EditableCommandContext,
  EditableCommandHandler,
  EditableDOMBeforeInputContext,
  EditableDOMBeforeInputHandler,
  EditableHandlerResult,
  EditableKeyDownContext,
  EditableKeyDownHandler,
  EditableRenderingStrategyCohort,
  EditableRenderingStrategyDegradationMode,
  EditableRenderingStrategyEffectiveType,
  EditableRenderingStrategyMetrics,
  EditableRenderingStrategyMetricsBase,
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
  type SlateDecoration,
  type SlateDecorationSource,
  type SlateDecorationSourceOptions,
  type SlateDecorationSourceReadContext,
} from './decoration-source'
export {
  EDITABLE_KEY_COMMAND_CAPABILITY,
  type EditableKeyCommand,
  type EditableKeyCommandContext,
  editableKeyCommands,
} from './editable/editable-key-commands'
export {
  EDITABLE_RENDERERS_CAPABILITY,
  type EditableElementRendererMap,
  type EditableLeafRenderer,
  type EditableLeafRendererProps,
  type EditableRenderers,
  type EditableSegmentRenderer,
  type EditableTextRenderer,
  type EditableVoidRendererMap,
  editableRenderers,
} from './editable/editable-renderers'
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
export { useSlateDecorationSource } from './hooks/use-slate-decoration-source'
export {
  type UseSlateEditorOptions,
  useSlateEditor,
} from './hooks/use-slate-editor'
export { useSlateNodeRef } from './hooks/use-slate-node-ref'
export {
  type SlateProjectionEntry,
  type SlateProjectionStore,
  useSlateProjections,
} from './hooks/use-slate-projections'
export {
  type SlateWidgetStoreProjector,
  useSlateWidgetStore,
} from './hooks/use-slate-widget-store'
export { useSlateWidget, useSlateWidgets } from './hooks/use-slate-widgets'
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
