import { createEditor } from 'slate'
import {
  beginEditableEditingEpoch,
  beginOrJoinEditableEditingEpoch,
  getCurrentEditableEditingEpoch,
  markEditableEditingEpochCommandHandled,
  shouldSkipDuplicateEditableEditingEpochCommand,
} from '../src/editable/editing-epoch-kernel'
import {
  createEditableKernelResult,
  recordEditableKernelTrace,
} from '../src/editable/editing-kernel'

const destructiveCommand = {
  direction: 'backward' as const,
  kind: 'delete' as const,
  unit: 'word' as const,
}

const createTrace = () =>
  ({
    command: destructiveCommand,
    eventFamily: 'keydown' as const,
    intent: 'delete-backward' as const,
    nativeAllowed: false,
    operations: [],
    ownership: 'model-owned' as const,
    repair: null,
    selectionBefore: null,
    selectionSource: 'model-owned' as const,
    stateAfter: 'model-owned' as const,
    stateBefore: 'model-owned' as const,
    targetOwner: 'editor' as const,
  }) satisfies Parameters<typeof createEditableKernelResult>[0]['trace']

const beginDestructiveEpoch = (editor = createEditor()) => {
  const epoch = beginEditableEditingEpoch(editor, {
    command: destructiveCommand,
    ownership: 'model-owned',
    rootEventFamily: 'keydown',
    rootIntent: 'delete-backward',
    selectionSource: 'model-owned',
    targetOwner: 'editor',
  })

  return { editor, epoch }
}

test('destructive keydown traces carry the active editing epoch id', () => {
  const { editor, epoch } = beginDestructiveEpoch()
  const result = createEditableKernelResult({
    editor,
    handled: true,
    trace: createTrace(),
  })

  expect(result.trace.epochId).toBe(epoch.id)
})

test('destructive beforeinput joins the active keydown epoch', () => {
  const { editor, epoch } = beginDestructiveEpoch()
  const joined = beginOrJoinEditableEditingEpoch(editor, {
    command: destructiveCommand,
    ownership: 'model-owned',
    rootEventFamily: 'beforeinput',
    rootIntent: 'delete-backward',
    selectionSource: 'model-owned',
    targetOwner: 'editor',
  })
  const result = createEditableKernelResult({
    editor,
    handled: true,
    trace: {
      ...createTrace(),
      eventFamily: 'beforeinput',
    },
  })

  expect(joined?.id).toBe(epoch.id)
  expect(result.trace.epochId).toBe(epoch.id)
})

test('handled destructive keydown suppresses duplicate beforeinput command', () => {
  const { editor } = beginDestructiveEpoch()

  markEditableEditingEpochCommandHandled(editor, destructiveCommand)

  expect(
    shouldSkipDuplicateEditableEditingEpochCommand(editor, destructiveCommand)
  ).toBe(true)
  expect(
    shouldSkipDuplicateEditableEditingEpochCommand(editor, {
      direction: 'forward',
      kind: 'delete',
      unit: 'word',
    })
  ).toBe(false)
})

test('non-destructive beforeinput cannot inherit a destructive epoch', () => {
  const { editor } = beginDestructiveEpoch()
  const result = createEditableKernelResult({
    editor,
    handled: true,
    trace: {
      ...createTrace(),
      command: { kind: 'insert-text', text: 'x' },
      eventFamily: 'beforeinput',
      intent: 'insert-text',
      ownership: 'model-owned',
      nativeAllowed: false,
      stateAfter: 'model-owned',
      stateBefore: 'model-owned',
    },
  })

  expect(result.trace.epochId).toBeNull()
})

test('native input cannot inherit an older destructive epoch', () => {
  const { editor } = beginDestructiveEpoch()
  const result = createEditableKernelResult({
    editor,
    handled: false,
    trace: {
      ...createTrace(),
      command: null,
      eventFamily: 'input',
      intent: 'insert-text',
      nativeAllowed: true,
      ownership: 'native-allowed',
      selectionSource: 'dom-current',
      stateAfter: 'dom-selection',
      stateBefore: 'dom-selection',
    },
  })

  expect(result.trace.epochId).toBeNull()
})

test('model-owned input can join a destructive epoch', () => {
  const { editor, epoch } = beginDestructiveEpoch()
  const result = createEditableKernelResult({
    editor,
    handled: true,
    trace: {
      ...createTrace(),
      command: null,
      eventFamily: 'input',
      intent: 'delete-backward',
    },
  })

  expect(result.trace.epochId).toBe(epoch.id)
})

test('model repair and repair-induced selectionchange stay in the same epoch and close it', () => {
  const { editor, epoch } = beginDestructiveEpoch()
  const repair = recordEditableKernelTrace({
    editor,
    trace: {
      ...createTrace(),
      command: null,
      eventFamily: 'repair',
      intent: null,
      repair: { kind: 'repair-caret' },
      selectionChangeOrigin: 'repair-induced',
      stateAfter: 'repairing',
    },
  })
  const selectionchange = recordEditableKernelTrace({
    editor,
    trace: {
      ...createTrace(),
      command: null,
      eventFamily: 'selectionchange',
      intent: null,
      repair: null,
      selectionChangeOrigin: 'repair-induced',
    },
  })

  expect(repair.epochId).toBe(epoch.id)
  expect(selectionchange.epochId).toBe(epoch.id)
  expect(getCurrentEditableEditingEpoch(editor)?.active).toBe(false)
})
