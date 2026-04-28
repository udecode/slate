import { createEditor } from 'slate'

import {
  beginEditableEventFrame,
  createEditableKernelResult,
  getCurrentEditableEventFrame,
  getEditableKernelTransition,
  getEditableMovementOwnershipTrace,
  getEditableSelectionChangeOwnership,
} from '../src/editable/editing-kernel'
import { classifyKeyboardIntent } from '../src/editable/input-controller'

const createBaseTrace = () =>
  ({
    command: null,
    eventFamily: 'selectionchange' as const,
    intent: null,
    nativeAllowed: true,
    operations: [],
    ownership: 'native-allowed' as const,
    repair: null,
    selectionBefore: null,
    selectionSource: 'dom-current' as const,
    stateAfter: 'dom-selection' as const,
    stateBefore: 'idle' as const,
    targetOwner: 'editor' as const,
  }) satisfies Parameters<typeof createEditableKernelResult>[0]['trace']

test('kernel results expose explicit selection and repair policies', () => {
  const result = createEditableKernelResult({
    editor: createEditor(),
    handled: true,
    trace: createBaseTrace(),
  })

  expect(result.selectionPolicy).toEqual({
    kind: 'import-dom',
    reason: 'native-selection',
  })
  expect(result.repairPolicy).toEqual({
    kind: 'none',
    reason: 'not-requested',
  })
  expect(result.trace.selectionPolicy).toEqual(result.selectionPolicy)
  expect(result.trace.repairPolicy).toEqual(result.repairPolicy)
})

test('kernel traces attach the current editable event frame', () => {
  const editor = createEditor()
  const frame = beginEditableEventFrame(editor, {
    eventFamily: 'keydown',
    focusOwner: 'editor',
    inputIntent: 'model-selection-move',
    selectionSource: 'dom-current',
    targetOwner: 'editor',
  })

  const result = createEditableKernelResult({
    editor,
    handled: true,
    trace: {
      ...createBaseTrace(),
      command: {
        axis: 'horizontal',
        kind: 'move-selection',
      },
      eventFamily: 'keydown',
      nativeAllowed: false,
      ownership: 'model-owned',
      selectionSource: 'dom-current',
      stateAfter: 'model-owned',
      stateBefore: 'dom-selection',
    },
  })

  expect(getCurrentEditableEventFrame(editor)).toEqual(frame)
  expect(result.trace.frame).toEqual(frame)
  expect(result.trace.frameId).toBe(frame.id)
})

test('repair kernel results preserve model selection by default', () => {
  const result = createEditableKernelResult({
    editor: createEditor(),
    handled: true,
    trace: {
      ...createBaseTrace(),
      eventFamily: 'repair',
      nativeAllowed: false,
      ownership: 'model-owned',
      repair: { kind: 'repair-caret' },
      selectionSource: 'model-owned',
      stateAfter: 'repairing',
      stateBefore: 'model-owned',
    },
  })

  expect(result.selectionPolicy).toEqual({
    kind: 'preserve-model',
    reason: 'model-owned',
  })
  expect(result.repairPolicy).toEqual({
    kind: 'repair-caret',
    reason: 'repair-caret',
  })
})

test('kernel traces preserve selectionchange origin metadata', () => {
  const result = createEditableKernelResult({
    editor: createEditor(),
    handled: true,
    trace: {
      ...createBaseTrace(),
      nativeAllowed: false,
      ownership: 'model-owned',
      selectionChangeOrigin: 'repair-induced',
      selectionSource: 'model-owned',
      stateAfter: 'model-owned',
    },
  })

  expect(result.trace.selectionChangeOrigin).toBe('repair-induced')
})

test('movement ownership trace records model-owned horizontal reason', () => {
  expect(
    getEditableMovementOwnershipTrace({
      command: { axis: 'horizontal', kind: 'move-selection' },
      intent: 'model-selection-move',
      key: 'ArrowRight',
      ownership: 'model-owned',
    })
  ).toEqual({
    axis: 'horizontal',
    extend: false,
    key: 'ArrowRight',
    ownership: 'model-owned',
    reason: 'model-horizontal-inline-void',
    reverse: null,
  })
})

