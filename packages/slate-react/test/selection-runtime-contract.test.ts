import type { Operation, Range, SnapshotChange } from 'slate'
import {
  createEditableInputController,
  createEditableInputControllerState,
} from '../src/editable/input-controller'
import {
  shouldExportModelSelectionToDOM,
  shouldSyncModelSelectionAfterCommit,
  subscribeSelectionOnlyDOMExport,
} from '../src/editable/selection-runtime'

describe('selection runtime', () => {
  const createChange = (
    change: Pick<SnapshotChange, 'childrenChanged' | 'selectionChanged'> &
      Partial<Pick<SnapshotChange, 'command'>>
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

  test('subscribes to model selection changes even when content changes', () => {
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
})
