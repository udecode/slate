import type { ReactNode, Ref } from 'react'
import type { Path, RuntimeId } from 'slate'

import { recordSlateReactRender } from '../render-profiler'
import { getSlateTextShellAttributes } from '../shell-runtime'

export const SlateText = ({
  domSync = false,
  domSyncReason,
  children,
  path,
  ref,
  runtimeId,
}: {
  children: ReactNode
  domSync?: boolean
  domSyncReason?: string | null
  path?: Path
  ref?: Ref<HTMLSpanElement>
  runtimeId?: RuntimeId | null
}) => {
  recordSlateReactRender({ kind: 'text' })

  return (
    <span
      data-slate-path={path ? path.join(',') : undefined}
      data-slate-runtime-id={runtimeId ?? undefined}
      {...getSlateTextShellAttributes({ domSync, domSyncReason })}
      ref={ref}
    >
      {children}
    </span>
  )
}
