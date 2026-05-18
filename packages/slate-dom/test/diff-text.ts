import type { Operation } from 'slate'
import { mergeStringDiffs, normalizeStringDiff, type StringDiff } from '../src'
import { transformTextDiff } from '../src/utils/diff-text'

const transformRemoveText = (diff: StringDiff, offset: number, text: string) =>
  transformTextDiff(
    {
      diff,
      id: 1,
      path: [0],
    },
    {
      offset,
      path: [0],
      text,
      type: 'remove_text',
    } satisfies Operation
  )?.diff

describe('slate-dom diff text', () => {
  test('keeps a leading replacement when the rest is a shared suffix', () => {
    expect(
      normalizeStringDiff('abc', { start: 0, end: 3, text: 'xbc' })
    ).toEqual({ start: 0, end: 1, text: 'x' })
  })

  test('keeps a merged leading replacement when diffs share prefix and suffix text', () => {
    expect(
      mergeStringDiffs(
        'abc',
        { start: 0, end: 3, text: 'ybc' },
        { start: 0, end: 1, text: 'x' }
      )
    ).toEqual({ start: 0, end: 1, text: 'x' })
  })

  test('transforms pending diffs across partial remove_text overlaps', () => {
    const diff = { start: 5, end: 10, text: 'X' }

    expect(transformRemoveText(diff, 2, 'abc')).toEqual({
      start: 2,
      end: 7,
      text: 'X',
    })
    expect(transformRemoveText(diff, 7, 'ab')).toEqual({
      start: 5,
      end: 8,
      text: 'X',
    })
    expect(transformRemoveText(diff, 3, 'abcd')).toEqual({
      start: 3,
      end: 6,
      text: 'X',
    })
    expect(transformRemoveText(diff, 8, 'abcd')).toEqual({
      start: 5,
      end: 8,
      text: 'X',
    })
    expect(transformRemoveText(diff, 3, 'abcdefghi')).toEqual({
      start: 3,
      end: 3,
      text: 'X',
    })
  })
})
