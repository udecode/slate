import type { Range } from 'slate'
import { getDeferredNativeTextInputRepairPathKey } from '../src/editable/runtime-before-input-events'

const collapsedSelection: Range = {
  anchor: { offset: 1, path: [2500, 0] },
  focus: { offset: 1, path: [2500, 0] },
}

const expandedSelection: Range = {
  anchor: { offset: 1, path: [2500, 0] },
  focus: { offset: 3, path: [2500, 0] },
}

test('deferred native text input publishes its repair path before DOM input', () => {
  expect(
    getDeferredNativeTextInputRepairPathKey({
      data: 'X',
      deferNativeTextInputRepair: true,
      inputType: 'insertText',
      native: true,
      selection: collapsedSelection,
    })
  ).toBe('2500,0')
})

test('deferred native text input path is only for collapsed native insertText', () => {
  expect(
    getDeferredNativeTextInputRepairPathKey({
      data: 'X',
      deferNativeTextInputRepair: false,
      inputType: 'insertText',
      native: true,
      selection: collapsedSelection,
    })
  ).toBe(null)
  expect(
    getDeferredNativeTextInputRepairPathKey({
      data: 'X',
      deferNativeTextInputRepair: true,
      inputType: 'deleteContentBackward',
      native: true,
      selection: collapsedSelection,
    })
  ).toBe(null)
  expect(
    getDeferredNativeTextInputRepairPathKey({
      data: 'X',
      deferNativeTextInputRepair: true,
      inputType: 'insertText',
      native: false,
      selection: collapsedSelection,
    })
  ).toBe(null)
  expect(
    getDeferredNativeTextInputRepairPathKey({
      data: '',
      deferNativeTextInputRepair: true,
      inputType: 'insertText',
      native: true,
      selection: collapsedSelection,
    })
  ).toBe(null)
  expect(
    getDeferredNativeTextInputRepairPathKey({
      data: 'X',
      deferNativeTextInputRepair: true,
      inputType: 'insertText',
      native: true,
      selection: expandedSelection,
    })
  ).toBe(null)
})
