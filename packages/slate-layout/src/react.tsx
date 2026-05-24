import {
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react'
import type { Editor } from 'slate'
import { Editable, type EditableLayout, type EditableProps } from 'slate-react'

import {
  createSlateLayout,
  createSlatePageLayout,
  getSlatePageLayoutGeometry,
  getSlatePageLayoutProjection,
  type SlateLayout,
  type SlateLayoutOptions,
  type SlateLayoutSnapshot,
  type SlatePageLayout,
  type SlatePageLayoutMode,
  type SlatePageLayoutOptions,
  type SlatePageLayoutPage,
  type SlatePageLayoutSnapshot,
  type SlatePageSettings,
  type SlatePageSettingsSource,
} from './index'

const getPageSourceDependency = <
  TSettings extends SlatePageSettings = SlatePageSettings,
>(
  page: SlatePageSettingsSource<TSettings> | null | undefined
) => {
  if (!page) {
    return null
  }

  if ('margins' in page && 'preset' in page) {
    return `${page.preset}:${JSON.stringify(page.margins)}`
  }

  return page
}

export type UseSlatePageLayoutOptions<
  TSettings extends SlatePageSettings = SlatePageSettings,
> = SlatePageLayoutOptions<TSettings>

export type UseSlateLayoutOptions<
  TSettings extends SlatePageSettings = SlatePageSettings,
> = SlateLayoutOptions<TSettings>

export const useSlateLayout = <
  TSettings extends SlatePageSettings = SlatePageSettings,
>(
  editor: Editor,
  options: UseSlateLayoutOptions<TSettings>
): SlateLayout => {
  const optionsRef = useRef(options)
  optionsRef.current = options

  const layout = useMemo(
    () => createSlateLayout(editor, () => optionsRef.current),
    [editor]
  )
  const pageDependency = getPageSourceDependency(options.page)

  useEffect(() => {
    layout.refresh('settings')
  }, [layout, pageDependency, options.root, options.typography])

  useEffect(
    () => () => {
      layout.destroy()
    },
    [layout]
  )

  return layout
}

export const useSlatePageLayout = <
  TSettings extends SlatePageSettings = SlatePageSettings,
>(
  editor: Editor,
  options: UseSlatePageLayoutOptions<TSettings>
): SlatePageLayout => {
  const optionsRef = useRef(options)
  optionsRef.current = options

  const layout = useMemo(
    () => createSlatePageLayout(editor, () => optionsRef.current),
    [editor]
  )
  const pageDependency = getPageSourceDependency(options.page)

  useEffect(() => {
    layout.refresh('settings')
  }, [layout, options.engine, pageDependency, options.root, options.typography])

  useEffect(
    () => () => {
      layout.destroy()
    },
    [layout]
  )

  return layout
}

export const useSlatePageLayoutSnapshot = (
  layout: SlatePageLayout
): SlatePageLayoutSnapshot =>
  useSyncExternalStore(layout.subscribe, layout.getSnapshot, layout.getSnapshot)

export const useSlateLayoutSnapshot = (
  layout: SlateLayout
): SlateLayoutSnapshot =>
  useSyncExternalStore(layout.subscribe, layout.getSnapshot, layout.getSnapshot)

export type PagedEditableRenderPageProps = {
  attributes: {
    'data-slate-page': true
    'data-slate-page-index': number
  }
  children: ReactNode | null
  page: SlatePageLayoutPage
}

export type PagedEditablePageLayoutMode = SlatePageLayoutMode

export type PagedEditableProps = EditableProps & {
  layout: SlatePageLayout
  pageLayoutMode?: PagedEditablePageLayoutMode
  pageGap?: number
  renderPage?: (props: PagedEditableRenderPageProps) => ReactNode
}

const defaultRenderPage = ({
  attributes,
  children,
  page,
}: PagedEditableRenderPageProps) => (
  <div
    {...attributes}
    style={{
      background: 'white',
      border: '1px solid #d1d5db',
      boxShadow: '0 12px 24px rgba(15, 23, 42, 0.12)',
      boxSizing: 'border-box',
      height: page.height,
      overflow: 'hidden',
      pointerEvents: 'none',
      position: 'relative',
      width: page.width,
    }}
  >
    {children}
  </div>
)

export const PagedEditable = ({
  layout,
  pageLayoutMode = 'single',
  pageGap = 24,
  renderPage = defaultRenderPage,
  style,
  ...editableProps
}: PagedEditableProps) => {
  const snapshot = useSlatePageLayoutSnapshot(layout)
  const pages = snapshot.pages.length === 0 ? [snapshot.page] : snapshot.pages
  const geometry = getSlatePageLayoutGeometry(pages, {
    pageGap,
    pageLayoutMode,
  })
  const projection = useMemo(
    () =>
      getSlatePageLayoutProjection(snapshot, {
        geometry,
        hitTesting: false,
        pageGap,
        pageLayoutMode,
      }),
    [geometry, pageGap, pageLayoutMode, snapshot]
  )
  const editableLayout = useMemo<EditableLayout>(
    () => ({
      getVirtualizedTopLevelItems: () =>
        projection.blocks.map((block) => ({
          index: block.blockIndex,
          size: block.height,
          start: block.top,
        })),
    }),
    [projection]
  )
  const editable = (
    <Editable
      {...editableProps}
      layout={editableLayout}
      style={{
        minHeight: geometry.height,
        position: 'relative',
        width: geometry.width,
        zIndex: 0,
        ...style,
      }}
    />
  )

  return (
    <div
      data-slate-paged-editable
      style={{
        minHeight: geometry.height,
        position: 'relative',
        width: geometry.width,
      }}
    >
      {pages.map((page, index) => {
        const placement = geometry.pagePlacements[index] ?? { left: 0, top: 0 }

        return (
          <div
            data-slate-page-surface
            key={page.index}
            style={{
              height: page.height,
              left: placement.left,
              pointerEvents: 'none',
              position: 'absolute',
              top: placement.top,
              width: page.width,
              zIndex: 0,
            }}
          >
            {renderPage({
              attributes: {
                'data-slate-page': true,
                'data-slate-page-index': page.index,
              },
              children: null,
              page,
            })}
          </div>
        )
      })}
      <div
        data-slate-paged-editable-editor-overlay
        style={{
          height: geometry.height,
          left: 0,
          pointerEvents: 'none',
          position: 'absolute',
          top: 0,
          width: geometry.width,
          zIndex: 1,
        }}
      >
        <div
          data-slate-paged-editable-editor
          style={{
            inset: 0,
            pointerEvents: 'auto',
            position: 'absolute',
          }}
        >
          {editable}
        </div>
      </div>
    </div>
  )
}
