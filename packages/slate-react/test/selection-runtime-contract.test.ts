import type { Operation, Range, SnapshotChange } from 'slate'
import {
  createEditableInputController,
  createEditableInputControllerState,
} from '../src/editable/input-controller'
import {
  isTextInputSelectionHandledByCaretRepair,
  shouldExportModelSelectionToDOM,
  shouldSyncModelSelectionAfterCommit,
  subscribeSelectionOnlyDOMExport,
} from '../src/editable/selection-runtime'

describe('selection runtime', () => {
  const createChange = (
    change: Pick<SnapshotChange, 'childrenChanged' | 'selectionChanged'> &
      Partial<
        Pick<
          SnapshotChange,
          | 'command'
          | 'fullDocumentChanged'
          | 'rootRuntimeIdsChanged'
          | 'structureChanged'
          | 'topLevelOrderChanged'
        >
      >
  ) => change as SnapshotChange

  const createInputController = () =>
    createEditableInputController({
      preferModelSelectionForInputRef: { current: false },
      state: createEditableInputControllerState(),
    })
  const expandedSelection: Range = {
    anchor: { offset: 0, path: [0, 0] },
    focus: { offset: 1, path: [0, 0] },
  }
  const collapsedSelection: Range = {
    anchor: { offset: 0, path: [0, 0] },
    focus: { offset: 0, path: [0, 0] },
  }

  test('exports model-owned selection but skips DOM-owned selection', () => {
    const inputController = createInputController()

    expect(shouldExportModelSelectionToDOM(inputController)).toBe(true)

    inputController.state.selectionSource = 'dom-current'
    expect(shouldExportModelSelectionToDOM(inputController)).toBe(false)

    inputController.state.selectionSource = 'model-owned'
    inputController.state.selectionChangeOrigin = 'native-user'
    expect(shouldExportModelSelectionToDOM(inputController)).toBe(false)
  })

  test('exports expanded model selection after content-changing commits', () => {
    const inputController = createInputController()
    inputController.state.selectionSource = 'dom-current'
    inputController.state.selectionChangeOrigin = 'native-user'

    expect(
      shouldExportModelSelectionToDOM(inputController, {
        commit: createChange({
          childrenChanged: true,
          selectionChanged: false,
        }),
        modelSelection: expandedSelection,
      })
    ).toBe(false)
    expect(
      shouldExportModelSelectionToDOM(inputController, {
        commit: createChange({
          childrenChanged: true,
          command: { origin: 'command', type: 'toggle_mark' },
          selectionChanged: false,
        }),
        modelSelection: expandedSelection,
      })
    ).toBe(true)
    expect(
      shouldExportModelSelectionToDOM(inputController, {
        commit: createChange({
          childrenChanged: true,
          command: { origin: 'command', type: 'toggle_mark' },
          selectionChanged: false,
        }),
        modelSelection: collapsedSelection,
      })
    ).toBe(false)
  })

  test('subscribes to model selection and structural changes only', () => {
    expect(
      shouldSyncModelSelectionAfterCommit(
        undefined,
        createChange({
          childrenChanged: false,
          selectionChanged: true,
        })
      )
    ).toBe(true)
    expect(
      shouldSyncModelSelectionAfterCommit(
        undefined,
        createChange({
          childrenChanged: true,
          selectionChanged: true,
        })
      )
    ).toBe(true)
    expect(
      shouldSyncModelSelectionAfterCommit(
        undefined,
        createChange({
          childrenChanged: true,
          selectionChanged: false,
        })
      )
    ).toBe(false)
    expect(
      shouldSyncModelSelectionAfterCommit(
        undefined,
        createChange({
          childrenChanged: true,
          selectionChanged: false,
          structureChanged: true,
        })
      )
    ).toBe(true)
  })

  test('skips DOM export when text input caret repair owns collapsed selection', () => {
    const inputController = createInputController()
    inputController.state.activeIntent = 'text-insert'
    inputController.state.selectionSource = 'model-owned'

    const textCommit = createChange({
      childrenChanged: true,
      selectionChanged: true,
    })

    expect(
      isTextInputSelectionHandledByCaretRepair(inputController, textCommit)
    ).toBe(true)
    expect(
      shouldSyncModelSelectionAfterCommit(
        undefined,
        textCommit,
        inputController
      )
    ).toBe(false)

    expect(
      shouldSyncModelSelectionAfterCommit(
        undefined,
        createChange({
          childrenChanged: true,
          selectionChanged: true,
          structureChanged: true,
        }),
        inputController
      )
    ).toBe(true)
  })

  test('composition text input still exports model selection normally', () => {
    const inputController = createInputController()
    inputController.state.activeIntent = 'text-insert'
    inputController.state.isComposing = true

    expect(
      shouldSyncModelSelectionAfterCommit(
        undefined,
        createChange({
          childrenChanged: true,
          selectionChanged: true,
        }),
        inputController
      )
    ).toBe(true)
  })

  test('wires selector listener to DOM export policy', () => {
    const inputController = createInputController()
    let listener: (() => void) | null = null
    let cleanupCalls = 0
    let syncCalls = 0

    const unsubscribe = subscribeSelectionOnlyDOMExport({
      addSelectorEventListener(nextListener) {
        listener = nextListener
        return () => {
          cleanupCalls += 1
        }
      },
      inputController,
      scheduleDOMExport(callback) {
        callback()
      },
      syncDOMSelectionToEditor() {
        syncCalls += 1
      },
    })

    listener?.()
    expect(syncCalls).toBe(1)

    inputController.state.selectionSource = 'dom-current'
    listener?.()
    expect(syncCalls).toBe(1)

    unsubscribe()
    expect(cleanupCalls).toBe(1)
  })

  test('defers DOM export for content-changing commits', () => {
    const inputController = createInputController()
    inputController.state.selectionSource = 'dom-current'
    inputController.state.selectionChangeOrigin = 'native-user'
    let listener:
      | ((operations?: readonly Operation[], change?: SnapshotChange) => void)
      | null = null
    let scheduled: (() => void) | null = null
    let syncCalls = 0

    subscribeSelectionOnlyDOMExport({
      addSelectorEventListener(nextListener) {
        listener = nextListener
        return () => {}
      },
      getModelSelection: () => expandedSelection,
      inputController,
      scheduleDOMExport(callback) {
        scheduled = callback
      },
      syncDOMSelectionToEditor() {
        syncCalls += 1
      },
    })

    listener?.(
      undefined,
      createChange({
        childrenChanged: true,
        command: { origin: 'command', type: 'toggle_mark' },
        selectionChanged: false,
      })
    )
    expect(syncCalls).toBe(0)

    scheduled?.()
    expect(syncCalls).toBe(1)
  })

  test('does not notify DOM export listener for repaired text input commits', () => {
    const inputController = createInputController()
    inputController.state.activeIntent = 'text-insert'
    inputController.state.selectionSource = 'model-owned'
    let listener:
      | ((operations?: readonly Operation[], change?: SnapshotChange) => void)
      | null = null
    let syncCalls = 0

    subscribeSelectionOnlyDOMExport({
      addSelectorEventListener(nextListener, options) {
        listener = (operations, change) => {
          if (options?.shouldUpdate?.(operations, change) ?? true) {
            nextListener(operations, change)
          }
        }

        return () => {}
      },
      inputController,
      scheduleDOMExport(callback) {
        callback()
      },
      syncDOMSelectionToEditor() {
        syncCalls += 1
      },
    })

    listener?.(
      undefined,
      createChange({
        childrenChanged: true,
        selectionChanged: true,
      })
    )

    expect(syncCalls).toBe(0)
  })

  test('does not notify DOM export listener for synced text-only selection commits', () => {
    const inputController = createInputController()
    inputController.state.selectionSource = 'model-owned'
    let listener:
      | ((operations?: readonly Operation[], change?: SnapshotChange) => void)
      | null = null
    let syncCalls = 0

    subscribeSelectionOnlyDOMExport({
      addSelectorEventListener(nextListener, options) {
        listener = (operations, change) => {
          if (options?.shouldUpdate?.(operations, change) ?? true) {
            nextListener(operations, change)
          }
        }

        return () => {}
      },
      inputController,
      scheduleDOMExport(callback) {
        callback()
      },
      syncDOMSelectionToEditor() {
        syncCalls += 1
      },
    })

    listener?.(
      [
        { offset: 0, path: [0, 0], text: 'x', type: 'insert_text' },
        {
          newProperties: collapsedSelection,
          properties: null,
          type: 'set_selection',
        },
      ] as readonly Operation[],
      createChange({
        childrenChanged: true,
        selectionChanged: true,
      })
    )

    expect(syncCalls).toBe(0)
  })

  test('composition still exports synced text-only selection commits', () => {
    const inputController = createInputController()
    inputController.state.isComposing = true

    expect(
      shouldSyncModelSelectionAfterCommit(
        [{ offset: 0, path: [0, 0], text: 'x', type: 'insert_text' }] as any,
        createChange({
          childrenChanged: true,
          selectionChanged: true,
        }),
        inputController
      )
    ).toBe(true)
  })

  test('skips DOM export for selections owned by a synthetic shell lane', () => {
    const inputController = createInputController()
    inputController.state.selectionSource = 'model-owned'
    let listener:
      | ((operations?: readonly Operation[], change?: SnapshotChange) => void)
      | null = null
    let syncCalls = 0

    subscribeSelectionOnlyDOMExport({
      addSelectorEventListener(nextListener, options) {
        listener = (operations, change) => {
          if (options?.shouldUpdate?.(operations, change) ?? true) {
            nextListener(operations, change)
          }
        }

        return () => {}
      },
      getModelSelection: () => expandedSelection,
      inputController,
      shouldSkipDOMExport: (selection) => selection === expandedSelection,
      syncDOMSelectionToEditor() {
        syncCalls += 1
      },
    })

    listener?.(
      undefined,
      createChange({
        childrenChanged: false,
        selectionChanged: true,
      })
    )

    expect(syncCalls).toBe(0)
  })
})
