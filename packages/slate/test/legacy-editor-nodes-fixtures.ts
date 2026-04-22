import { describe, it } from 'node:test'

import {
  assertLegacyInterfaceFixture,
  listLegacyFixtures,
} from './legacy-fixture-utils'

const legacyEditorNodesRoot =
  '/Users/zbeyens/git/slate/packages/slate/test/interfaces/Editor/nodes'

describe('legacy editor nodes fixtures', () => {
  for (const fixture of listLegacyFixtures(legacyEditorNodesRoot)) {
    const name = fixture.replace(
      '/Users/zbeyens/git/slate/packages/slate/test/interfaces/Editor/nodes/',
      ''
    )

    it(name, async () => {
      await assertLegacyInterfaceFixture(fixture)
    })
  }
})
