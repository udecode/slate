import { describe, expect, test } from 'vitest'

import {
  resolveRootInteractionMouseDown,
  resolveRootInteractionMouseUp,
  resolveRootInteractionTarget,
} from '../src/editable/root-interaction-resolver'

const createRootChrome = () => {
  const root = document.createElement('section')

  root.dataset.slateRootChrome = 'body'

  return root
}

describe('root interaction resolver', () => {
  test('keeps interactive descendants native', () => {
    const root = createRootChrome()
    const button = document.createElement('button')

    root.append(button)

    const target = resolveRootInteractionTarget({
      currentTarget: root,
      target: button,
    })

    expect(target.kind).toBe('interactive-descendant')
    expect(resolveRootInteractionMouseDown({ target }).type).toBe('ignore')
  })

  test('restores selection for root chrome activation without coordinates', () => {
    const root = createRootChrome()
    const label = document.createElement('span')

    root.append(label)

    const target = resolveRootInteractionTarget({
      currentTarget: root,
      target: label,
    })
    const mouseDown = resolveRootInteractionMouseDown({ target })

    expect(target.kind).toBe('root-chrome')
    expect(mouseDown).toEqual({
      preventDefault: true,
      type: 'activate-root',
    })
    expect(
      resolveRootInteractionMouseUp({
        eventRange: null,
        pendingAction: mouseDown,
        selection: 'restore',
      })
    ).toEqual({
      selection: 'restore',
      type: 'focus-root',
    })
  })

  test('places caret at root end for editable root surface clicks without coordinates', () => {
    const root = createRootChrome()
    const editable = document.createElement('div')

    editable.dataset.slateEditor = 'true'
    root.append(editable)

    const target = resolveRootInteractionTarget({
      currentTarget: root,
      target: editable,
    })
    const mouseDown = resolveRootInteractionMouseDown({
      editableRootFocused: false,
      target,
    })

    expect(target.kind).toBe('editable-root')
    expect(mouseDown).toEqual({
      preventDefault: true,
      type: 'place-editable-root',
    })
    expect(
      resolveRootInteractionMouseUp({
        eventRange: null,
        pendingAction: mouseDown,
        selection: 'restore',
      })
    ).toEqual({
      selection: 'end',
      type: 'focus-root',
    })
  })

  test('prefocuses blurred native text targets without blocking native selection', () => {
    const root = createRootChrome()
    const editable = document.createElement('div')
    const text = document.createElement('span')

    editable.dataset.slateEditor = 'true'
    text.dataset.slateString = 'true'
    editable.append(text)
    root.append(editable)

    const target = resolveRootInteractionTarget({
      currentTarget: root,
      target: text,
    })
    const mouseDown = resolveRootInteractionMouseDown({
      editableRootFocused: false,
      target,
    })

    expect(target.kind).toBe('native-editable')
    expect(mouseDown).toEqual({
      type: 'focus-native-editable',
    })
    expect(
      resolveRootInteractionMouseUp({
        eventRange: null,
        pendingAction: mouseDown,
        selection: 'restore',
      })
    ).toEqual({
      type: 'ignore',
    })
  })

  test('lets editable roots ignore nested editor clicks', () => {
    const root = document.createElement('div')
    const nested = document.createElement('div')
    const text = document.createElement('span')

    root.dataset.slateEditor = 'true'
    nested.dataset.slateEditor = 'true'
    text.dataset.slateString = 'true'
    nested.append(text)
    root.append(nested)

    const target = resolveRootInteractionTarget({
      currentTarget: root,
      target: text,
    })

    expect(target.kind).toBe('interactive-descendant')
    expect(resolveRootInteractionMouseDown({ target }).type).toBe('ignore')
  })
})