test('movement ownership trace records native vertical reason', () => {
  expect(
    getEditableMovementOwnershipTrace({
      command: null,
      intent: 'native-selection-move',
      key: 'ArrowDown',
      ownership: 'native-allowed',
    })
  ).toEqual({
    axis: 'vertical',
    extend: false,
    key: 'ArrowDown',
    ownership: 'native-allowed',
    reason: 'native-vertical-layout',
    reverse: false,
  })
})

test('keyboard split-block commands are model-owned structural intent', () => {
  expect(
    classifyKeyboardIntent({
      editor: createEditor() as any,
      event: {
        nativeEvent: {
          altKey: false,
          ctrlKey: false,
          key: 'Enter',
          metaKey: false,
          shiftKey: false,
          which: 13,
        },
        target: null,
      } as any,
      largeDocument: null,
    })
  ).toBe('insert-break')
})

test('kernel transition rejects native-owned repair policies', () => {
  expect(
    getEditableKernelTransition({
      command: null,
      eventFamily: 'input',
      nativeAllowed: true,
      ownership: 'native-allowed',
      repairPolicy: { kind: 'repair-caret', reason: 'after-native-input' },
      stateAfter: 'dom-selection',
      targetOwner: 'editor',
    })
  ).toEqual({
    allowed: false,
    reason: 'native-owned events cannot schedule model repair',
  })
})

test('kernel result creation rejects illegal transitions in test mode', () => {
  expect(() =>
    createEditableKernelResult({
      editor: createEditor(),
      handled: true,
      trace: {
        ...createBaseTrace(),
        eventFamily: 'input',
        nativeAllowed: true,
        ownership: 'native-allowed',
        repair: { kind: 'repair-caret' },
      },
    })
  ).toThrow(
    'Illegal Editable kernel transition: native-owned events cannot schedule model repair'
  )
})

test('kernel result creation rejects DOM import during repair frames', () => {
  expect(() =>
    createEditableKernelResult({
      editor: createEditor(),
      handled: true,
      trace: {
        ...createBaseTrace(),
        eventFamily: 'repair',
        nativeAllowed: false,
        ownership: 'model-owned',
        repair: { kind: 'repair-caret' },
        selectionPolicy: { kind: 'import-dom', reason: 'unknown-selection' },
        selectionSource: 'model-owned',
        stateAfter: 'repairing',
        stateBefore: 'model-owned',
      },
    })
  ).toThrow(
    'Illegal Editable kernel transition: repair cannot import DOM selection'
  )
})

test('selectionchange ownership keeps repair and programmatic changes model-owned', () => {
  expect(
    getEditableSelectionChangeOwnership({
      selectionChangeOrigin: 'repair-induced',
      selectionSource: 'model-owned',
    })
  ).toBe('model-owned')
  expect(
    getEditableSelectionChangeOwnership({
      selectionChangeOrigin: 'programmatic-export',
      selectionSource: 'model-owned',
    })
  ).toBe('model-owned')
  expect(
    getEditableSelectionChangeOwnership({
      selectionChangeOrigin: 'native-user',
      selectionSource: 'dom-current',
    })
  ).toBe('native-allowed')
})

test('kernel transition rejects repair-induced selectionchange as native intent', () => {
  expect(
    getEditableKernelTransition({
      command: null,
      eventFamily: 'selectionchange',
      nativeAllowed: true,
      ownership: 'native-allowed',
      repairPolicy: { kind: 'none', reason: 'not-requested' },
      selectionChangeOrigin: 'repair-induced',
      stateAfter: 'dom-selection',
      targetOwner: 'editor',
    })
  ).toEqual({
    allowed: false,
    reason: 'programmatic selectionchange cannot re-import as native intent',
  })
})
