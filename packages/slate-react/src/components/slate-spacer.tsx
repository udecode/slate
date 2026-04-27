import type { CSSProperties, ReactNode } from 'react'

const defaultSpacerStyle: CSSProperties = {
  height: '0',
  color: 'transparent',
  outline: 'none',
  position: 'absolute',
}

export const SlateSpacer = ({
  children,
  style,
}: {
  children: ReactNode
  style?: CSSProperties
}) => (
  <span data-slate-spacer style={{ ...defaultSpacerStyle, ...style }}>
    {children}
  </span>
)
