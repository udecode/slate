import { render } from '@testing-library/react'
import React from 'react'

import {
  getSlateElementShellAttributes,
  getSlateLeafShellAttributes,
  getSlateSpacerShellAttributes,
  getSlateTextShellAttributes,
} from '../src/shell-runtime'

describe('slate-react shell runtime contract', () => {
  test('centralizes primitive shell attributes', () => {
    expect(
      getSlateElementShellAttributes({ isInline: true, isVoid: true })
    ).toMatchObject({
      'data-slate-inline': true,
      'data-slate-node': 'element',
      'data-slate-void': true,
    })
    expect(getSlateTextShellAttributes({ domSync: true })).toMatchObject({
      'data-slate-dom-sync': true,
      'data-slate-node': 'text',
    })
    expect(getSlateLeafShellAttributes()).toEqual({
      'data-slate-leaf': true,
    })
  })

  test('keeps spacer hidden and measurable through one helper', () => {
    const rendered = render(
      <span {...getSlateSpacerShellAttributes({ style: { left: 4 } })}>
        hidden
      </span>
    )
    const spacer = rendered.container.querySelector('[data-slate-spacer]')

    expect(spacer).toBeTruthy()
    expect((spacer as HTMLElement | null)?.style.position).toBe('absolute')
    expect((spacer as HTMLElement | null)?.style.height).toBe('0px')
    expect((spacer as HTMLElement | null)?.style.color).toBe('transparent')
    expect((spacer as HTMLElement | null)?.style.left).toBe('4px')
  })
})
