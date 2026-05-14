import type { ReactNode } from 'react'
import type { Element as SlateElementNode } from 'slate'
import type {
  EditableTextLeafProps,
  EditableTextRenderTextProps,
  EditableTextSegment,
} from '../components/editable-text'
import type {
  RenderElementRenderer,
  RenderVoidRenderer,
} from '../components/editable-text-blocks'
import { type Editor, getEditorExtensionRegistry } from './runtime-editor-api'

export const EDITABLE_RENDERERS_CAPABILITY = 'slate-react.editable.renderers'

export type EditableLeafRendererProps<T = unknown> = Omit<
  EditableTextLeafProps<T>,
  'attributes'
>

export type EditableLeafRenderer<T = unknown> = (
  props: EditableLeafRendererProps<T>
) => ReactNode

export type EditableSegmentRenderer<T = unknown> = (
  segment: EditableTextSegment<T>,
  children: ReactNode
) => ReactNode

export type EditableTextRenderer = (
  props: EditableTextRenderTextProps
) => ReactNode

export type EditableRenderers<
  T = unknown,
  TElement extends SlateElementNode = any,
> = {
  elements?: Record<string, RenderElementRenderer<TElement>>
  leaves?: Record<string, EditableLeafRenderer<T>>
  segment?: EditableSegmentRenderer<T>
  text?: EditableTextRenderer
  voids?: Record<string, RenderVoidRenderer<TElement>>
}

const EMPTY_RENDERERS = Object.freeze({}) as EditableRenderers

export const editableRenderers = <
  T = unknown,
  TElement extends SlateElementNode = any,
>(
  renderers: EditableRenderers<T, TElement>
): Record<string, EditableRenderers<T, TElement>> => ({
  [EDITABLE_RENDERERS_CAPABILITY]: renderers,
})

const isEditableRenderers = (value: unknown): value is EditableRenderers =>
  typeof value === 'object' && value != null

export const getEditableRenderers = <
  T = unknown,
  TElement extends SlateElementNode = any,
>(
  editor: Editor
): EditableRenderers<T, TElement> => {
  const renderers = (
    getEditorExtensionRegistry(editor).capabilities.get(
      EDITABLE_RENDERERS_CAPABILITY
    ) ?? []
  ).filter(isEditableRenderers) as EditableRenderers<T, TElement>[]

  if (!renderers.length) {
    return EMPTY_RENDERERS as EditableRenderers<T, TElement>
  }

  return renderers.reduce<EditableRenderers<T, TElement>>(
    (merged, next) => ({
      elements: next.elements
        ? { ...merged.elements, ...next.elements }
        : merged.elements,
      leaves: next.leaves
        ? { ...merged.leaves, ...next.leaves }
        : merged.leaves,
      segment: next.segment ?? merged.segment,
      text: next.text ?? merged.text,
      voids: next.voids ? { ...merged.voids, ...next.voids } : merged.voids,
    }),
    {}
  )
}
