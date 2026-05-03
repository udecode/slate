import type { CSSProperties, ReactNode } from 'react'

import { SlateElement } from './slate-element'

type IntrinsicTag = keyof HTMLElementTagNameMap

export const EditableElement = ({
  as,
  children,
  className,
  id,
  isInline = false,
  style,
}: {
  as?: IntrinsicTag
  children: ReactNode
  className?: string
  id?: string
  isInline?: boolean
  style?: CSSProperties
}) => (
  <SlateElement
    as={as}
    className={className}
    id={id}
    isInline={isInline}
    style={{ position: 'relative', ...style }}
  >
    {children}
  </SlateElement>
)
