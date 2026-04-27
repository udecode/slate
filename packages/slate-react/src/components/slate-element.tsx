import React, {
  type CSSProperties,
  type ReactNode,
  type Ref,
  useCallback,
  useContext,
} from 'react'

import { NodeRuntimeIdContext } from '../context'
import { useSlateNodeRef } from '../hooks/use-slate-node-ref'

type IntrinsicTag = keyof HTMLElementTagNameMap

type SlateElementProps = {
  as?: IntrinsicTag
  children?: ReactNode
  className?: string
  id?: string
  isInline?: boolean
  isVoid?: boolean
  onClick?: React.MouseEventHandler<HTMLElement>
  onFocus?: React.FocusEventHandler<HTMLElement>
  ref?: Ref<HTMLElement>
  style?: CSSProperties
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
  onClick,
  onFocus,
  ref,
  style,
}: SlateElementProps) => {
  const runtimeId = useContext(NodeRuntimeIdContext)
  const boundRef = useSlateNodeRef(runtimeId)

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
      className,
      'data-slate-inline': isInline ? true : undefined,
      'data-slate-node': 'element',
      'data-slate-void': isVoid ? true : undefined,
      id,
      onClick,
      onFocus,
      ref: combinedRef,
      style,
    },
    children
  )
}
