import {
  type DescendantIn,
  isObject,
  Node,
  type NodeProps,
  Path,
  Range,
  type Value,
} from '..'

export type BaseInsertNodeOperation<V extends Value = Value> = {
  type: 'insert_node'
  path: Path
  node: DescendantIn<V>
}

export type InsertNodeOperation<V extends Value = Value> =
  BaseInsertNodeOperation<V>

export type BaseInsertTextOperation = {
  type: 'insert_text'
  path: Path
  offset: number
  text: string
}

export type InsertTextOperation = BaseInsertTextOperation

export type BaseMergeNodeOperation<V extends Value = Value> = {
  type: 'merge_node'
  path: Path
  position: number
  properties: Partial<NodeProps<DescendantIn<V>>>
}

export type MergeNodeOperation<V extends Value = Value> =
  BaseMergeNodeOperation<V>

export type BaseMoveNodeOperation = {
  type: 'move_node'
  path: Path
  newPath: Path
}

export type MoveNodeOperation = BaseMoveNodeOperation

export type BaseRemoveNodeOperation<V extends Value = Value> = {
  type: 'remove_node'
  path: Path
  node: DescendantIn<V>
}

export type RemoveNodeOperation<V extends Value = Value> =
  BaseRemoveNodeOperation<V>

export type BaseRemoveTextOperation = {
  type: 'remove_text'
  path: Path
  offset: number
  text: string
}

export type RemoveTextOperation = BaseRemoveTextOperation

export type BaseSetNodeOperation<V extends Value = Value> = {
  type: 'set_node'
  path: Path
  properties: Partial<NodeProps<DescendantIn<V>>>
  newProperties: Partial<NodeProps<DescendantIn<V>>>
}

export type SetNodeOperation<V extends Value = Value> = BaseSetNodeOperation<V>

export type BaseSetSelectionOperation =
  | {
      type: 'set_selection'
      properties: null
      newProperties: Range
    }
  | {
      type: 'set_selection'
      properties: Partial<Range>
      newProperties: Partial<Range>
    }
  | {
      type: 'set_selection'
      properties: Range
      newProperties: null
    }

export type SetSelectionOperation = BaseSetSelectionOperation

export type BaseSplitNodeOperation<V extends Value = Value> = {
  type: 'split_node'
  path: Path
  position: number
  properties: Partial<NodeProps<DescendantIn<V>>>
}

export type SplitNodeOperation<V extends Value = Value> =
  BaseSplitNodeOperation<V>

export type BaseReplaceFragmentOperation<V extends Value = Value> = {
  type: 'replace_fragment'
  path: Path
  children: DescendantIn<V>[]
  newChildren: DescendantIn<V>[]
  selection: Range | null
  newSelection: Range | null
}

export type ReplaceFragmentOperation<V extends Value = Value> =
  BaseReplaceFragmentOperation<V>

export type BaseReplaceChildrenOperation<V extends Value = Value> = {
  type: 'replace_children'
  path: Path
  index: number
  children: DescendantIn<V>[]
  newChildren: DescendantIn<V>[]
  selection: Range | null
  newSelection: Range | null
}

export type ReplaceChildrenOperation<V extends Value = Value> =
  BaseReplaceChildrenOperation<V>

export type NodeOperation<V extends Value = Value> =
  | InsertNodeOperation<V>
  | MergeNodeOperation<V>
  | MoveNodeOperation
  | RemoveNodeOperation<V>
  | SetNodeOperation<V>
  | SplitNodeOperation<V>

export type SelectionOperation = SetSelectionOperation

export type TextOperation = InsertTextOperation | RemoveTextOperation

/**
 * `Operation` objects define the low-level instructions that Slate editors use
 * to apply changes to their internal state. Representing all changes as
 * operations is what allows Slate editors to easily implement history,
 * collaboration, and other features.
 */

export type BaseOperation<V extends Value = Value> =
  | NodeOperation<V>
  | ReplaceChildrenOperation<V>
  | ReplaceFragmentOperation<V>
  | SelectionOperation
  | TextOperation
export type Operation<V extends Value = Value> = BaseOperation<V>

export interface OperationInterface {
  /**
   * Check if a value is an `InsertNodeOperation` object.
   */
  isInsertNodeOperation: <V extends Value = Value>(
    value: any
  ) => value is InsertNodeOperation<V>

  /**
   * Check if a value is an `InsertTextOperation` object.
   */
  isInsertTextOperation: (value: any) => value is InsertTextOperation

  /**
   * Check if a value is a `MergeNodeOperation` object.
   */
  isMergeNodeOperation: <V extends Value = Value>(
    value: any
  ) => value is MergeNodeOperation<V>

  /**
   * Check if a value is a `MoveNodeOperation` object.
   */
  isMoveNodeOperation: (value: any) => value is MoveNodeOperation

