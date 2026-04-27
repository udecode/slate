import { createElement } from 'react'

export const TextString = ({
  text,
  isTrailing = false,
}: {
  text: string
  isTrailing?: boolean
}) => {
  return createElement(
    'span',
    { 'data-slate-string': true },
    `${text ?? ''}${isTrailing ? '\n' : ''}`
  )
}
