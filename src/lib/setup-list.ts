import type { LocalSetup, RemoteSetup } from '../types/models'

export type LocalSortMode = 'alphabetical' | 'recent'

export const RESERVED_GLOBAL_SETUP_STEM = 'acc manager global setup'

export function isReservedGlobalSetupFileName(fileName: string): boolean {
  const stem = fileName.replace(/\.[^/.]+$/, '')
  return stem.trim().toLocaleLowerCase() === RESERVED_GLOBAL_SETUP_STEM
}

function normalizeValue(value: string): string {
  return value.trim().toLocaleLowerCase()
}

export function filterLocalSetups(setups: LocalSetup[], filter: string): LocalSetup[] {
  const owned = setups.filter((setup) => !isReservedGlobalSetupFileName(setup.fileName))
  const normalizedFilter = normalizeValue(filter)
  if (!normalizedFilter) {
    return [...owned]
  }

  return owned.filter((setup) => {
    const haystack = `${setup.displayName} ${setup.fileName}`.toLocaleLowerCase()
    return haystack.includes(normalizedFilter)
  })
}

export function sortLocalSetups(
  setups: LocalSetup[],
  sortMode: LocalSortMode,
): LocalSetup[] {
  return [...setups].sort((left, right) => {
    if (sortMode === 'recent') {
      return (
        new Date(right.lastModifiedAt).getTime() - new Date(left.lastModifiedAt).getTime()
      )
    }

    return left.displayName.localeCompare(right.displayName, undefined, {
      sensitivity: 'base',
      numeric: true,
    })
  })
}

export function filterRemoteSetups(setups: RemoteSetup[], filter: string): RemoteSetup[] {
  const normalizedFilter = normalizeValue(filter)
  if (!normalizedFilter) {
    return [...setups]
  }

  return setups.filter((setup) => {
    const metadata = setup.sourceMetadata ?? {}
    const haystack = `${setup.displayName} ${setup.fileName} ${setup.author ?? ''} ${String(
      metadata.setupType ?? '',
    )} ${String(metadata.weather ?? '')}`.toLocaleLowerCase()
    return haystack.includes(normalizedFilter)
  })
}

export function sortRemoteSetups(setups: RemoteSetup[]): RemoteSetup[] {
  return [...setups].sort((left, right) => {
    return left.displayName.localeCompare(right.displayName, undefined, {
      sensitivity: 'base',
      numeric: true,
    })
  })
}
