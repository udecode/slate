import { transformBookmarks } from '../editor/bookmark'
import { allRangeRefs, publishRangeRefDrafts } from '../editor/range-ref'
import { Editor } from '../interfaces/editor'
import type { Operation } from '../interfaces/operation'
import { type Path, PathApi } from '../interfaces/path'
import { PathRefApi } from '../interfaces/path-ref'
import { PointRefApi } from '../interfaces/point-ref'
import { RangeRefApi } from '../interfaces/range-ref'
import { transform } from '../interfaces/transforms/general'
import { isBatchingDirtyPaths } from './batch-dirty-paths'
import {
  appendOperation,
  assertCanStartEditorWrite,
  buildSnapshotChange,
  canUseTextFastPath,
  getCommandContext,
  getCurrentMarks,
  getCurrentSelection,
  getOperationDirtiness,
  getSnapshot,
  getSnapshotVersion,
  hasListeners,
  incrementVersion,
  isInTransaction,
  markTransactionChanged,
  notifyListeners,
  runEditorTransaction,
  setCurrentMarks,
  transformImplicitTarget,
} from './public-state'
import { updateDirtyPaths } from './update-dirty-paths'

export const apply = (editor: Editor, op: Operation) => {
  if (!isInTransaction(editor)) {
    assertCanStartEditorWrite(editor)
  }

  if (
    !isInTransaction(editor) &&
    (op.type === 'insert_text' || op.type === 'remove_text') &&
    canUseTextFastPath(editor)
  ) {
    const previousVersion = getSnapshotVersion(editor)
    const previousSnapshot = hasListeners(editor) ? getSnapshot(editor) : null
    const previousSelection =
      previousSnapshot?.selection ?? getCurrentSelection(editor)
    const previousMarks = previousSnapshot?.marks ?? getCurrentMarks(editor)

    for (const ref of Editor.pointRefs(editor)) {
      PointRefApi.transform(ref, op)
    }

    for (const ref of allRangeRefs(editor)) {
      RangeRefApi.transform(ref, op)
    }

    transformBookmarks(editor, op)
    transformImplicitTarget(editor, op)

    transform(editor, op)
    appendOperation(editor, op)
    publishRangeRefDrafts(editor)
    incrementVersion(editor)

    notifyListeners(
      editor,
      previousSnapshot
        ? buildSnapshotChange({
            command: getCommandContext(editor),
            nextSnapshot: getSnapshot(editor),
            operations: [op],
            previousSnapshot,
            reason: null,
          })
        : getOperationDirtiness(editor, [op], {
            command: getCommandContext(editor),
            previousVersion,
            marksBefore: previousMarks,
            selectionBefore: previousSelection,
          })
    )

    return
  }

  if (
    !isInTransaction(editor) &&
    op.type === 'set_selection' &&
    !hasListeners(editor)
  ) {
    const previousVersion = getSnapshotVersion(editor)
    const previousSelection = getCurrentSelection(editor)
    const previousMarks = getCurrentMarks(editor)
    transform(editor, op)
    appendOperation(editor, op)
    incrementVersion(editor)
    setCurrentMarks(editor, null)
    notifyListeners(
      editor,
      getOperationDirtiness(editor, [op], {
        previousVersion,
        marksBefore: previousMarks,
        selectionBefore: previousSelection,
      })
    )
    return
  }

  if (!isInTransaction(editor)) {
    runEditorTransaction(editor, () => {
      apply(editor, op)
    })
    return
  }

  for (const ref of Editor.pathRefs(editor)) {
    PathRefApi.transform(ref, op)
  }

  for (const ref of Editor.pointRefs(editor)) {
    PointRefApi.transform(ref, op)
  }

  for (const ref of allRangeRefs(editor)) {
    RangeRefApi.transform(ref, op)
  }

  transformBookmarks(editor, op)
  transformImplicitTarget(editor, op)

  // update dirty paths
  if (!isBatchingDirtyPaths(editor)) {
    const transform = PathApi.operationCanTransformPath(op)
      ? (p: Path) => PathApi.transform(p, op)
      : undefined
    updateDirtyPaths(editor, Editor.getDirtyPaths(editor, op), transform)
  }

  transform(editor, op)
  appendOperation(editor, op)

  // Clear any formats applied to the cursor if the selection changes.
  if (op.type === 'set_selection' && !isInTransaction(editor)) {
    setCurrentMarks(editor, null)
  }

  markTransactionChanged(editor)
}