  /**
   * Check if a value is a `NodeOperation` object.
   */
  isNodeOperation: <V extends Value = Value>(
    value: any
  ) => value is NodeOperation<V>

  /**
   * Check if a value is an `Operation` object.
   */
  isOperation: <V extends Value = Value>(value: any) => value is Operation<V>

  /**
   * Check if a value is a list of `Operation` objects.
   */
  isOperationList: <V extends Value = Value>(
    value: any
  ) => value is Operation<V>[]

  /**
   * Check if a value is a `RemoveNodeOperation` object.
   */
  isRemoveNodeOperation: <V extends Value = Value>(
    value: any
  ) => value is RemoveNodeOperation<V>

  /**
   * Check if a value is a `RemoveTextOperation` object.
   */
  isRemoveTextOperation: (value: any) => value is RemoveTextOperation

  /**
   * Check if a value is a `ReplaceChildrenOperation` object.
   */
  isReplaceChildrenOperation: <V extends Value = Value>(
    value: any
  ) => value is ReplaceChildrenOperation<V>

  /**
   * Check if a value is a `ReplaceFragmentOperation` object.
   */
  isReplaceFragmentOperation: <V extends Value = Value>(
    value: any
  ) => value is ReplaceFragmentOperation<V>

  /**
   * Check if a value is a `SelectionOperation` object.
   */
  isSelectionOperation: (value: any) => value is SelectionOperation

  /**
   * Check if a value is a `SetNodeOperation` object.
   */
  isSetNodeOperation: <V extends Value = Value>(
    value: any
  ) => value is SetNodeOperation<V>

  /**
   * Check if a value is a `SetSelectionOperation` object.
   */
  isSetSelectionOperation: (value: any) => value is SetSelectionOperation

  /**
   * Check if a value is a `SplitNodeOperation` object.
   */
  isSplitNodeOperation: <V extends Value = Value>(
    value: any
  ) => value is SplitNodeOperation<V>

  /**
   * Check if a value is a `TextOperation` object.
   */
  isTextOperation: (value: any) => value is TextOperation

  /**
   * Invert an operation, returning a new operation that will exactly undo the
   * original when applied.
   */
  inverse: <V extends Value = Value>(op: Operation<V>) => Operation<V>
}

const isOperationType = <V extends Value, TType extends Operation<V>['type']>(
  value: any,
  type: TType
): value is Extract<Operation<V>, { type: TType }> =>
  Operation.isOperation<V>(value) && value.type === type

