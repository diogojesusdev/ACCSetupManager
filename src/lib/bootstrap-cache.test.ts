import { afterEach, describe, expect, it } from 'vitest'
import { loadCachedBootstrap, saveCachedBootstrap } from './bootstrap-cache'
import type { AppBootstrap } from '../types/models'

const bootstrapCacheKey = 'acc-setup-manager.bootstrap-cache'

const sampleBootstrap: AppBootstrap = {
  settings: {
    detectedRoot: 'C:\\ACC\\Setups',
    manualRoot: null,
    effectiveRoot: 'C:\\ACC\\Setups',
    rootStatus: 'ready',
  },
  library: {
    cars: [
      {
        id: 'car-1',
        folderName: 'bmw-m4-gt3',
        displayName: 'Bmw M4 Gt3',
        absolutePath: 'C:\\ACC\\Setups\\bmw-m4-gt3',
        trackCount: 3,
        globalSetupPath: 'C:\\ACC\\Setups\\bmw-m4-gt3\\acc manager global setup.json',
      },
    ],
    tracks: [
      {
        id: 'track-1',
        carId: 'car-1',
        folderName: 'spa',
        displayName: 'Spa',
        absolutePath: 'C:\\ACC\\Setups\\bmw-m4-gt3\\spa',
        setupCount: 12,
      },
    ],
  },
  undoState: {
    canUndo: false,
    canRedo: false,
    undoLabel: null,
    redoLabel: null,
  },
}

describe('bootstrap cache', () => {
  afterEach(() => {
    window.localStorage.clear()
  })

  it('loads a saved bootstrap snapshot', () => {
    saveCachedBootstrap(sampleBootstrap)

    expect(loadCachedBootstrap()).toEqual(sampleBootstrap)
  })

  it('ignores malformed cache entries', () => {
    window.localStorage.setItem(bootstrapCacheKey, '{')

    expect(loadCachedBootstrap()).toBeUndefined()
  })

  it('ignores cache entries with the wrong shape', () => {
    window.localStorage.setItem(bootstrapCacheKey, JSON.stringify({ settings: {} }))

    expect(loadCachedBootstrap()).toBeUndefined()
  })
})
