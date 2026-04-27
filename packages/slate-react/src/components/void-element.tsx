import type { CSSProperties, ReactNode } from 'react'

import { SlateElement } from './slate-element'
import { SlateSpacer } from './slate-spacer'

type IntrinsicTag = keyof HTMLElementTagNameMap

export const VoidElement = ({
  as,
  className,
  content,
  contentAs: Content = 'span',
  contentStyle,
  id,
  spacer,
  spacerStyle,
  style,
}: {
  as?: IntrinsicTag
  className?: string
  content: ReactNode
  contentAs?: IntrinsicTag
  contentStyle?: CSSProperties
  id?: string
  spacer: ReactNode
  spacerStyle?: CSSProperties
  style?: CSSProperties
}) => (
  <SlateElement
    as={as}
    className={className}
    id={id}
    isVoid
    style={{ position: 'relative', ...style }}
  >
    <Content contentEditable={false} style={contentStyle}>
      {content}
    </Content>
    <SlateSpacer style={spacerStyle}>{spacer}</SlateSpacer>
  </SlateElement>
)
