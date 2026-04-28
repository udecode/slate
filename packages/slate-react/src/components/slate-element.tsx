import React, { type ReactNode, type Ref, useCallback, useContext } from 'react'

import { NodeRuntimeIdContext } from '../context'
import { useSlateNodeRef } from '../hooks/use-slate-node-ref'
import { recordSlateReactRender } from '../render-profiler'
import { getSlateElementShellAttributes } from '../shell-runtime'

type IntrinsicTag = keyof HTMLElementTagNameMap

type SlateElementProps = Omit<React.HTMLAttributes<HTMLElement>, 'children'> & {
  as?: IntrinsicTag
  children?: ReactNode
  isInline?: boolean
  isVoid?: boolean
  ref?: Ref<HTMLElement>
}

const assignRef = (
  ref: Ref<HTMLElement> | undefined,
  node: HTMLElement | null
) => {
  if (typeof ref === 'function') {
    ref(node)
    return
  }

  if (ref) {
    ref.current = node
  }
}

export const SlateElement = ({
  as: Component = 'div',
  children,
  className,
  id,
  isInline = false,
  isVoid = false,
  ref,
  style,
  ...domProps
}: SlateElementProps) => {
  const runtimeId = useContext(NodeRuntimeIdContext)
  const boundRef = useSlateNodeRef(runtimeId)

  recordSlateReactRender({ id, kind: 'element', runtimeId })

  const combinedRef = useCallback(
    (node: HTMLElement | null) => {
      boundRef(node)
      assignRef(ref, node)
    },
    [boundRef, ref]
  )

  return React.createElement(
    Component,
    {
      ...domProps,
      className,
      ...getSlateElementShellAttributes({ isInline, isVoid }),
      id,
      ref: combinedRef,
      style,
    },
    children
  )
}
