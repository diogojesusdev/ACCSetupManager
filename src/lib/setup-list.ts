import type { LocalSetup, RemoteSetup } from '../types/models'

export type LocalSortMode = 'alphabetical' | 'recent'
export type RemoteSortMode = 'alphabetical' | 'ranking'

function normalizeValue(value: string): string {
  return value.trim().toLocaleLowerCase()
}

export function filterLocalSetups(setups: LocalSetup[], filter: string): LocalSetup[] {
  const normalizedFilter = normalizeValue(filter)
  if (!normalizedFilter) {
    return [...setups]
  }

  return setups.filter((setup) => {
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

export function sortRemoteSetups(
  setups: RemoteSetup[],
  sortMode: RemoteSortMode,
): RemoteSetup[] {
  return [...setups].sort((left, right) => {
    if (sortMode === 'ranking') {
      const leftRanking = left.rankingLabel ?? ''
      const rightRanking = right.rankingLabel ?? ''

      if (leftRanking && rightRanking) {
        return leftRanking.localeCompare(rightRanking, undefined, {
          sensitivity: 'base',
          numeric: true,
        })
      }

      if (leftRanking) {
        return -1
      }

      if (rightRanking) {
        return 1
      }
    }

    return left.displayName.localeCompare(right.displayName, undefined, {
      sensitivity: 'base',
      numeric: true,
    })
  })
}
