import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react'
import type { Editor, Path } from 'slate'
import {
  Editable,
  type EditableLayout,
  type EditableProps,
  useElementPath,
} from 'slate-react'

import {
  createSlateLayout,
  createSlatePageLayout,
  getSlatePageLayoutGeometry,
  getSlatePageLayoutProjection,
  type SlateLayout,
  type SlateLayoutOptions,
  type SlateLayoutSnapshot,
  type SlatePageLayout,
  type SlatePageLayoutFragment,
  type SlatePageLayoutMode,
  type SlatePageLayoutOptions,
  type SlatePageLayoutPage,
  type SlatePageLayoutProjectedLine,
  type SlatePageLayoutProjectedUnit,
  type SlatePageLayoutProjection,
  type SlatePageLayoutSnapshot,
  type SlatePageRect,
  type SlatePageSettings,
  type SlatePageSettingsSource,
} from './index'
import { createPagedEditablePageMountPlan } from './page-mount-plan'

type SlateLayoutFragmentContextValue = {
  layout: SlatePageLayout
  projectedLinesByFragment: ReadonlyMap<
    string,
    readonly SlatePageLayoutProjectedLine[]
  >
  projectedUnitsByFragment: ReadonlyMap<
    string,
    ReadonlyMap<string, SlatePageLayoutProjectedUnit>
  >
  projection: SlatePageLayoutProjection
  snapshot: SlatePageLayoutSnapshot
}

const SlateLayoutFragmentContext =
  createContext<SlateLayoutFragmentContextValue | null>(null)

export type SlateLayoutRenderedFragment = Pick<
  SlatePageLayoutFragment,
  'blockIndex' | 'height' | 'id' | 'lineCount' | 'pageIndex' | 'path' | 'text'
> & {
  rect: SlatePageRect
  units?: readonly SlatePageLayoutProjectedUnit[]
}

const getRectBounds = (rects: readonly SlatePageRect[]): SlatePageRect => {
  if (rects.length === 0) {
    return { height: 0, left: 0, top: 0, width: 0 }
  }

  const left = Math.min(...rects.map((rect) => rect.left))
  const top = Math.min(...rects.map((rect) => rect.top))
  const right = Math.max(...rects.map((rect) => rect.left + rect.width))
  const bottom = Math.max(...rects.map((rect) => rect.top + rect.height))

  return {
    height: bottom - top,
    left,
    top,
    width: right - left,
  }
}

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
  }, [
    layout,
    options.nodeLayout,
    options.root,
    options.typography,
    pageDependency,
  ])

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
  }, [
    layout,
    options.engine,
    options.nodeLayout,
    options.root,
    options.typography,
    pageDependency,
  ])

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

export const useSlateLayoutFragments = (
  path?: Path | null
): readonly SlateLayoutRenderedFragment[] => {
  const context = useContext(SlateLayoutFragmentContext)
  const elementPath = useElementPath()
  const targetPath = path ?? elementPath

  return useMemo(() => {
    if (!context || !targetPath) {
      return []
    }

    return context.layout.getFragments(targetPath).map((fragment) => {
      const projectedUnits = context.projectedUnitsByFragment.get(fragment.id)
      const units = fragment.units
        ?.map((unit) => projectedUnits?.get(unit.key))
        .filter((unit): unit is SlatePageLayoutProjectedUnit => Boolean(unit))
      const lines = context.projectedLinesByFragment.get(fragment.id) ?? []
      const rects = [
        ...(units?.map((unit) => unit.rect) ?? []),
        ...lines.map((line) => line.hitRect),
      ]

      return {
        blockIndex: fragment.blockIndex,
        height: fragment.height,
        id: fragment.id,
        lineCount: fragment.lineCount,
        pageIndex: fragment.pageIndex,
        path: fragment.path,
        rect: getRectBounds(rects),
        text: fragment.text,
        units,
      }
    })
  }, [context, targetPath])
}

export type PagedEditableRenderPageProps = {
  attributes: {
    'data-slate-page': true
    'data-slate-page-index': number
  }
  children: ReactNode | null
  page: SlatePageLayoutPage
}

export type PagedEditablePageLayoutMode = SlatePageLayoutMode

export type PagedEditablePageView = {
  gap?: number
  mode?: PagedEditablePageLayoutMode
}