// eslint-disable-next-line no-redeclare
export const Operation: OperationInterface = {
  isInsertNodeOperation<V extends Value = Value>(
    value: any
  ): value is InsertNodeOperation<V> {
    return isOperationType<V, 'insert_node'>(value, 'insert_node')
  },

  isInsertTextOperation(value: any): value is InsertTextOperation {
    return isOperationType<Value, 'insert_text'>(value, 'insert_text')
  },

  isMergeNodeOperation<V extends Value = Value>(
    value: any
  ): value is MergeNodeOperation<V> {
    return isOperationType<V, 'merge_node'>(value, 'merge_node')
  },

  isMoveNodeOperation(value: any): value is MoveNodeOperation {
    return isOperationType<Value, 'move_node'>(value, 'move_node')
  },

  isNodeOperation<V extends Value = Value>(
    value: any
  ): value is NodeOperation<V> {
    return Operation.isOperation(value) && value.type.endsWith('_node')
  },

  isOperation<V extends Value = Value>(value: any): value is Operation<V> {
    if (!isObject(value)) {
      return false
    }

    switch (value.type) {
      case 'insert_node':
        return Path.isPath(value.path) && Node.isNode(value.node)
      case 'insert_text':
        return (
          typeof value.offset === 'number' &&
          typeof value.text === 'string' &&
          Path.isPath(value.path)
        )
      case 'merge_node':
        return (
          typeof value.position === 'number' &&
          Path.isPath(value.path) &&
          isObject(value.properties)
        )
      case 'move_node':
        return Path.isPath(value.path) && Path.isPath(value.newPath)
      case 'remove_node':
        return Path.isPath(value.path) && Node.isNode(value.node)
      case 'remove_text':
        return (
          typeof value.offset === 'number' &&
          typeof value.text === 'string' &&
          Path.isPath(value.path)
        )
      case 'replace_fragment':
        return (
          Path.isPath(value.path) &&
          Node.isNodeList(value.children) &&
          Node.isNodeList(value.newChildren) &&
          (value.selection === null || Range.isRange(value.selection)) &&
          (value.newSelection === null || Range.isRange(value.newSelection))
        )
      case 'replace_children':
        return (
          Path.isPath(value.path) &&
          Number.isInteger(value.index) &&
          value.index >= 0 &&
          Node.isNodeList(value.children) &&
          Node.isNodeList(value.newChildren) &&
          (value.selection === null || Range.isRange(value.selection)) &&
          (value.newSelection === null || Range.isRange(value.newSelection))
        )
      case 'set_node':
        return (
          Path.isPath(value.path) &&
          isObject(value.properties) &&
          isObject(value.newProperties)
        )
      case 'set_selection':
        return (
          (value.properties === null && Range.isRange(value.newProperties)) ||
          (value.newProperties === null && Range.isRange(value.properties)) ||
          (isObject(value.properties) && isObject(value.newProperties))
        )
      case 'split_node':
        return (
          Path.isPath(value.path) &&
          typeof value.position === 'number' &&
          isObject(value.properties)
        )
      default:
        return false
    }
  },

  isOperationList<V extends Value = Value>(
    value: any
  ): value is Operation<V>[] {
    return (
      Array.isArray(value) && value.every((val) => Operation.isOperation(val))
    )
  },

  isRemoveNodeOperation<V extends Value = Value>(
    value: any
  ): value is RemoveNodeOperation<V> {
    return isOperationType<V, 'remove_node'>(value, 'remove_node')
  },

  isRemoveTextOperation(value: any): value is RemoveTextOperation {
    return isOperationType<Value, 'remove_text'>(value, 'remove_text')
  },

  isReplaceChildrenOperation<V extends Value = Value>(
    value: any
  ): value is ReplaceChildrenOperation<V> {
    return isOperationType<V, 'replace_children'>(value, 'replace_children')
  },

  isReplaceFragmentOperation<V extends Value = Value>(
    value: any
  ): value is ReplaceFragmentOperation<V> {
    return isOperationType<V, 'replace_fragment'>(value, 'replace_fragment')
  },

  isSelectionOperation(value: any): value is SelectionOperation {
    return Operation.isOperation(value) && value.type.endsWith('_selection')
  },

  isSetNodeOperation<V extends Value = Value>(
    value: any
  ): value is SetNodeOperation<V> {
    return isOperationType<V, 'set_node'>(value, 'set_node')
  },

  isSetSelectionOperation(value: any): value is SetSelectionOperation {
    return isOperationType<Value, 'set_selection'>(value, 'set_selection')
  },

  isSplitNodeOperation<V extends Value = Value>(
    value: any
  ): value is SplitNodeOperation<V> {
    return isOperationType<V, 'split_node'>(value, 'split_node')
  },

  isTextOperation(value: any): value is TextOperation {
    return Operation.isOperation(value) && value.type.endsWith('_text')
  },

  inverse<V extends Value = Value>(op: Operation<V>): Operation<V> {
    switch (op.type) {
      case 'insert_node': {
        return { ...op, type: 'remove_node' }
      }

      case 'insert_text': {
        return { ...op, type: 'remove_text' }
      }

      case 'merge_node': {
        return { ...op, type: 'split_node', path: Path.previous(op.path) }
      }

      case 'move_node': {
        const { newPath, path } = op

        // PERF: in this case the move operation is a no-op anyways.
        if (Path.equals(newPath, path)) {
          return op
        }

        // If the move happens completely within a single parent the path and
        // newPath are stable with respect to each other.
        if (Path.isSibling(path, newPath)) {
          return { ...op, path: newPath, newPath: path }
        }

        // If the move does not happen within a single parent it is possible
        // for the move to impact the true path to the location where the node
        // was removed from and where it was inserted. We have to adjust for this
        // and find the original path. We can accomplish this (only in non-sibling)
        // moves by looking at the impact of the move operation on the node
        // after the original move path.
        const inversePath = Path.transform(path, op)!
        const inverseNewPath = Path.transform(Path.next(path), op)!
        return { ...op, path: inversePath, newPath: inverseNewPath }
      }

      case 'remove_node': {
        return { ...op, type: 'insert_node' }
      }

      case 'remove_text': {
        return { ...op, type: 'insert_text' }
      }

      case 'replace_fragment': {
        const { children, newChildren, newSelection, selection } = op

        return {
          ...op,
          children: newChildren,
          newChildren: children,
          selection: newSelection,
          newSelection: selection,
        }
      }

      case 'replace_children': {
        const { children, newChildren, newSelection, selection } = op

        return {
          ...op,
          children: newChildren,
          newChildren: children,
          selection: newSelection,
          newSelection: selection,
        }
      }

      case 'set_node': {
        const { properties, newProperties } = op
        return { ...op, properties: newProperties, newProperties: properties }
      }

      case 'set_selection': {
        const { properties, newProperties } = op

        if (properties == null) {
          return {
            ...op,
            properties: newProperties as Range,
            newProperties: null,
          }
        }
        if (newProperties == null) {
          return {
            ...op,
            properties: null,
            newProperties: properties as Range,
          }
        }
        return { ...op, properties: newProperties, newProperties: properties }
      }

      case 'split_node': {
        return { ...op, type: 'merge_node', path: Path.next(op.path) }
      }

      default:
        throw new Error(
          `Cannot invert unknown operation: ${JSON.stringify(op)}`
        )
    }
  },
}
