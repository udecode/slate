import { createElement, type ReactNode, type Ref } from 'react'

import { recordSlateReactRender } from '../render-profiler'
import { getSlateTextShellAttributes } from '../shell-runtime'

export const SlateText = ({
  domSync = false,
  domSyncReason,
  children,
  ref,
}: {
  children: ReactNode
  domSync?: boolean
  domSyncReason?: string | null
  ref?: Ref<HTMLSpanElement>
}) => {
  recordSlateReactRender({ kind: 'text' })

  return createElement(
    'span',
    {
      ...getSlateTextShellAttributes({ domSync, domSyncReason }),
      ref,
    },
    children
  )
}