export type PagedEditableProps = EditableProps & {
  layout: SlatePageLayout
  pageView?: PagedEditablePageView
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

const normalizePagedEditablePageView = ({
  pageGap,
  pageLayoutMode,
  pageView,
}: {
  pageGap?: number
  pageLayoutMode?: PagedEditablePageLayoutMode
  pageView?: PagedEditablePageView | null
}) => ({
  gap: pageView?.gap ?? pageGap ?? 24,
  mode: pageView?.mode ?? pageLayoutMode ?? 'single',
})

export const PagedEditable = ({
  layout,
  pageGap,
  pageLayoutMode,
  pageView,
  renderPage = defaultRenderPage,
  style,
  ...editableProps
}: PagedEditableProps) => {
  const snapshot = useSlatePageLayoutSnapshot(layout)
  const pages = snapshot.pages.length === 0 ? [snapshot.page] : snapshot.pages
  const normalizedPageView = normalizePagedEditablePageView({
    pageGap,
    pageLayoutMode,
    pageView,
  })
  const geometry = getSlatePageLayoutGeometry(pages, {
    pageGap: normalizedPageView.gap,
    pageLayoutMode: normalizedPageView.mode,
  })
  const projection = useMemo(
    () =>
      getSlatePageLayoutProjection(snapshot, {
        geometry,
        hitTesting: false,
        pageGap: normalizedPageView.gap,
        pageLayoutMode: normalizedPageView.mode,
      }),
    [geometry, normalizedPageView.gap, normalizedPageView.mode, snapshot]
  )
  const projectedUnitsByFragment = useMemo(() => {
    const byFragment = new Map<
      string,
      Map<string, SlatePageLayoutProjectedUnit>
    >()

    projection.units.forEach((unit) => {
      const units = byFragment.get(unit.fragmentId) ?? new Map()

      units.set(unit.key, unit)
      byFragment.set(unit.fragmentId, units)
    })

    return byFragment
  }, [projection.units])
  const projectedLinesByFragment = useMemo(() => {
    const byFragment = new Map<string, SlatePageLayoutProjectedLine[]>()

    projection.lines.forEach((line) => {
      const lines = byFragment.get(line.fragmentId) ?? []

      lines.push(line)
      byFragment.set(line.fragmentId, lines)
    })

    return byFragment
  }, [projection.lines])
  const pageMountPlan = useMemo(
    () =>
      createPagedEditablePageMountPlan({
        fragments: snapshot.fragments,
        geometry,
        mode: normalizedPageView.mode,
        pages,
      }),
    [geometry, normalizedPageView.mode, pages, snapshot.fragments]
  )
  const pageRenderDataByIndex = useMemo(
    () =>
      new Map(
        pages.map((page, index) => [
          page.index,
          {
            page,
            placement: geometry.pagePlacements[index] ?? { left: 0, top: 0 },
          },
        ])
      ),
    [geometry.pagePlacements, pages]
  )
  const editableLayout = useMemo<EditableLayout>(
    () => ({
      getVirtualizedPageItems: () =>
        pageMountPlan.items.map((item) => ({
          index: item.index,
          key: item.key,
          pageIndexes: item.pageIndexes,
          size: item.size,
          start: item.start,
          topLevelIndexes: item.topLevelIndexes,
        })),
      getVirtualizedTopLevelItems: () =>
        projection.blocks.map((block) => ({
          index: block.blockIndex,
          size: block.height,
          start: block.top,
        })),
    }),
    [pageMountPlan, projection]
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
    <SlateLayoutFragmentContext.Provider
      value={{
        layout,
        projectedLinesByFragment,
        projectedUnitsByFragment,
        projection,
        snapshot,
      }}
    >
      <div
        data-slate-paged-editable
        style={{
          minHeight: geometry.height,
          position: 'relative',
          width: geometry.width,
        }}
      >
        {pageMountPlan.items.flatMap((item) =>
          item.pageIndexes.map((pageIndex) => {
            const renderData = pageRenderDataByIndex.get(pageIndex)

            if (!renderData) {
              return null
            }

            const { page, placement } = renderData

            return (
              <div
                data-slate-page-mount-item-index={item.index}
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
          })
        )}
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
    </SlateLayoutFragmentContext.Provider>
  )
}
