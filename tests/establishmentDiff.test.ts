import { describe, expect, it } from 'vitest'

import { computeChangelogEntries } from '@/lib/establishments/utils'

describe('computeChangelogEntries', () => {
  it('marks unseen stores as added and stamps timestamps', () => {
    const syncTimestamp = new Date('2024-01-01T00:00:00.000Z').toISOString()
    const current = [
      {
        id: 'ach-1',
        name: 'New Store',
      },
    ]
    const previous: any[] = []

    const result = computeChangelogEntries({
      current,
      previous,
      syncTimestamp,
    })

    expect(result.added).toHaveLength(1)
    expect(result.added[0]).toMatchObject({
      id: 'ach-1',
      name: 'New Store',
      createdAt: syncTimestamp,
      updatedAt: syncTimestamp,
      removedAt: null,
    })
    expect(current[0]).toMatchObject({
      createdAt: syncTimestamp,
      updatedAt: syncTimestamp,
      removedAt: null,
    })
    expect(result.removed).toHaveLength(0)
  })

  it('marks missing stores as removed without mutating old snapshot', () => {
    const syncTimestamp = new Date('2024-01-02T00:00:00.000Z').toISOString()
    const current: any[] = []
    const previous = [
      {
        id: 'avs-42',
        name: 'Historic Store',
        createdAt: '2023-12-01T10:00:00.000Z',
      },
    ]

    const result = computeChangelogEntries({
      current,
      previous,
      syncTimestamp,
    })

    expect(result.added).toHaveLength(0)
    expect(result.removed).toHaveLength(1)
    expect(result.removed[0]).toMatchObject({
      id: 'avs-42',
      name: 'Historic Store',
      createdAt: '2023-12-01T10:00:00.000Z',
      updatedAt: syncTimestamp,
      removedAt: syncTimestamp,
    })
    expect(previous[0]).not.toHaveProperty('removedAt')
  })
})
