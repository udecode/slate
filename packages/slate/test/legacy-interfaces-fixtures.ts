import { describe, it } from 'node:test'

import {
  assertLegacyInterfaceFixture,
  listLegacyFixtures,
} from './legacy-fixture-utils'

const legacyInterfacesRoots = [
  '/Users/zbeyens/git/slate/packages/slate/test/interfaces/Element',
  '/Users/zbeyens/git/slate/packages/slate/test/interfaces/Location',
  '/Users/zbeyens/git/slate/packages/slate/test/interfaces/Node',
  '/Users/zbeyens/git/slate/packages/slate/test/interfaces/Operation',
  '/Users/zbeyens/git/slate/packages/slate/test/interfaces/Path',
  '/Users/zbeyens/git/slate/packages/slate/test/interfaces/Point',
  '/Users/zbeyens/git/slate/packages/slate/test/interfaces/Range',
  '/Users/zbeyens/git/slate/packages/slate/test/interfaces/Text',
]

describe('legacy interface fixtures', () => {
  for (const root of legacyInterfacesRoots) {
    for (const fixture of listLegacyFixtures(root)) {
      const name = fixture.replace(
        '/Users/zbeyens/git/slate/packages/slate/test/interfaces/',
        ''
      )

      it(name, async () => {
        await assertLegacyInterfaceFixture(fixture)
      })
    }
  }
})
