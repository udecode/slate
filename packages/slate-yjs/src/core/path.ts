import type { Path } from 'slate'

export const nextPath = (path: Path): Path => {
  const index = path.at(-1)

  if (index === undefined) {
    throw new Error('Cannot get a next path for the root.')
  }

  return [...path.slice(0, -1), index + 1]
}

export const pathsEqual = (
  left: readonly number[],
  right: readonly number[]
): boolean =>
  left.length === right.length &&
  left.every((part, index) => part === right[index])
