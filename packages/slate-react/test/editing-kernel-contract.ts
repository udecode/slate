import { createEditor } from 'slate'

import {
  beginEditableEventFrame,
  createEditableKernelResult,
  EDITABLE_COMMAND_DEFINITIONS,
  getCurrentEditableEventFrame,
  getEditableCommandDefinition,
  getEditableCommandFromBeforeInputType,
  getEditableCommandFromKeyDown,
  getEditableKernelTransition,
  getEditableMovementOwnershipTrace,
  getEditableSelectionChangeOwnership,
  prepareEditableCompositionKernel,
  prepareEditableKeyDownKernel,
} from '../src/editable/editing-kernel'
import {
  classifyBeforeInputIntent,
  classifyKeyboardIntent,
} from '../src/editable/input-controller'
import {
  createEditableInputController,
  createEditableInputControllerState,
} from '../src/editable/input-state'

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

test('kernel traces attach typed command definitions', () => {
  const command = {
    inputType: 'insertText',
    kind: 'insert-text' as const,
    text: 'x',
  }
  const result = createEditableKernelResult({
    editor: createEditor(),
    handled: true,
    trace: {
      ...createBaseTrace(),
      command,
      eventFamily: 'beforeinput',
      intent: 'insert-text',
      nativeAllowed: false,
      ownership: 'model-owned',
      stateAfter: 'model-owned',
      stateBefore: 'dom-selection',
    },
  })

  expect(result.trace.commandDefinition).toBe(
    EDITABLE_COMMAND_DEFINITIONS['insert-text']
  )
  expect(getEditableCommandDefinition(command)).toBe(
    EDITABLE_COMMAND_DEFINITIONS['insert-text']
  )
})

test('editable command definitions cover every command kind', () => {
  expect(Object.keys(EDITABLE_COMMAND_DEFINITIONS).sort()).toEqual([
    'delete',
    'delete-both',
    'delete-fragment',
    'history',
    'insert-break',
    'insert-data',
    'insert-text',
    'move-selection',
    'select',
    'select-all',
    'set-block',
    'toggle-mark',
    'transpose-character',
  ])
})

test('beforeinput and keydown commands resolve through typed definitions', () => {
  const beforeInputCommand = getEditableCommandFromBeforeInputType({
    data: null,
    inputType: 'deleteContentBackward',
    selection: null,
  })
  const transposeCommand = getEditableCommandFromBeforeInputType({
    data: null,
    inputType: 'insertTranspose',
    selection: null,
  })
  const keyDownCommand = getEditableCommandFromKeyDown({
    event: {
      nativeEvent: {
        altKey: false,
        ctrlKey: false,
        key: 'Enter',
        metaKey: false,
        shiftKey: false,
        which: 13,
      },
    } as any,
    selection: null,
  })

  expect(beforeInputCommand?.kind).toBe('delete')
  expect(
    getEditableCommandDefinition(beforeInputCommand)?.inputFamilies
  ).toContain('beforeinput')
  expect(keyDownCommand?.kind).toBe('insert-break')
  expect(getEditableCommandDefinition(keyDownCommand)?.inputFamilies).toContain(
    'keydown'
  )
  expect(transposeCommand).toEqual({ kind: 'transpose-character' })
  expect(
    getEditableCommandDefinition(transposeCommand)?.inputFamilies
  ).toContain('beforeinput')
})

test('beforeinput data transfer commands preserve the browser payload', () => {
  class DataTransfer {}

  const dataTransfer = new DataTransfer()

  for (const inputType of [
    'insertFromDrop',
    'insertFromPaste',
    'insertFromYank',
  ]) {
    const command = getEditableCommandFromBeforeInputType({
      data: dataTransfer,
      inputType,
      selection: null,
    })

    expect(command).toEqual({ data: dataTransfer, kind: 'insert-data' })
    expect(getEditableCommandDefinition(command)?.inputFamilies).toContain(
      'beforeinput'
    )
  }
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
      renderingStrategy: null,
    })
  ).toBe('insert-break')
})

test('keyboard events during composition stay browser-owned', () => {
  const editor = createEditor() as any
  const inputController = createEditableInputController({
    preferModelSelectionForInputRef: { current: false },
    state: createEditableInputControllerState(),
  })
  inputController.state.isComposing = true
  inputController.state.selectionSource = 'composition-owned'

  const decision = prepareEditableKeyDownKernel({
    editor,
    event: {
      nativeEvent: {
        altKey: false,
        ctrlKey: false,
        isComposing: true,
        key: 'ArrowRight',
        metaKey: false,
        shiftKey: false,
        which: 39,
      },
      target: null,
    } as any,
    inputController,
    renderingStrategy: null,
  })

  expect(decision).toMatchObject({
    command: null,
    intent: 'composition',
    nativeAllowed: true,
    ownership: 'native-allowed',
    selectionPolicy: { kind: 'none', reason: 'not-requested' },
    shouldForceDOMImport: false,
    stateBefore: 'composition',
  })
})

test('composition lifecycle events stay browser-owned', () => {
  const editor = createEditor() as any
  const inputController = createEditableInputController({
    preferModelSelectionForInputRef: { current: false },
    state: createEditableInputControllerState(),
  })
  inputController.state.isComposing = true
  inputController.state.selectionSource = 'composition-owned'

  const decision = prepareEditableCompositionKernel({
    editor,
    event: {
      target: null,
    } as any,
    inputController,
  })

  expect(decision).toMatchObject({
    intent: 'composition',
    nativeAllowed: true,
    ownership: 'native-allowed',
    repairPolicy: { kind: 'none', reason: 'not-requested' },
    selectionPolicy: { kind: 'none', reason: 'not-requested' },
    stateBefore: 'composition',
  })
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

test('kernel transition allows history commands from internal controls', () => {
  expect(
    getEditableKernelTransition({
      command: { direction: 'undo', kind: 'history' },
      eventFamily: 'keydown',
      nativeAllowed: false,
      ownership: 'model-owned',
      repairPolicy: { kind: 'none', reason: 'not-requested' },
      stateAfter: 'model-owned',
      targetOwner: 'internal-control',
    })
  ).toEqual({
    allowed: true,
    reason: null,
  })
})

test('kernel transition keeps non-history internal control commands rejected', () => {
  expect(
    getEditableKernelTransition({
      command: {
        inputType: 'insertText',
        kind: 'insert-text',
        text: 'x',
      },
      eventFamily: 'keydown',
      nativeAllowed: false,
      ownership: 'model-owned',
      repairPolicy: { kind: 'none', reason: 'not-requested' },
      stateAfter: 'model-owned',
      targetOwner: 'internal-control',
    })
  ).toEqual({
    allowed: false,
    reason: 'internal controls cannot dispatch model commands',
  })
})

test('beforeinput history stays model-owned for internal controls', () => {
  expect(
    classifyBeforeInputIntent({
      editor: createEditor() as any,
      event: {
        inputType: 'historyUndo',
        target: null,
      } as any,
      internalTarget: true,
    })
  ).toBe('history')
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
