import { getCurrentSelection } from '../core/public-state'
import { Editor, type EditorPositionsOptions } from '../interfaces/editor'
import { Node } from '../interfaces/node'
import { Path } from '../interfaces/path'
import type { Point } from '../interfaces/point'
import { Range } from '../interfaces/range'
import { projectRangeInSnapshot } from '../range-projection'
import { getCharacterDistance, getWordDistance } from '../utils/string'

type PositionSegment = {
  path: Path
  start: number
  end: number
  text: string
}

const comparePoints = (left: Point, right: Point) => {
  const pathComparison = Path.compare(left.path, right.path)

  if (pathComparison !== 0) {
    return pathComparison
  }

  if (left.offset === right.offset) {
    return 0
  }

  return left.offset < right.offset ? -1 : 1
}

const isPathInsideVoid = (editor: Editor, path: Path) => {
  for (let depth = path.length - 1; depth > 0; depth -= 1) {
    const [ancestor] = Editor.node(editor, path.slice(0, depth))

    if (Node.isElement(ancestor) && editor.isVoid(ancestor)) {
      return true
    }
  }

  return false
}

const getPositionSegments = (editor: Editor, range: Range): PositionSegment[] =>
  projectRangeInSnapshot(Editor.getSnapshot(editor), range).map((segment) => ({
    path: segment.path,
    start: segment.start,
    end: segment.end,
    text: Editor.string(editor, segment.path).slice(segment.start, segment.end),
  }))

const mapLogicalOffsetToPoint = (
  segments: PositionSegment[],
  logicalOffset: number,
  boundary: 'backward' | 'forward' = 'backward'
): Point => {
  let consumed = 0

  for (const segment of segments) {
    const length = segment.text.length
    const end = consumed + length

    if (logicalOffset < end) {
      return {
        path: segment.path,
        offset: segment.start + (logicalOffset - consumed),
      }
    }

    if (logicalOffset === end) {
      if (segment === segments.at(-1) || boundary === 'backward') {
        return {
          path: segment.path,
          offset: segment.end,
        }
      }

      const next = segments[segments.indexOf(segment) + 1]!

      return {
        path: next.path,
        offset: next.start,
      }
    }

    consumed = end
  }

  const last = segments.at(-1)

  if (!last) {
    throw new Error('Cannot map a logical offset without text segments')
  }

  return {
    path: last.path,
    offset: last.end,
  }
}

const groupPositionSegmentsByBlock = (segments: PositionSegment[]) => {
  const groups: PositionSegment[][] = []

  for (const segment of segments) {
    const blockIndex = segment.path[0]
    const lastGroup = groups.at(-1)

    if (!lastGroup || lastGroup[0]?.path[0] !== blockIndex) {
      groups.push([segment])
      continue
    }

    lastGroup.push(segment)
  }

  return groups
}

const collectBlockBoundaryPoints = (
  segments: PositionSegment[],
  reverse = false
): Point[] => {
  const points: Point[] = []
  const groups = new Map<number, PositionSegment[]>()

  segments.forEach((segment) => {
    const blockIndex = segment.path[0] ?? 0
    const group = groups.get(blockIndex) ?? []
    group.push(segment)
    groups.set(blockIndex, group)
  })

  const ordered = Array.from(groups.entries()).sort((left, right) =>
    reverse ? right[0] - left[0] : left[0] - right[0]
  )

  ordered.forEach(([, group]) => {
    const first = group[0]
    const last = group.at(-1)

    if (!first || !last) {
      return
    }

    const blockPoints = reverse
      ? [
          { path: last.path, offset: last.end },
          { path: first.path, offset: first.start },
        ]
      : [
          { path: first.path, offset: first.start },
          { path: last.path, offset: last.end },
        ]

    blockPoints.forEach((point) => {
      const previous = points.at(-1)

      if (!previous || comparePoints(previous, point) !== 0) {
        points.push(point)
      }
    })
  })

  return points
}

export function* positions(
  editor: Editor,
  options: EditorPositionsOptions = {}
): Generator<Point, void, undefined> {
  const {
    at = getCurrentSelection(editor) ?? [],
    unit = 'offset',
    reverse = false,
    voids = false,
  } = options

  const range = Editor.range(editor, at)
  const [start, end] = Range.edges(range)

  if (comparePoints(start, end) === 0) {
    yield { path: [...start.path], offset: start.offset }
    return
  }

  const segments = getPositionSegments(editor, range)
    .filter((segment) => segment.end >= segment.start)
    .filter((segment) => voids || !isPathInsideVoid(editor, segment.path))

  if (segments.length === 0) {
    return
  }

  if (unit === 'block' || unit === 'line') {
    yield* collectBlockBoundaryPoints(segments, reverse)
    return
  }

  if (unit === 'offset') {
    const orderedSegments = reverse ? [...segments].reverse() : segments

    for (const segment of orderedSegments) {
      if (reverse) {
        for (let offset = segment.end; offset >= segment.start; offset -= 1) {
          yield { path: segment.path, offset }
        }
      } else {
        for (let offset = segment.start; offset <= segment.end; offset += 1) {
          yield { path: segment.path, offset }
        }
      }
    }

    return
  }

  const orderedGroups = reverse
    ? groupPositionSegmentsByBlock(segments).reverse()
    : groupPositionSegmentsByBlock(segments)

  for (const group of orderedGroups) {
    const text = group.map((segment) => segment.text).join('')
    const logicalPositions = [reverse ? text.length : 0]
    let consumed = 0

    while (consumed < text.length) {
      const remaining = reverse
        ? text.slice(0, text.length - consumed)
        : text.slice(consumed)
      const distance =
        unit === 'character'
          ? getCharacterDistance(remaining, reverse)
          : getWordDistance(remaining, reverse)

      consumed = Math.min(text.length, consumed + distance)
      logicalPositions.push(reverse ? text.length - consumed : consumed)
    }

    const boundary = reverse ? 'forward' : 'backward'

    for (const position of logicalPositions) {
      yield mapLogicalOffsetToPoint(group, position, boundary)
    }
  }
}
