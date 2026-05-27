import type React from 'react'
import type { ReactNode } from 'react'
import ReactDOM from 'react-dom'

import { Button as ShadcnButton } from '@/components/ui/button'
import { cn } from '@/utils/cn'

type ButtonProps = React.ComponentPropsWithRef<'button'> & {
  active?: boolean
  reversed?: boolean
}

type SpanProps = React.ComponentPropsWithRef<'span'>

type DivProps = React.ComponentPropsWithRef<'div'>

export const Button = ({
  className,
  active,
  reversed,
  ref,
  ...props
}: ButtonProps) => (
  <ShadcnButton
    {...props}
    className={cn(
      'slate-example-button',
      active && 'is-active',
      reversed && 'is-reversed',
      className
    )}
    ref={ref}
    size="icon"
    variant={active ? 'secondary' : 'ghost'}
  />
)

export const Icon = ({ className, ref, ...props }: SpanProps) => (
  <span
    {...props}
    className={cn('material-icons', 'slate-example-icon', className)}
    ref={ref}
  />
)

export const Instruction = ({ className, ref, ...props }: DivProps) => (
  <div
    {...props}
    className={cn('slate-example-instruction', className)}
    ref={ref}
  />
)

export const Menu = ({ className, ref, ...props }: DivProps) => (
  <div
    {...props}
    className={cn('slate-example-menu', className)}
    data-test-id="menu"
    ref={ref}
  />
)

export const Portal = ({ children }: { children?: ReactNode }) => {
  return typeof document === 'object'
    ? ReactDOM.createPortal(children, document.body)
    : null
}

export const Toolbar = ({ className, ref, ...props }: DivProps) => (
  <Menu
    {...props}
    className={cn('slate-example-toolbar', className)}
    ref={ref}
  />
)
