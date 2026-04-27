import React, { type CSSProperties, type ReactNode, type Ref } from 'react'
import { IS_WEBKIT } from 'slate-dom'

type IntrinsicTag = keyof HTMLElementTagNameMap

type SlatePlaceholderProps = {
  as?: IntrinsicTag
  children: ReactNode
  dir?: 'rtl'
  ref?: Ref<HTMLElement>
  style?: CSSProperties
}

const defaultPlaceholderStyle: CSSProperties = {
  position: 'absolute',
  top: 0,
  pointerEvents: 'none',
  width: '100%',
  maxWidth: '100%',
  display: 'block',
  opacity: '0.333',
  userSelect: 'none',
  textDecoration: 'none',
  WebkitUserModify: IS_WEBKIT ? 'inherit' : undefined,
}

export const getSlatePlaceholderStyle = (
  style?: CSSProperties
): CSSProperties => ({
  ...defaultPlaceholderStyle,
  ...style,
})

export const SlatePlaceholder = ({
  as: Component = 'div',
  children,
  dir,
  ref,
  style,
}: SlatePlaceholderProps): React.JSX.Element =>
  React.createElement(
    Component,
    {
      'aria-hidden': true,
      contentEditable: false,
      'data-slate-placeholder': true,
      dir,
      ref,
      style: getSlatePlaceholderStyle(style),
    },
    children
  )
