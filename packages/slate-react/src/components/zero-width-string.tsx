import { createElement } from 'react'

export const ZeroWidthString = ({
  length = 0,
  isLineBreak = false,
  isMarkPlaceholder = false,
  includeSentinel = !isLineBreak,
}: {
  length?: number
  isLineBreak?: boolean
  isMarkPlaceholder?: boolean
  includeSentinel?: boolean
}) => {
  const attributes: {
    'data-slate-zero-width': string
    'data-slate-length': number
    'data-slate-mark-placeholder'?: boolean
  } = {
    'data-slate-zero-width': isLineBreak ? 'n' : 'z',
    'data-slate-length': length,
  }

  if (isMarkPlaceholder) {
    attributes['data-slate-mark-placeholder'] = true
  }

  if (isLineBreak) {
    if (includeSentinel) {
      return createElement('span', attributes, '\uFEFF', createElement('br'))
    }

    return createElement('span', {
      ...attributes,
      dangerouslySetInnerHTML: { __html: '<br />' },
    })
  }

  return createElement('span', attributes, '\uFEFF')
}
