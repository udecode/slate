import { createElement, type ReactNode, type Ref } from 'react'

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
}) =>
  createElement(
    'span',
    {
      'data-slate-dom-sync': domSync ? true : undefined,
      'data-slate-dom-sync-reason': domSync ? undefined : domSyncReason,
      'data-slate-node': 'text',
      ref,
    },
    children
  )
