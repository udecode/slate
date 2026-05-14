import { render } from '@testing-library/react'
import { useMemo, useRef } from 'react'
import { createEditor } from 'slate'

import { useEditableRootRef } from '../src/editable/input-router'
import { withReact } from '../src/plugin/with-react'

const cancelable = () => ({ cancel: () => {} })

const RootRefProbe = ({
  onDOMBeforeInput,
}: {
  onDOMBeforeInput: (event: InputEvent) => void
}) => {
  const editor = useMemo(() => withReact(createEditor()), [])
  const detachNativeInputListenersRef = useRef<(() => void) | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const lifecycle = useMemo(cancelable, [])
  const ref = useEditableRootRef({
    detachNativeInputListenersRef,
    editor,
    onDOMBeforeInput,
    onDOMInput: () => {},
    onDOMSelectionChange: lifecycle,
    rootRef,
    scheduleOnDOMSelectionChange: lifecycle,
  })

  return <div data-testid="root" ref={ref} />
}

test('native input listeners attach once while reading the latest beforeinput handler', () => {
  const firstHandler = jest.fn()
  const secondHandler = jest.fn()
  const addEventListener = jest.spyOn(HTMLElement.prototype, 'addEventListener')
  const removeEventListener = jest.spyOn(
    HTMLElement.prototype,
    'removeEventListener'
  )

  try {
    const rendered = render(<RootRefProbe onDOMBeforeInput={firstHandler} />)
    rendered.rerender(<RootRefProbe onDOMBeforeInput={secondHandler} />)

    rendered.getByTestId('root').dispatchEvent(
      new Event('beforeinput', {
        bubbles: true,
        cancelable: true,
      })
    )

    expect(
      addEventListener.mock.calls.filter(([type]) => type === 'beforeinput')
    ).toHaveLength(1)
    expect(
      removeEventListener.mock.calls.filter(([type]) => type === 'beforeinput')
    ).toHaveLength(0)
    expect(firstHandler).not.toHaveBeenCalled()
    expect(secondHandler).toHaveBeenCalledTimes(1)
  } finally {
    addEventListener.mockRestore()
    removeEventListener.mockRestore()
  }
})
