// Components

// Utils
export { NODE_TO_INDEX, NODE_TO_PARENT } from 'slate-dom'
export {
  createSlateAnnotationStore,
  type SlateAnnotation,
  type SlateAnnotationProjectionData,
  type SlateAnnotationSnapshot,
  type SlateAnnotationStore,
} from './annotation-store'
export * as SlateReactCompat from './compat'
export type {
  EditableInputRule,
  EditableKeyCommandHandler,
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
  EditableRenderElementProps as RenderElementProps,
  EditableTextBlocksProps as EditableProps,
  EditableTextBlocksProps,
} from './components/editable-text-blocks'
export {
  EditableTextBlocks as Editable,
  EditableTextBlocks,
} from './components/editable-text-blocks'
export { Slate } from './components/slate'
export { SlateElement } from './components/slate-element'
export { SlateLeaf } from './components/slate-leaf'
export { SlatePlaceholder } from './components/slate-placeholder'
export { SlateSpacer } from './components/slate-spacer'
export { SlateText } from './components/slate-text'
export { TextString } from './components/text-string'
export { VoidElement } from './components/void-element'
export { ZeroWidthString } from './components/zero-width-string'
export { useComposing } from './hooks/use-composing'
// Hooks
export { useEditor } from './hooks/use-editor'
export { useElement, useElementIf } from './hooks/use-element'
export { useFocused } from './hooks/use-focused'
export { useReadOnly } from './hooks/use-read-only'
export { useSelected } from './hooks/use-selected'
export { useSlate, useSlateWithV } from './hooks/use-slate'
export { useSlateAnnotationStore } from './hooks/use-slate-annotation-store'
export { useSlateAnnotations } from './hooks/use-slate-annotations'
export { useSlateNodeRef } from './hooks/use-slate-node-ref'
export {
  type SlateProjectionEntry,
  type SlateProjectionStore,
  useSlateProjections,
} from './hooks/use-slate-projections'
export { useSlateSelection } from './hooks/use-slate-selection'
export { useSlateSelector } from './hooks/use-slate-selector'
export { useSlateStatic } from './hooks/use-slate-static'
export { useSlateWidgetStore } from './hooks/use-slate-widget-store'
export { useSlateWidgets } from './hooks/use-slate-widgets'
// Plugin
export { ReactEditor } from './plugin/react-editor'
export { withReact } from './plugin/with-react'
export {
  createSlateProjectionStore,
  isSlateSourceDirty,
  type SlateCustomSourceDirtiness,
  type SlateProjection,
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
} from './widget-store'
