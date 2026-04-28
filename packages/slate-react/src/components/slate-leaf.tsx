import { createElement, type ReactNode } from 'react'

import { recordSlateReactRender } from '../render-profiler'
import { getSlateLeafShellAttributes } from '../shell-runtime'

export const SlateLeaf = ({ children }: { children: ReactNode }) => {
  recordSlateReactRender({ kind: 'leaf' })

  return createElement('span', getSlateLeafShellAttributes(), children)
}
