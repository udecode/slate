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
  | SelectionOperation
  | TextOperation
export type Operation<V extends Value = Value> = BaseOperation<V>

export interface OperationInterface {
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
   * Check if a value is a `SelectionOperation` object.
   */
  isSelectionOperation: (value: any) => value is SelectionOperation

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

// eslint-disable-next-line no-redeclare
export const Operation: OperationInterface = {
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

  isSelectionOperation(value: any): value is SelectionOperation {
    return Operation.isOperation(value) && value.type.endsWith('_selection')
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
