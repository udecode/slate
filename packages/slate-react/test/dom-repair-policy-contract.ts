import {
  beginDOMRepairFrame,
  cancelDOMRepairBefore,
  createDOMRepairFrameState,
  isDOMRepairFrameCurrent,
} from '../src/editable/dom-repair-queue'
import { executeEditableRepairPolicy } from '../src/editable/mutation-controller'

test('repair frame state rejects work scheduled by an older frame', () => {
  const state = createDOMRepairFrameState()

  beginDOMRepairFrame(state, 3)
  expect(isDOMRepairFrameCurrent(state, 3)).toBe(true)

  cancelDOMRepairBefore(state, 4)
  expect(isDOMRepairFrameCurrent(state, 3)).toBe(false)

  beginDOMRepairFrame(state, 4)
  expect(isDOMRepairFrameCurrent(state, 4)).toBe(true)
})

test('repair execution is skipped for none policy', () => {
  let calls = 0

  expect(
    executeEditableRepairPolicy({
      repair: () => {
        calls++
      },
      repairPolicy: { kind: 'none', reason: 'not-requested' },
    })
  ).toBe(false)
  expect(calls).toBe(0)
})

test('repair execution runs for explicit repair policy', () => {
  let calls = 0

  expect(
    executeEditableRepairPolicy({
      repair: () => {
        calls++
      },
      repairPolicy: { kind: 'repair-caret', reason: 'repair-caret' },
    })
  ).toBe(true)
  expect(calls).toBe(1)
})
