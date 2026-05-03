import type {
  CSSProperties,
  ElementType,
  HTMLAttributes,
  ReactNode,
  Ref,
} from 'react'
import { IS_WEBKIT } from 'slate-dom'

type IntrinsicTag = keyof HTMLElementTagNameMap

type SlatePlaceholderProps = {
  as?: IntrinsicTag
  children: ReactNode
  dir?: 'rtl'
  ref?: Ref<HTMLElement>
  style?: CSSProperties
}

type SlatePlaceholderComponentProps = HTMLAttributes<HTMLElement> & {
  ref?: Ref<HTMLElement>
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
  as = 'div',
  children,
  dir,
  ref,
  style,
}: SlatePlaceholderProps) => {
  const Component = as as ElementType<SlatePlaceholderComponentProps>

  return (
    <Component
      aria-hidden
      contentEditable={false}
      data-slate-placeholder
      dir={dir}
      ref={ref}
      style={getSlatePlaceholderStyle(style)}
    >
      {children}
    </Component>
  )
}
