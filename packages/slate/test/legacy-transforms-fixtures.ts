import { describe, it } from 'node:test'

import {
  assertLegacyTransformFixture,
  listLegacyFixtures,
} from './legacy-fixture-utils'

const legacyTransformRoots = [
  '/Users/zbeyens/git/slate/packages/slate/test/transforms/delete',
  '/Users/zbeyens/git/slate/packages/slate/test/transforms/deselect',
  '/Users/zbeyens/git/slate/packages/slate/test/transforms/insertFragment',
  '/Users/zbeyens/git/slate/packages/slate/test/transforms/liftNodes',
  '/Users/zbeyens/git/slate/packages/slate/test/transforms/move',
  '/Users/zbeyens/git/slate/packages/slate/test/transforms/select',
  '/Users/zbeyens/git/slate/packages/slate/test/transforms/setPoint',
  '/Users/zbeyens/git/slate/packages/slate/test/transforms/unsetNodes',
  '/Users/zbeyens/git/slate/packages/slate/test/transforms/unwrapNodes',
  '/Users/zbeyens/git/slate/packages/slate/test/transforms/wrapNodes',
]

const describeLegacyTransformAudit =
  process.env.SLATE_RUN_LEGACY_TRANSFORM_AUDIT === '1'
    ? describe
    : describe.skip

describeLegacyTransformAudit('legacy transform fixtures', () => {
  for (const root of legacyTransformRoots) {
    for (const fixture of listLegacyFixtures(root)) {
      const name = fixture.replace(
        '/Users/zbeyens/git/slate/packages/slate/test/transforms/',
        ''
      )

      it(name, async () => {
        await assertLegacyTransformFixture(fixture)
      })
    }
  }
})
