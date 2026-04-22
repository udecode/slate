import { transformBookmarks } from '../editor/bookmark'
import { allRangeRefs, publishRangeRefDrafts } from '../editor/range-ref'
import { Editor } from '../interfaces/editor'
import { Path } from '../interfaces/path'
import { PathRef } from '../interfaces/path-ref'
import { PointRef } from '../interfaces/point-ref'
import { RangeRef } from '../interfaces/range-ref'
import { Transforms } from '../interfaces/transforms'
import type { WithEditorFirstArg } from '../utils/types'
import { isBatchingDirtyPaths } from './batch-dirty-paths'
import {
  buildSnapshotChange,
  canUseTextFastPath,
  getSnapshot,
  hasListeners,
  incrementVersion,
  isInTransaction,
  markTransactionChanged,
  notifyListeners,
  setCurrentMarks,
  withTransaction,
} from './public-state'
import { updateDirtyPaths } from './update-dirty-paths'

export const apply: WithEditorFirstArg<Editor['apply']> = (editor, op) => {
  if (
    !isInTransaction(editor) &&
    (op.type === 'insert_text' || op.type === 'remove_text') &&
    canUseTextFastPath(editor)
  ) {
    const previousSnapshot = hasListeners(editor) ? getSnapshot(editor) : null

    for (const ref of Editor.pointRefs(editor)) {
      PointRef.transform(ref, op)
    }

    for (const ref of allRangeRefs(editor)) {
      RangeRef.transform(ref, op)
    }

    transformBookmarks(editor, op)

    if (!isBatchingDirtyPaths(editor)) {
      updateDirtyPaths(editor, editor.getDirtyPaths(op))
    }

    Transforms.transform(editor, op)
    editor.operations.push(op)
    publishRangeRefDrafts(editor)
    incrementVersion(editor)

    notifyListeners(
      editor,
      previousSnapshot
        ? buildSnapshotChange({
            nextSnapshot: getSnapshot(editor),
            operations: [op],
            previousSnapshot,
            reason: null,
          })
        : undefined
    )

    return
  }

  if (!isInTransaction(editor)) {
    withTransaction(editor, () => {
      apply(editor, op)
    })
    return
  }

  for (const ref of Editor.pathRefs(editor)) {
    PathRef.transform(ref, op)
  }

  for (const ref of Editor.pointRefs(editor)) {
    PointRef.transform(ref, op)
  }

  for (const ref of allRangeRefs(editor)) {
    RangeRef.transform(ref, op)
  }

  transformBookmarks(editor, op)

  // update dirty paths
  if (!isBatchingDirtyPaths(editor)) {
    const transform = Path.operationCanTransformPath(op)
      ? (p: Path) => Path.transform(p, op)
      : undefined
    updateDirtyPaths(editor, editor.getDirtyPaths(op), transform)
  }

  Transforms.transform(editor, op)
  editor.operations.push(op)

  // Clear any formats applied to the cursor if the selection changes.
  if (op.type === 'set_selection' && !isInTransaction(editor)) {
    setCurrentMarks(editor, null)
  }

  markTransactionChanged(editor)
}
