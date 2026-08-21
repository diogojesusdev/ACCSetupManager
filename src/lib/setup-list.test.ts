import { describe, expect, it } from 'vitest'
import {
  filterLocalSetups,
  filterRemoteSetups,
  sortLocalSetups,
  sortRemoteSetups,
} from './setup-list'

describe('setup list helpers', () => {
  it('filters local setups by display name and file name', () => {
    const setups = [
      {
        id: '1',
        trackId: 'track-1',
        fileName: 'aggressive-race.json',
        displayName: 'Aggressive Race',
        absolutePath: 'C:\\setups\\aggressive-race.json',
        lastModifiedAt: '2026-08-21T10:00:00Z',
        fileExtension: 'json',
      },
      {
        id: '2',
        trackId: 'track-1',
        fileName: 'wet-safe.json',
        displayName: 'Wet Safe',
        absolutePath: 'C:\\setups\\wet-safe.json',
        lastModifiedAt: '2026-08-21T09:00:00Z',
        fileExtension: 'json',
      },
    ]

    expect(filterLocalSetups(setups, 'safe')).toHaveLength(1)
    expect(filterLocalSetups(setups, 'AGGRESSIVE')[0]?.id).toBe('1')
  })

  it('sorts local setups by modified time', () => {
    const setups = [
      {
        id: 'older',
        trackId: 'track-1',
        fileName: 'older.json',
        displayName: 'Older',
        absolutePath: 'older',
        lastModifiedAt: '2026-08-21T08:00:00Z',
        fileExtension: 'json',
      },
      {
        id: 'newer',
        trackId: 'track-1',
        fileName: 'newer.json',
        displayName: 'Newer',
        absolutePath: 'newer',
        lastModifiedAt: '2026-08-21T10:00:00Z',
        fileExtension: 'json',
      },
    ]

    expect(sortLocalSetups(setups, 'recent').map((setup) => setup.id)).toEqual([
      'newer',
      'older',
    ])
  })

  it('filters and sorts remote setups with ranking first when present', () => {
    const setups = [
      {
        id: 'alpha',
        sourceId: 'source',
        name: 'Alpha',
        displayName: 'Alpha',
        fileName: 'alpha.json',
        sourcePageUrl: 'https://example.com/alpha',
        previewAvailable: true,
      },
      {
        id: 'race',
        sourceId: 'source',
        name: 'Race',
        displayName: 'Race',
        fileName: 'race.json',
        sourcePageUrl: 'https://example.com/race',
        rankingLabel: 'P1',
        previewAvailable: true,
        sourceMetadata: {
          setupType: 'race',
          weather: 'dry',
        },
      },
    ]

    expect(filterRemoteSetups(setups, 'alp')).toHaveLength(1)
    expect(filterRemoteSetups(setups, 'dry')).toHaveLength(1)
    expect(sortRemoteSetups(setups, 'ranking').map((setup) => setup.id)).toEqual([
      'race',
      'alpha',
    ])
  })
})
