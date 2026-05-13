import {
  isObject,
  type Operation,
  OperationApi,
  type Range,
  type Value,
} from 'slate'

export interface Batch<V extends Value = Value> {
  operations: Operation<V>[]
  selectionBefore: Range | null
}

/**
 * `History` objects hold all of the operations that are applied to a value, so
 * they can be undone or redone as necessary.
 */

export interface History<V extends Value = Value> {
  redos: Batch<V>[]
  undos: Batch<V>[]
}

// eslint-disable-next-line no-redeclare
export const History = {
  /**
   * Check if a value is a `History` object.
   */

  isHistory(value: any): value is History {
    return (
      isObject(value) &&
      Array.isArray(value.redos) &&
      Array.isArray(value.undos) &&
      (value.redos.length === 0 ||
        OperationApi.isOperationList(value.redos[0].operations)) &&
      (value.undos.length === 0 ||
        OperationApi.isOperationList(value.undos[0].operations))
    )
  },
}
